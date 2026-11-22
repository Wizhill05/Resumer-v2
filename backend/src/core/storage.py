import logging
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import UUID

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from src.core.config import settings

logger = logging.getLogger(__name__)


def generation_artifact_keys(generation_id: UUID) -> tuple[str, str, str]:
    prefix = f"runs/{generation_id}"
    return f"{prefix}/resume.pdf", f"{prefix}/resume.md", f"{prefix}/thumb.webp"


class StorageService:
    def __init__(self):
        self.enabled = bool(
            settings.R2_ENDPOINT_URL
            and settings.R2_ACCESS_KEY_ID
            and settings.R2_SECRET_ACCESS_KEY
        )
        self.local_root = settings.LOCAL_STORAGE_DIR.resolve() if settings.LOCAL_STORAGE_DIR and not self.enabled else None
        if self.enabled:
            self.s3_client = boto3.client(
                "s3",
                endpoint_url=settings.R2_ENDPOINT_URL,
                aws_access_key_id=settings.R2_ACCESS_KEY_ID,
                aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
                config=Config(signature_version="s3v4"),
                region_name="auto",
            )
            logger.info("StorageService: R2 client initialized for bucket '%s'", settings.R2_BUCKET_NAME)
        else:
            self.s3_client = None
            self.enabled = self.local_root is not None
            if not self.enabled:
                logger.warning("StorageService: R2 not configured — uploads will be skipped.")

    def _local_path(self, key: str) -> Path:
        path = (self.local_root / key).resolve()
        if not path.is_relative_to(self.local_root) or path == self.local_root or Path(key).is_absolute():
            raise ValueError("Storage key escapes the local storage directory")
        return path

    def get_stream(self, key: str):
        """Open an artifact body for streaming. The caller closes the body."""
        if not self.enabled:
            return None
        try:
            if self.s3_client is not None:
                return self.s3_client.get_object(Bucket=settings.R2_BUCKET_NAME, Key=key)["Body"]
            return self._local_path(key).open("rb")
        except Exception as exc:
            logger.warning("StorageService: could not open %s: %s", key, exc)
            return None

    def upload_bytes(self, data: bytes, key: str, content_type: str = "application/pdf") -> bool:
        if self.local_root is not None:
            temporary = None
            try:
                path = self._local_path(key)
                path.parent.mkdir(parents=True, exist_ok=True)
                with NamedTemporaryFile(dir=path.parent, delete=False) as output:
                    temporary = Path(output.name)
                    output.write(data)
                temporary.replace(path)
                return True
            except (OSError, ValueError):
                logger.warning("StorageService: could not write local object %s", key, exc_info=True)
                return False
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
        if not self.enabled or not self.s3_client:
            logger.warning("StorageService: R2 not configured. Skipping upload of %s.", key)
            return False
        try:
            self.s3_client.put_object(
                Bucket=settings.R2_BUCKET_NAME,
                Key=key,
                Body=data,
                ContentType=content_type,
            )
            logger.info("StorageService: Uploaded %s (%d bytes)", key, len(data))
            return True
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            if error_code == "AccessDenied":
                logger.error(
                    "StorageService: AccessDenied uploading %s. "
                    "Check R2 API token has 'Object Read & Write' permission for bucket '%s'.",
                    key, settings.R2_BUCKET_NAME,
                )
            else:
                logger.error("StorageService: ClientError uploading %s: [%s] %s", key, error_code, e)
            return False
        except Exception as e:
            logger.error("StorageService: Unexpected error uploading %s: %s", key, e)
            return False

    def download_bytes(self, key: str) -> bytes | None:
        body = self.get_stream(key)
        if body is None:
            return None
        try:
            return body.read()
        except Exception as exc:
            logger.error("StorageService: Error downloading %s: %s", key, exc)
            return None
        finally:
            body.close()

    def file_exists(self, key: str) -> bool:
        if self.local_root is not None:
            try:
                return self._local_path(key).is_file()
            except (OSError, ValueError):
                return False
        if not self.enabled or not self.s3_client:
            return False
        try:
            self.s3_client.head_object(Bucket=settings.R2_BUCKET_NAME, Key=key)
            return True
        except ClientError:
            return False
        except Exception as e:
            logger.error("StorageService: Error checking existence of %s: %s", key, e)
            return False

    def get_presigned_url(
        self,
        key: str,
        expires_in: int = 3600,
        response_content_disposition: str | None = None,
    ) -> str | None:
        if not self.enabled or not self.s3_client:
            return None
        try:
            params: dict = {"Bucket": settings.R2_BUCKET_NAME, "Key": key}
            if response_content_disposition:
                params["ResponseContentDisposition"] = response_content_disposition
            return self.s3_client.generate_presigned_url(
                "get_object",
                Params=params,
                ExpiresIn=expires_in,
            )
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            logger.error("StorageService: ClientError generating presigned URL for %s: [%s] %s", key, error_code, e)
            return None
        except Exception as e:
            logger.error("StorageService: Failed to generate presigned URL for %s: %s", key, e)
            return None

    def delete_file(self, key: str) -> bool:
        if self.local_root is not None:
            try:
                self._local_path(key).unlink(missing_ok=True)
                return True
            except (OSError, ValueError):
                return False
        if not self.enabled or not self.s3_client:
            return False
        try:
            self.s3_client.delete_object(Bucket=settings.R2_BUCKET_NAME, Key=key)
            logger.info("StorageService: Deleted %s", key)
            return True
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            logger.error("StorageService: ClientError deleting %s: [%s] %s", key, error_code, e)
            return False
        except Exception as e:
            logger.error("StorageService: Failed to delete %s: %s", key, e)
            return False

    def delete_files(self, keys: list[str]) -> list[str]:
        """Delete many keys with DeleteObjects (1000 per request).

        Returns the keys that could NOT be deleted, so an empty list means success.
        Missing keys count as deleted (S3/R2 semantics). With storage disabled nothing
        is stored remotely, so there is nothing to fail.
        """
        if self.local_root is not None:
            return [key for key in keys if not self.delete_file(key)]
        if not keys or not self.enabled or not self.s3_client:
            return []
        failed: list[str] = []
        for start in range(0, len(keys), 1000):
            chunk = keys[start:start + 1000]
            try:
                res = self.s3_client.delete_objects(
                    Bucket=settings.R2_BUCKET_NAME,
                    Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True},
                )
                for err in res.get("Errors", []) or []:
                    logger.error(
                        "StorageService: failed to delete %s: [%s] %s",
                        err.get("Key"), err.get("Code"), err.get("Message"),
                    )
                    if not err.get("Key"):
                        failed.extend(chunk)
                        break
                    failed.append(err["Key"])
            except Exception as e:
                logger.error("StorageService: DeleteObjects failed for %d keys: %s", len(chunk), e)
                failed.extend(chunk)
        return list(dict.fromkeys(failed))

    def list_objects(self, prefix: str = "", limit: int = 100, cursor: str | None = None) -> dict:
        if not self.enabled or not self.s3_client:
            return {"objects": [], "next_cursor": None, "enabled": False}
        try:
            params = {
                "Bucket": settings.R2_BUCKET_NAME,
                "Prefix": prefix,
                "MaxKeys": min(limit, 1000),
            }
            if cursor:
                params["ContinuationToken"] = cursor
            res = self.s3_client.list_objects_v2(**params)
            return {
                "enabled": True,
                "objects": [
                    {
                        "key": item["Key"],
                        "size": item.get("Size", 0),
                        "last_modified": item.get("LastModified"),
                        "etag": item.get("ETag"),
                    }
                    for item in res.get("Contents", [])
                ],
                "next_cursor": res.get("NextContinuationToken"),
            }
        except Exception as e:
            logger.error("StorageService: Failed to list objects: %s", e)
            return {"objects": [], "next_cursor": None, "enabled": True, "error": str(e)}

    def get_object_metadata(self, key: str) -> dict | None:
        if not self.enabled or not self.s3_client:
            return None
        try:
            res = self.s3_client.head_object(Bucket=settings.R2_BUCKET_NAME, Key=key)
            return {
                "key": key,
                "size": res.get("ContentLength"),
                "content_type": res.get("ContentType"),
                "last_modified": res.get("LastModified"),
                "metadata": res.get("Metadata"),
            }
        except Exception as e:
            logger.error("StorageService: Failed to read metadata for %s: %s", key, e)
            return None

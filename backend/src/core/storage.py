import logging

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from src.core.config import settings

logger = logging.getLogger(__name__)


class StorageService:
    def __init__(self):
        self.enabled = bool(
            settings.R2_ENDPOINT_URL
            and settings.R2_ACCESS_KEY_ID
            and settings.R2_SECRET_ACCESS_KEY
        )
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
            logger.warning("StorageService: R2 not configured — uploads will be skipped.")

    def upload_bytes(self, data: bytes, key: str, content_type: str = "application/pdf") -> bool:
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
        if not self.enabled or not self.s3_client:
            return None
        try:
            res = self.s3_client.get_object(Bucket=settings.R2_BUCKET_NAME, Key=key)
            return res["Body"].read()
        except Exception as e:
            logger.error("StorageService: Error downloading %s: %s", key, e)
            return None

    def file_exists(self, key: str) -> bool:
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

    def ensure_lifecycle_policy(self) -> None:
        """Idempotently apply a 90-day expiry rule to all objects in the bucket.

        Safe to call on every container start — R2 (S3-compatible) will overwrite
        the existing lifecycle config with the same rule, producing no visible change.
        Skipped silently if R2 is not configured (local dev).
        """
        if not self.enabled or not self.s3_client:
            logger.info("StorageService: R2 not configured — skipping lifecycle policy setup.")
            return
        try:
            self.s3_client.put_bucket_lifecycle_configuration(
                Bucket=settings.R2_BUCKET_NAME,
                LifecycleConfiguration={
                    "Rules": [
                        {
                            "ID": "expire-artifacts-90d",
                            "Status": "Enabled",
                            "Filter": {"Prefix": ""},  # applies to all objects
                            "Expiration": {"Days": 90},
                        }
                    ]
                },
            )
            logger.info(
                "StorageService: R2 lifecycle policy set — objects in '%s' expire after 90 days.",
                settings.R2_BUCKET_NAME,
            )
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            logger.error(
                "StorageService: ClientError setting lifecycle policy on '%s': [%s] %s",
                settings.R2_BUCKET_NAME, error_code, e,
            )
        except Exception as e:
            logger.error("StorageService: Failed to set lifecycle policy: %s", e)

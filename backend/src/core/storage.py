import boto3
from botocore.config import Config
from src.core.config import settings


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
        else:
            self.s3_client = None

    def upload_bytes(self, data: bytes, key: str, content_type: str = "application/pdf") -> bool:
        if not self.enabled or not self.s3_client:
            print("StorageService: R2 not configured. Skipping upload.")
            return False
        try:
            self.s3_client.put_object(
                Bucket=settings.R2_BUCKET_NAME,
                Key=key,
                Body=data,
                ContentType=content_type,
            )
            return True
        except Exception as e:
            print(f"StorageService: Failed to upload {key}: {e}")
            return False

    def file_exists(self, key: str) -> bool:
        if not self.enabled or not self.s3_client:
            return False
        try:
            self.s3_client.head_object(Bucket=settings.R2_BUCKET_NAME, Key=key)
            return True
        except Exception:
            return False

    def get_presigned_url(self, key: str, expires_in: int = 3600) -> str | None:
        if not self.enabled or not self.s3_client:
            return None
        try:
            return self.s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": settings.R2_BUCKET_NAME, "Key": key},
                ExpiresIn=expires_in,
            )
        except Exception as e:
            print(f"StorageService: Failed to generate presigned URL for {key}: {e}")
            return None

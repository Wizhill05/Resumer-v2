from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.models.oauth import OAuthClient, OAuthAuthorizationCode, OAuthRefreshToken
from src.models.user import User

DEFAULT_SCOPES = [
    "profile:read",
    "profile:write",
    "resume:generate",
    "resume:edit",
    "offline_access",
]


def hash_token(token: str) -> str:
    """Generate SHA-256 hash of code, token, or secret."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_pkce(code_verifier: str, code_challenge: str, method: str = "S256") -> bool:
    """Verify PKCE code_verifier against code_challenge using RFC 7636."""
    if method != "S256":
        return False
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    computed_challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    target_challenge = code_challenge.rstrip("=")
    return hmac.compare_digest(computed_challenge, target_challenge)


def generate_random_token(prefix: str = "", bytes_count: int = 32) -> str:
    """Generate cryptographically secure random token string."""
    token = secrets.token_urlsafe(bytes_count)
    return f"{prefix}{token}" if prefix else token


def create_oauth_access_token(
    user_id: uuid.UUID,
    email: str,
    scope: str,
    client_id: str,
    issuer: str | None = None,
    expires_in_seconds: int = 3600,
) -> tuple[str, int]:
    """Create a signed JWT access token for OAuth 2.1 authorization."""
    now = datetime.now(timezone.utc)
    expire = now + timedelta(seconds=expires_in_seconds)
    iss = issuer or getattr(settings, "BACKEND_URL", "").strip().rstrip("/") or settings.FRONTEND_URL or "https://resumer.io"
    payload = {
        "sub": str(user_id),
        "email": email,
        "scope": scope,
        "client_id": client_id,
        "jti": str(uuid.uuid4()),
        "token_use": "access_token",
        "iss": iss,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    encoded_jwt = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt, expires_in_seconds

def decode_oauth_token(token: str) -> dict | None:
    """Decode and validate an OAuth access token."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


def get_oauth_metadata(base_url: str) -> dict:
    """Return RFC 8414 Authorization Server Metadata."""
    clean_base = base_url.rstrip("/")
    return {
        "issuer": clean_base,
        "authorization_endpoint": f"{clean_base}/oauth/authorize",
        "token_endpoint": f"{clean_base}/oauth/token",
        "revocation_endpoint": f"{clean_base}/oauth/revoke",
        "userinfo_endpoint": f"{clean_base}/oauth/userinfo",
        "registration_endpoint": f"{clean_base}/oauth/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
        "scopes_supported": DEFAULT_SCOPES,
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["HS256"],
    }


async def ensure_oauth_schema() -> None:
    """Ensure OAuth tables and all columns exist idempotently on application startup."""
    from sqlalchemy import text
    from src.core.database import engine

    is_postgres = "postgresql" in str(engine.url)
    if not is_postgres:
        return

    try:
        async with engine.begin() as conn:
            # 1. Create tables if not exists
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS oauth_clients (
                    id UUID PRIMARY KEY,
                    client_id VARCHAR UNIQUE NOT NULL,
                    client_secret_hash VARCHAR,
                    client_name VARCHAR NOT NULL DEFAULT 'OAuth Client',
                    redirect_uris TEXT[] NOT NULL DEFAULT '{}',
                    grant_types TEXT[] NOT NULL DEFAULT '{"authorization_code", "refresh_token"}',
                    response_types TEXT[] NOT NULL DEFAULT '{"code"}',
                    scope VARCHAR NOT NULL DEFAULT 'profile:read profile:write resume:generate resume:edit offline_access',
                    is_confidential BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            """))

            # 2. Add missing columns on legacy oauth_clients table if any
            await conn.execute(text("""
                ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS client_name VARCHAR NOT NULL DEFAULT 'OAuth Client';
                ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS redirect_uris TEXT[] NOT NULL DEFAULT '{}';
                ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS grant_types TEXT[] NOT NULL DEFAULT '{"authorization_code", "refresh_token"}';
                ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS response_types TEXT[] NOT NULL DEFAULT '{"code"}';
                ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS scope VARCHAR NOT NULL DEFAULT 'profile:read profile:write resume:generate resume:edit offline_access';
                ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS is_confidential BOOLEAN NOT NULL DEFAULT FALSE;
                ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS client_secret_hash VARCHAR;
                ALTER TABLE oauth_clients ALTER COLUMN name DROP NOT NULL;
                ALTER TABLE oauth_clients ALTER COLUMN allowed_scopes DROP NOT NULL;
                ALTER TABLE oauth_clients ALTER COLUMN is_public DROP NOT NULL;
            """))
            # 3. Create oauth_authorization_codes
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
                    id UUID PRIMARY KEY,
                    code_hash VARCHAR UNIQUE NOT NULL,
                    client_id VARCHAR NOT NULL,
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    redirect_uri VARCHAR NOT NULL,
                    scope VARCHAR NOT NULL,
                    code_challenge VARCHAR NOT NULL,
                    code_challenge_method VARCHAR NOT NULL DEFAULT 'S256',
                    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    used BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            """))

            await conn.execute(text("""
                ALTER TABLE oauth_authorization_codes ADD COLUMN IF NOT EXISTS code_hash VARCHAR;
                ALTER TABLE oauth_authorization_codes ADD COLUMN IF NOT EXISTS client_id VARCHAR;
                ALTER TABLE oauth_authorization_codes ADD COLUMN IF NOT EXISTS user_id UUID;
                ALTER TABLE oauth_authorization_codes ADD COLUMN IF NOT EXISTS redirect_uri VARCHAR;
                ALTER TABLE oauth_authorization_codes ADD COLUMN IF NOT EXISTS scope VARCHAR;
                ALTER TABLE oauth_authorization_codes ADD COLUMN IF NOT EXISTS code_challenge VARCHAR;
                ALTER TABLE oauth_authorization_codes ADD COLUMN IF NOT EXISTS code_challenge_method VARCHAR DEFAULT 'S256';
                ALTER TABLE oauth_authorization_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;
                ALTER TABLE oauth_authorization_codes ADD COLUMN IF NOT EXISTS used BOOLEAN DEFAULT FALSE;
                ALTER TABLE oauth_authorization_codes ALTER COLUMN code DROP NOT NULL;
                ALTER TABLE oauth_authorization_codes ALTER COLUMN scopes DROP NOT NULL;
            """))
            # 4. Create oauth_refresh_tokens
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
                    id UUID PRIMARY KEY,
                    token_hash VARCHAR UNIQUE NOT NULL,
                    client_id VARCHAR NOT NULL,
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    scope VARCHAR NOT NULL,
                    family_id UUID NOT NULL,
                    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    revoked BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            """))

            await conn.execute(text("""
                ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS token_hash VARCHAR;
                ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS client_id VARCHAR;
                ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS user_id UUID;
                ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS scope VARCHAR;
                ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS family_id UUID;
                ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;
                ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS revoked BOOLEAN DEFAULT FALSE;
                ALTER TABLE oauth_refresh_tokens ALTER COLUMN scopes DROP NOT NULL;
            """))
    except Exception as e:
        print(f"[oauth/startup] Warning: ensure_oauth_schema check encountered: {e}")

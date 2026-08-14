from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from fastapi import APIRouter, Depends, Form, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_optional_user
from src.core.config import settings
from src.core.database import get_db
from src.core.oauth import (
    DEFAULT_SCOPES,
    create_oauth_access_token,
    decode_oauth_token,
    generate_random_token,
    get_oauth_metadata,
    hash_token,
    verify_pkce,
)
from src.models.oauth import OAuthAuthorizationCode, OAuthClient, OAuthRefreshToken
from src.models.user import User

router = APIRouter(tags=["OAuth 2.1"])


def is_expired(expires_at: datetime) -> bool:
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at < datetime.now(timezone.utc)


# --- Schemas ---

class ClientRegistrationRequest(BaseModel):
    client_name: str = Field(..., description="Human-readable name of the OAuth client")
    redirect_uris: list[str] = Field(..., description="Allowed redirection URIs")
    grant_types: list[str] = Field(default=["authorization_code", "refresh_token"])
    response_types: list[str] = Field(default=["code"])
    scope: str = Field(default="profile:read profile:write resume:generate resume:edit offline_access")
    token_endpoint_auth_method: str = Field(default="none")


class ClientRegistrationResponse(BaseModel):
    client_id: str
    client_name: str
    redirect_uris: list[str]
    grant_types: list[str]
    response_types: list[str]
    scope: str
    token_endpoint_auth_method: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int = 3600
    refresh_token: str | None = None
    scope: str


# --- Discovery Endpoints ---

@router.get("/.well-known/oauth-authorization-server")
@router.get("/.well-known/openid-configuration")
async def oauth_authorization_server_metadata(request: Request):
    """RFC 8414 OAuth 2.0 Authorization Server Metadata."""
    base_url = str(request.base_url).rstrip("/")
    return get_oauth_metadata(base_url)


@router.get("/.well-known/oauth-protected-resource")
async def oauth_protected_resource_metadata(request: Request):
    """RFC 9728 Protected Resource Metadata."""
    base_url = str(request.base_url).rstrip("/")
    return {
        "resource": base_url,
        "authorization_servers": [base_url],
        "scopes_supported": DEFAULT_SCOPES,
        "bearer_methods_supported": ["header"],
    }


# --- Dynamic Client Registration (RFC 7591) ---

@router.post("/oauth/register", response_model=ClientRegistrationResponse, status_code=status.HTTP_201_CREATED)
async def register_oauth_client(
    body: ClientRegistrationRequest,
    db: AsyncSession = Depends(get_db),
):
    """RFC 7591 Dynamic Client Registration for ChatGPT, Gemini, and MCP Connectors."""
    if not body.redirect_uris:
        raise HTTPException(status_code=400, detail="At least one redirect_uri is required")

    client_id = f"client_{generate_random_token(bytes_count=16)}"
    client = OAuthClient(
        client_id=client_id,
        client_name=body.client_name,
        redirect_uris=body.redirect_uris,
        grant_types=body.grant_types,
        response_types=body.response_types,
        scope=body.scope,
        is_confidential=(body.token_endpoint_auth_method != "none"),
    )
    db.add(client)
    await db.commit()
    await db.refresh(client)

    return ClientRegistrationResponse(
        client_id=client.client_id,
        client_name=client.client_name,
        redirect_uris=client.redirect_uris,
        grant_types=client.grant_types,
        response_types=client.response_types,
        scope=client.scope,
        token_endpoint_auth_method=body.token_endpoint_auth_method,
    )


# --- Authorization Endpoint (RFC 6749 + RFC 7636 PKCE) ---

@router.get("/oauth/authorize")
async def oauth_authorize_get(
    request: Request,
    response_type: str = Query(...),
    client_id: str = Query(...),
    redirect_uri: str = Query(...),
    scope: str = Query("profile:read profile:write resume:generate resume:edit offline_access"),
    state: str = Query(...),
    code_challenge: str = Query(...),
    code_challenge_method: str = Query("S256"),
    current_user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """OAuth 2.1 Authorization Code Flow with PKCE."""
    # 1. Validate response_type
    if response_type != "code":
        raise HTTPException(status_code=400, detail="Unsupported response_type. Only 'code' is allowed.")

    # 2. Validate PKCE method
    if code_challenge_method != "S256":
        raise HTTPException(status_code=400, detail="code_challenge_method must be S256.")

    # 3. Validate or auto-provision client
    result = await db.execute(select(OAuthClient).where(OAuthClient.client_id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        client = OAuthClient(
            client_id=client_id,
            client_name=f"{client_id.capitalize()} Connector",
            redirect_uris=[redirect_uri, "https://chatgpt.com/oauth/callback", "https://chat.openai.com/oauth/callback", "https://gemini.google.com/auth/callback"],
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"],
            scope=scope or "profile:read profile:write resume:generate resume:edit offline_access",
            is_confidential=False,
        )
        db.add(client)
        await db.commit()
        await db.refresh(client)

    # 4. Validate redirect_uri
    if redirect_uri not in client.redirect_uris:
        valid = any(redirect_uri.startswith(allowed.rstrip("*")) for allowed in client.redirect_uris)
        if not valid and any(domain in redirect_uri for domain in ["chatgpt.com", "openai.com", "google.com", "localhost", "127.0.0.1"]):
            # Dynamically register incoming client callback
            client.redirect_uris = list(client.redirect_uris) + [redirect_uri]
            await db.commit()
            valid = True
        if not valid:
            raise HTTPException(status_code=400, detail="Mismatching redirect_uri")
    # Build current authorize URL for callback
    current_url = str(request.url)
    import urllib.parse
    encoded_callback = urllib.parse.quote(current_url, safe="")
    frontend_url = settings.FRONTEND_URL.rstrip("/")

    # If user is authenticated via Google/GitHub session
    if current_user:
        provider_name = (current_user.provider or "Account").capitalize()
        consent_html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Authorize {client.client_name} - Resumer</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }}
        .card {{ background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 36px 32px; max-width: 440px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.6); text-align: center; }}
        .logo {{ font-size: 24px; font-weight: 700; color: #fff; letter-spacing: -0.5px; margin-bottom: 8px; }}
        .subtitle {{ font-size: 14px; color: #a1a1aa; margin-top: 0; margin-bottom: 24px; line-height: 1.5; }}
        .client-name {{ color: #3b82f6; font-weight: 600; }}
        .user-box {{ display: flex; align-items: center; justify-content: space-between; background: #27272a; border: 1px solid #3f3f46; border-radius: 10px; padding: 12px 16px; margin-bottom: 20px; text-align: left; }}
        .user-info {{ display: flex; flex-direction: column; }}
        .user-name {{ font-size: 14px; font-weight: 600; color: #fff; }}
        .user-email {{ font-size: 12px; color: #a1a1aa; }}
        .provider-badge {{ font-size: 11px; font-weight: 600; text-transform: uppercase; background: #3b82f6; color: #fff; padding: 3px 8px; border-radius: 6px; }}
        .scope-box {{ text-align: left; background: #121215; border: 1px solid #27272a; border-radius: 10px; padding: 14px 16px; margin-bottom: 24px; font-size: 13px; color: #d4d4d8; }}
        .scope-title {{ font-size: 11px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }}
        .scope-item {{ margin: 6px 0; display: flex; align-items: center; gap: 8px; }}
        .btn-submit {{ width: 100%; background: #2563eb; color: #fff; font-weight: 600; border: none; padding: 13px; border-radius: 8px; cursor: pointer; font-size: 14px; transition: background 0.2s; }}
        .btn-submit:hover {{ background: #1d4ed8; }}
        .btn-cancel {{ display: inline-block; width: 100%; margin-top: 10px; padding: 10px 0; font-size: 13px; color: #71717a; text-decoration: none; transition: color 0.2s; }}
        .btn-cancel:hover {{ color: #a1a1aa; }}
    </style>
</head>
<body>
    <div class="card">
        <div class="logo">Resumer</div>
        <p class="subtitle"><span class="client-name">{client.client_name}</span> is requesting permission to access your Resumer account.</p>
        
        <div class="user-box">
            <div class="user-info">
                <span class="user-name">{current_user.name or current_user.email}</span>
                <span class="user-email">{current_user.email}</span>
            </div>
            <span class="provider-badge">{provider_name}</span>
        </div>

        <div class="scope-box">
            <div class="scope-title">Permissions Requested:</div>
            <div class="scope-item">✓ View & update your profile and projects</div>
            <div class="scope-item">✓ Generate tailored single-page resumes with AI</div>
            <div class="scope-item">✓ Perform gap analysis & surgical edits</div>
        </div>

        <form method="POST" action="/oauth/authorize">
            <input type="hidden" name="client_id" value="{client_id}">
            <input type="hidden" name="redirect_uri" value="{redirect_uri}">
            <input type="hidden" name="scope" value="{scope}">
            <input type="hidden" name="state" value="{state}">
            <input type="hidden" name="code_challenge" value="{code_challenge}">
            <input type="hidden" name="code_challenge_method" value="{code_challenge_method}">
            <input type="hidden" name="user_id" value="{current_user.id}">
            <button type="submit" class="btn-submit">Authorize {client.client_name}</button>
            <a href="{redirect_uri}?error=access_denied&state={state}" class="btn-cancel">Cancel</a>
        </form>
    </div>
</body>
</html>"""
        return HTMLResponse(content=consent_html)

    # If unauthenticated, present Google & GitHub Social Login
    login_html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Sign in to Resumer</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }}
        .card {{ background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 36px 32px; max-width: 440px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.6); text-align: center; }}
        .logo {{ font-size: 26px; font-weight: 800; color: #fff; letter-spacing: -0.5px; margin-bottom: 8px; }}
        .subtitle {{ font-size: 14px; color: #a1a1aa; margin-top: 0; margin-bottom: 28px; line-height: 1.5; }}
        .client-name {{ color: #3b82f6; font-weight: 600; }}
        .btn-group {{ display: flex; flex-direction: column; gap: 12px; }}
        .social-btn {{ display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 12px; border-radius: 8px; font-size: 14px; font-weight: 600; text-decoration: none; box-sizing: border-box; transition: opacity 0.2s, transform 0.1s; cursor: pointer; }}
        .social-btn:active {{ transform: scale(0.98); }}
        .google-btn {{ background: #ffffff; color: #09090b; }}
        .google-btn:hover {{ opacity: 0.92; }}
        .github-btn {{ background: #27272a; color: #ffffff; border: 1px solid #3f3f46; }}
        .github-btn:hover {{ background: #3f3f46; }}
        .divider {{ display: flex; align-items: center; text-align: center; margin: 20px 0 10px 0; color: #52525b; font-size: 12px; text-transform: uppercase; }}
        .divider::before, .divider::after {{ content: ''; flex: 1; border-bottom: 1px solid #27272a; }}
        .divider:not(:empty)::before {{ margin-right: .5em; }}
        .divider:not(:empty)::after {{ margin-left: .5em; }}
        .footnote {{ font-size: 12px; color: #71717a; margin-top: 24px; line-height: 1.4; }}
    </style>
</head>
<body>
    <div class="card">
        <div class="logo">Resumer</div>
        <p class="subtitle">Sign in to connect your account with <span class="client-name">{client.client_name}</span></p>

        <div class="btn-group">
            <a href="{frontend_url}/api/auth/signin/google?callbackUrl={encoded_callback}" class="social-btn google-btn">
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
                Continue with Google
            </a>

            <a href="{frontend_url}/api/auth/signin/github?callbackUrl={encoded_callback}" class="social-btn github-btn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
                Continue with GitHub
            </a>
        </div>

        <p class="footnote">Resumer uses Google and GitHub for secure passwordless authentication. No passwords stored.</p>
    </div>
</body>
</html>"""
    return HTMLResponse(content=login_html)


@router.post("/oauth/authorize")
async def oauth_authorize_post(
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    scope: str = Form("profile:read profile:write resume:generate resume:edit offline_access"),
    state: str = Form(...),
    code_challenge: str = Form(...),
    code_challenge_method: str = Form("S256"),
    user_id: str | None = Form(None),
    email: str | None = Form(None),
    current_user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    # 1. Validate or auto-provision client
    result = await db.execute(select(OAuthClient).where(OAuthClient.client_id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        client = OAuthClient(
            client_id=client_id,
            client_name=f"{client_id.capitalize()} Connector",
            redirect_uris=[redirect_uri, "https://chatgpt.com/oauth/callback", "https://chat.openai.com/oauth/callback", "https://gemini.google.com/auth/callback"],
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"],
            scope=scope or "profile:read profile:write resume:generate resume:edit offline_access",
            is_confidential=False,
        )
        db.add(client)
        await db.commit()
        await db.refresh(client)

    # 2. Resolve authenticated user
    user: User | None = None
    if user_id:
        try:
            u_res = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
            user = u_res.scalar_one_or_none()
        except ValueError:
            pass

    if not user and current_user:
        user = current_user

    if not user and email:
        u_res = await db.execute(select(User).where(User.email == email.strip().lower()))
        user = u_res.scalar_one_or_none()
        if not user:
            user = User(
                email=email.strip().lower(),
                name=email.split("@")[0].capitalize(),
                provider="oauth-mcp",
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
    # 3. Create Authorization Code
    raw_code = generate_random_token(prefix="code_", bytes_count=32)
    code_hash_val = hash_token(raw_code)
    auth_code_record = OAuthAuthorizationCode(
        code_hash=code_hash_val,
        client_id=client_id,
        user_id=user.id,
        redirect_uri=redirect_uri,
        scope=scope,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        used=False,
    )
    db.add(auth_code_record)
    await db.commit()

    # 4. Redirect to client's redirect URI
    parsed_url = urlparse(redirect_uri)
    query_dict = parse_qs(parsed_url.query)
    query_dict["code"] = [raw_code]
    query_dict["state"] = [state]
    new_query = urlencode(query_dict, doseq=True)
    redirect_target = urlunparse(parsed_url._replace(query=new_query))
    return RedirectResponse(url=redirect_target, status_code=302)


# --- Token Endpoint (RFC 6749 + RFC 7636) ---

@router.post("/oauth/token", response_model=TokenResponse)
async def oauth_token(
    request: Request,
    grant_type: str = Form(...),
    code: str | None = Form(None),
    code_verifier: str | None = Form(None),
    redirect_uri: str | None = Form(None),
    client_id: str | None = Form(None),
    refresh_token: str | None = Form(None),
    scope: str | None = Form(None),
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """OAuth 2.1 Token Exchange endpoint supporting PKCE and Refresh Token Rotation."""
    # Resolve client_id from form or Basic Auth header
    resolved_client_id = client_id
    if not resolved_client_id and authorization and authorization.startswith("Basic "):
        import base64
        try:
            cred_bytes = base64.b64decode(authorization[6:])
            resolved_client_id = cred_bytes.decode("utf-8").split(":")[0]
        except Exception:
            pass

    # --- Authorization Code Exchange ---
    if grant_type == "authorization_code":
        if not code:
            raise HTTPException(status_code=400, detail="Missing parameter: code")
        if not code_verifier:
            raise HTTPException(status_code=400, detail="Missing PKCE parameter: code_verifier")

        code_hash_val = hash_token(code)
        result = await db.execute(
            select(OAuthAuthorizationCode).where(OAuthAuthorizationCode.code_hash == code_hash_val)
        )
        auth_code_obj = result.scalar_one_or_none()

        if not auth_code_obj:
            raise HTTPException(status_code=400, detail="Invalid authorization code")
        if auth_code_obj.used:
            raise HTTPException(status_code=400, detail="Authorization code already used")
        if is_expired(auth_code_obj.expires_at):
            raise HTTPException(status_code=400, detail="Authorization code expired")

        # Verify PKCE
        if not verify_pkce(code_verifier, auth_code_obj.code_challenge, auth_code_obj.code_challenge_method):
            raise HTTPException(status_code=400, detail="Invalid code_verifier (PKCE verification failed)")

        # Mark code as used
        auth_code_obj.used = True
        await db.commit()

        target_user_id = auth_code_obj.user_id if isinstance(auth_code_obj.user_id, uuid.UUID) else uuid.UUID(str(auth_code_obj.user_id))
        user_res = await db.execute(select(User).where(User.id == target_user_id))
        user = user_res.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=400, detail="User not found")

        # Generate access token
        access_tok, expires_in = create_oauth_access_token(
            user_id=user.id,
            email=user.email,
            scope=auth_code_obj.scope,
            client_id=auth_code_obj.client_id,
        )

        # Generate refresh token
        raw_refresh_token = generate_random_token(prefix="rt_", bytes_count=32)
        refresh_hash_val = hash_token(raw_refresh_token)
        refresh_record = OAuthRefreshToken(
            token_hash=refresh_hash_val,
            client_id=auth_code_obj.client_id,
            user_id=user.id,
            scope=auth_code_obj.scope,
            family_id=uuid.uuid4(),
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            revoked=False,
        )
        db.add(refresh_record)
        await db.commit()

        return TokenResponse(
            access_token=access_tok,
            token_type="Bearer",
            expires_in=expires_in,
            refresh_token=raw_refresh_token,
            scope=auth_code_obj.scope,
        )

    # --- Refresh Token Exchange (Refresh Token Rotation) ---
    elif grant_type == "refresh_token":
        if not refresh_token:
            raise HTTPException(status_code=400, detail="Missing parameter: refresh_token")

        refresh_hash_val = hash_token(refresh_token)
        result = await db.execute(
            select(OAuthRefreshToken).where(OAuthRefreshToken.token_hash == refresh_hash_val)
        )
        refresh_obj = result.scalar_one_or_none()

        if not refresh_obj:
            raise HTTPException(status_code=400, detail="Invalid refresh token")

        # Token Replay Detection: if a revoked token is presented, revoke all tokens in the family!
        if refresh_obj.revoked:
            await db.execute(
                update(OAuthRefreshToken)
                .where(OAuthRefreshToken.family_id == refresh_obj.family_id)
                .values(revoked=True)
            )
            await db.commit()
            raise HTTPException(
                status_code=400,
                detail="Revoked refresh token presented. All tokens in this family have been invalidated.",
            )

        if is_expired(refresh_obj.expires_at):
            raise HTTPException(status_code=400, detail="Refresh token expired")

        # Mark previous refresh token revoked (Single-Use Token Rotation)
        refresh_obj.revoked = True

        target_user_id = refresh_obj.user_id if isinstance(refresh_obj.user_id, uuid.UUID) else uuid.UUID(str(refresh_obj.user_id))
        user_res = await db.execute(select(User).where(User.id == target_user_id))
        user = user_res.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=400, detail="User not found")

        # Issue new access token
        effective_scope = scope or refresh_obj.scope
        access_tok, expires_in = create_oauth_access_token(
            user_id=user.id,
            email=user.email,
            scope=effective_scope,
            client_id=refresh_obj.client_id,
        )

        # Issue new rotated refresh token in the same family
        new_raw_refresh_token = generate_random_token(prefix="rt_", bytes_count=32)
        new_refresh_hash = hash_token(new_raw_refresh_token)
        new_refresh_record = OAuthRefreshToken(
            token_hash=new_refresh_hash,
            client_id=refresh_obj.client_id,
            user_id=user.id,
            scope=effective_scope,
            family_id=refresh_obj.family_id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            revoked=False,
        )
        db.add(new_refresh_record)
        await db.commit()

        return TokenResponse(
            access_token=access_tok,
            token_type="Bearer",
            expires_in=expires_in,
            refresh_token=new_raw_refresh_token,
            scope=effective_scope,
        )

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported grant_type: {grant_type}")


# --- Token Revocation (RFC 7009) ---

@router.post("/oauth/revoke")
async def oauth_revoke(
    token: str = Form(...),
    token_type_hint: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """RFC 7009 Token Revocation endpoint."""
    token_hash_val = hash_token(token)
    result = await db.execute(
        select(OAuthRefreshToken).where(OAuthRefreshToken.token_hash == token_hash_val)
    )
    refresh_obj = result.scalar_one_or_none()
    if refresh_obj:
        refresh_obj.revoked = True
        await db.commit()

    return {"status": "revoked"}


# --- Userinfo Endpoint (OIDC) ---

@router.get("/oauth/userinfo")
async def oauth_userinfo(
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """OpenID Connect Userinfo endpoint."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid Bearer token")

    token = authorization[7:]
    payload = decode_oauth_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token claims")

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id_str)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return {
        "sub": str(user.id),
        "email": user.email,
        "name": user.name or user.email.split("@")[0],
        "picture": user.image,
        "email_verified": True,
    }

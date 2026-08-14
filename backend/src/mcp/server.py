from __future__ import annotations

import json
import uuid
from typing import Any, Callable

from mcp.server.mcpserver import Context, MCPServer
from sqlalchemy import select
from starlette.applications import Starlette
from starlette.datastructures import Headers
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send
from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.core.oauth import decode_oauth_token
from src.mcp.context import reset_current_mcp_user, set_current_mcp_user
from src.mcp.tools.editor import (
    edit_resume_section_handler,
    get_resume_json_handler,
    preview_resume_handler,
    save_resume_edits_handler,
)
from src.mcp.tools.generation import (
    download_resume_handler,
    generate_resume_handler,
    get_generation_status_handler,
)
from src.mcp.tools.profile import (
    add_education_handler,
    add_experience_handler,
    add_extracurricular_handler,
    add_project_handler,
    delete_education_handler,
    delete_experience_handler,
    delete_extracurricular_handler,
    delete_project_handler,
    get_profile_handler,
    list_data_summary_handler,
    update_education_handler,
    update_experience_handler,
    update_extracurricular_handler,
    update_profile_handler,
    update_project_handler,
)
from src.mcp.tools.readiness import check_readiness_handler, list_templates_handler
from src.models.user import User

# Initialize FastMCP / MCPServer
mcp_server = MCPServer(
    name="Resumer MCP Server",
    instructions=(
        "Resumer is an AI-powered resume engine that tailors single-page, ATS-optimized resumes "
        "from candidate profiles. When the user asks to create or generate a resume, use generate_resume. "
        "By default, generate_resume waits for pipeline execution (~15-25 seconds) and returns the completed "
        "resume details including the presigned PDF download URL. You MUST present the final PDF download URL "
        "and a concise summary of the tailored resume directly to the user in your response. "
        "Do not end your response without providing the download link once generation finishes."
    ),
)


# ── Profile & Data Tools ──────────────────────────────────────────────────────

@mcp_server.tool()
async def get_profile() -> dict[str, Any]:
    """Retrieve user's complete profile including contact info, projects, experiences, education, and extracurriculars."""
    return await get_profile_handler()


@mcp_server.tool()
async def list_data_summary() -> dict[str, Any]:
    """Get a concise summary of all stored profile data: counts per section, completeness percentage, and specific gaps."""
    return await list_data_summary_handler()


@mcp_server.tool()
async def update_profile(
    full_name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    location: str | None = None,
    linkedin_url: str | None = None,
    github_url: str | None = None,
    portfolio_url: str | None = None,
    subtitle: str | None = None,
    summary: str | None = None,
    skills: list[str] | None = None,
) -> dict[str, Any]:
    """Update profile contact details, subtitle, summary, and skills."""
    return await update_profile_handler(
        full_name=full_name,
        email=email,
        phone=phone,
        location=location,
        linkedin_url=linkedin_url,
        github_url=github_url,
        portfolio_url=portfolio_url,
        subtitle=subtitle,
        summary=summary,
        skills=skills,
    )


@mcp_server.tool()
async def add_project(
    name: str,
    description: str | None = None,
    technologies: list[str] | None = None,
    github_url: str | None = None,
    live_url: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Add a new software project to the user's profile."""
    return await add_project_handler(
        name=name,
        description=description,
        technologies=technologies,
        github_url=github_url,
        live_url=live_url,
        start_date=start_date,
        end_date=end_date,
        bullet_points=bullet_points,
    )


@mcp_server.tool()
async def update_project(
    project_id: str,
    name: str | None = None,
    description: str | None = None,
    technologies: list[str] | None = None,
    github_url: str | None = None,
    live_url: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Update an existing project in the user's profile."""
    return await update_project_handler(
        project_id=project_id,
        name=name,
        description=description,
        technologies=technologies,
        github_url=github_url,
        live_url=live_url,
        start_date=start_date,
        end_date=end_date,
        bullet_points=bullet_points,
    )


@mcp_server.tool()
async def delete_project(project_id: str) -> dict[str, Any]:
    """Remove a project from the user's profile."""
    return await delete_project_handler(project_id=project_id)


@mcp_server.tool()
async def add_experience(
    role: str,
    organization: str,
    location: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Add a work experience entry to the user's profile."""
    return await add_experience_handler(
        role=role,
        organization=organization,
        location=location,
        start_date=start_date,
        end_date=end_date,
        bullet_points=bullet_points,
    )


@mcp_server.tool()
async def update_experience(
    experience_id: str,
    role: str | None = None,
    organization: str | None = None,
    location: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Update an existing work experience entry."""
    return await update_experience_handler(
        experience_id=experience_id,
        role=role,
        organization=organization,
        location=location,
        start_date=start_date,
        end_date=end_date,
        bullet_points=bullet_points,
    )


@mcp_server.tool()
async def delete_experience(experience_id: str) -> dict[str, Any]:
    """Remove a work experience entry from the user's profile."""
    return await delete_experience_handler(experience_id=experience_id)


@mcp_server.tool()
async def add_education(
    degree: str,
    institution: str,
    location: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    gpa: str | None = None,
    coursework: list[str] | None = None,
) -> dict[str, Any]:
    """Add an education entry to the user's profile."""
    return await add_education_handler(
        degree=degree,
        institution=institution,
        location=location,
        start_date=start_date,
        end_date=end_date,
        gpa=gpa,
        coursework=coursework,
    )


@mcp_server.tool()
async def update_education(
    education_id: str,
    degree: str | None = None,
    institution: str | None = None,
    location: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    gpa: str | None = None,
    coursework: list[str] | None = None,
) -> dict[str, Any]:
    """Update an existing education entry."""
    return await update_education_handler(
        education_id=education_id,
        degree=degree,
        institution=institution,
        location=location,
        start_date=start_date,
        end_date=end_date,
        gpa=gpa,
        coursework=coursework,
    )


@mcp_server.tool()
async def delete_education(education_id: str) -> dict[str, Any]:
    """Remove an education entry from the user's profile."""
    return await delete_education_handler(education_id=education_id)


@mcp_server.tool()
async def add_extracurricular(
    title: str,
    organization: str | None = None,
    description: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Add an extracurricular entry to the user's profile."""
    return await add_extracurricular_handler(
        title=title,
        organization=organization,
        description=description,
        start_date=start_date,
        end_date=end_date,
        bullet_points=bullet_points,
    )


@mcp_server.tool()
async def update_extracurricular(
    extracurricular_id: str,
    title: str | None = None,
    organization: str | None = None,
    description: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Update an existing extracurricular entry."""
    return await update_extracurricular_handler(
        extracurricular_id=extracurricular_id,
        title=title,
        organization=organization,
        description=description,
        start_date=start_date,
        end_date=end_date,
        bullet_points=bullet_points,
    )


@mcp_server.tool()
async def delete_extracurricular(extracurricular_id: str) -> dict[str, Any]:
    """Remove an extracurricular entry from the user's profile."""
    return await delete_extracurricular_handler(extracurricular_id=extracurricular_id)


# ── Readiness & Gap Detection Tools ──────────────────────────────────────────

@mcp_server.tool()
async def list_templates() -> dict[str, Any]:
    """Returns available resume templates from TemplateRegistryService with default and allowed content splits."""
    return await list_templates_handler()


@mcp_server.tool()
async def check_readiness(
    template_id: str = "personal-classic",
    content_split: dict[str, int] | None = None,
    job_description: str | None = None,
) -> dict[str, Any]:
    """Check if the user's profile has enough data to generate a resume for a given template and content split.
    If blocked, returns explicit AI steering directives and clarifying questions to ask the user.
    """
    return await check_readiness_handler(
        template_id=template_id,
        content_split=content_split,
        job_description=job_description,
    )


# ── Resume Generation & Lifecycle Tools ───────────────────────────────────────

@mcp_server.tool()
async def generate_resume(
    job_description: str,
    template_id: str = "personal-classic",
    job_title: str | None = None,
    company: str | None = None,
    content_split: dict[str, int] | None = None,
    instructions: str | None = None,
    wait_for_completion: bool = True,
    ctx: Context = None,
) -> dict[str, Any]:
    """Generate a complete, ATS-optimized, tailored single-page resume for a job description.

    By default, this tool waits for the generation pipeline to complete (~15-25 seconds) and directly returns
    the completed status with the presigned PDF download URL and tailored metadata in the same turn.
    You MUST provide the final PDF download URL and a brief summary of the tailored resume to the user.
    """
    return await generate_resume_handler(
        job_description=job_description,
        template_id=template_id,
        job_title=job_title,
        company=company,
        content_split=content_split,
        instructions=instructions,
        wait_for_completion=wait_for_completion,
        ctx=ctx,
    )


@mcp_server.tool()
async def get_generation_status(
    generation_id: str,
    wait_for_completion: bool = True,
) -> dict[str, Any]:
    """Check progress, logs, and results of a resume generation run.

    When wait_for_completion is True (default), it waits for the generation to finish and returns
    the presigned PDF download URL as soon as the resume is ready.
    """
    return await get_generation_status_handler(
        generation_id=generation_id,
        wait_for_completion=wait_for_completion,
    )


@mcp_server.tool()
async def download_resume(generation_id: str) -> dict[str, Any]:
    """Get presigned PDF download URL for a completed resume generation."""
    return await download_resume_handler(generation_id=generation_id)


# ── Surgical Editing & Preview Tools ──────────────────────────────────────────

@mcp_server.tool()
async def get_resume_json(
    generation_id: str,
    section: str | None = None,
) -> dict[str, Any]:
    """Retrieve the full tailored resume JSON or specific section for a completed generation."""
    return await get_resume_json_handler(
        generation_id=generation_id,
        section=section,
    )


@mcp_server.tool()
async def edit_resume_section(
    generation_id: str,
    path: str,
    operation: str = "set",
    value: Any = None,
    expected_revision: int | None = None,
) -> dict[str, Any]:
    """Edit a specific part of a completed resume's tailored JSON without full regeneration. Supports surgical updates (set, append, remove)."""
    return await edit_resume_section_handler(
        generation_id=generation_id,
        path=path,
        operation=operation,
        value=value,
        expected_revision=expected_revision,
    )


@mcp_server.tool()
async def preview_resume(generation_id: str) -> dict[str, Any]:
    """Trigger Jinja/HTML re-render preview for a generated resume and check page overflow."""
    return await preview_resume_handler(generation_id=generation_id)


@mcp_server.tool()
async def save_resume_edits(
    generation_id: str,
    expected_revision: int,
) -> dict[str, Any]:
    """Persist edits, re-render WeasyPrint PDF, and update R2 storage."""
    return await save_resume_edits_handler(
        generation_id=generation_id,
        expected_revision=expected_revision,
    )


# ── ASGI Auth Wrapper Middleware ──────────────────────────────────────────────

class MCPAuthMiddleware:
    """ASGI Middleware to authenticate incoming Remote MCP (Streamable HTTP / SSE) requests."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        auth_header = headers.get("authorization")
        query_string = scope.get("query_string", b"").decode("utf-8")

        token: str | None = None
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
        elif "token=" in query_string:
            from urllib.parse import parse_qs
            parsed = parse_qs(query_string)
            token = parsed.get("token", [None])[0]

        if not token:
            response = Response(
                content=json.dumps({"error": "Unauthorized: Missing Bearer token in Authorization header."}),
                status_code=401,
                media_type="application/json",
                headers={
                    "WWW-Authenticate": 'Bearer realm="Resumer", authorization_uri="/oauth/authorize"',
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
            )
            await response(scope, receive, send)
            return

        # Validate token
        payload = decode_oauth_token(token)
        if not payload:
            from jose import jwt
            try:
                payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
            except Exception:
                payload = None

        if not payload:
            response = Response(
                content=json.dumps({"error": "Unauthorized: Invalid or expired Bearer token."}),
                status_code=401,
                media_type="application/json",
                headers={
                    "WWW-Authenticate": 'Bearer error="invalid_token"',
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
            )
            await response(scope, receive, send)
            return

        email = payload.get("email")
        sub = payload.get("sub")

        # Resolve user in database
        async with AsyncSessionLocal() as db:
            user: User | None = None
            if sub:
                try:
                    user_uuid = uuid.UUID(sub)
                    res = await db.execute(select(User).where(User.id == user_uuid))
                    user = res.scalar_one_or_none()
                except ValueError:
                    pass

            if not user and email:
                res = await db.execute(select(User).where(User.email == email))
                user = res.scalar_one_or_none()

            if not user and email:
                # Auto-provision user on verified token
                user = User(
                    email=email,
                    name=payload.get("name") or email.split("@")[0].capitalize(),
                    image=payload.get("picture"),
                    provider=payload.get("provider", "oauth-mcp"),
                )
                db.add(user)
                await db.commit()
                await db.refresh(user)

        if not user:
            response = JSONResponse(
                status_code=401,
                content={"error": "User resolution failed."},
            )
            await response(scope, receive, send)
            return

        # Set user in contextvar for tool invocations
        token_ctx = set_current_mcp_user(user)
        try:
            await self.app(scope, receive, send)
        finally:
            reset_current_mcp_user(token_ctx)


from mcp.server.transport_security import TransportSecuritySettings


def get_mcp_streamable_app() -> ASGIApp:
    """Return Streamable HTTP ASGI app wrapped with MCP authentication."""
    sec = TransportSecuritySettings(enable_dns_rebinding_protection=False)
    return MCPAuthMiddleware(mcp_server.streamable_http_app(transport_security=sec, json_response=True, stateless_http=True))

def get_mcp_sse_app() -> ASGIApp:
    """Return SSE ASGI app wrapped with MCP authentication."""
    sec = TransportSecuritySettings(enable_dns_rebinding_protection=False)
    return MCPAuthMiddleware(mcp_server.sse_app(transport_security=sec))

def get_mcp_app() -> ASGIApp:
    """Return combined Streamable HTTP and SSE ASGI app wrapped with MCP authentication."""
    sec = TransportSecuritySettings(enable_dns_rebinding_protection=False)
    streamable = mcp_server.streamable_http_app(transport_security=sec, json_response=True, stateless_http=True)
    sse = mcp_server.sse_app(transport_security=sec)
    combined_routes = list(streamable.routes) + list(sse.routes)
    return MCPAuthMiddleware(Starlette(routes=combined_routes))

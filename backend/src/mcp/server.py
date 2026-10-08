from __future__ import annotations

import json
import uuid
from typing import Any, Callable

from mcp.server.mcpserver import Context, MCPServer
from mcp.types import ToolAnnotations
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
    detect_orphans_handler,
    edit_resume_section_handler,
    get_resume_json_handler,
    preview_resume_handler,
    render_resume_handler,
    save_resume_edits_handler,
)
from src.mcp.tools.generation import (
    download_resume_handler,
    generate_resume_handler,
    get_generation_status_handler,
    set_generation_defaults_handler,
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
        "Resumer generates single-page, ATS-optimized resumes "
        "from user profile facts and job descriptions.\n\n"
        "## ARCHITECTURAL CONCEPTS\n"
        "1. Master Profile vs Tailored Generation:\n"
        "   - The user's Profile (`get_profile`, `add_project`, `add_experience`, etc.) is their database of historical career facts.\n"
        "   - A Generation (`generate_resume`, `get_resume_json`, `render_resume`) is an isolated, job-tailored resume artifact for a specific role and company.\n"
        "   - If a user asks to add or edit a project in their career profile, use `add_project` or `update_project`. If they ask to add, remove, or change a project in an existing resume, fetch and edit `resume_json` on that `generation_id`.\n\n"
        "2. Structured `resume_json` Data Model:\n"
        "   {\n"
        "     \"summary\": \"Concise 2-3 sentence professional summary (~30-40 words).\",\n"
        "     \"skills\": {\n"
        "       \"Languages\": [\"Python\", \"TypeScript\", \"SQL\"],\n"
        "       \"Frameworks & Tools\": [\"FastAPI\", \"Next.js\", \"Docker\", \"PostgreSQL\"]\n"
        "     },\n"
        "     \"experiences\": [\n"
        "       {\n"
        "         \"role\": \"Senior Software Engineer\",\n"
        "         \"organization\": \"Company Name\",\n"
        "         \"location\": \"City, ST or Remote\",\n"
        "         \"start_date\": \"Jan 2022\",\n"
        "         \"end_date\": \"Present\",\n"
        "         \"bullet_points\": [\n"
        "           \"Action verb + quantifiable impact + tech stack with **bold** metrics (e.g. reduced latency by **35%** using **Redis**).\"\n"
        "         ]\n"
        "       }\n"
        "     ],\n"
        "     \"projects\": [\n"
        "       {\n"
        "         \"name\": \"Project Name\",\n"
        "         \"technologies\": [\"Python\", \"React\", \"PostgreSQL\"],\n"
        "         \"description\": \"Brief 1-line architecture overview.\",\n"
        "         \"bullet_points\": [\n"
        "           \"Engineered high-throughput event consumer with **Kafka** and **FastAPI**, handling **10k req/s**.\"\n"
        "         ]\n"
        "       }\n"
        "     ],\n"
        "     \"education\": [\n"
        "       {\n"
        "         \"degree\": \"B.S. in Computer Science\",\n"
        "         \"institution\": \"University Name\",\n"
        "         \"location\": \"City, ST\",\n"
        "         \"start_date\": \"2018\",\n"
        "         \"end_date\": \"2022\",\n"
        "         \"gpa\": \"3.85\",\n"
        "         \"coursework\": [\"Distributed Systems\", \"Algorithms\"]\n"
        "       }\n"
        "     ],\n"
        "     \"extracurriculars\": [\n"
        "       {\n"
        "         \"title\": \"Open Source Contributor\",\n"
        "         \"organization\": \"Apache Software Foundation\",\n"
        "         \"description\": \"Maintained core data connector libraries with **500+** GitHub stars.\"\n"
        "       }\n"
        "     ]\n"
        "   }\n\n"
        "## WORKFLOW PROTOCOLS\n\n"
        "### 1. Generating a New Resume:\n"
        "- Call `check_readiness(template_id=\"personal-classic\", job_description=...)` to identify profile gaps.\n"
        "- If readiness returns missing sections, ask the user or add missing data via profile tools.\n"
        "- Call `generate_resume(job_description=..., template_id=\"personal-classic\", company=..., job_title=...)`.\n"
        "- By default `generate_resume` waits for pipeline completion (~15-25s) and returns the completed resume JSON and PDF download link.\n"
        "- Output the download link in Markdown: `[Download <Company> <Role> Resume (PDF)](download_url)` along with a concise 3-4 bullet summary of how the resume was tailored.\n\n"
        "### 2. Modifying an Existing Resume:\n"
        "When the user asks to add, remove, or tweak projects, experience, or bullet points on a tailored resume:\n"
        "- Step 1: Call `get_resume_json(generation_id=...)` to retrieve the current tailored resume structure.\n"
        "- Step 2: Modify the target section or projects/experiences in the dictionary.\n"
        "- Step 3: Call `detect_orphans(generation_id=..., resume_json=...)` to check for layout issues or page overflow.\n"
        "  * If orphans or overflows are reported, refine the bullet text to match the returned character targets.\n"
        "- Step 4: Call `render_resume(generation_id=..., resume_json=...)` to compile the final PDF, update storage, and get the new download link.\n"
        "- Present the updated Markdown PDF download link to the user.\n"
    ),
)

READ_ONLY_ANNOTATIONS = ToolAnnotations(
    read_only_hint=True,
    destructive_hint=False,
    open_world_hint=False,
)
MUTATING_ANNOTATIONS = ToolAnnotations(
    read_only_hint=False,
    destructive_hint=False,
    open_world_hint=False,
)
DESTRUCTIVE_ANNOTATIONS = ToolAnnotations(
    read_only_hint=False,
    destructive_hint=True,
    open_world_hint=False,
)


async def _safe_tool_call(coro: Any) -> dict[str, Any]:
    """Execute a tool handler coroutine, catching authentication and authorization exceptions gracefully."""
    try:
        return await coro
    except PermissionError as e:
        return {
            "success": False,
            "error": str(e),
            "hint": "Your Resumer session has expired. Please reconnect the connector in ChatGPT to continue.",
        }


# ── Profile & Data Tools ──────────────────────────────────────────────────────

@mcp_server.tool(annotations=READ_ONLY_ANNOTATIONS)
async def get_profile() -> dict[str, Any]:
    """Retrieve the user's complete profile including contact info, projects, experiences, education, and extracurriculars."""
    return await _safe_tool_call(get_profile_handler())


@mcp_server.tool(annotations=READ_ONLY_ANNOTATIONS)
async def list_data_summary() -> dict[str, Any]:
    """Get a summary of stored profile data: counts per section, completeness percentage, and gaps."""
    return await _safe_tool_call(list_data_summary_handler())


@mcp_server.tool(annotations=MUTATING_ANNOTATIONS)
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
    return await _safe_tool_call(
        update_profile_handler(
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
    )


@mcp_server.tool(annotations=MUTATING_ANNOTATIONS)
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
    """Add a new project to the user's profile database."""
    return await _safe_tool_call(
        add_project_handler(
            name=name,
            description=description,
            technologies=technologies,
            github_url=github_url,
            live_url=live_url,
            start_date=start_date,
            end_date=end_date,
            bullet_points=bullet_points,
        )
    )


@mcp_server.tool(annotations=MUTATING_ANNOTATIONS)
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
    """Update an existing project in the user's profile database by project_id."""
    return await _safe_tool_call(
        update_project_handler(
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
    )


@mcp_server.tool(annotations=DESTRUCTIVE_ANNOTATIONS)
async def delete_project(project_id: str) -> dict[str, Any]:
    """Remove a project from the user's profile database by project_id."""
    return await _safe_tool_call(delete_project_handler(project_id=project_id))


@mcp_server.tool(annotations=MUTATING_ANNOTATIONS)
async def add_experience(
    role: str,
    organization: str,
    location: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Add a work experience entry to the user's profile database."""
    return await _safe_tool_call(
        add_experience_handler(
            role=role,
            organization=organization,
            location=location,
            start_date=start_date,
            end_date=end_date,
            bullet_points=bullet_points,
        )
    )


@mcp_server.tool(annotations=MUTATING_ANNOTATIONS)
async def update_experience(
    experience_id: str,
    role: str | None = None,
    organization: str | None = None,
    location: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Update an existing work experience entry in the user's profile database."""
    return await _safe_tool_call(
        update_experience_handler(
            experience_id=experience_id,
            role=role,
            organization=organization,
            location=location,
            start_date=start_date,
            end_date=end_date,
            bullet_points=bullet_points,
        )
    )


@mcp_server.tool(annotations=DESTRUCTIVE_ANNOTATIONS)
async def delete_experience(experience_id: str) -> dict[str, Any]:
    """Remove a work experience entry from the user's profile database."""
    return await _safe_tool_call(delete_experience_handler(experience_id=experience_id))


@mcp_server.tool(annotations=MUTATING_ANNOTATIONS)
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
    return await _safe_tool_call(
        add_education_handler(
            degree=degree,
            institution=institution,
            location=location,
            start_date=start_date,
            end_date=end_date,
            gpa=gpa,
            coursework=coursework,
        )
    )


@mcp_server.tool(annotations=MUTATING_ANNOTATIONS)
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
    return await _safe_tool_call(
        update_education_handler(
            education_id=education_id,
            degree=degree,
            institution=institution,
            location=location,
            start_date=start_date,
            end_date=end_date,
            gpa=gpa,
            coursework=coursework,
        )
    )


@mcp_server.tool(annotations=DESTRUCTIVE_ANNOTATIONS)
async def delete_education(education_id: str) -> dict[str, Any]:
    """Remove an education entry from the user's profile."""
    return await _safe_tool_call(delete_education_handler(education_id=education_id))


@mcp_server.tool(annotations=MUTATING_ANNOTATIONS)
async def add_extracurricular(
    title: str,
    organization: str | None = None,
    description: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Add an extracurricular activity entry to the user's profile."""
    return await _safe_tool_call(
        add_extracurricular_handler(
            title=title,
            organization=organization,
            description=description,
            start_date=start_date,
            end_date=end_date,
            bullet_points=bullet_points,
        )
    )


@mcp_server.tool(annotations=MUTATING_ANNOTATIONS)
async def update_extracurricular(
    extracurricular_id: str,
    title: str | None = None,
    organization: str | None = None,
    description: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Update an existing extracurricular activity entry in the user's profile."""
    return await _safe_tool_call(
        update_extracurricular_handler(
            extracurricular_id=extracurricular_id,
            title=title,
            organization=organization,
            description=description,
            start_date=start_date,
            end_date=end_date,
            bullet_points=bullet_points,
        )
    )


@mcp_server.tool(annotations=DESTRUCTIVE_ANNOTATIONS)
async def delete_extracurricular(extracurricular_id: str) -> dict[str, Any]:
    """Remove an extracurricular activity entry from the user's profile."""
    return await _safe_tool_call(delete_extracurricular_handler(extracurricular_id=extracurricular_id))


# ── Readiness & Gap Detection Tools ──────────────────────────────────────────

@mcp_server.tool(annotations=READ_ONLY_ANNOTATIONS)
async def list_templates() -> dict[str, Any]:
    """List available resume templates with default and allowed content splits."""
    return await _safe_tool_call(list_templates_handler())


@mcp_server.tool(annotations=READ_ONLY_ANNOTATIONS)
async def check_readiness(
    template_id: str = "personal-classic",
    content_split: dict[str, int] | None = None,
    job_description: str | None = None,
) -> dict[str, Any]:
    """Check if profile data is sufficient to generate a resume for a given template and content split."""
    return await _safe_tool_call(
        check_readiness_handler(
            template_id=template_id,
            content_split=content_split,
            job_description=job_description,
        )
    )

@mcp_server.tool(annotations=MUTATING_ANNOTATIONS)
async def generate_resume(
    job_description: str,
    template_id: str = "personal-classic",
    job_title: str | None = None,
    company: str | None = None,
    content_split: dict[str, int] | None = None,
    instructions: str | None = None,
    creativity_mode: str | None = None,
    wait_for_completion: bool = True,
    ctx: Context = None,
) -> dict[str, Any]:
    """Generate a tailored single-page resume for a job description.

    Waits for generation to complete and returns status, a PDF download URL, and structured resume JSON.
    creativity_mode ("proper" | "larp" | "super_larp") applies to this run only; omit to use stored default.
    """
    return await _safe_tool_call(
        generate_resume_handler(
            job_description=job_description,
            template_id=template_id,
            job_title=job_title,
            company=company,
            content_split=content_split,
            instructions=instructions,
            creativity_mode=creativity_mode,
            wait_for_completion=wait_for_completion,
            ctx=ctx,
        )
    )


@mcp_server.tool(annotations=MUTATING_ANNOTATIONS)
async def set_generation_defaults(
    creativity_mode: str | None = None,
    projects: int | None = None,
    experience: int | None = None,
) -> dict[str, Any]:
    """Get or change the user's stored generation defaults, including creativity mode and section counts."""
    return await _safe_tool_call(
        set_generation_defaults_handler(
            creativity_mode=creativity_mode,
            projects=projects,
            experience=experience,
        )
    )


@mcp_server.tool(annotations=READ_ONLY_ANNOTATIONS)
async def get_generation_status(
    generation_id: str,
    wait_for_completion: bool = True,
) -> dict[str, Any]:
    """Check progress, logs, and results of a resume generation run."""
    return await _safe_tool_call(
        get_generation_status_handler(
            generation_id=generation_id,
            wait_for_completion=wait_for_completion,
        )
    )


@mcp_server.tool(annotations=READ_ONLY_ANNOTATIONS)
async def download_resume(generation_id: str) -> dict[str, Any]:
    """Get the PDF download URL and resume JSON for a completed resume generation."""
    return await _safe_tool_call(download_resume_handler(generation_id=generation_id))


# ── Surgical Editing & Preview Tools ──────────────────────────────────────────

@mcp_server.tool(annotations=READ_ONLY_ANNOTATIONS)
async def get_resume_json(
    generation_id: str,
    section: str | None = None,
) -> dict[str, Any]:
    """Retrieve the tailored resume JSON or a specific section for a completed generation."""
    return await _safe_tool_call(
        get_resume_json_handler(
            generation_id=generation_id,
            section=section,
        )
    )


@mcp_server.tool(annotations=MUTATING_ANNOTATIONS)
async def edit_resume_section(
    generation_id: str,
    path: str,
    operation: str = "set",
    value: Any = None,
    expected_revision: int | None = None,
) -> dict[str, Any]:
    """Edit a specific part of a completed resume's tailored JSON without full regeneration."""
    return await _safe_tool_call(
        edit_resume_section_handler(
            generation_id=generation_id,
            path=path,
            operation=operation,
            value=value,
            expected_revision=expected_revision,
        )
    )


@mcp_server.tool(annotations=READ_ONLY_ANNOTATIONS)
async def preview_resume(generation_id: str) -> dict[str, Any]:
    """Preview resume HTML rendering and check whether content fits the target page count."""
    return await _safe_tool_call(preview_resume_handler(generation_id=generation_id))


@mcp_server.tool(annotations=READ_ONLY_ANNOTATIONS)
async def detect_orphans(
    generation_id: str,
    resume_json: dict[str, Any] | None = None,
    font_size: float | None = None,
) -> dict[str, Any]:
    """Inspect layout line boxes in a tailored resume to detect orphan lines or multi-page overflow."""
    return await _safe_tool_call(
        detect_orphans_handler(
            generation_id=generation_id,
            resume_json=resume_json,
            font_size=font_size,
        )
    )


@mcp_server.tool(annotations=MUTATING_ANNOTATIONS)
async def render_resume(
    generation_id: str,
    resume_json: dict[str, Any] | None = None,
    font_size: float | None = None,
    expected_revision: int | None = None,
) -> dict[str, Any]:
    """Compile modified resume JSON into PDF format with typography fitting and update file storage."""
    return await _safe_tool_call(
        render_resume_handler(
            generation_id=generation_id,
            resume_json=resume_json,
            font_size=font_size,
            expected_revision=expected_revision,
        )
    )


@mcp_server.tool(annotations=MUTATING_ANNOTATIONS)
async def save_resume_edits(
    generation_id: str,
    expected_revision: int,
) -> dict[str, Any]:
    """Persist staged resume edits, re-render PDF, and update file storage."""
    return await _safe_tool_call(
        save_resume_edits_handler(
            generation_id=generation_id,
            expected_revision=expected_revision,
        )
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

        # Bypass MCP authentication for OAuth and public discovery endpoints
        path = scope.get("path", "")
        if (
            path.startswith("/oauth/")
            or path.startswith("/.well-known/")
            or path.startswith("/docs")
            or path.startswith("/openapi.json")
            or path == "/healthz"
            or path == "/system/health"
        ):
            await self.app(scope, receive, send)
            return

        # Always permit CORS OPTIONS preflight
        if scope.get("method") == "OPTIONS":
            response = Response(
                status_code=204,
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "*",
                },
            )
            await response(scope, receive, send)
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
            proto = headers.get("x-forwarded-proto")
            host = headers.get("x-forwarded-host") or headers.get("host")
            if proto:
                proto = proto.split(",")[0].strip().lower()
            if host:
                host = host.split(",")[0].strip()
                is_local = any(h in host.lower() for h in ["localhost", "127.0.0.1", "0.0.0.0", "testserver"])
                scheme = "http" if (is_local and (proto == "http" or not proto)) else "https"
                base_url = f"{scheme}://{host}".rstrip("/")
            else:
                base_url = getattr(settings, "BACKEND_URL", "").strip().rstrip("/") or "https://resumer-backend.aryansingh.space"

            response = Response(
                content=json.dumps({
                    "error": "Unauthorized: Missing Bearer token in Authorization header.",
                    "message": "Your Resumer session is not authenticated. Please connect or reconnect the Resumer connector in ChatGPT to continue.",
                    "hint": "Connect or reconnect your Resumer account via the ChatGPT connector settings.",
                }),
                status_code=401,
                media_type="application/json",
                headers={
                    "WWW-Authenticate": f'Bearer realm="Resumer", authorization_uri="{base_url}/oauth/authorize", resource_metadata="{base_url}/.well-known/oauth-protected-resource"',
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
                content=json.dumps({
                    "error": "Unauthorized: Invalid or expired Bearer token.",
                    "message": "Your Resumer session has expired. Reconnect the connector to continue.",
                    "hint": "Your Resumer session has expired. Reconnect the connector to continue.",
                }),
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
                content={
                    "error": "Unauthorized: User resolution failed.",
                    "message": "Could not identify your Resumer account from this session.",
                    "hint": "Please reconnect the connector in ChatGPT to refresh your account details.",
                },
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

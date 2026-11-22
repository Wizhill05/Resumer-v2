"""Call a local Resumer MCP server or mint a local development token."""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def mint_token(email: str) -> None:
    from sqlalchemy import select

    from scripts.seed_own_model_fixtures import require_local_database
    from src.core.config import settings

    require_local_database(settings.DATABASE_URL)
    from src.core.database import AsyncSessionLocal
    from src.core.oauth import DEFAULT_SCOPES, create_oauth_access_token
    from src.models.user import User

    async with AsyncSessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == email.strip().lower()))
        if user is None or user.is_pending_deletion:
            raise SystemExit("Local user not found.")
        token, _ = create_oauth_access_token(user.id, user.email, " ".join(DEFAULT_SCOPES), "local-mcp-cli")
    print(token)


async def call_tool(url: str, token_file: Path, tool: str, raw_arguments: str) -> int:
    import httpx2
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    if raw_arguments.startswith("@"):
        raw_arguments = Path(raw_arguments[1:]).read_text()
    arguments = json.loads(raw_arguments)
    if not isinstance(arguments, dict):
        raise SystemExit("Tool arguments must be a JSON object.")
    token = token_file.read_text().strip()
    async with httpx2.AsyncClient(headers={"Authorization": f"Bearer {token}"}, timeout=180, trust_env=False) as http:
        async with streamable_http_client(url, http_client=http) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool, arguments)
    output = result.structured_content
    if output is None:
        output = [content.model_dump(mode="json") for content in result.content]
        if len(result.content) == 1 and result.content[0].type == "text":
            try:
                output = json.loads(result.content[0].text)
            except json.JSONDecodeError:
                pass
    print(json.dumps(output, indent=2, ensure_ascii=False))
    return int(result.is_error)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000/mcp")
    parser.add_argument("--token-file", type=Path)
    sub = parser.add_subparsers(dest="command", required=True)
    mint = sub.add_parser("mint-token")
    mint.add_argument("--email", required=True)
    call = sub.add_parser("call")
    call.add_argument("tool")
    call.add_argument("arguments", nargs="?", default="{}")
    args = parser.parse_args()
    if args.command == "mint-token":
        asyncio.run(mint_token(args.email))
        return 0
    if args.token_file is None:
        parser.error("--token-file is required for call")
    return asyncio.run(call_tool(args.url, args.token_file, args.tool, args.arguments))


if __name__ == "__main__":
    raise SystemExit(main())

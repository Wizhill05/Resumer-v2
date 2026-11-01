"""Opt-in synthetic speech probes; no database, storage, or production changes.

Run from backend: .venv/bin/python scripts/probe_gemini_audio.py --live
Requires local espeak-ng and ffmpeg. Prints validation only, never credentials,
audio payloads, or provider error bodies. Each format is tested independently.
"""
import argparse
import asyncio
import base64
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from langchain_core.messages import HumanMessage

from src.core.config import settings
from src.services.llm_config import LLMConfigService, TierConfig


def synthetic_recordings(directory):
    source = directory / "speech.wav"
    subprocess.run(["espeak-ng", "-s", "140", "-w", str(source),
                    "The purple elephant lost seven blue umbrellas."], check=True, capture_output=True)
    recordings = {"wav": source.read_bytes()}
    for fmt, codec in [("mp3", "libmp3lame"), ("webm", "libopus"),
                       ("ogg", "libopus"), ("mp4", "aac")]:
        destination = directory / ("speech." + fmt)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source),
                        "-c:a", codec, str(destination)], check=True, capture_output=True)
        recordings[fmt] = destination.read_bytes()
    return recordings


async def probe_route(cfg, keys, recordings):
    if not keys:
        print(cfg.provider_name, cfg.model, "SKIPPED: no configured credentials", flush=True)
        return 1
    failures = 0
    # Bypass the VM's proxy only in this probe, with no application setting changes.
    async with httpx.AsyncClient(timeout=40, trust_env=False, follow_redirects=False) as http:
        llm = LLMConfigService().create_client(cfg, api_key_override=keys[0])
        import openai
        llm.root_async_client = openai.AsyncOpenAI(api_key=keys[0], base_url=cfg.base_url,
                                                 max_retries=0, http_client=http)
        llm.async_client = llm.root_async_client.chat.completions
        for fmt, data in recordings.items():
            message = HumanMessage(content=[
                {"type": "text", "text": "Transcribe this recording verbatim. Return only the transcription."},
                {"type": "input_audio", "input_audio": {
                    "data": base64.b64encode(data).decode(), "format": fmt}},
            ])
            try:
                response = await asyncio.wait_for(llm.ainvoke([message]), 45)
                words = set(re.findall(r"[a-z]+", str(response.content).lower()))
                valid = {"purple", "elephant", "seven", "blue", "umbrellas"} <= words
                failures += int(not valid)
                print(cfg.provider_name, cfg.model, fmt,
                      "TRANSCRIPT_VALID" if valid else "TRANSCRIPT_INVALID", flush=True)
            except Exception as exc:
                failures += 1
                print(cfg.provider_name, cfg.model, fmt, type(exc).__name__,
                      "status", getattr(exc, "status_code", None), flush=True)
    return failures


async def main():
    # This standalone diagnostic opts out of the VM's SOCKS proxy. LangChain
    # constructs a default sync client too, so configuring only http is insufficient.
    for name in ("ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"):
        os.environ.pop(name, None)
    with tempfile.TemporaryDirectory(prefix="resumer-audio-probe-") as temp:
        recordings = synthetic_recordings(Path(temp))
    results = await asyncio.gather(
        probe_route(TierConfig(tier="pro", provider_name="omniroute",
                    base_url=settings.PRO_MODEL_BASE_URL, model=settings.PRO_MODEL_NAME),
                    settings.pro_model_api_keys, recordings),
        probe_route(TierConfig(tier="free", provider_name="openrouter",
                    base_url="https://openrouter.ai/api/v1", model=settings.OPENROUTER_FALLBACK_MODEL),
                    settings.openrouter_api_keys, recordings),
    )
    return int(any(results))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", required=True)
    parser.parse_args()
    raise SystemExit(asyncio.run(main()))

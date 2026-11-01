"""Opt-in live probes with synthetic data. Never loads or modifies database settings.

Run from backend: python scripts/probe_gemini_routes.py --live
Output contains route, model, status, and validation only, never credentials or responses.
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from langchain_core.messages import HumanMessage

from src.core.config import settings
from src.pipeline.nodes import _structured, _validate_selection, invoke_with_fallback
from src.schemas.pipeline import StrictSelectedItems, JobAnalysis, TailoredSummaryAndSkills
from src.services.llm_config import LLMConfigService, TierConfig, llm_config_service


async def main():
    service = LLMConfigService()
    failures = 0
    routes = [
        TierConfig(tier='pro', provider_name='omniroute', base_url=settings.PRO_MODEL_BASE_URL,
                   model=settings.PRO_MODEL_NAME),
        TierConfig(tier='free', provider_name='openrouter', base_url='https://openrouter.ai/api/v1',
                   model=settings.OPENROUTER_FALLBACK_MODEL),
    ]
    probes = [
        (StrictSelectedItems, 'Select exactly one experience and one project, 0-based. Experience 0: Python developer. Project 0: Python API. Job: Python developer.'),
        (JobAnalysis, 'Analyze this synthetic job: Example Co seeks a Junior Python API Developer with SQL and testing skills.'),
        (TailoredSummaryAndSkills, 'Tailor summary and skill categories for this synthetic candidate: Junior Python developer who built a Python API using SQL and pytest. Target job: Junior Python API Developer. Do not invent skills.'),
    ]
    async with httpx.AsyncClient(timeout=40, trust_env=False, follow_redirects=False) as http:
        clients = []
        for cfg in routes:
            pool = settings.pro_model_api_keys if cfg.provider_name == 'omniroute' else settings.openrouter_api_keys
            if not pool:
                print(cfg.provider_name, 'SKIPPED: no configured credentials')
                failures += 1
                continue
            try:
                catalog = await http.get(cfg.base_url.rstrip('/')+'/models', headers={'Authorization': 'Bearer '+pool[0]})
                advertised = {item['id'] for item in catalog.json().get('data', [])}
                if catalog.status_code != 200 or cfg.model not in advertised:
                    print(cfg.provider_name, cfg.model, 'NOT ADVERTISED; skipped')
                    failures += 1
                    continue
                llm = service.create_client(cfg, api_key_override=pool[0])
                # This probe bypasses host proxy variables; application networking remains unchanged.
                llm.http_async_client = http
                import openai
                llm.root_async_client = openai.AsyncOpenAI(api_key=pool[0], base_url=cfg.base_url,
                                                         max_retries=0, http_client=http)
                llm.async_client = llm.root_async_client.chat.completions
                clients.append((cfg, llm))
                for schema, prompt in probes:
                    result = await _structured(llm, schema, cfg.provider_name).ainvoke([HumanMessage(content=prompt)])
                    valid = result['parsed'] is not None and result['parsing_error'] is None
                    if valid and schema is StrictSelectedItems:
                        _validate_selection(result['parsed'], 1, 1, 1, 1)
                    failures += int(not valid)
                    print(cfg.provider_name, cfg.model, schema.__name__, 'VALID' if valid else 'INVALID', flush=True)
            except Exception as exc:
                failures += 1
                print(cfg.provider_name, cfg.model, type(exc).__name__, 'status', getattr(exc, 'status_code', None), flush=True)
        # Exercise invoke_with_fallback using a deliberately unavailable primary and a real OpenRouter client.
        fallback = next((llm for cfg, llm in clients if cfg.provider_name == 'openrouter'), None)
        if fallback is not None:
            from src.core.api_key_pool import ApiKeyUnavailable
            def unavailable(**kwargs):
                raise ApiKeyUnavailable('Synthetic primary outage')
            saved = llm_config_service.get_llm, llm_config_service.get_fallback_llm
            try:
                llm_config_service.get_llm = unavailable
                llm_config_service.get_fallback_llm = lambda **kwargs: fallback
                result = await invoke_with_fallback(lambda llm, p: _structured(llm, StrictSelectedItems, p),
                    [HumanMessage(content=probes[0][1])], is_pro=True,
                    validate_result=lambda value: _validate_selection(value, 1, 1, 1, 1))
                print('synthetic primary outage -> real OpenRouter fallback VALID', flush=True)
            except Exception as exc:
                failures += 1
                print('fallback probe failed', type(exc).__name__, 'status', getattr(exc, 'status_code', None), flush=True)
            finally:
                llm_config_service.get_llm, llm_config_service.get_fallback_llm = saved

    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', required=True, action='store_true', help='Authorize small synthetic API requests')
    parser.parse_args()
    asyncio.run(main())

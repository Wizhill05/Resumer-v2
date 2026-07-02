"""Round-robin API key pool.

Selects one key per pipeline run — all LLM calls within a run share the
same key. Thread-safe: a single atomic counter advances under a lock so
concurrent pipeline tasks each get the next key in sequence.

Usage:
    from src.core.api_key_pool import key_pool
    api_key = key_pool.next()
"""
import itertools
import threading

from src.core.config import settings


class ApiKeyPool:
    def __init__(self, keys: list[str]) -> None:
        cleaned = [k.strip() for k in keys if k.strip()]
        if not cleaned:
            raise RuntimeError(
                "No Google API keys configured. "
                "Set GOOGLE_API_KEYS=key1,key2,... in your environment."
            )
        self._keys = cleaned
        self._cycle = itertools.cycle(cleaned)
        self._lock = threading.Lock()
        self.count = len(cleaned)

    def next(self) -> str:
        """Return the next key in the round-robin sequence. Thread-safe."""
        with self._lock:
            return next(self._cycle)


# Module-level singleton — initialised once at import time.
key_pool = ApiKeyPool(settings.google_api_keys)

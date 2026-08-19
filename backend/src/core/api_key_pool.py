"""Round-robin API key pools.

Two pools: openrouter_pool (primary) and google_pool (fallback).
Each LLM call grabs its own key via pool.next() — no shared key per run.
Thread-safe: atomic counter under lock so concurrent calls each get the
next key in sequence without collision.

Usage:
    from src.core.api_key_pool import openrouter_pool, google_pool
    key = openrouter_pool.next()
"""
import itertools
import threading

from src.core.config import settings


class ApiKeyPool:
    def __init__(self, keys: list[str], name: str) -> None:
        self.name = name
        self._lock = threading.Lock()
        self.reload_keys(keys)

    def reload_keys(self, keys: list[str]) -> None:
        """Update the pool with a new set of keys safely under lock."""
        cleaned = [k.strip() for k in keys if k and k.strip()]
        with self._lock:
            self._keys = cleaned
            self._cycle = itertools.cycle(cleaned) if cleaned else None
            self.count = len(cleaned)

    def next(self) -> str:
        """Return the next key in the round-robin sequence. Thread-safe."""
        with self._lock:
            if self._cycle is None:
                raise RuntimeError(
                    f"No {self.name} API keys configured. "
                    f"Set {self.name.upper().replace(' ', '_')}_API_KEYS=key1,key2,... in your environment or admin settings."
                )
            return next(self._cycle)


# Module-level singletons — initialised once at import time.
openrouter_pool = ApiKeyPool(settings.openrouter_api_keys, "OpenRouter")
google_pool = ApiKeyPool(settings.google_api_keys, "Google")

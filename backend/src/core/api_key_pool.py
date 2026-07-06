"""Round-robin API key pools.

Two pools: cerebras_pool (primary) and google_pool (fallback).
Each LLM call grabs its own key via pool.next() — no shared key per run.
Thread-safe: atomic counter under lock so concurrent calls each get the
next key in sequence without collision.

Usage:
    from src.core.api_key_pool import cerebras_pool, google_pool
    key = cerebras_pool.next()
"""
import itertools
import threading

from src.core.config import settings


class ApiKeyPool:
    def __init__(self, keys: list[str], name: str) -> None:
        cleaned = [k.strip() for k in keys if k.strip()]
        self._keys = cleaned
        self._cycle = itertools.cycle(cleaned) if cleaned else None
        self._lock = threading.Lock()
        self.count = len(cleaned)
        self.name = name

    def next(self) -> str:
        """Return the next key in the round-robin sequence. Thread-safe."""
        with self._lock:
            if self._cycle is None:
                raise RuntimeError(
                    f"No {self.name} API keys configured. "
                    f"Set {self.name.upper().replace(' ', '_')}_API_KEYS=key1,key2,... in your environment."
                )
            return next(self._cycle)


# Module-level singletons — initialised once at import time.
cerebras_pool = ApiKeyPool(settings.cerebras_api_keys, "Cerebras")
google_pool = ApiKeyPool(settings.google_api_keys, "Google")

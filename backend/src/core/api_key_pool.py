"""Round-robin API key pools with temporary 429 failure quarantine.

Pools:
- openrouter_pool (OpenRouter primary/free)
- google_pool (Google fallback / GenAI)
- cerebras_pool (Cerebras fast inference)
- pro_pool (OmniRoute / Pro dedicated keys)

Thread-safe: atomic counter under lock so concurrent calls each get the
next active key in sequence without collision.
"""
import itertools
import threading
import time

from src.core.config import settings


class ApiKeyPool:
    def __init__(self, keys: list[str], name: str) -> None:
        self.name = name
        self._lock = threading.Lock()
        self._quarantined: dict[str, float] = {}  # key -> expire_timestamp
        self.reload_keys(keys)

    def reload_keys(self, keys: list[str]) -> None:
        """Update the pool with a new set of keys safely under lock."""
        cleaned = [k.strip() for k in keys if k and k.strip()]
        with self._lock:
            self._keys = cleaned
            self._cycle = itertools.cycle(cleaned) if cleaned else None
            self.count = len(cleaned)
            self._quarantined.clear()

    def mark_failure(self, key: str, cooldown_seconds: float = 60.0) -> None:
        """Temporarily quarantine a failing or rate-limited key."""
        if not key:
            return
        with self._lock:
            self._quarantined[key] = time.time() + cooldown_seconds

    def next(self) -> str:
        """Return the next active key in the round-robin sequence. Thread-safe."""
        with self._lock:
            if not self._keys or self._cycle is None:
                raise RuntimeError(
                    f"No {self.name} API keys configured. "
                    f"Set {self.name.upper().replace(' ', '_')}_API_KEYS=key1,key2,... in your environment (.env file)."
                )

            now = time.time()
            # Prune expired quarantine records
            self._quarantined = {k: exp for k, exp in self._quarantined.items() if exp > now}

            # Try to find a non-quarantined key within one cycle
            attempts = 0
            total = len(self._keys)
            while attempts < total:
                candidate = next(self._cycle)
                if candidate not in self._quarantined:
                    return candidate
                attempts += 1

            # If all keys are quarantined, fallback to the one with the earliest expiration
            if self._quarantined:
                earliest_key = min(self._quarantined, key=self._quarantined.get)
                return earliest_key

            return next(self._cycle)


# Module-level singletons — initialised once at import time.
openrouter_pool = ApiKeyPool(settings.openrouter_api_keys, "OpenRouter")
google_pool = ApiKeyPool(settings.google_api_keys, "Google")
cerebras_pool = ApiKeyPool(settings.cerebras_api_keys, "Cerebras")
pro_pool = ApiKeyPool(settings.pro_model_api_keys, "Pro / OmniRoute")

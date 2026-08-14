"""Pipeline trigger.

POST /generate calls trigger_pipeline(gen_id) which runs the graph
in-process via a detached asyncio task. On Railway the service process
is always alive (no CPU throttling outside requests), so this is safe
for both local dev and production.
"""
import asyncio

from src.core.config import settings


async def trigger_pipeline(gen_id: str) -> asyncio.Task[None]:
    mode = settings.EXECUTION_MODE
    if mode == "local":
        return _trigger_local(gen_id)
    else:
        raise RuntimeError(f"Unknown EXECUTION_MODE={mode!r}; only 'local' is supported")


def _trigger_local(gen_id: str) -> asyncio.Task[None]:
    """Run in-process via a detached asyncio task. Exceptions are logged via a done-callback."""
    from src.pipeline.job_runner import run_generation

    task = asyncio.create_task(run_generation(gen_id))
    task.add_done_callback(_log_task_exception)
    return task

def _log_task_exception(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc:
        print(f"[executor] pipeline task failed: {exc!r}")

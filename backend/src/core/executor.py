"""Pipeline trigger.

POST /generate calls trigger_pipeline(gen_id) instead of running the graph
inline. In prod this fires a Cloud Run Job execution (CPU allocated for the
full run, independent of the HTTP request). In dev it runs in-process.
"""
import asyncio

from src.core.config import settings


async def trigger_pipeline(gen_id: str) -> None:
    mode = settings.EXECUTION_MODE
    if mode == "cloudrun_job":
        _trigger_cloudrun_job(gen_id)
    elif mode == "local":
        _trigger_local(gen_id)
    else:
        raise RuntimeError(f"Unknown EXECUTION_MODE={mode!r}; use 'local' or 'cloudrun_job'")


def _trigger_local(gen_id: str) -> None:
    """Run in-process. Local machines aren't CPU-throttled, so a detached
    asyncio task completes reliably. Exceptions are logged via a done-callback."""
    from src.pipeline.job_runner import run_generation

    task = asyncio.create_task(run_generation(gen_id))
    task.add_done_callback(_log_task_exception)


def _log_task_exception(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc:
        print(f"[executor] in-process pipeline task failed: {exc!r}")


def _trigger_cloudrun_job(gen_id: str) -> None:
    """Trigger a Cloud Run Job execution with GEN_ID injected as an env override."""
    import requests
    import google.auth
    import google.auth.transport.requests

    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    if not creds.valid:
        creds.refresh(google.auth.transport.requests.Request())

    url = (
        f"https://run.googleapis.com/v2/projects/{settings.GCP_PROJECT_ID}"
        f"/locations/{settings.CLOUD_RUN_JOB_REGION}/jobs/{settings.CLOUD_RUN_JOB_NAME}:run"
    )
    body = {
        "overrides": {
            "container": {
                "env": [{"name": "GEN_ID", "value": gen_id}],
            },
        },
    }
    resp = requests.post(
        url,
        json=body,
        headers={
            "Authorization": f"Bearer {creds.token}",
            "Content-Type": "application/json",
        },
        timeout=20,
    )
    if not resp.ok:
        # Surface a clear error so POST /generate can mark the run failed.
        raise RuntimeError(
            f"Cloud Run Job trigger failed [{resp.status_code}]: {resp.text}"
        )

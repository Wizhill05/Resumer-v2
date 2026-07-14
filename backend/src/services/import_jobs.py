import asyncio
import time
from typing import Dict, Any, Literal, Optional
from pydantic import BaseModel

class ImportJob(BaseModel):
    id: str
    status: Literal["parsing", "extracting", "deduplicating", "completed", "failed"]
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: float

import_jobs: Dict[str, Dict[str, Any]] = {}

async def cleanup_old_jobs():
    while True:
        try:
            await asyncio.sleep(60)
            now = time.time()
            # Delete jobs older than 10 minutes
            to_delete = [
                job_id for job_id, job in import_jobs.items()
                if now - job["created_at"] > 600
            ]
            for job_id in to_delete:
                import_jobs.pop(job_id, None)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[import_jobs_cleanup] error: {e}")

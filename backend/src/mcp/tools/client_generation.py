"""Persistence and render scheduling for client-authored resumes."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from functools import partial
from time import perf_counter
from typing import TYPE_CHECKING, Any

from anyio import CapacityLimiter, to_thread
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.generation import CLIENT_DRAFT_CLAIM_TTL, client_terminal_metadata, is_quota_exempt
from src.core.analytics import capture_generation
from src.core.config import settings
from src.core.file_links import build_resume_file_link
from src.core.storage import StorageService, generation_artifact_keys
from src.mcp.context import account_unavailable, get_current_mcp_user, get_mcp_db
from src.models.generation import Generation
from src.models.user import User
from src.services import rate_limit
from src.services.content_split import save_user_split_preference
from src.services.pdfium import render_thumbnail

if TYPE_CHECKING:
    from src.services.client_draft import FinalizedResume

logger = logging.getLogger(__name__)
_render_slots = CapacityLimiter(2)
_active_submissions: dict[uuid.UUID, asyncio.Task[dict[str, Any]]] = {}
_max_payload_bytes = 64 * 1024
_max_unverified_attempts = 3
_max_publish_failures = 3


def _error(code: str, message: str, *, status: str = "error", **fields: Any) -> dict[str, Any]:
    return {"success": False, "status": status, "error_code": code, "error": message, "message": message, **fields}


def _verification_given_up(metadata: dict, revision: int) -> bool:
    return (
        metadata.get("client_unverified_attempts", 0) >= _max_unverified_attempts
        and revision in metadata.get("client_unverified_revisions", [])
    )


def _draft_state(metadata: dict) -> dict:
    from src.services.client_draft import max_submissions

    used = metadata.get("client_submissions", 0)
    return {
        "client_draft": metadata.get("client_draft"),
        "draft_revision": metadata.get("client_draft_revision", 0),
        "submissions_used": used,
        "submissions_left": max(0, max_submissions() - used),
    }


async def start_client_generation(
    db: AsyncSession, user: User, gen: Generation, client_model: str | None,
    explicit_split: dict[str, int] | None,
) -> dict[str, Any]:
    from src.pipeline.job_runner import _load_initial_state
    from src.services.client_draft import build_client_brief

    state = await _load_initial_state(db, gen)
    if state is None:
        return _error("INSUFFICIENT_PROFILE_DATA", "The profile is no longer available.", status="blocked")

    built = build_client_brief(
        profile=state["profile"],
        experiences=state["experiences"],
        projects=state["projects"],
        education=state["education"],
        extracurriculars=state["extracurriculars"],
        template_manifest=state["template_manifest"],
        content_split=state["content_split"],
        creativity_mode=state["creativity_mode"],
        section_order=state["section_order"],
        job_description=gen.job_description,
        job_title=gen.job_title,
        company=gen.company,
        instructions=gen.instructions,
    )
    if not is_quota_exempt(user):
        try:
            await rate_limit.check_rate_limit(
                db, f"own-model:{user.id}", settings.OWN_MODEL_DAILY_DRAFT_CAP,
                timedelta(hours=24), "Your own-model draft limit has been reached.",
            )
        except HTTPException as exc:
            return _error("OWN_MODEL_LIMIT_REACHED", exc.detail, inference_mode="own_model")

    if explicit_split is not None:
        await save_user_split_preference(db, user.id, explicit_split["projects"], explicit_split["experience"])

    gen.status = "drafting"
    gen.inference_source = "client"
    model_name = "".join(char for char in client_model or "" if char.isprintable()).strip()
    gen.client_model = model_name[:120] or None
    gen.render_metadata = {
        "_analytics": {"distinct_id": user.email.strip().lower(), "source": "mcp-own-model"},
        "client_brief": built["snapshot"],
        "client_submissions": 0,
        "client_draft_revision": 0,
    }
    db.add(gen)
    await db.commit()
    await db.refresh(gen)
    capture_generation(gen, "accepted")
    return {
        "success": True,
        **built["brief"],
        "generation_id": str(gen.id),
        "status": "awaiting_draft",
        "next_tool": "submit_resume_draft",
        "inference_mode": "own_model",
        "user_notice": "Ask to switch back anytime with set_inference_mode('resumer').",
        **_draft_state(gen.render_metadata),
    }


def drafting_status(gen: Generation, include_brief: bool) -> dict[str, Any]:
    metadata = gen.render_metadata or {}
    state = _draft_state(metadata)
    current = state.pop("client_draft")
    response = {
        "success": True,
        "generation_id": str(gen.id),
        "status": "awaiting_draft",
        "inference_mode": "own_model",
        "last_report": metadata.get("client_last_report"),
        "next_tool": "submit_resume_draft",
        **state,
    }
    if include_brief:
        from src.services.client_draft import render_brief

        response.update(render_brief(metadata["client_brief"], generation_id=str(gen.id)))
        response["client_draft"] = current
    return response


async def _get_generation(db: AsyncSession, generation_id: uuid.UUID, user_id: uuid.UUID) -> Generation | None:
    return await db.scalar(
        select(Generation)
        .where(Generation.id == generation_id, Generation.user_id == user_id)
        .with_for_update()
    )


async def _fail_draft(db: AsyncSession, gen: Generation, metadata: dict, code: str, message: str) -> dict:
    gen.status = "failed"
    gen.completed_at = datetime.now(timezone.utc)
    gen.error_message = message
    gen.render_metadata = client_terminal_metadata(metadata)
    await db.commit()
    capture_generation(gen, "failed")
    return _error(code, message, status="failed", **_draft_state(metadata))


def _make_thumbnail(pdf: bytes) -> bytes | None:
    try:
        return render_thumbnail(pdf)
    except Exception:
        logger.warning("Could not render client resume thumbnail", exc_info=True)
        return None


def _upload_artifacts(
    generation_id: uuid.UUID, result: FinalizedResume, thumbnail: bytes | None,
) -> tuple[str | None, str | None, str | None]:
    pdf_key, md_key, thumb_key = generation_artifact_keys(generation_id)
    storage = None
    try:
        storage = StorageService()
        pdf_uploaded = bool(result.pdf_bytes) and storage.upload_bytes(result.pdf_bytes, pdf_key, "application/pdf")
    except Exception:
        logger.exception("Could not upload PDF for draft %s", generation_id)
        pdf_uploaded = False
    if not pdf_uploaded:
        # The write may have reached storage before the client reported a failure.
        if storage is not None and storage.enabled:
            try:
                if not storage.delete_file(pdf_key):
                    logger.warning("Could not remove incomplete PDF for draft %s", generation_id)
            except Exception:
                logger.exception("Could not remove incomplete PDF for draft %s", generation_id)
        return None, None, None

    md_uploaded = storage.upload_bytes(result.markdown.encode(), md_key, "text/markdown")
    thumb_uploaded = thumbnail and storage.upload_bytes(thumbnail, thumb_key, "image/webp")
    return pdf_key, md_key if md_uploaded else None, thumb_key if thumb_uploaded else None


async def _complete_draft(
    db: AsyncSession, gen: Generation, user: User, metadata: dict, final_draft: dict,
    result: FinalizedResume, thumbnail: bytes | None, reason: str,
) -> dict[str, Any] | None:
    # Publish canonical keys only after checking the claim, while the generation row is locked.
    upload_started = perf_counter()
    try:
        pdf_key, md_key, thumb_key = await asyncio.to_thread(
            _upload_artifacts, gen.id, result, thumbnail,
        )
    finally:
        logger.info("Draft submit %s: upload_ms=%.1f", gen.id, (perf_counter() - upload_started) * 1000)
    if pdf_key is None:
        return None

    gen.pdf_storage_key, gen.md_storage_key, gen.thumb_storage_key = pdf_key, md_key, thumb_key
    gen.status = "completed"
    gen.completed_at = datetime.now(timezone.utc)
    gen.model_used = f"client:{gen.client_model or 'unknown'}"
    analysis = final_draft["draft"].get("job_analysis") or {}
    gen.job_title = gen.job_title or analysis.get("job_title")
    gen.company = gen.company or analysis.get("company")
    user.first_generation_completed = True
    persisted = client_terminal_metadata(metadata)
    persisted["quality"].update(result.quality)
    persisted["quality"]["finalized_reason"] = reason
    persisted["quality"]["finalized_draft_revision"] = final_draft["draft_revision"]
    fit_warning = not result.fits_target or result.has_horizontal_overflow
    warnings = list(result.warnings)
    if final_draft["draft_revision"] != metadata["client_draft_revision"]:
        warnings.append(f"Saved the better measured draft at revision {final_draft['draft_revision']}.")
    gen.render_metadata = {
        **persisted,
        "profile": metadata["client_brief"]["profile"],
        "tailored_resume": result.tailored_resume,
        "font_size": result.font_size,
        "page_count": result.page_count,
        "fit_warning": fit_warning,
        "has_horizontal_overflow": result.has_horizontal_overflow,
        "page_fill_percent": result.page_fill_percent,
        "editor_revision": 0,
        "warnings": warnings,
    }
    await db.commit()
    capture_generation(gen, "completed")
    download_url = build_resume_file_link(gen.id)
    label = f"{gen.company or ''} {gen.job_title or 'Target Role'}".strip()
    return {
        "success": True,
        "status": "completed",
        "generation_id": str(gen.id),
        "inference_mode": "own_model",
        "template_id": gen.template_id,
        "content_split": gen.content_split,
        "creativity_mode": gen.creativity_mode,
        "job_title": gen.job_title,
        "company": gen.company,
        "download_url": download_url,
        "resume_json": result.tailored_resume,
        "page_count": result.page_count,
        "font_size": result.font_size,
        "fit_warning": fit_warning,
        "editor_revision": 0,
        "quality": persisted["quality"],
        "warnings": warnings,
        **_draft_state(metadata),
        "message": f"Resume completed. Download [{label} Resume (PDF)]({download_url}).",
    }


async def _submit(
    user_id: uuid.UUID,
    generation_id: uuid.UUID,
    resume_json: dict[str, Any] | None,
    revisions: list[dict[str, Any]] | None,
    finalize: bool,
    expected_draft_revision: int | None,
) -> dict[str, Any]:
    from src.services import client_draft

    queued_at = perf_counter()
    async with _render_slots:
        claim_started = perf_counter()
        claim_id = uuid.uuid4().hex
        async with get_mcp_db() as db:
            # Serialize claims across workers for the same account. Use this lock order on publication too.
            user = await db.get(User, user_id, with_for_update=True)
            if user is None or user.is_pending_deletion:
                return account_unavailable()
            gen = await _get_generation(db, generation_id, user_id)
            logger.info(
                "Draft submit %s: render_queue_ms=%.1f claim_wait_ms=%.1f",
                generation_id, (claim_started - queued_at) * 1000, (perf_counter() - claim_started) * 1000,
            )
            if gen is None:
                return _error("GENERATION_NOT_FOUND", "Generation not found.")
            metadata = dict(gen.render_metadata or {})
            if gen.inference_source != "client":
                return _error("NOT_CLIENT_GENERATION", "This generation uses Resumer inference.")
            if gen.status != "drafting":
                message = (
                    "This resume is completed. Use the editor tools to update it."
                    if gen.status == "completed" else "This draft is no longer available."
                )
                return _error("DRAFT_NOT_ACTIVE", message, **_draft_state(metadata))
            if expected_draft_revision is not None and expected_draft_revision != metadata["client_draft_revision"]:
                return _error("DRAFT_REVISION_CONFLICT", "Fetch the current draft and revise it.", **_draft_state(metadata))

            now = datetime.now(timezone.utc)
            claim_at = Generation.render_metadata["client_claim"]["at"].as_string()
            busy = await db.scalar(
                select(Generation.id)
                .where(
                    Generation.user_id == user_id,
                    Generation.inference_source == "client",
                    Generation.status == "drafting",
                    claim_at > (now - CLIENT_DRAFT_CLAIM_TTL).isoformat(),
                )
                .limit(1)
            )
            if busy is not None:
                return _error("busy", "A draft is already being rendered. Retry when it finishes.", status="busy",
                              **_draft_state(metadata))

            current = metadata.get("client_draft")
            snapshot = metadata["client_brief"]
            best = metadata.get("client_best")
            previous_used = used = metadata["client_submissions"]
            cap = client_draft.max_submissions()
            errors = []
            draft = None

            if used < cap:
                used += 1
            if resume_json is not None and revisions is not None:
                errors = [{"path": "", "code": "exclusive_arguments", "message": "Send one of resume_json or revisions."}]
            elif revisions is not None:
                if current is None:
                    errors = [{"path": "revisions", "code": "no_draft", "message": "Submit a full draft first."}]
                else:
                    patched, errors = await to_thread.run_sync(client_draft.apply_revisions, current, revisions)
                    if not errors:
                        draft, errors = await to_thread.run_sync(client_draft.normalize_draft, snapshot, patched)
            elif resume_json is not None:
                draft, errors = await to_thread.run_sync(client_draft.normalize_draft, snapshot, resume_json)
            elif not finalize or (current is None and previous_used < cap):
                errors = [{"path": "resume_json", "code": "no_draft", "message": "Submit a full draft first."}]

            if errors and used > previous_used:
                invalid = metadata.get("client_invalid_submissions", 0)
                if invalid < settings.OWN_MODEL_MAX_INVALID_SUBMISSIONS:
                    metadata["client_invalid_submissions"] = invalid + 1
                    used = previous_used
            metadata["client_submissions"] = used
            exhausted = used >= cap

            if errors:
                evaluation = client_draft.DraftEvaluation(
                    status="invalid_draft", errors=errors, issues=[], more_issues=0, layout={},
                    client_draft=None, tailored_resume=None, score=[], attempts=metadata.get("client_attempts", {}),
                )
                next_step = "Fix the listed errors and submit an updated draft."
                if exhausted:
                    next_step = "No submissions are left."
                    if current is not None or best is not None:
                        next_step += " Call with finalize=true and no draft changes to save the best available measured draft."
                    else:
                        next_step += " No valid draft was submitted."
                report = {
                    "success": False,
                    **client_draft.evaluation_report(evaluation),
                    "next_step": next_step,
                }
                metadata.pop("client_claim", None)
                metadata["client_last_report"] = report
                gen.render_metadata = metadata
                await db.commit()
                return {**report, **_draft_state(metadata)}

            if previous_used >= cap:
                # Validate payloads at the cap, but only saved revisions are eligible for finalization.
                draft = None
            if draft is not None:
                metadata["client_draft"] = draft
                metadata["client_draft_revision"] += 1
            if exhausted and current is None and draft is None and best is None:
                return await _fail_draft(db, gen, metadata, "DRAFT_SUBMISSIONS_EXHAUSTED", "No valid draft was submitted.")

            # Recover a normalized draft if the worker stopped before measuring it.
            latest_revision = (metadata.get("client_latest") or {}).get("draft_revision", 0)
            if draft is None and latest_revision < metadata["client_draft_revision"]:
                draft = current
            metadata["client_claim"] = {"id": claim_id, "at": now.isoformat()}
            gen.render_metadata = metadata
            gen.updated_at = now
            client_model = gen.client_model
            await db.commit()

        report = None
        result = None
        thumbnail = None
        reason = "submission_cap" if exhausted else "requested" if finalize else None
        final_draft = None
        failure = None
        unverified = False
        failed_revisions_now: list[int] = []
        unverifiable = None
        render_started = perf_counter()
        try:
            if draft is not None:
                evaluation = await to_thread.run_sync(partial(
                    client_draft.evaluate_draft, snapshot=snapshot, client_draft=draft,
                    submissions=used, attempts=metadata.get("client_attempts", {}),
                ))
                metadata["client_attempts"] = evaluation.attempts
                revision = metadata["client_draft_revision"]
                if evaluation.tailored_resume is not None:
                    candidate = client_draft.finalize_candidate(evaluation, draft, revision)
                    metadata["client_latest"] = candidate
                    if best is None or candidate["score"] >= best["score"]:
                        best = candidate
                        metadata["client_best"] = best
                    if reason is None and evaluation.status == "ready":
                        reason = "ready"
                        final_draft = candidate
                report = {
                    "success": evaluation.status != "invalid_draft",
                    **client_draft.evaluation_report(evaluation),
                    "best_draft_revision": best["draft_revision"] if best else None,
                    "next_step": "Address the listed issues and submit revisions using the current draft revision.",
                }
                if best is not None and best["draft_revision"] != revision:
                    report["next_step"] += f" Revision {best['draft_revision']} measured better and is kept as a fallback."

            if reason in {"requested", "submission_cap"}:
                latest = metadata.get("client_latest")
                if latest is not None and _verification_given_up(metadata, latest["draft_revision"]):
                    unverifiable = latest["draft_revision"]
                    latest = None
                if best is not None and _verification_given_up(metadata, best["draft_revision"]):
                    unverifiable = best["draft_revision"]
                    best = None
                final_draft = client_draft.pick_final_draft(reason, latest=latest, best=best)
                if final_draft is not None:
                    unverifiable = None
            elif final_draft is not None and _verification_given_up(metadata, final_draft["draft_revision"]):
                # Rendering this revision again would fail the same way; the client has to change it.
                unverifiable = final_draft["draft_revision"]
                final_draft = None
            if final_draft is not None:
                # Try the chosen draft, then the other measured candidate (latest vs best) that hasn't
                # already been given up on, before reporting the layout as unverifiable.
                # The alternate is only tried on the attempt that would give up the chosen draft, and only
                # the chosen draft's failure is recorded, so one transient outage can't block every revision.
                chosen_revision = final_draft["draft_revision"]
                last_chance = metadata.get("client_unverified_attempts", 0) + 1 >= _max_unverified_attempts
                candidates = [final_draft] + ([
                    c for c in (metadata.get("client_latest"), metadata.get("client_best"))
                    if c is not None and c.get("tailored_resume") is not None
                    and c["draft_revision"] != chosen_revision
                    and not _verification_given_up(metadata, c["draft_revision"])
                ][:1] if last_chance else [])
                for candidate in candidates:
                    try:
                        result = await to_thread.run_sync(partial(
                            client_draft.finalize_draft,
                            snapshot=snapshot, tailored_resume=candidate["tailored_resume"],
                            submissions=used, finalized_reason=reason, client_model=client_model,
                            pinned_font_size=candidate.get("pinned_font_size"),
                        ))
                    except client_draft.FinalizeUnverified:
                        if candidate["draft_revision"] == chosen_revision:
                            failed_revisions_now.append(chosen_revision)
                        continue
                    final_draft = candidate
                    break
                if result is None:
                    final_draft = candidates[0]
                    raise client_draft.FinalizeUnverified("no candidate could be verified")
                thumbnail = await to_thread.run_sync(_make_thumbnail, result.pdf_bytes)
        except client_draft.FinalizeUnverified:
            logger.warning("Final layout could not be verified for generation %s", generation_id)
            failure = "Could not verify the final resume layout."
            unverified = True
        except Exception:
            logger.exception("Could not render draft for generation %s", generation_id)
            failure = "Could not render this draft."
        finally:
            logger.info("Draft submit %s: render_ms=%.1f", generation_id, (perf_counter() - render_started) * 1000)

    async with get_mcp_db() as db:
        user = await db.get(User, user_id, with_for_update=True)
        gen = await _get_generation(db, generation_id, user_id)
        claim = ((gen.render_metadata or {}).get("client_claim") or {}) if gen is not None else {}
        if user is None or user.is_pending_deletion:
            return account_unavailable()
        if gen is None or gen.status != "drafting" or claim.get("id") != claim_id:
            current = gen.render_metadata if gen is not None else {}
            return _error("DRAFT_CLAIM_LOST", "This render no longer owns the draft.", **_draft_state(current or {}))
        if unverified or failed_revisions_now:
            attempts = metadata.get("client_unverified_attempts", 0) + 1
            metadata["client_unverified_attempts"] = attempts
            failed_revisions = set(metadata.get("client_unverified_revisions", []))
            failed_revisions.update(failed_revisions_now or [final_draft["draft_revision"]])
            metadata["client_unverified_revisions"] = sorted(failed_revisions)
        if unverified:
            if attempts < _max_unverified_attempts:
                # Likely transient: refund the submission so the same draft can be finalized again.
                metadata["client_submissions"] = previous_used
                exhausted = False
            else:
                unverifiable = final_draft["draft_revision"]
        upload_failed = False
        if result is not None:
            completed = await _complete_draft(db, gen, user, metadata, final_draft, result, thumbnail, reason)
            if completed is not None:
                return completed
            publish_failures = metadata.get("client_publish_failures", 0) + 1
            metadata["client_publish_failures"] = publish_failures
            if publish_failures >= _max_publish_failures:
                return await _fail_draft(
                    db, gen, metadata, "DRAFT_RENDER_FAILED",
                    f"Could not upload the verified resume PDF after {publish_failures} attempts.",
                )
            metadata["client_submissions"] = previous_used
            exhausted = False
            upload_failed = True
            failure = "Could not upload the verified resume PDF."
        if unverifiable is not None and exhausted:
            return await _fail_draft(
                db, gen, metadata, "DRAFT_RENDER_ATTEMPTS_EXHAUSTED",
                f"Could not verify the final layout of draft revision {unverifiable} and no submissions are left.",
            )
        if failure and exhausted:
            return await _fail_draft(db, gen, metadata, "DRAFT_RENDER_FAILED", failure)
        if exhausted:
            return await _fail_draft(db, gen, metadata, "DRAFT_SUBMISSIONS_EXHAUSTED", "No valid draft was submitted.")

        metadata.pop("client_claim")
        if unverifiable is not None:
            failure = None
            report = {**(report or {}), **_error(
                "DRAFT_RENDER_ATTEMPTS_EXHAUSTED",
                f"Could not verify the final layout of draft revision {unverifiable} after "
                f"{metadata['client_unverified_attempts']} attempts. Retrying it will not help: change the "
                "draft, for example by shortening bullet points that wrap onto a third line.",
                next_step="Submit revisions that change the draft, using the returned draft_revision.",
                unverifiable_draft_revisions=metadata["client_unverified_revisions"],
            )}
        if failure:
            next_step = (
                "Retry with finalize=true and set expected_draft_revision to the returned draft_revision."
                if unverified or upload_failed else "Retry the draft submission using the returned draft revision."
            )
            report = _error(
                "DRAFT_RENDER_FAILED", failure, next_step=next_step,
            )
        metadata["client_last_report"] = report
        gen.render_metadata = metadata
        await db.commit()
        return {**report, **_draft_state(metadata)}


async def submit_resume_draft_handler(
    generation_id: str,
    resume_json: dict[str, Any] | None = None,
    revisions: list[dict[str, Any]] | None = None,
    finalize: bool = False,
    expected_draft_revision: int | None = None,
) -> dict[str, Any]:
    started_at = perf_counter()
    try:
        gen_id = uuid.UUID(generation_id)
    except (ValueError, AttributeError, TypeError):
        return _error("INVALID_GENERATION_ID", "Provide a valid generation ID.")

    payload = {
        "generation_id": generation_id, "resume_json": resume_json, "revisions": revisions,
        "finalize": finalize, "expected_draft_revision": expected_draft_revision,
    }
    size = len(await to_thread.run_sync(partial(json.dumps, payload, ensure_ascii=True, separators=(",", ":"))))
    if size > _max_payload_bytes:
        return _error("payload_too_large", "The draft submission exceeds 64 KiB.")

    user_id = get_current_mcp_user().id
    if user_id in _active_submissions:
        # Read without locking: this request does not own the evaluation slot.
        async with get_mcp_db() as db:
            gen = await db.scalar(select(Generation).where(Generation.id == gen_id, Generation.user_id == user_id))
            metadata = gen.render_metadata if gen is not None and gen.inference_source == "client" else {}
        return _error("busy", "A draft is already being rendered. Retry when it finishes.", status="busy",
                      **_draft_state(metadata or {}))

    def release_account(done: asyncio.Task[dict[str, Any]]) -> None:
        _active_submissions.pop(user_id, None)
        logger.info("Draft submit %s: total_ms=%.1f", gen_id, (perf_counter() - started_at) * 1000)
        if not done.cancelled():
            done.exception()  # Retrieve errors even if the MCP caller disconnected.

    task = asyncio.create_task(
        _submit(user_id, gen_id, resume_json, revisions, finalize, expected_draft_revision)
    )
    _active_submissions[user_id] = task
    task.add_done_callback(release_account)
    # Keep the per-account guard and eventual publication alive after the caller disconnects.
    return await asyncio.shield(task)

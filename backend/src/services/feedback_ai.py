import json
import logging
import uuid
from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from sqlalchemy import select

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.core.notify import send_admin_support_alert
from src.core.storage import StorageService
from src.models.generation import ReportAttachment, SupportReport
from src.pipeline.nodes import invoke_with_fallback

logger = logging.getLogger(__name__)


async def process_new_support_report(report_id: uuid.UUID) -> None:
    """
    Background worker executed after a new support report is created:
    1. Triggers AI auto-summarization and sentiment scoring.
    2. Transcribes voice attachments if present.
    3. Fires admin alerts via email and webhook.
    """
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(SupportReport).where(SupportReport.id == report_id))
        report = res.scalar_one_or_none()
        if not report:
            logger.error(f"[feedback_ai] Support report {report_id} not found")
            return

        # 1. AI Summarization & Sentiment Analysis
        try:
            summary_sys = (
                "You are an AI support analyst. Analyze the following user message and reply ONLY with a JSON object:\n"
                '{"summary": "1 concise sentence summarizing the core issue", "sentiment_score": float between -1.0 (very negative) and 1.0 (very positive), "suggested_category": "bug"|"billing"|"feedback"|"other"}'
            )
            summary_user = f"User Message:\n{report.message}"

            prompt = ChatPromptTemplate.from_messages([("system", summary_sys), ("user", summary_user)])
            response = await invoke_with_fallback(
                lambda llm, p: prompt | llm,
                {},
                node_name="support_summarization",
            )

            raw_text = response.content if hasattr(response, "content") else str(response)
            clean_json = raw_text.strip()
            if clean_json.startswith("```json"):
                clean_json = clean_json.split("```json", 1)[1].split("```", 1)[0].strip()
            elif clean_json.startswith("```"):
                clean_json = clean_json.split("```", 1)[1].split("```", 1)[0].strip()

            parsed = json.loads(clean_json)
            report.auto_summary = parsed.get("summary")
            report.sentiment_score = parsed.get("sentiment_score")
            if not report.category or report.category == "other":
                report.category = parsed.get("suggested_category") or report.category

            await db.commit()
            logger.info(f"[feedback_ai] Generated summary for report {report_id}")
        except Exception as e:
            logger.error(f"[feedback_ai] AI summarization failed for report {report_id}: {e}")

        # 2. Voice Transcription (if any voice attachments)
        att_res = await db.execute(
            select(ReportAttachment).where(
                ReportAttachment.report_id == report_id,
                ReportAttachment.attachment_type == "voice_recording",
            )
        )
        voice_attachments = att_res.scalars().all()
        for v_att in voice_attachments:
            try:
                storage = StorageService()
                audio_bytes = storage.download_bytes(v_att.storage_key)
                if audio_bytes:
                    # Perform voice transcription using Gemini / LLM audio capability if available
                    transcription = await transcribe_audio_bytes(audio_bytes, v_att.mime_type or "audio/webm")
                    if transcription:
                        v_att.transcription = transcription
                        await db.commit()
                        logger.info(f"[feedback_ai] Transcribed voice attachment {v_att.id}")
            except Exception as e:
                logger.error(f"[feedback_ai] Transcription failed for attachment {v_att.id}: {e}")

        # 3. Fire Admin Email Alert
        try:
            send_admin_support_alert(
                report_id=str(report.id),
                message=report.message,
                category=report.category,
                sender_email=report.email_override,
            )
        except Exception as e:
            logger.error(f"[feedback_ai] Admin email alert failed: {e}")

        # 4. Fire Webhook Alert (Slack / Discord)
        if settings.SUPPORT_WEBHOOK_URL:
            try:
                import httpx
                payload = {
                    "text": f"🚨 *New Support Report* [Category: {report.category}]\n*From:* {report.email_override or 'Anonymous'}\n*Message:* {report.message[:300]}...\n<{settings.FRONTEND_URL}/admin|Open Admin Panel>",
                    "content": f"🚨 **New Support Report** [{report.category}]\n**From:** {report.email_override or 'Anonymous'}\n**Message:** {report.message[:300]}...",
                }
                async with httpx.AsyncClient(timeout=5.0) as client:
                    await client.post(settings.SUPPORT_WEBHOOK_URL, json=payload)
            except Exception as e:
                logger.error(f"[feedback_ai] Support webhook alert failed: {e}")


async def transcribe_audio_bytes(audio_bytes: bytes, mime_type: str) -> Optional[str]:
    """Transcribe audio bytes using Google Gemini multimodal Flash model."""
    try:
        import base64
        from langchain_google_genai import ChatGoogleGenerativeAI

        if not settings.google_api_keys:
            return None

        key = settings.google_api_keys[0]
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=key,
            temperature=0.0,
        )

        b64_data = base64.b64encode(audio_bytes).decode("utf-8")

        message = HumanMessage(
            content=[
                {
                    "type": "text",
                    "text": "Transcribe the following audio recording verbatim. Provide only the text transcription, without markdown or extra commentary.",
                },
                {
                    "type": "media",
                    "mime_type": mime_type,
                    "data": b64_data,
                },
            ]
        )

        response = await llm.ainvoke([message])
        return response.content.strip()
    except Exception as e:
        logger.warning(f"[feedback_ai] Gemini audio transcription failed: {e}")
        return None

from src.core.config import settings


def send_completion_email(to_email: str | None, gen) -> None:
    """Fire a Resend email on terminal generation status. Non-fatal: swallows errors.

    Called from the job_runner (and the reaper) when a generation reaches
    completed/failed. No-op if RESEND_API_KEY is unset or the user has no email.
    """
    if not settings.RESEND_API_KEY:
        return
    if not to_email:
        return

    try:
        import resend  # imported lazily so the dep is optional in dev

        resend.api_key = settings.RESEND_API_KEY

        title = gen.job_title or "your tailored resume"
        if gen.company and gen.company != "Unknown Company":
            title = f"{title} at {gen.company}"

        history_url = f"{settings.FRONTEND_URL}/dashboard/history"

        if gen.status == "completed":
            subject = "Your resume is ready"
            html_body = (
                f"<p>Hi,</p>"
                f"<p>Your resume for <strong>{title}</strong> is ready.</p>"
                f'<p><a href="{history_url}">View and download it here.</a></p>'
                f"<p style=\"color:#888;font-size:12px\">This link expires; revisit the History page anytime.</p>"
            )
        else:
            subject = "Your resume generation failed"
            reason = gen.error_message or "unknown error"
            html_body = (
                f"<p>Hi,</p>"
                f"<p>Your resume generation for <strong>{title}</strong> failed.</p>"
                f"<p style=\"color:#888\">Reason: {reason}</p>"
                f'<p><a href="{history_url}">Try again from the History page.</a></p>'
            )

        resend.Emails.send(
            {
                "from": settings.NOTIFICATION_FROM_EMAIL,
                "to": to_email,
                "subject": subject,
                "html": html_body,
            }
        )
    except Exception as e:
        # Email is best-effort; never crash the pipeline over a failed notification.
        print(f"[notify] send_completion_email failed: {e}")

import html

from src.core.config import settings
from src.core.file_links import format_resume_filename, resolve_resume_username


def send_completion_email(to_email: str | None, gen, pdf_bytes: bytes | None = None) -> None:
    """Fire a Resend email on terminal generation status. Non-fatal: swallows errors.

    Called from the job_runner (and the reaper) when a generation reaches
    completed/failed. No-op if RESEND_API_KEY is unset or the user has no email.
    """
    if not settings.RESEND_API_KEY:
        return
    if not to_email:
        return
    # The shared guest account uses a placeholder address that can't receive mail.
    if to_email.endswith("@resumer.local"):
        return

    try:
        import resend  # imported lazily so the dep is optional in dev

        resend.api_key = settings.RESEND_API_KEY

        title = gen.job_title or "your tailored resume"
        if gen.company and gen.company != "Unknown Company":
            title = f"{title} at {gen.company}"

        if getattr(gen, "is_guest", False):
            # Guests have no history page; their result page works in the
            # browser that started the run, and the PDF is attached anyway.
            history_url = f"{settings.FRONTEND_URL}/try/result/{gen.id}"
            done_label = fail_label = "Open Résumer"
        else:
            history_url = f"{settings.FRONTEND_URL}/dashboard/history"
            done_label, fail_label = "Go to Dashboard", "View History"

        # ── HTML Email Templates (Responsive, Premium, Anti-Spam Design) ─────
        if gen.status == "completed":
            subject = f"Your tailored resume is ready: {gen.job_title or 'Tailored Resume'}"
            html_body = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Resume is Ready</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      background-color: #f8fafc;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }}
    .wrapper {{
      width: 100%;
      background-color: #f8fafc;
      padding: 40px 0;
    }}
    .container {{
      max-width: 580px;
      margin: 0 auto;
      background-color: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.02);
    }}
    .header {{
      background-color: #ff4e26;
      padding: 32px 24px;
      text-align: center;
    }}
    .header h1 {{
      color: #ffffff;
      font-size: 22px;
      margin: 0;
      font-weight: 800;
      letter-spacing: -0.025em;
      text-transform: uppercase;
    }}
    .content {{
      padding: 40px 32px;
    }}
    .salutation {{
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 16px;
    }}
    .message {{
      font-size: 15px;
      color: #334155;
      margin-bottom: 24px;
    }}
    .job-card {{
      background-color: #f1f5f9;
      border: 1.5px solid #e2e8f0;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
    }}
    .job-label {{
      font-size: 11px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }}
    .job-title {{
      font-weight: 800;
      font-size: 17px;
      color: #0f172a;
      line-height: 1.3;
    }}
    .job-company {{
      color: #475569;
      font-size: 14px;
      font-weight: 500;
      margin-top: 4px;
    }}
    .action-container {{
      text-align: center;
      margin: 32px 0 16px 0;
    }}
    .btn {{
      display: inline-block;
      background-color: #0f172a;
      color: #ffffff !important;
      text-decoration: none;
      padding: 12px 32px;
      font-weight: 700;
      font-size: 14px;
      border-radius: 6px;
      text-transform: uppercase;
      letter-spacing: 0.025em;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }}
    .footer {{
      padding: 24px 32px;
      background-color: #f1f5f9;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #64748b;
      text-align: center;
      line-height: 1.5;
    }}
    .footer p {{
      margin: 0;
    }}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>Resumer Studio</h1>
      </div>
      <div class="content">
        <div class="salutation">Hi there,</div>
        <div class="message">
          Great news! Your tailored resume is complete and has been <strong>attached directly to this email</strong>.
        </div>
        <div class="job-card">
          <div class="job-label">Target Role</div>
          <div class="job-title">{gen.job_title or "Tailored Resume"}</div>
          <div class="job-company">{gen.company or "Target Company"}</div>
        </div>
        <div class="message">
          You can also download past versions or start another generation from your personal dashboard.
        </div>
        <div class="action-container">
          <a href="{history_url}" class="btn">{done_label}</a>
        </div>
      </div>
      <div class="footer">
        <p>This is an automated email from Resumer. Please do not reply directly.</p>
      </div>
    </div>
  </div>
</body>
</html>"""
        else:
            subject = f"Resume generation failed: {gen.job_title or 'Tailored Resume'}"
            reason = gen.error_message or "unknown error"
            html_body = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Resume Generation Failed</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      background-color: #f8fafc;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }}
    .wrapper {{
      width: 100%;
      background-color: #f8fafc;
      padding: 40px 0;
    }}
    .container {{
      max-width: 580px;
      margin: 0 auto;
      background-color: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.02);
    }}
    .header {{
      background-color: #475569;
      padding: 32px 24px;
      text-align: center;
    }}
    .header h1 {{
      color: #ffffff;
      font-size: 22px;
      margin: 0;
      font-weight: 800;
      letter-spacing: -0.025em;
      text-transform: uppercase;
    }}
    .content {{
      padding: 40px 32px;
    }}
    .salutation {{
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 16px;
    }}
    .message {{
      font-size: 15px;
      color: #334155;
      margin-bottom: 24px;
    }}
    .error-card {{
      background-color: #fff1f2;
      border: 1.5px solid #fecdd3;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
      color: #9f1239;
    }}
    .error-label {{
      font-size: 11px;
      font-weight: 700;
      color: #be123c;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }}
    .error-text {{
      font-size: 14px;
      font-weight: 500;
      line-height: 1.4;
    }}
    .action-container {{
      text-align: center;
      margin: 32px 0 16px 0;
    }}
    .btn {{
      display: inline-block;
      background-color: #64748b;
      color: #ffffff !important;
      text-decoration: none;
      padding: 12px 32px;
      font-weight: 700;
      font-size: 14px;
      border-radius: 6px;
      text-transform: uppercase;
      letter-spacing: 0.025em;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }}
    .footer {{
      padding: 24px 32px;
      background-color: #f1f5f9;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #64748b;
      text-align: center;
      line-height: 1.5;
    }}
    .footer p {{
      margin: 0;
    }}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>Resumer Studio</h1>
      </div>
      <div class="content">
        <div class="salutation">Hi there,</div>
        <div class="message">
          We ran into an issue while generating your tailored resume for <strong>{title}</strong>.
        </div>
        <div class="error-card">
          <div class="error-label">Pipeline Error</div>
          <div class="error-text">{reason}</div>
        </div>
        <div class="message">
          Please check your profile details or instructions and try again.
        </div>
        <div class="action-container">
          <a href="{history_url}" class="btn">{fail_label}</a>
        </div>
      </div>
      <div class="footer">
        <p>This is an automated email from Resumer. Please do not reply directly.</p>
      </div>
    </div>
  </div>
</body>
</html>"""

        email_payload = {
            "from": settings.NOTIFICATION_FROM_EMAIL,
            "to": to_email,
            "subject": subject,
            "html": html_body,
        }

        # ── Attach PDF if present and successful ─────────────────────────────
        if pdf_bytes and gen.status == "completed":
            render_profile = ((getattr(gen, "render_metadata", None) or {}).get("profile") or {})
            guest_profile = ((getattr(gen, "guest_input_snapshot", None) or {}).get("profile") or {})
            username = resolve_resume_username(
                guest_profile.get("full_name"), render_profile.get("full_name")
            )
            filename = format_resume_filename(
                username=username, job_title=getattr(gen, "job_title", None)
            )
            email_payload["attachments"] = [
                {
                    "filename": filename,
                    "content": list(pdf_bytes),
                    "content_type": "application/pdf",
                }
            ]

        resend.Emails.send(email_payload)
    except Exception as e:
        # Email is best-effort; never crash the pipeline over a failed notification.
        print(f"[notify] send_completion_email failed: {e}")


def send_admin_support_alert(report_id: str, message: str, category: str | None, sender_email: str | None) -> None:
    """Send an alert to admin emails when a new support report is filed."""
    if not settings.RESEND_API_KEY:
        return
    admin_list = settings.admin_emails
    if not admin_list or admin_list == ["*"]:
        return

    try:
        import resend
        resend.api_key = settings.RESEND_API_KEY
        subject = f"🚨 [Support Alert] New {category or 'General'} Report"
        html_body = f"""
        <div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 2px solid #000;">
          <h2 style="background: #ff4e26; color: #fff; padding: 10px 15px; margin: 0; text-transform: uppercase;">New Support Report</h2>
          <div style="padding: 15px; background: #fafafa;">
            <p><strong>Report ID:</strong> {report_id}</p>
            <p><strong>Sender:</strong> {sender_email or 'Anonymous'}</p>
            <p><strong>Category:</strong> {category or 'other'}</p>
            <hr style="border: 1px solid #ddd;" />
            <p><strong>Message:</strong></p>
            <blockquote style="background: #fff; padding: 12px; border-left: 4px solid #ff4e26; margin: 0;">
              {message}
            </blockquote>
            <p style="margin-top: 20px;"><a href="{settings.FRONTEND_URL}/admin" style="background: #000; color: #fff; padding: 10px 20px; text-decoration: none; font-weight: bold;">View in Admin Panel</a></p>
          </div>
        </div>
        """
        for admin_email in admin_list:
            if admin_email and admin_email != "*":
                resend.Emails.send({
                    "from": settings.NOTIFICATION_FROM_EMAIL,
                    "to": admin_email,
                    "subject": subject,
                    "html": html_body,
                })
    except Exception as e:
        print(f"[notify] send_admin_support_alert failed: {e}")


def send_support_resolved_email(to_email: str, report_id: str, admin_note: str) -> None:
    """Send resolution email to user when admin marks ticket as resolved."""
    if not settings.RESEND_API_KEY or not to_email:
        return

    try:
        import resend
        resend.api_key = settings.RESEND_API_KEY
        subject = "Your Resumer support request has been resolved"
        html_body = f"""
        <div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 2px solid #000;">
          <h2 style="background: #0f172a; color: #fff; padding: 10px 15px; margin: 0; text-transform: uppercase;">Support Request Resolved</h2>
          <div style="padding: 15px; background: #ffffff;">
            <p>Hi there,</p>
            <p>Your support ticket (<strong>#{report_id}</strong>) has been marked as <strong>Resolved</strong> by our team.</p>
            {f'<p><strong>Admin Note:</strong></p><blockquote style="background: #f1f5f9; padding: 12px; border-left: 4px solid #0f172a; margin: 0;">{admin_note}</blockquote>' if admin_note else ''}
            <p style="margin-top: 20px;">Thank you for helping us improve Resumer!</p>
          </div>
        </div>
        """
        resend.Emails.send({
            "from": settings.NOTIFICATION_FROM_EMAIL,
            "to": to_email,
            "subject": subject,
            "html": html_body,
        })
    except Exception as e:
        print(f"[notify] send_support_resolved_email failed: {e}")


def send_verification_code_email(to_email: str, name: str, code: str) -> None:
    """Send the 6-digit sign-up verification code via Resend.

    Unlike the completion/stub helpers above, failures raise so the caller
    can return a 503. When RESEND_API_KEY is unset:
    - non-production: log ``[dev] verification code for <email>: <code>`` so
      local testing works without a real send.
    - production (``ENVIRONMENT == "production"``): raise so the endpoint
      returns 503. Codes are never logged in production.
    """
    display_name = (name or "").strip() or "there"
    safe_name = html.escape(display_name)

    if not settings.RESEND_API_KEY:
        if settings.ENVIRONMENT == "production":
            raise RuntimeError("Email sending is unavailable (RESEND_API_KEY is not set).")
        print(f"[dev] verification code for {to_email}: {code}")
        return

    subject = f"Your Résumer code: {code}"
    html_body = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Résumer code</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      background-color: #f8fafc;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }}
    .wrapper {{
      width: 100%;
      background-color: #f8fafc;
      padding: 40px 0;
    }}
    .container {{
      max-width: 580px;
      margin: 0 auto;
      background-color: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.02);
    }}
    .header {{
      background-color: #ff4e26;
      padding: 32px 24px;
      text-align: center;
    }}
    .header h1 {{
      color: #ffffff;
      font-size: 22px;
      margin: 0;
      font-weight: 800;
      letter-spacing: -0.025em;
    }}
    .content {{
      padding: 40px 32px;
    }}
    .salutation {{
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 16px;
    }}
    .message {{
      font-size: 15px;
      color: #334155;
      margin-bottom: 24px;
    }}
    .code {{
      display: block;
      text-align: center;
      font-size: 40px;
      font-weight: 800;
      letter-spacing: 0.2em;
      color: #0f172a;
      background-color: #f1f5f9;
      border: 1.5px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px 16px;
      margin: 24px 0;
    }}
    .footer {{
      padding: 24px 32px;
      background-color: #f1f5f9;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #64748b;
      text-align: center;
      line-height: 1.5;
    }}
    .footer p {{
      margin: 4px 0;
    }}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>Résumer</h1>
      </div>
      <div class="content">
        <div class="salutation">Hi {safe_name},</div>
        <div class="message">
          Use this code to finish creating your account:
        </div>
        <span class="code">{html.escape(code)}</span>
        <div class="message">
          This code expires in 15 minutes.
        </div>
      </div>
      <div class="footer">
        <p>If you didn't try to sign up, ignore this email.</p>
        <p>This is an automated email from Résumer. Please do not reply directly.</p>
      </div>
    </div>
  </div>
</body>
</html>"""
    text_body = (
        f"Hi {display_name},\n\n"
        f"Use this code to finish creating your account: {code}\n\n"
        "This code expires in 15 minutes.\n\n"
        "If you didn't try to sign up, ignore this email.\n"
    )

    import resend  # imported lazily so the dep is optional in dev

    resend.api_key = settings.RESEND_API_KEY
    resend.Emails.send({
        "from": settings.NOTIFICATION_FROM_EMAIL,
        "to": to_email,
        "subject": subject,
        "html": html_body,
        "text": text_body,
    })


def _send_simple_account_email(to_email: str | None, subject: str, heading: str, paragraphs: list[str], cta_label: str, cta_url: str) -> None:
    """Small transactional email for account lifecycle notices. Non-fatal."""
    if not settings.RESEND_API_KEY or not to_email or to_email.endswith("@resumer.local"):
        return
    try:
        import resend

        resend.api_key = settings.RESEND_API_KEY
        body = "".join(
            f'<p style="font-size:15px;color:#334155;margin:0 0 16px;">{p}</p>' for p in paragraphs
        )
        html_body = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>{html.escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.6;color:#0f172a;">
  <div style="padding:40px 0;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="padding:32px;">
        <h1 style="font-size:20px;margin:0 0 20px;color:#230a04;">{html.escape(heading)}</h1>
        {body}
        <a href="{html.escape(cta_url, quote=True)}" style="display:inline-block;margin-top:8px;background:#ff4e26;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:6px;">{html.escape(cta_label)}</a>
      </div>
      <div style="padding:16px 32px;background:#f1f5f9;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
        You're getting this because of a change to your Résumer account.
      </div>
    </div>
  </div>
</body>
</html>"""
        resend.Emails.send({
            "from": settings.NOTIFICATION_FROM_EMAIL,
            "to": to_email,
            "subject": subject,
            "html": html_body,
        })
    except Exception as e:  # noqa: BLE001 - account emails must never break the request
        print(f"[notify] account email '{subject}' failed: {e}")


def send_account_deletion_scheduled_email(to_email: str | None, name: str | None, scheduled_for) -> None:
    """Tell the owner their account will be deleted, and how to stop it."""
    greeting = html.escape((name or "").strip() or "there")
    when = scheduled_for.strftime("%B %-d, %Y at %H:%M UTC")
    _send_simple_account_email(
        to_email,
        subject="Your Résumer account is scheduled for deletion",
        heading="Your account will be deleted in 7 days",
        paragraphs=[
            f"Hi {greeting},",
            f"We received a request to delete your Résumer account. It's now locked and will be permanently deleted on <strong>{html.escape(when)}</strong>, along with your profile, generated résumés and files.",
            "Changed your mind? Sign in before then and your account comes back exactly as it was.",
            "If you didn't ask for this, sign in now to cancel it, then change your password or check your Google/GitHub account.",
        ],
        cta_label="Sign in to keep my account",
        cta_url=settings.FRONTEND_URL,
    )


def send_account_restored_email(to_email: str | None, name: str | None) -> None:
    """Confirm that a sign-in cancelled a pending deletion."""
    greeting = html.escape((name or "").strip() or "there")
    _send_simple_account_email(
        to_email,
        subject="Your Résumer account deletion was cancelled",
        heading="Your account is back",
        paragraphs=[
            f"Hi {greeting},",
            "You signed in to Résumer, so we cancelled the scheduled deletion of your account. Everything is where you left it.",
            "AI connectors (ChatGPT, Claude and others) were disconnected when the deletion was requested. Reconnect them if you use them.",
            "If this wasn't you, change your password or check your Google/GitHub account right away.",
        ],
        cta_label="Open Résumer",
        cta_url=f"{settings.FRONTEND_URL}/dashboard",
    )

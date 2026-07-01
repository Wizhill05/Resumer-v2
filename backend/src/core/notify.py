from src.core.config import settings


import re
from src.core.config import settings


def send_completion_email(to_email: str | None, gen, pdf_bytes: bytes | None = None) -> None:
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
          <a href="{history_url}" class="btn">Go to Dashboard</a>
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
          <a href="{history_url}" class="btn">View History</a>
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
            safe_title = re.sub(r'[^\w\s-]', '', gen.job_title or "Resume").strip()
            safe_title = re.sub(r'[-\s]+', '_', safe_title)
            filename = f"Resume_{safe_title}.pdf"
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

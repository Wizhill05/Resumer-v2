"""Rendering safety: WeasyPrint never fetches outside the template directory (A2), templates escape text (B5)."""

import ast
import re
import socket
import urllib.request
from pathlib import Path

import pytest
from weasyprint import HTML

from src.core.config import settings
from src.services import resume_render
from src.services.resume_render import safe_url_fetcher

BACKEND = Path(__file__).resolve().parent.parent
FONT = settings.TEMPLATES_DIR / "professional-sans" / "fonts" / "Arial.TTF"


# ── safe_url_fetcher ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("url", [
    "http://169.254.169.254/latest/meta-data/",
    "https://example.com/x.png",
    "ftp://example.com/file",
    "gopher://example.com/",
    "file:///etc/passwd",
    "file://" + str(settings.TEMPLATES_DIR / ".." / ".." / "pyproject.toml"),
    "file://remote-host" + str(FONT),
    "javascript:alert(1)",
    "//example.com/x.png",
])
def test_fetcher_blocks_everything_outside_the_templates(url):
    with pytest.raises(ValueError):
        safe_url_fetcher(url)


def test_fetcher_allows_template_assets_and_data_uris():
    font = safe_url_fetcher(FONT.as_uri())
    try:
        assert font.read(4)  # real font bytes
    finally:
        font.close()
    data = safe_url_fetcher("data:text/plain;base64,aGVsbG8=")
    try:
        assert data.read() == b"hello"
    finally:
        data.close()


@pytest.fixture
def network_spy(monkeypatch):
    """Record every URL WeasyPrint's opener is asked for and every socket connection attempt."""
    opened: list[str] = []
    connects: list[object] = []
    real_open = urllib.request.OpenerDirector.open

    def spy_open(self, request, *args, **kwargs):
        url = request if isinstance(request, str) else request.full_url
        opened.append(url)
        if not url.startswith(("file:", "data:")):
            raise OSError("network disabled in tests")
        return real_open(self, request, *args, **kwargs)

    def spy_connect(*args, **kwargs):
        connects.append(args)
        raise OSError("network disabled in tests")

    monkeypatch.setattr(urllib.request.OpenerDirector, "open", spy_open)
    monkeypatch.setattr(socket, "create_connection", spy_connect)
    monkeypatch.setattr(socket.socket, "connect", lambda self, *a, **k: spy_connect(*a))
    return opened, connects


HOSTILE_HTML = """
<html><head><style>
  @import url("http://127.0.0.1:9/evil.css");
  body { background: url("https://example.com/bg.png"); }
</style>
<link rel="stylesheet" href="http://127.0.0.1:9/linked.css"></head>
<body><img src="http://169.254.169.254/latest/meta-data/"><img src="file:///etc/passwd">
<p>hello</p></body></html>
"""


def test_default_fetcher_would_fetch_these_urls(network_spy):
    """Control: without the guard WeasyPrint really tries the network (so the next test means something)."""
    opened, _ = network_spy
    HTML(string=HOSTILE_HTML, base_url=str(settings.TEMPLATES_DIR)).render()
    assert any(u.startswith("http") for u in opened)
    assert "file:///etc/passwd" in opened


def test_safe_fetcher_makes_no_network_or_local_file_fetch(network_spy):
    opened, connects = network_spy
    doc = HTML(string=HOSTILE_HTML, base_url=str(settings.TEMPLATES_DIR), url_fetcher=safe_url_fetcher).render()
    assert len(doc.pages) == 1
    assert opened == [] and connects == []


@pytest.mark.parametrize("template_id", ["personal-classic", "professional-sans"])
def test_resume_text_with_html_is_escaped_and_never_fetched(network_spy, template_id):
    opened, connects = network_spy
    evil = '<img src="http://169.254.169.254/latest/meta-data/"> Built **FastAPI** APIs <link rel=stylesheet href="http://x/y.css">'
    resume = {
        "summary": evil,
        "skills": {"Languages": ["Python", '<img src="http://e/x">']},
        "experiences": [{"role": "Eng <b>", "organization": "Acme", "bullet_points": [evil]}],
        "projects": [{"name": "P", "bullet_points": [evil], "github_url": "http://example.com/repo"}],
        "education": [],
        "extracurriculars": [{"description": evil}],
    }
    html = resume_render.render_resume_html(
        template_id=template_id, profile={"full_name": "Test <script>"}, resume=resume,
        font_size=10.0, page_margin_mm=12,
    )
    assert "<img src=\"http://169" not in html and "<script>" not in html and "<link rel=stylesheet" not in html
    doc = resume_render.render_document_at(
        template_id=template_id, profile={"full_name": "Test"}, resume=resume, font_size=10.0, page_margin_mm=12,
    )
    assert doc.pages
    assert all(u.startswith("file:") and str(settings.TEMPLATES_DIR) in u for u in opened), opened
    assert connects == []


def _html_calls(path: Path) -> list[ast.Call]:
    tree = ast.parse(path.read_text())
    return [
        n for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in ("HTML", "_VerifyHTML")
    ]


@pytest.mark.parametrize("relpath", [
    "src/pipeline/nodes.py",
    "src/services/resume_render.py",
    "src/api/guest.py",
    "src/template_registry/routes.py",
    "src/services/template_layout.py",
])
def test_every_weasyprint_call_uses_the_safe_fetcher(relpath):
    path = BACKEND / relpath
    for call in _html_calls(path):
        kwargs = {k.arg: k.value for k in call.keywords}
        fetcher = kwargs.get("url_fetcher")
        assert isinstance(fetcher, ast.Name) and fetcher.id == "safe_url_fetcher", (
            f"{relpath}:{call.lineno} renders without url_fetcher=safe_url_fetcher"
        )


# ── B5: escaping in personal-classic (autoescape) ─────────────────────────────

TRICKY = 'Cut costs by 30% at R&D Labs for "Tier <1>" customers & partners'


@pytest.mark.parametrize("template_id", ["personal-classic", "professional-sans"])
def test_special_characters_are_escaped_once(template_id):
    resume = {
        "summary": TRICKY,
        "skills": {"AI & ML": ["C++", "R&D <tools>"]},
        "experiences": [{"role": "Engineer & Lead", "organization": 'Acme "Labs"', "bullet_points": [TRICKY + " with **Python**"]}],
        "projects": [{"name": "Q&A <Bot>", "project_summary": "A & B", "bullet_points": [TRICKY]}],
        "education": [{"degree": "B.S. <CS>", "institution": "U & Co", "start_date": "2012-09-01", "end_date": "2016-06-01"}],
        "extracurriculars": [{"description": TRICKY}],
    }
    html = resume_render.render_resume_html(
        template_id=template_id, profile={"full_name": "Ana & Bo <Test>", "email": "a&b@example.com"},
        resume=resume, font_size=10.0, page_margin_mm=12,
    )
    assert "&amp;amp;" not in html and "&amp;lt;" not in html and "&amp;#34;" not in html  # no double escaping
    assert "<1>" not in html and "<Bot>" not in html and "<tools>" not in html and "<CS>" not in html
    assert "R&amp;D Labs" in html and "&lt;1&gt;" in html
    assert "<strong>Python</strong>" in html  # bold markup still renders

    # the rendered PDF text shows the characters exactly once
    doc = resume_render.render_document_at(
        template_id=template_id, profile={"full_name": "Ana & Bo <Test>"}, resume=resume, font_size=10.0, page_margin_mm=12,
    )
    text = " ".join(
        b.text for page in doc.pages for b in page._page_box.descendants() if type(b).__name__ == "TextBox"
    )
    text = re.sub(r"\s+", " ", text)
    assert "R&D Labs" in text and '"Tier <1>"' in text and "Q&A <Bot>" in text
    assert "&amp;" not in text and "&lt;" not in text


def test_personal_classic_html_is_unchanged_for_normal_text():
    """Autoescape must not change the markup of an ordinary résumé (only special characters get entities)."""
    import json

    sample = json.loads((BACKEND.parent / "sample-resume" / "dario-altman.json").read_text())
    sample["resume"]["skills"] = {k.replace("&", "and"): v for k, v in sample["resume"]["skills"].items()}
    html = resume_render.render_resume_html(
        template_id="personal-classic", profile=sample["profile"], resume=sample["resume"],
        font_size=10.0, page_margin_mm=10,
    )
    assert "&amp;" not in html.split("</style>", 1)[1].replace("EXTRA-CURRICULAR ACTIVITIES &amp; ACHIEVEMENTS", "")
    assert html.startswith("<!DOCTYPE html>")
    assert "<strong>B.S. in Computer Engineering</strong>" in html

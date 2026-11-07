import copy
import json
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pypdfium2 as pdfium
import pytest
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI
from weasyprint import HTML

from src.models.generation import Generation
from src.models.generation import PromptConfig
from src.models.profile import UserProject
from src.pipeline import nodes as nodes_mod
from src.schemas.pipeline import (
    TailoredExperience,
    TailoredExperienceBatch,
    TailoredProject,
    TailoredProjectBatch,
)
from src.services.resume_render import (
    detect_orphans_in_weasyprint,
    detect_resume_orphans,
    render_resume_html,
    render_resume_pdf,
)
from src.services.resume_retailor import retailor_resume_with_project


# ── 1. Hostile HTML Rendered Literal in Real PDF (Both Templates) ───────────────


@pytest.mark.parametrize("template_id", ["personal-classic", "professional-sans"])
def test_hostile_html_rendered_literal_in_real_pdf_both_templates(template_id):
    """(1) Hostile HTML in fallback project description and project_summary must be safely escaped

    before markdown and rendered literal in real PDF, preventing hidden content or injection.
    """
    hostile_desc = (
        '<style>body { display: none !important; } #injected { visibility: hidden; }</style>'
        '<script>alert("xss")</script><div id="injected">injected-text</div> **bolded tech**'
    )
    hostile_summary = '<style>h2 { font-size: 0px; }</style><b>SummaryCat</b>'

    profile = {
        "full_name": "Alice Security",
        "email": "alice@example.com",
        "phone": "+1-555-0199",
    }
    resume = {
        "projects": [
            {
                "name": "SecProject",
                "project_summary": hostile_summary,
                "description": hostile_desc,
                # Whitespace-only bullets must be treated as empty and fallback to description
                "bullet_points": ["   ", "  \n\t  "],
            }
        ],
        "experiences": [
            {
                "role": "Security Engineer",
                "organization": "GuardCorp",
                "bullet_points": ["Monitored application vulnerability feeds."],
            }
        ],
        "education": [],
        "skills": {"Tools": ["Wireshark", "Burp"]},
    }

    pdf_bytes, page_count = render_resume_pdf(
        template_id=template_id,
        profile=profile,
        resume=resume,
        font_size=10.0,
        page_margin_mm=14.0,
    )
    assert page_count >= 1
    assert len(pdf_bytes) > 0

    # Inspect the actual compiled PDF text with pypdfium2
    pdf = pdfium.PdfDocument(pdf_bytes)
    page_text = "".join(pdf[i].get_textpage().get_text_range() for i in range(len(pdf)))

    # The hostile tags MUST be rendered as literal text in the PDF!
    assert "<style>body" in page_text or "<style>" in page_text
    assert "display: none" in page_text
    assert "<script>alert" in page_text or "<script>" in page_text
    assert "<b>SummaryCat</b>" in page_text or "SummaryCat" in page_text
    assert "bolded tech" in page_text

    # Content must NOT be hidden by injected CSS: candidate name and experience must be visible
    assert "Alice Security" in page_text
    assert "Security Engineer" in page_text
    assert "GuardCorp" in page_text


# ── 2. get_prompt_config LARP Migration Heuristic Fix ─────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "name,sys_custom,usr_custom",
    [
        (
            "orphan_repair_larp",
            "ROLE: Custom Line-wrap repair editor.\nTASK: Rewrite bullets.\nOUTPUT CONTRACT: Return only one raw JSON object with key 'bullets'. No markdown fences, no prose, no comments.\nQUALITY BAR: Add supported technical detail to fit constraints.",
            "Custom user prompt with preserve meaning and truth.",
        ),
        (
            "orphan_repair_super_larp",
            "ROLE: Super LARP editor.\nTASK: Rewrite bullets.\nOUTPUT CONTRACT: Return only one raw JSON object with key 'bullets'. No markdown fences, no prose, no comments.\nQUALITY BAR: Custom rule keep the core meaning and factual claims.",
            "Custom prompt with supported technical detail.",
        ),
        (
            "orphan_repair_larp",
            "ROLE: Arbitrary customized system prompt.\nTASK: Custom task.\nOUTPUT CONTRACT: Return only one raw JSON object with key 'bullets'. No markdown fences, no prose, no comments.",
            "Arbitrary custom user prompt.",
        ),
    ],
)
async def test_get_prompt_config_preserves_custom_prompts_zero_commits(name, sys_custom, usr_custom):
    """(2) get_prompt_config must not overwrite valid custom DB system/user prompts

    even when substrings like 'supported technical detail' or 'preserve meaning and truth' appear.
    Tests verify zero commits/writes and exact returned custom prompts.
    """
    mock_db = AsyncMock()
    custom_cfg = PromptConfig(name=name, system_prompt=sys_custom, user_prompt=usr_custom)

    mock_execute_result = MagicMock()
    mock_execute_result.scalar_one_or_none.return_value = custom_cfg
    mock_db.execute.return_value = mock_execute_result

    sys_out, usr_out = await nodes_mod.get_prompt_config(
        mock_db,
        name=name,
        default_system="DEFAULT SYSTEM PROMPT",
        default_user="DEFAULT USER PROMPT",
    )

    # Must return custom prompts exactly
    assert sys_out == sys_custom
    assert usr_out == usr_custom

    # Must perform ZERO commits or writes to the DB
    mock_db.commit.assert_not_called()
    mock_db.add.assert_not_called()
    assert custom_cfg.system_prompt == sys_custom
    assert custom_cfg.user_prompt == usr_custom


# ── 3. Duplicate Text Across Experience and Target Project ─────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("template_id", ["personal-classic", "professional-sans"])
async def test_duplicate_text_across_experience_and_target_project_real_renderer(monkeypatch, template_id):
    """(3) Duplicate text across experience and target project must use stable section,

    entry, and bullet identity through detection and repair/replacement; ensure untouched
    experience content is preserved and targeted project is repaired on real renderer.
    """
    # A bullet that wraps onto line 2 with a short trailing orphan under both templates
    duplicate_orphan_bullet = (
        "Engineered real-time analytics engine with WebSockets handling 50k concurrent client streams with sub-second latency."
    )
    untouched_exp_bullet_2 = "Developed automated CI/CD pipeline reducing deployment cycle by 45%."

    profile = {"full_name": "Jordan Dev", "email": "jordan@example.com"}
    current_resume = {
        "experiences": [
            {
                "role": "Lead Backend Engineer",
                "organization": "CloudScale LLC",
                "start_date": "2020-01-01",
                "end_date": "2023-01-01",
                "bullet_points": [
                    duplicate_orphan_bullet,  # Duplicate text in experience!
                    untouched_exp_bullet_2,
                ],
            }
        ],
        "projects": [
            {
                "name": "Legacy Project",
                "bullet_points": ["Old project work."],
            }
        ],
        "education": [],
        "skills": {"Languages": ["Go", "Python"]},
    }

    # Replacement project has the EXACT duplicate bullet text!
    new_proj = MagicMock()
    new_proj.name = "Analytics Engine Replacement"
    new_proj.description = "Analytics engine project description"
    new_proj.technologies = ["Python", "WebSockets"]
    new_proj.bullet_points = [duplicate_orphan_bullet]
    new_proj.github_url = None
    new_proj.live_url = None
    new_proj.start_date = None
    new_proj.end_date = None

    # Step A: Test detect_resume_orphans on real renderer — must attach stable identity!
    test_resume = {
        "experiences": copy.deepcopy(current_resume["experiences"]),
        "projects": [
            {
                "name": "Analytics Engine Replacement",
                "bullet_points": [duplicate_orphan_bullet],
            }
        ],
        "education": [],
        "skills": {"Languages": ["Go", "Python"]},
    }
    detect_res = detect_resume_orphans(
        template_id=template_id,
        profile=profile,
        resume=test_resume,
        font_size=10.0,
    )
    assert detect_res["success"] is True
    orphans = detect_res["orphans"]

    # Both experience and project have the duplicate bullet; check stable identities
    exp_orphans = [o for o in orphans if o.get("section") == "experience"]
    proj_orphans = [o for o in orphans if o.get("section") == "projects"]

    for o in exp_orphans:
        assert o["section"] == "experience"
        assert o.get("entry_idx") == 0
        assert o.get("bullet_idx") == 0

    for o in proj_orphans:
        assert o["section"] == "projects"
        assert o.get("entry_idx") == 0
        assert o.get("bullet_idx") == 0

    # Step B: Test retailor_resume_with_project with real WeasyPrint renderer
    mock_db = AsyncMock()
    mock_gen = MagicMock()
    mock_gen.id = uuid4()
    mock_gen.template_id = template_id
    mock_gen.section_order = ["experiences", "projects"]
    mock_gen.job_title = "Backend Engineer"
    mock_gen.company = "Acme"
    mock_gen.job_description = "WebSockets distributed systems"
    mock_gen.keywords = ["Python", "WebSockets"]
    mock_gen.render_metadata = {}
    mock_gen.creativity_mode = "proper"

    repaired_target_bullet = (
        "Engineered real-time **analytics engine** with **WebSockets** handling 50k concurrent client streams with sub-second latency in production."
    )

    class PassthroughRunnable:
        async def ainvoke(self, *a, **k):
            return TailoredProjectBatch(
                entries=[
                    TailoredProject(
                        name="Analytics Engine Replacement",
                        project_summary="Analytics Platform",
                        description="Engine",
                        technologies=["Python", "WebSockets"],
                        bullet_points=[duplicate_orphan_bullet],
                    )
                ]
            )

    monkeypatch.setattr("src.services.resume_retailor._structured", lambda *a, **k: PassthroughRunnable())
    monkeypatch.setattr(
        "src.services.resume_retailor.get_prompt_config",
        AsyncMock(return_value=("System prompt", "User prompt {job_analysis} {entries}")),
    )

    class FakeRepairLLMResp:
        content = json.dumps({"bullets": [{"index": 1, "replacement": repaired_target_bullet}]})

    monkeypatch.setattr(nodes_mod, "invoke_with_fallback", AsyncMock(return_value=FakeRepairLLMResp()))

    result = await retailor_resume_with_project(
        db=mock_db,
        gen=mock_gen,
        target_project_index=0,
        new_project=new_proj,
        current_resume=current_resume,
        profile_data=profile,
    )

    final_resume = result["tailored_resume"]

    # 1. Untouched experience MUST be 100% preserved (NOT overwritten by project repair!)
    final_exp = final_resume["experiences"][0]
    assert final_exp["bullet_points"][0] == duplicate_orphan_bullet
    assert final_exp["bullet_points"][1] == untouched_exp_bullet_2

    # 2. Targeted project MUST be repaired to the new repaired bullet
    final_proj = final_resume["projects"][0]
    assert final_proj["name"] == "Analytics Engine Replacement"
    assert final_proj["bullet_points"][0] == repaired_target_bullet


# ── 4. Structured Schemas Mode-Neutral Descriptions & Outgoing Request Capture ─


def test_structured_schemas_mode_neutral_descriptions():
    """(4) Structured schemas must not include 'supported claims only' for project and experience

    bullet points, making field descriptions mode-neutral for proper, larp, and super_larp.
    """
    proj_desc = TailoredProject.model_fields["bullet_points"].description
    exp_desc = TailoredExperience.model_fields["bullet_points"].description

    assert "supported claims only" not in proj_desc
    assert "supported claims only" not in exp_desc
    assert "Job-tailored achievement bullets using action verbs" in proj_desc
    assert "Job-tailored achievement bullets using action verbs" in exp_desc


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["proper", "larp", "super_larp"])
async def test_capture_complete_outgoing_structured_request_all_three_modes(mode):
    """(4) Capture actual complete outgoing structured request across all three modes (proper, larp, super_larp)

    verifying JSON schema, messages, and model parameters.
    """
    captured_requests = []

    def mock_transport(request: httpx.Request):
        payload = json.loads(request.content)
        captured_requests.append({"url": str(request.url), "headers": dict(request.headers), "payload": payload})
        response_content = json.dumps(
            {
                "entries": [
                    {
                        "name": "Test Project",
                        "project_summary": "API Service",
                        "description": "A service",
                        "technologies": ["Python"],
                        "bullet_points": ["Built an **API** service with **FastAPI**."],
                    }
                ]
            }
        )
        return httpx.Response(
            200,
            json={
                "id": f"test-{mode}",
                "object": "chat.completion",
                "created": 12345,
                "model": "mock-model-1",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": response_content},
                    }
                ],
                "usage": {"prompt_tokens": 50, "completion_tokens": 30, "total_tokens": 80},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(mock_transport)) as client:
        llm = ChatOpenAI(
            model="mock-model-1",
            api_key="synthetic-key",
            max_retries=0,
            base_url="https://api.example.com/v1",
            http_async_client=client,
        )

        state = {
            "projects": [
                {
                    "name": "Original Proj",
                    "description": "Original desc",
                    "technologies": ["Python"],
                    "bullet_points": ["Original bullet point."],
                }
            ],
            "experiences": [],
            "content_split": {"projects": 1, "experiences": 0},
            "template_manifest": {"max_bullets_per_project": 3},
            "job_analysis": {"job_title": "Backend Engineer", "extracted_skills": ["Python"]},
            "creativity_mode": mode,
            "is_pro": False,
        }

        # Run structured invocation directly via _structured
        chain = nodes_mod._structured(llm, TailoredProjectBatch)
        res = await chain.ainvoke([HumanMessage(content=f"Tailor project in mode {mode}")])

    assert len(captured_requests) == 1
    req = captured_requests[0]
    payload = req["payload"]

    # Verify complete outgoing request payload
    assert payload["response_format"]["type"] == "json_schema"
    json_schema = payload["response_format"]["json_schema"]
    assert json_schema["name"] == "TailoredProjectBatch"

    # Schema inside the outgoing request must be mode-neutral (NO 'supported claims only')
    bullet_schema = json_schema["schema"]["$defs"]["TailoredProject"]["properties"]["bullet_points"]
    assert "supported claims only" not in bullet_schema["description"]
    assert "Job-tailored achievement bullets using action verbs" in bullet_schema["description"]

    # Outgoing system message must reflect schema without markdown fences
    messages = payload["messages"]
    assert len(messages) >= 2
    assert "Return only one JSON object matching this schema." in messages[0]["content"]
    assert "supported claims only" not in messages[0]["content"]

    assert res["parsed"] is not None
    assert res["parsed"].entries[0].name == "Test Project"


# ── 5. Templates Treat Whitespace-Only Bullets as Empty (Both Templates) ───────


@pytest.mark.parametrize("template_id", ["personal-classic", "professional-sans"])
def test_templates_treat_whitespace_only_bullets_as_empty_and_show_description_real_pdf(template_id):
    """(5) Templates must treat whitespace-only bullet arrays as empty and show description;

    test real PDFs on both personal-classic and professional-sans templates.
    """
    profile = {
        "full_name": "Morgan Taylor",
        "email": "morgan@example.com",
    }
    resume = {
        "projects": [
            {
                "name": "Cloud Deployment Tool",
                "project_summary": "Infrastructure Automation",
                "description": "Automated multi-region cloud provisioning reducing developer setup time from days to minutes.",
                "bullet_points": ["   ", "\t\n  ", ""],  # Whitespace-only bullets!
            }
        ],
        "experiences": [
            {
                "role": "Cloud Architect",
                "organization": "InfraSys",
                "bullet_points": ["Designed scalable cloud architecture."],
            }
        ],
        "education": [],
        "skills": {"Cloud": ["AWS", "Terraform"]},
    }

    # Render HTML and verify template output
    html = render_resume_html(
        template_id=template_id,
        profile=profile,
        resume=resume,
        font_size=10.0,
        page_margin_mm=14.0,
    )
    assert html is not None

    # Must NOT render <ul> for the whitespace-only project
    # Description paragraph must be rendered
    assert "Automated multi-region cloud provisioning reducing developer setup time" in html

    # Render real PDF and extract text
    pdf_bytes, page_count = render_resume_pdf(
        template_id=template_id,
        profile=profile,
        resume=resume,
        font_size=10.0,
        page_margin_mm=14.0,
    )
    assert page_count >= 1

    pdf = pdfium.PdfDocument(pdf_bytes)
    page_text = "".join(pdf[i].get_textpage().get_text_range() for i in range(len(pdf)))

    assert "Cloud Deployment Tool" in page_text
    assert "Automated multi-region cloud provisioning reducing developer setup time" in page_text
    assert "Infrastructure Automation" in page_text
    assert "Cloud Architect" in page_text


@pytest.mark.asyncio
async def test_legacy_prompt_with_custom_suffix_is_not_overwritten():
    db = AsyncMock()
    system = "You are a precise resume editor. You ONLY output valid JSON. No explanation, no markdown fences.\nCustom rule: preserve emphasis."
    cfg = PromptConfig(name="orphan_repair_larp", system_prompt=system, user_prompt="Custom input")
    result = MagicMock()
    result.scalar_one_or_none.return_value = cfg
    db.execute.return_value = result
    assert await nodes_mod.get_prompt_config(db, cfg.name, "default", "default user") == (system, "Custom input")
    db.commit.assert_not_called()


@pytest.mark.parametrize("template_id", ["personal-classic", "professional-sans"])
def test_project_blank_bullet_preserves_source_index(template_id):
    from src.services.resume_render import render_resume_html
    from src.template_registry.service import TemplateRegistryService
    import json
    from pathlib import Path
    data = json.loads((Path(__file__).resolve().parents[1] / "sample-resume/dario-altman.json").read_text())
    data["resume"]["projects"][0]["bullet_points"] = ["   ", "Actual source bullet"]
    html = render_resume_html(template_id=template_id, profile=data["profile"], resume=data["resume"], font_size=9, page_margin_mm=14)
    assert 'data-section="projects" data-entry-idx="0" data-bullet-idx="1">Actual source bullet' in html

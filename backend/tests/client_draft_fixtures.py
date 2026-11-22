"""Shared fixtures for own-model (client draft) tests: realistic profiles, a job, and draft builders.

Importable by any test (Builder A unit/render tests, Builder B MCP lifecycle tests, e2e scripts):

    from tests.client_draft_fixtures import PROFILES, brief_inputs, full_draft
    built = client_draft.build_client_brief(**brief_inputs("rich", "personal-classic"))
    draft = full_draft(built["snapshot"])

Profiles are plain dicts in the shape the job runner builds (profile/experiences/projects/education/
extracurriculars). Draft builders produce client-shape drafts (§4.4) with controlled bullet lengths so
render tests are deterministic.
"""

from __future__ import annotations

import copy
import re
import json
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent.parent

JOB_TITLE = "Senior Backend Engineer, ML Platform"
COMPANY = "Northwind Analytics"
JOB_DESCRIPTION = """\
Northwind Analytics is hiring a Senior Backend Engineer for its ML Platform team.

What you will do
- Design and operate Python services (FastAPI) that serve feature data and model predictions at low latency.
- Own PostgreSQL schemas, query performance, and Redis caching for high-traffic APIs.
- Build event pipelines with Kafka and batch jobs with Airflow; keep them observable with Prometheus and Grafana.
- Ship containerized services to Kubernetes on AWS using Terraform and GitHub Actions.
- Partner with data scientists to productionize models (PyTorch, scikit-learn) and evaluation tooling.
- Mentor engineers, write design docs, and lead incident reviews.

What we look for
- 5+ years building backend systems in Python; strong SQL.
- Experience with distributed systems, caching, and API design (REST, gRPC).
- Comfort with cloud infrastructure (AWS), Docker, Kubernetes, CI/CD.
- Clear written communication and a habit of measuring impact.
"""

_PROFILE = {
    "full_name": "Priya Raman",
    "email": "priya.raman@example.com",
    "phone": "+1 415 555 0142",
    "location": "Oakland, CA",
    "linkedin_url": "https://linkedin.com/in/priya-raman-example",
    "github_url": "https://github.com/priya-raman-example",
    "portfolio_url": None,
    "subtitle": None,
    "summary": "Backend engineer focused on data-heavy Python services, APIs and the infrastructure that keeps them fast.",
    "skills": ["Python", "SQL", "FastAPI", "PostgreSQL", "Redis", "Docker", "Kubernetes", "AWS", "Kafka", "Mentoring"],
}

_EXPERIENCES = [
    {
        "role": "Senior Software Engineer", "organization": "Lattice Freight", "location": "San Francisco, CA",
        "start_date": "2021-03-01", "end_date": None,
        "bullet_points": [
            "Rebuilt the shipment-pricing API in FastAPI and PostgreSQL, cutting p95 latency from 820ms to 140ms for 3,000 requests per second.",
            "Introduced Redis read-through caching and query plans review, lowering database CPU by 45%.",
            "Moved 14 services to Kubernetes on AWS with Terraform modules and GitHub Actions pipelines.",
            "Mentored 4 engineers and ran the weekly incident review.",
        ],
    },
    {
        "role": "Software Engineer", "organization": "Brightline Health", "location": "Remote",
        "start_date": "2018-07-01", "end_date": "2021-02-01",
        "bullet_points": [
            "Built Kafka consumers that streamed 12M lab events per day into the analytics warehouse.",
            "Wrote Airflow DAGs for nightly claims reconciliation, replacing a manual 6-hour process.",
            "Added Prometheus metrics and Grafana dashboards for every patient-facing service.",
        ],
    },
    {
        "role": "Data Engineer", "organization": "Copperleaf Retail", "location": "Seattle, WA",
        "start_date": "2016-06-01", "end_date": "2018-06-01",
        "bullet_points": [
            "Maintained Python ETL jobs loading point-of-sale data from 220 stores into PostgreSQL.",
            "Rewrote slow reporting queries, cutting the daily sales report from 40 minutes to 7.",
        ],
    },
    {
        "role": "Backend Intern", "organization": "Tidewater Labs", "location": "Portland, OR",
        "start_date": "2015-06-01", "end_date": "2015-09-01",
        "bullet_points": ["Built an internal Flask API for lab inventory used by 30 researchers."],
    },
    {
        "role": "Teaching Assistant, Databases", "organization": "University of Washington", "location": "Seattle, WA",
        "start_date": "2014-09-01", "end_date": "2016-06-01",
        "bullet_points": [
            "Led weekly SQL lab sections for 60 students and wrote autograded PostgreSQL exercises.",
        ],
    },
]

_PROJECTS = [
    {
        "name": "FeatureLake", "description": "Open-source feature store that serves ML features over gRPC with Redis caching.",
        "technologies": ["Python", "gRPC", "Redis", "PostgreSQL", "Docker"],
        "bullet_points": [
            "Serves 25K feature lookups per second on a single node with a 4ms p99.",
            "Point-in-time joins for training sets backed by PostgreSQL partitions.",
        ],
        "github_url": "https://github.com/priya-raman-example/featurelake", "live_url": None,
        "start_date": "2022-01-01", "end_date": None,
    },
    {
        "name": "QueryScope", "description": "Postgres query regression checker that runs in CI.",
        "technologies": ["Python", "PostgreSQL", "GitHub Actions"],
        "bullet_points": [
            "Captures EXPLAIN plans for 300 critical queries and fails builds on 2x cost regressions.",
            "Adopted by 3 teams at Lattice Freight.",
        ],
        "github_url": "https://github.com/priya-raman-example/queryscope", "live_url": None,
        "start_date": "2023-02-01", "end_date": "2023-08-01",
    },
    {
        "name": "Driftwatch", "description": "Model drift monitor for tabular models with Prometheus alerts.",
        "technologies": ["Python", "scikit-learn", "Prometheus", "FastAPI"],
        "bullet_points": ["Computes population stability index for 40 features every hour."],
        "github_url": None, "live_url": "https://driftwatch.example.com",
        "start_date": "2021-05-01", "end_date": "2021-11-01",
    },
    {
        "name": "TrailCache", "description": "HTTP caching proxy experiment written in Go.",
        "technologies": ["Go", "Redis"],
        "bullet_points": ["Benchmarked cache eviction policies under synthetic load."],
        "github_url": "https://github.com/priya-raman-example/trailcache", "live_url": None,
        "start_date": "2020-03-01", "end_date": "2020-06-01",
    },
    {
        "name": "Recipe Box", "description": "Personal recipe manager with a React front end.",
        "technologies": ["React", "Node.js", "MongoDB"],
        "bullet_points": ["Shared with 50 friends and family members."],
        "github_url": None, "live_url": None, "start_date": "2019-01-01", "end_date": "2019-04-01",
    },
]

_EDUCATION = [
    {
        "degree": "B.S. in Computer Science", "institution": "University of Washington", "location": "Seattle, WA",
        "start_date": "2012-09-01", "end_date": "2016-06-01", "gpa": "3.7/4.0", "coursework": [],
    },
]

_EXTRACURRICULARS = [
    {"title": "PyCon US speaker", "organization": "PyCon", "description": "Talk on caching patterns for Python APIs.",
     "start_date": "2023-04-01", "end_date": None, "bullet_points": ["Audience of about 400 attendees."]},
    {"title": "Volunteer mentor", "organization": "Code Nation", "description": "Mentor high-school students learning web development.",
     "start_date": "2019-09-01", "end_date": None, "bullet_points": []},
    {"title": "Hackathon winner", "organization": "Bay Area Civic Hack", "description": "Built a transit delay predictor in 24 hours; placed first of 35 teams.",
     "start_date": "2022-10-01", "end_date": "2022-10-02", "bullet_points": []},
    {"title": "Achievements", "organization": "", "description": "", "start_date": None, "end_date": None, "bullet_points": []},
]

PROFILES: dict[str, dict[str, Any]] = {
    # 5 experiences, 5 projects, education, 3 real extracurriculars (+ a header-only row that must be ignored)
    "rich": {
        "profile": _PROFILE, "experiences": _EXPERIENCES, "projects": _PROJECTS,
        "education": _EDUCATION, "extracurriculars": _EXTRACURRICULARS,
    },
    # 2 thin experiences, 2 small projects, 1 extracurricular
    "thin": {
        "profile": {**_PROFILE, "full_name": "Sam Ortiz", "summary": "", "skills": ["Python", "SQL"]},
        "experiences": [
            {"role": "Junior Developer", "organization": "Pinecrest Software", "location": "Austin, TX",
             "start_date": "2023-06-01", "end_date": None,
             "bullet_points": ["Fixed bugs in a Django admin panel.", "Wrote SQL reports for the sales team."]},
            {"role": "IT Intern", "organization": "Austin Community College", "location": "Austin, TX",
             "start_date": "2022-06-01", "end_date": "2022-12-01",
             "bullet_points": ["Set up laptops for 80 staff members."]},
        ],
        "projects": [
            {"name": "Budget Bot", "description": "Telegram bot that tracks shared expenses.",
             "technologies": ["Python", "SQLite"], "bullet_points": ["Used by 6 roommates."],
             "github_url": None, "live_url": None, "start_date": None, "end_date": None},
            {"name": "Portfolio Site", "description": "Static personal website.",
             "technologies": ["HTML", "CSS"], "bullet_points": [],
             "github_url": None, "live_url": None, "start_date": None, "end_date": None},
        ],
        "education": [{"degree": "A.S. in Computer Science", "institution": "Austin Community College", "location": "Austin, TX",
                       "start_date": "2020-08-01", "end_date": "2022-05-01", "gpa": None, "coursework": []}],
        "extracurriculars": [{"title": "Robotics club", "organization": "ACC", "description": "Member of the robotics club.",
                              "start_date": None, "end_date": None, "bullet_points": []}],
    },
    # student: 2 experiences, 5 projects
    "student": {
        "profile": {**_PROFILE, "full_name": "Lena Park", "skills": ["Python", "PyTorch", "FastAPI", "React", "Docker"]},
        "experiences": _EXPERIENCES[3:5],
        "projects": _PROJECTS,
        "education": _EDUCATION,
        "extracurriculars": _EXTRACURRICULARS[:3],
    },
    # senior: 4 experiences with long source bullets, 3 projects
    "senior": {
        "profile": {**_PROFILE, "full_name": "Marcus Bell"},
        "experiences": [
            {**e, "bullet_points": [b + " Worked across product, data and infrastructure teams to agree on interfaces, rollout plans and success metrics." for b in e["bullet_points"]]}
            for e in _EXPERIENCES[:4]
        ],
        "projects": _PROJECTS[:3],
        "education": _EDUCATION,
        "extracurriculars": _EXTRACURRICULARS[:2],
    },
}


def brief_inputs(
    profile_name: str = "rich",
    template_id: str = "personal-classic",
    *,
    mode: str = "proper",
    split: dict | None = None,
    section_order: list[str] | None = None,
) -> dict[str, Any]:
    """Keyword arguments for client_draft.build_client_brief from a fixture profile."""
    data = copy.deepcopy(PROFILES[profile_name])
    manifest = json.loads((BACKEND_DIR / "templates" / template_id / "manifest.json").read_text())
    return {
        "profile": data["profile"],
        "experiences": data["experiences"],
        "projects": data["projects"],
        "education": data["education"],
        "extracurriculars": data["extracurriculars"],
        "template_manifest": manifest,
        "content_split": split or {"experience": 2, "projects": 2},
        "creativity_mode": mode,
        "section_order": section_order or manifest.get("default_section_order"),
        "job_description": JOB_DESCRIPTION,
        "job_title": JOB_TITLE,
        "company": COMPANY,
        "instructions": None,
    }


# ── Draft builders ────────────────────────────────────────────────────────────

# Long, realistic bullets; builders cut them at a word boundary to an exact visible length.
BULLET_BANK = [
    "Rebuilt the shipment-pricing API with **FastAPI** and **PostgreSQL**, cutting p95 latency from **820ms** to **140ms** at **3,000 requests per second** while keeping the public contract stable for partners and adding contract tests for every endpoint and payload version",
    "Introduced **Redis** read-through caching and a query-plan review for hot paths in **PostgreSQL**, lowering database CPU by **45%** during peak hours and removing two read replicas from the monthly infrastructure bill without any customer-facing regressions",
    "Moved **14 services** to **Kubernetes** on **AWS** with reusable **Terraform** modules and **GitHub Actions** pipelines, turning a manual two-day release process into a reviewed, repeatable deploy that any engineer on the team could run safely",
    "Built **Kafka** consumers in **Python** that stream **12M lab events per day** into the analytics warehouse with exactly-once writes, dead-letter queues and replay tooling that the on-call engineers use to recover from upstream outages quickly",
    "Wrote **Airflow** DAGs for nightly claims reconciliation in **Python** and **SQL**, replacing a manual **6-hour** spreadsheet process with checked, idempotent jobs and alerting that finance now relies on for month-end close every single month",
    "Added **Prometheus** metrics and **Grafana** dashboards for every patient-facing service, defining latency and error budgets with product owners so incidents are caught by alerts before support tickets arrive from clinics and partner hospitals",
    "Built **FeatureLake**, a **gRPC** feature store with **Redis** caching that serves **25K lookups per second** on one node at a **4ms** p99, with point-in-time joins over **PostgreSQL** partitions for reproducible training sets and backfills",
    "Created **QueryScope** in **Python** to capture **EXPLAIN** plans for **300 critical queries** in **GitHub Actions**, failing builds on **2x** cost regressions so slow migrations are caught in review instead of in production traffic at peak load",
    "Developed **Driftwatch** with **FastAPI** and **scikit-learn** to compute population stability for **40 features** every hour, sending **Prometheus** alerts to model owners when inputs drift beyond agreed thresholds for more than a day",
    "Maintained **Python** ETL jobs loading point-of-sale data from **220 stores** into **PostgreSQL**, adding schema checks and retries that made the daily load reliable enough for store managers to plan staffing from it each morning",
    "Rewrote slow reporting queries in **SQL** with covering indexes and materialized views, cutting the daily sales report from **40 minutes** to **7** and freeing the shared **PostgreSQL** instance for analysts during business hours",
    "Mentored **4 engineers** through design reviews and pairing on **Python** service ownership, and ran the weekly incident review that turned recurring pages into tracked fixes with owners, deadlines and follow-up checks in the next sprint",
]

EXTRA_BANK = [
    "Spoke at **PyCon US** on caching patterns for **Python** APIs to an audience of about 400 attendees, covering cache keys, invalidation and load testing",
    "Mentor high-school students at Code Nation learning web development, reviewing weekly projects and coaching them through their first deployed apps",
    "Won first place of 35 teams at Bay Area Civic Hack by building a transit delay predictor in 24 hours with open city data",
]


def cut_to(text: str, n: int) -> str:
    """Cut ``text`` at a word boundary to at most ``n`` visible characters (``**`` not counted), bold balanced."""
    words = text.split(" ")
    out: list[str] = []
    for w in words:
        candidate = " ".join([*out, w])
        if len(candidate.replace("**", "")) > n:
            break
        out.append(w)
    s = " ".join(out).rstrip(" ,;:")
    if s.count("**") % 2:
        cut = s.rfind("**")
        s = s[:cut] + s[cut + 2:]
    return s


def light_bold(text: str, keep: int = 2) -> str:
    """A proper-mode bullet: only the first ``keep`` bold spans stay bold (bank bullets carry 4-6)."""
    count = {"n": 0}

    def repl(m: re.Match) -> str:
        count["n"] += 1
        return m.group(0) if count["n"] <= keep else m.group(1)

    return re.sub(r"\*\*(.+?)\*\*", repl, text)


def bullet(i: int, n: int, *, light: bool = False) -> str:
    text = BULLET_BANK[i % len(BULLET_BANK)]
    return cut_to(light_bold(text) if light else text, n)


def _ids(snapshot: dict, section: str) -> list[str]:
    return [e["source_id"] for e in snapshot.get(section) or []]


def make_draft(
    snapshot: dict,
    *,
    bullet_chars: int | list[int] = 180,
    bullets_per_entry: int | None = None,
    extras: int | None = None,
    extra_chars: int = 130,
    summary_words: int = 28,
    skills: dict[str, list[str]] | None = None,
    experience_ids: list[str] | None = None,
    project_ids: list[str] | None = None,
    light: bool = False,
) -> dict:
    """A structurally valid client draft for ``snapshot`` with controlled lengths.

    ``bullet_chars`` is one length for every bullet or a list consumed in page order (experiences then
    projects, cycling). ``bullets_per_entry`` defaults to the template maximum.
    """
    req = snapshot["requirements"]
    lengths = bullet_chars if isinstance(bullet_chars, list) else [bullet_chars]
    counter = {"i": 0}

    def next_bullet() -> str:
        k = counter["i"]
        counter["i"] += 1
        return bullet(k, lengths[k % len(lengths)], light=light)

    exp_ids = experience_ids or _ids(snapshot, "experiences")[: req["experiences"]]
    proj_ids = project_ids or _ids(snapshot, "projects")[: req["projects"]]
    n_exp_b = bullets_per_entry or req["bullets_per_experience"]["max"]
    n_proj_b = bullets_per_entry or req["bullets_per_project"]["max"]
    summary_words_bank = (
        "Backend engineer with eight years building **Python** services, **PostgreSQL** data models and **Kubernetes** "
        "platforms that keep ML features fast, observable and cheap to run for product teams across healthcare, retail "
        "and logistics companies"
    ).split()
    n_extra = req["extracurriculars_max"] if extras is None else extras
    return {
        "job_analysis": {
            "job_title": JOB_TITLE, "company": COMPANY,
            "key_requirements": ["Python backend services", "PostgreSQL performance", "Kubernetes on AWS"],
            "extracted_skills": ["Python", "FastAPI", "PostgreSQL", "Redis", "Kafka", "Airflow", "Kubernetes", "AWS", "Terraform"],
        },
        "summary": " ".join(summary_words_bank[:summary_words]),
        "skills": skills or {
            "Languages": ["Python", "SQL", "Go"],
            "Backend & APIs": ["FastAPI", "gRPC", "REST", "Kafka"],
            "Databases & Data": ["PostgreSQL", "Redis", "Airflow"],
            "DevOps & Tools": ["Docker", "Kubernetes", "AWS", "Terraform", "GitHub Actions"],
            "Soft Skills": ["Mentoring", "Incident reviews", "Design docs"],
        },
        "experiences": [{"source_id": sid, "bullet_points": [next_bullet() for _ in range(n_exp_b)]} for sid in exp_ids],
        "projects": [
            {
                "source_id": sid, "project_summary": "Feature Store", "description": "Open-source ML feature store.",
                "technologies": ["Python", "Redis", "PostgreSQL"],
                "bullet_points": [next_bullet() for _ in range(n_proj_b)],
            }
            for sid in proj_ids
        ],
        "extracurriculars": [
            {"source_id": sid, "description": cut_to(EXTRA_BANK[k % len(EXTRA_BANK)], extra_chars)}
            for k, sid in enumerate(_ids(snapshot, "extracurriculars")[:n_extra])
        ],
    }


# Bullet length a server-style full résumé uses: the top of the 2-line window at the font a full
# résumé fits at (personal-classic ~10.9pt, professional-sans 11.0pt). Independent of the brief's
# estimates, which are kept 2-line-safe at the maximum font instead.
FULL_BULLET_CHARS = {"personal-classic": 200, "professional-sans": 190}


def full_draft(snapshot: dict) -> dict:
    """A typical server-style draft: max bullets near the top of the 2-line window at the fitted font,
    full summary, every allowed extracurricular kept to one line."""
    req = snapshot["requirements"]
    top = FULL_BULLET_CHARS.get(snapshot.get("template_id"), req["bullet_visible_chars"]["target_max"])
    return make_draft(
        snapshot,
        bullet_chars=[top, top - 2, top + 1, top - 1],
        extra_chars=req["extracurricular_visible_chars"]["one_line_max"] - 5,
    )


def brief_draft(snapshot: dict, *, bullets_per_entry: int | None = None, mid: bool = False) -> dict:
    """A client that follows the brief's length estimates (top of the estimated window, or around its
    midpoint), bolding like the mode asks: proper bullets carry ~2 bold spans, LARP ones 4-6."""
    req = snapshot["requirements"]
    fit = req["bullet_visible_chars"]
    centre = (fit["target_min"] + fit["target_max"]) // 2
    lengths = [centre, centre - 2, centre + 2, centre + 1] if mid else [fit["target_max"], fit["target_min"] + 4, fit["target_max"] - 3]
    return make_draft(
        snapshot,
        bullet_chars=lengths,
        bullets_per_entry=bullets_per_entry,
        extra_chars=req["extracurricular_visible_chars"]["one_line_max"] - 5,
        light=snapshot.get("creativity_mode") == "proper",
    )


def thin_draft(snapshot: dict) -> dict:
    """Short one-line bullets, short summary, no extracurriculars: leaves the page visibly empty."""
    return make_draft(snapshot, bullet_chars=80, bullets_per_entry=2, extras=0, summary_words=12)


def huge_draft(snapshot: dict) -> dict:
    """Max entries x max bullets of ~245 visible chars (3 lines each): cannot fit one page at any font."""
    return make_draft(snapshot, bullet_chars=245, summary_words=30, extra_chars=170)

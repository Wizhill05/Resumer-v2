"""Render a reproducible layout matrix without a database or LLM call.

Run from backend: .venv/bin/python scripts/measure_professional_sans.py
PDFs and machine-readable measurements go to /tmp/resumer-sans-design.
"""
from __future__ import annotations

import copy
import json
import re
import pypdfium2 as pdfium
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from weasyprint import HTML
from src.core.config import settings
from src.services.resume_render import render_resume_html, fit_and_render_pdf
from src.template_registry.service import TemplateRegistryService

OUT = Path('/tmp/resumer-sans-design')
OUT.mkdir(exist_ok=True)
sample = json.loads((settings.BACKEND_DIR / 'sample-resume/dario-altman.json').read_text())
concise = copy.deepcopy(sample)
r = concise['resume']
r['summary'] = 'AI infrastructure engineer building model-serving platforms with Python, Kubernetes, and PyTorch. Experienced in inference optimization, production monitoring, and reliable deployment workflows.'
r['experiences'][0]['bullet_points'] = [
    'Designed a shared inference platform for language and embedding models, giving product teams a consistent API and reusable production deployment templates.',
    'Introduced dynamic batching and queue-based autoscaling, reducing median serving cost by **31%** while maintaining customer latency targets across representative workloads.',
    'Established latency budgets, tracing, and release checks that cut high-severity serving incidents by **40%** and accelerated investigations for on-call engineering teams.',
]
r['experiences'][1]['bullet_points'] = [
    'Developed containerized services and deployment tooling for internal data products, improving release consistency across four engineering teams and simplifying operational handoffs.',
    'Built a load-testing pipeline and capacity reports that revealed bottlenecks before launches, reduced manual performance checks, and supported planning across engineering teams.',
    'Partnered with data scientists to deploy prediction models as monitored services, documenting ownership and deployment procedures and testing rollback paths for production releases.',
]
r['projects'][0]['bullet_points'] = [
    'Built a configurable benchmark suite comparing throughput, tail latency, and memory use across inference backends with realistic request shapes and repeatable traffic.',
    'Added workload fixtures and performance reports to help teams review changes before deployment and compare inference results across different hardware configurations.',
    'Documented benchmark setup and trade-offs so engineers could reproduce results on a single GPU or shared cluster and select suitable inference backends.',
]
r['projects'][1]['bullet_points'] = [
    'Created a dashboard linking request traces, queue depth, GPU utilization, and error rates to help engineers investigate resource constraints during model-serving incidents.',
    'Implemented alert examples and a lightweight replay tool to investigate latency regressions, reproduce failed requests, and compare model behavior across production releases.',
    'Published a sample deployment with synthetic traffic and practical runbooks for local exploration, onboarding, and troubleshooting exercises across serving environments with teammates.',
]
r['extracurriculars'][0]['description'] = 'Maintain an open-source model evaluation toolkit and mentor engineers through a local machine learning reading group.'
# Additional fictional entries are capacity fixtures, never candidate claims.
extra_exp = dict(role='Backend Engineering Intern', organization='Northline Systems', location='Austin, TX', start_date='2017-06-01', end_date='2017-08-01', bullet_points=[
    'Implemented Python API endpoints for an internal support dashboard, validating request payloads and adding integration checks for common customer account lookup workflows.',
    'Added structured request logs and operational documentation so engineers could reproduce support issues and trace failed account updates across service boundaries.',
    'Collaborated with support engineers to simplify repetitive account checks, replacing manual database queries with documented dashboard actions and consistent error messages.',
])
extra_proj = dict(name='Release Ledger', project_summary='Deployment audit service', github_url='https://github.com/example/release-ledger', bullet_points=[
    'Built a deployment audit service recording release metadata and health checks, giving on-call engineers a searchable timeline of changes across production environments.',
    'Connected CI workflows to PostgreSQL-backed audit records, capturing deployment status and rollback references so teams could investigate failed releases without searching build logs.',
    'Added API pagination, database migrations, and integration tests to support predictable audit queries and document recovery steps for failed deployment event ingestion.',
])
extended = copy.deepcopy(concise)
extended['resume']['experiences'].append(extra_exp)
extended['resume']['projects'].append(extra_proj)
long = copy.deepcopy(extended)
for key in ('experiences','projects'):
    long['resume'][key][:2] = copy.deepcopy(sample['resume'][key])
cases = {'sample-2x2':sample,'concise-2x2':concise,'concise-3x3':extended,'long-3x3':long}
# A second degree, longer identity fields, and expanded skills consume real space.
stress = copy.deepcopy(extended)
stress['profile']['full_name'] = 'Alexandra Montgomery-Richardson'
stress['profile']['email'] = 'alexandra.montgomery.richardson@example.com'
stress['resume']['education'].append(dict(degree='M.S. in Computer Science',institution='Northern Metropolitan Institute of Technology',location='Chicago, IL',start_date='2019-09-01',end_date='2021-05-01',gpa='3.9/4.0'))
stress['resume']['experiences'][0]['role'] = 'Senior Software Engineer, Machine Learning Infrastructure'
stress['resume']['experiences'][0]['organization'] = 'International Research and Cloud Infrastructure Group'
stress['resume']['skills']['Infrastructure'] += ['Amazon Web Services','Google Cloud Platform','continuous integration','distributed systems']
cases['stress-3x3'] = stress
for name, source in [('budget-2x2', concise), ('budget-3x3', extended), ('budget-stress-3x3', stress)]:
    budget = copy.deepcopy(source)
    for section in ('experiences', 'projects'):
        for entry in budget['resume'][section]:
            entry['bullet_points'] = entry['bullet_points'][:2]
    cases[name] = budget
rows=[]
for name,data in cases.items():
    (OUT / f'{name}.json').write_text(json.dumps(data,indent=2)+'\n')
    for fs in (9,9.5,10,10.5,11,11.5,12):
        html = render_resume_html(template_id='professional-sans',profile=data['profile'],resume=data['resume'],font_size=fs,page_margin_mm=14)
        assert html
        doc = HTML(string=html,base_url=str(settings.TEMPLATES_DIR/'professional-sans')).render()
        doc.write_pdf(OUT/f'{name}-{fs:g}pt.pdf')
        textboxes = [b for page in doc.pages for b in page._page_box.descendants() if type(b).__name__=='TextBox']
        page=doc.pages[-1]._page_box
        bottom=max(b.position_y+b.height for b in page.descendants() if type(b).__name__=='TextBox')
        right=doc.pages[0].width-14*96/25.4
        overflow=[b for b in textboxes if b.position_x < 14*96/25.4-1 or b.position_x+b.width>right+1]
        vertical_overflow = [b for b in textboxes if b.position_y < 14*96/25.4-1 or b.position_y+b.height > (297-14)*96/25.4+1]
        rows.append(dict(vertical_overflows=len(vertical_overflow),case=name,font_pt=fs,pages=len(doc.pages),last_page_bottom_mm=round(bottom*25.4/96,2),bottom_clearance_mm=round(297-14-bottom*25.4/96,2),horizontal_overflows=len(overflow),words=len(' '.join(b.text for b in textboxes).split())))
    m=TemplateRegistryService.get_template_manifest('professional-sans')
    pdf,fit=fit_and_render_pdf(template_id=m.id,profile=data['profile'],resume=data['resume'],manifest=m.model_dump())
    (OUT/f'{name}-auto.pdf').write_bytes(pdf)
    print(name,fit)
(OUT/'measurements.json').write_text(json.dumps(rows,indent=2)+'\n')
for row in rows:
    print(json.dumps(row))

assert all(row['horizontal_overflows'] == row['vertical_overflows'] == 0 for row in rows)
for name, fs in [('budget-2x2', 11), ('budget-3x3', 9)]:
    pdf = pdfium.PdfDocument(OUT / f'{name}-{fs:g}pt.pdf')
    assert len(pdf) == 1, (name, 'expected one page')
    text = ''.join(page.get_textpage().get_text_range() for page in pdf)
    def normalize(value):
        return re.sub(r'\s+', '', value.replace('**', ''))
    for key in ('projects', 'experiences'):
        for entry in cases[name]['resume'][key]:
            for bullet in entry['bullet_points']:
                assert normalize(bullet) in normalize(text), (name, 'missing bullet', bullet)
print('Verified target page counts, text bounds for every fixed-size render, and all target-case bullets.')

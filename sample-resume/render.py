"""Render the fictional sample with the project's actual template and PDF renderer."""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
from src.services.resume_render import fit_and_render_pdf

sample = json.loads((root / "sample-resume/dario-altman.json").read_text())
manifest = json.loads((root / "backend/templates/personal-classic/manifest.json").read_text())
pdf, fit = fit_and_render_pdf(template_id="personal-classic", manifest=manifest, **sample)
(root / "sample-resume/dario-altman.pdf").write_bytes(pdf)
print(fit)

import json
from pathlib import Path
from src.core.config import settings
from src.schemas.template import TemplateManifest


class TemplateRegistryService:
    @staticmethod
    def list_templates() -> list[TemplateManifest]:
        templates = []
        templates_dir = settings.TEMPLATES_DIR
        if not templates_dir.exists():
            return []

        for item in templates_dir.iterdir():
            if item.is_dir():
                manifest_path = item / "manifest.json"
                if manifest_path.exists():
                    try:
                        with open(manifest_path, encoding="utf-8") as f:
                            data = json.load(f)
                            templates.append(TemplateManifest(**data))
                    except Exception as e:
                        print(f"Error loading template manifest for {item.name}: {e}")
        return templates

    @staticmethod
    def get_template_manifest(template_id: str) -> TemplateManifest | None:
        manifest_path = settings.TEMPLATES_DIR / template_id / "manifest.json"
        if not manifest_path.exists():
            return None
        try:
            with open(manifest_path, encoding="utf-8") as f:
                data = json.load(f)
                return TemplateManifest(**data)
        except Exception:
            return None

    @staticmethod
    def get_template_html(template_id: str) -> str | None:
        template_path = settings.TEMPLATES_DIR / template_id / "template.jinja2"
        if not template_path.exists():
            return None
        try:
            return template_path.read_text(encoding="utf-8")
        except Exception:
            return None

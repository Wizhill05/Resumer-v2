import json
import re
from pathlib import Path
from jinja2 import Environment, FileSystemLoader
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

    @staticmethod
    def get_jinja_env(template_id: str) -> Environment | None:
        """Return a Jinja2 Environment with FileSystemLoader rooted at templates dir.
        Supports {% include %} for loading style.css and other partials."""
        template_dir = settings.TEMPLATES_DIR / template_id
        if not template_dir.exists():
            return None
        # Root loader at templates/ so includes like 'personal-classic/style.css' resolve
        env = Environment(
            loader=FileSystemLoader(str(settings.TEMPLATES_DIR)),
            autoescape=False,
        )
        
        def format_date(value: str) -> str:
            if not value:
                return ""
            try:
                # If it is in YYYY-MM-DD format
                from datetime import datetime
                dt = datetime.strptime(value, "%Y-%m-%d")
                return dt.strftime("%b %Y")  # e.g., "Jun 2023"
            except Exception:
                return str(value)

        def markdown_filter(value: str) -> str:
            if not value:
                return ""
            # Replace **text** with <strong>text</strong>
            value = re.sub(r"\*\*(.*?)\*\*", r"<strong>\1</strong>", value)
            # Replace *text* with <em>text</em>
            value = re.sub(r"\*(.*?)\*", r"<em>\1</em>", value)
            # Replace `text` with <code>text</code>
            value = re.sub(r"`([^`]*)`", r"<code>\1</code>", value)
            return value

        env.filters["format_date"] = format_date
        env.filters["markdown"] = markdown_filter
        return env

    @staticmethod
    def render_template(template_id: str, context: dict) -> str | None:
        """Render a template with the given context using FileSystemLoader."""
        env = TemplateRegistryService.get_jinja_env(template_id)
        if not env:
            return None
        try:
            template = env.get_template(f"{template_id}/template.jinja2")
            return template.render(**context)
        except Exception as e:
            print(f"Error rendering template {template_id}: {e}")
            return None

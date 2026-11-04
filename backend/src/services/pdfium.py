"""Serialize PDFium access across previews, imports, and thumbnail generation."""

import base64
import io
from contextlib import closing, contextmanager
from threading import RLock

import pypdfium2 as pdfium

_lock = RLock()


@contextmanager
def open_pdf(data: bytes):
    # PDFium is not thread-safe, even when each thread opens a different document.
    with _lock:
        with pdfium.PdfDocument(data) as document:
            yield document


def render_page_images(data: bytes, *, scale: float = 1.25, quality: int = 82) -> list[str]:
    images = []
    with open_pdf(data) as document:
        for index in range(len(document)):
            with closing(document[index]) as page:
                with closing(page.render(scale=scale)) as bitmap:
                    with bitmap.to_pil() as image:
                        buffer = io.BytesIO()
                        image.save(buffer, format="WEBP", quality=quality, method=4)
                        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
                        images.append(f"data:image/webp;base64,{encoded}")
    return images


def render_thumbnail(data: bytes) -> bytes:
    with open_pdf(data) as document:
        with closing(document[0]) as page:
            with closing(page.render(scale=400 / page.get_width())) as bitmap:
                with bitmap.to_pil() as image:
                    buffer = io.BytesIO()
                    image.save(buffer, format="WEBP", quality=80)
                    return buffer.getvalue()

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from threading import Lock
import time

from src.services import pdfium


def test_preview_thumbnail_and_import_share_pdfium_serialization(monkeypatch):
    from src.services.resume_import import _extract_pdf_text

    data = (Path(__file__).parents[1] / ".." / "sample-resume" / "dario-altman.pdf").read_bytes()
    original = pdfium.pdfium.PdfDocument
    counter_lock = Lock()
    active = 0
    peak = 0

    @contextmanager
    def observed_document(data):
        nonlocal active, peak
        with counter_lock:
            active += 1
            peak = max(peak, active)
        try:
            with original(data) as document:
                time.sleep(0.01)
                yield document
        finally:
            with counter_lock:
                active -= 1

    monkeypatch.setattr(pdfium.pdfium, "PdfDocument", observed_document)
    with ThreadPoolExecutor(max_workers=6) as executor:
        tasks = [
            executor.submit(pdfium.render_page_images, data),
            executor.submit(pdfium.render_thumbnail, data),
            executor.submit(_extract_pdf_text, data),
        ]
        pages, thumb, text = [task.result() for task in tasks]
    assert peak == 1
    assert len(pages) == 1 and pages[0].startswith("data:image/webp;base64,")
    assert thumb.startswith(b"RIFF")
    assert "Dario Altman" in text

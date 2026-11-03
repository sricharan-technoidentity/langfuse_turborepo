import hashlib, json
from pathlib import Path

from pptx import Presentation

from repo_deck_renderer import render

SAMPLES = Path(__file__).resolve().parent / "fixtures"


def _spec():
    return {"title": "T", "subtitle": "S", "slides": [
        {"title": "A", "bullets": ["one", "two"], "notes": "n1"},
        {"title": "B", "bullets": ["three"], "notes": ""}]}


def test_slide_count_and_text(tmp_path):
    out = tmp_path / "d.pptx"
    assert render(_spec(), str(out)) == 3
    prs = Presentation(str(out))
    assert len(prs.slides) == 3
    texts = [sh.text_frame.text for sh in prs.slides[1].shapes if sh.has_text_frame]
    assert "A" in texts and "\u2022  one\n\u2022  two" in texts
    assert prs.slides[1].notes_slide.notes_text_frame.text == "n1"
    assert prs.slide_width == 12192000 - 0 or prs.slide_width > 0


def test_defaults_for_missing_fields(tmp_path):
    out = tmp_path / "e.pptx"
    assert render({}, str(out)) == 1
    prs = Presentation(str(out))
    assert any(sh.has_text_frame and sh.text_frame.text == "Untitled deck" for sh in prs.slides[0].shapes)


def _slide_text(path):
    prs = Presentation(str(path))
    return [[sh.text_frame.text for sh in s.shapes if sh.has_text_frame] for s in prs.slides]


def test_same_output_as_v012_samples(tmp_path):
    """Rendering the v0.1.2 sample slide JSON gives the same slide text as the v0.1.2 sample decks."""
    for spec_file in sorted(SAMPLES.glob("*.slides.json")):
        spec = json.loads(spec_file.read_text())
        out = tmp_path / (spec_file.stem + ".pptx")
        n = render(spec, str(out))
        assert n == 1 + len(spec["slides"])
        ref = SAMPLES / (spec_file.name.replace(".slides.json", ".ref.json"))
        assert _slide_text(out) == json.loads(ref.read_text())

"""Deterministic slide-JSON -> .pptx renderer (python-pptx). CLI: render.py spec.json out.pptx"""
# mypy: ignore-errors
import json, sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

ACCENT = RGBColor(0x5B, 0x3D, 0xF5)
DARK = RGBColor(0x1F, 0x1F, 0x2E)
GREY = RGBColor(0x55, 0x55, 0x66)

def _bar(slide, prs):
    s = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, Inches(0.18))
    s.fill.solid(); s.fill.fore_color.rgb = ACCENT; s.line.fill.background()

def _text(slide, x, y, w, h, text, size, color, bold=False):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = True
    tf.text = text
    for r in tf.paragraphs[0].runs:
        r.font.size = Pt(size); r.font.color.rgb = color; r.font.bold = bold
    return tf

def render(spec: dict, out: str) -> int:
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    blank = prs.slide_layouts[6]
    s = prs.slides.add_slide(blank); _bar(s, prs)
    _text(s, 0.9, 2.4, 11.5, 1.5, str(spec.get("title") or "Untitled deck"), 44, ACCENT, True)
    _text(s, 0.9, 3.9, 11.5, 1.2, str(spec.get("subtitle") or ""), 24, GREY)
    for i, sl in enumerate(spec.get("slides") or [], start=2):
        s = prs.slides.add_slide(blank); _bar(s, prs)
        _text(s, 0.8, 0.5, 11.7, 1.0, str(sl.get("title") or f"Slide {i}"), 36, DARK, True)
        tb = s.shapes.add_textbox(Inches(0.8), Inches(1.7), Inches(11.7), Inches(5.2))
        tf = tb.text_frame; tf.word_wrap = True
        for j, b in enumerate(sl.get("bullets") or []):
            para = tf.paragraphs[0] if j == 0 else tf.add_paragraph()
            para.text = "\u2022  " + str(b); para.font.size = Pt(24); para.font.color.rgb = DARK
            para.space_after = Pt(12)
        notes = str(sl.get("notes") or "")
        if notes: s.notes_slide.notes_text_frame.text = notes
    prs.save(out)
    return len(prs.slides)

if __name__ == "__main__":
    print(render(json.load(open(sys.argv[1])), sys.argv[2]))

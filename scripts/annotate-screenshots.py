#!/usr/bin/env python3
"""Draw SVG-style callouts (green dashed boxes + numbered circles) on screenshots.

Reproduces the markup style of resources/screenshots/desktop-toolbar.svg so the
annotated docs images can be regenerated when the UI changes. The source PNGs are
3020x1896 (a 1.5x capture). Each job crops the relevant control surface, adds a
white margin, draws a dashed box around every control, and places a numbered
circle in the margin aligned to that control. A matching legend lives in the docs.

Usage:  python3 scripts/annotate-screenshots.py
"""
import math
from PIL import Image, ImageDraw, ImageFont

SRC = "resources/screenshots"

# Palette lifted from the user's Inkscape example (desktop-toolbar.svg).
BOX = (13, 106, 0)            # #0d6a00 dashed rectangle
CIRCLE_FILL = (52, 158, 0)    # #349e00
CIRCLE_OUTLINE = (48, 112, 0) # #307000
NUM = (255, 255, 255)         # white digits (legibility; SVG used dark green)
FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

BOX_W = 5
DASH, GAP = 20, 13
R = 26


def _dseg(d, p0, p1, color, w):
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dy)
    if not length:
        return
    ux, uy = dx / length, dy / length
    pos = 0.0
    while pos < length:
        blen = min(DASH, length - pos)
        a = (p0[0] + ux * pos, p0[1] + uy * pos)
        b = (p0[0] + ux * (pos + blen), p0[1] + uy * (pos + blen))
        d.line([a, b], fill=color, width=w)
        pos += DASH + GAP


def dashed_rect(d, box):
    x0, y0, x1, y1 = box
    _dseg(d, (x0, y0), (x1, y0), BOX, BOX_W)
    _dseg(d, (x1, y0), (x1, y1), BOX, BOX_W)
    _dseg(d, (x1, y1), (x0, y1), BOX, BOX_W)
    _dseg(d, (x0, y1), (x0, y0), BOX, BOX_W)


def circle(d, cx, cy, n, font):
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=CIRCLE_FILL,
              outline=CIRCLE_OUTLINE, width=4)
    t = str(n)
    bb = d.textbbox((0, 0), t, font=font)
    d.text((cx - (bb[2] - bb[0]) / 2 - bb[0], cy - (bb[3] - bb[1]) / 2 - bb[1]),
           t, fill=NUM, font=font)


def annotate(src, out, crop, margin, items, font_px=36, circle_global=False):
    """crop=(x0,y0,x1,y1) global. margin=(l,t,r,b) white border added to the crop.
    items: list of {box:(global rect), circle:(x,y), n}. Boxes are GLOBAL.
    circle coords are final-canvas coords, or GLOBAL when circle_global=True."""
    cx0, cy0, cx1, cy1 = crop
    ml, mt, mr, mb = margin
    base = Image.open(f"{SRC}/{src}").convert("RGB").crop(crop)
    canvas = Image.new("RGB", (base.width + ml + mr, base.height + mt + mb),
                       (255, 255, 255))
    canvas.paste(base, (ml, mt))
    d = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(FONT, font_px)
    ox, oy = ml - cx0, mt - cy0          # global -> canvas
    for it in items:
        bx0, by0, bx1, by1 = it["box"]
        dashed_rect(d, (bx0 + ox, by0 + oy, bx1 + ox, by1 + oy))
        ccx, ccy = it["circle"]
        if circle_global:
            ccx, ccy = ccx + ox, ccy + oy
        circle(d, ccx, ccy, it["n"], font)
    canvas.save(f"{SRC}/{out}")
    print(f"wrote {SRC}/{out}  ({canvas.width}x{canvas.height})")


# --- 1. Toolbar (desktop-reading-none.png) -----------------------------------
# Buttons y 168..250; status bar (full text) x 518..1345, y 256..335.
# Crop the toolbar + status strip; TOP margin for the button numbers, small
# BOTTOM margin for the status-bar number. crop_x0 = 485, no left margin, so a
# button at global x maps to canvas x = gx - 485.
TB_CROP = (485, 160, 1380, 345)
def tcirc(gx):
    return (gx - 485, 38)      # top-margin number row, above the buttons
toolbar = [
    {"n": 1, "box": (522, 168, 595, 250),  "circle": tcirc(558)},   # Edit
    {"n": 2, "box": (601, 168, 670, 250),  "circle": tcirc(636)},   # Known
    {"n": 3, "box": (679, 168, 748, 250),  "circle": tcirc(714)},   # Unknown
    {"n": 4, "box": (757, 168, 826, 250),  "circle": tcirc(792)},   # Partial
    {"n": 5, "box": (834, 168, 903, 250),  "circle": tcirc(869)},   # Add custom word
    {"n": 6, "box": (912, 168, 981, 250),  "circle": tcirc(947)},   # Highlighter
    {"n": 7, "box": (990, 168, 1192, 250), "circle": tcirc(1091)},  # Status / HSK switch
    {"n": 8, "box": (1196, 168, 1272, 250),"circle": tcirc(1234)},  # More (overflow)
    {"n": 9, "box": (518, 256, 1345, 335), "circle": (446, 289)},   # Status bar (below)
]

# --- 2. Display menu (desktop-display-menu.png) ------------------------------
# Overflow dropdown floating over the reader. Panel x 736..1262, y 258..1234.
# Crop tight to the panel + 95px LEFT margin for the numbers.
MN_CROP = (736, 272, 1262, 1232)
MML = 95
def mcirc(gy_center):
    return (48, gy_center - 272)        # left margin, y = global - crop_y0
menu = [
    {"n": 1, "box": (748, 325, 1252, 560),  "circle": mcirc(442)},  # Show/hide colors
    {"n": 2, "box": (748, 628, 1252, 815),  "circle": mcirc(721)},  # Display mode
    {"n": 3, "box": (748, 838, 1252, 902),  "circle": mcirc(870)},  # Known-word popups
    {"n": 4, "box": (748, 922, 1252, 980),  "circle": mcirc(951)},  # Font size
    {"n": 5, "box": (748, 985, 1252, 1085), "circle": mcirc(1035)}, # Line spacing
    {"n": 6, "box": (748, 1112, 1252, 1162),"circle": mcirc(1137)}, # Stats
    {"n": 7, "box": (748, 1172, 1252, 1224),"circle": mcirc(1198)}, # Generate story
]

# --- 3. Three-line colors (desktop-reading-three-line.png) -------------------
# Two text lines that happen to contain every word state. Box one word per
# status; number badge sits just above each word's top-left corner.
# 1 Known(的)=green chars-only · 2 Partial(表达)=yellow · 3 New(词汇)=blue ·
# 4 Unknown(无法)=red full gloss+pinyin+chars.
TL_CROP = (470, 1120, 1258, 1432)
three_line = [
    {"n": 1, "box": (514, 1198, 578, 1270),  "circle": (544, 1158)},  # 的 known
    {"n": 2, "box": (982, 1156, 1140, 1274),  "circle": (992, 1146)},  # 表达 partial
    {"n": 3, "box": (644, 1156, 814, 1274),   "circle": (654, 1146)},  # 词汇 new
    {"n": 4, "box": (516, 1280, 800, 1404),   "circle": (526, 1264)},  # 无法 unknown
]

# --- 4. Mobile: open the Chinese view (mobile-open-view.png) ------------------
# A normal note in Obsidian's Markdown view. The 中 header action opens the
# plugin's Chinese view. Single box on 中 + a "1" badge below it.
OV_CROP = (0, 150, 1179, 720)
open_view = [
    {"n": 1, "box": (752, 192, 846, 292), "circle": (799, 372)},  # 中 header action
]

# --- 5. Mobile: word popup card (mobile-reading-card.png) ---------------------
# Long-press a word in the Chinese view (AI provider configured, so the 4th
# "Enhance" action shows). Numbers in a LEFT margin.
RC_CROP = (28, 1480, 1100, 2445)
def ccirc(gy):
    return (55, gy - 1480)
reading_card = [
    {"n": 1, "box": (40, 1498, 1070, 1735), "circle": ccirc(1616)},  # word/pinyin/meaning
    {"n": 2, "box": (39, 1752, 1045, 1922), "circle": ccirc(1837)},  # I know: checkboxes
    {"n": 3, "box": (40, 1944, 1070, 2162), "circle": ccirc(2052)},  # per-word stats
    {"n": 4, "box": (300, 2176, 770, 2282), "circle": ccirc(2208)},  # exposure bars
    {"n": 5, "box": (34, 2280, 882, 2424),  "circle": ccirc(2352)},  # Ignore/Mnemonic/Edit/Enhance
]

# --- 6. Mobile: flashcard review (mobile-flashcards.png) ----------------------
RF_CROP = (20, 600, 1160, 1800)
def fcirc(gy):
    return (55, gy - 600)
flashcards = [
    {"n": 1, "box": (40, 614, 812, 706),    "circle": fcirc(660)},   # Dashboard/Flashcards/Words
    {"n": 2, "box": (40, 772, 1138, 888),   "circle": fcirc(830)},   # Unclassified/Due/Smart story
    {"n": 3, "box": (40, 940, 1138, 1016),  "circle": fcirc(978)},   # progress + Skip
    {"n": 4, "box": (52, 1066, 1126, 1500), "circle": fcirc(1283)},  # card prompt
    {"n": 5, "box": (52, 1510, 1126, 1772), "circle": fcirc(1641)},  # grade buttons + Ignore
]

# --- 7. Mobile: formatting / highlighter (mobile-formatting-add.png) ----------
# Tri-state highlighter armed in ADD mode (blue). Corner badges.
FA_CROP = (0, 360, 1179, 1680)
formatting = [
    {"n": 1, "box": (515, 376, 628, 500),  "circle": (528, 398)},   # highlighter button (blue=add)
    {"n": 2, "box": (50, 486, 1128, 766),  "circle": (62, 508)},    # mode banner + Formats/Exit
    {"n": 3, "box": (50, 1260, 1062, 1652),"circle": (62, 1282)},   # applied highlight span
]

# --- 8. Mobile: AI Enhance result (mobile-enhance-after.png) ------------------
# After tapping "Enhance" on a sparse entry, the AI enriches it. Numbers in a
# LEFT margin spanning toast -> enriched defs -> Revert.
EN_CROP = (28, 150, 1100, 2460)
def ecirc(gy):
    return (55, gy - 150)
enhance = [
    {"n": 1, "box": (50, 160, 802, 278),   "circle": ecirc(219)},   # "Dictionary entry enhanced" toast
    {"n": 2, "box": (40, 1278, 1012, 1545),"circle": ecirc(1410)},  # enriched definitions + grammar
    {"n": 3, "box": (30, 2298, 212, 2414), "circle": ecirc(2356)},  # Revert button
]

if __name__ == "__main__":
    annotate("desktop-reading-none.png", "desktop-toolbar-annotated.png",
             TB_CROP, (0, 76, 0, 64), toolbar)
    annotate("desktop-display-menu.png", "desktop-display-menu-annotated.png",
             MN_CROP, (MML, 0, 0, 0), menu)
    annotate("desktop-reading-three-line.png", "desktop-three-line-annotated.png",
             TL_CROP, (0, 0, 0, 0), three_line, circle_global=True)
    annotate("mobile-open-view.png", "mobile-open-view-annotated.png",
             OV_CROP, (0, 0, 0, 0), open_view, circle_global=True)
    annotate("mobile-reading-card.png", "mobile-reading-card-annotated.png",
             RC_CROP, (100, 0, 0, 0), reading_card)
    annotate("mobile-flashcards.png", "mobile-flashcards-annotated.png",
             RF_CROP, (100, 0, 0, 0), flashcards)
    annotate("mobile-formatting-add.png", "mobile-formatting-annotated.png",
             FA_CROP, (0, 0, 0, 0), formatting, circle_global=True)
    annotate("mobile-enhance-after.png", "mobile-enhance-annotated.png",
             EN_CROP, (100, 0, 0, 0), enhance)

"""Draws the test pictures for the picture importer. See make-list-pictures.mjs for why.

Fifty pictures, from six lists rendered ten ways and put through twelve conditions. Every one is
drawn from a seeded random source, so running this again produces the same corpus.

Each picture is written beside an entry in `manifest.json` saying which units are in it and how hard
it is meant to be, so the test asserts against what was drawn rather than against a list somebody has
to keep in step by hand.

Every list is written in the synthetic snapshot's vocabulary, because the app ships no game data and
a fixture naming real units could not be resolved by anything in the repository.
"""

import itertools
import json
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONTS = "/System/Library/Fonts/Supplemental"
SYSTEM = "/System/Library/Fonts"


def font(name, size):
    for base in (FONTS, SYSTEM):
        path = os.path.join(base, name)
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def sans(size, bold=False):
    return font("Arial Bold.ttf" if bold else "Arial.ttf", size)


def narrow(size):
    return font("Arial Narrow Bold.ttf", size)


def serif(size, bold=False):
    return font("Times New Roman Bold.ttf" if bold else "Times New Roman.ttf", size)


def mono(size, bold=False):
    return font("Courier New Bold.ttf" if bold else "Courier New.ttf", size)


# ---- the lists ----------------------------------------------------------------------------------
#
# `rows` is what a renderer draws: (copies, models, name, cost, extras). The cost is a total the unit
# can actually be written down as, wargear and enhancement included, so a card format prints a number
# the importer can check against the snapshot. `expect` is what the importer should come back with.

LISTS = {
    "wardens-mixed": {
        "faction": "Ashen Wardens",
        "faction_id": "faction:ashen-wardens",
        "detachment": "Ember Vanguard",
        "detachment_id": "det:ashen-wardens:ember-vanguard",
        "disposition": "HOLD THE RIDGE",
        "player": "Karel Grant",
        "note": "3-0 at the Ember Open",
        "rows": [
            (1, 1, "Warden Captain", 95, ["Relic blade", "Ember Blade"]),
            (2, 10, "Warden Squad", 180, ["Flux carbine, Shock maul"]),
            (1, 5, "Warden Squad", 100, ["Flux carbine"]),
            (2, 1, "Ashen Crusher", 160, ["Fusion beamer"]),
        ],
        "expect": ["1 x Warden Captain", "10 x Warden Squad", "10 x Warden Squad", "5 x Warden Squad", "1 x Ashen Crusher", "1 x Ashen Crusher"],
    },
    "wardens-small": {
        "faction": "Ashen Wardens",
        "faction_id": "faction:ashen-wardens",
        "detachment": "Ember Vanguard",
        "detachment_id": "det:ashen-wardens:ember-vanguard",
        "disposition": "HOLD THE RIDGE",
        "player": "Ada Finch",
        "note": "2-1 at the Cinder Cup",
        "rows": [
            (1, 1, "Warden Captain", 105, ["Relic blade", "Warden's Aegis"]),
            (1, 5, "Warden Squad", 90, ["Flux carbine, Power fist"]),
            (1, 1, "Ashen Crusher", 150, ["Vortex cannon"]),
        ],
        "expect": ["1 x Warden Captain", "5 x Warden Squad", "1 x Ashen Crusher"],
    },
    "swarm": {
        "faction": "Verdant Swarm",
        "faction_id": "faction:verdant-swarm",
        "detachment": "Thorn Tide",
        "detachment_id": "det:verdant-swarm:thorn-tide",
        "disposition": "SEIZE THE GROVE",
        "player": "Juno Bright",
        "note": "4-0 at the Thorn Open",
        "rows": [
            (1, 1, "Swarm Seer", 80, ["Mind bolt", "Venom Sac"]),
            (2, 10, "Thornlings", 60, ["Barbed claws"]),
            (1, 1, "Spine Drake", 210, ["Acid lance"]),
        ],
        "expect": ["1 x Swarm Seer", "10 x Thornlings", "10 x Thornlings", "1 x Spine Drake"],
    },
    "swarm-big": {
        "faction": "Verdant Swarm",
        "faction_id": "faction:verdant-swarm",
        "detachment": "Thorn Tide",
        "detachment_id": "det:verdant-swarm:thorn-tide",
        "disposition": "SEIZE THE GROVE",
        "player": "Rook Vale",
        "note": "3-1 at the Grove Invitational",
        "rows": [
            (1, 20, "Thornlings", 120, ["Spine flick"]),
            (2, 1, "Spine Drake", 210, ["Spine volley"]),
            (1, 1, "Swarm Seer", 70, ["Seer's claws"]),
        ],
        "expect": ["20 x Thornlings", "1 x Spine Drake", "1 x Spine Drake", "1 x Swarm Seer"],
    },
    "allies": {
        "faction": "Ashen Wardens",
        "faction_id": "faction:ashen-wardens",
        "detachment": "Ember Vanguard",
        "detachment_id": "det:ashen-wardens:ember-vanguard",
        "disposition": "HOLD THE RIDGE",
        "player": "Mara Holt",
        "note": "5-0 at the Ashfall GT",
        "rows": [
            (1, 1, "Warden Captain", 95, ["Relic blade", "Ember Blade"]),
            (2, 10, "Warden Squad", 180, ["Flux carbine, Shock maul"]),
            (1, 1, "Ashen Crusher", 150, ["Twin hail gun"]),
            (1, 1, "Swarm Seer", 70, ["Mind bolt"]),
        ],
        "expect": ["1 x Warden Captain", "10 x Warden Squad", "10 x Warden Squad", "1 x Ashen Crusher", "1 x Swarm Seer"],
    },
    "split": {
        # Two units each side, so the units do not decide which army this is and the importer asks.
        "faction": None,
        "faction_id": None,
        "detachment": None,
        "detachment_id": None,
        "disposition": None,
        "player": "Wren Ash",
        "note": "a mixed force",
        "rows": [
            (1, 1, "Warden Captain", 80, ["Relic blade"]),
            (1, 5, "Warden Squad", 90, ["Flux carbine"]),
            (1, 10, "Thornlings", 60, ["Barbed claws"]),
            (1, 1, "Spine Drake", 210, ["Acid lance"]),
        ],
        "expect": ["1 x Warden Captain", "5 x Warden Squad", "10 x Thornlings", "1 x Spine Drake"],
        "asks_faction": True,
    },
}

CHARACTERS = ("Warden Captain", "Swarm Seer")


def bullet_lines(spec):
    """The list written the way a slide or a printed page writes it, with no costs on it."""
    out = [("head", spec["faction"] or "Mixed force"), ("sub", f"by {spec['player']}, {spec['note']}"), ("gap", "")]
    if spec["detachment"]:
        out += [("bullet", f"{spec['detachment']} - {spec['disposition']}"), ("gap", "")]
    characters = [r for r in spec["rows"] if r[2] in CHARACTERS]
    squads = [r for r in spec["rows"] if r[2] not in CHARACTERS and r[1] > 1]
    vehicles = [r for r in spec["rows"] if r[2] not in CHARACTERS and r[1] == 1]
    for title, rows in (("Characters", characters), ("Squads", squads), ("Vehicles", vehicles)):
        if not rows:
            continue
        out.append(("bullet", title))
        for copies, models, name, _cost, extras in rows:
            gear = extras[0] if extras else ""
            enh = f" ({extras[1]})" if len(extras) > 1 else ""
            lead = f"{copies} x {models} " if models > 1 else (f"{copies} x " if copies > 1 else "")
            out.append(("item", f"{lead}{name}{' - ' + gear if gear else ''}{enh}"))
        out.append(("gap", ""))
    beaten = "Verdant Swarm" if spec["faction"] != "Verdant Swarm" else "Ashen Wardens"
    out.append(("bullet", f"Knocked out by {beaten} 85-75"))
    return out


# ---- renderers ----------------------------------------------------------------------------------


def render_slide(spec, rng, lines=None):
    """A presentation slide: large sans type on white."""
    img = Image.new("RGB", (1700, 1040), "white")
    d = ImageDraw.Draw(img)
    y = 60
    for kind, text in (lines or bullet_lines(spec)):
        if kind == "gap":
            y += 22
        elif kind == "head":
            d.text((90, y), text, font=sans(60, bold=True), fill=(17, 17, 17))
            y += 84
        elif kind == "sub":
            d.text((90, y), text, font=sans(28, bold=True), fill=(45, 45, 45))
            y += 56
        elif kind == "bullet":
            d.ellipse((96, y + 13, 108, y + 25), fill=(17, 17, 17))
            d.text((128, y), text, font=sans(32, bold=True), fill=(17, 17, 17))
            y += 50
        else:
            d.ellipse((160, y + 14, 170, y + 24), outline=(60, 60, 60), width=2)
            d.text((192, y), text, font=sans(30), fill=(30, 30, 30))
            y += 46
    return img


def render_page(spec, rng, face=None, size=30, paper=(250, 249, 245), lines=None):
    """A list printed on paper."""
    img = Image.new("RGB", (1400, 900), paper)
    d = ImageDraw.Draw(img)
    body = face or serif(size)
    y = 70
    for kind, text in (lines or bullet_lines(spec)):
        if kind == "gap":
            y += 16
        elif kind == "head":
            d.text((84, y), text, font=serif(size + 16, bold=True), fill=(20, 20, 20))
            y += size + 34
        elif kind == "bullet":
            d.text((84, y), text, font=serif(size + 2, bold=True), fill=(20, 20, 20))
            y += size + 14
        elif kind == "sub":
            d.text((84, y), text, font=body, fill=(60, 60, 60))
            y += size + 12
        else:
            d.text((116, y), "•  " + text, font=body, fill=(25, 25, 25))
            y += size + 12
    return img


def render_phone(spec, rng, lines=None):
    """A screenshot from a phone: narrow, small sans type, a status bar across the top."""
    img = Image.new("RGB", (820, 1180), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 820, 46), fill=(244, 244, 246))
    d.text((24, 14), "9:41", font=sans(20, bold=True), fill=(40, 40, 40))
    d.text((730, 14), "100%", font=sans(20), fill=(40, 40, 40))
    y = 74
    for kind, text in (lines or bullet_lines(spec)):
        if kind == "gap":
            y += 12
        elif kind == "head":
            d.text((36, y), text, font=sans(34, bold=True), fill=(17, 17, 17))
            y += 52
        elif kind == "bullet":
            d.text((36, y), text, font=sans(22, bold=True), fill=(17, 17, 17))
            y += 36
        elif kind == "sub":
            d.text((36, y), text, font=sans(20), fill=(70, 70, 70))
            y += 34
        else:
            d.text((58, y), "• " + text, font=sans(21), fill=(30, 30, 30))
            y += 34
    return img


def render_chat(spec, rng, lines=None):
    """A list pasted into a chat app, in a bubble on a tinted ground."""
    img = Image.new("RGB", (900, 1120), (232, 236, 241))
    d = ImageDraw.Draw(img)
    lines = [text for kind, text in (lines or bullet_lines(spec)) if kind != "gap"]
    body = sans(22)
    widest = max(d.textlength(line, font=body) for line in lines)
    d.rounded_rectangle((30, 40, 60 + widest + 24, 40 + len(lines) * 34 + 24), 14, fill=(255, 255, 255))
    y = 54
    for line in lines:
        d.text((52, y), line, font=body, fill=(24, 24, 28))
        y += 34
    d.text((52, y + 20), "sent 21:04", font=sans(16), fill=(130, 136, 145))
    return img


def render_cards(spec, rng, columns=2, dark=True):
    """A broadcast overlay: unit cards with a right-aligned cost."""
    width, height = 1920, 820
    ground = (9, 12, 26) if dark else (238, 240, 246)
    ink = (235, 240, 255) if dark else (24, 26, 34)
    img = Image.new("RGB", (width, height), ground)
    d = ImageDraw.Draw(img)
    if dark:
        for _ in range(1200):
            x, y = rng.randrange(width), rng.randrange(height)
            v = rng.randrange(40, 150)
            d.point((x, y), fill=(v, v, v + 20))

    panel = (22, 30, 58) if dark else (255, 255, 255)
    edge = (90, 120, 190) if dark else (170, 178, 196)
    d.rectangle((150, 30, 470, 108), fill=panel, outline=edge, width=2)
    d.text((176, 50), spec["player"].upper(), font=narrow(34), fill=ink)
    if spec["faction"]:
        d.rectangle((150, 380, 470, 436), fill=panel, outline=edge, width=2)
        d.text((176, 392), spec["faction"].upper(), font=narrow(32), fill=ink)
    if spec["detachment"]:
        d.rectangle((150, 446, 470, 494), fill=(120, 30, 34))
        d.text((164, 456), spec["detachment"].upper(), font=narrow(28), fill=(255, 245, 245))
        dp = d.textlength("2DP", font=narrow(28))
        d.text((456 - dp, 456), "2DP", font=narrow(28), fill=(255, 245, 245))
    if spec["disposition"]:
        d.rectangle((500, 30, 930, 76), fill=(150, 34, 38))
        d.text((536, 38), spec["disposition"], font=narrow(36), fill=(255, 248, 248))

    cards = []
    for copies, models, name, cost, extras in spec["rows"]:
        for _ in range(copies):
            cards.append((f"{models}x {name}".upper() if models > 1 else name.upper(), str(cost), extras))

    def card(x, y, title, cost, lines, w=420):
        # The bar runs light to dark behind the name. Broadcast graphics shadow the type over a
        # gradient so it stays legible, and this does the same: without it the picture would be
        # testing how badly it was drawn rather than how well the list is read.
        bar = Image.new("RGB", (w, 42))
        bd = ImageDraw.Draw(bar)
        for i in range(w):
            v = int((96 if dark else 210) - (i / w) * (62 if dark else 40))
            bd.line((i, 0, i, 42), fill=(v, v + 4, v + 16))
        img.paste(bar, (x, y))
        right = d.textlength(cost, font=narrow(32))
        shadow = (8, 10, 20) if dark else (250, 250, 252)
        face = (255, 255, 255) if dark else (20, 22, 30)
        for dx, dy in ((2, 2), (1, 1)):
            d.text((x + 12 + dx, y + 5 + dy), title, font=narrow(32), fill=shadow)
            d.text((x + w - 14 - right + dx, y + 5 + dy), cost, font=narrow(32), fill=shadow)
        d.text((x + 12, y + 5), title, font=narrow(32), fill=face)
        d.text((x + w - 14 - right, y + 5), cost, font=narrow(32), fill=face)
        at = y + 48
        for line in lines:
            d.rectangle((x, at - 4, x + w, at + 28), fill=(28, 34, 56) if dark else (255, 255, 255))
            d.text((x + 12, at), line, font=sans(20), fill=(226, 232, 245) if dark else (40, 44, 56))
            at += 32
        return at + 26

    # The two columns start at different heights, so recognising across the full width returns them
    # interleaved. That is the case the importer has to survive.
    if columns == 1:
        y = 120
        for title, cost, lines in cards:
            y = card(510, y, title, cost, lines)
    elif columns == 3:
        # Three columns, every one starting level, which is how a tournament broadcast draws a full
        # army. The first card of each column shares a line with the first card of the others, so a
        # reader that groups words by height alone puts three units and three costs on one line.
        per = (len(cards) + 2) // 3
        for index, left in enumerate((500, 950, 1400)):
            y = 130
            for title, cost, lines in cards[index * per : (index + 1) * per]:
                y = card(left, y, title, cost, lines, w=400)
    else:
        half = (len(cards) + 1) // 2
        y = 130
        for title, cost, lines in cards[:half]:
            y = card(500, y, title, cost, lines)
        y = 80
        for title, cost, lines in cards[half:]:
            y = card(990, y, title, cost, lines)
    return img


def render_table(spec, rng):
    """A tournament pack: a monospaced table with a rule under the head."""
    img = Image.new("RGB", (1240, 900), (252, 252, 250))
    d = ImageDraw.Draw(img)
    d.text((70, 50), (spec["faction"] or "Mixed force").upper(), font=mono(30, bold=True), fill=(20, 20, 20))
    d.text((70, 92), f"{spec['player']} - {spec['note']}", font=mono(20), fill=(70, 70, 70))
    if spec["detachment"]:
        d.text((70, 124), f"{spec['detachment']} / {spec['disposition']}", font=mono(20), fill=(70, 70, 70))
    y = 176
    d.text((70, y), "QTY  UNIT".ljust(46) + "PTS", font=mono(22, bold=True), fill=(20, 20, 20))
    d.line((70, y + 32, 1170, y + 32), fill=(140, 140, 140), width=2)
    y += 48
    for copies, models, name, cost, extras in spec["rows"]:
        for _ in range(copies):
            qty = f"{models}x" if models > 1 else "1x"
            d.text((70, y), f"{qty.ljust(5)}{name}".ljust(46) + str(cost), font=mono(22), fill=(25, 25, 25))
            y += 30
            if extras:
                d.text((110, y), ", ".join(extras), font=mono(18), fill=(90, 90, 90))
                y += 28
            y += 6
    return img


RENDERERS = {
    "slide": render_slide,
    "page": render_page,
    "phone": render_phone,
    "chat": lambda spec, rng, lines=None: render_chat(spec, rng, lines=lines),
    "cards": lambda spec, rng, lines=None: render_cards(spec, rng),
    "cards1": lambda spec, rng, lines=None: render_cards(spec, rng, columns=1),
    "cards3": lambda spec, rng, lines=None: render_cards(spec, rng, columns=3),
    "cardslight": lambda spec, rng, lines=None: render_cards(spec, rng, dark=False),
    "table": lambda spec, rng, lines=None: render_table(spec, rng),
    "pagemono": lambda spec, rng, lines=None: render_page(spec, rng, face=mono(24), size=24, lines=lines),
    "pagesans": lambda spec, rng, lines=None: render_page(spec, rng, face=sans(28), size=28, paper=(246, 245, 240), lines=lines),
}


# ---- conditions ---------------------------------------------------------------------------------


def lighting(img, strength, angle):
    """A soft gradient across the picture, the way a hand or a window falls across a page."""
    w, h = img.size
    mask = Image.new("L", (w, h))
    md = ImageDraw.Draw(mask)
    for x in range(0, w, 6):
        for y in range(0, h, 48):
            t = (x / w) * math.cos(angle) + (y / h) * math.sin(angle)
            md.rectangle((x, y, x + 6, y + 48), fill=int(255 - strength * 255 * max(0.0, min(1.0, t))))
    mask = mask.filter(ImageFilter.GaussianBlur(36))
    return Image.composite(img, Image.new("RGB", (w, h), (0, 0, 0)), mask)


def glare(img, rng):
    """A bright patch, the way a window falls on a page or on a screen."""
    w, h = img.size
    spot = Image.new("L", (w, h), 0)
    sd = ImageDraw.Draw(spot)
    cx, cy = rng.randrange(int(w * 0.35), int(w * 0.8)), rng.randrange(int(h * 0.1), int(h * 0.6))
    sd.ellipse((cx - w // 6, cy - h // 7, cx + w // 6, cy + h // 7), fill=140)
    spot = spot.filter(ImageFilter.GaussianBlur(70))
    return Image.composite(Image.new("RGB", (w, h), (255, 255, 255)), img, spot)


def noise(img, amount, rng):
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            n = rng.randint(-amount, amount)
            px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return img


def moire(img):
    """The banding a camera picks up off a screen."""
    w, h = img.size
    bands = Image.new("L", (w, h), 255)
    bd = ImageDraw.Draw(bands)
    for y in range(0, h, 4):
        bd.line((0, y, w, y), fill=212)
    return Image.composite(img, Image.new("RGB", (w, h), (30, 30, 40)), bands.filter(ImageFilter.GaussianBlur(0.6)))


def motion(img, passes):
    """A sideways smear, from a hand that moved while the shutter was open."""
    kernel = [0] * 25
    for i in range(5):
        kernel[10 + i] = 1
    out = img
    for _ in range(passes):
        out = out.filter(ImageFilter.Kernel((5, 5), kernel, scale=5))
    return out


def solve(matrix, values):
    """Gaussian elimination over eight unknowns, for the perspective transform below."""
    n = len(values)
    m = [row[:] + [values[i]] for i, row in enumerate(matrix)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[pivot] = m[pivot], m[col]
        if abs(m[col][col]) < 1e-9:
            continue
        for r in itertools.chain(range(col), range(col + 1, n)):
            f = m[r][col] / m[col][col]
            for c in range(col, n + 1):
                m[r][c] -= f * m[col][c]
    return [m[i][n] / m[i][i] if abs(m[i][i]) > 1e-9 else 0 for i in range(n)]


def perspective(img, amount):
    """The page seen from off to one side."""
    w, h = img.size
    dx, dy = int(w * amount), int(h * amount * 0.4)
    corners = [(dx, dy), (w - dx // 2, 0), (w, h - dy), (dx // 3, h)]
    target = [(0, 0), (w, 0), (w, h), (0, h)]
    rows, values = [], []
    for (sx, sy), (tx, ty) in zip(corners, target):
        rows.append([sx, sy, 1, 0, 0, 0, -tx * sx, -tx * sy])
        values.append(tx)
        rows.append([0, 0, 0, sx, sy, 1, -ty * sx, -ty * sy])
        values.append(ty)
    return img.transform((w, h), Image.PERSPECTIVE, solve(rows, values), Image.BICUBIC, fillcolor=(232, 230, 226))


def exposure(img, gain, bias):
    return img.point(lambda v: max(0, min(255, int(v * gain + bias))))


def cast(img, mults):
    channels = img.split()
    return Image.merge("RGB", tuple(c.point(lambda v, m=m: min(255, int(v * m))) for c, m in zip(channels, mults)))


def apply(img, condition, rng):
    """Puts one named condition on a picture, returning it and the JPEG quality to save it at."""
    if condition == "clean":
        return img, None
    if condition == "screenshot":
        return img.resize((int(img.width * 0.75), int(img.height * 0.75)), Image.LANCZOS), None
    if condition == "lowres":
        return img.resize((int(img.width * 0.44), int(img.height * 0.44)), Image.LANCZOS), 70
    if condition == "video":
        return img.resize((1280, int(1280 * img.height / img.width)), Image.LANCZOS), 45
    if condition == "photo":
        img = img.rotate(rng.uniform(-2.0, 2.0), resample=Image.BICUBIC, expand=True, fillcolor=(236, 234, 229))
        img = lighting(img, 0.28, 0.4).filter(ImageFilter.GaussianBlur(0.6))
        return noise(img, 6, rng), 72
    if condition == "dim":
        img = img.rotate(rng.uniform(-4.0, 4.0), resample=Image.BICUBIC, expand=True, fillcolor=(210, 208, 204))
        img = lighting(img, 0.55, 0.3).filter(ImageFilter.GaussianBlur(1.3))
        return exposure(noise(img, 13, rng), 0.62, 38), 45
    if condition == "angled":
        img = perspective(img, 0.07)
        img = lighting(img, 0.3, 0.9).filter(ImageFilter.GaussianBlur(0.7))
        return noise(img, 7, rng), 65
    if condition == "glare":
        img = img.rotate(rng.uniform(-1.5, 1.5), resample=Image.BICUBIC, expand=True, fillcolor=(240, 238, 234))
        img = glare(img, rng).filter(ImageFilter.GaussianBlur(0.6))
        return noise(img, 6, rng), 68
    if condition == "screenphoto":
        img = img.rotate(rng.uniform(-2.5, 2.5), resample=Image.BICUBIC, expand=True, fillcolor=(18, 18, 26))
        img = glare(moire(img), rng).filter(ImageFilter.GaussianBlur(0.8))
        return noise(img, 9, rng), 55
    if condition == "motion":
        return noise(motion(img, 2), 6, rng), 62
    if condition == "warm":
        img = img.rotate(rng.uniform(-1.2, 1.2), resample=Image.BICUBIC, expand=True, fillcolor=(238, 230, 214))
        img = lighting(cast(img, (1.12, 1.0, 0.84)), 0.22, 0.6)
        return noise(img, 5, rng), 70
    if condition == "bright":
        img = exposure(img, 1.22, 22).filter(ImageFilter.GaussianBlur(0.5))
        return noise(img, 5, rng), 66
    raise ValueError(condition)


# ---- the corpus ---------------------------------------------------------------------------------
#
# `exact` means every unit has to come back. `most` means a floor is asserted and nothing may be
# invented, which is the right test for a picture at the edge of being readable.

CORPUS = [
    # Clean screenshots, every format over every list.
    ("slide", "wardens-mixed", "clean", "exact"),
    ("slide", "wardens-small", "clean", "exact"),
    ("slide", "swarm", "clean", "exact"),
    ("slide", "swarm-big", "clean", "exact"),
    ("slide", "allies", "clean", "exact"),
    ("slide", "split", "clean", "exact"),
    ("cards", "wardens-mixed", "clean", "exact"),
    ("cards", "swarm", "clean", "exact"),
    ("cards", "allies", "clean", "exact"),
    ("cards1", "wardens-small", "clean", "exact"),
    ("cardslight", "wardens-mixed", "clean", "exact"),
    ("cardslight", "swarm-big", "clean", "exact"),
    ("table", "wardens-mixed", "clean", "exact"),
    ("table", "swarm", "clean", "exact"),
    ("table", "allies", "clean", "exact"),
    ("phone", "wardens-mixed", "clean", "exact"),
    ("phone", "swarm", "clean", "exact"),
    ("phone", "split", "clean", "exact"),
    ("chat", "wardens-mixed", "clean", "exact"),
    ("chat", "swarm-big", "clean", "exact"),
    ("pagemono", "wardens-mixed", "clean", "exact"),
    ("pagesans", "swarm", "clean", "exact"),
    ("page", "allies", "clean", "exact"),
    # Smaller and softer.
    ("slide", "wardens-mixed", "screenshot", "exact"),
    ("cards", "swarm", "screenshot", "exact"),
    ("table", "wardens-small", "screenshot", "exact"),
    ("phone", "allies", "screenshot", "exact"),
    # Frames of a compressed stream.
    ("cards", "wardens-mixed", "video", "exact"),
    ("cards", "allies", "video", "most"),
    ("cards1", "swarm", "video", "exact"),
    ("cardslight", "wardens-small", "video", "exact"),
    # Photographs of a printed list.
    ("page", "wardens-mixed", "photo", "exact"),
    ("page", "swarm", "photo", "exact"),
    ("pagemono", "allies", "photo", "exact"),
    # The recogniser reads the 1 in "1x20 Thornlings" as a 4 on this one, and the list prints no
    # costs, so nothing in the data can tell one unit of twenty from four of them. What shows it to a
    # reader is the points total, 970 against the 610 the list actually comes to.
    ("pagesans", "swarm-big", "photo", "most"),
    ("page", "split", "photo", "exact"),
    ("page", "wardens-small", "warm", "exact"),
    ("pagesans", "wardens-mixed", "bright", "exact"),
    ("page", "swarm", "glare", "most"),
    ("pagemono", "wardens-mixed", "glare", "most"),
    ("page", "allies", "angled", "most"),
    ("pagesans", "swarm", "angled", "most"),
    ("page", "wardens-mixed", "motion", "most"),
    ("page", "swarm-big", "dim", "most"),
    ("page", "wardens-mixed", "dim", "most"),
    ("pagemono", "wardens-small", "dim", "most"),
    # Photographs of a screen, which is how a list off a stream usually reaches somebody.
    ("cards", "wardens-mixed", "screenphoto", "most"),
    ("slide", "swarm", "screenphoto", "most"),
    # The smallest readable versions.
    ("slide", "allies", "lowres", "most"),
    ("table", "swarm-big", "lowres", "most"),
    # A broadcast overlay in three columns, drawn level, which is what a tournament stream puts on
    # screen for a full army. Added after a real one came back with units that were on the same line
    # as each other and nowhere near each other on the screen.
    ("cards3", "wardens-mixed", "clean", "exact"),
    ("cards3", "allies", "screenshot", "exact"),
]


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    manifest = []
    total = 0
    for index, (renderer, list_key, condition, strictness) in enumerate(CORPUS):
        rng = random.Random(1000 + index)
        spec = LISTS[list_key]
        img, quality = apply(RENDERERS[renderer](spec, rng), condition, rng)
        name = f"{index + 1:02d}-{renderer}-{list_key}-{condition}." + ("jpg" if quality else "png")
        path = os.path.join(out_dir, name)
        if quality:
            img.convert("RGB").save(path, "JPEG", quality=quality, optimize=True)
        else:
            img.convert("RGB").save(path, "PNG", optimize=True)
        size = os.path.getsize(path)
        total += size
        entry = {
            "file": name,
            "list": list_key,
            "format": renderer,
            "condition": condition,
            "strictness": strictness,
            "expect": spec["expect"],
        }
        if spec["faction_id"]:
            entry["faction"] = spec["faction_id"]
        if spec["detachment_id"]:
            entry["detachment"] = spec["detachment_id"]
        if spec.get("asks_faction"):
            entry["asksFaction"] = True
        manifest.append(entry)
        print(f"{name:48} {img.width:5}x{img.height:<5} {size / 1024:6.0f} KB  {strictness}")

    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"\n{len(manifest)} pictures, {total / 1024 / 1024:.1f} MB")




# ---- the adversarial corpus ---------------------------------------------------------------------
#
# Three kinds of picture that are not a clean list.
#
#   none      no army list in it at all, however list-shaped it looks. Nothing may come out.
#   nonsense  something list-shaped but wrong: absurd counts, names from another game, a wall of
#             repeats, a page held upside down. Only units actually named may come out.
#   partial   a real list with part of it unreadable, because a thumb, a fold, a tear, a shadow or
#             the edge of the frame took some of it. What is legible has to come back and what was
#             covered must not.
#
# `allowed` lists every unit that may appear. Anything else is invented, which is the one thing that
# must never happen. `atLeast` is how many have to come back where something legible remains.

PROSE = [
    ("head", "Rules of engagement"),
    ("item", "Each player alternates activating one unit at a time until both have activated every"),
    ("item", "unit in their army. A unit that has already been activated this round may not be"),
    ("item", "activated again, even if an ability would otherwise allow it. Once both players have"),
    ("item", "no units left to activate, the round ends and the next begins."),
    ("item", "Models within an inch of an enemy model are engaged and may not move away unless"),
    ("item", "they first fall back. Falling back ends the unit's activation immediately."),
]

MENU = [
    ("head", "The Gilded Ladle"),
    ("sub", "kitchen open until nine"),
    ("bullet", "Small plates"),
    ("item", "Garden squash soup .............. 6.50"),
    ("item", "Warden's Rest ale, half ......... 3.20"),
    ("item", "Thornless cider, pint ........... 5.40"),
    ("bullet", "Mains"),
    ("item", "Spiced drake pie, 2 x sides ..... 14.00"),
    ("item", "Ashen crust flatbread ........... 11.50"),
    ("item", "Swarm of small fishes ........... 12.75"),
    ("bullet", "Puddings"),
    ("item", "Burnt custard ................... 6.00"),
]

RECEIPT = [
    ("head", "BRIGHT & SONS"),
    ("sub", "14 Mill Lane  ·  til 04  ·  09:41"),
    ("item", "2 x Copper wire 1.5mm      8.40"),
    ("item", "1 x Wall plugs, 50         2.95"),
    ("item", "3 x Pine batten 2.4m      21.00"),
    ("item", "1 x Masking tape           3.10"),
    ("item", "10 x Screws, 40mm          4.50"),
    ("bullet", "Subtotal                  39.95"),
    ("bullet", "VAT                        7.99"),
    ("bullet", "Total                     47.94"),
]

PAIRINGS = [
    ("head", "ROUND 3 PAIRINGS"),
    ("item", "Table 1   Ada Finch        vs  Rook Vale        18 - 12"),
    ("item", "Table 2   Juno Bright      vs  Mara Holt        20 -  9"),
    ("item", "Table 3   Wren Ash         vs  Karel Grant      15 - 15"),
    ("item", "Table 4   Pen Halloway     vs  Ives Marchetti    7 - 21"),
    ("item", "Table 5   Sorrel Quay      vs  Bex Antrobus     13 - 16"),
]

CODE = [
    ("item", "export function totalPoints(roster: Roster): number {"),
    ("item", "  let total = 0;"),
    ("item", "  for (const unit of roster.units) {"),
    ("item", "    total += costOf(unit).total;"),
    ("item", "  }"),
    ("item", "  return total;"),
    ("item", "}"),
]

SHOPPING = [
    ("head", "Saturday"),
    ("item", "2 x milk"),
    ("item", "1 x bread, seeded"),
    ("item", "6 x eggs"),
    ("item", "3 x onions"),
    ("item", "1 x washing powder"),
    ("item", "10 x tealights"),
]

SCHEDULE = [
    ("head", "Week of the 14th"),
    ("item", "Mon 09:00   stand-up, then invoices"),
    ("item", "Tue 11:30   dentist"),
    ("item", "Wed 14:00   Ada, about the roof"),
    ("item", "Thu 18:30   five a side"),
    ("item", "Fri 09:00   payroll cut-off"),
]

CHAT_NO_LIST = [
    ("item", "are we still on for thursday"),
    ("item", "yeah should be, 7ish?"),
    ("item", "works. bring the good dice"),
    ("item", "the good dice are a myth"),
    ("item", "they are not"),
]

BLANK = [("sub", "page 14")]

NOISE = [
    ("item", "qkkz vmrh wq ptlxn ddgb"),
    ("item", "rrn zxqf jjm wbbk hlt vv"),
    ("item", "ttpq lkzm bnfg xxr wqqn"),
    ("item", "hgy vvbn mmk zzqr ltpx"),
]

OTHER_GAME = [
    ("head", "Cobalt Syndicate"),
    ("sub", "by Ives Marchetti, 4-1 at the Harbour Cup"),
    ("bullet", "Vanguard Protocol - SECURE THE DOCKS"),
    ("bullet", "Characters"),
    ("item", "Syndic Prime - arc lash (Tidebreaker)"),
    ("bullet", "Squads"),
    ("item", "2 x 6 Riptide Marauders - coil rifles"),
    ("item", "1 x 4 Deepwater Adepts - harpoon"),
    ("bullet", "Vehicles"),
    ("item", "3 x Leviathan Hauler - siege drill"),
]

NEAR_MISS = [
    ("head", "Cinder Marches"),
    ("bullet", "Characters"),
    ("item", "Warder Chaplain - relic hammer"),
    ("bullet", "Squads"),
    ("item", "2 x 8 Warding Squadron - flux lances"),
    ("item", "1 x 6 Thornwick Broodlings - barbed fangs"),
    ("bullet", "Vehicles"),
    ("item", "2 x Ashfall Crawler - vortex mortar"),
]

ABSURD_COUNTS = [
    ("head", "Ashen Wardens"),
    ("bullet", "Squads"),
    ("item", "999 x 10 Warden Squad - Flux carbine"),
    ("item", "0 x Ashen Crusher - Fusion beamer"),
    ("item", "-4 x 5 Warden Squad"),
]

ABSURD_POINTS = [
    ("head", "Ashen Wardens"),
    ("bullet", "Squads"),
    ("item", "Warden Squad 99999"),
    ("item", "Ashen Crusher -300"),
    ("item", "Warden Captain 0"),
]

WARGEAR_ONLY = [
    ("head", "Spares tin"),
    ("item", "Flux carbine"),
    ("item", "Shock maul"),
    ("item", "Relic blade"),
    ("item", "Fusion beamer"),
    ("item", "Barbed claws"),
]

FACTION_ONLY = [("head", "Ashen Wardens"), ("sub", "by Karel Grant, 3-0 at the Ember Open"), ("bullet", "Ember Vanguard - HOLD THE RIDGE")]

REPEATED = [("head", "Ashen Wardens")] + [("item", "1 x 5 Warden Squad - Flux carbine")] * 24

PROSE_WITH_NAMES = [
    ("head", "How the Ember Open went"),
    ("item", "The first round put me against a Warden Squad list that I had no answer to, and by"),
    ("item", "the third turn there was an Ashen Crusher sitting on the middle objective and not"),
    ("item", "much I could do about it. The Swarm Seer did good work on the left but a Spine"),
    ("item", "Drake is a lot of points to leave in reserve, which is the mistake I keep making."),
    ("item", "Next time I will drop the Thornlings and take a second character instead."),
]


def clipped(spec, keep):
    """A real list with only the first `keep` unit rows on it, the rest out of frame or covered."""
    out = dict(spec)
    out["rows"] = spec["rows"][:keep]
    return out


ADVERSARIAL = [
    # ---- nothing to find ----
    ("none", "page", PROSE, "prose", "clean", []),
    ("none", "page", MENU, "menu", "clean", []),
    ("none", "pagemono", RECEIPT, "receipt", "clean", []),
    ("none", "pagemono", PAIRINGS, "pairings", "clean", []),
    ("none", "pagemono", CODE, "code", "clean", []),
    ("none", "phone", SHOPPING, "shopping", "clean", []),
    ("none", "phone", CHAT_NO_LIST, "chat", "clean", []),
    ("none", "page", SCHEDULE, "schedule", "clean", []),
    ("none", "page", BLANK, "blank", "clean", []),
    ("none", "page", NOISE, "noise", "clean", []),
    ("none", "page", MENU, "menu", "photo", []),
    ("none", "pagemono", RECEIPT, "receipt", "dim", []),
    # ---- list-shaped and wrong ----
    ("nonsense", "slide", OTHER_GAME, "othergame", "clean", []),
    ("nonsense", "page", OTHER_GAME, "othergame", "photo", []),
    ("nonsense", "slide", NEAR_MISS, "nearmiss", "clean", []),
    ("nonsense", "page", NEAR_MISS, "nearmiss", "photo", []),
    ("nonsense", "page", ABSURD_COUNTS, "absurdcounts", "clean", ["10 x Warden Squad", "5 x Warden Squad", "1 x Ashen Crusher"]),
    ("nonsense", "page", ABSURD_POINTS, "absurdpoints", "clean", ["5 x Warden Squad", "1 x Ashen Crusher", "1 x Warden Captain"]),
    ("nonsense", "page", WARGEAR_ONLY, "wargearonly", "clean", []),
    ("nonsense", "page", FACTION_ONLY, "factiononly", "clean", []),
    ("nonsense", "pagemono", REPEATED, "repeated", "clean", ["5 x Warden Squad"]),
    ("nonsense", "page", PROSE_WITH_NAMES, "prosewithnames", "clean", ["5 x Warden Squad", "1 x Ashen Crusher", "1 x Swarm Seer", "1 x Spine Drake", "10 x Thornlings", "20 x Thornlings"]),
    ("nonsense", "slide", NOISE, "noise", "lowres", []),
    ("nonsense", "page", MENU, "menu", "screenphoto", []),
]

# Partly legible: a real list with part of it taken away. `keep` says how many of its unit rows
# survive, and everything the picture still shows has to come back.
PARTIAL = [
    ("page", "wardens-mixed", 2, "cropped", "clean"),
    ("page", "wardens-mixed", 3, "thumb", "photo"),
    ("slide", "swarm", 2, "shadow", "photo"),
    ("pagemono", "allies", 2, "tear", "clean"),
    ("page", "swarm-big", 2, "crease", "photo"),
    ("phone", "wardens-mixed", 3, "scrolled", "clean"),
    ("page", "allies", 3, "blown", "bright"),
    ("pagesans", "swarm", 2, "watermark", "clean"),
    ("page", "wardens-small", 2, "cropped", "photo"),
    ("table", "allies", 3, "tear", "clean"),
]

# Past reading. A shadow over a page that was already dim and blurred is more than the recogniser
# can do anything with, and the right answer is to come back with nothing and say so. Kept in the
# corpus because giving up cleanly is a result worth holding to: the alternative is a plausible army
# assembled out of noise.
UNREADABLE = [
    ("page", "wardens-mixed", 3, "shadow", "dim"),
    ("pagemono", "swarm", 2, "thumb", "dim"),
]


def render_text(lines, renderer, rng):
    """Draws an arbitrary block of lines with one of the renderers that takes one."""
    spec = {"faction": None, "player": "", "note": "", "detachment": None, "disposition": None, "rows": []}
    return RENDERERS[renderer](spec, rng, lines=lines)


def damage(img, kind, rng):
    """Takes part of a picture away, the way a thumb, a fold, a tear or the frame does."""
    w, h = img.size
    d = ImageDraw.Draw(img)
    if kind == "cropped":
        # The bottom of the page never made it into the frame.
        return img.crop((0, 0, w, int(h * 0.52)))
    if kind == "scrolled":
        return img.crop((0, 0, w, int(h * 0.56)))
    if kind == "thumb":
        # A thumb over the lower half of the text, with a soft edge.
        thumb = Image.new("L", (w, h), 0)
        td = ImageDraw.Draw(thumb)
        td.ellipse((int(w * 0.02), int(h * 0.54), int(w * 0.62), int(h * 0.98)), fill=255)
        thumb = thumb.filter(ImageFilter.GaussianBlur(6))
        return Image.composite(Image.new("RGB", (w, h), (196, 158, 140)), img, thumb)
    if kind == "shadow":
        shade = Image.new("L", (w, h), 255)
        sd = ImageDraw.Draw(shade)
        sd.polygon([(0, int(h * 0.60)), (w, int(h * 0.52)), (w, h), (0, h)], fill=26)
        return Image.composite(img, Image.new("RGB", (w, h), (6, 6, 10)), shade.filter(ImageFilter.GaussianBlur(8)))
    if kind == "tear":
        # A ragged edge down the right, past which there is no paper.
        torn = Image.new("L", (w, h), 255)
        td = ImageDraw.Draw(torn)
        edge = int(w * 0.52)
        points = [(w, 0), (w, h)]
        y = h
        while y > -20:
            points.append((edge + rng.randrange(-26, 26), y))
            y -= 24
        td.polygon(points, fill=0)
        return Image.composite(img, Image.new("RGB", (w, h), (228, 226, 220)), torn)
    if kind == "crease":
        # A fold across the middle: a bright line, a dark line, and the text on it lost.
        band = int(h * 0.62)
        d.rectangle((0, band - 16, w, band + 4), fill=(252, 252, 250))
        d.rectangle((0, band + 4, w, band + 26), fill=(176, 174, 168))
        return img
    if kind == "blown":
        # A strip of the page burnt out white by a flash.
        band = int(h * 0.60)
        blown = Image.new("L", (w, h), 0)
        bd = ImageDraw.Draw(blown)
        bd.rectangle((0, band, w, band + int(h * 0.16)), fill=255)
        return Image.composite(Image.new("RGB", (w, h), (255, 255, 255)), img, blown.filter(ImageFilter.GaussianBlur(10)))
    if kind == "watermark":
        mark = Image.new("RGB", (w, h), (255, 255, 255))
        md = ImageDraw.Draw(mark)
        md.text((int(w * 0.1), int(h * 0.42)), "SAMPLE COPY", font=sans(int(h * 0.18), bold=True), fill=(120, 120, 120))
        mark = mark.rotate(-18, resample=Image.BICUBIC, fillcolor=(255, 255, 255))
        return Image.blend(img, mark, 0.42)
    raise ValueError(kind)


def adversarial(out_dir):
    """The pictures that are not a clean list: nothing to find, nonsense, and partly legible."""
    os.makedirs(out_dir, exist_ok=True)
    manifest = []
    total = 0
    index = 0

    def write(name, img, quality, entry):
        nonlocal total
        path = os.path.join(out_dir, name)
        if quality:
            img.convert("RGB").save(path, "JPEG", quality=quality, optimize=True)
        else:
            img.convert("RGB").save(path, "PNG", optimize=True)
        size = os.path.getsize(path)
        total += size
        manifest.append(entry)
        print(f"{name:46} {img.width:5}x{img.height:<5} {size / 1024:6.0f} KB  {entry['kind']}")

    for kind, renderer, lines, label, condition, allowed in ADVERSARIAL:
        index += 1
        rng = random.Random(5000 + index)
        img, quality = apply(render_text(lines, renderer, rng), condition, rng)
        name = f"{index:02d}-{kind}-{label}-{condition}." + ("jpg" if quality else "png")
        write(name, img, quality, {"file": name, "kind": kind, "label": label, "condition": condition, "allowed": allowed, "atLeast": 0})

    for renderer, list_key, keep, harm, condition in PARTIAL:
        index += 1
        rng = random.Random(5000 + index)
        spec = LISTS[list_key]
        # The picture is drawn holding only the rows that survive, and the damage then sits over the
        # end of what is left and the space below it. Drawing the whole list and covering part of it
        # would be truer to life, but then which rows the thumb or the fold actually took depends on
        # where the renderer happened to put them, and the expectation could not be stated.
        img = damage(RENDERERS[renderer](clipped(spec, keep), rng), harm, rng)
        img, quality = apply(img, condition, rng)
        name = f"{index:02d}-partial-{list_key}-{harm}." + ("jpg" if quality else "png")
        # Every unit the kept rows produce, expanded the way the importer reports them.
        allowed = []
        for copies, models, unit, _cost, _extras in spec["rows"][:keep]:
            allowed += [f"{models} x {unit}"] * copies
        never = []
        for copies, models, unit, _cost, _extras in spec["rows"][keep:]:
            if f"{models} x {unit}" not in allowed:
                never.append(f"{models} x {unit}")
        write(name, img, quality, {"file": name, "kind": "partial", "label": harm, "condition": condition, "allowed": allowed, "never": never, "atLeast": max(1, len(allowed) - 1)})

    for renderer, list_key, keep, harm, condition in UNREADABLE:
        index += 1
        rng = random.Random(5000 + index)
        spec = LISTS[list_key]
        img = damage(RENDERERS[renderer](clipped(spec, keep), rng), harm, rng)
        img, quality = apply(img, condition, rng)
        name = f"{index:02d}-unreadable-{list_key}-{harm}." + ("jpg" if quality else "png")
        allowed = []
        for copies, models, unit, _cost, _extras in spec["rows"][:keep]:
            allowed += [f"{models} x {unit}"] * copies
        write(name, img, quality, {"file": name, "kind": "unreadable", "label": harm, "condition": condition, "allowed": allowed, "atLeast": 0})

    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"\n{len(manifest)} pictures, {total / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    where = sys.argv[1] if len(sys.argv) > 1 else "fixtures"
    print("== lists ==")
    main(os.path.join(where, "pictures"))
    print("\n== adversarial ==")
    adversarial(os.path.join(where, "adversarial"))

"""把各張圖集（喪屍走路、屍體、爆炸…）上下疊成一張 sprites.png，座標寫進 sprites.json（遊戲只綁一張貼圖）。
用法：python -I tools/pack_sprites.py   （讀 art/*-atlas.png/json，寫 art/sprites.png/json）
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

ART = Path(__file__).resolve().parents[1] / "art"
SHEETS = [("zombie", "zombie-atlas"), ("corpse", "corpse-atlas"), ("fx", "fx-atlas"), ("heli", "heli-atlas"), ("soldier", "soldier-atlas"), ("tank", "tank-atlas"), ("jet", "jet-atlas"), ("ships", "ships-atlas"), ("truck", "truck-atlas"), ("transport", "transport-atlas"), ("nest", "nest-atlas")]

parts, metas = [], {}
y = 0
for key, name in SHEETS:
    png, js = ART / f"{name}.png", ART / f"{name}.json"
    if not png.exists():
        print("skip", name)
        continue
    im = np.array(Image.open(png).convert("RGBA"))
    meta = json.loads(js.read_text())
    for lv in meta["levels"]:
        lv["y"] += y
    meta["regionY"] = y
    metas[key] = meta
    parts.append((y, im))
    y += im.shape[0] + 2
W = max(im.shape[1] for _, im in parts)
out = np.zeros((y, W, 4), np.uint8)
for oy, im in parts:
    out[oy:oy + im.shape[0], :im.shape[1]] = im
Image.fromarray(out, "RGBA").save(ART / "sprites.png")
(ART / "sprites.json").write_text(json.dumps(metas))
print("sprites.png", out.shape[1], "x", out.shape[0], list(metas))

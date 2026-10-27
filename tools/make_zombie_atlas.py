"""l0veyou 生成的 4x4 喪屍走路表 → 真像素圖集（遊戲用）。

流程：sprite-gen 綠幕去背 → 偵測假像素格、縮回真像素 → 切 4x4 → 每格用「腳底＋身體中線」對齊到共同格子
→ 依顏色把每個像素分材質群組（皮膚/上衣/褲子/頭髮/血/外框/其他），群組編號寫進 alpha，
遊戲 shader 用它幫每隻喪屍換衣服顏色。

用法：python -I tools/make_zombie_atlas.py <sheet.jpg|png> <out_prefix>
輸出：<out_prefix>.png（圖集，列=方向 下/左/右/上，欄=走路影格）、<out_prefix>.json、<out_prefix>-preview.png
"""
import colorsys
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SG = Path(__file__).resolve().parents[2] / "_ext" / "sprite-gen"
sys.path.insert(0, str(SG))
from sprite_gen.frames.cutout import cutout  # noqa: E402
from sprite_gen.frames.extract import detect_pixel_grid, grid_snap_downscale  # noqa: E402

GROUPS = {"other": 0, "outline": 1, "skin": 2, "top": 3, "pants": 4, "hair": 5, "blood": 6}


def classify(rgb):
    """只分遊戲要換色的群組：皮膚、上衣、褲子；頭髮/血/鞋子都歸 other（保留原色）。"""
    r, g, b = (c / 255.0 for c in rgb)
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    h *= 360.0
    if v < 0.13:
        return GROUPS["outline"]
    if 25 <= h <= 130 and 0.12 <= s <= 0.65 and v >= 0.5:
        return GROUPS["skin"]
    if 195 <= h <= 255 and s > 0.3:
        return GROUPS["pants"]
    if (h >= 290 or h <= 30) and s < 0.33 and 0.27 <= v <= 0.75:
        return GROUPS["top"]
    return GROUPS["other"]


def main():
    src, prefix = Path(sys.argv[1]), Path(sys.argv[2])
    rows, cols = 4, 4
    keyed_path = prefix.with_name(prefix.name + "-keyed.png")
    stats = cutout(src, keyed_path, key="green", decontam="auto")
    print("cutout:", {k: stats[k] for k in list(stats)[:6]})
    keyed = Image.open(keyed_path).convert("RGBA")

    # 假像素格偵測在 JPEG 上不可靠 → 每格裁出人物，用「區塊中位數」縮到約真像素大小，再全部共用一組色盤
    P = float(sys.argv[3]) if len(sys.argv) > 3 else 4.6
    full = np.array(keyed)
    FH, FW = full.shape[:2]
    frames, sizes = [], []
    for r in range(rows):
        for c in range(cols):
            x0, y0, x1, y1 = int(c * FW / cols), int(r * FH / rows), int((c + 1) * FW / cols), int((r + 1) * FH / rows)
            cell = full[y0:y1, x0:x1]
            m = cell[..., 3] > 128
            ys, xs = np.where(m)
            # 從腳底往上切格，讓腳底剛好落在格線上
            bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
            nh = int(np.ceil((by1 - by0) / P)); nw = int(np.ceil((bx1 - bx0) / P)) + 1
            out = np.zeros((nh, nw, 4), np.uint8)
            for oy in range(nh):
                ya, yb = by1 - (nh - oy) * P, by1 - (nh - oy - 1) * P
                ya, yb = int(round(ya)), int(round(yb))
                for ox in range(nw):
                    xa, xb = int(round(bx0 - P / 2 + ox * P)), int(round(bx0 - P / 2 + (ox + 1) * P))
                    blk = cell[max(ya, 0):max(yb, 0), max(xa, 0):max(xb, 0)].reshape(-1, 4)
                    if len(blk) == 0:
                        continue
                    op = blk[blk[:, 3] > 128]
                    if len(op) * 2 < len(blk):
                        continue
                    out[oy, ox, :3] = np.median(op[:, :3], axis=0).astype(np.uint8)
                    out[oy, ox, 3] = 255
            mm = out[..., 3] > 0
            ys2, xs2 = np.where(mm)
            crop = out[ys2.min():ys2.max() + 1, xs2.min():xs2.max() + 1]
            body_x = float(np.median(np.where(crop[..., 3] > 0)[1]))
            frames.append((r, c, crop, body_x))
            sizes.append(crop.shape[:2])
    # 共用色盤（量化不透明像素）
    allpx = np.concatenate([f[2][f[2][..., 3] > 0][:, :3] for f in frames])
    strip = Image.fromarray(allpx.reshape(1, -1, 3), "RGB")
    NCOL = int(sys.argv[4]) if len(sys.argv) > 4 else 20
    q = strip.quantize(colors=NCOL, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = np.array(q.getpalette()[:NCOL * 3], np.uint8).reshape(-1, 3)
    qi = np.array(q).reshape(-1)
    k = 0
    for f in frames:
        m = f[2][..., 3] > 0
        n = int(m.sum())
        f[2][m, :3] = pal[qi[k:k + n]]
        k += n
    print("pitch", P, "palette", NCOL, "frame sizes", sorted(set(sizes))[:3], "...")
    px = py = P
    max_h = max(s[0] for s in sizes)
    left = max(int(np.ceil(f[3])) for f in frames)
    right = max(f[2].shape[1] - int(np.floor(f[3])) for f in frames)
    cw = left + right + 2
    ch = max_h + 2
    foot = 1  # 腳底離格子下緣的像素
    atlas = np.zeros((rows * ch, cols * cw, 4), np.uint8)
    for r, c, crop, body_x in frames:
        h, w = crop.shape[:2]
        ox = c * cw + (cw // 2) - int(round(body_x))
        oy = r * ch + ch - foot - h
        region = atlas[oy:oy + h, ox:ox + w]
        m = crop[..., 3] > 0
        region[m] = crop[m]

    # 材質群組寫進 alpha：255 - g*8（0 = 透明）
    counts = {k: 0 for k in GROUPS}
    inv = {v: k for k, v in GROUPS.items()}
    for y in range(atlas.shape[0]):
        for x in range(atlas.shape[1]):
            if atlas[y, x, 3]:
                g = classify(atlas[y, x, :3])
                counts[inv[g]] += 1
                atlas[y, x, 3] = 255 - g * 8
    print("cell", cw, "x", ch, "groups", counts)

    # 縮小層級（LOD）：遠一點時用小張，避免最近鄰縮小變雜訊。
    # 每個輸出像素取對應區塊裡「最常見的顏色」（保留色盤，不會糊），不透明不到 45% 就留空；腳底對齊格子底部。
    def shrink(level0, cw0, ch0, nh):
        s_ = nh / ch0
        nw = max(4, int(round(cw0 * s_)))
        out = np.zeros((rows * nh, cols * nw, 4), np.uint8)
        for r in range(rows):
            for c in range(cols):
                cell = level0[r * ch0:(r + 1) * ch0, c * cw0:(c + 1) * cw0]
                for oy in range(nh):
                    ya, yb = int(round(ch0 - (nh - oy) / s_)), int(round(ch0 - (nh - oy - 1) / s_))
                    for ox in range(nw):
                        xa, xb = int(round(ox / s_)), int(round((ox + 1) / s_))
                        blk = cell[max(ya, 0):yb, xa:xb].reshape(-1, 4)
                        op = blk[blk[:, 3] > 0]
                        if len(blk) == 0 or len(op) < 0.45 * len(blk):
                            continue
                        keys, cnt = np.unique(op, axis=0, return_counts=True)
                        out[r * nh + oy, c * nw + ox] = keys[cnt.argmax()]
        return out, nw
    levels = [{"x": 0, "y": 0, "cw": cw, "ch": ch}]
    imgs = [atlas]
    x_at = atlas.shape[1]
    for nh in (36, 27, 20, 15, 11):
        im, nw = shrink(atlas, cw, ch, nh)
        levels.append({"x": x_at, "y": 0, "cw": nw, "ch": nh})
        imgs.append(im)
        x_at += im.shape[1]
    full_atlas = np.zeros((atlas.shape[0], x_at, 4), np.uint8)
    for lv, im in zip(levels, imgs):
        full_atlas[:im.shape[0], lv["x"]:lv["x"] + im.shape[1]] = im
    print("lods", [(l["cw"], l["ch"]) for l in levels])

    out_png = prefix.with_suffix(".png")
    Image.fromarray(full_atlas, "RGBA").save(out_png)
    meta = {"rows": ["down", "left", "right", "up"], "frames": cols, "cellW": cw, "cellH": ch, "foot": foot,
            "levels": levels, "groups": GROUPS, "alphaCode": "a = 255 - group*8", "source": src.name,
            "pitch": [round(px, 3), round(py, 3)]}
    prefix.with_suffix(".json").write_text(json.dumps(meta, indent=1))
    atlas = full_atlas

    # 預覽：放大 6 倍、灰底；右邊是材質群組上色
    vis = atlas.copy()
    vis[..., 3] = np.where(atlas[..., 3] > 0, 255, 0)
    pal = np.array([[200, 200, 200], [20, 20, 20], [120, 200, 90], [150, 150, 160], [60, 80, 200], [120, 70, 30], [220, 30, 40]], np.uint8)
    grp = np.zeros_like(vis)
    m = atlas[..., 3] > 0
    gi = ((255 - atlas[..., 3].astype(int)) // 8).clip(0, 6)
    grp[m, :3] = pal[gi[m]]
    grp[m, 3] = 255
    both = np.concatenate([vis, np.zeros((vis.shape[0], 4, 4), np.uint8), grp], axis=1)
    bg = Image.new("RGBA", (both.shape[1], both.shape[0]), (58, 62, 66, 255))
    bg.alpha_composite(Image.fromarray(both, "RGBA"))
    bg = bg.resize((bg.width * 6, bg.height * 6), Image.NEAREST)
    bg.save(prefix.with_name(prefix.name + "-preview.png"))
    print("wrote", out_png)


if __name__ == "__main__":
    main()

"""通用：l0veyou 綠幕表（rows x cols 格）→ 真像素圖集＋縮小層級（LOD）。

用法：python -I tools/make_sheet_atlas.py <sheet> <out_prefix> --grid 2x4 --pitch 4.6 --colors 32 --anchor center|feet [--groups] [--keep-light]
  加 --keyed＝跳過去背、直接重切 <out_prefix>-keyed.png（例：戰車側面圖被等分切斷時改用 --split gaps 重切）
- 每格裁出主體，用「區塊中位數」縮到真像素，再全部共用一組色盤。
- --anchor feet：腳底對齊格子底部（站立角色）；center：主體中心對齊格子中心（屍體、特效）。
- --groups：依顏色分材質群組寫進 alpha（255 - g*8），遊戲用來換衣服顏色；沒加就是一般 alpha（255）。
輸出 <out_prefix>.png / .json / -preview.png
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "_ext" / "sprite-gen"))
try:
    from sprite_gen.frames.cutout import cutout  # noqa: E402
    from make_zombie_atlas import classify  # noqa: E402
except ImportError:   # 沒有 sprite-gen：只能用 --keyed 重切已去背的表（不能 --groups）
    cutout = classify = None

LOD_SCALES = (1.0, 0.71, 0.53, 0.39, 0.29, 0.21)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet"); ap.add_argument("prefix")
    ap.add_argument("--grid", default="4x4"); ap.add_argument("--pitch", type=float, default=4.6)
    ap.add_argument("--colors", type=int, default=32); ap.add_argument("--anchor", default="center")
    ap.add_argument("--groups", action="store_true")
    ap.add_argument("--key", default="green", help="green 或 magenta 背景")
    ap.add_argument("--split", default="equal", help="equal 等分；gaps 依空白切（格子不等寬的表）")
    ap.add_argument("--min-component", type=int, default=12, help="移除小於這個像素數的碎屑（縮小後）")
    ap.add_argument("--flip-v", default="", help="上下翻轉某些格（r,c;r,c…），生圖畫錯方向時補救")
    ap.add_argument("--keyed", action="store_true", help="直接用已經去背的 <out_prefix>-keyed.png 重切（不重跑去背）")
    a = ap.parse_args()
    rows, cols = map(int, a.grid.split("x"))
    src, prefix = Path(a.sheet), Path(a.prefix)
    keyed_path = prefix.with_name(prefix.name + "-keyed.png")
    if not a.keyed:
        cutout(src, keyed_path, key=a.key, decontam="auto")
    full = np.array(Image.open(keyed_path).convert("RGBA"))
    FH, FW = full.shape[:2]
    P = a.pitch

    frames = []
    # 依空白切格：找不透明的連續區段，太近的合併，多出來的把最小的併給鄰居；數量不對就退回等分
    def spans(occ, n, total):
        runs, start = [], None
        for i, v in enumerate(occ):
            if v and start is None: start = i
            if not v and start is not None: runs.append([start, i]); start = None
        if start is not None: runs.append([start, len(occ)])
        merged = []
        for r_ in runs:
            if merged and r_[0] - merged[-1][1] < 6: merged[-1][1] = r_[1]
            else: merged.append(r_)
        while len(merged) > n:
            k = min(range(len(merged)), key=lambda j: merged[j][1] - merged[j][0])
            if k == 0: j2 = 1
            elif k == len(merged) - 1: j2 = k - 1
            else: j2 = k - 1 if merged[k][0] - merged[k - 1][1] < merged[k + 1][0] - merged[k][1] else k + 1
            lo, hi = min(k, j2), max(k, j2)
            merged[lo] = [merged[lo][0], merged[hi][1]]; del merged[hi]
        if len(merged) != n:
            return [(int(i * total / n), int((i + 1) * total / n)) for i in range(n)]
        # 各格往兩邊延伸到空白中點
        out = []
        for j, (s0, s1) in enumerate(merged):
            l = 0 if j == 0 else (merged[j - 1][1] + s0) // 2
            h = total if j == n - 1 else (s1 + merged[j + 1][0]) // 2
            out.append((l, h))
        return out
    alpha = full[..., 3] > 128
    row_spans = spans((alpha.sum(axis=1) > 1) if a.split == "gaps" else np.zeros(FH, bool), rows, FH)
    for r in range(rows):
        ry0, ry1 = row_spans[r]
        col_spans = spans((alpha[ry0:ry1].sum(axis=0) > 1) if a.split == "gaps" else np.zeros(FW, bool), cols, FW)
        for c in range(cols):
            cell = full[ry0:ry1, col_spans[c][0]:col_spans[c][1]]
            m = cell[..., 3] > 128
            ys, xs = np.where(m)
            if len(xs) == 0:
                frames.append(None); continue
            bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
            nh, nw = int(np.ceil((by1 - by0) / P)) + 1, int(np.ceil((bx1 - bx0) / P)) + 1
            out = np.zeros((nh, nw, 4), np.uint8)
            for oy in range(nh):
                ya, yb = int(round(by1 - (nh - oy) * P)), int(round(by1 - (nh - oy - 1) * P))
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
            # 去碎屑：只留夠大的連通塊
            mm = out[..., 3] > 0
            lab = np.zeros(mm.shape, np.int32); n = 0
            for y0 in range(mm.shape[0]):
                for x0 in range(mm.shape[1]):
                    if mm[y0, x0] and not lab[y0, x0]:
                        n += 1; st = [(y0, x0)]; lab[y0, x0] = n
                        while st:
                            y, x = st.pop()
                            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                                yy, xx = y + dy, x + dx
                                if 0 <= yy < mm.shape[0] and 0 <= xx < mm.shape[1] and mm[yy, xx] and not lab[yy, xx]:
                                    lab[yy, xx] = n; st.append((yy, xx))
            for k in range(1, n + 1):
                if (lab == k).sum() < a.min_component:
                    out[lab == k] = 0
            ys2, xs2 = np.where(out[..., 3] > 0)
            frames.append(out[ys2.min():ys2.max() + 1, xs2.min():xs2.max() + 1])

    for rc in filter(None, a.flip_v.split(";")):
        r_, c_ = map(int, rc.split(","))
        if frames[r_ * cols + c_] is not None:
            frames[r_ * cols + c_] = frames[r_ * cols + c_][::-1].copy()

    allpx = np.concatenate([f[f[..., 3] > 0][:, :3] for f in frames if f is not None])
    q = Image.fromarray(allpx.reshape(1, -1, 3), "RGB").quantize(colors=a.colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = np.array(q.getpalette()[:a.colors * 3], np.uint8).reshape(-1, 3)
    qi = np.array(q).reshape(-1); k = 0
    for f in frames:
        if f is None:
            continue
        m = f[..., 3] > 0; nn = int(m.sum())
        f[m, :3] = pal[qi[k:k + nn]]; k += nn

    cw = max(f.shape[1] for f in frames if f is not None) + 2
    ch = max(f.shape[0] for f in frames if f is not None) + 2
    atlas = np.zeros((rows * ch, cols * cw, 4), np.uint8)
    for idx, f in enumerate(frames):
        if f is None:
            continue
        r, c = divmod(idx, cols); h, w = f.shape[:2]
        ox = c * cw + (cw - w) // 2
        oy = r * ch + (ch - 1 - h if a.anchor == "feet" else (ch - h) // 2)
        reg = atlas[oy:oy + h, ox:ox + w]; m = f[..., 3] > 0; reg[m] = f[m]
    if a.groups:
        for y, x in zip(*np.where(atlas[..., 3] > 0)):
            atlas[y, x, 3] = 255 - classify(atlas[y, x, :3]) * 8

    def shrink(level0, s_):
        nh, nw = max(3, int(round(ch * s_))), max(3, int(round(cw * s_)))
        out = np.zeros((rows * nh, cols * nw, 4), np.uint8)
        for r in range(rows):
            for c in range(cols):
                cell = level0[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
                for oy in range(nh):
                    ya, yb = int(round(oy / s_)), int(round((oy + 1) / s_))
                    if a.anchor == "feet":
                        ya, yb = int(round(ch - (nh - oy) / s_)), int(round(ch - (nh - oy - 1) / s_))
                    for ox in range(nw):
                        xa, xb = int(round(ox / s_)), int(round((ox + 1) / s_))
                        blk = cell[max(ya, 0):yb, xa:xb].reshape(-1, 4)
                        op = blk[blk[:, 3] > 0]
                        if len(blk) == 0 or len(op) < 0.45 * len(blk):
                            continue
                        keys, cnt = np.unique(op, axis=0, return_counts=True)
                        out[r * nh + oy, c * nw + ox] = keys[cnt.argmax()]
        return out, nw, nh

    levels, imgs, x_at = [], [], 0
    for s_ in LOD_SCALES:
        im, nw, nh = (atlas, cw, ch) if s_ == 1.0 else shrink(atlas, s_)
        levels.append({"x": x_at, "y": 0, "cw": nw, "ch": nh}); imgs.append(im); x_at += im.shape[1]
    out = np.zeros((rows * ch, x_at, 4), np.uint8)
    for lv, im in zip(levels, imgs):
        out[:im.shape[0], lv["x"]:lv["x"] + im.shape[1]] = im
    Image.fromarray(out, "RGBA").save(prefix.with_suffix(".png"))
    meta = {"rows": rows, "cols": cols, "cellW": cw, "cellH": ch, "anchor": a.anchor, "groups": a.groups,
            "levels": levels, "source": src.name, "pitch": P}
    prefix.with_suffix(".json").write_text(json.dumps(meta, indent=1))
    vis = out.copy(); vis[..., 3] = np.where(out[..., 3] > 0, 255, 0)
    bg = Image.new("RGBA", (vis.shape[1], vis.shape[0]), (58, 62, 66, 255)); bg.alpha_composite(Image.fromarray(vis, "RGBA"))
    bg.resize((bg.width * 5, bg.height * 5), Image.NEAREST).save(prefix.with_name(prefix.name + "-preview.png"))
    print("cell", cw, "x", ch, "levels", [(l["cw"], l["ch"]) for l in levels], "->", prefix.with_suffix(".png"))


if __name__ == "__main__":
    main()

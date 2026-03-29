/**
 * fabricationExport.ts
 *
 * Three cut-ready PNG layers:
 *
 *   1. LEVERS
 *      • Translation / rotation: full rod from pivot to tip
 *      • Slide: full strip+tab rectangle at its t=0 resting position —
 *        length = 2 image cells + tab + grip margin, width = object width/height
 *
 *   2. OBJECTS
 *      • Every non-slide object: alpha-traced silhouette (or bounding rect)
 *      • Every slide object: the two composited cells (bg + object image) with
 *        cut borders, appended below the canvas region
 *
 *   3. BACKGROUND
 *      • Background image with translation centerline, slide window cut-out,
 *        rotation anchor hole, and outer border
 */

import type {
  CanvasObject,
  SlideMovement,
  TransitionMovement,
} from "./types";
import {
  getTransitionDims,
  getRotationDims,
  getRotationAnchor,
  getPathDir,
  chooseOutwardNormal,
  FABRICATION_LEVER_SHEET_PAD,
} from "./leverGeometry";

// ─── constants ────────────────────────────────────────────────────────────────
const CUT_STROKE = 2.5;
const CUT_COLOR = "#000000";
const REG_RADIUS = 10;
const ROT_START = -Math.PI / 2;
const TAB_THICK = 28;
const ALPHA_THRESH = 30;
/** Extra length beyond the strip that sticks out so you can grip the tab. */
const GRIP_EXTRA = 40;

export interface FabricationSheets {
  leversDataUrl: string;
  objectsDataUrl: string;
  backgroundDataUrl: string;
}

// ─── image loading ────────────────────────────────────────────────────────────

function loadImageToCanvas(url: string): Promise<{
  img: HTMLImageElement;
  off: HTMLCanvasElement;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const off = document.createElement("canvas");
      off.width = img.naturalWidth;
      off.height = img.naturalHeight;
      off.getContext("2d")!.drawImage(img, 0, 0);
      resolve({ img, off });
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ─── drawing helpers ──────────────────────────────────────────────────────────

function drawRegMarks(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const pts = [
    [REG_RADIUS + 4, REG_RADIUS + 4],
    [w - REG_RADIUS - 4, REG_RADIUS + 4],
    [REG_RADIUS + 4, h - REG_RADIUS - 4],
    [w - REG_RADIUS - 4, h - REG_RADIUS - 4],
  ];
  ctx.save();
  ctx.strokeStyle = CUT_COLOR;
  ctx.lineWidth = 1.2;
  for (const [cx, cy] of pts) {
    ctx.beginPath();
    ctx.arc(cx, cy, REG_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - REG_RADIUS - 4, cy);
    ctx.lineTo(cx + REG_RADIUS + 4, cy);
    ctx.moveTo(cx, cy - REG_RADIUS - 4);
    ctx.lineTo(cx, cy + REG_RADIUS + 4);
    ctx.stroke();
  }
  ctx.restore();
}

function punchHole(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
) {
  ctx.save();
  ctx.strokeStyle = CUT_COLOR;
  ctx.lineWidth = CUT_STROKE;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawFullRod(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  rodWidth: number,
) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const nx = -dy / len,
    ny = dx / len;
  const hw = rodWidth / 2;
  ctx.beginPath();
  ctx.moveTo(from.x + nx * hw, from.y + ny * hw);
  ctx.lineTo(to.x + nx * hw, to.y + ny * hw);
  ctx.lineTo(to.x - nx * hw, to.y - ny * hw);
  ctx.lineTo(from.x - nx * hw, from.y - ny * hw);
  ctx.closePath();
  ctx.stroke();
}

// ─── slide strip geometry ─────────────────────────────────────────────────────
//
// The physical strip is two image cells joined along the movement axis, with a
// tab (TAB_THICK) attached at the pull end plus GRIP_EXTRA of handle.
//
// Total piece dimensions:
//   vertical   → width = imgW,  height = imgH * 2 + TAB_THICK + GRIP_EXTRA
//   horizontal → width = imgW * 2 + TAB_THICK + GRIP_EXTRA, height = imgH
//
// At t=0 the strip is fully retracted: only the tab sits just outside the
// canvas edge.  So we position the strip rectangle so the tab end is at the
// canvas boundary (plus pad offset on the levers sheet).

interface SlideStripGeo {
  /** Top-left corner of the full strip rect in canvas coordinates. */
  x: number;
  y: number;
  /** Total width of the strip piece. */
  w: number;
  /** Total height of the strip piece. */
  h: number;
  isVertical: boolean;
}

function slideStripGeo(
  obj: CanvasObject,
  canvasW: number,
  canvasH: number,
): SlideStripGeo {
  const m = obj.movement as SlideMovement;
  const isV = m.direction === "vertical";
  const imgW = obj.width,
    imgH = obj.height;

  // Total strip length (two cells + tab + grip) along the movement axis
  const stripLen = (isV ? imgH : imgW) * 2 + TAB_THICK + GRIP_EXTRA;

  // Width perpendicular to movement
  const stripCross = isV ? imgW : imgH;

  // Window top-left in canvas coords
  const winX = obj.position.x - imgW / 2;
  const winY = obj.position.y - imgH / 2;

  // At t=0 the strip is fully retracted so the tab just clears the canvas edge.
  // The "pull direction" is where the tab starts, so the strip extends inward
  // from there by stripLen.
  //
  // We want: rect x/y in canvas-space (levers sheet will apply a pad offset).

  let rx = 0,
    ry = 0,
    rw = 0,
    rh = 0;

  if (isV) {
    rw = stripCross; // = imgW
    rh = stripLen;
    rx = winX; // horizontally aligned with window
    if (m.pullDirection === "down") {
      // tab at bottom (starts below canvas at y=canvasH), strip extends upward
      ry = canvasH - stripLen + TAB_THICK + GRIP_EXTRA;
    } else {
      // pull=up: tab at top (starts above canvas at y= -TAB_THICK), strip extends downward
      ry = -(TAB_THICK + GRIP_EXTRA);
    }
  } else {
    rw = stripLen;
    rh = stripCross; // = imgH
    ry = winY;
    if (m.pullDirection === "right") {
      rx = canvasW - stripLen + TAB_THICK + GRIP_EXTRA;
    } else {
      // pull=left
      rx = -(TAB_THICK + GRIP_EXTRA);
    }
  }

  return { x: rx, y: ry, w: rw, h: rh, isVertical: isV };
}

// ─── lever geometry (translation / rotation) ─────────────────────────────────

function transLeverGeoAt(
  obj: CanvasObject,
  t: number,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
  revealRatio: number,
) {
  const m = obj.movement as TransitionMovement;
  const dims = getTransitionDims(
    obj,
    totalLeverH,
    canvasW,
    canvasH,
    revealRatio,
  );
  const dirX = m.endPoint.x - obj.position.x;
  const dirY = m.endPoint.y - obj.position.y;
  const animX = obj.position.x + dirX * t;
  const animY = obj.position.y + dirY * t;
  const bL = 0,
    bT = totalLeverH,
    bR = canvasW,
    bB = totalLeverH + canvasH;
  const { tx, ty } = getPathDir(obj);
  const midX = (obj.position.x + m.endPoint.x) / 2;
  const midY = totalLeverH + (obj.position.y + m.endPoint.y) / 2;
  const out = chooseOutwardNormal(midX, midY, -ty, tx, ty, -tx, bL, bT, bR, bB);
  const pivot = { x: animX, y: totalLeverH + animY };
  const tip = {
    x: pivot.x + out.nx * dims.leverLength,
    y: pivot.y + out.ny * dims.leverLength,
  };
  return { pivot, tip, dims };
}

function rotLeverGeoAt(
  obj: CanvasObject,
  t: number,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
  revealRatio: number,
) {
  const dims = getRotationDims(
    obj,
    totalLeverH,
    canvasW,
    canvasH,
    revealRatio,
  );
  const totalDegRad = Math.PI * 2;
  const angle = ROT_START + t * totalDegRad;
  const dx = Math.cos(angle),
    dy = Math.sin(angle);
  const anchor = getRotationAnchor(obj);
  const pivot = { x: anchor.x, y: totalLeverH + anchor.y };
  const tip = {
    x: pivot.x + dx * dims.leverLength,
    y: pivot.y + dy * dims.leverLength,
  };
  return { pivot, tip, dims };
}

// ─── alpha outline extraction (edge-stitching + RDP) ─────────────────────────

type Pt = { x: number; y: number };
type Seg = { x1: number; y1: number; x2: number; y2: number };

function extractEdgeSegments(off: HTMLCanvasElement): Seg[] {
  const W = off.width,
    H = off.height;
  const { data } = off.getContext("2d")!.getImageData(0, 0, W, H);
  const op = (x: number, y: number) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    return data[(y * W + x) * 4 + 3] > ALPHA_THRESH;
  };
  const segs: Seg[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!op(x, y)) continue;
      if (!op(x, y - 1)) segs.push({ x1: x, y1: y, x2: x + 1, y2: y });
      if (!op(x, y + 1)) segs.push({ x1: x + 1, y1: y + 1, x2: x, y2: y + 1 });
      if (!op(x - 1, y)) segs.push({ x1: x, y1: y + 1, x2: x, y2: y });
      if (!op(x + 1, y)) segs.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 });
    }
  }
  return segs;
}

function stitchPolygons(segs: Seg[]): Pt[][] {
  const map = new Map<string, Seg[]>();
  for (const s of segs) {
    const key = `${s.x1},${s.y1}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  const used = new Set<Seg>();
  const polys: Pt[][] = [];
  for (const s0 of segs) {
    if (used.has(s0)) continue;
    const poly: Pt[] = [];
    let cur = s0;
    while (!used.has(cur)) {
      used.add(cur);
      poly.push({ x: cur.x1, y: cur.y1 });
      const nexts = map.get(`${cur.x2},${cur.y2}`) ?? [];
      const next = nexts.find((n) => !used.has(n));
      if (!next) break;
      cur = next;
    }
    if (poly.length >= 3) polys.push(poly);
  }
  return polys;
}

function rdp(pts: Pt[], epsilon: number): Pt[] {
  if (pts.length < 3) return pts;
  const [p1, p2] = [pts[0], pts[pts.length - 1]];
  const dx = p2.x - p1.x,
    dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  let maxDist = 0,
    idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d =
      len === 0
        ? Math.hypot(pts[i].x - p1.x, pts[i].y - p1.y)
        : Math.abs(dy * pts[i].x - dx * pts[i].y + p2.x * p1.y - p2.y * p1.x) /
          len;
    if (d > maxDist) {
      maxDist = d;
      idx = i;
    }
  }
  if (maxDist > epsilon) {
    return [
      ...rdp(pts.slice(0, idx + 1), epsilon).slice(0, -1),
      ...rdp(pts.slice(idx), epsilon),
    ];
  }
  return [p1, p2];
}

function getAlphaPolygons(off: HTMLCanvasElement): Pt[][] {
  const { data } = off
    .getContext("2d")!
    .getImageData(0, 0, off.width, off.height);
  let hasTransparent = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] <= ALPHA_THRESH) {
      hasTransparent = true;
      break;
    }
  }
  if (!hasTransparent) return [];
  return stitchPolygons(extractEdgeSegments(off))
    .map((p) => rdp(p, 1.5))
    .filter((p) => p.length >= 3);
}

// ─── Sheet 1: LEVERS ─────────────────────────────────────────────────────────
//
// Translation / rotation: full rod pivot→tip.
// Slide: full strip+tab rectangle at t=0 resting position.

function renderLeversSheet(
  objects: CanvasObject[],
  canvasW: number,
  canvasH: number,
  revealRatio: number,
): string {
  const pad = FABRICATION_LEVER_SHEET_PAD;
  const totalW = canvasW + pad * 2;
  const totalH = canvasH + pad * 2;
  const totalLeverH = 0;

  const canvas = document.createElement("canvas");
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalW, totalH);

  // Dashed canvas boundary
  ctx.save();
  ctx.strokeStyle = "#aaaaaa";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(pad, pad, canvasW, canvasH);
  ctx.setLineDash([]);
  ctx.restore();

  ctx.save();
  ctx.translate(pad, pad); // origin = canvas top-left
  ctx.strokeStyle = CUT_COLOR;
  ctx.lineWidth = CUT_STROKE;

  objects.forEach((obj) => {
    if (!obj.movement) return;

    if (obj.movement.type === "transition") {
      const geo = transLeverGeoAt(
        obj,
        0,
        totalLeverH,
        canvasW,
        canvasH,
        revealRatio,
      );
      drawFullRod(ctx, geo.pivot, geo.tip, geo.dims.rodWidth);
      punchHole(ctx, geo.pivot.x, geo.pivot.y, geo.dims.rodWidth * 0.3);
    }

    if (obj.movement.type === "rotation") {
      const geo = rotLeverGeoAt(
        obj,
        0,
        totalLeverH,
        canvasW,
        canvasH,
        revealRatio,
      );
      drawFullRod(ctx, geo.pivot, geo.tip, geo.dims.rodWidth);
      punchHole(ctx, geo.pivot.x, geo.pivot.y, geo.dims.rodWidth * 0.3);
    }

    if (obj.movement.type === "slide") {
      // Full strip rectangle — the physical piece to cut including both cells + tab + grip
      const geo = slideStripGeo(obj, canvasW, canvasH);
      ctx.strokeRect(geo.x, geo.y, geo.w, geo.h);

      // Dashed line showing where the two image cells join (fold line reference)
      const m = obj.movement as SlideMovement;
      const isV = m.direction === "vertical";
      ctx.save();
      ctx.strokeStyle = "#888888";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      if (isV) {
        // horizontal divider at the midpoint of the strip (where cells meet)
        const midY = geo.y + obj.height;
        ctx.beginPath();
        ctx.moveTo(geo.x, midY);
        ctx.lineTo(geo.x + geo.w, midY);
        ctx.stroke();
      } else {
        const midX = geo.x + obj.width;
        ctx.beginPath();
        ctx.moveTo(midX, geo.y);
        ctx.lineTo(midX, geo.y + geo.h);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
  });

  ctx.restore();

  ctx.fillStyle = "#333";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("LAYER 1 — LEVERS  (cut solid lines only)", 18, 22);
  drawRegMarks(ctx, totalW, totalH);
  return canvas.toDataURL("image/png");
}

// ─── Sheet 2: OBJECTS ────────────────────────────────────────────────────────
//
// Non-slide objects: alpha-traced silhouette at their canvas position.
// Slide objects: two composited cells (bg region + object image) appended
//               below the canvas region with cut borders.

async function renderObjectsSheet(
  background: string | null,
  objects: CanvasObject[],
  canvasW: number,
  canvasH: number,
): Promise<string> {
  // Load all images
  const allUrls = [
    ...(background ? [background] : []),
    ...objects.map((o) => o.imageUrl),
  ];
  const imgMap = new Map<
    string,
    { img: HTMLImageElement; off: HTMLCanvasElement }
  >();
  await Promise.all(
    allUrls.map((url) =>
      loadImageToCanvas(url)
        .then((res) => imgMap.set(url, res))
        .catch(() => {}),
    ),
  );

  const bgEntry = background ? (imgMap.get(background) ?? null) : null;
  const bgImg = bgEntry?.img ?? null;

  // ── Main canvas area (non-slide objects) ────────────────────────────────
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasW, canvasH);

  for (const obj of objects) {
    if (obj.movement?.type === "slide") continue; // handled below
    // Skip "after" objects of slide pairs (they appear in the strip)
    const isAfterObj = objects.some(
      (o) =>
        o.movement?.type === "slide" &&
        (o.movement as SlideMovement).secondObjectId === obj.id,
    );
    if (isAfterObj) continue;

    const res = imgMap.get(obj.imageUrl);
    if (!res) continue;

    const { img, off } = res;
    const ox = obj.position.x - obj.width / 2;
    const oy = obj.position.y - obj.height / 2;
    const scaleX = obj.width / img.naturalWidth;
    const scaleY = obj.height / img.naturalHeight;

    // Draw the source art at full opacity so the cut outline is visible
    // without the previous semi-transparent "shadow" effect.
    ctx.drawImage(img, ox, oy, obj.width, obj.height);

    // Silhouette outline
    const polys = getAlphaPolygons(off);
    ctx.save();
    ctx.strokeStyle = CUT_COLOR;
    ctx.lineWidth = CUT_STROKE;
    if (polys.length > 0) {
      for (const poly of polys) {
        ctx.beginPath();
        ctx.moveTo(ox + poly[0].x * scaleX, oy + poly[0].y * scaleY);
        for (let j = 1; j < poly.length; j++) {
          ctx.lineTo(ox + poly[j].x * scaleX, oy + poly[j].y * scaleY);
        }
        ctx.closePath();
        ctx.stroke();
      }
    } else {
      ctx.strokeRect(ox, oy, obj.width, obj.height);
    }
    ctx.restore();

    if (obj.movement?.type === "rotation") {
      const anchor = getRotationAnchor(obj);
      punchHole(ctx, anchor.x, anchor.y, 4);
    }
  }

  // Dashed canvas boundary
  ctx.save();
  ctx.strokeStyle = "#aaaaaa";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(1, 1, canvasW - 2, canvasH - 2);
  ctx.setLineDash([]);
  ctx.restore();

  ctx.fillStyle = "#333";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("LAYER 2 — OBJECTS  (cut solid lines only)", 10, 20);
  drawRegMarks(ctx, canvasW, canvasH);

  // ── Slide strips appended below ─────────────────────────────────────────
  const slideObjs = objects.filter((o) => o.movement?.type === "slide");
  if (slideObjs.length === 0) return canvas.toDataURL("image/png");

  const LABEL_H = 28,
    GAP = 16;
  let extraH = GAP;
  for (const obj of slideObjs) {
    const m = obj.movement as SlideMovement;
    const isV = m.direction === "vertical";
    extraH += LABEL_H + (isV ? obj.height * 2 : obj.height) + GAP;
  }

  const combined = document.createElement("canvas");
  combined.width = canvasW;
  combined.height = canvasH + extraH;
  const cctx = combined.getContext("2d")!;
  cctx.drawImage(canvas, 0, 0);

  let yOff = canvasH + GAP;

  for (const obj of slideObjs) {
    const m = obj.movement as SlideMovement;
    const isV = m.direction === "vertical";
    const imgW = obj.width,
      imgH = obj.height;
    const winX = obj.position.x - imgW / 2;
    const winY = obj.position.y - imgH / 2;
    const afterObj = objects.find((o) => o.id === m.secondObjectId);
    const beforeImg = imgMap.get(obj.imageUrl)?.img ?? null;
    const afterImg = afterObj
      ? (imgMap.get(afterObj.imageUrl)?.img ?? null)
      : null;

    // Label
    cctx.fillStyle = "#333";
    cctx.font = "bold 13px sans-serif";
    cctx.fillText(
      `Slide strip — ${isV ? "vertical" : "horizontal"}  |  before (top/left) · after (bottom/right)`,
      8,
      yOff + 16,
    );
    yOff += LABEL_H;

    // Two cells: before on the side that ends in the window, after on the far side
    // Match CanvasArea play-mode ordering:
    //   pull=down or pull=right → [after, before] (after is pulled in first)
    //   pull=up   or pull=left  → [after, before] same ordering
    // Both cells are imgW × imgH.
    type Cell = { imgEl: HTMLImageElement | null; cx: number; cy: number };
    const cells: Cell[] = isV
      ? [
          { imgEl: afterImg, cx: 0, cy: yOff },
          { imgEl: beforeImg, cx: 0, cy: yOff + imgH },
        ]
      : [
          { imgEl: afterImg, cx: 0, cy: yOff },
          { imgEl: beforeImg, cx: imgW, cy: yOff },
        ];

    for (const cell of cells) {
      cctx.save();
      cctx.beginPath();
      cctx.rect(cell.cx, cell.cy, imgW, imgH);
      cctx.clip();

      // Background region (same slice that sits behind the window)
      if (bgImg) {
        const scaleX = bgImg.naturalWidth / canvasW;
        const scaleY = bgImg.naturalHeight / canvasH;
        cctx.drawImage(
          bgImg,
          winX * scaleX,
          winY * scaleY,
          imgW * scaleX,
          imgH * scaleY,
          cell.cx,
          cell.cy,
          imgW,
          imgH,
        );
      } else {
        cctx.fillStyle = "#ffffff";
        cctx.fillRect(cell.cx, cell.cy, imgW, imgH);
      }

      // Object image on top
      if (cell.imgEl) {
        cctx.drawImage(cell.imgEl, cell.cx, cell.cy, imgW, imgH);
      }

      cctx.restore();

      // Cut border
      cctx.save();
      cctx.strokeStyle = CUT_COLOR;
      cctx.lineWidth = CUT_STROKE;
      cctx.strokeRect(cell.cx, cell.cy, imgW, imgH);
      cctx.restore();
    }

    yOff += isV ? imgH * 2 + GAP : imgH + GAP;
  }

  return combined.toDataURL("image/png");
}

// ─── Sheet 3: BACKGROUND ─────────────────────────────────────────────────────
//
// Background image with:
//   • Translation centerline (thin line from start to end)
//   • Slide window cut-out (rectangle where the strip peeks through)
//   • Rotation anchor hole
//   • Outer border cut

async function renderBackgroundSheet(
  background: string | null,
  objects: CanvasObject[],
  canvasW: number,
  canvasH: number,
): Promise<string> {
  const bgEntry = background
    ? await loadImageToCanvas(background).catch(() => null)
    : null;
  const bgImg = bgEntry?.img ?? null;

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;

  if (bgImg) {
    ctx.drawImage(bgImg, 0, 0, canvasW, canvasH);
  } else {
    ctx.fillStyle = "#f5f2ea";
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  objects.forEach((obj) => {
    if (!obj.movement) return;

    if (obj.movement.type === "transition") {
      const m = obj.movement as TransitionMovement;
      ctx.save();
      ctx.strokeStyle = CUT_COLOR;
      ctx.lineWidth = CUT_STROKE;
      ctx.beginPath();
      ctx.moveTo(obj.position.x, obj.position.y);
      ctx.lineTo(m.endPoint.x, m.endPoint.y);
      ctx.stroke();
      punchHole(ctx, obj.position.x, obj.position.y, 3);
      punchHole(ctx, m.endPoint.x, m.endPoint.y, 3);
      ctx.restore();
    }

    if (obj.movement.type === "slide") {
      const wx = obj.position.x - obj.width / 2;
      const wy = obj.position.y - obj.height / 2;
      ctx.save();
      ctx.strokeStyle = CUT_COLOR;
      ctx.lineWidth = CUT_STROKE;
      ctx.strokeRect(wx, wy, obj.width, obj.height);
      ctx.restore();
    }

    if (obj.movement.type === "rotation") {
      const anchor = getRotationAnchor(obj);
      punchHole(ctx, anchor.x, anchor.y, 5);
    }
  });

  ctx.save();
  ctx.strokeStyle = CUT_COLOR;
  ctx.lineWidth = CUT_STROKE;
  ctx.strokeRect(1, 1, canvasW - 2, canvasH - 2);
  ctx.restore();

  ctx.fillStyle = "#333";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("LAYER 3 — BACKGROUND  (cut solid lines only)", 10, 20);
  drawRegMarks(ctx, canvasW, canvasH);

  return canvas.toDataURL("image/png");
}

// ─── main entry ──────────────────────────────────────────────────────────────

export async function buildFabricationSheets(
  background: string | null,
  objects: CanvasObject[],
  canvasW: number,
  canvasH: number,
  revealRatio: number,
): Promise<FabricationSheets> {
  const [leversDataUrl, objectsDataUrl, backgroundDataUrl] = await Promise.all([
    Promise.resolve(
      renderLeversSheet(objects, canvasW, canvasH, revealRatio),
    ),
    renderObjectsSheet(background, objects, canvasW, canvasH),
    renderBackgroundSheet(background, objects, canvasW, canvasH),
  ]);
  return { leversDataUrl, objectsDataUrl, backgroundDataUrl };
}

export function downloadPng(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

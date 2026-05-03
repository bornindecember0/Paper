/**
 * fabricationExport.ts
 *
 * Three cut-ready layers, each rendered onto an A4 page (150 DPI = 1240×1754 px)
 * with the 800×600 canvas area centred on the page.
 *
 * Canvas area origin on the page:
 *   CANVAS_OFFSET_X = (1240 - 800) / 2 = 220 px
 *   CANVAS_OFFSET_Y = (1754 - 600) / 2 = 577 px
 *
 * All three sheets share the same canvas position so that printed PDFs stack
 * and register correctly using the corner marks.
 *
 *   1. LEVERS
 *      • Translation / rotation: full rod from pivot to tip
 *      • Slide: full strip+tab rectangle at its t=0 resting position
 *
 *   2. OBJECTS
 *      • Every non-slide object: alpha-traced silhouette (or bounding rect)
 *      • Every slide object: two composited cells (bg + object image) drawn
 *        at the strip's t=0 physical position (may extend outside canvas area)
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

/** A4 landscape @ 150 DPI (297mm × 210mm) */
const A4_W_PX = 1754;
const A4_H_PX = 1240;

/** Top-left corner of the canvas area on the A4 page (pixels). */
const CANVAS_OFFSET_X = (A4_W_PX - 800) / 2; // 477
const CANVAS_OFFSET_Y = (A4_H_PX - 600) / 2; // 320

export interface FabricationSheets {
  leversDataUrl: string;
  objectsDataUrl: string;
  backgroundDataUrl: string;
  printDataUrl: string;
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

/**
 * Draw ⊕ registration marks at the four corners of the canvas area.
 * ox/oy are the page-space top-left of the canvas area.
 */
function drawRegMarks(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  w: number,
  h: number,
) {
  const pts = [
    [ox + REG_RADIUS + 4, oy + REG_RADIUS + 4],
    [ox + w - REG_RADIUS - 4, oy + REG_RADIUS + 4],
    [ox + REG_RADIUS + 4, oy + h - REG_RADIUS - 4],
    [ox + w - REG_RADIUS - 4, oy + h - REG_RADIUS - 4],
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
// canvas boundary.

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

  const stripLen = (isV ? canvasH : canvasW) + TAB_THICK + GRIP_EXTRA;
  const stripCross = isV ? imgW : imgH;

  const winX = obj.position.x - imgW / 2;
  const winY = obj.position.y - imgH / 2;

  let rx = 0,
    ry = 0,
    rw = 0,
    rh = 0;

  if (isV) {
    rw = stripCross;
    rh = stripLen;
    rx = winX;
    if (m.pullDirection === "down") {
      ry = canvasH - stripLen + TAB_THICK + GRIP_EXTRA;
    } else {
      ry = -(TAB_THICK + GRIP_EXTRA);
    }
  } else {
    rw = stripLen;
    rh = stripCross;
    ry = winY;
    if (m.pullDirection === "right") {
      rx = canvasW - stripLen + TAB_THICK + GRIP_EXTRA;
    } else {
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

/**
 * Find the angle (radians) from canvas-local (anchorX, anchorY) that maximises
 * the available distance to the A4 page boundary, so the lever rod fits entirely
 * on the printed page regardless of the object's position.
 */
function bestRotationDrawAngle(anchorX: number, anchorY: number): number {
  // A4 landscape page boundary expressed in canvas-local coords
  // (i.e. after ctx.translate(CANVAS_OFFSET_X, CANVAS_OFFSET_Y))
  const pageLeft   = -CANVAS_OFFSET_X;
  const pageRight  =  A4_W_PX - CANVAS_OFFSET_X;
  const pageTop    = -CANVAS_OFFSET_Y;
  const pageBottom =  A4_H_PX - CANVAS_OFFSET_Y;

  let bestAngle = ROT_START;
  let bestDist  = -Infinity;

  for (let i = 0; i < 360; i++) {
    const angle = (i / 360) * Math.PI * 2;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    let dist = Infinity;
    if (nx >  1e-9) dist = Math.min(dist, (pageRight  - anchorX) /  nx);
    if (nx < -1e-9) dist = Math.min(dist, (anchorX - pageLeft)   / -nx);
    if (ny >  1e-9) dist = Math.min(dist, (pageBottom - anchorY) /  ny);
    if (ny < -1e-9) dist = Math.min(dist, (anchorY - pageTop)    / -ny);
    if (dist > bestDist) { bestDist = dist; bestAngle = angle; }
  }
  return bestAngle;
}

function rotLeverGeoAt(
  obj: CanvasObject,
  t: number,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
  revealRatio: number,
  drawAngle?: number,
) {
  const dims = getRotationDims(
    obj,
    totalLeverH,
    canvasW,
    canvasH,
    revealRatio,
    drawAngle,      // sheetCap is now computed for the actual drawing direction
  );
  const totalDegRad = Math.PI * 2;
  const angle = drawAngle !== undefined ? drawAngle : ROT_START + t * totalDegRad;
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

// ─── A4 canvas factory ────────────────────────────────────────────────────────

function makeA4Canvas(): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = A4_W_PX;
  canvas.height = A4_H_PX;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, A4_W_PX, A4_H_PX);
  return { canvas, ctx };
}

// ─── Sheet 1: BASE ─────────────────────────────────────────────────────────
function renderLeversSheet(
  objects: CanvasObject[],
  canvasW: number,
  canvasH: number,
  _revealRatio: number,
): string {
  const { canvas, ctx } = makeA4Canvas();
  const ox = CANVAS_OFFSET_X;
  const oy = CANVAS_OFFSET_Y;

  // Solid border in page space (no translate active)
  ctx.save();
  ctx.strokeStyle = CUT_COLOR;
  ctx.lineWidth = CUT_STROKE;
  ctx.strokeRect(ox, oy, canvasW, canvasH);
  ctx.restore();

  // Holder indicators for slide objects
  ctx.save();
  ctx.translate(ox, oy);

  objects.forEach((obj) => {
    if (obj.movement?.type !== "slide") return;
    const m = obj.movement as SlideMovement;
    const isV = m.direction === "vertical";
    const imgW = obj.width, imgH = obj.height;
    const winX = obj.position.x - imgW / 2;
    const winY = obj.position.y - imgH / 2;
    const GAP = 40;

    let hx = 0, hy = 0, hw = 0, hh = 0;

    if (isV) {
      // vertical slider: holder is wide and short, placed above/below window
      hw = imgW;
      hh = imgH * 0.25;
      hx = winX + (imgW - hw) / 2;
      hy = m.pullDirection === "up" ? winY + imgH + GAP : winY - hh - GAP;
    } else {
      // horizontal slider: holder is tall and thin, placed left/right of window
      hw = imgW * 0.25;
      hh = imgH;
      hy = winY + (imgH - hh) / 2;
      hx = m.pullDirection === "left" ? winX + imgW + GAP : winX - hw - GAP;
    }

    ctx.save();
    ctx.strokeStyle = CUT_COLOR;
    ctx.lineWidth = CUT_STROKE;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(hx, hy, hw, hh);
    ctx.setLineDash([]);
    ctx.fillStyle = "#555";
    ctx.font = "11px sans-serif";
    ctx.fillText("slide holder", hx + 4, hy - 4);
    ctx.restore();
  });

  ctx.restore();

  ctx.fillStyle = "#333";
  ctx.font = "bold 15px sans-serif";
  drawRegMarks(ctx, ox, oy, canvasW, canvasH);
  ctx.fillText("LAYER 1 — BASE  (cut solid lines only)", 10, 20);

  return canvas.toDataURL("image/png");
}

// ─── Sheet 2: OBJECTS ────────────────────────────────────────────────────────
//
// Non-slide objects: alpha-traced silhouette at their canvas position.
// Slide objects: two composited cells (bg region + object image) drawn at the
//               strip's t=0 physical position (may extend outside canvas area).

async function renderObjectsSheet(
  background: string | null,
  objects: CanvasObject[],
  canvasW: number,
  canvasH: number,
): Promise<string> {
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

  const { canvas, ctx } = makeA4Canvas();
  const ox = CANVAS_OFFSET_X;
  const oy = CANVAS_OFFSET_Y;

  // All canvas-local drawing via translate
  ctx.save();
  ctx.translate(ox, oy);

  // ── Non-slide objects ────────────────────────────────────────────────────
  for (const obj of objects) {
    if (obj.movement?.type === "slide") continue;
    const isAfterObj = objects.some(
      (o) =>
        o.movement?.type === "slide" &&
        (o.movement as SlideMovement).secondObjectId === obj.id,
    );
    if (isAfterObj) continue;

    const res = imgMap.get(obj.imageUrl);
    if (!res) continue;

    const { img, off } = res;
    const imgOx = obj.position.x - obj.width / 2;
    const imgOy = obj.position.y - obj.height / 2;
    const scaleX = obj.width / img.naturalWidth;
    const scaleY = obj.height / img.naturalHeight;

    ctx.drawImage(img, imgOx, imgOy, obj.width, obj.height);

    const polys = getAlphaPolygons(off);
    ctx.save();
    ctx.strokeStyle = CUT_COLOR;
    ctx.lineWidth = CUT_STROKE;
    if (polys.length > 0) {
      for (const poly of polys) {
        ctx.beginPath();
        ctx.moveTo(imgOx + poly[0].x * scaleX, imgOy + poly[0].y * scaleY);
        for (let j = 1; j < poly.length; j++) {
          ctx.lineTo(imgOx + poly[j].x * scaleX, imgOy + poly[j].y * scaleY);
        }
        ctx.closePath();
        ctx.stroke();
      }
    } else {
      ctx.strokeRect(imgOx, imgOy, obj.width, obj.height);
    }
    ctx.restore();

    if (obj.movement?.type === "rotation") {
      const anchor = getRotationAnchor(obj);
      punchHole(ctx, anchor.x, anchor.y, 4);
    }
  }

  // ── Slide strips at t=0 physical position ───────────────────────────────
  const slideObjs = objects.filter((o) => o.movement?.type === "slide");

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

    const firstImg = beforeImg;
    const secondImg =  afterImg ;

    const geo = slideStripGeo(obj, canvasW, canvasH);

    // [after, before] ordering matches CanvasArea play-mode
    type Cell = { imgEl: HTMLImageElement | null; cx: number; cy: number };
    const tabOffset = (m.pullDirection === "up" || m.pullDirection === "left")
      ? TAB_THICK + GRIP_EXTRA : 0;
    const cells: Cell[] = isV
      ? [
          { imgEl: firstImg,  cx: winX, cy: geo.y + tabOffset + winY },
          { imgEl: secondImg, cx: winX, cy: geo.y + tabOffset + winY + (m.pullDirection === "down" ? -imgH : imgH) },
        ]
      : [
          { imgEl: firstImg,  cx: geo.x + tabOffset + winX, cy: winY },
          { imgEl: secondImg, cx: geo.x + tabOffset + winX + (m.pullDirection === "right" ? -imgW : imgW), cy: winY },
        ];
      
    for (const cell of cells) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(cell.cx, cell.cy, imgW, imgH);
      ctx.clip();

      if (bgImg) {
        const scaleX = bgImg.naturalWidth / canvasW;
        const scaleY = bgImg.naturalHeight / canvasH;
        ctx.drawImage(
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
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(cell.cx, cell.cy, imgW, imgH);
      }

      if (cell.imgEl) {
        ctx.drawImage(cell.imgEl, cell.cx, cell.cy, imgW, imgH);
      }
      ctx.restore();

      // Cell cut border
      ctx.save();
      ctx.strokeStyle = CUT_COLOR;
      ctx.lineWidth = CUT_STROKE;
      ctx.restore();
    }

    // Overall strip cut border (includes tab area)
    ctx.save();
    ctx.strokeStyle = CUT_COLOR;
    ctx.lineWidth = CUT_STROKE;
    ctx.strokeRect(geo.x, geo.y, geo.w, geo.h);
    ctx.restore();
  }

  ctx.save();
  ctx.restore();
  ctx.restore(); // undo translate

  ctx.fillStyle = "#333";
  ctx.font = "bold 15px sans-serif";
  ctx.fillText("LAYER 2 — OBJECTS  (cut solid lines only)", 10, 20);

  return canvas.toDataURL("image/png");
}

// ─── Sheet 3: BACKGROUND ─────────────────────────────────────────────────────

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

  const { canvas, ctx } = makeA4Canvas();
  const ox = CANVAS_OFFSET_X;
  const oy = CANVAS_OFFSET_Y;

  ctx.save();
  ctx.translate(ox, oy);

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

  // Canvas outer border
  ctx.save();
  ctx.strokeStyle = CUT_COLOR;
  ctx.lineWidth = CUT_STROKE;
  ctx.strokeRect(1, 1, canvasW - 2, canvasH - 2);
  ctx.restore();

  ctx.restore(); // undo translate

  ctx.fillStyle = "#333";
  ctx.font = "bold 15px sans-serif";
  ctx.fillText("LAYER 3 — BACKGROUND  (cut solid lines only)", 10, 20);
  drawRegMarks(ctx, ox, oy, canvasW, canvasH);

  return canvas.toDataURL("image/png");
}

// ─── Sheet 4: LEVER PRINT SHEET ──────────────────────────────────────────────
//
// All lever pieces (rods + slide strips) laid out side-by-side in rows so they
// never overlap and are easy to cut independently.
//
// • Transition / rotation rods  → normalised to horizontal (w = leverLength,
//   h = rodWidth). Rotation rods get a pivot hole at the left end.
// • Slide strips                → normalised so the longer dimension is
//   horizontal. The dashed fold line marks the cell boundary.
//
// Pieces are packed left→right in rows; a new row starts when a piece would
// overflow the right margin.

function renderLeverPrintSheet(
  objects: CanvasObject[],
  canvasW: number,
  canvasH: number,
  revealRatio: number,
): string {
  const { canvas, ctx } = makeA4Canvas();

  const MARGIN = 50;
  const GAP = 28;
  const LABEL_H = 18;

  interface LayoutPiece {
    w: number;
    h: number;
    draw: (lx: number, ly: number) => void;
  }

  const pieces: LayoutPiece[] = [];
  let idx = 0;

  for (const obj of objects) {
    if (!obj.movement) continue;
    idx++;
    const label = `#${idx} ${obj.movement.type}`;

    // ── Transition rod ───────────────────────────────────────────────────
    if (obj.movement.type === "transition") {
      const geo = transLeverGeoAt(obj, 0, 0, canvasW, canvasH, revealRatio);
      const pw = Math.ceil(geo.dims.leverLength);
      const ph = Math.ceil(geo.dims.rodWidth);
      pieces.push({
        w: pw,
        h: ph + LABEL_H,
        draw(lx, ly) {
          ctx.fillStyle = "#555";
          ctx.font = "11px sans-serif";
          ctx.fillText(label, lx, ly + LABEL_H - 3);
          ctx.save();
          ctx.strokeStyle = CUT_COLOR;
          ctx.lineWidth = CUT_STROKE;
          ctx.strokeRect(lx, ly + LABEL_H, pw, ph);
          const holeR = ph * 0.3;
          punchHole(ctx, lx + holeR * 1.5, ly + LABEL_H + ph / 2, holeR);
          ctx.restore();
        },
      });
    }

    // ── Rotation rod ─────────────────────────────────────────────────────
    if (obj.movement.type === "rotation") {
      const anchor = getRotationAnchor(obj);
      const drawAngle = bestRotationDrawAngle(anchor.x, anchor.y);
      const geo = rotLeverGeoAt(obj, 0, 0, canvasW, canvasH, revealRatio, drawAngle);
      const pw = Math.ceil(geo.dims.leverLength);
      const ph = Math.ceil(geo.dims.rodWidth);
      pieces.push({
        w: pw,
        h: ph + LABEL_H,
        draw(lx, ly) {
          ctx.fillStyle = "#555";
          ctx.font = "11px sans-serif";
          ctx.fillText(label, lx, ly + LABEL_H - 3);
          ctx.save();
          ctx.strokeStyle = CUT_COLOR;
          ctx.lineWidth = CUT_STROKE;
          ctx.strokeRect(lx, ly + LABEL_H, pw, ph);
          const holeR = ph * 0.3;
          punchHole(ctx, lx + holeR * 1.5, ly + LABEL_H + ph / 2, holeR);
          ctx.restore();
        },
      });
    }

    // ── Slide holders (two per slide) ───────────────────────────────────────
    if (obj.movement.type === "slide") {
      const m = obj.movement as SlideMovement;
      const isV = (m.direction === "vertical");
      const holderW = Math.ceil((isV ? obj.width : obj.height) * 2.5);
      const holderH = Math.ceil((isV ? obj.height : obj.width) * 0.25);
      const holderLabel = `#${idx} slide holder ${1}`;
      pieces.push({
        w: holderW,
        h: holderH + LABEL_H,
        draw(lx, ly) {
          ctx.fillStyle = "#555";
          ctx.font = "11px sans-serif";
          ctx.fillText(holderLabel, lx, ly + LABEL_H - 3);
          ctx.save();
          ctx.strokeStyle = CUT_COLOR;
          ctx.lineWidth = CUT_STROKE;
          ctx.strokeRect(lx, ly + LABEL_H, holderW, holderH);
          ctx.restore();
        },
        });
      
    }
  }

  // ── Row layout ───────────────────────────────────────────────────────────
  const availW = A4_W_PX - MARGIN * 2;
  let px = MARGIN;
  let py = MARGIN + 34; // space below title
  let rowH = 0;

  for (const piece of pieces) {
    if (px > MARGIN && px + piece.w > MARGIN + availW) {
      // Wrap to next row
      px = MARGIN;
      py += rowH + GAP;
      rowH = 0;
    }
    piece.draw(px, py);
    px += piece.w + GAP;
    rowH = Math.max(rowH, piece.h);
  }

  ctx.fillStyle = "#333";
  ctx.font = "bold 15px sans-serif";
  ctx.fillText("LEVER PRINT SHEET  (cut solid lines only)", 10, 20);


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
  const printDataUrl = renderLeverPrintSheet(objects, canvasW, canvasH, revealRatio);
  return { leversDataUrl, objectsDataUrl, backgroundDataUrl, printDataUrl };
}

// ─── download helpers ─────────────────────────────────────────────────────────

/**
 * Wrap an A4 PNG data URL in a single-page PDF and trigger download.
 * Uses jsPDF with mm units so the image fills the A4 page exactly.
 */
export async function downloadPdf(
  dataUrl: string,
  filename: string,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  pdf.addImage(dataUrl, "PNG", 0, 0, 297, 210);
  pdf.save(filename);
}

export function downloadPng(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

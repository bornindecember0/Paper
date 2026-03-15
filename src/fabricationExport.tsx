/**
 * fabricationExport.ts
 *
 * Three cut-ready PNG layers:
 *   1. LEVERS     – full rod from pivot to tip (entire physical piece)
 *   2. OBJECTS    – silhouette traced from alpha channel (or rect fallback)
 *   3. BACKGROUND – bg image with:
 *                     • translation centerline
 *                     • slide strip (bg region + object composited, both cells)
 *                     • rotation anchor hole
 *                     • outer border
 */

import type {
  CanvasObject,
  SlideMovement,
  TransitionMovement,
  RotationMovement,
} from "./types";
import {
  getTransitionDims,
  getRotationDims,
  getRotationAnchor,
  getPathDir,
  chooseOutwardNormal,
  rayExitDistanceToBoard,
} from "./leverGeometry";

// ─── constants ────────────────────────────────────────────────────────────────
const CUT_STROKE = 2.5;
const CUT_COLOR = "#000000";
const REG_RADIUS = 10;
const ROT_START = -Math.PI / 2;
const TAB_THICK = 28;

export interface FabricationSheets {
  leversDataUrl: string;
  objectsDataUrl: string;
  backgroundDataUrl: string;
}

// ─── utilities ────────────────────────────────────────────────────────────────

function drawRegMarks(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const corners = [
    [REG_RADIUS + 4, REG_RADIUS + 4],
    [w - REG_RADIUS - 4, REG_RADIUS + 4],
    [REG_RADIUS + 4, h - REG_RADIUS - 4],
    [w - REG_RADIUS - 4, h - REG_RADIUS - 4],
  ];
  ctx.save();
  ctx.strokeStyle = CUT_COLOR;
  ctx.lineWidth = 1.2;
  for (const [cx, cy] of corners) {
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

/**
 * Load an image and immediately draw it into an offscreen canvas,
 * returning both the element and a pixel-readable canvas.
 * Using an offscreen canvas avoids blob-URL taint on getImageData.
 */
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
    // blob: URLs are same-origin so no crossOrigin needed, but set it anyway
    img.src = url;
  });
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

/** Draw the full rod rectangle: from → to (entire physical cut piece). */
function drawFullRod(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  rodWidth: number,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
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

// ─── lever geometry (mirrors PlayOverlay) ────────────────────────────────────

function transLeverGeoAt(
  obj: CanvasObject,
  t: number,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
) {
  const m = obj.movement as TransitionMovement;
  const dims = getTransitionDims(obj, totalLeverH, canvasW, canvasH);
  const dirX = m.endPoint.x - obj.position.x;
  const dirY = m.endPoint.y - obj.position.y;
  const animX = obj.position.x + dirX * t;
  const animY = obj.position.y + dirY * t;
  const bL = 0,
    bT = totalLeverH,
    bR = canvasW,
    bB = totalLeverH + canvasH;
  const { tx, ty } = getPathDir(obj);
  const midX = (obj.position.x + m.endPoint.x) / 2 + obj.width / 2;
  const midY =
    totalLeverH + (obj.position.y + m.endPoint.y) / 2 + obj.height / 2;
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
) {
  const m = obj.movement as RotationMovement;
  const dims = getRotationDims(obj, totalLeverH, canvasW, canvasH);
  const totalDegRad = (m.degrees * (m.clockwise ? 1 : -1) * Math.PI) / 180;
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

// ─── alpha contour tracing ────────────────────────────────────────────────────
//
// Reads pixel data from an already-drawn offscreen canvas (no blob taint issue).
// Uses Moore neighbourhood boundary tracing to find the silhouette polygon.
// Returns points in image-local pixel coordinates.

function traceAlphaOutline(off: HTMLCanvasElement): { x: number; y: number }[] {
  const W = off.width;
  const H = off.height;
  const ctx = off.getContext("2d")!;
  const { data } = ctx.getImageData(0, 0, W, H);

  const ALPHA_THRESHOLD = 30;

  const isOpaque = (x: number, y: number): boolean => {
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    return data[(y * W + x) * 4 + 3] > ALPHA_THRESHOLD;
  };

  // Check whether the image has any transparency at all
  let hasTransparent = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] <= ALPHA_THRESHOLD) {
      hasTransparent = true;
      break;
    }
  }
  if (!hasTransparent) return []; // caller will use bounding rect

  // Find first opaque pixel (top-to-bottom, left-to-right scan)
  let startX = -1,
    startY = -1;
  outerLoop: for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isOpaque(x, y)) {
        startX = x;
        startY = y;
        break outerLoop;
      }
    }
  }
  if (startX === -1) return [];

  // 8-directional Moore neighbourhood offsets (0=E … 7=NE)
  const DX = [1, 1, 0, -1, -1, -1, 0, 1];
  const DY = [0, 1, 1, 1, 0, -1, -1, -1];

  const boundary: { x: number; y: number }[] = [];
  let cx = startX,
    cy = startY;
  let dir = 4; // pretend we came from the west
  const MAX_STEPS = W * H * 2;
  let steps = 0;

  do {
    boundary.push({ x: cx, y: cy });
    const back = (dir + 4) % 8;
    let d = (back + 1) % 8;
    while (!isOpaque(cx + DX[d], cy + DY[d])) {
      d = (d + 1) % 8;
      if (d === back) break;
    }
    dir = d;
    cx += DX[d];
    cy += DY[d];
    steps++;
  } while ((cx !== startX || cy !== startY) && steps < MAX_STEPS);

  if (boundary.length < 3) return [];

  // Downsample to ≈120 points so the stroke is clean
  const step = Math.max(1, Math.floor(boundary.length / 120));
  return boundary.filter((_, i) => i % step === 0);
}

// ─── Sheet 1: LEVERS ─────────────────────────────────────────────────────────

function renderLeversSheet(
  objects: CanvasObject[],
  canvasW: number,
  canvasH: number,
): string {
  const pad = 320;
  const totalW = canvasW + pad * 2;
  const totalH = canvasH + pad * 2;
  const offX = pad,
    offY = pad;
  const totalLeverH = 0;

  const canvas = document.createElement("canvas");
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalW, totalH);

  // Board boundary dashed guide
  ctx.save();
  ctx.strokeStyle = "#aaaaaa";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(offX, offY, canvasW, canvasH);
  ctx.setLineDash([]);
  ctx.restore();

  ctx.save();
  ctx.translate(offX, offY);
  ctx.strokeStyle = CUT_COLOR;
  ctx.lineWidth = CUT_STROKE;

  objects.forEach((obj) => {
    if (!obj.movement) return;

    if (obj.movement.type === "transition") {
      const geo = transLeverGeoAt(obj, 0, totalLeverH, canvasW, canvasH);
      drawFullRod(ctx, geo.pivot, geo.tip, geo.dims.rodWidth);
      punchHole(ctx, geo.pivot.x, geo.pivot.y, geo.dims.rodWidth * 0.3);
    }

    if (obj.movement.type === "rotation") {
      const geo = rotLeverGeoAt(obj, 0, totalLeverH, canvasW, canvasH);
      drawFullRod(ctx, geo.pivot, geo.tip, geo.dims.rodWidth);
      punchHole(ctx, geo.pivot.x, geo.pivot.y, geo.dims.rodWidth * 0.3);
    }

    if (obj.movement.type === "slide") {
      const m = obj.movement as SlideMovement;
      const isV = m.direction === "vertical";
      const wX = obj.position.x - obj.width / 2;
      const wY = obj.position.y - obj.height / 2;
      const tabW = isV ? obj.width : TAB_THICK;
      const tabH = isV ? TAB_THICK : obj.height;
      let tabX = wX,
        tabY = wY;
      if (m.pullDirection === "down") tabY = canvasH;
      else if (m.pullDirection === "up") tabY = -TAB_THICK;
      else if (m.pullDirection === "right") tabX = canvasW;
      else tabX = -TAB_THICK;
      ctx.strokeRect(tabX, tabY, tabW, tabH);
    }
  });

  ctx.restore();

  ctx.fillStyle = "#333333";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("LAYER 1 — LEVERS  (cut solid lines only)", 18, 22);

  drawRegMarks(ctx, totalW, totalH);
  return canvas.toDataURL("image/png");
}

// ─── Sheet 2: OBJECTS ────────────────────────────────────────────────────────
//
// For each object:
//   • Load the image into an offscreen canvas so getImageData is readable
//   • Trace the alpha silhouette (polygon for lasso-cropped objects)
//   • Draw the outline scaled to the object's canvas-space dimensions
//   • Rectangular objects (no transparency) get a plain bounding rect

async function renderObjectsSheet(
  objects: CanvasObject[],
  canvasW: number,
  canvasH: number,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasW, canvasH);

  const loaded = await Promise.all(
    objects.map((o) => loadImageToCanvas(o.imageUrl).catch(() => null)),
  );

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const res = loaded[i];
    if (!res) continue;

    const { img, off } = res;
    const ox = obj.position.x - obj.width / 2;
    const oy = obj.position.y - obj.height / 2;
    const scaleX = obj.width / img.naturalWidth;
    const scaleY = obj.height / img.naturalHeight;

    // Ghost reference
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.drawImage(img, ox, oy, obj.width, obj.height);
    ctx.restore();

    // Trace silhouette from the offscreen canvas pixels
    const localPts = traceAlphaOutline(off);

    ctx.save();
    ctx.strokeStyle = CUT_COLOR;
    ctx.lineWidth = CUT_STROKE;

    if (localPts.length >= 3) {
      // Polygon from alpha trace
      ctx.beginPath();
      ctx.moveTo(ox + localPts[0].x * scaleX, oy + localPts[0].y * scaleY);
      for (let j = 1; j < localPts.length; j++) {
        ctx.lineTo(ox + localPts[j].x * scaleX, oy + localPts[j].y * scaleY);
      }
      ctx.closePath();
      ctx.stroke();
    } else {
      // No transparency — plain bounding rectangle
      ctx.strokeRect(ox, oy, obj.width, obj.height);
    }

    ctx.restore();

    // Rotation anchor hole
    if (obj.movement?.type === "rotation") {
      const anchor = getRotationAnchor(obj);
      punchHole(ctx, anchor.x, anchor.y, 4);
    }
  }

  // Dashed canvas boundary guide
  ctx.save();
  ctx.strokeStyle = "#aaaaaa";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(1, 1, canvasW - 2, canvasH - 2);
  ctx.setLineDash([]);
  ctx.restore();

  ctx.fillStyle = "#333333";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("LAYER 2 — OBJECTS  (cut solid lines only)", 10, 20);

  drawRegMarks(ctx, canvasW, canvasH);
  return canvas.toDataURL("image/png");
}

// ─── Sheet 3: BACKGROUND ─────────────────────────────────────────────────────
//
// Slide handling: the strip needs to print correctly so the background region
// and the object both appear in the window when assembled.
//
// For each slide object we render TWO cells side-by-side (or stacked) on a
// separate strip canvas, matching exactly what CanvasArea does in play mode:
//   cell A = background-region-of-the-window + "after" object image on top
//   cell B = background-region-of-the-window + "before" object image on top
// Each cell is imgW × imgH.  The strip is printed separately so it can be
// slotted behind the background cut-out.

async function renderBackgroundSheet(
  background: string | null,
  objects: CanvasObject[],
  canvasW: number,
  canvasH: number,
): Promise<string> {
  // Load all images up front
  const allUrls = [
    ...(background ? [background] : []),
    ...objects.map((o) => o.imageUrl),
  ];
  const imageMap = new Map<string, HTMLImageElement>();
  await Promise.all(
    allUrls.map((url) =>
      loadImageToCanvas(url)
        .then(({ img }) => imageMap.set(url, img))
        .catch(() => {}),
    ),
  );

  const bgImg = background ? (imageMap.get(background) ?? null) : null;

  // ── Main background canvas ──────────────────────────────────────────────
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

  // ── Per-object marks ────────────────────────────────────────────────────
  objects.forEach((obj) => {
    if (!obj.movement) return;

    // Translation: thin centerline
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

    // Slide: cut-out window on the background
    if (obj.movement.type === "slide") {
      const wx = obj.position.x - obj.width / 2;
      const wy = obj.position.y - obj.height / 2;
      ctx.save();
      ctx.strokeStyle = CUT_COLOR;
      ctx.lineWidth = CUT_STROKE;
      ctx.strokeRect(wx, wy, obj.width, obj.height);
      ctx.restore();
    }

    // Rotation: anchor hole
    if (obj.movement.type === "rotation") {
      const anchor = getRotationAnchor(obj);
      punchHole(ctx, anchor.x, anchor.y, 5);
    }
  });

  // Outer border
  ctx.save();
  ctx.strokeStyle = CUT_COLOR;
  ctx.lineWidth = CUT_STROKE;
  ctx.strokeRect(1, 1, canvasW - 2, canvasH - 2);
  ctx.restore();

  ctx.fillStyle = "#333333";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("LAYER 3 — BACKGROUND  (cut solid lines only)", 10, 20);
  drawRegMarks(ctx, canvasW, canvasH);

  // ── Slide strip canvases (one per slide object, appended below) ─────────
  //
  // Each strip contains two cells [before | after] (or [after | before]
  // depending on pull direction) with the background region composited first
  // then the object image on top — exactly matching CanvasArea play mode.
  //
  // We composite everything onto a single tall PNG that includes the main
  // background at the top and all strips stacked below it.

  const slideObjs = objects.filter((o) => o.movement?.type === "slide");

  if (slideObjs.length === 0) {
    return canvas.toDataURL("image/png");
  }

  // Calculate total height needed
  const STRIP_LABEL_H = 28;
  const STRIP_GAP = 16;
  let extraH = STRIP_GAP;
  for (const obj of slideObjs) {
    const m = obj.movement as SlideMovement;
    const isV = m.direction === "vertical";
    extraH += STRIP_LABEL_H + (isV ? obj.height * 2 : obj.height) + STRIP_GAP;
  }

  const combined = document.createElement("canvas");
  combined.width = canvasW;
  combined.height = canvasH + extraH;
  const cctx = combined.getContext("2d")!;

  // Copy main background
  cctx.drawImage(canvas, 0, 0);

  let yOffset = canvasH + STRIP_GAP;

  for (const obj of slideObjs) {
    const m = obj.movement as SlideMovement;
    const isV = m.direction === "vertical";
    const imgW = obj.width;
    const imgH = obj.height;
    const winX = obj.position.x - imgW / 2;
    const winY = obj.position.y - imgH / 2;

    const afterObj = objects.find((o) => o.id === m.secondObjectId);
    const beforeImg = imageMap.get(obj.imageUrl) ?? null;
    const afterImg = afterObj
      ? (imageMap.get(afterObj.imageUrl) ?? null)
      : null;

    // Strip label
    cctx.fillStyle = "#333333";
    cctx.font = "bold 13px sans-serif";
    cctx.fillText(
      `Slide strip — ${isV ? "vertical" : "horizontal"} (before ← left/top, after → right/bottom)`,
      8,
      yOffset + 16,
    );
    yOffset += STRIP_LABEL_H;

    // Build the two cells
    type Cell = { imgEl: HTMLImageElement | null; x: number; y: number };
    let cells: Cell[];

    if (isV) {
      // Stack vertically: cell0 at top, cell1 below
      cells = [
        { imgEl: afterImg, x: 0, y: yOffset },
        { imgEl: beforeImg, x: 0, y: yOffset + imgH },
      ];
    } else {
      // Side by side: cell0 left, cell1 right
      cells = [
        { imgEl: afterImg, x: 0, y: yOffset },
        { imgEl: beforeImg, x: imgW, y: yOffset },
      ];
    }

    for (const cell of cells) {
      cctx.save();
      cctx.beginPath();
      cctx.rect(cell.x, cell.y, imgW, imgH);
      cctx.clip();

      // Background region (the same slice of the bg that sits behind the window)
      if (bgImg) {
        const scaleX = bgImg.naturalWidth / canvasW;
        const scaleY = bgImg.naturalHeight / canvasH;
        cctx.drawImage(
          bgImg,
          winX * scaleX,
          winY * scaleY,
          imgW * scaleX,
          imgH * scaleY,
          cell.x,
          cell.y,
          imgW,
          imgH,
        );
      } else {
        cctx.fillStyle = "#ffffff";
        cctx.fillRect(cell.x, cell.y, imgW, imgH);
      }

      // Object image on top
      if (cell.imgEl) {
        cctx.drawImage(cell.imgEl, cell.x, cell.y, imgW, imgH);
      }

      cctx.restore();

      // Cell border (cut line)
      cctx.save();
      cctx.strokeStyle = CUT_COLOR;
      cctx.lineWidth = CUT_STROKE;
      cctx.strokeRect(cell.x, cell.y, imgW, imgH);
      cctx.restore();
    }

    yOffset += isV ? imgH * 2 + STRIP_GAP : imgH + STRIP_GAP;
  }

  return combined.toDataURL("image/png");
}

// ─── main entry ──────────────────────────────────────────────────────────────

export async function buildFabricationSheets(
  background: string | null,
  objects: CanvasObject[],
  canvasW: number,
  canvasH: number,
): Promise<FabricationSheets> {
  const [leversDataUrl, objectsDataUrl, backgroundDataUrl] = await Promise.all([
    Promise.resolve(renderLeversSheet(objects, canvasW, canvasH)),
    renderObjectsSheet(objects, canvasW, canvasH),
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

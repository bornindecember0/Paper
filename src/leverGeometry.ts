/**
 * Shared lever geometry: dimensions and helpers for transition/rotation levers.
 * Used by PlayOverlay and by the export script.
 */
import type { CanvasObject, Position } from './types';
import type { RotationMovement, TransitionMovement } from './types';

export const LEVER_ROW_H = 100;
export const DEFAULT_LEVER_LENGTH = 180;
export const DEFAULT_LEVER_WIDTH = 18;
export const DEFAULT_LEVER_REVEAL_RATIO = 0.5;

const LEVER_LENGTH_MIN = 140;
const TRANSITION_EXIT_SAMPLES = 81;
const TRANSITION_EXIT_SAFETY = 12;
const LEVER_SAFE_MAX_FACTOR = 0.85;

/** Must match levers sheet padding in fabricationExport (translate before drawing). */
export const FABRICATION_LEVER_SHEET_PAD = 320;

/**
 * Max distance from pivot along unit (nx, ny) before the lever tip leaves the
 * fabrication sheet (including pad), with edge margin for reg marks / stroke.
 * Coordinates match canvas space after ctx.translate(pad, pad): inner canvas is [0,cw]×[0,ch].
 */
function maxLeverToFabricationSheetEdge(
  px: number,
  py: number,
  nx: number,
  ny: number,
  canvasW: number,
  canvasH: number,
  pad: number,
  edgeMargin: number,
): number {
  let cap = Infinity;
  if (Math.abs(nx) > 1e-9) {
    if (nx > 0) {
      cap = Math.min(cap, (canvasW + pad - edgeMargin - px) / nx);
    } else {
      cap = Math.min(cap, (pad + px - edgeMargin) / (-nx));
    }
  } else {
    const xAbs = pad + px;
    if (xAbs < edgeMargin || xAbs > canvasW + 2 * pad - edgeMargin) {
      cap = 0;
    }
  }
  if (Math.abs(ny) > 1e-9) {
    if (ny > 0) {
      cap = Math.min(cap, (canvasH + pad - edgeMargin - py) / ny);
    } else {
      cap = Math.min(cap, (pad + py - edgeMargin) / (-ny));
    }
  } else {
    const yAbs = pad + py;
    if (yAbs < edgeMargin || yAbs > canvasH + 2 * pad - edgeMargin) {
      cap = 0;
    }
  }
  if (!Number.isFinite(cap) || cap < 0) return 0;
  return cap;
}

function transitionFabricationSheetLeverCap(
  obj: CanvasObject,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
  rodWidth: number,
): number {
  const m = obj.movement as TransitionMovement;
  const dirX = m.endPoint.x - obj.position.x;
  const dirY = m.endPoint.y - obj.position.y;
  const boardLeft = 0;
  const boardTop = totalLeverH;
  const boardRight = canvasW;
  const boardBottom = totalLeverH + canvasH;
  const { tx, ty } = getPathDir(obj);
  const nx1 = -ty;
  const ny1 = tx;
  const nx2 = ty;
  const ny2 = -tx;
  const midX = (obj.position.x + m.endPoint.x) / 2;
  const midY = totalLeverH + (obj.position.y + m.endPoint.y) / 2;
  const outward = chooseOutwardNormal(
    midX,
    midY,
    nx1,
    ny1,
    nx2,
    ny2,
    boardLeft,
    boardTop,
    boardRight,
    boardBottom,
  );
  const edgeMargin = 36 + rodWidth * 0.5;
  let minAlongPath = Infinity;
  for (let i = 0; i <= TRANSITION_EXIT_SAMPLES; i++) {
    const t = i / TRANSITION_EXIT_SAMPLES;
    const px = obj.position.x + dirX * t;
    const py = totalLeverH + obj.position.y + dirY * t;
    const cap = maxLeverToFabricationSheetEdge(
      px,
      py,
      outward.nx,
      outward.ny,
      canvasW,
      canvasH,
      FABRICATION_LEVER_SHEET_PAD,
      edgeMargin,
    );
    minAlongPath = Math.min(minAlongPath, cap);
  }
  return minAlongPath;
}

/**
 * How far the rotation lever can extend from the anchor in the given draw
 * direction before hitting the fabrication sheet edge.
 * drawAngle defaults to -π/2 (straight up) when not provided.
 */
function rotationFabricationSheetLeverCap(
  obj: CanvasObject,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
  rodWidth: number,
  drawAngle = -Math.PI / 2,
): number {
  const anchor = getRotationAnchor(obj);
  const px = anchor.x;
  const py = totalLeverH + anchor.y;
  const edgeMargin = 36 + rodWidth * 0.5;
  const nx = Math.cos(drawAngle);
  const ny = Math.sin(drawAngle);
  return maxLeverToFabricationSheetEdge(
    px,
    py,
    nx,
    ny,
    canvasW,
    canvasH,
    FABRICATION_LEVER_SHEET_PAD,
    edgeMargin,
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hypot2(x: number, y: number): number {
  return Math.hypot(x, y) || 1;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function rayExitDistanceToBoard(
  px: number,
  py: number,
  dx: number,
  dy: number,
  boardLeft: number,
  boardTop: number,
  boardRight: number,
  boardBottom: number,
): number {
  const ts: number[] = [];
  if (dx > 1e-6) ts.push((boardRight - px) / dx);
  if (dx < -1e-6) ts.push((boardLeft - px) / dx);
  if (dy > 1e-6) ts.push((boardBottom - py) / dy);
  if (dy < -1e-6) ts.push((boardTop - py) / dy);
  const positive = ts.filter(v => v >= 0);
  return positive.length ? Math.min(...positive) : 0;
}

export function getPathDir(obj: CanvasObject): { tx: number; ty: number; len: number } {
  const m = obj.movement as TransitionMovement;
  const dx = m.endPoint.x - obj.position.x;
  const dy = m.endPoint.y - obj.position.y;
  const len = hypot2(dx, dy);
  return { tx: dx / len, ty: dy / len, len };
}

export function chooseOutwardNormal(
  mx: number, my: number,
  nx1: number, ny1: number, nx2: number, ny2: number,
  boardLeft: number, boardTop: number, boardRight: number, boardBottom: number,
): { nx: number; ny: number } {
  const d1 = rayExitDistanceToBoard(mx, my, nx1, ny1, boardLeft, boardTop, boardRight, boardBottom);
  const d2 = rayExitDistanceToBoard(mx, my, nx2, ny2, boardLeft, boardTop, boardRight, boardBottom);
  return d1 <= d2 ? { nx: nx1, ny: ny1 } : { nx: nx2, ny: ny2 };
}

function estimateTransitionMaxExitDist(
  obj: CanvasObject,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
): number {
  const m = obj.movement as TransitionMovement;
  const dirX = m.endPoint.x - obj.position.x;
  const dirY = m.endPoint.y - obj.position.y;
  const boardLeft = 0;
  const boardTop = totalLeverH;
  const boardRight = canvasW;
  const boardBottom = totalLeverH + canvasH;
  const { tx, ty } = getPathDir(obj);
  const nx1 = -ty;
  const ny1 = tx;
  const nx2 = ty;
  const ny2 = -tx;
  const midX = (obj.position.x + m.endPoint.x) / 2;
  const midY = totalLeverH + (obj.position.y + m.endPoint.y) / 2;
  const outward = chooseOutwardNormal(midX, midY, nx1, ny1, nx2, ny2, boardLeft, boardTop, boardRight, boardBottom);
  let maxExit = 0;
  for (let i = 0; i <= TRANSITION_EXIT_SAMPLES; i++) {
    const t = i / TRANSITION_EXIT_SAMPLES;
    const pivot = {
      x: obj.position.x + dirX * t,
      y: totalLeverH + obj.position.y + dirY * t,
    };
    const d = rayExitDistanceToBoard(pivot.x, pivot.y, outward.nx, outward.ny, boardLeft, boardTop, boardRight, boardBottom);
    maxExit = Math.max(maxExit, d);
  }
  return maxExit;
}

/** Transition lever dimensions (fixed length, rod width). */
export function getTransitionDims(
  obj: CanvasObject,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
  revealRatio = DEFAULT_LEVER_REVEAL_RATIO,
): { leverLength: number; rodWidth: number } {
  const m = obj.movement as TransitionMovement;
  const dx = m.endPoint.x - obj.position.x;
  const dy = m.endPoint.y - obj.position.y;
  const travel = Math.hypot(dx, dy);
  const shortSide = Math.max(1, Math.min(obj.width, obj.height));
  const longSide = Math.max(obj.width, obj.height);
  const rodWidth = clamp(shortSide * 0.16, 14, 28);
  const maxExitDist = estimateTransitionMaxExitDist(obj, totalLeverH, canvasW, canvasH);
  const minExpose = Math.max(rodWidth * 2.5, 36);
  const diagonalCap = Math.max(
    LEVER_LENGTH_MIN,
    Math.ceil(Math.hypot(canvasW, canvasH) * LEVER_SAFE_MAX_FACTOR),
  );
  const sheetCap = transitionFabricationSheetLeverCap(
    obj,
    totalLeverH,
    canvasW,
    canvasH,
    rodWidth,
  );
  const safeMaxLength = Math.max(
    LEVER_LENGTH_MIN,
    Math.min(diagonalCap, sheetCap),
  );
  const baseLength = clamp(
    Math.max(
      longSide * 1.1,
      travel * 0.8,
      maxExitDist + minExpose + TRANSITION_EXIT_SAFETY,
      DEFAULT_LEVER_LENGTH,
    ),
    LEVER_LENGTH_MIN,
    safeMaxLength,
  );
  const t = clamp(revealRatio, 0, 1);
  const leverLength =
    baseLength >= safeMaxLength
      ? baseLength
      : lerp(baseLength, safeMaxLength, t);
  return { leverLength, rodWidth };
}

/** Anchor is stored as offset from object center; returns absolute position. */
export function getRotationAnchor(obj: CanvasObject): Position {
  const m = obj.movement as RotationMovement | undefined;
  if (!m || m.type !== 'rotation') return obj.position;
  return {
    x: obj.position.x + m.anchorPoint.x,
    y: obj.position.y + m.anchorPoint.y,
  };
}

function estimateRotationMaxExitDist(
  anchor: Position,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
): number {
  const pivotX = anchor.x;
  const pivotY = totalLeverH + anchor.y;
  const corners: [number, number][] = [
    [0, totalLeverH],
    [canvasW, totalLeverH],
    [0, totalLeverH + canvasH],
    [canvasW, totalLeverH + canvasH],
  ];
  let maxExit = 0;
  for (const [cx, cy] of corners) {
    maxExit = Math.max(maxExit, Math.hypot(cx - pivotX, cy - pivotY));
  }
  return maxExit;
}

/** Rotation lever dimensions (fixed length, rod width).
 *  drawAngle: the angle at which the lever will be drawn on the fabrication
 *  sheet. When provided, sheetCap is computed for that direction so the lever
 *  is never capped below the minimum functional length. */
export function getRotationDims(
  obj: CanvasObject,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
  revealRatio = DEFAULT_LEVER_REVEAL_RATIO,
  drawAngle?: number,
): { leverLength: number; rodWidth: number } {
  const anchor = getRotationAnchor(obj);
  const shortSide = Math.max(1, Math.min(obj.width, obj.height));
  const rodWidth = clamp(shortSide * 0.16, 14, 28);
  const maxExitDist = estimateRotationMaxExitDist(anchor, totalLeverH, canvasW, canvasH);
  const minExpose = Math.max(rodWidth * 2.5, 36);
  const longSide = Math.max(obj.width, obj.height);
  const diagonalCap = Math.max(
    LEVER_LENGTH_MIN,
    Math.ceil(Math.hypot(canvasW, canvasH) * LEVER_SAFE_MAX_FACTOR),
  );
  const sheetCap = rotationFabricationSheetLeverCap(
    obj,
    totalLeverH,
    canvasW,
    canvasH,
    rodWidth,
    drawAngle,
  );
  const safeMaxLength = Math.max(
    LEVER_LENGTH_MIN,
    Math.min(diagonalCap, sheetCap),
  );
  const baseLength = clamp(
    Math.max(longSide * 1.1, maxExitDist + minExpose, DEFAULT_LEVER_LENGTH),
    LEVER_LENGTH_MIN,
    safeMaxLength,
  );
  const t = clamp(revealRatio, 0, 1);
  const leverLength =
    baseLength >= safeMaxLength
      ? baseLength
      : lerp(baseLength, safeMaxLength, t);
  return { leverLength, rodWidth };
}

/** For slide: no lever length (row handle). Returns null. */
export function getSlideLeverLength(): null {
  return null;
}

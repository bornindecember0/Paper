/**
 * Shared lever geometry: dimensions and helpers for transition/rotation levers.
 * Used by PlayOverlay and by the export script.
 */
import type { CanvasObject, Position } from './types';
import type { RotationMovement, TransitionMovement } from './types';
import {
  getPathPoint,
  getPathTangent,
  resolveAbsPath,
} from './pathUtils';

export const LEVER_ROW_H = 100;
export const DEFAULT_LEVER_LENGTH = 180;
export const DEFAULT_LEVER_WIDTH = 18;

const LEVER_LENGTH_MIN = 140;
const LEVER_LENGTH_MAX_TRANS = 420;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
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

export function chooseOutwardNormal(
  mx: number, my: number,
  nx1: number, ny1: number, nx2: number, ny2: number,
  boardLeft: number, boardTop: number, boardRight: number, boardBottom: number,
): { nx: number; ny: number } {
  const d1 = rayExitDistanceToBoard(mx, my, nx1, ny1, boardLeft, boardTop, boardRight, boardBottom);
  const d2 = rayExitDistanceToBoard(mx, my, nx2, ny2, boardLeft, boardTop, boardRight, boardBottom);
  return d1 <= d2 ? { nx: nx1, ny: ny1 } : { nx: nx2, ny: ny2 };
}

/**
 * Choose a consistent outward normal direction for an entire path.
 * Samples the midpoint tangent and locks the side that exits the board soonest.
 */
export function pathOutwardNormal(
  absPath: Position[],
  objHalfW: number,
  objHalfH: number,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
): { nx: number; ny: number } {
  const boardLeft = 0;
  const boardTop = totalLeverH;
  const boardRight = canvasW;
  const boardBottom = totalLeverH + canvasH;

  const mid = getPathTangent(absPath, 0.5);
  const nx1 = -mid.ty;
  const ny1 = mid.tx;
  const nx2 = mid.ty;
  const ny2 = -mid.tx;

  const midPt = getPathPoint(absPath, 0.5);
  const midX = midPt.x + objHalfW;
  const midY = totalLeverH + midPt.y + objHalfH;

  return chooseOutwardNormal(midX, midY, nx1, ny1, nx2, ny2, boardLeft, boardTop, boardRight, boardBottom);
}

/**
 * For each sample along the curve, use the tangent-derived normal (consistent side)
 * and find the worst-case exit distance to the board edge.
 */
function estimateTransitionMaxExitDist(
  absPath: Position[],
  obj: CanvasObject,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
): number {
  const boardLeft = 0;
  const boardTop = totalLeverH;
  const boardRight = canvasW;
  const boardBottom = totalLeverH + canvasH;

  const outward = pathOutwardNormal(
    absPath,
    obj.width / 2,
    obj.height / 2,
    totalLeverH,
    canvasW,
    canvasH,
  );

  let maxExit = 0;
  const SAMPLES = 20;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const tangent = getPathTangent(absPath, t);
    // Keep the same side as the locked outward direction
    const perpNx = -tangent.ty;
    const perpNy = tangent.tx;
    const dot = perpNx * outward.nx + perpNy * outward.ny;
    const nx = dot >= 0 ? perpNx : -perpNx;
    const ny = dot >= 0 ? perpNy : -perpNy;

    const pt = getPathPoint(absPath, t);
    const pivotX = pt.x;
    const pivotY = totalLeverH + pt.y;
    const d = rayExitDistanceToBoard(pivotX, pivotY, nx, ny, boardLeft, boardTop, boardRight, boardBottom);
    maxExit = Math.max(maxExit, d);
  }
  return maxExit;
}

/** Transition lever dimensions given user-chosen exposure (how far lever sticks out past board edge). */
export function getTransitionDims(
  obj: CanvasObject,
  leverExposure: number,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
): { leverLength: number; rodWidth: number } {
  const m = obj.movement as TransitionMovement;
  const absPath = resolveAbsPath(m.path, obj.position);

  const shortSide = Math.max(1, Math.min(obj.width, obj.height));
  const rodWidth = clamp(shortSide * 0.16, 14, 28);

  const maxExitDist = estimateTransitionMaxExitDist(absPath, obj, totalLeverH, canvasW, canvasH);

  const leverLength = clamp(
    Math.max(maxExitDist + leverExposure, rodWidth * 3, DEFAULT_LEVER_LENGTH),
    LEVER_LENGTH_MIN,
    LEVER_LENGTH_MAX_TRANS,
  );

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

/** Rotation lever dimensions (fixed length, rod width). */
export function getRotationDims(
  obj: CanvasObject,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
): { leverLength: number; rodWidth: number } {
  const anchor = getRotationAnchor(obj);
  const shortSide = Math.max(1, Math.min(obj.width, obj.height));
  const rodWidth = clamp(shortSide * 0.16, 14, 28);
  const maxExitDist = estimateRotationMaxExitDist(anchor, totalLeverH, canvasW, canvasH);
  const minExpose = Math.max(rodWidth * 2.5, 36);
  const longSide = Math.max(obj.width, obj.height);
  const maxLever = Math.ceil(Math.hypot(canvasW, canvasH) * 0.85);
  const leverLength = clamp(
    Math.max(longSide * 1.1, maxExitDist + minExpose, DEFAULT_LEVER_LENGTH),
    LEVER_LENGTH_MIN,
    maxLever,
  );
  return { leverLength, rodWidth };
}


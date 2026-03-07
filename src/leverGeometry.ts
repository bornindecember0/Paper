/**
 * Shared lever geometry: dimensions and helpers for transition/rotation levers.
 * Used by PlayOverlay and by the export script.
 */
import type { CanvasObject, Position } from './types';
import type { RotationMovement, TransitionMovement } from './types';

export const LEVER_ROW_H = 100;
export const DEFAULT_LEVER_LENGTH = 180;
export const DEFAULT_LEVER_WIDTH = 18;

const LEVER_LENGTH_MIN = 140;
const LEVER_LENGTH_MAX_TRANS = 420;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hypot2(x: number, y: number): number {
  return Math.hypot(x, y) || 1;
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
  const midX = (obj.position.x + m.endPoint.x) / 2 + obj.width / 2;
  const midY = totalLeverH + (obj.position.y + m.endPoint.y) / 2 + obj.height / 2;
  const outward = chooseOutwardNormal(midX, midY, nx1, ny1, nx2, ny2, boardLeft, boardTop, boardRight, boardBottom);
  let maxExit = 0;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
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
  const leverLength = clamp(
    Math.max(longSide * 1.1, travel * 0.8, maxExitDist + minExpose, DEFAULT_LEVER_LENGTH),
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

/** For slide: no lever length (row handle). Returns null. */
export function getSlideLeverLength(): null {
  return null;
}

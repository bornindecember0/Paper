import type { Position } from './types';

export const DEFAULT_SLOT_WIDTH = 8; // canvas px — physical cut slot width

// ── Ramer-Douglas-Peucker simplification ─────────────────────────────────────

export function rdpSimplify(pts: Position[], epsilon: number): Position[] {
  if (pts.length < 3) return pts;
  let maxDist = 0;
  let maxIdx = 0;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const lineLen = Math.hypot(last.x - first.x, last.y - first.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const d =
      lineLen > 1e-6
        ? Math.abs(
            (last.y - first.y) * pts[i].x -
              (last.x - first.x) * pts[i].y +
              last.x * first.y -
              last.y * first.x,
          ) / lineLen
        : Math.hypot(pts[i].x - first.x, pts[i].y - first.y);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(pts.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify(pts.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

// ── Arc-length parameterisation ───────────────────────────────────────────────

/** Cumulative arc lengths for each vertex of a polyline. lengths[0] === 0. */
export function arcLengths(path: Position[]): number[] {
  const lens = [0];
  for (let i = 1; i < path.length; i++) {
    lens.push(
      lens[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y),
    );
  }
  return lens;
}

/** Total arc length of the path. */
export function totalArcLength(path: Position[]): number {
  if (path.length < 2) return 0;
  const lens = arcLengths(path);
  return lens[lens.length - 1];
}

/** Position along the path at uniform t ∈ [0, 1]. */
export function getPathPoint(path: Position[], t: number): Position {
  if (path.length === 0) return { x: 0, y: 0 };
  if (path.length === 1) return { ...path[0] };
  const lens = arcLengths(path);
  const total = lens[lens.length - 1];
  if (total < 1e-6) return { ...path[0] };
  const target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < path.length; i++) {
    if (lens[i] >= target || i === path.length - 1) {
      const seg = lens[i] - lens[i - 1];
      const frac = seg > 1e-6 ? (target - lens[i - 1]) / seg : 0;
      return {
        x: path[i - 1].x + frac * (path[i].x - path[i - 1].x),
        y: path[i - 1].y + frac * (path[i].y - path[i - 1].y),
      };
    }
  }
  return { ...path[path.length - 1] };
}

/** Unit tangent direction at uniform t ∈ [0, 1]. */
export function getPathTangent(path: Position[], t: number): { tx: number; ty: number } {
  if (path.length < 2) return { tx: 1, ty: 0 };
  const lens = arcLengths(path);
  const total = lens[lens.length - 1];
  if (total < 1e-6) return { tx: 1, ty: 0 };
  const target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < path.length; i++) {
    if (lens[i] >= target || i === path.length - 1) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      return { tx: dx / len, ty: dy / len };
    }
  }
  return { tx: 1, ty: 0 };
}

/**
 * Resolve a relative path (stored in TransitionMovement.path, relative to obj.position)
 * into absolute canvas coordinates.
 */
export function resolveAbsPath(path: Position[], origin: Position): Position[] {
  return path.map(p => ({ x: origin.x + p.x, y: origin.y + p.y }));
}

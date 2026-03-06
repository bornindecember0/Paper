import { useRef, useEffect, useCallback, useState } from 'react';
import type { CanvasObject, Position, InteractionMode } from '../types';

export const CANVAS_W = 800;
export const CANVAS_H = 600;
const GRID = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function rotatePoint(p: Position, cx: number, cy: number, angleDeg: number): Position {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Compute animated state: center position + rotation angle applied to object. */
function getAnimatedState(obj: CanvasObject, t: number): { cx: number; cy: number; angleDeg: number } {
  const { position: pos, movement } = obj;
  if (!movement) return { cx: pos.x, cy: pos.y, angleDeg: 0 };

  if (movement.type === 'transition') {
    return {
      cx: pos.x + (movement.endPoint.x - pos.x) * t,
      cy: pos.y + (movement.endPoint.y - pos.y) * t,
      angleDeg: 0,
    };
  }

  if (movement.type === 'rotation') {
    const totalDeg = movement.degrees * (movement.clockwise ? 1 : -1) * t;
    const anchor = movement.anchorPoint;
    const rotated = rotatePoint(pos, anchor.x, anchor.y, totalDeg);
    return { cx: rotated.x, cy: rotated.y, angleDeg: totalDeg };
  }

  if (movement.type === 'slide') {
    const dist = movement.range * t;
    return {
      cx: movement.direction === 'horizontal' ? pos.x + dist : pos.x,
      cy: movement.direction === 'vertical' ? pos.y + dist : pos.y,
      angleDeg: 0,
    };
  }

  return { cx: pos.x, cy: pos.y, angleDeg: 0 };
}

function isInsideObject(obj: CanvasObject, pos: Position): boolean {
  return (
    pos.x >= obj.position.x - obj.width / 2 &&
    pos.x <= obj.position.x + obj.width / 2 &&
    pos.y >= obj.position.y - obj.height / 2 &&
    pos.y <= obj.position.y + obj.height / 2
  );
}

function hitTest(objects: CanvasObject[], pos: Position): CanvasObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    if (isInsideObject(objects[i], pos)) return objects[i];
  }
  return null;
}

// ── Arrow drawing helpers ────────────────────────────────────────────────────

function drawArrowHead(ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number) {
  const headLen = 14;
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

function drawTransitionArrow(ctx: CanvasRenderingContext2D, from: Position, to: Position) {
  ctx.save();
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 3]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  drawArrowHead(ctx, from.x, from.y, to.x, to.y);
  // label end point
  ctx.fillStyle = '#3b82f6';
  ctx.font = '12px sans-serif';
  ctx.fillText('end', to.x + 6, to.y - 6);
  ctx.restore();
}

function drawRotationArrow(
  ctx: CanvasRenderingContext2D,
  anchor: Position,
  objCenter: Position,
  degrees: number,
  clockwise: boolean,
) {
  const radius = Math.hypot(objCenter.x - anchor.x, objCenter.y - anchor.y) + 20;
  const startAngle = Math.atan2(objCenter.y - anchor.y, objCenter.x - anchor.x);
  const sweep = (degrees * Math.PI) / 180;
  const endAngle = startAngle + (clockwise ? sweep : -sweep);

  ctx.save();
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, radius, startAngle, endAngle, !clockwise);
  ctx.stroke();

  // Arrowhead at end of arc
  const arrowAngle = endAngle + (clockwise ? 0.15 : -0.15);
  const ax = anchor.x + radius * Math.cos(endAngle);
  const ay = anchor.y + radius * Math.sin(endAngle);
  const bx = anchor.x + radius * Math.cos(arrowAngle);
  const by = anchor.y + radius * Math.sin(arrowAngle);
  drawArrowHead(ctx, bx, by, ax, ay);

  // Anchor dot
  ctx.fillStyle = '#10b981';
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSlideArrow(ctx: CanvasRenderingContext2D, obj: CanvasObject) {
  if (obj.movement?.type !== 'slide') return;
  const { direction, range } = obj.movement;
  const { position: pos } = obj;
  const toX = direction === 'horizontal' ? pos.x + range : pos.x;
  const toY = direction === 'vertical' ? pos.y + range : pos.y;

  ctx.save();
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 3]);
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.setLineDash([]);
  drawArrowHead(ctx, pos.x, pos.y, toX, toY);
  ctx.restore();
}

// ── Collision zone drawing ───────────────────────────────────────────────────

function drawCollisionZone(ctx: CanvasRenderingContext2D, obj: CanvasObject, canvasW: number, canvasH: number) {
  if (!obj.movement) return;
  const { position: pos, width: w, height: h, movement } = obj;

  ctx.save();

  if (movement.type === 'transition') {
    // Swept convex hull: union of start bbox + end bbox
    const end = movement.endPoint;
    const dx = end.x - pos.x;
    const dy = end.y - pos.y;
    ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);

    // Build convex hull of 8 corners (start box + end box)
    const startCorners = [
      { x: pos.x - w / 2, y: pos.y - h / 2 },
      { x: pos.x + w / 2, y: pos.y - h / 2 },
      { x: pos.x + w / 2, y: pos.y + h / 2 },
      { x: pos.x - w / 2, y: pos.y + h / 2 },
    ];
    const endCorners = startCorners.map(c => ({ x: c.x + dx, y: c.y + dy }));
    const allPts = [...startCorners, ...endCorners];
    const hull = convexHull(allPts);
    if (hull.length === 0) { ctx.restore(); return; }
    ctx.beginPath();
    ctx.moveTo(hull[0].x, hull[0].y);
    hull.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (movement.type === 'rotation') {
    // Circle centered at anchor with radius = max distance from anchor to any corner
    const anchor = movement.anchorPoint;
    const corners = [
      { x: pos.x - w / 2, y: pos.y - h / 2 },
      { x: pos.x + w / 2, y: pos.y - h / 2 },
      { x: pos.x + w / 2, y: pos.y + h / 2 },
      { x: pos.x - w / 2, y: pos.y + h / 2 },
    ];
    const radius = Math.max(...corners.map(c => Math.hypot(c.x - anchor.x, c.y - anchor.y)));
    ctx.fillStyle = 'rgba(16, 185, 129, 0.10)';
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (movement.type === 'slide') {
    ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    let rx: number, ry: number, rw: number, rh: number;
    if (movement.direction === 'vertical') {
      // Strip: full canvas height, object width
      rx = pos.x - w / 2;
      ry = 0;
      rw = w;
      rh = canvasH;
    } else {
      // Strip: full canvas width, object height
      rx = 0;
      ry = pos.y - h / 2;
      rw = canvasW;
      rh = h;
    }
    ctx.beginPath();
    ctx.rect(rx, ry, rw, rh);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

// Graham scan convex hull (for swept area of transition)
function convexHull(points: Position[]): Position[] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
  const cross = (O: Position, A: Position, B: Position) =>
    (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
  const lower: Position[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Position[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  background: string | null;
  objects: CanvasObject[];
  selectedId: string | null;
  mode: InteractionMode;
  sliderValues: Record<string, number>;
  onCanvasClick: (pos: Position) => void;
  onObjectSelect: (id: string | null) => void;
  onObjectMove: (id: string, pos: Position) => void;
}

export function CanvasArea({
  background,
  objects,
  selectedId,
  mode,
  sliderValues,
  onCanvasClick,
  onObjectSelect,
  onObjectMove,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCache = useRef<Record<string, HTMLImageElement>>({});
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const didMoveRef = useRef(false);

  // ── Image preloading ──────────────────────────────────────────────────────
  const [, forceRedraw] = useState(0);

  useEffect(() => {
    const allUrls = [
      ...(background ? [background] : []),
      ...objects.map(o => o.imageUrl),
    ];
    allUrls.forEach(url => {
      if (!imageCache.current[url]) {
        const img = new Image();
        img.onload = () => {
          imageCache.current[url] = img;
          forceRedraw(n => n + 1);
        };
        img.src = url;
      }
    });
  }, [background, objects]);

  // ── Draw ──────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Grid
    ctx.save();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let x = 0; x <= CANVAS_W; x += GRID) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += GRID) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    }
    ctx.restore();

    // Background image
    if (background && imageCache.current[background]) {
      ctx.drawImage(imageCache.current[background], 0, 0, CANVAS_W, CANVAS_H);
    }

    // Collision zones (behind objects)
    objects.forEach(obj => drawCollisionZone(ctx, obj, CANVAS_W, CANVAS_H));

    // Objects
    objects.forEach(obj => {
      const imgEl = imageCache.current[obj.imageUrl];
      if (!imgEl) return;

      const t = sliderValues[obj.id] ?? 0;
      const { cx, cy, angleDeg } = getAnimatedState(obj, t);

      ctx.save();
      ctx.translate(cx, cy);

      if (angleDeg !== 0 && obj.movement?.type === 'rotation') {
        // Rotate around anchor (translated to be relative to current center)
        const anchorRel = {
          x: obj.movement.anchorPoint.x - obj.position.x,
          y: obj.movement.anchorPoint.y - obj.position.y,
        };
        ctx.translate(anchorRel.x, anchorRel.y);
        ctx.rotate((angleDeg * Math.PI) / 180);
        ctx.translate(-anchorRel.x, -anchorRel.y);
      }

      ctx.drawImage(imgEl, -obj.width / 2, -obj.height / 2, obj.width, obj.height);

      // Selection border
      if (obj.id === selectedId && mode !== 'play') {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(-obj.width / 2 - 3, -obj.height / 2 - 3, obj.width + 6, obj.height + 6);
        ctx.setLineDash([]);
      }

      ctx.restore();
    });

    // Movement indicators (arrows)
    if (mode !== 'play') {
      objects.forEach(obj => {
        if (!obj.movement) return;
        if (obj.movement.type === 'transition') {
          drawTransitionArrow(ctx, obj.position, obj.movement.endPoint);
        } else if (obj.movement.type === 'rotation') {
          drawRotationArrow(ctx, obj.movement.anchorPoint, obj.position, obj.movement.degrees, obj.movement.clockwise);
        } else if (obj.movement.type === 'slide') {
          drawSlideArrow(ctx, obj);
        }
      });
    }

    // Cursor hint while setting anchor / end-point
    if (mode === 'setting-end-point' || mode === 'setting-anchor') {
      ctx.save();
      ctx.strokeStyle = mode === 'setting-end-point' ? '#3b82f6' : '#10b981';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(2, 2, CANVAS_W - 4, CANVAS_H - 4);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }, [background, objects, selectedId, mode, sliderValues]);

  useEffect(() => { draw(); }, [draw]);

  // ── Canvas coordinate helper ──────────────────────────────────────────────
  const getPos = (e: React.MouseEvent<HTMLCanvasElement>): Position => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.round(e.clientX - rect.left),
      y: Math.round(e.clientY - rect.top),
    };
  };

  // ── Mouse event handlers ──────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode === 'setting-end-point' || mode === 'setting-anchor' || mode === 'play') return;
    const pos = getPos(e);
    const hit = hitTest(objects, pos);
    if (hit) {
      dragRef.current = { id: hit.id, offX: pos.x - hit.position.x, offY: pos.y - hit.position.y };
      didMoveRef.current = false;
      onObjectSelect(hit.id);
    } else {
      onObjectSelect(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const pos = getPos(e);
    onObjectMove(dragRef.current.id, {
      x: pos.x - dragRef.current.offX,
      y: pos.y - dragRef.current.offY,
    });
    didMoveRef.current = true;
  };

  const handleMouseUp = () => {
    dragRef.current = null;
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (didMoveRef.current) { didMoveRef.current = false; return; }
    if (mode === 'setting-end-point' || mode === 'setting-anchor') {
      onCanvasClick(getPos(e));
    }
  };

  const cursorStyle = (): string => {
    if (mode === 'setting-end-point' || mode === 'setting-anchor') return 'crosshair';
    if (dragRef.current) return 'grabbing';
    return 'default';
  };

  return (
    <div className="canvas-container">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{ cursor: cursorStyle() }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
      />
    </div>
  );
}

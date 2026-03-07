import { useRef, useEffect, useCallback, useState } from 'react';
import type { CanvasObject, Position } from '../types';

export const CANVAS_W = 800;
export const CANVAS_H = 600;

// ── Helpers ──────────────────────────────────────────────────────────────────

function rotatePoint(p: Position, cx: number, cy: number, angleDeg: number): Position {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

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

function hitTest(objects: CanvasObject[], pos: Position): CanvasObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (
      pos.x >= o.position.x - o.width / 2 &&
      pos.x <= o.position.x + o.width / 2 &&
      pos.y >= o.position.y - o.height / 2 &&
      pos.y <= o.position.y + o.height / 2
    ) return o;
  }
  return null;
}

// ── Arrow helpers ─────────────────────────────────────────────────────────────

function arrowHead(ctx: CanvasRenderingContext2D, fx: number, fy: number, tx: number, ty: number) {
  const len = 12;
  const angle = Math.atan2(ty - fy, tx - fx);
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - len * Math.cos(angle - Math.PI / 6), ty - len * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - len * Math.cos(angle + Math.PI / 6), ty - len * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

function drawTransitionArrow(ctx: CanvasRenderingContext2D, from: Position, to: Position) {
  ctx.save();
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  arrowHead(ctx, from.x, from.y, to.x, to.y);
  ctx.restore();
}

function drawRotationArc(
  ctx: CanvasRenderingContext2D,
  anchor: Position,
  center: Position,
  degrees: number,
  clockwise: boolean,
) {
  const radius = Math.hypot(center.x - anchor.x, center.y - anchor.y) + 18;
  const startAngle = Math.atan2(center.y - anchor.y, center.x - anchor.x);
  const sweep = (degrees * Math.PI) / 180;
  const endAngle = startAngle + (clockwise ? sweep : -sweep);

  ctx.save();
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, radius, startAngle, endAngle, !clockwise);
  ctx.stroke();

  const arrowAngle = endAngle + (clockwise ? 0.15 : -0.15);
  const ax = anchor.x + radius * Math.cos(endAngle);
  const ay = anchor.y + radius * Math.sin(endAngle);
  const bx = anchor.x + radius * Math.cos(arrowAngle);
  const by = anchor.y + radius * Math.sin(arrowAngle);
  arrowHead(ctx, bx, by, ax, ay);

  // Anchor dot
  ctx.fillStyle = '#555';
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, 4, 0, Math.PI * 2);
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
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.setLineDash([]);
  arrowHead(ctx, pos.x, pos.y, toX, toY);
  ctx.restore();
}

// ── Collision zones ───────────────────────────────────────────────────────────

function convexHull(pts: Position[]): Position[] {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
  const cross = (O: Position, A: Position, B: Position) =>
    (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
  const lower: Position[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Position[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function drawCollisionZone(ctx: CanvasRenderingContext2D, obj: CanvasObject, cw: number, ch: number) {
  if (!obj.movement) return;
  const { position: pos, width: w, height: h, movement } = obj;
  ctx.save();

  if (movement.type === 'transition') {
    const dx = movement.endPoint.x - pos.x;
    const dy = movement.endPoint.y - pos.y;
    const corners = [
      { x: pos.x - w / 2, y: pos.y - h / 2 },
      { x: pos.x + w / 2, y: pos.y - h / 2 },
      { x: pos.x + w / 2, y: pos.y + h / 2 },
      { x: pos.x - w / 2, y: pos.y + h / 2 },
    ];
    const hull = convexHull([...corners, ...corners.map(c => ({ x: c.x + dx, y: c.y + dy }))]);
    ctx.fillStyle = 'rgba(100,100,100,0.12)';
    ctx.strokeStyle = 'rgba(80,80,80,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    if (hull.length > 0) {
      ctx.moveTo(hull[0].x, hull[0].y);
      hull.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
    }
    ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  }

  if (movement.type === 'rotation') {
    const anchor = movement.anchorPoint;
    const corners = [
      { x: pos.x - w / 2, y: pos.y - h / 2 },
      { x: pos.x + w / 2, y: pos.y - h / 2 },
      { x: pos.x + w / 2, y: pos.y + h / 2 },
      { x: pos.x - w / 2, y: pos.y + h / 2 },
    ];
    const radius = Math.max(...corners.map(c => Math.hypot(c.x - anchor.x, c.y - anchor.y)));
    ctx.fillStyle = 'rgba(100,100,100,0.10)';
    ctx.strokeStyle = 'rgba(80,80,80,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, radius, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  }

  if (movement.type === 'slide') {
    let rx: number, ry: number, rw: number, rh: number;
    if (movement.direction === 'vertical') {
      rx = pos.x - w / 2; ry = 0; rw = w; rh = ch;
    } else {
      rx = 0; ry = pos.y - h / 2; rw = cw; rh = h;
    }
    ctx.fillStyle = 'rgba(100,100,100,0.10)';
    ctx.strokeStyle = 'rgba(80,80,80,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.rect(rx, ry, rw, rh);
    ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  }

  ctx.restore();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  background: string | null;
  objects: CanvasObject[];
  selectedId: string | null;
  isPlayMode: boolean;
  sliderValues: Record<string, number>;
  onObjectSelect: (id: string | null) => void;
  onObjectMove: (id: string, pos: Position) => void;
}

export function CanvasArea({
  background, objects, selectedId, isPlayMode, sliderValues, onObjectSelect, onObjectMove,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCache = useRef<Record<string, HTMLImageElement>>({});
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const didMoveRef = useRef(false);
  const [, redraw] = useState(0);

  // Image loading
  useEffect(() => {
    const urls = [...(background ? [background] : []), ...objects.map(o => o.imageUrl)];
    urls.forEach(url => {
      if (!imageCache.current[url]) {
        const img = new Image();
        img.onload = () => { imageCache.current[url] = img; redraw(n => n + 1); };
        img.src = url;
      }
    });
  }, [background, objects]);

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // White canvas background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Background image
    if (background && imageCache.current[background]) {
      ctx.drawImage(imageCache.current[background], 0, 0, CANVAS_W, CANVAS_H);
    }

    // Collision zones (design mode only)
    if (!isPlayMode) {
      objects.forEach(obj => drawCollisionZone(ctx, obj, CANVAS_W, CANVAS_H));
    }

    // Draw objects
    objects.forEach(obj => {
      const imgEl = imageCache.current[obj.imageUrl];
      if (!imgEl) return;

      const t = isPlayMode ? (sliderValues[obj.id] ?? 0) : 0;
      const { cx, cy, angleDeg } = getAnimatedState(obj, t);

      ctx.save();
      ctx.translate(cx, cy);

      if (angleDeg !== 0 && obj.movement?.type === 'rotation') {
        const anchorRel = {
          x: obj.movement.anchorPoint.x - obj.position.x,
          y: obj.movement.anchorPoint.y - obj.position.y,
        };
        ctx.translate(anchorRel.x, anchorRel.y);
        ctx.rotate((angleDeg * Math.PI) / 180);
        ctx.translate(-anchorRel.x, -anchorRel.y);
      }

      ctx.drawImage(imgEl, -obj.width / 2, -obj.height / 2, obj.width, obj.height);

      // Selection border (design mode) — thin dark rectangle
      if (obj.id === selectedId && !isPlayMode) {
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-obj.width / 2 - 2, -obj.height / 2 - 2, obj.width + 4, obj.height + 4);
      }

      ctx.restore();
    });

    // Movement arrows (design mode)
    if (!isPlayMode) {
      objects.forEach(obj => {
        if (!obj.movement) return;
        if (obj.movement.type === 'transition') {
          drawTransitionArrow(ctx, obj.position, obj.movement.endPoint);
        } else if (obj.movement.type === 'rotation') {
          drawRotationArc(ctx, obj.movement.anchorPoint, obj.position, obj.movement.degrees, obj.movement.clockwise);
        } else if (obj.movement.type === 'slide') {
          drawSlideArrow(ctx, obj);
        }
      });
    }
  }, [background, objects, selectedId, isPlayMode, sliderValues]);

  useEffect(() => { draw(); }, [draw]);

  // Canvas coordinates
  const getPos = (e: React.MouseEvent<HTMLCanvasElement>): Position => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: Math.round(e.clientX - rect.left), y: Math.round(e.clientY - rect.top) };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPlayMode) return;
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

  const handleMouseUp = () => { dragRef.current = null; };

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      style={{ cursor: isPlayMode ? 'default' : (dragRef.current ? 'grabbing' : 'default') }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    />
  );
}

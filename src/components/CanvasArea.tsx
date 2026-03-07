import { useRef, useEffect, useCallback, useState } from 'react';
import type { CanvasObject, Position } from '../types';
import { getRotationAnchor } from '../leverGeometry';

export const CANVAS_W = 800;
export const CANVAS_H = 600;
const GRID = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAnimatedState(obj: CanvasObject, t: number): {
  cx: number;
  cy: number;
  angleDeg: number;
  pivot?: Position;
} {
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
    const pivot = getRotationAnchor(obj);
    return { cx: pos.x, cy: pos.y, angleDeg: totalDeg, pivot };
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

// ── Arrow drawing ─────────────────────────────────────────────────────────────

function arrowHead(ctx: CanvasRenderingContext2D, fx: number, fy: number, tx: number, ty: number) {
  const len = 11;
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
  anchor: Position, center: Position,
  degrees: number, clockwise: boolean,
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
  arrowHead(
    ctx,
    anchor.x + radius * Math.cos(arrowAngle),
    anchor.y + radius * Math.sin(arrowAngle),
    anchor.x + radius * Math.cos(endAngle),
    anchor.y + radius * Math.sin(endAngle),
  );

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
    ctx.fillStyle = 'rgba(90,90,90,0.10)';
    ctx.strokeStyle = 'rgba(80,80,80,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    if (hull.length > 0) { ctx.moveTo(hull[0].x, hull[0].y); hull.forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath(); }
    ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  }

  if (movement.type === 'rotation') {
    const anchor = getRotationAnchor(obj);
    const corners = [
      { x: pos.x - w / 2, y: pos.y - h / 2 }, { x: pos.x + w / 2, y: pos.y - h / 2 },
      { x: pos.x + w / 2, y: pos.y + h / 2 }, { x: pos.x - w / 2, y: pos.y + h / 2 },
    ];
    const radius = Math.max(...corners.map(c => Math.hypot(c.x - anchor.x, c.y - anchor.y)));
    ctx.fillStyle = 'rgba(90,90,90,0.08)';
    ctx.strokeStyle = 'rgba(80,80,80,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, radius, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  }

  if (movement.type === 'slide') {
    let rx: number, ry: number, rw: number, rh: number;
    if (movement.direction === 'vertical') { rx = pos.x - w / 2; ry = 0; rw = w; rh = ch; }
    else { rx = 0; ry = pos.y - h / 2; rw = cw; rh = h; }
    ctx.fillStyle = 'rgba(90,90,90,0.08)';
    ctx.strokeStyle = 'rgba(80,80,80,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.rect(rx, ry, rw, rh);
    ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  }

  ctx.restore();
}

// ── Corner resize handle helpers ───────────────────────────────────────────────

const CORNER_SIZE = 8; // px, half-size of corner handle hit area

type Corner = 'tl' | 'tr' | 'bl' | 'br';

function getCorners(obj: CanvasObject): Record<Corner, Position> {
  const { position: p, width: w, height: h } = obj;
  return {
    tl: { x: p.x - w / 2, y: p.y - h / 2 },
    tr: { x: p.x + w / 2, y: p.y - h / 2 },
    bl: { x: p.x - w / 2, y: p.y + h / 2 },
    br: { x: p.x + w / 2, y: p.y + h / 2 },
  };
}

function hitCorner(obj: CanvasObject, pos: Position): Corner | null {
  const corners = getCorners(obj);
  for (const [key, cp] of Object.entries(corners) as [Corner, Position][]) {
    if (
      Math.abs(pos.x - cp.x) <= CORNER_SIZE &&
      Math.abs(pos.y - cp.y) <= CORNER_SIZE
    ) return key;
  }
  return null;
}

function drawCornerHandles(ctx: CanvasRenderingContext2D, obj: CanvasObject) {
  const corners = getCorners(obj);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1.5;
  for (const cp of Object.values(corners)) {
    ctx.beginPath();
    ctx.rect(cp.x - CORNER_SIZE / 2, cp.y - CORNER_SIZE / 2, CORNER_SIZE, CORNER_SIZE);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  background: string | null;
  objects: CanvasObject[];
  selectedId: string | null;
  isPlayMode: boolean;
  pickingEndPoint: boolean;
  pickingAnchor: boolean;
  sliderValues: Record<string, number>;
  onObjectSelect: (id: string | null) => void;
  onObjectMove: (id: string, pos: Position) => void;
  onObjectResize: (id: string, width: number, height: number, position: Position) => void;
  onEndPointPick: (pos: Position) => void;
  onAnchorPick: (pos: Position) => void;
}

export function CanvasArea({
  background, objects, selectedId, isPlayMode, pickingEndPoint, pickingAnchor,
  sliderValues, onObjectSelect, onObjectMove, onObjectResize, onEndPointPick, onAnchorPick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCache = useRef<Record<string, HTMLImageElement>>({});
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const resizeRef = useRef<{
    id: string; corner: Corner;
    startMouseX: number; startMouseY: number;
    startW: number; startH: number; startPos: Position;
  } | null>(null);
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

    // White fill
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Background image
    if (background && imageCache.current[background]) {
      ctx.drawImage(imageCache.current[background], 0, 0, CANVAS_W, CANVAS_H);
    }

    // Grid (always drawn, subtle)
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= CANVAS_W; x += GRID) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += GRID) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    }
    ctx.restore();

    // Collision zones (design mode only)
    if (!isPlayMode) {
      objects.forEach(obj => {
        // When picking anchor, skip rotation viz for selected object (user is setting anchor)
        if (pickingAnchor && obj.id === selectedId && obj.movement?.type === 'rotation') return;
        drawCollisionZone(ctx, obj, CANVAS_W, CANVAS_H);
      });
    }

    // Play mode: draw track bars BEFORE objects so objects render on top
    if (isPlayMode) {
      objects.forEach(obj => {
        const m = obj.movement;
        if (!m) return;
        ctx.save();
        if (m.type === 'transition') {
          // Gray rounded rail from start to end of path
          ctx.strokeStyle = '#5a5a5a';
          ctx.lineWidth = 10;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(obj.position.x, obj.position.y);
          ctx.lineTo(m.endPoint.x, m.endPoint.y);
          ctx.stroke();
        }
        if (m.type === 'slide') {
          const { direction, range } = m;
          const { position: pos, width: w, height: h } = obj;
          const rx = direction === 'vertical' ? pos.x - w / 2 : 0;
          const ry = direction === 'horizontal' ? pos.y - h / 2 : 0;
          const rw = direction === 'vertical' ? w : CANVAS_W;
          const rh = direction === 'horizontal' ? h : CANVAS_H;
          ctx.fillStyle = 'rgba(90,90,90,0.10)';
          ctx.strokeStyle = '#5a5a5a';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.setLineDash([]);
          // End-of-range marker
          const ex = direction === 'horizontal' ? pos.x + range : pos.x;
          const ey = direction === 'vertical' ? pos.y + range : pos.y;
          ctx.fillStyle = '#5a5a5a';
          ctx.beginPath();
          ctx.arc(ex, ey, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });
    }

    // Draw objects
    objects.forEach(obj => {
      const imgEl = imageCache.current[obj.imageUrl];
      if (!imgEl) return;
      const t = isPlayMode ? (sliderValues[obj.id] ?? 0) : 0;
      const { cx, cy, angleDeg, pivot } = getAnimatedState(obj, t);

      ctx.save();
      ctx.translate(cx, cy);
      if (angleDeg !== 0 && pivot) {
        // 以 anchor 为圆心自转：pivot 在 world 坐标，相对当前 center 的偏移
        const anchorRel = { x: pivot.x - cx, y: pivot.y - cy };
        ctx.translate(anchorRel.x, anchorRel.y);
        ctx.rotate((angleDeg * Math.PI) / 180);
        ctx.translate(-anchorRel.x, -anchorRel.y);
      }
      ctx.drawImage(imgEl, -obj.width / 2, -obj.height / 2, obj.width, obj.height);

      // Selection border (design mode)
      if (obj.id === selectedId && !isPlayMode) {
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-obj.width / 2 - 2, -obj.height / 2 - 2, obj.width + 4, obj.height + 4);
      }
      ctx.restore();

      // Corner handles (design mode, selected) — hide when picking anchor
      if (obj.id === selectedId && !isPlayMode && !pickingAnchor) {
        drawCornerHandles(ctx, obj);
      }
    });

    // Movement arrows (design mode)
    if (!isPlayMode) {
      objects.forEach(obj => {
        if (!obj.movement) return;
        // When picking anchor, skip rotation viz for selected object (user is setting anchor)
        if (pickingAnchor && obj.id === selectedId && obj.movement.type === 'rotation') return;
        if (obj.movement.type === 'transition') drawTransitionArrow(ctx, obj.position, obj.movement.endPoint);
        else if (obj.movement.type === 'rotation') drawRotationArc(ctx, getRotationAnchor(obj), obj.position, obj.movement.degrees, obj.movement.clockwise);
        else if (obj.movement.type === 'slide') drawSlideArrow(ctx, obj);
      });
    }

    // Picking mode: pulsing border hint
    if (pickingEndPoint || pickingAnchor) {
      ctx.save();
      ctx.strokeStyle = pickingAnchor ? 'rgba(60,100,200,0.5)' : 'rgba(80,80,80,0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(2, 2, CANVAS_W - 4, CANVAS_H - 4);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }, [background, objects, selectedId, isPlayMode, pickingEndPoint, pickingAnchor, sliderValues]);

  useEffect(() => { draw(); }, [draw]);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement>): Position => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: Math.round(e.clientX - rect.left), y: Math.round(e.clientY - rect.top) };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPlayMode || pickingEndPoint || pickingAnchor) return;
    const pos = getPos(e);

    // Check corner handles first (only when an object is selected)
    if (selectedId) {
      const selectedObj = objects.find(o => o.id === selectedId);
      if (selectedObj) {
        const corner = hitCorner(selectedObj, pos);
        if (corner) {
          resizeRef.current = {
            id: selectedId, corner,
            startMouseX: pos.x, startMouseY: pos.y,
            startW: selectedObj.width, startH: selectedObj.height,
            startPos: { ...selectedObj.position },
          };
          didMoveRef.current = false;
          return;
        }
      }
    }

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
    if (resizeRef.current) {
      const pos = getPos(e);
      const { id, corner, startMouseX, startMouseY, startW, startH, startPos } = resizeRef.current;
      const dx = pos.x - startMouseX;
      const dy = pos.y - startMouseY;

      let newW = startW;
      let newH = startH;
      let newX = startPos.x;
      let newY = startPos.y;

      // Each corner adjusts width/height and repositions center accordingly
      if (corner === 'br') {
        newW = Math.max(10, startW + dx);
        newH = Math.max(10, startH + dy);
        newX = startPos.x + (newW - startW) / 2;
        newY = startPos.y + (newH - startH) / 2;
      } else if (corner === 'bl') {
        newW = Math.max(10, startW - dx);
        newH = Math.max(10, startH + dy);
        newX = startPos.x - (newW - startW) / 2;
        newY = startPos.y + (newH - startH) / 2;
      } else if (corner === 'tr') {
        newW = Math.max(10, startW + dx);
        newH = Math.max(10, startH - dy);
        newX = startPos.x + (newW - startW) / 2;
        newY = startPos.y - (newH - startH) / 2;
      } else if (corner === 'tl') {
        newW = Math.max(10, startW - dx);
        newH = Math.max(10, startH - dy);
        newX = startPos.x - (newW - startW) / 2;
        newY = startPos.y - (newH - startH) / 2;
      }

      onObjectResize(id, Math.round(newW), Math.round(newH), { x: Math.round(newX), y: Math.round(newY) });
      didMoveRef.current = true;
      return;
    }
    if (!dragRef.current) return;
    const pos = getPos(e);
    onObjectMove(dragRef.current.id, { x: pos.x - dragRef.current.offX, y: pos.y - dragRef.current.offY });
    didMoveRef.current = true;
  };

  const handleMouseUp = () => {
    dragRef.current = null;
    resizeRef.current = null;
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (pickingEndPoint) { onEndPointPick(getPos(e)); return; }
    if (pickingAnchor) {
      const pos = getPos(e);
      const obj = selectedId ? objects.find(o => o.id === selectedId) : null;
      const clamped = obj
        ? {
            x: Math.round(Math.max(obj.position.x - obj.width / 2, Math.min(obj.position.x + obj.width / 2, pos.x))),
            y: Math.round(Math.max(obj.position.y - obj.height / 2, Math.min(obj.position.y + obj.height / 2, pos.y))),
          }
        : pos;
      onAnchorPick(clamped);
      return;
    }
  };

  const cursor = (pickingEndPoint || pickingAnchor) ? 'crosshair' : resizeRef.current ? 'nwse-resize' : 'default';

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      style={{ cursor, display: 'block' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
    />
  );
}

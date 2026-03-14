import { useRef, useEffect, useCallback, useState } from 'react';
import type { CanvasObject, Position } from '../types';
import { getRotationAnchor } from '../leverGeometry';
import { getPathPoint, resolveAbsPath, rdpSimplify } from '../pathUtils';

export const CANVAS_W = 800;
export const CANVAS_H = 600;
const GRID = 20;
const MIN_DRAW_DIST = 4; // px — throttle raw sample distance
const RDP_EPSILON = 4;   // px — RDP simplification threshold

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
    const absPath = resolveAbsPath(movement.path, pos);
    const pt = getPathPoint(absPath, t);
    return { cx: pt.x, cy: pt.y, angleDeg: 0 };
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

// ── Drawing helpers ───────────────────────────────────────────────────────────

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

function drawTransitionSlot(
  ctx: CanvasRenderingContext2D,
  path: Position[],
  slotWidth: number,
  alpha = 1,
) {
  if (path.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  // Slot band
  ctx.strokeStyle = 'rgba(40,40,40,0.5)';
  ctx.lineWidth = slotWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  path.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
  ctx.stroke();

  // Dashed white centerline
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  path.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrowhead at end
  ctx.strokeStyle = 'rgba(40,40,40,0.8)';
  ctx.lineWidth = 1.5;
  const n = path.length;
  arrowHead(ctx, path[n - 2].x, path[n - 2].y, path[n - 1].x, path[n - 1].y);

  // Start dot
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(path[0].x, path[0].y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha = 1;
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

function drawCollisionZone(ctx: CanvasRenderingContext2D, obj: CanvasObject, cw: number, ch: number) {
  if (!obj.movement) return;
  const { position: pos, width: w, height: h, movement } = obj;
  ctx.save();

  // Transition: the slot visual already shows the path; no extra collision zone needed.

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
    ctx.strokeStyle = 'rgba(80,80,200,0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(pos.x - w / 2, pos.y - h / 2, w, h);
    ctx.setLineDash([]);
  }

  ctx.restore();
}

// ── Corner resize handle helpers ───────────────────────────────────────────────

const CORNER_SIZE = 8;
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
    if (Math.abs(pos.x - cp.x) <= CORNER_SIZE && Math.abs(pos.y - cp.y) <= CORNER_SIZE) return key;
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

export type CanvasLayer = 'background' | 'path' | 'objects' | 'full';

interface Props {
  background: string | null;
  objects: CanvasObject[];
  selectedId: string | null;
  isPlayMode: boolean;
  /** True while user is drawing a freehand translation path */
  drawingTransPath: boolean;
  pickingAnchor: boolean;
  sliderValues: Record<string, number>;
  layer?: CanvasLayer;
  onObjectSelect: (id: string | null) => void;
  onObjectMove: (id: string, pos: Position) => void;
  onObjectResize: (id: string, width: number, height: number, position: Position) => void;
  /** Called with relative path (relative to selected obj position) when drawing finishes */
  onTransPathComplete: (path: Position[]) => void;
  onAnchorPick: (pos: Position) => void;
}

export function CanvasArea({
  background, objects, selectedId, isPlayMode, drawingTransPath, pickingAnchor,
  sliderValues, layer = 'full', onObjectSelect, onObjectMove, onObjectResize,
  onTransPathComplete, onAnchorPick,
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
  const [redrawTrigger, setRedrawTrigger] = useState(0);

  // Freehand drawing state — use ref for closure access, counter for render trigger
  const livePathRef = useRef<Position[]>([]);
  const [livePathCount, setLivePathCount] = useState(0);

  // Reset live path when drawing mode is toggled off
  useEffect(() => {
    if (!drawingTransPath) {
      livePathRef.current = [];
      setLivePathCount(0);
    }
  }, [drawingTransPath]);

  // Image loading
  useEffect(() => {
    const urls = [...(background ? [background] : []), ...objects.map(o => o.imageUrl)];
    urls.forEach(url => {
      if (!imageCache.current[url]) {
        const img = new Image();
        img.onload = () => {
          imageCache.current[url] = img;
          setRedrawTrigger(n => n + 1);
        };
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

    // ── Path-only layer: transition slot above lever, below object ────────────
    if (layer === 'path') {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      objects.forEach(obj => {
        const m = obj.movement;
        if (m?.type !== 'transition') return;
        const absPath = resolveAbsPath(m.path, obj.position);
        ctx.save();
        ctx.strokeStyle = '#5a5a5a';
        ctx.lineWidth = m.slotWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(absPath[0].x, absPath[0].y);
        absPath.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();
        ctx.restore();
      });
      return;
    }

    // ── Objects-only layer ────────────────────────────────────────────────────
    if (layer === 'objects') {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      objects.forEach(obj => {
        const imgEl = imageCache.current[obj.imageUrl];
        if (!imgEl) return;
        const t = isPlayMode ? (sliderValues[obj.id] ?? 0) : 0;
        const { cx, cy, angleDeg, pivot } = getAnimatedState(obj, t);
        if (obj.movement?.type === 'slide') return;
        const isAfterObj = objects.some(
          o => o.movement?.type === 'slide' && o.movement.secondObjectId === obj.id,
        );
        if (isAfterObj) return;
        ctx.save();
        ctx.translate(cx, cy);
        if (angleDeg !== 0 && pivot) {
          const anchorRel = { x: pivot.x - cx, y: pivot.y - cy };
          ctx.translate(anchorRel.x, anchorRel.y);
          ctx.rotate((angleDeg * Math.PI) / 180);
          ctx.translate(-anchorRel.x, -anchorRel.y);
        }
        ctx.drawImage(imgEl, -obj.width / 2, -obj.height / 2, obj.width, obj.height);
        ctx.restore();
      });
      // Anchor/pivot dots on top
      objects.forEach(obj => {
        const m = obj.movement;
        if (!m) return;
        const t = sliderValues[obj.id] ?? 0;
        if (m.type === 'rotation') {
          const anchor = getRotationAnchor(obj);
          ctx.save();
          ctx.fillStyle = '#111';
          ctx.beginPath();
          ctx.arc(anchor.x, anchor.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        if (m.type === 'transition') {
          const absPath = resolveAbsPath(m.path, obj.position);
          const pt = getPathPoint(absPath, t);
          ctx.save();
          ctx.fillStyle = '#111';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
      return;
    }

    // ── White fill (background + full layers) ─────────────────────────────────
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    if (background && imageCache.current[background]) {
      ctx.drawImage(imageCache.current[background], 0, 0, CANVAS_W, CANVAS_H);
    }

    // Grid
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
        if (pickingAnchor && obj.id === selectedId && obj.movement?.type === 'rotation') return;
        drawCollisionZone(ctx, obj, CANVAS_W, CANVAS_H);
      });
    }

    // Play mode rails and slide strips
    if (isPlayMode) {
      objects.forEach(obj => {
        const m = obj.movement;
        if (!m) return;
        ctx.save();
        if (m.type === 'transition' && layer !== 'background') {
          // In full canvas mode draw the slot rail here; in layered mode it's on 'path' layer
          const absPath = resolveAbsPath(m.path, obj.position);
          ctx.strokeStyle = '#5a5a5a';
          ctx.lineWidth = m.slotWidth;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(absPath[0].x, absPath[0].y);
          absPath.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
          ctx.stroke();
        }
        if (m.type === 'slide') {
          const { direction, pullDirection, secondObjectId } = m;
          const { position: beforePos, width: imgW, height: imgH } = obj;
          const t = sliderValues[obj.id] ?? 0;
          const winX = beforePos.x - imgW / 2;
          const winY = beforePos.y - imgH / 2;
          const afterObj = objects.find(o => o.id === secondObjectId);

          let stripX: number, stripY: number;
          if (direction === 'vertical') {
            stripX = winX;
            stripY = pullDirection === 'down'
              ? winY + (t - 1) * CANVAS_H
              : winY - imgH + (1 - t) * CANVAS_H;
          } else {
            stripY = winY;
            stripX = pullDirection === 'right'
              ? winX + (t - 1) * CANVAS_W
              : winX - imgW + (1 - t) * CANVAS_W;
          }

          type Cell = { imgUrl: string | null; cellX: number; cellY: number };
          const cells: Cell[] = [];
          if (direction === 'vertical') {
            if (pullDirection === 'down') {
              cells.push({ imgUrl: afterObj?.imageUrl ?? null, cellX: stripX, cellY: stripY });
              cells.push({ imgUrl: obj.imageUrl, cellX: stripX, cellY: stripY + imgH });
            } else {
              cells.push({ imgUrl: afterObj?.imageUrl ?? null, cellX: stripX, cellY: stripY });
              cells.push({ imgUrl: obj.imageUrl, cellX: stripX, cellY: stripY - imgH });
            }
          } else {
            if (pullDirection === 'right') {
              cells.push({ imgUrl: afterObj?.imageUrl ?? null, cellX: stripX, cellY: stripY });
              cells.push({ imgUrl: obj.imageUrl, cellX: stripX + imgW, cellY: stripY });
            } else {
              cells.push({ imgUrl: afterObj?.imageUrl ?? null, cellX: stripX, cellY: stripY });
              cells.push({ imgUrl: obj.imageUrl, cellX: stripX - imgW, cellY: stripY });
            }
          }

          const bgImg = background ? imageCache.current[background] : null;
          cells.forEach(({ imgUrl, cellX, cellY }) => {
            ctx.save();
            ctx.beginPath(); ctx.rect(cellX, cellY, imgW, imgH); ctx.clip();
            if (bgImg) {
              const sx = bgImg.naturalWidth / CANVAS_W;
              const sy = bgImg.naturalHeight / CANVAS_H;
              ctx.drawImage(bgImg, winX * sx, winY * sy, imgW * sx, imgH * sy, cellX, cellY, imgW, imgH);
            } else {
              ctx.fillStyle = '#ffffff'; ctx.fillRect(cellX, cellY, imgW, imgH);
            }
            if (imgUrl && imageCache.current[imgUrl]) {
              ctx.drawImage(imageCache.current[imgUrl], cellX, cellY, imgW, imgH);
            }
            ctx.restore();
          });

          if (bgImg) {
            const off = document.createElement('canvas');
            off.width = CANVAS_W; off.height = CANVAS_H;
            const offCtx = off.getContext('2d')!;
            offCtx.drawImage(bgImg, 0, 0, CANVAS_W, CANVAS_H);
            offCtx.globalCompositeOperation = 'destination-out';
            offCtx.fillStyle = 'rgba(0,0,0,1)';
            offCtx.fillRect(winX, winY, imgW, imgH);
            ctx.drawImage(off, 0, 0);
          }
        }
        ctx.restore();
      });
    }

    if (layer === 'background') return;

    // Draw objects
    objects.forEach(obj => {
      const imgEl = imageCache.current[obj.imageUrl];
      if (!imgEl) return;
      const t = isPlayMode ? (sliderValues[obj.id] ?? 0) : 0;
      const { cx, cy, angleDeg, pivot } = getAnimatedState(obj, t);

      if (isPlayMode && obj.movement?.type === 'slide') return;
      if (isPlayMode) {
        const isAfterObj = objects.some(
          o => o.movement?.type === 'slide' && o.movement.secondObjectId === obj.id,
        );
        if (isAfterObj) return;
      }

      ctx.save();
      ctx.translate(cx, cy);
      if (angleDeg !== 0 && pivot) {
        const anchorRel = { x: pivot.x - cx, y: pivot.y - cy };
        ctx.translate(anchorRel.x, anchorRel.y);
        ctx.rotate((angleDeg * Math.PI) / 180);
        ctx.translate(-anchorRel.x, -anchorRel.y);
      }
      ctx.drawImage(imgEl, -obj.width / 2, -obj.height / 2, obj.width, obj.height);

      if (obj.id === selectedId && !isPlayMode) {
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-obj.width / 2 - 2, -obj.height / 2 - 2, obj.width + 4, obj.height + 4);
      }
      ctx.restore();

      if (obj.id === selectedId && !isPlayMode && !pickingAnchor) {
        drawCornerHandles(ctx, obj);
      }
    });

    // Movement arrows / slot visuals (design mode)
    if (!isPlayMode) {
      objects.forEach(obj => {
        if (!obj.movement) return;
        if (pickingAnchor && obj.id === selectedId && obj.movement.type === 'rotation') return;
        if (obj.movement.type === 'transition') {
          const absPath = resolveAbsPath(obj.movement.path, obj.position);
          drawTransitionSlot(ctx, absPath, obj.movement.slotWidth);
        } else if (obj.movement.type === 'rotation') {
          drawRotationArc(ctx, getRotationAnchor(obj), obj.position, obj.movement.degrees, obj.movement.clockwise);
        } else if (obj.movement.type === 'slide') {
          drawSlideArrow(ctx, obj);
        }
      });
    }

    // Live freehand path while drawing
    const livePts = livePathRef.current;
    if (drawingTransPath && livePts.length >= 1) {
      const selectedObj = objects.find(o => o.id === selectedId);
      if (selectedObj) {
        drawTransitionSlot(
          ctx,
          livePts.length >= 2 ? livePts : [livePts[0], livePts[0]],
          8,
          0.65,
        );
        // Emphasise start dot in green
        ctx.save();
        ctx.fillStyle = '#4CAF50';
        ctx.strokeStyle = '#2E7D32';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(livePts[0].x, livePts[0].y, 6, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }

    // Border hint while in special picking modes
    if (drawingTransPath || pickingAnchor) {
      ctx.save();
      ctx.strokeStyle = drawingTransPath ? 'rgba(60,160,60,0.5)' : 'rgba(60,100,200,0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(2, 2, CANVAS_W - 4, CANVAS_H - 4);
      ctx.setLineDash([]);
      ctx.restore();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [background, objects, selectedId, isPlayMode, drawingTransPath, pickingAnchor, sliderValues, redrawTrigger, layer, livePathCount]);

  useEffect(() => { draw(); }, [draw]);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement>): Position => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: Math.round(e.clientX - rect.left), y: Math.round(e.clientY - rect.top) };
  };

  // ── Freehand drawing handlers ─────────────────────────────────────────────

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawingTransPath) {
      e.preventDefault();
      const selectedObj = objects.find(o => o.id === selectedId);
      if (!selectedObj) return;
      // Always start from object centre
      const startPt = { ...selectedObj.position };
      livePathRef.current = [startPt];
      setLivePathCount(1);

      const onMove = (me: MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const pos: Position = {
          x: Math.max(0, Math.min(CANVAS_W, Math.round(me.clientX - rect.left))),
          y: Math.max(0, Math.min(CANVAS_H, Math.round(me.clientY - rect.top))),
        };
        const last = livePathRef.current[livePathRef.current.length - 1];
        if (Math.hypot(pos.x - last.x, pos.y - last.y) >= MIN_DRAW_DIST) {
          livePathRef.current = [...livePathRef.current, pos];
          setLivePathCount(n => n + 1);
        }
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const raw = livePathRef.current;
        if (raw.length >= 2) {
          const simplified = rdpSimplify(raw, RDP_EPSILON);
          const origin = raw[0];
          const relative = simplified.map(p => ({
            x: Math.round(p.x - origin.x),
            y: Math.round(p.y - origin.y),
          }));
          onTransPathComplete(relative);
        }
        livePathRef.current = [];
        setLivePathCount(0);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return;
    }

    if (isPlayMode || pickingAnchor) return;

    const pos = getPos(e);

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
    if (drawingTransPath) return; // handled by global listener
    if (resizeRef.current) {
      const pos = getPos(e);
      const { id, corner, startMouseX, startMouseY, startW, startH, startPos } = resizeRef.current;
      const dx = pos.x - startMouseX;
      const dy = pos.y - startMouseY;
      let newW = startW, newH = startH, newX = startPos.x, newY = startPos.y;
      if (corner === 'br') { newW = Math.max(10, startW + dx); newH = Math.max(10, startH + dy); newX = startPos.x + (newW - startW) / 2; newY = startPos.y + (newH - startH) / 2; }
      else if (corner === 'bl') { newW = Math.max(10, startW - dx); newH = Math.max(10, startH + dy); newX = startPos.x - (newW - startW) / 2; newY = startPos.y + (newH - startH) / 2; }
      else if (corner === 'tr') { newW = Math.max(10, startW + dx); newH = Math.max(10, startH - dy); newX = startPos.x + (newW - startW) / 2; newY = startPos.y - (newH - startH) / 2; }
      else if (corner === 'tl') { newW = Math.max(10, startW - dx); newH = Math.max(10, startH - dy); newX = startPos.x - (newW - startW) / 2; newY = startPos.y - (newH - startH) / 2; }
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
    if (drawingTransPath) return; // handled by global listener
    dragRef.current = null;
    resizeRef.current = null;
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawingTransPath) return;
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
    }
  };

  const cursor = drawingTransPath ? 'crosshair' : pickingAnchor ? 'crosshair' : resizeRef.current ? 'nwse-resize' : 'default';

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      style={{
        cursor,
        display: 'block',
        pointerEvents: (layer === 'objects' || layer === 'path') ? 'none' : 'auto',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
    />
  );
}

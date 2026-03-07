import { useRef } from 'react';
import type { CanvasObject, RotationMovement, TransitionMovement } from '../types';
import {
  LEVER_ROW_H,
  DEFAULT_LEVER_LENGTH,
  DEFAULT_LEVER_WIDTH,
  getTransitionDims,
  getRotationDims,
  getRotationAnchor,
  getPathDir,
  chooseOutwardNormal,
  rayExitDistanceToBoard,
} from '../leverGeometry';

export { LEVER_ROW_H };

const HANDLE_H = 100;
const HANDLE_W_BASE = 28;

// ── lever area height = only slide objects get rows above canvas ──

export function getLeverAreaH(objects: CanvasObject[]): number {
  return objects.filter(o => o.movement?.type === 'slide').length * LEVER_ROW_H;
}

// ── rotation / slide helpers ──────────────────────────────────────────────────

function handleWidth(obj: CanvasObject): number {
  return obj.movement?.type === 'slide' ? obj.width : HANDLE_W_BASE;
}

function handleCX(obj: CanvasObject, t: number, canvasW: number): number {
  const m = obj.movement;
  if (m?.type === 'slide' && m.direction === 'horizontal') {
    return obj.position.x + m.range * t;
  }
  return t * canvasW;
}

function nextT(obj: CanvasObject, deltaX: number, startT: number, canvasW: number): number {
  const m = obj.movement;
  let range = canvasW;
  if (m?.type === 'slide' && m.direction === 'horizontal') {
    range = Math.abs(m.range) || 1;
  }
  return Math.max(0, Math.min(1, startT + deltaX / range));
}

// ── transition / rotation lever geometry (visible segment; dims from leverGeometry) ─

const ROT_START_ANGLE = -Math.PI / 2; // up at t=0

function rotLeverGeometry(
  obj: CanvasObject,
  t: number,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
): {
  pivot: { x: number; y: number };
  tip: { x: number; y: number };
  visibleFrom: { x: number; y: number };
  visibleTo: { x: number; y: number };
  normal: { x: number; y: number };
  dims: { leverLength: number; rodWidth: number };
} {
  const m = obj.movement as RotationMovement;
  const dims = getRotationDims(obj, totalLeverH, canvasW, canvasH);

  const totalDegRad = (m.degrees * (m.clockwise ? 1 : -1) * Math.PI) / 180;
  const angle = ROT_START_ANGLE + t * totalDegRad;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  const boardLeft = 0;
  const boardTop = totalLeverH;
  const boardRight = canvasW;
  const boardBottom = totalLeverH + canvasH;

  const anchor = getRotationAnchor(obj);
  const pivot = {
    x: anchor.x,
    y: totalLeverH + anchor.y,
  };

  const tip = {
    x: pivot.x + dx * dims.leverLength,
    y: pivot.y + dy * dims.leverLength,
  };

  const exitDist = rayExitDistanceToBoard(
    pivot.x, pivot.y, dx, dy,
    boardLeft, boardTop, boardRight, boardBottom,
  );

  const visibleFrom = {
    x: pivot.x + dx * Math.min(exitDist, dims.leverLength),
    y: pivot.y + dy * Math.min(exitDist, dims.leverLength),
  };

  const visibleTo =
    dims.leverLength > exitDist ? tip : visibleFrom;

  return {
    pivot,
    tip,
    visibleFrom,
    visibleTo,
    normal: { x: dx, y: dy },
    dims,
  };
}

function transLeverGeometry(
  obj: CanvasObject,
  t: number,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
): {
  pivot: { x: number; y: number };
  tip: { x: number; y: number };
  visibleFrom: { x: number; y: number };
  visibleTo: { x: number; y: number };
  normal: { x: number; y: number };
  dims: { leverLength: number; rodWidth: number };
} {
  const m = obj.movement as TransitionMovement;
  const dims = getTransitionDims(obj, totalLeverH, canvasW, canvasH );

  const dirX = m.endPoint.x - obj.position.x;
  const dirY = m.endPoint.y - obj.position.y;

  const animX = obj.position.x + dirX * t;
  const animY = obj.position.y + dirY * t;

  const boardLeft = 0;
  const boardTop = totalLeverH;
  const boardRight = canvasW;
  const boardBottom = totalLeverH + canvasH;

  const { tx, ty } = getPathDir(obj);

  // path normal candidates
  const nx1 = -ty;
  const ny1 = tx;
  const nx2 = ty;
  const ny2 = -tx;

  const midX = (obj.position.x + m.endPoint.x) / 2 + obj.width / 2;
  const midY = totalLeverH + (obj.position.y + m.endPoint.y) / 2 + obj.height / 2;

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

  const anchor = { x: animX, y: animY };
  const pivot = {
    x: anchor.x,
    y: totalLeverH + anchor.y,
  };

  const tip = {
    x: pivot.x + outward.nx * dims.leverLength,
    y: pivot.y + outward.ny * dims.leverLength,
  };

  const exitDist = rayExitDistanceToBoard(
    pivot.x,
    pivot.y,
    outward.nx,
    outward.ny,
    boardLeft,
    boardTop,
    boardRight,
    boardBottom,
  );

  const visibleFrom = {
    x: pivot.x + outward.nx * Math.min(exitDist, dims.leverLength),
    y: pivot.y + outward.ny * Math.min(exitDist, dims.leverLength),
  };

  const visibleTo =
    dims.leverLength > exitDist
      ? tip
      : visibleFrom;

  return {
    pivot,
    tip,
    visibleFrom,
    visibleTo,
    normal: { x: outward.nx, y: outward.ny },
    dims,
  };
}

// ── main overlay ──────────────────────────────────────────────────────────────

interface Props {
  objects: CanvasObject[];
  sliderValues: Record<string, number>;
  canvasW: number;
  canvasH: number;
  onChange: (id: string, value: number) => void;
}

export function PlayOverlay({ objects, sliderValues, canvasW, canvasH, onChange }: Props) {
  const rowObjs = objects.filter(o => o.movement?.type === 'slide');
  const transObjs = objects.filter(o => o.movement?.type === 'transition');
  const rotObjs = objects.filter(o => o.movement?.type === 'rotation');

  const totalLeverH = rowObjs.length * LEVER_ROW_H;

  const transPad = transObjs.reduce((maxPad, obj) => {
    const dims = getTransitionDims(obj, totalLeverH, canvasW, canvasH);
    return Math.max(maxPad, dims.leverLength + dims.rodWidth + 24);
  }, DEFAULT_LEVER_LENGTH + DEFAULT_LEVER_WIDTH + 24);

  const rotPad = rotObjs.reduce((maxPad, obj) => {
    const dims = getRotationDims(obj, totalLeverH, canvasW, canvasH);
    return Math.max(maxPad, dims.leverLength + dims.rodWidth + 24);
  }, DEFAULT_LEVER_LENGTH + DEFAULT_LEVER_WIDTH + 24);

  const pad = Math.max(transPad, rotPad);
  const padTop = pad;
  const padLeft = pad;
  const padRight = pad;
  const padBottom = pad;

  const overlayW = canvasW + padLeft + padRight;
  const overlayH = totalLeverH + canvasH + padTop + padBottom;

  return (
    <div
      className="play-overlay"
      style={{
        top: -(totalLeverH + padTop),
        left: -padLeft,
        width: overlayW,
        height: overlayH,
      }}
    >
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: overlayW,
          height: overlayH,
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        {rowObjs.map((obj, i) => {
          const t = sliderValues[obj.id] ?? 0;
          const hcx = handleCX(obj, t, canvasW);
          const rowBottom = (i + 1) * LEVER_ROW_H;
          const targetX = obj.position.x;
          const targetY = obj.position.y + totalLeverH;

          return (
            <g key={obj.id}>
              <line
                x1={padLeft + hcx}
                y1={padTop + rowBottom}
                x2={padLeft + targetX}
                y2={padTop + targetY}
                stroke="#111"
                strokeWidth="1"
              />
              <circle cx={padLeft + targetX} cy={padTop + targetY} r={3} fill="#111" />
              <text
                x={padLeft + hcx}
                y={padTop + i * LEVER_ROW_H + 12}
                textAnchor="middle"
                fontSize="9"
                fontFamily="-apple-system, sans-serif"
                fill="#555"
                style={{ userSelect: 'none' }}
              >
                slide
              </text>
            </g>
          );
        })}

        {/* Rotation levers: clock-hand style, same look as translation */}
        {rotObjs.map(obj => {
          const t = sliderValues[obj.id] ?? 0;
          const geo = rotLeverGeometry(obj, t, totalLeverH, canvasW, canvasH);
          const hasVisible =
            geo.visibleFrom.x !== geo.visibleTo.x || geo.visibleFrom.y !== geo.visibleTo.y;

          const labelX = geo.visibleTo.x + geo.normal.x * (geo.dims.rodWidth * 0.9 + 12);
          const labelY = geo.visibleTo.y + geo.normal.y * (geo.dims.rodWidth * 0.9 + 12);

          return (
            <g key={obj.id}>
              {hasVisible && (
                <>
                  <line
                    x1={padLeft + geo.visibleFrom.x}
                    y1={padTop + geo.visibleFrom.y}
                    x2={padLeft + geo.visibleTo.x}
                    y2={padTop + geo.visibleTo.y}
                    stroke="#EFD98C"
                    strokeWidth={geo.dims.rodWidth}
                    strokeLinecap="round"
                  />
                  <line
                    x1={padLeft + geo.visibleFrom.x}
                    y1={padTop + geo.visibleFrom.y}
                    x2={padLeft + geo.visibleTo.x}
                    y2={padTop + geo.visibleTo.y}
                    stroke="#666"
                    strokeWidth={1.2}
                    strokeLinecap="round"
                  />
                </>
              )}
              <circle
                cx={padLeft + geo.pivot.x}
                cy={padTop + geo.pivot.y}
                r={3}
                fill="#111"
              />
              <text
                x={padLeft + labelX}
                y={padTop + labelY}
                textAnchor="middle"
                fontSize="9"
                fontFamily="-apple-system, sans-serif"
                fill="#555"
                style={{ userSelect: 'none' }}
              >
                rotate
              </text>
            </g>
          );
        })}

        {/* Translation levers: exposed part only */}
        {transObjs.map(obj => {
          const t = sliderValues[obj.id] ?? 0;
          const geo = transLeverGeometry(obj, t, totalLeverH, canvasW, canvasH);
          const hasVisible =
            geo.visibleFrom.x !== geo.visibleTo.x || geo.visibleFrom.y !== geo.visibleTo.y;

          const labelX = geo.visibleTo.x + geo.normal.x * (geo.dims.rodWidth * 0.9 + 12);
          const labelY = geo.visibleTo.y + geo.normal.y * (geo.dims.rodWidth * 0.9 + 12);

          return (
            <g key={obj.id}>
              {hasVisible && (
                <>
                  {/* lever body */}
                  <line
                    x1={padLeft + geo.visibleFrom.x}
                    y1={padTop + geo.visibleFrom.y}
                    x2={padLeft + geo.visibleTo.x}
                    y2={padTop + geo.visibleTo.y}
                    stroke="#EFD98C"
                    strokeWidth={geo.dims.rodWidth}
                    strokeLinecap="round"
                  />
                  {/* subtle outline */}
                  <line
                    x1={padLeft + geo.visibleFrom.x}
                    y1={padTop + geo.visibleFrom.y}
                    x2={padLeft + geo.visibleTo.x}
                    y2={padTop + geo.visibleTo.y}
                    stroke="#666"
                    strokeWidth={1.2}
                    strokeLinecap="round"
                  />
                </>
              )}

              <circle
                cx={padLeft + geo.pivot.x}
                cy={padTop + geo.pivot.y}
                r={3}
                fill="#111"
              />

              <text
                x={padLeft + labelX}
                y={padTop + labelY}
                textAnchor="middle"
                fontSize="9"
                fontFamily="-apple-system, sans-serif"
                fill="#555"
                style={{ userSelect: 'none' }}
              >
                translate
              </text>
            </g>
          );
        })}
      </svg>

      {/* ── Row lever handles (rotation / slide) ────────────────────────────── */}
      {rowObjs.map((obj, i) => {
        const t = sliderValues[obj.id] ?? 0;
        const hcx = handleCX(obj, t, canvasW);
        const hW = handleWidth(obj);

        return (
          <LeverHandle
            key={obj.id}
            left={padLeft + hcx - hW / 2}
            top={padTop + i * LEVER_ROW_H}
            width={hW}
            height={HANDLE_H}
            value={t}
            obj={obj}
            canvasW={canvasW}
            onChange={val => onChange(obj.id, val)}
          />
        );
      })}

      {/* ── Translation lever hit area: drag the exposed rod itself ─────────── */}
      {transObjs.map(obj => {
        const t = sliderValues[obj.id] ?? 0;
        const geo = transLeverGeometry(obj, t, totalLeverH, canvasW, canvasH);

        return (
          <TransitionLeverHitArea
            key={obj.id}
            obj={obj}
            t={t}
            geo={geo}
            padLeft={padLeft}
            padTop={padTop}
            onChange={val => onChange(obj.id, val)}
          />
        );
      })}

      {/* ── Rotation lever hit area: drag the exposed rod, obj rotates ───────── */}
      {rotObjs.map(obj => {
        const t = sliderValues[obj.id] ?? 0;
        const geo = rotLeverGeometry(obj, t, totalLeverH, canvasW, canvasH);

        return (
          <RotationLeverHitArea
            key={obj.id}
            obj={obj}
            t={t}
            geo={geo}
            padLeft={padLeft}
            padTop={padTop}
            onChange={val => onChange(obj.id, val)}
          />
        );
      })}
    </div>
  );
}

// ── Rotation / Slide lever handle ─────────────────────────────────────────────

interface HandleProps {
  left: number;
  top: number;
  width: number;
  height: number;
  value: number;
  obj: CanvasObject;
  canvasW: number;
  onChange: (v: number) => void;
}

function LeverHandle({ left, top, width, height, value, obj, canvasW, onChange }: HandleProps) {
  const drag = useRef<{ startX: number; startT: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startT: value };

    const onMove = (me: MouseEvent) => {
      if (!drag.current) return;
      onChange(nextT(obj, me.clientX - drag.current.startX, drag.current.startT, canvasW));
    };

    const onUp = () => {
      drag.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="lever-handle"
      style={{ position: 'absolute', left, top, width, height }}
      onMouseDown={onMouseDown}
    />
  );
}

// ── Translation lever hit area ────────────────────────────────────────────────

interface TransitionLeverHitAreaProps {
  obj: CanvasObject;
  t: number;
  geo: {
    visibleFrom: { x: number; y: number };
    visibleTo: { x: number; y: number };
    dims: { rodWidth: number };
  };
  padLeft: number;
  padTop: number;
  onChange: (v: number) => void;
}

// ── Rotation lever hit area ────────────────────────────────────────────────────

interface RotationLeverHitAreaProps {
  obj: CanvasObject;
  t: number;
  geo: {
    visibleFrom: { x: number; y: number };
    visibleTo: { x: number; y: number };
    pivot: { x: number; y: number };
    dims: { rodWidth: number };
  };
  padLeft: number;
  padTop: number;
  onChange: (v: number) => void;
}

function RotationLeverHitArea({
  obj,
  t,
  geo,
  padLeft,
  padTop,
  onChange,
}: RotationLeverHitAreaProps) {
  const m = obj.movement as RotationMovement;
  const totalDegRad = (m.degrees * (m.clockwise ? 1 : -1) * Math.PI) / 180;

  const dx = geo.visibleTo.x - geo.visibleFrom.x;
  const dy = geo.visibleTo.y - geo.visibleFrom.y;
  const visibleLen = Math.hypot(dx, dy);

  if (visibleLen < 6) return null;

  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  const cx = (geo.visibleFrom.x + geo.visibleTo.x) / 2;
  const cy = (geo.visibleFrom.y + geo.visibleTo.y) / 2;
  const hitThickness = geo.dims.rodWidth + 14;

  const drag = useRef<{
    startX: number;
    startY: number;
    startT: number;
    startAngle: number;
  } | null>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const overlay = (e.currentTarget as HTMLElement).closest('.play-overlay');
    const rect = overlay?.getBoundingClientRect();
    if (!rect) return;

    const mx = e.clientX - rect.left - padLeft;
    const my = e.clientY - rect.top - padTop;
    const px = geo.pivot.x;
    const py = geo.pivot.y;
    const angle = Math.atan2(my - py, mx - px);

    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      startT: t,
      startAngle: angle,
    };

    const onMove = (me: MouseEvent) => {
      if (!drag.current) return;
      const overlayEl = overlay;
      const r = overlayEl?.getBoundingClientRect();
      if (!r) return;

      const mx2 = me.clientX - r.left - padLeft;
      const my2 = me.clientY - r.top - padTop;
      const currentAngle = Math.atan2(my2 - geo.pivot.y, mx2 - geo.pivot.x);

      let deltaAngle = currentAngle - drag.current.startAngle;
      if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
      if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;

      const newT = drag.current.startT + deltaAngle / totalDegRad;
      onChange(Math.max(0, Math.min(1, newT)));
    };

    const onUp = () => {
      drag.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="lever-handle"
      style={{
        position: 'absolute',
        left: padLeft + cx - visibleLen / 2,
        top: padTop + cy - hitThickness / 2,
        width: visibleLen,
        height: hitThickness,
        transform: `rotate(${angleDeg}deg)`,
        transformOrigin: 'center center',
        background: 'transparent',
        pointerEvents: 'all',
        cursor: 'grab',
      }}
      onMouseDown={onMouseDown}
    />
  );
}

function TransitionLeverHitArea({
  obj,
  t,
  geo,
  padLeft,
  padTop,
  onChange,
}: TransitionLeverHitAreaProps) {
  const m = obj.movement as TransitionMovement;
  const dirX = m.endPoint.x - obj.position.x;
  const dirY = m.endPoint.y - obj.position.y;
  const len = Math.hypot(dirX, dirY) || 1;

  const dx = geo.visibleTo.x - geo.visibleFrom.x;
  const dy = geo.visibleTo.y - geo.visibleFrom.y;
  const visibleLen = Math.hypot(dx, dy);

  if (visibleLen < 6) return null;

  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  const cx = (geo.visibleFrom.x + geo.visibleTo.x) / 2;
  const cy = (geo.visibleFrom.y + geo.visibleTo.y) / 2;

  const hitThickness = geo.dims.rodWidth + 14;

  const drag = useRef<{ startX: number; startY: number; startT: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startY: e.clientY, startT: t };

    const onMove = (me: MouseEvent) => {
      if (!drag.current) return;

      const proj =
        ((me.clientX - drag.current.startX) * dirX +
          (me.clientY - drag.current.startY) * dirY) / len;

      onChange(Math.max(0, Math.min(1, drag.current.startT + proj / len)));
    };

    const onUp = () => {
      drag.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="lever-handle"
      style={{
        position: 'absolute',
        left: padLeft + cx - visibleLen / 2,
        top: padTop + cy - hitThickness / 2,
        width: visibleLen,
        height: hitThickness,
        transform: `rotate(${angleDeg}deg)`,
        transformOrigin: 'center center',
        background: 'transparent',
        pointerEvents: 'all',
        cursor: 'grab',
      }}
      onMouseDown={onMouseDown}
    />
  );
}
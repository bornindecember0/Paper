import { useRef } from 'react';
import type { CanvasObject, TransitionMovement, SlideMovement } from '../types';
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

// ── lever area height = only slide objects get rows above canvas ──

export function getLeverAreaH(_objects: CanvasObject[]): number {
  return 0;
}

// ── transition / rotation lever geometry (visible segment; dims from leverGeometry) ─

const ROT_START_ANGLE = -Math.PI / 2; // up at t=0

function rotLeverGeometry(
  obj: CanvasObject,
  t: number,
  totalLeverH: number,
  canvasW: number,
  canvasH: number,
  revealRatio: number,
): {
  pivot: { x: number; y: number };
  tip: { x: number; y: number };
  visibleFrom: { x: number; y: number };
  visibleTo: { x: number; y: number };
  normal: { x: number; y: number };
  dims: { leverLength: number; rodWidth: number };
} {
  const dims = getRotationDims(
    obj,
    totalLeverH,
    canvasW,
    canvasH,
    revealRatio,
  );

  const totalDegRad = Math.PI * 2;
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
  revealRatio: number,
): {
  pivot: { x: number; y: number };
  tip: { x: number; y: number };
  visibleFrom: { x: number; y: number };
  visibleTo: { x: number; y: number };
  normal: { x: number; y: number };
  dims: { leverLength: number; rodWidth: number };
} {
  const m = obj.movement as TransitionMovement;
  const dims = getTransitionDims(
    obj,
    totalLeverH,
    canvasW,
    canvasH,
    revealRatio,
  );

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
  revealRatio: number;
  onChange: (id: string, value: number) => void;
}

export function PlayOverlay({
  objects,
  sliderValues,
  canvasW,
  canvasH,
  revealRatio,
  onChange,
}: Props) {
  const rowObjs = objects.filter(o => o.movement?.type === 'slide');
  const transObjs = objects.filter(o => o.movement?.type === 'transition');
  const rotObjs = objects.filter(o => o.movement?.type === 'rotation');

  const totalLeverH = 0;

  const transPad = transObjs.reduce((maxPad, obj) => {
    const dims = getTransitionDims(
      obj,
      totalLeverH,
      canvasW,
      canvasH,
      revealRatio,
    );
    return Math.max(maxPad, dims.leverLength + dims.rodWidth + 24);
  }, DEFAULT_LEVER_LENGTH + DEFAULT_LEVER_WIDTH + 24);

  const rotPad = rotObjs.reduce((maxPad, obj) => {
    const dims = getRotationDims(
      obj,
      totalLeverH,
      canvasW,
      canvasH,
      revealRatio,
    );
    return Math.max(maxPad, dims.leverLength + dims.rodWidth + 24);
  }, DEFAULT_LEVER_LENGTH + DEFAULT_LEVER_WIDTH + 24);

  const slidePad = { top: 0, left: 0, right: 0, bottom: 0 };
  rowObjs.forEach(obj => {
    const m = obj.movement as SlideMovement;
    if (m.pullDirection === 'up')    slidePad.top    = TAB_THICK + 8;
    if (m.pullDirection === 'down')  slidePad.bottom = TAB_THICK + 8;
    if (m.pullDirection === 'left')  slidePad.left   = TAB_THICK + 8;
    if (m.pullDirection === 'right') slidePad.right  = TAB_THICK + 8;
  });

  const pad = Math.max(transPad, rotPad);
  const padTop    = pad + slidePad.top;
  const padLeft   = pad + slidePad.left;
  const padRight  = pad + slidePad.right;
  const padBottom = pad + slidePad.bottom;

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

        {/* Rotation levers: clock-hand style, same look as translation */}
        {rotObjs.map(obj => {
          const t = sliderValues[obj.id] ?? 0;
          const geo = rotLeverGeometry(
            obj,
            t,
            totalLeverH,
            canvasW,
            canvasH,
            revealRatio,
          );
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
          const geo = transLeverGeometry(
            obj,
            t,
            totalLeverH,
            canvasW,
            canvasH,
            revealRatio,
          );
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

      {/* ── Slide tab handles — live on the canvas edge, drag in pull direction ── */}
      {rowObjs.map(obj => {
        const t = sliderValues[obj.id] ?? 0;
        return (
          <SlideTabHandle
            key={obj.id}
            obj={obj}
            movement={obj.movement as SlideMovement}
            t={t}
            canvasW={canvasW}
            canvasH={canvasH}
            padLeft={padLeft}
            padTop={padTop}
            onChange={val => onChange(obj.id, val)}
          />
        );
      })}
      

      {/* ── Translation lever hit area: drag the exposed rod itself ─────────── */}
      {transObjs.map(obj => {
        const t = sliderValues[obj.id] ?? 0;
        const geo = transLeverGeometry(
          obj,
          t,
          totalLeverH,
          canvasW,
          canvasH,
          revealRatio,
        );

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
        const geo = rotLeverGeometry(
          obj,
          t,
          totalLeverH,
          canvasW,
          canvasH,
          revealRatio,
        );

        return (
          <RotationLeverHitArea
            key={obj.id}
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

// ── Slide tab handle ──────────────────────────────────────────────────────────
// Sits on the canvas edge matching pullDirection, drags along that axis.
// Moving the tab in the pull direction increases t (0 → 1).

const TAB_THICK = 64;

interface SlideTabProps {
  obj: CanvasObject;
  movement: SlideMovement;
  t: number;
  canvasW: number;
  canvasH: number;
  padLeft: number;
  padTop: number;
  onChange: (v: number) => void;
}

function SlideTabHandle({ obj, movement, t, canvasW, canvasH, padLeft, padTop, onChange }: SlideTabProps) {
  const drag = useRef<{ startPx: number; startT: number } | null>(null);
  const { pullDirection, range } = movement;
  const isVertical = pullDirection === 'up' || pullDirection === 'down';
  const travelDist = Math.abs(range);

  const winX = obj.position.x - obj.width / 2;
  const winY = obj.position.y - obj.height / 2;

  let tabLeft: number;
  let tabTop: number;

  // Tab grows as t increases — shows how much strip has been pulled out
  const minSize = TAB_THICK;
  const maxSize = isVertical ? obj.height : obj.width;
  const currentSize = minSize + (maxSize - minSize) * t;

  const tabWidth  = isVertical ? obj.width : currentSize;
  const tabHeight = isVertical ? currentSize : obj.height;

  if (pullDirection === 'down') {
    tabLeft = padLeft + winX;
    tabTop  = padTop + canvasH;
  } else if (pullDirection === 'up') {
    tabLeft = padLeft + winX;
    tabTop  = padTop - currentSize;  // grows upward
  } else if (pullDirection === 'right') {
    tabLeft = padLeft + canvasW;
    tabTop  = padTop + winY;
  } else { // left
    tabLeft = padLeft - currentSize;  // grows leftward
    tabTop  = padTop + winY;
  }

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { startPx: isVertical ? e.clientY : e.clientX, startT: t };

    const onMove = (me: MouseEvent) => {
      if (!drag.current) return;
      const delta = isVertical
        ? me.clientY - drag.current.startPx
        : me.clientX - drag.current.startPx;

      let deltaT: number;
      if      (pullDirection === 'down')  deltaT = delta / travelDist;
      else if (pullDirection === 'up')    deltaT = -delta / travelDist;
      else if (pullDirection === 'right') deltaT = delta / travelDist;
      else                                deltaT =  -delta / travelDist;

      onChange(Math.max(0, Math.min(1, drag.current.startT + deltaT)));
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
      className="lever-handle slide-tab"
      style={{
        position: 'absolute',
        left: tabLeft,
        top: tabTop,
        width: tabWidth,
        height: tabHeight,
        cursor: isVertical ? 'ns-resize' : 'ew-resize',
        pointerEvents: 'all',
        // Make it visible for debugging — remove background once working
        background: 'rgba(255, 200, 0, 0.5)',
        borderRadius: 4,
      }}
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
  t,
  geo,
  padLeft,
  padTop,
  onChange,
}: RotationLeverHitAreaProps) {
  const totalDegRad = Math.PI * 2;

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
      // Rotation supports both clockwise and counterclockwise dragging.
      // Keep one full turn in each direction to avoid unbounded values.
      onChange(Math.max(-1, Math.min(1, newT)));
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
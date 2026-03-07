import { useRef } from 'react';
import type { CanvasObject, RotationMovement, TransitionMovement } from '../types';

export const LEVER_ROW_H = 100;   // px per lever row above canvas (rotation/slide)
const HANDLE_H      = 100;
const HANDLE_W_BASE = 28;
const TRANS_W       = 28;          // translation handle width (perpendicular bar)
const TRANS_H       = 80;          // height (straddles canvas edge: 40px above + 40px inside)

// ── lever area height = only rotation / slide objects get rows above canvas ──

export function getLeverAreaH(objects: CanvasObject[]): number {
  return objects.filter(o => o.movement?.type !== 'transition').length * LEVER_ROW_H;
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

// ── transition handle helpers ─────────────────────────────────────────────────

/**
 * Center of the transition lever handle in overlay coordinates.
 * Mostly-horizontal motion → handle at TOP canvas edge, tracks animated x.
 * Mostly-vertical motion   → handle at LEFT canvas edge, tracks animated y.
 */
function transCenter(
  obj: CanvasObject, t: number, totalLeverH: number,
): { cx: number; cy: number } {
  const m = obj.movement as TransitionMovement;
  const dirX = m.endPoint.x - obj.position.x;
  const dirY = m.endPoint.y - obj.position.y;
  const animX = obj.position.x + dirX * t;
  const animY = obj.position.y + dirY * t;
  if (Math.abs(dirX) >= Math.abs(dirY)) {
    // Horizontal-ish → top edge
    return { cx: animX, cy: totalLeverH };
  }
  // Vertical-ish → left edge
  return { cx: 0, cy: totalLeverH + animY };
}

// ── rotation curved-arrow ──────────────────────────────────────────────────────

function RotationArc({
  cx, cy, r = 22, clockwise,
}: { cx: number; cy: number; r?: number; clockwise: boolean }) {
  const startA = -Math.PI / 2;
  const sweepA = (3 * Math.PI) / 2;
  const endA = startA + (clockwise ? sweepA : -sweepA);
  const sx = cx + r * Math.cos(startA);
  const sy = cy + r * Math.sin(startA);
  const ex = cx + r * Math.cos(endA);
  const ey = cy + r * Math.sin(endA);
  const arcPath = `M ${sx} ${sy} A ${r} ${r} 0 1 ${clockwise ? 1 : 0} ${ex} ${ey}`;
  const tangent = clockwise ? endA + Math.PI / 2 : endA - Math.PI / 2;
  const hLen = 8; const spread = 0.38;
  return (
    <g>
      <path d={arcPath} fill="none" stroke="#111" strokeWidth="1.5" />
      <path
        d={`M ${ex - hLen * Math.cos(tangent - spread)} ${ey - hLen * Math.sin(tangent - spread)} L ${ex} ${ey} L ${ex - hLen * Math.cos(tangent + spread)} ${ey - hLen * Math.sin(tangent + spread)}`}
        fill="none" stroke="#111" strokeWidth="1.5" strokeLinejoin="round"
      />
    </g>
  );
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
  const rowObjs  = objects.filter(o => o.movement?.type !== 'transition');
  const transObjs = objects.filter(o => o.movement?.type === 'transition');

  const totalLeverH = rowObjs.length * LEVER_ROW_H;
  const svgH = totalLeverH + canvasH;

  return (
    <div className="play-overlay" style={{ top: -totalLeverH, width: canvasW, height: svgH }}>

      {/* ── SVG: rotation arcs + connectors for row objects ─────────────────── */}
      <svg
        style={{
          position: 'absolute', top: 0, left: 0,
          width: canvasW, height: svgH,
          pointerEvents: 'none', overflow: 'visible',
        }}
      >
        {rowObjs.map((obj, i) => {
          const t = sliderValues[obj.id] ?? 0;
          const m = obj.movement!;
          const hcx = handleCX(obj, t, canvasW);
          const rowBottom = (i + 1) * LEVER_ROW_H;
          const isRot = m.type === 'rotation';
          const rot = isRot ? (m as RotationMovement) : null;
          const targetX = rot ? rot.anchorPoint.x : obj.position.x;
          const targetY = (rot ? rot.anchorPoint.y : obj.position.y) + totalLeverH;
          return (
            <g key={obj.id}>
              {m.type === 'rotation' && (() => {
                const rm = m as RotationMovement;
                return (
                  <RotationArc
                    cx={hcx - 45} cy={i * LEVER_ROW_H + LEVER_ROW_H * 0.6}
                    clockwise={rm.clockwise} r={20}
                  />
                );
              })()}
              <line x1={hcx} y1={rowBottom} x2={targetX} y2={targetY} stroke="#111" strokeWidth="1" />
              <circle cx={targetX} cy={targetY} r={3} fill="#111" />
              {isRot && <circle cx={targetX} cy={targetY} r={8} fill="none" stroke="#111" strokeWidth="1" />}
              <text x={hcx} y={i * LEVER_ROW_H + 12} textAnchor="middle" fontSize="9"
                fontFamily="-apple-system, sans-serif" fill="#555" style={{ userSelect: 'none' }}>
                {m.type === 'rotation' ? 'rotate' : 'slide'}
              </text>
            </g>
          );
        })}

        {/* Labels for transition handles (above the handle in gray area) */}
        {transObjs.map(obj => {
          const t = sliderValues[obj.id] ?? 0;
          const { cx, cy } = transCenter(obj, t, totalLeverH);
          return (
            <text key={obj.id}
              x={cx} y={cy - TRANS_H / 2 - 4}
              textAnchor="middle" fontSize="9"
              fontFamily="-apple-system, sans-serif" fill="#555"
              style={{ userSelect: 'none' }}
            >translate</text>
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
            left={hcx - hW / 2}
            top={i * LEVER_ROW_H}
            width={hW}
            height={HANDLE_H}
            value={t}
            obj={obj}
            canvasW={canvasW}
            onChange={val => onChange(obj.id, val)}
          />
        );
      })}

      {/* ── Translation handles — perpendicular to motion, at canvas edge ──── */}
      {transObjs.map(obj => (
        <TransitionHandle
          key={obj.id}
          obj={obj}
          t={sliderValues[obj.id] ?? 0}
          totalLeverH={totalLeverH}
          onChange={val => onChange(obj.id, val)}
        />
      ))}
    </div>
  );
}

// ── Rotation / Slide lever handle ─────────────────────────────────────────────

interface HandleProps {
  left: number; top: number; width: number; height: number;
  value: number; obj: CanvasObject; canvasW: number;
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

// ── Translation handle — perpendicular bar at canvas edge ─────────────────────

interface TransProps {
  obj: CanvasObject; t: number; totalLeverH: number;
  onChange: (v: number) => void;
}

function TransitionHandle({ obj, t, totalLeverH, onChange }: TransProps) {
  const m = obj.movement as TransitionMovement;
  const dirX = m.endPoint.x - obj.position.x;
  const dirY = m.endPoint.y - obj.position.y;
  const len  = Math.hypot(dirX, dirY) || 1;

  // Lever bar rotates perpendicular to translation direction
  const thetaDeg = Math.atan2(dirY, dirX) * (180 / Math.PI);
  const rotDeg   = thetaDeg + 90;

  const { cx, cy } = transCenter(obj, t, totalLeverH);

  const drag = useRef<{ startX: number; startY: number; startT: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startY: e.clientY, startT: t };
    const onMove = (me: MouseEvent) => {
      if (!drag.current) return;
      // Project 2-D mouse delta onto translation direction → constrained rail drag
      const proj = ((me.clientX - drag.current.startX) * dirX
                  + (me.clientY - drag.current.startY) * dirY) / len;
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
        left: cx - TRANS_W / 2,
        top:  cy - TRANS_H / 2,
        width: TRANS_W,
        height: TRANS_H,
        transform: `rotate(${rotDeg}deg)`,
        transformOrigin: 'center center',
        pointerEvents: 'all',
      }}
      onMouseDown={onMouseDown}
    />
  );
}

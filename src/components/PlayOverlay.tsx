import { useRef } from 'react';
import type { CanvasObject, RotationMovement } from '../types';

export const LEVER_ROW_H = 100;   // px per lever row above canvas
const HANDLE_H      = 100;        // handle fills the full row height
const HANDLE_W_BASE = 28;         // narrow handle for translation / rotation

// ── Per-type helpers ──────────────────────────────────────────────────────────

function handleWidth(obj: CanvasObject): number {
  // Slide: wide handle matching the object footprint
  return obj.movement?.type === 'slide' ? obj.width : HANDLE_W_BASE;
}

/**
 * X-center of the lever handle in canvas coordinates.
 * - Translation / horizontal slide: follows the object's animated x position.
 * - Vertical slide / rotation: maps t → full canvas width.
 */
function handleCX(obj: CanvasObject, t: number, canvasW: number): number {
  const m = obj.movement;
  if (m?.type === 'transition') {
    return obj.position.x + (m.endPoint.x - obj.position.x) * t;
  }
  if (m?.type === 'slide' && m.direction === 'horizontal') {
    return obj.position.x + m.range * t;
  }
  return t * canvasW; // rotation, vertical slide
}

/** Compute new t from dragging delta.  */
function nextT(obj: CanvasObject, deltaX: number, startT: number, canvasW: number): number {
  const m = obj.movement;
  let range = canvasW;
  if (m?.type === 'transition') {
    range = Math.abs(m.endPoint.x - obj.position.x) || 1;
  } else if (m?.type === 'slide' && m.direction === 'horizontal') {
    range = Math.abs(m.range) || 1;
  }
  return Math.max(0, Math.min(1, startT + deltaX / range));
}

// ── Rotation curved-arrow helper ─────────────────────────────────────────────

function RotationArc({
  cx, cy, r = 22, clockwise,
}: { cx: number; cy: number; r?: number; clockwise: boolean }) {
  // 270° arc starting from "top" of circle
  const startA = -Math.PI / 2;
  const sweepA = (3 * Math.PI) / 2; // 270°
  const endA = startA + (clockwise ? sweepA : -sweepA);

  const sx = cx + r * Math.cos(startA);
  const sy = cy + r * Math.sin(startA);
  const ex = cx + r * Math.cos(endA);
  const ey = cy + r * Math.sin(endA);
  const sweepFlag = clockwise ? 1 : 0;

  const arcPath = `M ${sx} ${sy} A ${r} ${r} 0 1 ${sweepFlag} ${ex} ${ey}`;

  // Arrowhead tangent at end of arc
  const tangent = clockwise ? endA + Math.PI / 2 : endA - Math.PI / 2;
  const hLen = 8;
  const spread = 0.38;
  const ax1 = ex - hLen * Math.cos(tangent - spread);
  const ay1 = ey - hLen * Math.sin(tangent - spread);
  const ax2 = ex - hLen * Math.cos(tangent + spread);
  const ay2 = ey - hLen * Math.sin(tangent + spread);

  return (
    <g>
      <path d={arcPath} fill="none" stroke="#111" strokeWidth="1.5" />
      <path
        d={`M ${ax1} ${ay1} L ${ex} ${ey} L ${ax2} ${ay2}`}
        fill="none" stroke="#111" strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </g>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────────

interface Props {
  objects: CanvasObject[];
  sliderValues: Record<string, number>;
  canvasW: number;
  canvasH: number;
  onChange: (id: string, value: number) => void;
}

export function PlayOverlay({ objects, sliderValues, canvasW, canvasH, onChange }: Props) {
  const totalLeverH = objects.length * LEVER_ROW_H;
  const svgH = totalLeverH + canvasH;

  return (
    <div
      className="play-overlay"
      style={{ top: -totalLeverH, width: canvasW, height: svgH }}
    >
      {/* ── SVG: track bars + rotation arcs + connectors ─────────────────── */}
      <svg
        style={{
          position: 'absolute', top: 0, left: 0,
          width: canvasW, height: svgH,
          pointerEvents: 'none', overflow: 'visible',
        }}
      >
        {objects.map((obj, i) => {
          const t = sliderValues[obj.id] ?? 0;
          const m = obj.movement!;
          const hcx = handleCX(obj, t, canvasW);
          // Bottom of this lever row = top of next row (or top of canvas)
          const rowBottom = (i + 1) * LEVER_ROW_H;
          // Object / anchor target on canvas (in overlay coords)
          const isRot = m.type === 'rotation';
          const rot = isRot ? (m as RotationMovement) : null;
          const targetX = rot ? rot.anchorPoint.x : obj.position.x;
          const targetY = (rot ? rot.anchorPoint.y : obj.position.y) + totalLeverH;

          return (
            <g key={obj.id}>
              {/* Rotation: curved arrow drawn in the lever area (above canvas) */}
              {m.type === 'rotation' && (() => {
                const rm = m as RotationMovement;
                const arrowCX = hcx - 45;
                const arrowCY = i * LEVER_ROW_H + LEVER_ROW_H * 0.6;
                return (
                  <RotationArc
                    cx={arrowCX} cy={arrowCY}
                    clockwise={rm.clockwise}
                    r={20}
                  />
                );
              })()}

              {/* Connector + dot only for rotation and slide, not transition */}
              {m.type !== 'transition' && (
                <>
                  <line
                    x1={hcx} y1={rowBottom}
                    x2={targetX} y2={targetY}
                    stroke="#111" strokeWidth="1"
                  />
                  <circle cx={targetX} cy={targetY} r={3} fill="#111" />
                  {isRot && (
                    <circle cx={targetX} cy={targetY} r={8}
                      fill="none" stroke="#111" strokeWidth="1" />
                  )}
                </>
              )}

              {/* Handle label */}
              <text
                x={hcx} y={i * LEVER_ROW_H + 12}
                textAnchor="middle"
                fontSize="9"
                fontFamily="-apple-system, sans-serif"
                fill="#555"
                style={{ userSelect: 'none' }}
              >
                {m.type === 'transition' ? 'translate'
                  : m.type === 'rotation' ? 'rotate'
                  : 'slide'}
              </text>
            </g>
          );
        })}
      </svg>

      {/* ── Draggable handles ─────────────────────────────────────────────── */}
      {objects.map((obj, i) => {
        const t = sliderValues[obj.id] ?? 0;
        const hcx = handleCX(obj, t, canvasW);
        const hW = handleWidth(obj);
        const handleLeft = hcx - hW / 2;
        const handleTop  = i * LEVER_ROW_H;

        // For transition: extend lever bar all the way to the object's top edge.
        // The canvas sits on top (z-index), so only the above-canvas part is visible.
        let leverH = HANDLE_H;
        if (obj.movement?.type === 'transition') {
          const m = obj.movement;
          const animY = obj.position.y + (m.endPoint.y - obj.position.y) * t;
          const objTopInOverlay = totalLeverH + animY - obj.height / 2;
          leverH = Math.max(HANDLE_H, objTopInOverlay - handleTop);
        }

        return (
          <LeverHandle
            key={obj.id}
            left={handleLeft}
            top={handleTop}
            width={hW}
            height={leverH}
            value={t}
            obj={obj}
            canvasW={canvasW}
            onChange={val => onChange(obj.id, val)}
          />
        );
      })}
    </div>
  );
}

// ── Draggable handle ──────────────────────────────────────────────────────────

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

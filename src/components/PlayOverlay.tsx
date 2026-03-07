import { useRef } from 'react';
import type { CanvasObject, RotationMovement } from '../types';

// Height of one lever row above the canvas (px)
export const LEVER_ROW_H = 64;
const HANDLE_W = 22;
const HANDLE_H = 52;

interface Props {
  objects: CanvasObject[];            // only objects that have a movement
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
      {/* ── Connector lines ─────────────────────────────────────────────── */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: canvasW,
          height: svgH,
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        {objects.map((obj, i) => {
          const v = sliderValues[obj.id] ?? 0;
          // Handle bottom-center in overlay coordinates
          const handleCX = v * (canvasW - HANDLE_W) + HANDLE_W / 2;
          const handleBottomY = i * LEVER_ROW_H + (LEVER_ROW_H - HANDLE_H) / 2 + HANDLE_H;

          const isRot = obj.movement?.type === 'rotation';
          const rot = isRot ? (obj.movement as RotationMovement) : null;

          // Target point on canvas (in overlay coords, shift down by totalLeverH)
          const targetX = rot ? rot.anchorPoint.x : obj.position.x;
          const targetY = (rot ? rot.anchorPoint.y : obj.position.y) + totalLeverH;

          return (
            <g key={obj.id}>
              {/* Thin connector from handle bottom to object/anchor */}
              <line
                x1={handleCX}
                y1={handleBottomY}
                x2={targetX}
                y2={targetY}
                stroke="#111"
                strokeWidth="1"
                strokeDasharray={isRot ? '3 2' : undefined}
              />

              {/* Dot at the target (object center or anchor) */}
              <circle cx={targetX} cy={targetY} r={3} fill="#111" />

              {/* For rotation: larger ring around anchor to indicate pivot */}
              {rot && (
                <circle
                  cx={targetX}
                  cy={targetY}
                  r={7}
                  fill="none"
                  stroke="#111"
                  strokeWidth="1"
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* ── Draggable handles ────────────────────────────────────────────── */}
      {objects.map((obj, i) => {
        const v = sliderValues[obj.id] ?? 0;
        const handleLeft = v * (canvasW - HANDLE_W);
        const handleTop = i * LEVER_ROW_H + (LEVER_ROW_H - HANDLE_H) / 2;
        return (
          <LeverHandle
            key={obj.id}
            left={handleLeft}
            top={handleTop}
            value={v}
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
  value: number;
  canvasW: number;
  onChange: (v: number) => void;
}

function LeverHandle({ left, top, value, canvasW, onChange }: HandleProps) {
  const drag = useRef<{ startX: number; startVal: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startVal: value };

    const onMove = (me: MouseEvent) => {
      if (!drag.current) return;
      const delta = me.clientX - drag.current.startX;
      const travel = canvasW - HANDLE_W;
      onChange(Math.max(0, Math.min(1, drag.current.startVal + delta / travel)));
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
      style={{ left, top, width: HANDLE_W, height: HANDLE_H }}
      onMouseDown={onMouseDown}
    />
  );
}

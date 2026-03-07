import { useState } from 'react';
import type { Position } from '../types';

interface Props {
  objectPos: Position;
  existing?: Position;
  onConfirm: (endPoint: Position) => void;
  onCancel: () => void;
}

export function TranslateModal({ objectPos, existing, onConfirm, onCancel }: Props) {
  const startX = Math.round(objectPos.x);
  const startY = Math.round(objectPos.y);

  const [endX, setEndX] = useState(
    existing ? Math.round(existing.x) : Math.round(objectPos.x),
  );
  const [endY, setEndY] = useState(
    existing ? Math.round(existing.y) : Math.round(objectPos.y),
  );

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Translate</div>

        <div className="modal-body">
          <div className="form-row">
            <span className="form-label">Start Point :</span>
            <div className="coord-inputs">
              <input
                type="number"
                className="coord-input"
                value={startX}
                readOnly
                placeholder="x"
              />
              <input
                type="number"
                className="coord-input"
                value={startY}
                readOnly
                placeholder="y"
              />
            </div>
          </div>

          <div className="form-row">
            <span className="form-label">End Point :</span>
            <div className="coord-inputs">
              <input
                type="number"
                className="coord-input"
                value={endX}
                onChange={e => setEndX(Number(e.target.value))}
                placeholder="x"
              />
              <input
                type="number"
                className="coord-input"
                value={endY}
                onChange={e => setEndY(Number(e.target.value))}
                placeholder="y"
              />
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: '#666', lineHeight: 1.45 }}>
            Start point is the object&apos;s current position.
            End point defines the translation direction.
            The lever is a fixed rigid bar attached to the object and only the part outside
            the board is visible.
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onConfirm({ x: endX, y: endY })}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
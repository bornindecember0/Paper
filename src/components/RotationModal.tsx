import { useState } from 'react';
import type { Position, RotationMovement } from '../types';

interface Props {
  objectPos: Position;
  existing?: RotationMovement;
  onConfirm: (anchorPoint: Position, degrees: number, clockwise: boolean) => void;
  onCancel: () => void;
}

export function RotationModal({ objectPos, existing, onConfirm, onCancel }: Props) {
  const [anchorX, setAnchorX] = useState(
    existing ? Math.round(existing.anchorPoint.x) : Math.round(objectPos.x),
  );
  const [anchorY, setAnchorY] = useState(
    existing ? Math.round(existing.anchorPoint.y) : Math.round(objectPos.y),
  );
  const [clockwise, setClockwise] = useState(existing?.clockwise ?? true);
  const [degrees, setDegrees] = useState(existing?.degrees ?? 360);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Rotation</div>
        <div className="modal-body">
          <div className="form-row">
            <span className="form-label">Anchor Point :</span>
            <div className="coord-inputs">
              <input
                type="number"
                className="coord-input"
                value={anchorX}
                onChange={e => setAnchorX(Number(e.target.value))}
                placeholder="x"
              />
              <input
                type="number"
                className="coord-input"
                value={anchorY}
                onChange={e => setAnchorY(Number(e.target.value))}
                placeholder="y"
              />
            </div>
            <div className="dir-btns">
              <button
                className={`dir-btn ${!clockwise ? 'active' : ''}`}
                onClick={() => setClockwise(false)}
              >
                Counter Clockwise
              </button>
              <button
                className={`dir-btn ${clockwise ? 'active' : ''}`}
                onClick={() => setClockwise(true)}
              >
                Clockwise
              </button>
            </div>
          </div>
          <div className="form-row">
            <span className="form-label">Rotation Direction :</span>
            <span style={{ fontSize: 12, color: '#444' }}>
              {clockwise ? 'Clockwise' : 'Counter Clockwise'}
            </span>
          </div>
          <div className="form-row">
            <span className="form-label">Angle of Rotation :</span>
            <input
              type="number"
              className="number-input"
              min={1}
              max={360}
              value={degrees}
              onChange={e => setDegrees(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => onConfirm({ x: anchorX, y: anchorY }, degrees, clockwise)}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

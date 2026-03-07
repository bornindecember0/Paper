import { useState } from 'react';
import type { RotationMovement } from '../types';

interface Props {
  existing?: RotationMovement;
  onConfirm: (degrees: number, clockwise: boolean) => void;
  onCancel: () => void;
}

export function RotationModal({ existing, onConfirm, onCancel }: Props) {
  const [clockwise, setClockwise] = useState(existing?.clockwise ?? true);
  const [degrees, setDegrees] = useState(existing?.degrees ?? 360);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Rotation</div>
        <div className="modal-body">
          <div className="form-row">
            <span className="form-label">Direction :</span>
            <div className="dir-btns">
              <button
                className={`dir-btn ${!clockwise ? 'active' : ''}`}
                onClick={() => setClockwise(false)}
              >Counter CW</button>
              <button
                className={`dir-btn ${clockwise ? 'active' : ''}`}
                onClick={() => setClockwise(true)}
              >Clockwise</button>
            </div>
          </div>
          <div className="form-row">
            <span className="form-label">Angle :</span>
            <input
              type="number"
              className="number-input"
              min={1}
              max={360}
              value={degrees}
              onChange={e => setDegrees(Number(e.target.value))}
            />
            <span style={{ fontSize: 11, color: '#444' }}>degrees</span>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onConfirm(degrees, clockwise)}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

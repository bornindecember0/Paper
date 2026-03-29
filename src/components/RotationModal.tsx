import type { RotationMovement } from '../types';

interface Props {
  existing?: RotationMovement;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RotationModal({ existing, onConfirm, onCancel }: Props) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Rotation</div>
        <div className="modal-body">
          <div className="form-row">
            <span className="form-label">Anchor :</span>
            <span style={{ fontSize: 12, color: '#444' }}>
              Rotation is fixed at 360 degrees. Pick an anchor point on canvas.
            </span>
          </div>
          {existing && (
            <div style={{ fontSize: 12, color: '#666' }}>
              Current offset: ({Math.round(existing.anchorPoint.x)}, {Math.round(existing.anchorPoint.y)})
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onConfirm}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

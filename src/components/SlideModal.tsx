import { useState } from 'react';

interface Props {
  onConfirm: (direction: 'horizontal' | 'vertical', range: number) => void;
  onCancel: () => void;
}

export function SlideModal({ onConfirm, onCancel }: Props) {
  const [direction, setDirection] = useState<'horizontal' | 'vertical'>('horizontal');
  const [range, setRange] = useState(200);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">Configure Slide Movement</h2>

        <div className="modal-body">
          <label className="ctrl-label">
            Direction
            <div className="radio-group">
              <label className="radio-label">
                <input
                  type="radio"
                  name="direction"
                  value="horizontal"
                  checked={direction === 'horizontal'}
                  onChange={() => setDirection('horizontal')}
                />
                Horizontal (left / right)
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="direction"
                  value="vertical"
                  checked={direction === 'vertical'}
                  onChange={() => setDirection('vertical')}
                />
                Vertical (up / down)
              </label>
            </div>
          </label>

          <label className="ctrl-label">
            Distance (px)
            <p className="ctrl-hint">Positive = right / down. Negative = left / up.</p>
            <input
              type="number"
              value={range}
              onChange={e => setRange(Number(e.target.value))}
              className="ctrl-input"
            />
            <input
              type="range"
              min={-800}
              max={800}
              value={range}
              onChange={e => setRange(Number(e.target.value))}
              className="ctrl-range"
            />
          </label>

          <div className="collision-note">
            <strong>Collision zone:</strong>{' '}
            {direction === 'vertical'
              ? 'A vertical strip spanning the full canvas height, as wide as the object.'
              : 'A horizontal strip spanning the full canvas width, as tall as the object.'}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onConfirm(direction, range)}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

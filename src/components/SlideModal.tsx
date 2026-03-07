import { useState } from 'react';
import type { CanvasObject, Position } from '../types';

interface Props {
  objects: CanvasObject[];
  selectedId: string;
  onConfirm: (
    startPoint: Position,
    endPoint: Position,
    firstObjectId: string,
    secondObjectId: string,
  ) => void;
  onCancel: () => void;
}

export function SlideModal({ objects, selectedId, onConfirm, onCancel }: Props) {
  const selected = objects.find(o => o.id === selectedId);

  const [startX, setStartX] = useState(selected ? Math.round(selected.position.x) : 0);
  const [startY, setStartY] = useState(selected ? Math.round(selected.position.y) : 0);
  const [endX, setEndX] = useState(selected ? Math.round(selected.position.x) + 200 : 200);
  const [endY, setEndY] = useState(selected ? Math.round(selected.position.y) : 0);
  const [firstObj, setFirstObj] = useState(selectedId);
  const [secondObj, setSecondObj] = useState(objects.find(o => o.id !== selectedId)?.id ?? '');

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Slide</div>
        <div className="modal-body">
          <div className="form-row">
            <span className="form-label">Slide Start :</span>
            <div className="coord-inputs">
              <input type="number" className="coord-input" value={startX}
                onChange={e => setStartX(Number(e.target.value))} placeholder="x" />
              <input type="number" className="coord-input" value={startY}
                onChange={e => setStartY(Number(e.target.value))} placeholder="y" />
            </div>
          </div>
          <div className="form-row">
            <span className="form-label">Slide End :</span>
            <div className="coord-inputs">
              <input type="number" className="coord-input" value={endX}
                onChange={e => setEndX(Number(e.target.value))} placeholder="x" />
              <input type="number" className="coord-input" value={endY}
                onChange={e => setEndY(Number(e.target.value))} placeholder="y" />
            </div>
          </div>
          <div className="form-row">
            <span className="form-label">First Object :</span>
            <select className="select-input" value={firstObj} onChange={e => setFirstObj(e.target.value)}>
              {objects.map((o, i) => (
                <option key={o.id} value={o.id}>Object #{i + 1}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <span className="form-label">Second Object :</span>
            <select className="select-input" value={secondObj} onChange={e => setSecondObj(e.target.value)}>
              <option value="">None</option>
              {objects.map((o, i) => (
                <option key={o.id} value={o.id}>Object #{i + 1}</option>
              ))}
            </select>
          </div>
          <p className="form-note">*Only 2 images in a slide*</p>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => onConfirm({ x: startX, y: startY }, { x: endX, y: endY }, firstObj, secondObj)}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

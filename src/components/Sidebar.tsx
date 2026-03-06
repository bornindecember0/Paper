import { useRef } from 'react';
import type { CanvasObject, InteractionMode, Movement } from '../types';

interface Props {
  onBackgroundUpload: (file: File) => void;
  onObjectUpload: (file: File) => void;
  selectedObject: CanvasObject | undefined;
  mode: InteractionMode;
  onSelectMovement: (type: 'transition' | 'rotation' | 'slide') => void;
  onRotationChange: (degrees: number, clockwise: boolean) => void;
  onClearMovement: () => void;
  onCancelMode: () => void;
}

function movementLabel(m: Movement): string {
  if (m.type === 'transition') return `Transition → (${Math.round(m.endPoint.x)}, ${Math.round(m.endPoint.y)})`;
  if (m.type === 'rotation') return `Rotation ${m.degrees}° ${m.clockwise ? 'CW' : 'CCW'}`;
  if (m.type === 'slide') return `Slide ${m.direction} ${m.range}px`;
  return '';
}

export function Sidebar({
  onBackgroundUpload,
  onObjectUpload,
  selectedObject,
  mode,
  onSelectMovement,
  onRotationChange,
  onClearMovement,
  onCancelMode,
}: Props) {
  const bgInputRef = useRef<HTMLInputElement>(null);
  const objInputRef = useRef<HTMLInputElement>(null);

  const handleBgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { onBackgroundUpload(f); e.target.value = ''; }
  };
  const handleObjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { onObjectUpload(f); e.target.value = ''; }
  };

  const isSettingMode = mode === 'setting-end-point' || mode === 'setting-anchor';

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <h3 className="sidebar-title">Canvas</h3>
        <input ref={bgInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
          style={{ display: 'none' }} onChange={handleBgChange} />
        <button className="btn btn-secondary" onClick={() => bgInputRef.current?.click()}>
          Upload Background
        </button>
      </div>

      <div className="sidebar-section">
        <h3 className="sidebar-title">Objects</h3>
        <input ref={objInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
          style={{ display: 'none' }} onChange={handleObjChange} />
        <button className="btn btn-primary" onClick={() => objInputRef.current?.click()}>
          + Upload Object
        </button>
        <p className="sidebar-hint">New object placed at canvas center</p>
      </div>

      {selectedObject && mode !== 'play' && (
        <div className="sidebar-section">
          <h3 className="sidebar-title">Selected Object</h3>
          <p className="sidebar-meta">
            {selectedObject.width} × {selectedObject.height}px
            &nbsp;@ ({Math.round(selectedObject.position.x)}, {Math.round(selectedObject.position.y)})
          </p>

          {selectedObject.movement && (
            <div className="movement-badge">
              <span>{movementLabel(selectedObject.movement)}</span>
              <button className="btn-icon" title="Remove movement" onClick={onClearMovement}>✕</button>
            </div>
          )}

          {!isSettingMode && (
            <>
              <p className="sidebar-label">Set Movement:</p>
              <div className="movement-buttons">
                <button
                  className={`btn btn-movement ${selectedObject.movement?.type === 'transition' ? 'active' : ''}`}
                  onClick={() => onSelectMovement('transition')}
                >
                  Transition
                </button>
                <button
                  className={`btn btn-movement ${selectedObject.movement?.type === 'rotation' ? 'active' : ''}`}
                  onClick={() => onSelectMovement('rotation')}
                >
                  Rotation
                </button>
                <button
                  className={`btn btn-movement ${selectedObject.movement?.type === 'slide' ? 'active' : ''}`}
                  onClick={() => onSelectMovement('slide')}
                >
                  Slide
                </button>
              </div>

              {selectedObject.movement?.type === 'rotation' && (
                <RotationControls
                  degrees={selectedObject.movement.degrees}
                  clockwise={selectedObject.movement.clockwise}
                  onChange={onRotationChange}
                />
              )}
            </>
          )}

          {isSettingMode && (
            <div className="mode-instructions">
              {mode === 'setting-end-point' && (
                <p>Click anywhere on the canvas to set the transition end point.</p>
              )}
              {mode === 'setting-anchor' && (
                <p>Click inside the object to set the rotation anchor point.</p>
              )}
              <button className="btn btn-secondary" onClick={onCancelMode}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {!selectedObject && mode === 'idle' && (
        <div className="sidebar-section">
          <p className="sidebar-hint">Drag objects to reposition. Click an object to select it and assign movement.</p>
        </div>
      )}
    </aside>
  );
}

function RotationControls({
  degrees,
  clockwise,
  onChange,
}: {
  degrees: number;
  clockwise: boolean;
  onChange: (deg: number, cw: boolean) => void;
}) {
  return (
    <div className="rotation-controls">
      <label className="ctrl-label">
        Degrees
        <input
          type="number"
          min={1}
          max={360}
          value={degrees}
          onChange={e => onChange(Number(e.target.value), clockwise)}
          className="ctrl-input"
        />
      </label>
      <label className="ctrl-label">
        Direction
        <select
          value={clockwise ? 'cw' : 'ccw'}
          onChange={e => onChange(degrees, e.target.value === 'cw')}
          className="ctrl-select"
        >
          <option value="cw">Clockwise (default)</option>
          <option value="ccw">Counter-clockwise</option>
        </select>
      </label>
      <p className="sidebar-hint">
        Anchor point: click on canvas inside the object to set it.
      </p>
    </div>
  );
}

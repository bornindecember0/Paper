import { useRef } from 'react';
import type { CanvasObject } from '../types';
import type { Tab } from '../App';
import { totalArcLength, resolveAbsPath } from '../pathUtils';

interface Props {
  tab: Tab;
  bgFilename: string;
  bgLocked: boolean;
  objects: CanvasObject[];
  selectedId: string | null;
  onBackgroundUpload: (file: File) => void;
  onDeleteBackground: () => void;
  onObjectUpload: (file: File, objectId?: string) => void;
  onDeleteObject: (id: string) => void;
  onObjectSelect: (id: string) => void;
  onMovementOpen: (type: 'translate' | 'rotation' | 'slide') => void;
  onClearMovement: () => void;
  onSave: () => void;
  // Rotation inline config
  rotationConfigOpen: boolean;
  rotationDegrees: number;
  rotationClockwise: boolean;
  onRotationDegreesChange: (v: number) => void;
  onRotationClockwiseChange: (v: boolean) => void;
  onRotationPickAnchor: () => void;
  onRotationCancel: () => void;
  pickingAnchor: boolean;
  // Fabrication settings
  leverExposure: number;
  onLeverExposureChange: (v: number) => void;
  // Whether translate path drawing is active
  drawingTransPath: boolean;
}

function movementLabel(obj: CanvasObject): string {
  const m = obj.movement;
  if (!m) return '';
  if (m.type === 'transition') {
    const absPath = resolveAbsPath(m.path, obj.position);
    const len = Math.round(totalArcLength(absPath));
    return `→ path ${len}px (${m.path.length} pts)`;
  }
  if (m.type === 'rotation') return `↻ ${m.degrees}° ${m.clockwise ? 'CW' : 'CCW'}`;
  if (m.type === 'slide') return `⇥ ${m.direction} ${m.range > 0 ? '+' : ''}${m.range}px`;
  return '';
}

export function RightPanel({
  tab, bgFilename, bgLocked, objects, selectedId,
  onBackgroundUpload, onDeleteBackground, onObjectUpload, onDeleteObject, onObjectSelect,
  onMovementOpen, onClearMovement, onSave,
  rotationConfigOpen, rotationDegrees, rotationClockwise,
  onRotationDegreesChange, onRotationClockwiseChange,
  onRotationPickAnchor, onRotationCancel,
  pickingAnchor,
  leverExposure, onLeverExposureChange,
  drawingTransPath,
}: Props) {
  const bgInputRef = useRef<HTMLInputElement>(null);
  const objInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const newObjInputRef = useRef<HTMLInputElement>(null);

  const selectedObject = objects.find(o => o.id === selectedId);

  return (
    <aside className="right-panel">

      <p className="panel-hint">
        Click <strong>+</strong> to upload images as background or moving objects.
      </p>

      {/* Background section */}
      <div className="panel-section">
        <div className="section-header">
          <span className="section-title">Background</span>
          {!bgLocked && (
            <>
              <input ref={bgInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) { onBackgroundUpload(f); e.target.value = ''; } }} />
              <button className="btn-add" onClick={() => bgInputRef.current?.click()} title="Add background">+</button>
            </>
          )}
        </div>
        <div className="image-row image-row-first">
          <div className="image-row-top">
            {!bgLocked ? (
              <span className="image-filename">No background added</span>
            ) : (
              <>
                <span className="image-label">Background</span>
                {tab === 'design' && (
                  <button type="button" className="btn-delete-object" onClick={onDeleteBackground} title="Delete background" aria-label="Delete background">x</button>
                )}
              </>
            )}
          </div>
          {bgLocked && <span className="image-filename">{bgFilename || 'loaded'}</span>}
        </div>
      </div>

      {/* Objects section */}
      <div className="panel-section">
        <div className="section-header">
          <span className="section-title">Objects</span>
          <input ref={newObjInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) { onObjectUpload(f); e.target.value = ''; } }} />
          <button className="btn-add" onClick={() => newObjInputRef.current?.click()} title="Add object">+</button>
        </div>

        {objects.length === 0 && (
          <span className="image-filename" style={{ display: 'block', padding: '4px 0' }}>No objects added</span>
        )}

        {objects.map((obj, i) => (
          <div
            key={obj.id}
            className={`image-row ${i === 0 ? 'image-row-first' : ''} ${obj.id === selectedId ? 'selected' : ''}`}
            onClick={() => { if (tab === 'design') onObjectSelect(obj.id); }}
            style={{ cursor: tab === 'design' ? 'pointer' : 'default' }}
          >
            <div className="image-row-top">
              <span className="image-label">Object #{i + 1}</span>
              <div className="image-row-actions">
                {!obj.locked && (
                  <>
                    <input ref={el => { objInputRefs.current[obj.id] = el; }} type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) { onObjectUpload(f, obj.id); e.target.value = ''; } }} />
                    <button className="btn-import" onClick={e => { e.stopPropagation(); objInputRefs.current[obj.id]?.click(); }}>Replace</button>
                  </>
                )}
                {tab === 'design' && (
                  <button type="button" className="btn-delete-object" onClick={e => { e.stopPropagation(); onDeleteObject(obj.id); }} title="Delete object" aria-label="Delete object">x</button>
                )}
              </div>
            </div>
            <span className="image-filename">{obj.filename || 'No name'}</span>
          </div>
        ))}
      </div>

      {/* Movement section */}
      <div className="panel-section">
        <div className="movement-header">Movement</div>

        {selectedObject?.movement && (
          <div className="movement-badge">
            <span>{movementLabel(selectedObject)}</span>
            <button className="btn-clear" onClick={onClearMovement} title="Remove movement">✕</button>
          </div>
        )}

        <div className="movement-btns">
          <button
            className={`btn-movement ${selectedObject?.movement?.type === 'transition' || drawingTransPath ? 'active' : ''}`}
            disabled={!selectedObject || tab === 'play'}
            onClick={() => onMovementOpen('translate')}
          >
            {drawingTransPath ? 'Drawing…' : 'Translate'}
          </button>
          <button
            className={`btn-movement ${selectedObject?.movement?.type === 'rotation' || rotationConfigOpen ? 'active' : ''}`}
            disabled={!selectedObject || tab === 'play'}
            onClick={() => onMovementOpen('rotation')}
          >Rotation</button>
          <button
            className={`btn-movement ${selectedObject?.movement?.type === 'slide' ? 'active' : ''}`}
            disabled={!selectedObject || tab === 'play'}
            onClick={() => onMovementOpen('slide')}
          >Slide</button>
        </div>

        {/* Translate drawing hint */}
        {drawingTransPath && (
          <p className="form-note" style={{ marginTop: 6, color: '#2e7d32' }}>
            Hold and drag on the canvas to draw the cut path. Release to confirm.
          </p>
        )}

        {/* Rotation inline config */}
        {rotationConfigOpen && selectedObject && (
          <div className="rotation-config">
            <div className="rotation-config-row">
              <span className="rotation-config-label">Direction</span>
              <div className="dir-btns">
                <button className={`dir-btn ${!rotationClockwise ? 'active' : ''}`} onClick={() => onRotationClockwiseChange(false)}>CCW</button>
                <button className={`dir-btn ${rotationClockwise ? 'active' : ''}`} onClick={() => onRotationClockwiseChange(true)}>CW</button>
              </div>
            </div>
            <div className="rotation-config-row">
              <span className="rotation-config-label">Angle</span>
              <input type="number" className="number-input" min={1} max={360} value={rotationDegrees} onChange={e => onRotationDegreesChange(Number(e.target.value))} />
              <span className="rotation-config-unit">°</span>
            </div>
            <div className="rotation-config-actions">
              <button className="btn btn-pick" onClick={onRotationPickAnchor} disabled={pickingAnchor}>
                {pickingAnchor ? 'Click inside object…' : (selectedObject.movement?.type === 'rotation' ? 'Change anchor' : 'Pick anchor')}
              </button>
              <button className="btn btn-secondary" onClick={onRotationCancel}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Fabrication settings */}
      <div className="panel-section">
        <div className="movement-header">Fabrication</div>
        <div className="rotation-config-row" style={{ marginTop: 6 }}>
          <span className="rotation-config-label">Lever exposure</span>
          <input
            type="range"
            min={30}
            max={200}
            step={5}
            value={leverExposure}
            onChange={e => onLeverExposureChange(Number(e.target.value))}
            style={{ flex: 1, margin: '0 6px' }}
          />
          <span className="rotation-config-unit">{leverExposure}px</span>
        </div>
        <p className="form-note" style={{ marginTop: 2 }}>
          How far the lever sticks out past the canvas edge (30–200 px).
        </p>
      </div>

      {/* Save section */}
      <div className="panel-section panel-section-save">
        <button className="btn-save" onClick={onSave}>save for fabrication</button>
      </div>
    </aside>
  );
}

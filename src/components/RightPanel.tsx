import { useRef } from 'react';
import type { CanvasObject } from '../types';
import type { Tab } from '../App';

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
  onOpenStage3: () => void;
  onClearMovement: () => void;
  onSave: () => void;
  revealRatio: number;
  onRevealRatioChange: (value: number) => void;
  // Rotation inline config (no modal)
  rotationConfigOpen: boolean;
  onRotationPickAnchor: () => void;
  onRotationCancel: () => void;
  pickingAnchor: boolean;
}

function movementLabel(obj: CanvasObject): string {
  const m = obj.movement;
  if (!m) return '';
  if (m.type === 'transition') return `→ (${Math.round(m.endPoint.x)}, ${Math.round(m.endPoint.y)})`;
  if (m.type === 'rotation') return `↻ ${Math.round(m.angleDeg ?? 360)}°`;
  if (m.type === 'slide') return `⇥ ${m.direction} ${m.range > 0 ? '+' : ''}${m.range}px`;
  return '';
}

export function RightPanel({
  tab, bgFilename, bgLocked, objects, selectedId,
  onBackgroundUpload, onDeleteBackground, onObjectUpload, onDeleteObject, onObjectSelect,
  onMovementOpen, onOpenStage3, onClearMovement, onSave,
  revealRatio, onRevealRatioChange,
  rotationConfigOpen,
  onRotationPickAnchor, onRotationCancel,
  pickingAnchor,
}: Props) {
  const bgInputRef = useRef<HTMLInputElement>(null);
  const objInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const newObjInputRef = useRef<HTMLInputElement>(null);

  const selectedObject = objects.find(o => o.id === selectedId);

  return (
    <aside className="right-panel">

      {/* Hint */}
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
                  <button
                    type="button"
                    className="btn-delete-object"
                    onClick={onDeleteBackground}
                    title="Delete background"
                    aria-label="Delete background"
                  >
                    x
                  </button>
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
          <input
            ref={newObjInputRef} type="file" accept="image/*"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) { onObjectUpload(f); e.target.value = ''; }
            }}
          />
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
                    <input
                      ref={el => { objInputRefs.current[obj.id] = el; }}
                      type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) { onObjectUpload(f, obj.id); e.target.value = ''; } }}
                    />
                    <button className="btn-import"
                      onClick={e => { e.stopPropagation(); objInputRefs.current[obj.id]?.click(); }}>
                      Replace
                    </button>
                  </>
                )}
                {tab === 'design' && (
                  <button
                    type="button"
                    className="btn-delete-object"
                    onClick={e => { e.stopPropagation(); onDeleteObject(obj.id); }}
                    title="Delete object"
                    aria-label="Delete object"
                  >
                    x
                  </button>
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
            className={`btn-movement ${selectedObject?.movement?.type === 'transition' ? 'active' : ''}`}
            disabled={!selectedObject || tab === 'play'}
            onClick={() => onMovementOpen('translate')}
          >Translate</button>
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

       

        {/* Rotation inline config — no modal, canvas stays visible */}
        {rotationConfigOpen && selectedObject && (
          <div className="rotation-config">
            <div className="rotation-config-note">
              Rotation is fixed at 360°. Click inside the selected object to set the rotation anchor.
            </div>
            <div className="rotation-config-actions">
              <button
                className="btn btn-pick"
                onClick={onRotationPickAnchor}
                disabled={pickingAnchor}
              >
                {pickingAnchor ? 'Click inside selected object…' : (selectedObject.movement?.type === 'rotation' ? 'Change anchor' : 'Pick anchor')}
              </button>
              <button className="btn btn-secondary" onClick={onRotationCancel}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      <div className="panel-section">
        <div className="movement-header">Stage 3</div>
        <button className="btn-save btn-stage3" onClick={onOpenStage3}>
          open stage 3
        </button>
      </div>
      <div className="lever-reveal-section">
          <div className="lever-reveal-section-title">Lever length</div>
          <p className="lever-reveal-hint" id="lever-reveal-hint">
            Adjust how far the lever arm extends out of the canvas.
          </p>
          <div className="lever-reveal-control">
            <div className="lever-reveal-label-row">
              {/* <label className="lever-reveal-label" htmlFor="lever-reveal-slider">
                How much sticks out
              </label> */}
              <span className="lever-reveal-value" aria-live="polite">
                {Math.round(revealRatio * 100)}%
              </span>
            </div>
            <input
              id="lever-reveal-slider"
              className="lever-reveal-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(revealRatio * 100)}
              onChange={(e) => onRevealRatioChange(Number(e.target.value) / 100)}
              aria-describedby="lever-reveal-hint"
            />
          </div>
        </div>

      {/* Save section */}
      <div className="panel-section panel-section-save">
        <button className="btn-save" onClick={onSave}>
          save for fabrication
        </button>
     
      </div>
    </aside>
  );
}

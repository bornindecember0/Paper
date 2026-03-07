import { useRef } from 'react';
import type { CanvasObject } from '../types';
import type { Tab } from '../App';

interface Props {
  tab: Tab;
  background: string | null;
  bgFilename: string;
  objects: CanvasObject[];
  selectedId: string | null;
  onBackgroundUpload: (file: File) => void;
  onObjectUpload: (file: File, objectId?: string) => void;
  onObjectSelect: (id: string) => void;
  onMovementOpen: (type: 'translate' | 'rotation' | 'slide') => void;
  onClearMovement: () => void;
}

function movementLabel(obj: CanvasObject): string {
  const m = obj.movement;
  if (!m) return '';
  if (m.type === 'transition') return `→ (${Math.round(m.endPoint.x)}, ${Math.round(m.endPoint.y)})`;
  if (m.type === 'rotation') return `↻ ${m.degrees}° ${m.clockwise ? 'CW' : 'CCW'}`;
  if (m.type === 'slide') return `⇥ ${m.direction} ${m.range > 0 ? '+' : ''}${m.range}px`;
  return '';
}

export function RightPanel({
  tab, background, bgFilename, objects, selectedId,
  onBackgroundUpload, onObjectUpload, onObjectSelect,
  onMovementOpen, onClearMovement,
}: Props) {
  const bgInputRef = useRef<HTMLInputElement>(null);
  const objInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const newObjInputRef = useRef<HTMLInputElement>(null);

  const selectedObject = objects.find(o => o.id === selectedId);

  return (
    <aside className="right-panel">

      {/* Images section */}
      <div className="panel-section">
        <div className="section-header">
          <span className="section-title">Images</span>
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

        {/* Background row */}
        <div className="image-row">
          <div className="image-row-top">
            <span className="image-label">Background</span>
            <input ref={bgInputRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) { onBackgroundUpload(f); e.target.value = ''; } }} />
            <button className="btn-import" onClick={() => bgInputRef.current?.click()}>Import Image</button>
          </div>
          <span className="image-filename">{bgFilename || (background ? 'loaded' : 'No file')}</span>
        </div>

        {/* Object rows */}
        {objects.map((obj, i) => (
          <div
            key={obj.id}
            className={`image-row ${obj.id === selectedId ? 'selected' : ''}`}
            onClick={() => { if (tab === 'design') onObjectSelect(obj.id); }}
            style={{ cursor: tab === 'design' ? 'pointer' : 'default' }}
          >
            <div className="image-row-top">
              <span className="image-label">Object #{i + 1}</span>
              <input
                ref={el => { objInputRefs.current[obj.id] = el; }}
                type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) { onObjectUpload(f, obj.id); e.target.value = ''; } }}
              />
              <button className="btn-import"
                onClick={e => { e.stopPropagation(); objInputRefs.current[obj.id]?.click(); }}>
                Import Image
              </button>
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
            <button className="btn-clear" onClick={onClearMovement} title="Remove">✕</button>
          </div>
        )}

        <div className="movement-btns">
          <button
            className={`btn-movement ${selectedObject?.movement?.type === 'transition' ? 'active' : ''}`}
            disabled={!selectedObject || tab === 'play'}
            onClick={() => onMovementOpen('translate')}
          >Translate</button>
          <button
            className={`btn-movement ${selectedObject?.movement?.type === 'rotation' ? 'active' : ''}`}
            disabled={!selectedObject || tab === 'play'}
            onClick={() => onMovementOpen('rotation')}
          >Rotation</button>
          <button
            className={`btn-movement ${selectedObject?.movement?.type === 'slide' ? 'active' : ''}`}
            disabled={!selectedObject || tab === 'play'}
            onClick={() => onMovementOpen('slide')}
          >Slide</button>
        </div>
      </div>
    </aside>
  );
}

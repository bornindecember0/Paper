import { useRef } from 'react';
import type { CanvasObject } from '../types';
import type { Tab, MovementDialog } from '../App';

interface Props {
  tab: Tab;
  onTabChange: (t: Tab) => void;
  background: string | null;
  bgFilename: string;
  objects: CanvasObject[];
  selectedId: string | null;
  onBackgroundUpload: (file: File) => void;
  onObjectUpload: (file: File, objectId?: string) => void;
  onObjectSelect: (id: string) => void;
  onMovementOpen: (d: MovementDialog) => void;
  onClearMovement: () => void;
}

function movementLabel(obj: CanvasObject): string {
  const m = obj.movement;
  if (!m) return '';
  if (m.type === 'transition') return `Translate → (${Math.round(m.endPoint.x)}, ${Math.round(m.endPoint.y)})`;
  if (m.type === 'rotation') return `Rotation ${m.degrees}° ${m.clockwise ? 'CW' : 'CCW'}`;
  if (m.type === 'slide') return `Slide ${m.direction} ${m.range}px`;
  return '';
}

export function RightPanel({
  tab, onTabChange,
  background, bgFilename,
  objects, selectedId,
  onBackgroundUpload, onObjectUpload,
  onObjectSelect,
  onMovementOpen, onClearMovement,
}: Props) {
  const bgInputRef = useRef<HTMLInputElement>(null);
  const objInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const newObjInputRef = useRef<HTMLInputElement>(null);

  const selectedObject = objects.find(o => o.id === selectedId);

  return (
    <aside className="right-panel">
      {/* Design / Play tabs */}
      <div className="tab-row">
        <button
          className={`tab-btn ${tab === 'design' ? 'active' : ''}`}
          onClick={() => onTabChange('design')}
        >
          Design
        </button>
        <button
          className={`tab-btn ${tab === 'play' ? 'active' : ''}`}
          onClick={() => onTabChange('play')}
        >
          Play
        </button>
      </div>

      {/* Images section */}
      <div className="panel-section">
        <div className="section-header">
          <span className="section-title">Images</span>
          {/* "+" adds a new blank object slot */}
          <input
            ref={newObjInputRef}
            type="file"
            accept="image/*"
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
            <input
              ref={bgInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) { onBackgroundUpload(f); e.target.value = ''; }
              }}
            />
            <button className="btn-import" onClick={() => bgInputRef.current?.click()}>
              Import Image
            </button>
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
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) { onObjectUpload(f, obj.id); e.target.value = ''; }
                }}
              />
              <button
                className="btn-import"
                onClick={e => { e.stopPropagation(); objInputRefs.current[obj.id]?.click(); }}
              >
                Import Image
              </button>
            </div>
            <span className="image-filename">{obj.filename || 'No name'}</span>
          </div>
        ))}
      </div>

      {/* Movement section */}
      <div className="panel-section">
        <div className="movement-header">Movement...</div>

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
          >
            Translate
          </button>
          <button
            className={`btn-movement ${selectedObject?.movement?.type === 'rotation' ? 'active' : ''}`}
            disabled={!selectedObject || tab === 'play'}
            onClick={() => onMovementOpen('rotation')}
          >
            Rotation
          </button>
          <button
            className={`btn-movement ${selectedObject?.movement?.type === 'slide' ? 'active' : ''}`}
            disabled={!selectedObject || tab === 'play'}
            onClick={() => onMovementOpen('slide')}
          >
            Slide
          </button>
        </div>
      </div>
    </aside>
  );
}

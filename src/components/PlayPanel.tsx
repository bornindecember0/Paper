import type { CanvasObject } from '../types';

interface Props {
  objects: CanvasObject[];
  sliderValues: Record<string, number>;
  onSliderChange: (id: string, value: number) => void;
}

function movementTypeLabel(obj: CanvasObject): string {
  if (!obj.movement) return '';
  if (obj.movement.type === 'transition') return 'Transition';
  if (obj.movement.type === 'rotation') return `Rotation ${obj.movement.degrees}°`;
  if (obj.movement.type === 'slide') return `Slide (${obj.movement.direction})`;
  return '';
}

export function PlayPanel({ objects, sliderValues, onSliderChange }: Props) {
  if (objects.length === 0) return null;

  return (
    <aside className="play-panel">
      <h3 className="sidebar-title">Play Controls</h3>
      <p className="sidebar-hint">Drag each lever to preview the movement.</p>
      <div className="play-levers">
        {objects.map((obj, i) => {
          const val = sliderValues[obj.id] ?? 0;
          return (
            <div key={obj.id} className="lever-item">
              <div className="lever-header">
                <span className="lever-label">Object {i + 1}</span>
                <span className="lever-type">{movementTypeLabel(obj)}</span>
              </div>
              <div className="lever-track">
                <span className="lever-tick">0%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(val * 100)}
                  onChange={e => onSliderChange(obj.id, Number(e.target.value) / 100)}
                  className="lever-slider"
                />
                <span className="lever-tick">{Math.round(val * 100)}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

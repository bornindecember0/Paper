import { useState, useCallback } from 'react';
import { CanvasArea, CANVAS_W, CANVAS_H } from './components/CanvasArea';
import { Sidebar } from './components/Sidebar';
import { SlideModal } from './components/SlideModal';
import { PlayPanel } from './components/PlayPanel';
import type { CanvasObject, Position, InteractionMode } from './types';

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

export default function App() {
  const [background, setBackground] = useState<string | null>(null);
  const [objects, setObjects] = useState<CanvasObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<InteractionMode>('idle');
  const [showSlideModal, setShowSlideModal] = useState(false);
  const [sliderValues, setSliderValues] = useState<Record<string, number>>({});
  const [playMode, setPlayMode] = useState(false);

  const selectedObject = objects.find(o => o.id === selectedId);
  const objectsWithMovement = objects.filter(o => o.movement);

  // ── Upload handlers ───────────────────────────────────────────────────────

  const handleBackgroundUpload = useCallback((file: File) => {
    setBackground(URL.createObjectURL(file));
  }, []);

  const handleObjectUpload = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Scale down if needed
      const maxDim = 200;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const obj: CanvasObject = {
        id: uid(),
        imageUrl: url,
        position: { x: CANVAS_W / 2, y: CANVAS_H / 2 },
        width: w,
        height: h,
      };
      setObjects(prev => [...prev, obj]);
      setSelectedId(obj.id);
    };
    img.src = url;
  }, []);

  // ── Canvas click handling ─────────────────────────────────────────────────

  const handleCanvasClick = useCallback((pos: Position) => {
    if (mode === 'setting-end-point' && selectedId) {
      setObjects(prev =>
        prev.map(o =>
          o.id === selectedId
            ? { ...o, movement: { type: 'transition', endPoint: pos } }
            : o,
        ),
      );
      setMode('idle');
    } else if (mode === 'setting-anchor' && selectedId) {
      setObjects(prev =>
        prev.map(o => {
          if (o.id !== selectedId) return o;
          // Clamp anchor to object bounding box
          const clampedAnchor: Position = {
            x: Math.max(o.position.x - o.width / 2, Math.min(o.position.x + o.width / 2, pos.x)),
            y: Math.max(o.position.y - o.height / 2, Math.min(o.position.y + o.height / 2, pos.y)),
          };
          const existing = o.movement?.type === 'rotation' ? o.movement : null;
          return {
            ...o,
            movement: {
              type: 'rotation',
              anchorPoint: clampedAnchor,
              degrees: existing?.degrees ?? 90,
              clockwise: existing?.clockwise ?? true,
            },
          };
        }),
      );
      setMode('idle');
    }
  }, [mode, selectedId]);

  // ── Object manipulation ───────────────────────────────────────────────────

  const handleObjectMove = useCallback((id: string, newPos: Position) => {
    setObjects(prev =>
      prev.map(o => (o.id === id ? { ...o, position: newPos } : o)),
    );
  }, []);

  // ── Movement configuration ────────────────────────────────────────────────

  const handleSelectMovement = useCallback((type: 'transition' | 'rotation' | 'slide') => {
    if (!selectedId) return;
    if (type === 'transition') {
      setMode('setting-end-point');
    } else if (type === 'rotation') {
      // Start with anchor at object center; user can refine
      setObjects(prev =>
        prev.map(o => {
          if (o.id !== selectedId) return o;
          const existing = o.movement?.type === 'rotation' ? o.movement : null;
          return {
            ...o,
            movement: {
              type: 'rotation',
              anchorPoint: existing?.anchorPoint ?? { ...o.position },
              degrees: existing?.degrees ?? 90,
              clockwise: existing?.clockwise ?? true,
            },
          };
        }),
      );
      setMode('setting-anchor');
    } else {
      setShowSlideModal(true);
    }
  }, [selectedId]);

  const handleRotationChange = useCallback((degrees: number, clockwise: boolean) => {
    if (!selectedId) return;
    setObjects(prev =>
      prev.map(o => {
        if (o.id !== selectedId || o.movement?.type !== 'rotation') return o;
        return { ...o, movement: { ...o.movement, degrees, clockwise } };
      }),
    );
  }, [selectedId]);

  const handleSlideConfirm = useCallback((
    direction: 'horizontal' | 'vertical',
    range: number,
  ) => {
    if (!selectedId) return;
    setObjects(prev =>
      prev.map(o =>
        o.id === selectedId
          ? { ...o, movement: { type: 'slide', direction, range } }
          : o,
      ),
    );
    setShowSlideModal(false);
  }, [selectedId]);

  const handleClearMovement = useCallback(() => {
    if (!selectedId) return;
    setObjects(prev =>
      prev.map(o => (o.id === selectedId ? { ...o, movement: undefined } : o)),
    );
  }, [selectedId]);

  // ── Play controls ─────────────────────────────────────────────────────────

  const handlePlay = () => {
    const initial: Record<string, number> = {};
    objects.forEach(o => { if (o.movement) initial[o.id] = 0; });
    setSliderValues(initial);
    setPlayMode(true);
    setMode('play');
    setSelectedId(null);
  };

  const handleStop = () => {
    setPlayMode(false);
    setMode('idle');
    setSliderValues({});
  };

  const handleSliderChange = useCallback((id: string, value: number) => {
    setSliderValues(prev => ({ ...prev, [id]: value }));
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="20" height="20" rx="3" stroke="#60a5fa" strokeWidth="1.5"/>
            <rect x="6" y="6" width="6" height="6" rx="1" fill="#60a5fa"/>
            <path d="M14 11 L18 11 M16 9 L18 11 L16 13" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Canvas Object Movement</span>
        </div>
        <div className="header-actions">
          {!playMode && objectsWithMovement.length > 0 && (
            <button className="btn btn-play" onClick={handlePlay}>
              &#9654; Play
            </button>
          )}
          {playMode && (
            <button className="btn btn-stop" onClick={handleStop}>
              &#9632; Stop
            </button>
          )}
        </div>
      </header>

      <div className="app-body">
        <Sidebar
          onBackgroundUpload={handleBackgroundUpload}
          onObjectUpload={handleObjectUpload}
          selectedObject={selectedObject}
          mode={mode}
          onSelectMovement={handleSelectMovement}
          onRotationChange={handleRotationChange}
          onClearMovement={handleClearMovement}
          onCancelMode={() => setMode('idle')}
        />

        <main className="canvas-wrapper">
          {(mode === 'setting-end-point' || mode === 'setting-anchor') && (
            <div className="mode-hint-bar">
              {mode === 'setting-end-point' && 'Click on the canvas to set the transition end point'}
              {mode === 'setting-anchor' && 'Click inside the object to set the rotation anchor point'}
            </div>
          )}
          <CanvasArea
            background={background}
            objects={objects}
            selectedId={selectedId}
            mode={mode}
            sliderValues={sliderValues}
            onCanvasClick={handleCanvasClick}
            onObjectSelect={id => { if (mode === 'idle') setSelectedId(id); }}
            onObjectMove={handleObjectMove}
          />
        </main>

        {playMode && (
          <PlayPanel
            objects={objectsWithMovement}
            sliderValues={sliderValues}
            onSliderChange={handleSliderChange}
          />
        )}
      </div>

      {showSlideModal && (
        <SlideModal
          onConfirm={handleSlideConfirm}
          onCancel={() => setShowSlideModal(false)}
        />
      )}
    </div>
  );
}

import { useState, useCallback } from 'react';
import { CanvasArea, CANVAS_W, CANVAS_H } from './components/CanvasArea';
import { RightPanel } from './components/RightPanel';
import { RotationModal } from './components/RotationModal';
import { SlideModal } from './components/SlideModal';
import { PlayOverlay, LEVER_ROW_H } from './components/PlayOverlay';
import type { CanvasObject, Position } from './types';

export type Tab = 'design' | 'play';
export type MovementDialog = 'rotation' | 'slide' | null;

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

export default function App() {
  const [tab, setTab] = useState<Tab>('design');
  const [background, setBackground] = useState<string | null>(null);
  const [bgFilename, setBgFilename] = useState<string>('');
  const [objects, setObjects] = useState<CanvasObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<MovementDialog>(null);
  const [pickingEndPoint, setPickingEndPoint] = useState(false);
  const [sliderValues, setSliderValues] = useState<Record<string, number>>({});

  const selectedObject = objects.find(o => o.id === selectedId);
  const objectsWithMovement = objects.filter(o => o.movement);

  // ── Uploads ───────────────────────────────────────────────────────────────

  const handleBackgroundUpload = useCallback((file: File) => {
    if (background) URL.revokeObjectURL(background);
    setBackground(URL.createObjectURL(file));
    setBgFilename(file.name);
  }, [background]);

  const handleObjectUpload = useCallback((file: File, objectId?: string) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxDim = 200;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxDim || h > maxDim) {
        const r = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * r); h = Math.round(h * r);
      }
      if (objectId) {
        setObjects(prev => prev.map(o =>
          o.id === objectId ? { ...o, imageUrl: url, width: w, height: h, filename: file.name } : o,
        ));
      } else {
        const obj: CanvasObject = {
          id: uid(), imageUrl: url, filename: file.name,
          position: { x: CANVAS_W / 2, y: CANVAS_H / 2 }, width: w, height: h,
        };
        setObjects(prev => [...prev, obj]);
        setSelectedId(obj.id);
      }
    };
    img.src = url;
  }, []);

  // ── Object manipulation ───────────────────────────────────────────────────

  const handleObjectMove = useCallback((id: string, pos: Position) => {
    setObjects(prev => prev.map(o => o.id === id ? { ...o, position: pos } : o));
  }, []);

  // ── Translation end-point: canvas-click picking ───────────────────────────

  const handleEndPointPick = useCallback((pos: Position) => {
    if (!selectedId) return;
    setObjects(prev => prev.map(o =>
      o.id === selectedId ? { ...o, movement: { type: 'transition', endPoint: pos } } : o,
    ));
    setPickingEndPoint(false);
  }, [selectedId]);

  // ── Rotation / Slide config ───────────────────────────────────────────────

  const handleRotationConfirm = useCallback((anchorPoint: Position, degrees: number, clockwise: boolean) => {
    if (!selectedId) return;
    setObjects(prev => prev.map(o =>
      o.id === selectedId ? { ...o, movement: { type: 'rotation', anchorPoint, degrees, clockwise } } : o,
    ));
    setDialog(null);
  }, [selectedId]);

  const handleSlideConfirm = useCallback((
    startPoint: Position, endPoint: Position,
    firstObjectId: string, _secondObjectId: string,
  ) => {
    if (!firstObjectId) return;
    setObjects(prev => prev.map(o =>
      o.id === firstObjectId
        ? {
            ...o,
            movement: {
              type: 'slide',
              direction: Math.abs(endPoint.x - startPoint.x) >= Math.abs(endPoint.y - startPoint.y)
                ? 'horizontal' : 'vertical',
              range: Math.abs(endPoint.x - startPoint.x) >= Math.abs(endPoint.y - startPoint.y)
                ? endPoint.x - startPoint.x
                : endPoint.y - startPoint.y,
            },
          }
        : o,
    ));
    setSelectedId(firstObjectId);
    setDialog(null);
  }, []);

  const handleClearMovement = useCallback(() => {
    if (!selectedId) return;
    setObjects(prev => prev.map(o => o.id === selectedId ? { ...o, movement: undefined } : o));
  }, [selectedId]);

  // ── Movement button dispatch ──────────────────────────────────────────────

  const handleMovementOpen = useCallback((type: 'translate' | 'rotation' | 'slide') => {
    if (type === 'translate') {
      // Enter canvas-click picking mode
      setPickingEndPoint(true);
    } else if (type === 'rotation') {
      setDialog('rotation');
    } else {
      setDialog('slide');
    }
  }, []);

  // ── Tab switching ─────────────────────────────────────────────────────────

  const handleTabChange = useCallback((t: Tab) => {
    setTab(t);
    setPickingEndPoint(false);
    if (t === 'play') {
      const init: Record<string, number> = {};
      objects.forEach(o => { if (o.movement) init[o.id] = 0; });
      setSliderValues(init);
      setSelectedId(null);
    } else {
      setSliderValues({});
    }
  }, [objects]);

  const handleSliderChange = useCallback((id: string, value: number) => {
    setSliderValues(prev => ({ ...prev, [id]: value }));
  }, []);

  const leverAreaH = objectsWithMovement.length * LEVER_ROW_H;

  return (
    <div className="app">
      {/* ── Canvas area (gray background) ─────────────────────────────────── */}
      <div className="canvas-area">

        {/* Design / Play tabs — top-right of canvas area */}
        <div className="canvas-tabs">
          <button
            className={`tab-btn ${tab === 'design' ? 'active' : ''}`}
            onClick={() => handleTabChange('design')}
          >Design</button>
          <button
            className={`tab-btn ${tab === 'play' ? 'active' : ''}`}
            onClick={() => handleTabChange('play')}
          >Play</button>
        </div>

        {/* Picking hint */}
        {pickingEndPoint && (
          <div className="picking-hint">
            Click on the canvas to set the end point
            <button
              className="picking-cancel"
              onClick={() => setPickingEndPoint(false)}
            >✕</button>
          </div>
        )}

        {/* Canvas + levers */}
        <div
          className="canvas-play-wrapper"
          style={tab === 'play' && leverAreaH > 0 ? { marginTop: leverAreaH } : undefined}
        >
          {tab === 'play' && objectsWithMovement.length > 0 && (
            <PlayOverlay
              objects={objectsWithMovement}
              sliderValues={sliderValues}
              canvasW={CANVAS_W}
              canvasH={CANVAS_H}
              onChange={handleSliderChange}
            />
          )}
          <div className="canvas-container">
            <CanvasArea
              background={background}
              objects={objects}
              selectedId={tab === 'design' ? selectedId : null}
              isPlayMode={tab === 'play'}
              pickingEndPoint={pickingEndPoint}
              sliderValues={sliderValues}
              onObjectSelect={id => { if (tab === 'design') setSelectedId(id); }}
              onObjectMove={handleObjectMove}
              onEndPointPick={handleEndPointPick}
            />
          </div>
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────────────── */}
      <RightPanel
        tab={tab}
        background={background}
        bgFilename={bgFilename}
        objects={objects}
        selectedId={selectedId}
        onBackgroundUpload={handleBackgroundUpload}
        onObjectUpload={handleObjectUpload}
        onObjectSelect={setSelectedId}
        onMovementOpen={handleMovementOpen}
        onClearMovement={handleClearMovement}
      />

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {dialog === 'rotation' && selectedObject && (
        <RotationModal
          objectPos={selectedObject.position}
          existing={selectedObject.movement?.type === 'rotation' ? selectedObject.movement : undefined}
          onConfirm={handleRotationConfirm}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'slide' && selectedObject && (
        <SlideModal
          objects={objects}
          selectedId={selectedObject.id}
          onConfirm={handleSlideConfirm}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}

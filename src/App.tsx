import { useState, useCallback } from 'react';
import { CanvasArea, CANVAS_W, CANVAS_H } from './components/CanvasArea';
import { RightPanel } from './components/RightPanel';
import { SlideModal } from './components/SlideModal';
import { CropModal } from './components/CropModal';
import { PlayOverlay, getLeverAreaH } from './components/PlayOverlay';
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
  const [bgLocked, setBgLocked] = useState(false);
  const [objects, setObjects] = useState<CanvasObject[]>([]);
  // Pending crop: raw blob URL + filename + optional objectId (null = background)
  const [pendingCrop, setPendingCrop] = useState<{
    url: string; filename: string; objectId: string | null;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<MovementDialog>(null);
  const [pickingEndPoint, setPickingEndPoint] = useState(false);
  const [pickingAnchor, setPickingAnchor] = useState(false);
  const [rotationConfigOpen, setRotationConfigOpen] = useState(false);
  const [rotationDegrees, setRotationDegrees] = useState(360);
  const [rotationClockwise, setRotationClockwise] = useState(true);
  const [sliderValues, setSliderValues] = useState<Record<string, number>>({});

  const selectedObject = objects.find(o => o.id === selectedId);
  const objectsWithMovement = objects.filter(o => o.movement);

  // ── Uploads ───────────────────────────────────────────────────────────────

  const handleBackgroundUpload = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setPendingCrop({ url, filename: file.name, objectId: null });
  }, []);

  const handleObjectUpload = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    // objectId = 'new' means we create a new object after crop
    setPendingCrop({ url, filename: file.name, objectId: 'new' });
  }, []);

  // Finalize crop (called after crop save or skip)
  const finalizeCrop = useCallback((croppedUrl: string) => {
    if (!pendingCrop) return;
    const { filename, objectId } = pendingCrop;
    if (objectId === null) {
      // Background
      if (background) URL.revokeObjectURL(background);
      setBackground(croppedUrl);
      setBgFilename(filename);
      setBgLocked(true);
    } else {
      // New object (objectId === 'new')
      const img = new Image();
      img.onload = () => {
        const maxDim = 200;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > maxDim || h > maxDim) {
          const r = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * r); h = Math.round(h * r);
        }
        const obj: CanvasObject = {
          id: uid(), imageUrl: croppedUrl, filename,
          position: { x: CANVAS_W / 2, y: CANVAS_H / 2 }, width: w, height: h,
          locked: true,
        };
        setObjects(prev => [...prev, obj]);
        setSelectedId(obj.id);
      };
      img.src = croppedUrl;
    }
    URL.revokeObjectURL(pendingCrop.url);
    setPendingCrop(null);
  }, [pendingCrop, background]);

  const handleCropSkip = useCallback(() => {
    if (pendingCrop) finalizeCrop(pendingCrop.url);
  }, [pendingCrop, finalizeCrop]);

  // ── Object manipulation ───────────────────────────────────────────────────

  const handleObjectMove = useCallback((id: string, pos: Position) => {
    setObjects(prev => prev.map(o => o.id === id ? { ...o, position: pos } : o));
  }, []);

  const handleObjectResize = useCallback((id: string, width: number, height: number, position: Position) => {
    setObjects(prev => prev.map(o => {
      if (o.id !== id) return o;
      const updated = { ...o, width, height, position };
      if (o.movement?.type === 'rotation') {
        const ap = o.movement.anchorPoint;
        const maxX = width / 2;
        const maxY = height / 2;
        const clamped = {
          x: Math.max(-maxX, Math.min(maxX, ap.x)),
          y: Math.max(-maxY, Math.min(maxY, ap.y)),
        };
        updated.movement = { ...o.movement, anchorPoint: clamped };
      }
      return updated;
    }));
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

  const handleAnchorPick = useCallback((pos: Position) => {
    if (!selectedId) return;
    setObjects(prev => prev.map(o => {
      if (o.id !== selectedId) return o;
      // Store anchor as offset from object center so it moves with the object
      const anchorOffset = { x: pos.x - o.position.x, y: pos.y - o.position.y };
      return { ...o, movement: { type: 'rotation', anchorPoint: anchorOffset, degrees: rotationDegrees, clockwise: rotationClockwise } };
    }));
    setPickingAnchor(false);
    setRotationConfigOpen(false);
  }, [selectedId, rotationDegrees, rotationClockwise]);

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
      setPickingEndPoint(true);
    } else if (type === 'rotation') {
      const rot = selectedObject?.movement?.type === 'rotation' ? selectedObject.movement : undefined;
      setRotationDegrees(rot?.degrees ?? 360);
      setRotationClockwise(rot?.clockwise ?? true);
      setRotationConfigOpen(true);
      setPickingAnchor(false);
    } else {
      setDialog('slide');
    }
  }, [selectedObject]);

  // ── Tab switching ─────────────────────────────────────────────────────────

  const handleTabChange = useCallback((t: Tab) => {
    setTab(t);
    setPickingEndPoint(false);
    setPickingAnchor(false);
    setRotationConfigOpen(false);
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

  const leverAreaH = getLeverAreaH(objectsWithMovement);

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
        {(pickingEndPoint || pickingAnchor) && (
          <div className="picking-hint">
            {pickingEndPoint ? 'Click on the canvas to set the end point'
              : 'Click inside the object to set the rotation anchor'}
            <button
              className="picking-cancel"
              onClick={() => { setPickingEndPoint(false); setPickingAnchor(false); }}
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
              pickingAnchor={pickingAnchor}
              sliderValues={sliderValues}
              onObjectSelect={id => { if (tab === 'design') setSelectedId(id); }}
              onObjectMove={handleObjectMove}
              onObjectResize={handleObjectResize}
              onEndPointPick={handleEndPointPick}
              onAnchorPick={handleAnchorPick}
            />
          </div>
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────────────── */}
      <RightPanel
        tab={tab}
        background={background}
        bgFilename={bgFilename}
        bgLocked={bgLocked}
        objects={objects}
        selectedId={selectedId}
        onBackgroundUpload={handleBackgroundUpload}
        onObjectUpload={handleObjectUpload}
        onObjectSelect={setSelectedId}
        onMovementOpen={handleMovementOpen}
        onClearMovement={handleClearMovement}
        rotationConfigOpen={rotationConfigOpen}
        rotationDegrees={rotationDegrees}
        rotationClockwise={rotationClockwise}
        onRotationDegreesChange={setRotationDegrees}
        onRotationClockwiseChange={setRotationClockwise}
        onRotationPickAnchor={() => setPickingAnchor(true)}
        onRotationCancel={() => { setRotationConfigOpen(false); setPickingAnchor(false); }}
        pickingAnchor={pickingAnchor}
      />

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {/* Crop modal — shown immediately after any upload */}
      {pendingCrop && (
        <CropModal
          imageUrl={pendingCrop.url}
          onSave={finalizeCrop}
          onSkip={handleCropSkip}
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

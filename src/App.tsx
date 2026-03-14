import { useState, useCallback } from 'react';
import { CanvasArea, CANVAS_W, CANVAS_H } from './components/CanvasArea';
import { RightPanel } from './components/RightPanel';
import { SlideModal, pullDirectionToAxis, pullDirectionToRangeSign } from './components/SlideModal';
import type { PullDirection } from './components/SlideModal';
import { CropModal } from './components/CropModal';
import { ObjectCropModal } from './components/ObjectCropModal';
import { PlayOverlay, getLeverAreaH } from './components/PlayOverlay';
import { buildSavePayload, downloadSave } from './exportData';
import type { CanvasObject, Position } from './types';
import { DEFAULT_SLOT_WIDTH } from './pathUtils';

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
  const [pendingCrop, setPendingCrop] = useState<{
    url: string; filename: string; objectId: string | null;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<MovementDialog>(null);
  const [drawingTransPath, setDrawingTransPath] = useState(false);
  const [pickingAnchor, setPickingAnchor] = useState(false);
  const [rotationConfigOpen, setRotationConfigOpen] = useState(false);
  const [rotationDegrees, setRotationDegrees] = useState(360);
  const [rotationClockwise, setRotationClockwise] = useState(true);
  const [sliderValues, setSliderValues] = useState<Record<string, number>>({});
  const [leverExposure, setLeverExposure] = useState(80);

  const selectedObject = objects.find(o => o.id === selectedId);
  const objectsWithMovement = objects.filter(o => o.movement);

  // ── Uploads ───────────────────────────────────────────────────────────────

  const handleBackgroundUpload = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setPendingCrop({ url, filename: file.name, objectId: null });
  }, []);

  const handleDeleteBackground = useCallback(() => {
    if (background) URL.revokeObjectURL(background);
    setBackground(null);
    setBgFilename('');
    setBgLocked(false);
  }, [background]);

  const handleObjectUpload = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setPendingCrop({ url, filename: file.name, objectId: 'new' });
  }, []);

  const finalizeCrop = useCallback((croppedUrl: string) => {
    if (!pendingCrop) return;
    const { filename, objectId } = pendingCrop;
    if (objectId === null) {
      if (background) URL.revokeObjectURL(background);
      setBackground(croppedUrl);
      setBgFilename(filename);
      setBgLocked(true);
    } else {
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
    if (croppedUrl !== pendingCrop.url) URL.revokeObjectURL(pendingCrop.url);
    setPendingCrop(null);
  }, [pendingCrop, background]);

  const handleCropSkip = useCallback(() => {
    if (pendingCrop) finalizeCrop(pendingCrop.url);
  }, [pendingCrop, finalizeCrop]);

  const handleObjectCropCancel = useCallback(() => {
    if (pendingCrop) URL.revokeObjectURL(pendingCrop.url);
    setPendingCrop(null);
  }, [pendingCrop]);

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
        const maxX = width / 2, maxY = height / 2;
        const clamped = { x: Math.max(-maxX, Math.min(maxX, ap.x)), y: Math.max(-maxY, Math.min(maxY, ap.y)) };
        updated.movement = { ...o.movement, anchorPoint: clamped };
      }
      return updated;
    }));
  }, []);

  // ── Translation path drawing ───────────────────────────────────────────────

  const handleTransPathComplete = useCallback((path: Position[]) => {
    if (!selectedId) return;
    setObjects(prev => prev.map(o =>
      o.id === selectedId
        ? { ...o, movement: { type: 'transition', path, slotWidth: DEFAULT_SLOT_WIDTH } }
        : o,
    ));
    setDrawingTransPath(false);
  }, [selectedId]);

  // ── Rotation / Anchor picking ─────────────────────────────────────────────

  const handleAnchorPick = useCallback((pos: Position) => {
    if (!selectedId) return;
    setObjects(prev => prev.map(o => {
      if (o.id !== selectedId) return o;
      const anchorOffset = { x: pos.x - o.position.x, y: pos.y - o.position.y };
      return { ...o, movement: { type: 'rotation', anchorPoint: anchorOffset, degrees: rotationDegrees, clockwise: rotationClockwise } };
    }));
    setPickingAnchor(false);
    setRotationConfigOpen(false);
  }, [selectedId, rotationDegrees, rotationClockwise]);

  const handleSlideConfirm = useCallback((
    pullDirection: PullDirection,
    beforeObjectId: string,
    afterObjectId: string,
  ) => {
    if (!beforeObjectId || !afterObjectId) return;
    const axis = pullDirectionToAxis(pullDirection);
    const sign = pullDirectionToRangeSign(pullDirection);
    const range = sign * (axis === 'vertical' ? CANVAS_H : CANVAS_W);
    setObjects(prev => prev.map(o =>
      o.id === beforeObjectId
        ? { ...o, movement: { type: 'slide', direction: axis, pullDirection, range, secondObjectId: afterObjectId } }
        : o,
    ));
    setSelectedId(beforeObjectId);
    setDialog(null);
  }, []);

  const handleClearMovement = useCallback(() => {
    if (!selectedId) return;
    setObjects(prev => prev.map(o => o.id === selectedId ? { ...o, movement: undefined } : o));
  }, [selectedId]);

  const handleDeleteObject = useCallback((id: string) => {
    setObjects(prev => prev.filter(o => o.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  const handleSave = useCallback(async () => {
    const payload = await buildSavePayload({
      background, bgFilename, objects, canvasW: CANVAS_W, canvasH: CANVAS_H, leverExposure,
    });
    downloadSave(payload);
  }, [background, bgFilename, objects, leverExposure]);

  // ── Movement button dispatch ──────────────────────────────────────────────

  const handleMovementOpen = useCallback((type: 'translate' | 'rotation' | 'slide') => {
    if (type === 'translate') {
      setDrawingTransPath(true);
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
    setDrawingTransPath(false);
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
      {/* ── Canvas area ─────────────────────────────────────────────────────── */}
      <div className="canvas-area">

        <div className="canvas-tabs">
          <button className={`tab-btn ${tab === 'design' ? 'active' : ''}`} onClick={() => handleTabChange('design')}>Design</button>
          <button className={`tab-btn ${tab === 'play' ? 'active' : ''}`} onClick={() => handleTabChange('play')}>Play</button>
        </div>

        {/* Picking hint */}
        {(drawingTransPath || pickingAnchor) && (
          <div className="picking-hint">
            {drawingTransPath
              ? 'Hold and drag on the canvas to draw the cut path'
              : 'Click inside the object to set the rotation anchor'}
            <button
              className="picking-cancel"
              onClick={() => { setDrawingTransPath(false); setPickingAnchor(false); }}
            >✕</button>
          </div>
        )}

        <div
          className="canvas-play-wrapper"
          style={tab === 'play' && leverAreaH > 0 ? { marginTop: leverAreaH } : undefined}
        >
          <div
            className="canvas-container"
            style={tab === 'play' && objectsWithMovement.length > 0 ? { width: CANVAS_W, height: CANVAS_H } : undefined}
          >
            {tab === 'play' && objectsWithMovement.length > 0 ? (
              <>
                <div className="canvas-layer canvas-layer-bg" style={{ zIndex: 0 }}>
                  <CanvasArea
                    layer="background"
                    background={background}
                    objects={objects}
                    selectedId={null}
                    isPlayMode={true}
                    drawingTransPath={false}
                    pickingAnchor={false}
                    sliderValues={sliderValues}
                    onObjectSelect={() => {}}
                    onObjectMove={handleObjectMove}
                    onObjectResize={handleObjectResize}
                    onTransPathComplete={() => {}}
                    onAnchorPick={handleAnchorPick}
                  />
                </div>
                <PlayOverlay
                  objects={objectsWithMovement}
                  sliderValues={sliderValues}
                  canvasW={CANVAS_W}
                  canvasH={CANVAS_H}
                  leverExposure={leverExposure}
                  onChange={handleSliderChange}
                />
                <div className="canvas-layer canvas-layer-path" style={{ zIndex: 2 }}>
                  <CanvasArea
                    layer="path"
                    background={background}
                    objects={objects}
                    selectedId={null}
                    isPlayMode={true}
                    drawingTransPath={false}
                    pickingAnchor={false}
                    sliderValues={sliderValues}
                    onObjectSelect={() => {}}
                    onObjectMove={handleObjectMove}
                    onObjectResize={handleObjectResize}
                    onTransPathComplete={() => {}}
                    onAnchorPick={handleAnchorPick}
                  />
                </div>
                <div className="canvas-layer canvas-layer-objects" style={{ zIndex: 3 }}>
                  <CanvasArea
                    layer="objects"
                    background={background}
                    objects={objects}
                    selectedId={null}
                    isPlayMode={true}
                    drawingTransPath={false}
                    pickingAnchor={false}
                    sliderValues={sliderValues}
                    onObjectSelect={() => {}}
                    onObjectMove={handleObjectMove}
                    onObjectResize={handleObjectResize}
                    onTransPathComplete={() => {}}
                    onAnchorPick={handleAnchorPick}
                  />
                </div>
              </>
            ) : (
              <CanvasArea
                background={background}
                objects={objects}
                selectedId={selectedId}
                isPlayMode={tab === 'play'}
                drawingTransPath={drawingTransPath}
                pickingAnchor={pickingAnchor}
                sliderValues={sliderValues}
                onObjectSelect={id => { if (tab === 'design') setSelectedId(id); }}
                onObjectMove={handleObjectMove}
                onObjectResize={handleObjectResize}
                onTransPathComplete={handleTransPathComplete}
                onAnchorPick={handleAnchorPick}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────────────── */}
      <RightPanel
        tab={tab}
        bgFilename={bgFilename}
        bgLocked={bgLocked}
        objects={objects}
        selectedId={selectedId}
        onBackgroundUpload={handleBackgroundUpload}
        onDeleteBackground={handleDeleteBackground}
        onObjectUpload={handleObjectUpload}
        onDeleteObject={handleDeleteObject}
        onObjectSelect={setSelectedId}
        onMovementOpen={handleMovementOpen}
        onClearMovement={handleClearMovement}
        onSave={handleSave}
        rotationConfigOpen={rotationConfigOpen}
        rotationDegrees={rotationDegrees}
        rotationClockwise={rotationClockwise}
        onRotationDegreesChange={setRotationDegrees}
        onRotationClockwiseChange={setRotationClockwise}
        onRotationPickAnchor={() => setPickingAnchor(true)}
        onRotationCancel={() => { setRotationConfigOpen(false); setPickingAnchor(false); }}
        pickingAnchor={pickingAnchor}
        leverExposure={leverExposure}
        onLeverExposureChange={setLeverExposure}
        drawingTransPath={drawingTransPath}
      />

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {pendingCrop && pendingCrop.objectId === null && (
        <CropModal
          imageUrl={pendingCrop.url}
          onSave={finalizeCrop}
          onSkip={handleCropSkip}
        />
      )}

      {pendingCrop && pendingCrop.objectId !== null && (
        <ObjectCropModal
          imageUrl={pendingCrop.url}
          onSave={finalizeCrop}
          onCancel={handleObjectCropCancel}
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

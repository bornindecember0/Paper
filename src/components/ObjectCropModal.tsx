import { useRef, useState, useEffect, useCallback } from 'react';
import { removeBackground } from '@imgly/background-removal';

interface Point { x: number; y: number; }
type Phase = 'drawing' | 'closed' | 'processing' | 'preview';

interface Props {
  imageUrl: string;
  onSave: (url: string) => void;
  onCancel: () => void;
}

const MAX_W = 560;
const MAX_H = 420;
const CLOSE_RADIUS = 14;

export function ObjectCropModal({ imageUrl, onSave, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [displayW, setDisplayW] = useState(0);
  const [displayH, setDisplayH] = useState(0);
  const [points, setPoints] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [phase, setPhase] = useState<Phase>('drawing');
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const nearFirst = useRef(false);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImgEl(img);
      const scale = Math.min(MAX_W / img.naturalWidth, MAX_H / img.naturalHeight, 1);
      setDisplayW(Math.round(img.naturalWidth * scale));
      setDisplayH(Math.round(img.naturalHeight * scale));
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgEl || !displayW || !displayH) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, displayW, displayH);

    // Image (dim during processing)
    ctx.globalAlpha = phase === 'processing' ? 0.4 : 1;
    ctx.drawImage(imgEl, 0, 0, displayW, displayH);
    ctx.globalAlpha = 1;

    if (phase === 'drawing' && points.length > 0) {
      // Fill polygon-so-far with a faint tint
      if (points.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        if (cursor) ctx.lineTo(cursor.x, cursor.y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(76, 175, 80, 0.15)';
        ctx.fill();
      }
      // Dashed outline
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      if (cursor) ctx.lineTo(cursor.x, cursor.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Vertices
      points.forEach((p, i) => {
        const isFirst = i === 0;
        const canClose = isFirst && nearFirst.current && points.length >= 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, canClose ? 9 : 5, 0, Math.PI * 2);
        ctx.fillStyle = canClose ? '#4CAF50' : '#fff';
        ctx.fill();
        ctx.strokeStyle = canClose ? '#2E7D32' : '#555';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }

    if (phase === 'closed' && points.length >= 3) {
      // Filled polygon with green tint
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = 'rgba(76, 175, 80, 0.25)';
      ctx.fill();
      ctx.strokeStyle = '#4CAF50';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      points.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#4CAF50';
        ctx.fill();
      });
    }
  }, [imgEl, displayW, displayH, points, cursor, phase]);

  // Keyboard: Backspace = undo last point
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' && phase === 'drawing') {
        setPoints(prev => prev.slice(0, -1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase]);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  const closePolygon = useCallback(() => {
    setPhase('closed');
    setCursor(null);
    nearFirst.current = false;
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (phase !== 'drawing') return;
    const pos = getPos(e);
    setCursor(pos);
    nearFirst.current = points.length >= 3 && dist(pos, points[0]) < CLOSE_RADIUS;
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (phase !== 'drawing') return;
    const pos = getPos(e);
    if (points.length >= 3 && dist(pos, points[0]) < CLOSE_RADIUS) {
      closePolygon();
      return;
    }
    setPoints(prev => [...prev, pos]);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (phase !== 'drawing' || points.length < 3) return;
    e.preventDefault();
    // Remove the extra point added by the preceding single-click event
    setPoints(prev => prev.slice(0, -1));
    closePolygon();
  };

  // Build cropped blob: bounding box of polygon, pixels outside = transparent
  const buildCroppedBlob = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      if (!imgEl || points.length < 3) return reject(new Error('Not ready'));
      const sx = imgEl.naturalWidth / displayW;
      const sy = imgEl.naturalHeight / displayH;
      const npts = points.map(p => ({ x: p.x * sx, y: p.y * sy }));
      const xs = npts.map(p => p.x), ys = npts.map(p => p.y);
      const minX = Math.floor(Math.min(...xs));
      const minY = Math.floor(Math.min(...ys));
      const w = Math.ceil(Math.max(...xs)) - minX;
      const h = Math.ceil(Math.max(...ys)) - minY;
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const ctx = off.getContext('2d')!;
      ctx.beginPath();
      ctx.moveTo(npts[0].x - minX, npts[0].y - minY);
      npts.slice(1).forEach(p => ctx.lineTo(p.x - minX, p.y - minY));
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(imgEl, minX, minY, w, h, 0, 0, w, h);
      off.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
    });
  }, [imgEl, points, displayW, displayH]);

  const processAndPreview = useCallback(async (withBgRemoval: boolean) => {
    setPhase('processing');
    setProgress(0);
    try {
      const croppedBlob = await buildCroppedBlob();
      const finalBlob = withBgRemoval
        ? await removeBackground(croppedBlob, {
            progress: (_k: string, cur: number, tot: number) => {
              setProgress(tot > 0 ? Math.round((cur / tot) * 100) : 0);
            },
          })
        : croppedBlob;
      setResultUrl(URL.createObjectURL(finalBlob));
      setPhase('preview');
    } catch {
      setPhase('closed');
    }
  }, [buildCroppedBlob]);

  const handleRedraw = useCallback(() => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setPoints([]);
    setCursor(null);
    nearFirst.current = false;
    setPhase('drawing');
  }, [resultUrl]);

  const hint = (() => {
    if (phase === 'drawing') {
      if (points.length === 0) return 'Click to place points around your object';
      if (points.length < 3) return `${points.length} point${points.length > 1 ? 's' : ''} — keep going`;
      return 'Click the first point (green) or double-click to finish';
    }
    if (phase === 'closed') return 'Choose how to extract your object';
    if (phase === 'processing') return progress > 0 ? `Removing background… ${progress}%` : 'Removing background…';
    if (phase === 'preview') return 'Looking good? Confirm or redraw.';
    return '';
  })();

  return (
    <div className="modal-backdrop">
      <div className="modal object-crop-modal">
        <div className="modal-title">
          {phase === 'drawing' && 'Draw Around Object'}
          {phase === 'closed' && 'Selection Ready'}
          {phase === 'processing' && 'Processing…'}
          {phase === 'preview' && 'Preview'}
        </div>

        <div className="crop-body">
          {phase !== 'preview' && displayW > 0 && (
            <canvas
              ref={canvasRef}
              width={displayW}
              height={displayH}
              style={{
                display: 'block',
                maxWidth: '100%',
                cursor: phase === 'drawing' ? 'crosshair' : 'default',
                opacity: phase === 'processing' ? 0.5 : 1,
              }}
              onClick={phase === 'drawing' ? handleClick : undefined}
              onDoubleClick={phase === 'drawing' ? handleDoubleClick : undefined}
              onMouseMove={phase === 'drawing' ? handleMouseMove : undefined}
              onMouseLeave={() => { setCursor(null); nearFirst.current = false; }}
            />
          )}

          {phase === 'preview' && resultUrl && (
            <div className="object-crop-preview">
              <img src={resultUrl} style={{ maxWidth: '100%', maxHeight: MAX_H, display: 'block' }} alt="Result" />
            </div>
          )}

          <p className="form-note" style={{ marginTop: 8 }}>{hint}</p>

          {phase === 'processing' && (
            <div className="bg-removal-progress">
              <div className="bg-removal-spinner" />
            </div>
          )}
        </div>

        <div className="modal-footer">
          {phase === 'drawing' && (
            <>
              <button className="btn" onClick={onCancel}>Cancel</button>
              {points.length > 0 && (
                <button className="btn" onClick={() => setPoints(p => p.slice(0, -1))}>
                  Undo
                </button>
              )}
              {points.length >= 3 && (
                <button className="btn btn-primary" onClick={closePolygon}>
                  Close Shape
                </button>
              )}
            </>
          )}

          {phase === 'closed' && (
            <>
              <button className="btn" onClick={handleRedraw}>Redraw</button>
              <button className="btn" onClick={() => processAndPreview(false)}>Use Selection</button>
              <button className="btn btn-primary" onClick={() => processAndPreview(true)}>Remove Background</button>
            </>
          )}

          {phase === 'processing' && (
            <button className="btn" disabled>Processing…</button>
          )}

          {phase === 'preview' && (
            <>
              <button className="btn" onClick={handleRedraw}>Redraw</button>
              <button className="btn btn-primary" onClick={() => resultUrl && onSave(resultUrl)}>
                Use This
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

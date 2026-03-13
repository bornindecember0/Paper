import { useRef, useState, useEffect, useCallback } from 'react';
import { removeBackground } from '@imgly/background-removal';

interface CropRect { x: number; y: number; w: number; h: number; }

interface Props {
  imageUrl: string;
  isObject?: boolean;
  onSave: (croppedUrl: string) => void;
  onSkip: () => void;
}

const MAX_W = 560;
const MAX_H = 400;

export function CropModal({ imageUrl, isObject = false, onSave, onSkip }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [displayW, setDisplayW] = useState(0);
  const [displayH, setDisplayH] = useState(0);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);
  const [removeBg, setRemoveBg] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImgEl(img);
      const scale = Math.min(MAX_W / img.naturalWidth, MAX_H / img.naturalHeight, 1);
      const dw = Math.round(img.naturalWidth * scale);
      const dh = Math.round(img.naturalHeight * scale);
      setDisplayW(dw);
      setDisplayH(dh);
      setCrop({ x: 0, y: 0, w: dw, h: dh });
    };
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgEl || !displayW || !displayH) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, displayW, displayH);
    ctx.drawImage(imgEl, 0, 0, displayW, displayH);
    if (crop) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, displayW, crop.y);
      ctx.fillRect(0, crop.y + crop.h, displayW, displayH - crop.y - crop.h);
      ctx.fillRect(0, crop.y, crop.x, crop.h);
      ctx.fillRect(crop.x + crop.w, crop.y, displayW - crop.x - crop.w, crop.h);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(crop.x + 0.5, crop.y + 0.5, crop.w - 1, crop.h - 1);
      const hs = 8;
      ctx.fillStyle = '#fff';
      for (const [cx, cy] of [
        [crop.x, crop.y], [crop.x + crop.w, crop.y],
        [crop.x, crop.y + crop.h], [crop.x + crop.w, crop.y + crop.h],
      ]) {
        ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
      }
    }
  }, [imgEl, displayW, displayH, crop]);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const getPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: clamp(e.clientX - rect.left, 0, displayW), y: clamp(e.clientY - rect.top, 0, displayH) };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pos = getPos(e);
    dragRef.current = { startX: pos.x, startY: pos.y };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const pos = getPos(e);
    const { startX, startY } = dragRef.current;
    setCrop({
      x: Math.min(startX, pos.x),
      y: Math.min(startY, pos.y),
      w: Math.max(4, Math.abs(pos.x - startX)),
      h: Math.max(4, Math.abs(pos.y - startY)),
    });
  };

  const handleMouseUp = () => { dragRef.current = null; };

  const applyCropToBlob = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      if (!imgEl || !crop) return reject(new Error('No image or crop'));
      const scaleX = imgEl.naturalWidth / displayW;
      const scaleY = imgEl.naturalHeight / displayH;
      const nc = {
        x: Math.round(crop.x * scaleX),
        y: Math.round(crop.y * scaleY),
        w: Math.max(1, Math.round(crop.w * scaleX)),
        h: Math.max(1, Math.round(crop.h * scaleY)),
      };
      const off = document.createElement('canvas');
      off.width = nc.w; off.height = nc.h;
      off.getContext('2d')!.drawImage(imgEl, nc.x, nc.y, nc.w, nc.h, 0, 0, nc.w, nc.h);
      off.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create blob'));
      }, 'image/png');
    });
  }, [imgEl, crop, displayW, displayH]);

  const handleSave = useCallback(async () => {
    if (!imgEl || !crop) return;
    setProcessing(true);
    setProcessingProgress(0);
    try {
      const croppedBlob = await applyCropToBlob();
      let finalBlob = croppedBlob;
      if (removeBg) {
        finalBlob = await removeBackground(croppedBlob, {
          progress: (_key: string, current: number, total: number) => {
            setProcessingProgress(total > 0 ? Math.round((current / total) * 100) : 0);
          },
        });
      }
      onSave(URL.createObjectURL(finalBlob));
    } finally {
      setProcessing(false);
    }
  }, [imgEl, crop, removeBg, applyCropToBlob, onSave]);

  const handleSkip = useCallback(async () => {
    if (!removeBg) { onSkip(); return; }
    setProcessing(true);
    setProcessingProgress(0);
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const finalBlob = await removeBackground(blob, {
        progress: (_key: string, current: number, total: number) => {
          setProcessingProgress(total > 0 ? Math.round((current / total) * 100) : 0);
        },
      });
      onSave(URL.createObjectURL(finalBlob));
    } finally {
      setProcessing(false);
    }
  }, [removeBg, imageUrl, onSkip, onSave]);

  return (
    <div className="modal-backdrop">
      <div className="modal crop-modal">
        <div className="modal-title">Crop Image</div>
        <div className="crop-body">
          {displayW > 0 && (
            <canvas
              ref={canvasRef}
              width={displayW}
              height={displayH}
              style={{ cursor: processing ? 'default' : 'crosshair', display: 'block', maxWidth: '100%', opacity: processing ? 0.5 : 1 }}
              onMouseDown={processing ? undefined : handleMouseDown}
              onMouseMove={processing ? undefined : handleMouseMove}
              onMouseUp={processing ? undefined : handleMouseUp}
            />
          )}
          <p className="form-note" style={{ marginTop: 8 }}>
            Drag to select crop area
          </p>

          {isObject && (
            <label className="bg-removal-toggle">
              <input
                type="checkbox"
                checked={removeBg}
                onChange={e => setRemoveBg(e.target.checked)}
                disabled={processing}
              />
              <span>Remove background</span>
              <span className="bg-removal-note">(runs locally in browser)</span>
            </label>
          )}

          {processing && (
            <div className="bg-removal-progress">
              <div className="bg-removal-spinner" />
              <span>
                {processingProgress > 0
                  ? `Removing background… ${processingProgress}%`
                  : 'Removing background…'}
              </span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={handleSkip} disabled={processing}>
            Use Full Image
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!crop || processing}>
            Save Crop
          </button>
        </div>
      </div>
    </div>
  );
}

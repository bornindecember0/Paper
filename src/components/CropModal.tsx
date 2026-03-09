import { useRef, useState, useEffect, useCallback } from 'react';

interface CropRect { x: number; y: number; w: number; h: number; }

interface Props {
  imageUrl: string;
  onSave: (croppedUrl: string) => void;
  onSkip: () => void;
}

const MAX_W = 560;
const MAX_H = 420;

export function CropModal({ imageUrl, onSave, onSkip }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [displayW, setDisplayW] = useState(0);
  const [displayH, setDisplayH] = useState(0);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);

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

  const handleSave = useCallback(() => {
    if (!imgEl || !crop) return;
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
    off.toBlob(blob => { if (blob) onSave(URL.createObjectURL(blob)); }, 'image/png');
  }, [imgEl, crop, displayW, displayH, onSave]);

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
              style={{ cursor: 'crosshair', display: 'block', maxWidth: '100%' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
            />
          )}
          <p className="form-note" style={{ marginTop: 8 }}>
            Drag to select crop area
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onSkip}>Use Full Image</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!crop}>
            Save Crop
          </button>
        </div>
      </div>
    </div>
  );
}

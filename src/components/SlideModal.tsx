import { useState } from 'react';
import type { CanvasObject } from '../types';

export type PullDirection = 'up' | 'down' | 'left' | 'right';

interface Props {
  objects: CanvasObject[];
  selectedId: string;
  onConfirm: (pullDirection: PullDirection, beforeObjectId: string, afterObjectId: string) => void;
  onCancel: () => void;
}

export function pullDirectionToAxis(dir: PullDirection): 'horizontal' | 'vertical' {
  return dir === 'left' || dir === 'right' ? 'horizontal' : 'vertical';
}

// pull=down/right → strip starts off bottom/right edge → range is negative
// pull=up/left    → strip starts off top/left edge     → range is positive
export function pullDirectionToRangeSign(dir: PullDirection): number {
  return dir === 'down' || dir === 'right' ? -1 : 1;
}

export function SlideModal({ objects, selectedId, onConfirm, onCancel }: Props) {
  const existing = objects.find(o => o.id === selectedId)?.movement?.type === 'slide'
    ? objects.find(o => o.id === selectedId)!.movement as import('../types').SlideMovement
    : null;
  const [pullDirection, setPullDirection] = useState<PullDirection>(existing?.pullDirection ?? 'down');
  const [beforeId, setBeforeId] = useState<string>(selectedId);
  const [afterId, setAfterId] = useState<string>(
    existing?.secondObjectId ?? objects.find(o => o.id !== selectedId)?.id ?? '',
  );

  const canApply = beforeId !== '' && afterId !== '' && beforeId !== afterId;
  const axisLabel = pullDirectionToAxis(pullDirection) === 'vertical'
    ? 'vertical slider (strip moves up/down)'
    : 'horizontal slider (strip moves left/right)';

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Slide</div>
        <div className="modal-body">

          <div className="form-row">
            <span className="form-label">Pull Direction :</span>
            <select className="select-input" value={pullDirection}
              onChange={e => setPullDirection(e.target.value as PullDirection)}>
              <option value="down">Down (tab starts below canvas)</option>
              <option value="up">Up (tab starts above canvas)</option>
              <option value="right">Right (tab starts right of canvas)</option>
              <option value="left">Left (tab starts left of canvas)</option>
            </select>
          </div>
          <p className="form-note" style={{ marginBottom: 4 }}>↕ {axisLabel}</p>

          <div className="form-row">
            <span className="form-label">Before Image :</span>
            <select className="select-input" value={beforeId}
              onChange={e => setBeforeId(e.target.value)}>
              {objects.map((o, i) => (
                <option key={o.id} value={o.id}>Object #{i + 1} — {o.filename}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <span className="form-label">After Image :</span>
            <select className="select-input" value={afterId}
              onChange={e => setAfterId(e.target.value)}>
              <option value="">— select —</option>
              {objects.map((o, i) => (
                <option key={o.id} value={o.id}>Object #{i + 1} — {o.filename}</option>
              ))}
            </select>
          </div>

          <SliderDiagram direction={pullDirection} />

          {beforeId === afterId && beforeId !== '' && (
            <p className="form-note" style={{ color: '#c00' }}>
              Before and After images must be different objects.
            </p>
          )}
          <p className="form-note">*The Before image's position &amp; size define the window cut in the background.*</p>
          <p className="form-note">*Both images are cropped to the Before image's size on the strip.*</p>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!canApply}
            onClick={() => canApply && onConfirm(pullDirection, beforeId, afterId)}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function SliderDiagram({ direction }: { direction: PullDirection }) {
  const isVertical = pullDirectionToAxis(direction) === 'vertical';
  const canvasW = 150; const canvasH = 120;
  const stripColor = '#7bb6d4'; const bgColor = '#d4d4d4'; const tabColor = '#a0c8e8';
  const windowW = isVertical ? 50 : canvasW;
  const windowH = isVertical ? canvasH : 40;
  const tabSize = 20;
  const winX = isVertical ? (canvasW - windowW) / 2 : 0;
  const winY = isVertical ? 0 : (canvasH - windowH) / 2;

  let tabX = 0, tabY = 0, tabW = 0, tabH = 0;
  let ax1 = 0, ay1 = 0, ax2 = 0, ay2 = 0;
  if (direction === 'down') {
    tabX = winX; tabY = canvasH; tabW = windowW; tabH = tabSize;
    ax1 = winX + windowW / 2; ay1 = canvasH + tabSize * 0.3; ax2 = ax1; ay2 = canvasH + tabSize * 0.9;
  } else if (direction === 'up') {
    tabX = winX; tabY = -tabSize; tabW = windowW; tabH = tabSize;
    ax1 = winX + windowW / 2; ay1 = -tabSize * 0.3; ax2 = ax1; ay2 = -tabSize * 0.9;
  } else if (direction === 'right') {
    tabX = canvasW; tabY = winY; tabW = tabSize; tabH = windowH;
    ax1 = canvasW + tabSize * 0.3; ay1 = winY + windowH / 2; ax2 = canvasW + tabSize * 0.9; ay2 = ay1;
  } else {
    tabX = -tabSize; tabY = winY; tabW = tabSize; tabH = windowH;
    ax1 = -tabSize * 0.3; ay1 = winY + windowH / 2; ax2 = -tabSize * 0.9; ay2 = ay1;
  }

  const offsetX = direction === 'left' ? tabSize : 0;
  const offsetY = direction === 'up' ? tabSize : 0;
  const totalW = canvasW + (direction === 'left' || direction === 'right' ? tabSize : 0);
  const totalH = canvasH + (direction === 'up' || direction === 'down' ? tabSize : 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '8px 0' }}>
      <p style={{ fontSize: 16, color: '#666', margin: '0 0 10px' }}>Slider construction diagram</p>
      <svg width={totalW + 4} height={totalH + 4} style={{ overflow: 'visible' }}
        viewBox={`${-offsetX - 2} ${-offsetY - 2} ${totalW + 4} ${totalH + 4}`}>
        <rect x={0} y={0} width={canvasW} height={canvasH} fill={bgColor} stroke="#999" strokeWidth={1} />
        <rect x={winX} y={winY} width={windowW} height={windowH} fill={stripColor} stroke="#5a9fc0" strokeWidth={1} />
        {isVertical ? (
          <>
            <text x={winX + windowW / 2} y={winY + windowH * 0.28} textAnchor="middle" fontSize={12} fill="#fff">{direction === 'down' ? 'After' : 'Before'}</text>
            <text x={winX + windowW / 2} y={winY + windowH * 0.72} textAnchor="middle" fontSize={12} fill="#fff">{direction === 'down' ? 'Before' : 'After'}</text>
            <line x1={winX} y1={winY + windowH / 2} x2={winX + windowW} y2={winY + windowH / 2} stroke="#5a9fc0" strokeWidth={1} strokeDasharray="3,2" />
          </>
        ) : (
          <>
            <text x={winX + windowW * 0.25} y={winY + windowH / 2 + 3} textAnchor="middle" fontSize={12} fill="#fff">{direction === 'right' ? 'After' : 'Before'}</text>
            <text x={winX + windowW * 0.75} y={winY + windowH / 2 + 3} textAnchor="middle" fontSize={12} fill="#fff">{direction === 'right' ? 'Before' : 'After'}</text>
            <line x1={winX + windowW / 2} y1={winY} x2={winX + windowW / 2} y2={winY + windowH} stroke="#5a9fc0" strokeWidth={1} strokeDasharray="3,2" />
          </>
        )}
        <rect x={tabX} y={tabY} width={tabW} height={tabH} fill={tabColor} stroke="#5a9fc0" strokeWidth={1} />
        <text x={tabX + tabW / 2} y={tabY + tabH / 2 + 3} textAnchor="middle" fontSize={7} fill="#336">tab</text>
        <defs><marker id="ah" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#444" /></marker></defs>
        <line x1={ax1} y1={ay1} x2={ax2} y2={ay2} stroke="#444" strokeWidth={1} markerEnd="url(#ah)" />
      </svg>
    </div>
  );
}
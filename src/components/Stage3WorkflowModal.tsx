import { useEffect, useRef, useState } from "react";
import { CANVAS_H, CANVAS_W } from "./CanvasArea";
import type { CanvasObject, Position } from "../types";
import type {
  CompactMask,
  Stage3Annotation,
  Stage3ImageAsset,
  Stage3ObjectResult,
  Stage3PipelineResult,
} from "../stage3Pipeline";
import {
  buildCleanBackgroundPlateUrl,
  buildMaskedObjectUrl,
  finalizeStage3Pipeline,
  inferStage3Object,
  segmentImageAtPoint,
} from "../stage3Pipeline";
import { pullDirectionToAxis, pullDirectionToRangeSign } from "./SlideModal";
import {
  fallbackSegmenterStatus,
  fetchSamHealth,
  samStatusFromHealth,
  segmentWithSam,
  type SamPromptPoint,
  type SegmenterStatus,
} from "../samClient";

const FALLBACK_MASK_TOLERANCE = 42;

interface DraftMaskState {
  points: SamPromptPoint[];
  mask: CompactMask | null;
}

type PointMode = "positive" | "negative";

type DraftState =
  | { step: "idle" }
  | { step: "pickA"; selection: DraftMaskState }
  | { step: "confirmRelation"; pointA: Position; maskA: CompactMask; pointsA: SamPromptPoint[] }
  | { step: "pickBPoint"; pointA: Position; maskA: CompactMask; pointsA: SamPromptPoint[] }
  | { step: "pickBMask"; pointA: Position; maskA: CompactMask; pointsA: SamPromptPoint[]; selection: DraftMaskState };

interface Props {
  initialImageA?: { url: string; filename: string } | null;
  onClose: () => void;
  onImport: (payload: {
    backgroundUrl: string;
    bgFilename: string;
    objects: CanvasObject[];
    pipeline: Stage3PipelineResult;
  }) => void;
}

interface LoadedAsset extends Stage3ImageAsset {
  image: HTMLImageElement;
}

interface Stage3RenderItem {
  id: string;
  label: string;
  mask?: CompactMask;
  point?: Position;
  color: string;
}

function createMaskedLayerCanvas(image: HTMLImageElement, mask: CompactMask): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sctx = source.getContext("2d");
  if (!sctx) return canvas;
  sctx.drawImage(image, 0, 0);
  const crop = sctx.getImageData(mask.x, mask.y, mask.width, mask.height);
  const patch = ctx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i += 1) {
    if (!mask.data[i]) continue;
    const offset = i * 4;
    patch.data[offset] = crop.data[offset];
    patch.data[offset + 1] = crop.data[offset + 1];
    patch.data[offset + 2] = crop.data[offset + 2];
    patch.data[offset + 3] = 255;
  }
  ctx.putImageData(patch, mask.x, mask.y);
  return canvas;
}

function buildDraftPointItems(prefix: string, points: SamPromptPoint[], positiveColor: string, negativeColor: string): Stage3RenderItem[] {
  return points.map((point, index) => ({
    id: `${prefix}-${index}`,
    label: `${point.label === 1 ? "+" : "-"}${index + 1}`,
    point: point.position,
    color: point.label === 1 ? positiveColor : negativeColor,
  }));
}

function getFirstPositivePoint(points: SamPromptPoint[]): Position | null {
  return points.find((point) => point.label === 1)?.position ?? null;
}

function mergeMasks(masks: CompactMask[]): CompactMask | null {
  if (masks.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  const points = new Set<string>();

  for (const mask of masks) {
    for (let y = 0; y < mask.height; y += 1) {
      for (let x = 0; x < mask.width; x += 1) {
        if (!mask.data[y * mask.width + x]) continue;
        const px = mask.x + x;
        const py = mask.y + y;
        const key = `${px},${py}`;
        if (points.has(key)) continue;
        points.add(key);
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
        area += 1;
        sumX += px;
        sumY += py;
      }
    }
  }

  if (points.size === 0) return null;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const data = new Uint8Array(width * height);
  for (const key of points) {
    const [xs, ys] = key.split(",");
    const px = Number(xs);
    const py = Number(ys);
    data[(py - minY) * width + (px - minX)] = 1;
  }
  return {
    x: minX,
    y: minY,
    width,
    height,
    area,
    center: {
      x: sumX / area,
      y: sumY / area,
    },
    data,
  };
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function fitSize(width: number, height: number, maxW: number, maxH: number) {
  const scale = Math.min(maxW / width, maxH / height, 1);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function loadAsset(url: string, filename: string): Promise<LoadedAsset> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        url,
        filename,
        width: image.naturalWidth,
        height: image.naturalHeight,
        image,
      });
    image.onerror = () => reject(new Error(`Failed to load ${filename}`));
    image.src = url;
  });
}

function pointToCanvas(point: Position, displayW: number, displayH: number, asset: LoadedAsset): Position {
  return {
    x: (point.x / asset.width) * displayW,
    y: (point.y / asset.height) * displayH,
  };
}

function drawMaskOverlay(
  ctx: CanvasRenderingContext2D,
  mask: CompactMask,
  asset: LoadedAsset,
  displayW: number,
  displayH: number,
  fill: string,
) {
  const scaleX = displayW / asset.width;
  const scaleY = displayH / asset.height;
  const off = document.createElement("canvas");
  off.width = mask.width;
  off.height = mask.height;
  const offCtx = off.getContext("2d");
  if (!offCtx) return;
  const data = offCtx.createImageData(mask.width, mask.height);
  const rgb = fill === "#c75c5c" ? [199, 92, 92] : fill === "#3f7d5c" ? [63, 125, 92] : [37, 99, 235];
  for (let i = 0; i < mask.data.length; i += 1) {
    if (!mask.data[i]) continue;
    const offset = i * 4;
    data.data[offset] = rgb[0];
    data.data[offset + 1] = rgb[1];
    data.data[offset + 2] = rgb[2];
    data.data[offset + 3] = 110;
  }
  offCtx.putImageData(data, 0, 0);
  ctx.drawImage(
    off,
    mask.x * scaleX,
    mask.y * scaleY,
    mask.width * scaleX,
    mask.height * scaleY,
  );
  ctx.save();
  ctx.strokeStyle = fill;
  ctx.lineWidth = 2;
  ctx.strokeRect(
    mask.x * scaleX,
    mask.y * scaleY,
    Math.max(1, mask.width * scaleX),
    Math.max(1, mask.height * scaleY),
  );
  ctx.restore();
}

function Stage3ImageCanvas({
  title,
  asset,
  items,
  activeHint,
  onClick,
}: {
  title: string;
  asset: LoadedAsset | null;
  items: Stage3RenderItem[];
  activeHint: string;
  onClick?: (point: Position) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = asset ? fitSize(asset.width, asset.height, 480, 320) : { width: 480, height: 320 };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f1efe8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!asset) {
      ctx.fillStyle = "#8a877f";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Upload an image to begin", canvas.width / 2, canvas.height / 2);
      return;
    }

    ctx.drawImage(asset.image, 0, 0, canvas.width, canvas.height);
    for (const item of items) {
      if (item.mask) drawMaskOverlay(ctx, item.mask, asset, canvas.width, canvas.height, item.color);
    }
    for (const item of items) {
      if (!item.point) continue;
      const point = pointToCanvas(item.point, canvas.width, canvas.height, asset);
      ctx.save();
      ctx.fillStyle = item.color;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "#111";
      ctx.fillText(item.label, point.x + 10, point.y - 10);
      ctx.restore();
    }
  }, [asset, items, size.height, size.width]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!asset || !onClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * asset.width;
    const y = ((e.clientY - rect.top) / rect.height) * asset.height;
    onClick({ x, y });
  };

  return (
    <div className="stage3-canvas-card">
      <div className="stage3-canvas-head">
        <span>{title}</span>
        <span className="stage3-canvas-hint">{activeHint}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={size.width}
        height={size.height}
        className={`stage3-canvas ${onClick && asset ? "is-clickable" : ""}`}
        onClick={handleClick}
      />
    </div>
  );
}

function OptimizationPreviewCanvas({
  imageA,
  imageB,
  maskA,
  pointB,
  type,
  dx,
  dy,
  anchor,
  thetaDeg,
}: {
  imageA: HTMLImageElement;
  imageB: HTMLImageElement;
  maskA: CompactMask;
  pointB: Position;
  type: "transition" | "rotation";
  dx?: number;
  dy?: number;
  anchor?: Position;
  thetaDeg?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = 240;
    const height = 140;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    const scaleX = width / imageB.naturalWidth;
    const scaleY = height / imageB.naturalHeight;
    const maskedLayer = createMaskedLayerCanvas(imageA, maskA);

    ctx.drawImage(imageB, 0, 0, width, height);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.scale(scaleX, scaleY);
    if (type === "transition") {
      ctx.translate(dx ?? 0, dy ?? 0);
      ctx.globalAlpha = 0.82;
      ctx.drawImage(maskedLayer, 0, 0);
    } else {
      const pivot = anchor ?? maskA.center;
      ctx.translate(pivot.x, pivot.y);
      ctx.rotate(((thetaDeg ?? 0) * Math.PI) / 180);
      ctx.translate(-pivot.x, -pivot.y);
      ctx.globalAlpha = 0.82;
      ctx.drawImage(maskedLayer, 0, 0);
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pointB.x * scaleX, pointB.y * scaleY, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    if (type === "rotation" && anchor) {
      ctx.save();
      ctx.fillStyle = "#fde68a";
      ctx.beginPath();
      ctx.arc(anchor.x * scaleX, anchor.y * scaleY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }, [anchor, dx, dy, imageA, imageB, maskA, pointB, thetaDeg, type]);

  return <canvas ref={canvasRef} className="stage3-candidate-canvas" />;
}

function OptimizationPreviewGallery({
  result,
  annotation,
  imageA,
  imageB,
}: {
  result: Stage3ObjectResult;
  annotation: Stage3Annotation;
  imageA: HTMLImageElement;
  imageB: HTMLImageElement;
}) {
  if (!result.optimization || result.optimization.kind !== "comparison") return null;
  const { translation, rotation, winner } = result.optimization;
  return (
    <div className="stage3-candidate-grid">
      <div className={`stage3-candidate-card ${winner === "transition" ? "is-winner" : ""}`}>
        <div className="stage3-candidate-head">
          <strong>Translation</strong>
          <span>{winner === "transition" ? "Winner" : "Candidate"}</span>
        </div>
        <OptimizationPreviewCanvas
          imageA={imageA}
          imageB={imageB}
          maskA={annotation.maskA}
          pointB={result.pointB}
          type="transition"
          dx={translation.dx}
          dy={translation.dy}
        />
        <div className="stage3-candidate-metrics">
          <div>image loss: {translation.imageMatchCost.toFixed(2)}</div>
          <div>total: {translation.totalCost.toFixed(2)}</div>
        </div>
      </div>

      <div className={`stage3-candidate-card ${winner === "rotation" ? "is-winner" : ""}`}>
        <div className="stage3-candidate-head">
          <strong>Rotation</strong>
          <span>{winner === "rotation" ? "Winner" : "Candidate"}</span>
        </div>
        <OptimizationPreviewCanvas
          imageA={imageA}
          imageB={imageB}
          maskA={annotation.maskA}
          pointB={result.pointB}
          type="rotation"
          anchor={rotation.anchor}
          thetaDeg={rotation.thetaDeg}
        />
        <div className="stage3-candidate-metrics">
          <div>image loss: {rotation.imageMatchCost.toFixed(2)}</div>
          <div>total: {rotation.totalCost.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}

export function Stage3WorkflowModal({ initialImageA = null, onClose, onImport }: Props) {
  const imageAInputRef = useRef<HTMLInputElement>(null);
  const imageBInputRef = useRef<HTMLInputElement>(null);
  const [imageA, setImageA] = useState<LoadedAsset | null>(null);
  const [imageB, setImageB] = useState<LoadedAsset | null>(null);
  const [draft, setDraft] = useState<DraftState>({ step: "idle" });
  const [annotations, setAnnotations] = useState<Stage3Annotation[]>([]);
  const [results, setResults] = useState<Stage3ObjectResult[]>([]);
  const [pipeline, setPipeline] = useState<Stage3PipelineResult | null>(null);
  const [status, setStatus] = useState<string>("Upload Image A and Image B, then start marking objects.");
  const [segmenterStatus, setSegmenterStatus] = useState<SegmenterStatus>(fallbackSegmenterStatus());
  const [segmenting, setSegmenting] = useState(false);
  const [pointMode, setPointMode] = useState<PointMode>("positive");

  useEffect(() => {
    return () => {
      if (imageA?.url && imageA.url !== initialImageA?.url) URL.revokeObjectURL(imageA.url);
      if (imageB?.url) URL.revokeObjectURL(imageB.url);
    };
  }, [imageA, imageB, initialImageA]);

  useEffect(() => {
    let cancelled = false;
    fetchSamHealth()
      .then((health) => {
        if (!cancelled) setSegmenterStatus(samStatusFromHealth(health));
      })
      .catch(() => {
        if (!cancelled) setSegmenterStatus(fallbackSegmenterStatus());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!initialImageA) return;
    loadAsset(initialImageA.url, initialImageA.filename)
      .then((asset) => {
        if (!cancelled) {
          setImageA(asset);
          setStatus("Image A loaded from the current canvas. Add Image B to start Stage 3.");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("Could not preload Image A. Please upload it again.");
      });
    return () => {
      cancelled = true;
    };
  }, [initialImageA]);

  const updatePipeline = (nextResults: Stage3ObjectResult[]) => {
    setResults(nextResults);
    if (imageA && imageB && nextResults.length > 0) {
      setPipeline(finalizeStage3Pipeline(imageA, imageB, nextResults));
    } else {
      setPipeline(null);
    }
  };

  const handleUpload = async (file: File, which: "A" | "B") => {
    const asset = await loadAsset(URL.createObjectURL(file), file.name);
    if (which === "A" && imageA?.url && imageA.url !== initialImageA?.url) {
      URL.revokeObjectURL(imageA.url);
    }
    if (which === "B" && imageB?.url) {
      URL.revokeObjectURL(imageB.url);
    }
    setAnnotations([]);
    setResults([]);
    setPipeline(null);
    setDraft({ step: "idle" });
    if (which === "A") {
      setImageA(asset);
      setStatus("Image A ready. Upload Image B or start adding objects.");
    } else {
      setImageB(asset);
      setStatus("Both images are ready. Click 'Add object' to start point selection.");
    }
  };

  const resetDraft = () => {
    setDraft({ step: "idle" });
    setPointMode("positive");
  };

  const beginObject = () => {
    if (!imageA || !imageB) {
      setStatus("Please upload both images before adding an object.");
      return;
    }
    setDraft({ step: "pickA", selection: { points: [], mask: null } });
    setPointMode("positive");
    setStatus("Click one or more points on the object in Image A, then confirm the mask.");
  };

  const segmentAtPoints = async (image: HTMLImageElement, points: SamPromptPoint[]): Promise<CompactMask | null> => {
    const positivePoints = points.filter((point) => point.label === 1);
    if (positivePoints.length === 0) return null;
    if (segmenterStatus.provider === "sam") {
      try {
        return await segmentWithSam(image, points);
      } catch {
        setSegmenterStatus(fallbackSegmenterStatus());
      }
    }
    const positiveMask = mergeMasks(
      positivePoints
        .map((point) => segmentImageAtPoint(image, point.position, FALLBACK_MASK_TOLERANCE))
        .filter((mask): mask is CompactMask => !!mask),
    );
    if (!positiveMask) return null;
    const negativeMasks = points
      .filter((point) => point.label === 0)
      .map((point) => segmentImageAtPoint(image, point.position, FALLBACK_MASK_TOLERANCE))
      .filter((mask): mask is CompactMask => !!mask);
    if (negativeMasks.length === 0) return positiveMask;

    const blocked = new Set<string>();
    for (const mask of negativeMasks) {
      for (let y = 0; y < mask.height; y += 1) {
        for (let x = 0; x < mask.width; x += 1) {
          if (!mask.data[y * mask.width + x]) continue;
          blocked.add(`${mask.x + x},${mask.y + y}`);
        }
      }
    }

    const keptPoints: Position[] = [];
    for (let y = 0; y < positiveMask.height; y += 1) {
      for (let x = 0; x < positiveMask.width; x += 1) {
        if (!positiveMask.data[y * positiveMask.width + x]) continue;
        const px = positiveMask.x + x;
        const py = positiveMask.y + y;
        if (blocked.has(`${px},${py}`)) continue;
        keptPoints.push({ x: px, y: py });
      }
    }
    return mergeMasks(
      keptPoints.map((point) => ({
        x: point.x,
        y: point.y,
        width: 1,
        height: 1,
        area: 1,
        center: point,
        data: new Uint8Array([1]),
      })),
    );
  };

  const updateDraftSelection = async (
    image: HTMLImageElement,
    step: "pickA" | "pickBMask",
    point: Position,
  ) => {
    setSegmenting(true);
    const currentPoints = step === "pickA" && draft.step === "pickA"
      ? draft.selection.points
      : step === "pickBMask" && draft.step === "pickBMask"
        ? draft.selection.points
        : [];
    const nextPoints = currentPoints.concat({
      position: point,
      label: pointMode === "positive" ? 1 : 0,
    });
    const mask = await segmentAtPoints(image, nextPoints);
    setSegmenting(false);
    if (!mask) {
      setStatus("Could not build a stable mask from these prompts. Add a positive point on the object or undo the last point.");
      return;
    }
    if (step === "pickA" && draft.step === "pickA") {
      setDraft({
        step: "pickA",
        selection: { points: nextPoints, mask },
      });
      setStatus(`Image A mask updated with ${nextPoints.length} prompt(s). Confirm or keep refining.`);
    }
    if (step === "pickBMask" && draft.step === "pickBMask") {
      setDraft({
        ...draft,
        selection: { points: nextPoints, mask },
      });
      setStatus(`Image B mask updated with ${nextPoints.length} prompt(s). Confirm or keep refining.`);
    }
  };

  const handleClickA = async (point: Position) => {
    if (!imageA || draft.step !== "pickA") return;
    await updateDraftSelection(imageA.image, "pickA", point);
  };

  const finalizeObject = (annotation: Stage3Annotation) => {
    if (!imageA || !imageB) return;
    const result = inferStage3Object(annotation, imageA.image, imageB.image);
    const nextAnnotations = annotations.concat(annotation);
    const nextResults = results.concat(result);
    setAnnotations(nextAnnotations);
    updatePipeline(nextResults);
    resetDraft();
    setStatus(`Object ${nextResults.length} optimized as ${result.movement.type}. Add another object or import the JSON.`);
  };

  const handleClickB = async (point: Position) => {
    if (!imageB) return;
    if (draft.step === "pickBPoint") {
      finalizeObject({
        id: `object-${results.length + 1}`,
        pointA: draft.pointA,
        pointB: point,
        sameObject: true,
        maskA: draft.maskA,
      });
      return;
    }
    if (draft.step === "pickBMask") {
      await updateDraftSelection(imageB.image, "pickBMask", point);
    }
  };

  const chooseRelation = (sameObject: boolean) => {
    if (draft.step !== "confirmRelation") return;
    setPointMode("positive");
    setDraft(
      sameObject
        ? {
            step: "pickBPoint",
            pointA: draft.pointA,
            maskA: draft.maskA,
            pointsA: draft.pointsA,
          }
        : {
            step: "pickBMask",
            pointA: draft.pointA,
            maskA: draft.maskA,
            pointsA: draft.pointsA,
            selection: { points: [], mask: null },
          },
    );
    setStatus(
      sameObject
        ? "Click the same object anywhere in Image B."
        : "Click one or more points on the replacement object in Image B, then confirm the mask.",
    );
  };

  const confirmMaskA = () => {
    const pointA = draft.step === "pickA" ? getFirstPositivePoint(draft.selection.points) : null;
    if (draft.step !== "pickA" || !draft.selection.mask || !pointA) return;
    setDraft({
      step: "confirmRelation",
      pointA,
      maskA: draft.selection.mask,
      pointsA: draft.selection.points,
    });
    setStatus("Mask A confirmed. Is this the same object in Image B?");
  };

  const confirmMaskB = () => {
    const pointB = draft.step === "pickBMask" ? getFirstPositivePoint(draft.selection.points) : null;
    if (draft.step !== "pickBMask" || !draft.selection.mask || !pointB) return;
    finalizeObject({
      id: `object-${results.length + 1}`,
      pointA: draft.pointA,
      pointB,
      sameObject: false,
      maskA: draft.maskA,
      maskB: draft.selection.mask,
    });
  };

  const undoLastPoint = async () => {
    if (!imageA && !imageB) return;
    if (draft.step === "pickA") {
      setSegmenting(true);
      const nextPoints = draft.selection.points.slice(0, -1);
      const nextMask = imageA ? await segmentAtPoints(imageA.image, nextPoints) : null;
      setSegmenting(false);
      setDraft({ step: "pickA", selection: { points: nextPoints, mask: nextMask } });
      setStatus(nextPoints.length === 0 ? "Mask A points cleared." : `Mask A reverted to ${nextPoints.length} prompt(s).`);
      return;
    }
    if (draft.step === "pickBMask") {
      setSegmenting(true);
      const nextPoints = draft.selection.points.slice(0, -1);
      const nextMask = imageB ? await segmentAtPoints(imageB.image, nextPoints) : null;
      setSegmenting(false);
      setDraft({ ...draft, selection: { points: nextPoints, mask: nextMask } });
      setStatus(nextPoints.length === 0 ? "Mask B points cleared." : `Mask B reverted to ${nextPoints.length} prompt(s).`);
    }
  };

  const clearCurrentPoints = () => {
    if (draft.step === "pickA") {
      setDraft({ step: "pickA", selection: { points: [], mask: null } });
      setStatus("Mask A prompts cleared.");
      return;
    }
    if (draft.step === "pickBMask") {
      setDraft({ ...draft, selection: { points: [], mask: null } });
      setStatus("Mask B prompts cleared.");
    }
  };

  const buildImportObjects = (): CanvasObject[] | null => {
    if (!pipeline || !imageA) return null;
    const scaleX = CANVAS_W / imageA.width;
    const scaleY = CANVAS_H / imageA.height;
    const imported: Array<{ layer: number; order: number; object: CanvasObject }> = [];

    for (let i = 0; i < pipeline.objects.length; i += 1) {
      const item = pipeline.objects[i];
      const sourceAnnotation = annotations.find((entry) => entry.id === item.id);
      if (!sourceAnnotation) continue;

      const primaryId = uid("obj");
      const primaryUrl = buildMaskedObjectUrl(imageA.image, sourceAnnotation.maskA);
      const center = sourceAnnotation.maskA.center;
      const primary: CanvasObject = {
        id: primaryId,
        imageUrl: primaryUrl,
        filename: `${item.id}-A.png`,
        position: {
          x: center.x * scaleX,
          y: center.y * scaleY,
        },
        width: sourceAnnotation.maskA.width * scaleX,
        height: sourceAnnotation.maskA.height * scaleY,
        locked: true,
      };

      if (item.movement.type === "transition") {
        primary.movement = {
          type: "transition",
          endPoint: {
            x: primary.position.x + item.movement.dx * scaleX,
            y: primary.position.y + item.movement.dy * scaleY,
          },
        };
      }

      if (item.movement.type === "rotation") {
        primary.movement = {
          type: "rotation",
          anchorPoint: {
            x: (item.movement.anchor.x - center.x) * scaleX,
            y: (item.movement.anchor.y - center.y) * scaleY,
          },
          angleDeg: item.movement.thetaDeg,
        };
      }

      if (item.movement.type === "swapSlide" && sourceAnnotation.maskB && imageB) {
        const secondaryId = uid("obj");
        const secondaryUrl = buildMaskedObjectUrl(imageB.image, sourceAnnotation.maskB);
        const secondary: CanvasObject = {
          id: secondaryId,
          imageUrl: secondaryUrl,
          filename: `${item.id}-B.png`,
          position: {
            x: sourceAnnotation.maskB.center.x * scaleX,
            y: sourceAnnotation.maskB.center.y * scaleY,
          },
          width: sourceAnnotation.maskB.width * scaleX,
          height: sourceAnnotation.maskB.height * scaleY,
          locked: true,
        };
        primary.movement = {
          type: "slide",
          direction: pullDirectionToAxis(item.movement.pullDirection),
          pullDirection: item.movement.pullDirection,
          range:
            pullDirectionToRangeSign(item.movement.pullDirection) *
            (item.movement.direction === "vertical" ? CANVAS_H : CANVAS_W),
          secondObjectId: secondaryId,
        };
        imported.push({ layer: item.layer, order: i * 2 + 1, object: secondary });
      }

      imported.push({ layer: item.layer, order: i * 2, object: primary });
    }

    const sorted = imported
      .slice()
      .sort((a, b) => (a.layer !== b.layer ? a.layer - b.layer : a.order - b.order))
      .map((entry) => entry.object);

    return sorted;
  };

  const importIntoCanvas = () => {
    if (!imageA || !imageB || !pipeline) return;
    const objects = buildImportObjects();
    if (!objects) return;
    const backgroundUrl = buildCleanBackgroundPlateUrl(
      imageA.image,
      imageB.image,
      annotations,
      pipeline.objects,
    );
    const dot = imageA.filename.lastIndexOf(".");
    const stem = dot > 0 ? imageA.filename.slice(0, dot) : imageA.filename;
    onImport({
      backgroundUrl,
      bgFilename: `${stem}-clean.png`,
      objects,
      pipeline,
    });
  };

  const removeResult = (id: string) => {
    const nextAnnotations = annotations.filter((entry) => entry.id !== id);
    const nextResults = results.filter((entry) => entry.id !== id);
    setAnnotations(nextAnnotations);
    updatePipeline(nextResults);
    setStatus(nextResults.length === 0 ? "All Stage 3 objects were cleared." : "Object removed from the Stage 3 pipeline.");
  };

  const resetAll = () => {
    setAnnotations([]);
    setResults([]);
    setPipeline(null);
    setDraft({ step: "idle" });
    setStatus("Stage 3 annotations cleared. You can start marking objects again.");
  };

  const itemsA: Stage3RenderItem[] = results.map((result, index) => {
    const annotation = annotations.find((entry) => entry.id === result.id);
    return {
      id: result.id,
      label: `#${index + 1}`,
      mask: annotation?.maskA,
      point: result.pointA,
      color: "#2563eb",
    };
  });
  const itemsB: Stage3RenderItem[] = results.flatMap((result, index) => {
    const annotation = annotations.find((entry) => entry.id === result.id);
    if (!annotation) return [];
    const base: Stage3RenderItem[] = [
      {
        id: `${result.id}-point`,
        label: `#${index + 1}`,
        point: result.pointB,
        color: "#2563eb",
      },
    ];
    if (annotation.maskB) {
      base.push({
        id: `${result.id}-maskB`,
        label: `#${index + 1}`,
        mask: annotation.maskB,
        color: "#3f7d5c",
      });
    }
    return base;
  });

  if (draft.step === "pickA") {
    if (draft.selection.mask) {
      itemsA.push({
        id: "draft-a-mask",
        label: "draft",
        mask: draft.selection.mask,
        color: "#c75c5c",
      });
    }
    itemsA.push(...buildDraftPointItems("draft-a-point", draft.selection.points, "#c75c5c", "#8b5cf6"));
  }

  if (draft.step === "confirmRelation" || draft.step === "pickBPoint" || draft.step === "pickBMask") {
    itemsA.push({
      id: "draft-a",
      label: "draft",
      mask: draft.maskA,
      point: draft.pointA,
      color: "#c75c5c",
    });
    if ("pointsA" in draft) {
      itemsA.push(...buildDraftPointItems("draft-a-confirmed", draft.pointsA, "#c75c5c", "#8b5cf6"));
    }
  }

  if (draft.step === "pickBPoint") {
    itemsB.push({
      id: "draft-b-point",
      label: "pick B",
      color: "#c75c5c",
    });
  }

  if (draft.step === "pickBMask") {
    if (draft.selection.mask) {
      itemsB.push({
        id: "draft-b-mask",
        label: "draft",
        mask: draft.selection.mask,
        color: "#c75c5c",
      });
    }
    itemsB.push(...buildDraftPointItems("draft-b-point", draft.selection.points, "#c75c5c", "#8b5cf6"));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal stage3-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title stage3-modal-title">
          <span>Stage 3 Pipeline</span>
          <button className="fab-close" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="stage3-modal-body">
          <div className="stage3-main">
            <div className="stage3-toolbar">
              <div className="stage3-upload-group">
                <input
                  ref={imageAInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file, "A");
                    e.target.value = "";
                  }}
                />
                <input
                  ref={imageBInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file, "B");
                    e.target.value = "";
                  }}
                />
                <button className="btn" onClick={() => imageAInputRef.current?.click()}>
                  {imageA ? "Replace Image A" : "Upload Image A"}
                </button>
                <button className="btn" onClick={() => imageBInputRef.current?.click()}>
                  {imageB ? "Replace Image B" : "Upload Image B"}
                </button>
                <button className="btn btn-primary" onClick={beginObject} disabled={!imageA || !imageB || segmenting}>
                  Add object
                </button>
                {(draft.step === "pickA" || draft.step === "pickBMask") && (
                  <>
                    <button
                      className={`btn ${pointMode === "positive" ? "btn-primary" : ""}`}
                      onClick={() => setPointMode("positive")}
                      disabled={segmenting}
                    >
                      Positive
                    </button>
                    <button
                      className={`btn ${pointMode === "negative" ? "btn-primary" : ""}`}
                      onClick={() => setPointMode("negative")}
                      disabled={segmenting}
                    >
                      Negative
                    </button>
                  </>
                )}
                {(draft.step === "pickA" || draft.step === "pickBMask") && (
                  <button
                    className="btn"
                    onClick={undoLastPoint}
                    disabled={segmenting || draft.selection.points.length === 0}
                  >
                    Undo last point
                  </button>
                )}
                {(draft.step === "pickA" || draft.step === "pickBMask") && (
                  <button
                    className="btn"
                    onClick={clearCurrentPoints}
                    disabled={segmenting || draft.selection.points.length === 0}
                  >
                    Clear points
                  </button>
                )}
                {draft.step === "pickA" && (
                  <button
                    className="btn btn-primary"
                    onClick={confirmMaskA}
                    disabled={segmenting || !draft.selection.mask || draft.selection.points.length === 0}
                  >
                    Confirm mask A
                  </button>
                )}
                {draft.step === "pickBMask" && (
                  <button
                    className="btn btn-primary"
                    onClick={confirmMaskB}
                    disabled={segmenting || !draft.selection.mask || draft.selection.points.length === 0}
                  >
                    Confirm mask B
                  </button>
                )}
                <button className="btn" onClick={resetAll} disabled={results.length === 0 && draft.step === "idle"}>
                  Reset all
                </button>
                {draft.step !== "idle" && (
                  <button className="btn" onClick={resetDraft}>
                    Cancel draft
                  </button>
                )}
              </div>
            </div>

            <div className="stage3-status">
              {segmenting ? "Running segmentation..." : status}
            </div>
            <div className="stage3-provider">
              <strong>{segmenterStatus.label}</strong>
              <span>{segmenterStatus.detail}</span>
            </div>
            {(draft.step === "pickA" || draft.step === "pickBMask") && (
              <div className="stage3-provider">
                <strong>Prompt mode: {pointMode === "positive" ? "Positive" : "Negative"}</strong>
                <span>
                  Positive points grow the object. Negative points remove extra regions from the mask.
                </span>
              </div>
            )}

            {draft.step === "confirmRelation" && (
              <div className="stage3-question">
                <span>Does this object also appear in Image B?</span>
                <button className="btn btn-primary" onClick={() => chooseRelation(true)}>
                  Same object
                </button>
                <button className="btn" onClick={() => chooseRelation(false)}>
                  Different object
                </button>
              </div>
            )}

            <div className="stage3-canvases">
              <Stage3ImageCanvas
                title={imageA ? `Image A - ${imageA.filename}` : "Image A"}
                asset={imageA}
                items={itemsA}
                activeHint={
                  draft.step === "pickA"
                    ? `Click to add a ${pointMode} point to mask A`
                    : "Reference scene"
                }
                onClick={draft.step === "pickA" && !segmenting ? handleClickA : undefined}
              />
              <Stage3ImageCanvas
                title={imageB ? `Image B - ${imageB.filename}` : "Image B"}
                asset={imageB}
                items={itemsB}
                activeHint={
                  draft.step === "pickBPoint"
                    ? "Click same object"
                    : draft.step === "pickBMask"
                      ? `Click to add a ${pointMode} point to mask B`
                      : "Target scene"
                }
                onClick={(draft.step === "pickBPoint" || draft.step === "pickBMask") && !segmenting ? handleClickB : undefined}
              />
            </div>
          </div>

          <aside className="stage3-side">
            <div className="stage3-side-section">
              <div className="stage3-side-title">Motion Inference</div>
              {results.length === 0 && <p className="stage3-empty">No objects optimized yet.</p>}
              {results.map((result, index) => (
                <div key={result.id} className="stage3-result-card">
                  {(() => {
                    const annotation = annotations.find((entry) => entry.id === result.id);
                    return (
                      <>
                        <div className="stage3-result-head">
                          <strong>Object #{index + 1}</strong>
                          <div className="stage3-result-head-actions">
                            <span>Layer {pipeline?.objects.find((entry) => entry.id === result.id)?.layer ?? result.layer}</span>
                            <button className="btn-clear" onClick={() => removeResult(result.id)} title="Remove object">
                              ✕
                            </button>
                          </div>
                        </div>
                        <div className="stage3-result-type">{result.movement.type}</div>
                        <div className="stage3-result-summary">
                          {result.movement.type === "transition" && (
                            <span>
                              dx={result.movement.dx.toFixed(1)}, dy={result.movement.dy.toFixed(1)}, total={result.movement.totalCost.toFixed(2)}
                            </span>
                          )}
                          {result.movement.type === "rotation" && (
                            <span>
                              anchor=({result.movement.anchor.x}, {result.movement.anchor.y}), theta={result.movement.thetaDeg.toFixed(1)}deg, total={result.movement.totalCost.toFixed(2)}
                            </span>
                          )}
                          {result.movement.type === "swapSlide" && (
                            <span>
                              {result.movement.direction}, pull={result.movement.pullDirection}, distance={result.movement.distance.toFixed(1)}
                            </span>
                          )}
                        </div>
                        {annotation && imageA && imageB && (
                          <OptimizationPreviewGallery
                            result={result}
                            annotation={annotation}
                            imageA={imageA.image}
                            imageB={imageB.image}
                          />
                        )}
                        <div className="stage3-result-lines">
                          {result.logs.map((line) => (
                            <div key={`${result.id}-${line}`}>{line}</div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>

            <div className="stage3-side-section">
              <div className="stage3-side-title">Layer Assignment</div>
              {!pipeline || pipeline.assignmentLogs.length === 0 ? (
                <p className="stage3-empty">Layer assignment logs will appear after at least one object is optimized.</p>
              ) : (
                <div className="stage3-assignment-log">
                  {pipeline.assignmentLogs.map((line) => (
                    <div key={line} className="stage3-assignment-line">
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="stage3-side-section">
              <div className="stage3-side-title">JSON Preview</div>
              <div className="stage3-json">
                <pre>{pipeline ? JSON.stringify(pipeline, null, 2) : "{ }"}</pre>
              </div>
              {pipeline?.warnings.length ? (
                <div className="stage3-warnings">
                  {pipeline.warnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              ) : null}
              <button className="btn btn-primary stage3-import-btn" onClick={importIntoCanvas} disabled={!pipeline}>
                Import to Play Canvas
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

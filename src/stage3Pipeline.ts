import type { CanvasObject, Position } from "./types";
import type { PullDirection } from "./components/SlideModal";

export interface Stage3ImageAsset {
  url: string;
  filename: string;
  width: number;
  height: number;
}

export interface CompactMask {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  center: Position;
  data: Uint8Array;
}

export interface Stage3Annotation {
  id: string;
  pointA: Position;
  pointB: Position;
  sameObject: boolean;
  maskA: CompactMask;
  maskB?: CompactMask;
}

export interface MaskSummary {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  center: Position;
}

export interface Stage3MotionBase {
  imageMatchCost: number;
  totalCost: number;
}

export interface Stage3TransitionMotion extends Stage3MotionBase {
  type: "transition";
  dx: number;
  dy: number;
}

export interface Stage3RotationMotion extends Stage3MotionBase {
  type: "rotation";
  anchor: Position;
  thetaDeg: number;
  translationCost: number;
}

export interface Stage3SwapSlideMotion {
  type: "swapSlide";
  direction: "horizontal" | "vertical";
  pullDirection: PullDirection;
  distance: number;
}

export type Stage3Motion =
  | Stage3TransitionMotion
  | Stage3RotationMotion
  | Stage3SwapSlideMotion;

export interface Stage3ComparisonTrace {
  kind: "comparison";
  translation: Stage3TransitionMotion;
  rotation: Stage3RotationMotion;
  winner: "transition" | "rotation";
  anchorsTested: number;
  sampledPixels: number;
  complexityLambda: number;
}

export interface Stage3RuleTrace {
  kind: "rule";
  label: "swapSlide";
  reason: string;
}

export type Stage3OptimizationTrace = Stage3ComparisonTrace | Stage3RuleTrace;

export interface Stage3ObjectResult {
  id: string;
  maskA: MaskSummary;
  maskB?: MaskSummary;
  pointA: Position;
  pointB: Position;
  movement: Stage3Motion;
  optimization?: Stage3OptimizationTrace;
  logs: string[];
  layer: number;
  warnings: string[];
}

export interface Stage3PipelineResult {
  schemaVersion: 1;
  imageA: Pick<Stage3ImageAsset, "filename" | "width" | "height">;
  imageB: Pick<Stage3ImageAsset, "filename" | "width" | "height">;
  layerCount: number;
  objects: Stage3ObjectResult[];
  assignmentLogs: string[];
  warnings: string[];
}

export interface Stage3ImportObject {
  resultId: string;
  primary: CanvasObject;
  secondary?: CanvasObject;
}

export function getStage3SegmenterStatus(): {
  provider: "fallback";
  label: string;
  detail: string;
} {
  return {
    provider: "fallback",
    label: "Fallback Point Segmenter",
    detail:
      "No SAM model was found in this workspace, so point clicks currently use local region-growing segmentation.",
  };
}

const ROTATION_COMPLEXITY = 2;
const TRANSLATION_COMPLEXITY = 1;
const COMPLEXITY_LAMBDA = 12;
const ROTATION_ANCHOR_SAMPLES = 48;
const ROTATION_SWEEP_SAMPLES = 12;

interface RotationEvalResult {
  movement: Stage3RotationMotion;
  anchorsTested: number;
  sampledPixels: number;
}

interface EnvelopeObject {
  id: string;
  polygon: Position[];
  centerY: number;
  forceLowest: boolean;
}

interface ImageBuffers {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface PixelSource {
  data: Uint8ClampedArray;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function roundPoint(p: Position): Position {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

function rotatePoint(point: Position, anchor: Position, theta: number): Position {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: anchor.x + dx * cos - dy * sin,
    y: anchor.y + dx * sin + dy * cos,
  };
}

function convexHull(points: Position[]): Position[] {
  if (points.length <= 2) return points.slice();
  const sorted = points
    .slice()
    .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  const cross = (o: Position, a: Position, b: Position) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Position[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Position[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonAxes(poly: Position[]): Position[] {
  const axes: Position[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const edge = { x: b.x - a.x, y: b.y - a.y };
    const normal = { x: -edge.y, y: edge.x };
    const len = Math.hypot(normal.x, normal.y) || 1;
    axes.push({ x: normal.x / len, y: normal.y / len });
  }
  return axes;
}

function projectPolygon(poly: Position[], axis: Position): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p.x * axis.x + p.y * axis.y;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return [min, max];
}

function polygonsIntersect(a: Position[], b: Position[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const axes = polygonAxes(a).concat(polygonAxes(b));
  for (const axis of axes) {
    const [minA, maxA] = projectPolygon(a, axis);
    const [minB, maxB] = projectPolygon(b, axis);
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

function getPixelColor(buffers: ImageBuffers, x: number, y: number): [number, number, number] {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= buffers.width || iy >= buffers.height) {
    return [255, 255, 255];
  }
  const idx = (iy * buffers.width + ix) * 4;
  return [buffers.data[idx], buffers.data[idx + 1], buffers.data[idx + 2]];
}

function colorDiff(a: [number, number, number], b: [number, number, number]): number {
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
}

function maskSummary(mask: CompactMask): MaskSummary {
  return {
    x: mask.x,
    y: mask.y,
    width: mask.width,
    height: mask.height,
    area: mask.area,
    center: roundPoint(mask.center),
  };
}

function maskBoundsCorners(mask: CompactMask): Position[] {
  const left = mask.x;
  const top = mask.y;
  const right = mask.x + mask.width;
  const bottom = mask.y + mask.height;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

function sampleMaskPoints(mask: CompactMask, targetCount = 200): Position[] {
  const all: Position[] = [];
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[y * mask.width + x]) {
        all.push({ x: mask.x + x, y: mask.y + y });
      }
    }
  }
  if (all.length <= targetCount) return all;
  const stride = Math.max(1, Math.floor(all.length / targetCount));
  return all.filter((_, index) => index % stride === 0).slice(0, targetCount);
}

function sampleAnchorCandidates(mask: CompactMask): Position[] {
  const points = sampleMaskPoints(mask, ROTATION_ANCHOR_SAMPLES);
  const anchors = points.length > 0 ? points : [mask.center];
  return anchors.map(roundPoint);
}

function evaluateTranslation(
  annotation: Stage3Annotation,
  imageA: ImageBuffers,
  imageB: ImageBuffers,
): Stage3TransitionMotion {
  const dx = annotation.pointB.x - annotation.pointA.x;
  const dy = annotation.pointB.y - annotation.pointA.y;
  const points = sampleMaskPoints(annotation.maskA);
  let total = 0;
  for (const point of points) {
    const source = getPixelColor(imageA, point.x, point.y);
    const target = getPixelColor(imageB, point.x + dx, point.y + dy);
    total += colorDiff(source, target);
  }
  const imageMatchCost = points.length > 0 ? total / points.length : 255;
  return {
    type: "transition",
    dx,
    dy,
    imageMatchCost,
    totalCost: imageMatchCost + COMPLEXITY_LAMBDA * TRANSLATION_COMPLEXITY,
  };
}

function evaluateRotation(
  annotation: Stage3Annotation,
  imageA: ImageBuffers,
  imageB: ImageBuffers,
): RotationEvalResult {
  const anchors = sampleAnchorCandidates(annotation.maskA);
  const points = sampleMaskPoints(annotation.maskA);
  let best: Stage3RotationMotion | null = null;
  let anchorsTested = 0;

  for (const anchor of anchors) {
    const va = {
      x: annotation.pointA.x - anchor.x,
      y: annotation.pointA.y - anchor.y,
    };
    const vb = {
      x: annotation.pointB.x - anchor.x,
      y: annotation.pointB.y - anchor.y,
    };
    const lenA = Math.hypot(va.x, va.y);
    const lenB = Math.hypot(vb.x, vb.y);
    if (lenA < 2 || lenB < 2) continue;
    anchorsTested += 1;

    const theta = Math.atan2(vb.y, vb.x) - Math.atan2(va.y, va.x);
    let total = 0;
    for (const point of points) {
      const source = getPixelColor(imageA, point.x, point.y);
      const rotated = rotatePoint(point, anchor, theta);
      const target = getPixelColor(imageB, rotated.x, rotated.y);
      total += colorDiff(source, target);
    }
    const imageMatchCost = points.length > 0 ? total / points.length : 255;
    const candidate: Stage3RotationMotion = {
      type: "rotation",
      anchor,
      thetaDeg: (theta * 180) / Math.PI,
      imageMatchCost,
      translationCost: 0,
      totalCost: imageMatchCost + COMPLEXITY_LAMBDA * ROTATION_COMPLEXITY,
    };
    if (!best || candidate.totalCost < best.totalCost) {
      best = candidate;
    }
  }

  return {
    movement:
      best ?? {
        type: "rotation",
        anchor: roundPoint(annotation.maskA.center),
        thetaDeg: 0,
        imageMatchCost: 255,
        translationCost: 0,
        totalCost: 255 + COMPLEXITY_LAMBDA * ROTATION_COMPLEXITY,
      },
    anchorsTested,
    sampledPixels: points.length,
  };
}

function chooseSwapDirection(maskA: CompactMask, maskB: CompactMask): Stage3SwapSlideMotion {
  const dx = maskB.center.x - maskA.center.x;
  const dy = maskB.center.y - maskA.center.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      type: "swapSlide",
      direction: "horizontal",
      pullDirection: dx >= 0 ? "left" : "right",
      distance: Math.abs(dx),
    };
  }
  return {
    type: "swapSlide",
    direction: "vertical",
    pullDirection: dy >= 0 ? "up" : "down",
    distance: Math.abs(dy),
  };
}

function buildEnvelope(result: Stage3ObjectResult): EnvelopeObject {
  if (result.movement.type === "transition") {
    const dx = result.movement.dx;
    const dy = result.movement.dy;
    const start = maskBoundsCorners({
      ...result.maskA,
      data: new Uint8Array(0),
      center: result.maskA.center,
    } as CompactMask);
    const end = start.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    return {
      id: result.id,
      polygon: convexHull(start.concat(end)),
      centerY: result.maskA.center.y,
      forceLowest: false,
    };
  }

  if (result.movement.type === "rotation") {
    const corners = maskBoundsCorners({
      ...result.maskA,
      data: new Uint8Array(0),
      center: result.maskA.center,
    } as CompactMask);
    const theta = (result.movement.thetaDeg * Math.PI) / 180;
    const cloud: Position[] = [];
    for (let i = 0; i <= ROTATION_SWEEP_SAMPLES; i += 1) {
      const t = i / ROTATION_SWEEP_SAMPLES;
      const angle = theta * t;
      for (const corner of corners) {
        cloud.push(rotatePoint(corner, result.movement.anchor, angle));
      }
    }
    return {
      id: result.id,
      polygon: convexHull(cloud),
      centerY: result.maskA.center.y,
      forceLowest: false,
    };
  }

  const boxA = maskBoundsCorners({
    ...result.maskA,
    data: new Uint8Array(0),
    center: result.maskA.center,
  } as CompactMask);
  const boxB = result.maskB
    ? maskBoundsCorners({
        ...result.maskB,
        data: new Uint8Array(0),
        center: result.maskB.center,
      } as CompactMask)
    : boxA;
  return {
    id: result.id,
    polygon: convexHull(boxA.concat(boxB)),
    centerY: result.maskA.center.y,
    forceLowest: true,
  };
}

function assignLayers(results: Stage3ObjectResult[]): {
  layerCount: number;
  layers: Record<string, number>;
  assignmentLogs: string[];
} {
  const envelopes = results.map(buildEnvelope);
  const conflicts = new Map<string, Set<string>>();
  const assignmentLogs: string[] = [];
  for (const env of envelopes) {
    conflicts.set(env.id, new Set<string>());
  }
  for (let i = 0; i < envelopes.length; i += 1) {
    for (let j = i + 1; j < envelopes.length; j += 1) {
      if (polygonsIntersect(envelopes[i].polygon, envelopes[j].polygon)) {
        conflicts.get(envelopes[i].id)?.add(envelopes[j].id);
        conflicts.get(envelopes[j].id)?.add(envelopes[i].id);
      }
    }
  }

  if (envelopes.length === 0) {
    assignmentLogs.push("No objects were available for layer assignment.");
  } else {
    assignmentLogs.push(`Built motion envelopes for ${envelopes.length} object(s).`);
  }
  for (const env of envelopes) {
    const others = Array.from(conflicts.get(env.id) ?? []);
    assignmentLogs.push(
      `${env.id}: conflicts with ${others.length > 0 ? others.join(", ") : "no objects"}`,
    );
  }

  const sorted = envelopes.slice().sort((a, b) => {
    if (a.forceLowest !== b.forceLowest) return a.forceLowest ? -1 : 1;
    return a.centerY - b.centerY;
  });

  assignmentLogs.push(
    `Layer assignment order: ${sorted.map((env) => env.id).join(" -> ") || "none"}`,
  );

  const layers: Record<string, number> = {};
  for (const env of sorted) {
    let layer = env.forceLowest ? 0 : 0;
    while (true) {
      const blocked = Array.from(conflicts.get(env.id) ?? []).some(
        (otherId) => layers[otherId] === layer,
      );
      if (!blocked) break;
      layer += 1;
    }
    layers[env.id] = layer;
    assignmentLogs.push(
      `${env.id}: placed on layer ${layer}${env.forceLowest ? " (forced to lowest layer)" : ""}`,
    );
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const env of sorted) {
      const current = layers[env.id];
      for (let candidate = env.forceLowest ? 0 : 0; candidate < current; candidate += 1) {
        const blocked = Array.from(conflicts.get(env.id) ?? []).some(
          (otherId) => layers[otherId] === candidate,
        );
        if (!blocked) {
          assignmentLogs.push(
            `${env.id}: local search moved layer ${current} -> ${candidate}`,
          );
          layers[env.id] = candidate;
          changed = true;
          break;
        }
      }
    }
  }

  const layerCount = Object.values(layers).reduce((max, layer) => Math.max(max, layer + 1), 0);
  assignmentLogs.push(`Final layer count: ${layerCount}`);
  return { layerCount, layers, assignmentLogs };
}

function warningForObject(result: Stage3ObjectResult): string[] {
  const warnings: string[] = [];
  if (result.movement.type === "rotation") {
    const localX = result.movement.anchor.x - result.maskA.x;
    const localY = result.movement.anchor.y - result.maskA.y;
    const minEdge = Math.min(
      localX,
      localY,
      result.maskA.width - localX,
      result.maskA.height - localY,
    );
    if (minEdge < 8) warnings.push("Rotation anchor is close to the mask edge.");
  }
  if (result.maskA.width < 18 || result.maskA.height < 18) {
    warnings.push("Object is very small and may be hard to fabricate.");
  }
  return warnings;
}

export function buildImageBuffers(image: HTMLImageElement): ImageBuffers {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create image buffer.");
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width: canvas.width,
    height: canvas.height,
    data: imageData.data,
  };
}

function buildImageBuffersAtSize(
  image: HTMLImageElement,
  width: number,
  height: number,
): ImageBuffers {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create resized image buffer.");
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return {
    width,
    height,
    data: imageData.data,
  };
}

function maskFromPixels(points: Position[]): CompactMask | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    sumX += point.x;
    sumY += point.y;
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const data = new Uint8Array(width * height);
  for (const point of points) {
    data[(point.y - minY) * width + (point.x - minX)] = 1;
  }
  return {
    x: minX,
    y: minY,
    width,
    height,
    area: points.length,
    center: {
      x: sumX / points.length,
      y: sumY / points.length,
    },
    data,
  };
}

function dilateMask(mask: CompactMask, radius: number, maxWidth: number, maxHeight: number): CompactMask {
  if (radius <= 0) return mask;
  const points: Position[] = [];
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (!mask.data[y * mask.width + x]) continue;
      const worldX = mask.x + x;
      const worldY = mask.y + y;
      for (let oy = -radius; oy <= radius; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) {
          if (ox * ox + oy * oy > radius * radius) continue;
          const px = clamp(worldX + ox, 0, maxWidth - 1);
          const py = clamp(worldY + oy, 0, maxHeight - 1);
          points.push({ x: px, y: py });
        }
      }
    }
  }
  return maskFromPixels(points) ?? mask;
}

function translateMask(mask: CompactMask, dx: number, dy: number, maxWidth: number, maxHeight: number): CompactMask {
  const points: Position[] = [];
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (!mask.data[y * mask.width + x]) continue;
      points.push({
        x: clamp(Math.round(mask.x + x + dx), 0, maxWidth - 1),
        y: clamp(Math.round(mask.y + y + dy), 0, maxHeight - 1),
      });
    }
  }
  return maskFromPixels(points) ?? mask;
}

function rotateMask(
  mask: CompactMask,
  anchor: Position,
  thetaDeg: number,
  maxWidth: number,
  maxHeight: number,
): CompactMask {
  const theta = (thetaDeg * Math.PI) / 180;
  const points: Position[] = [];
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (!mask.data[y * mask.width + x]) continue;
      const rotated = rotatePoint(
        { x: mask.x + x, y: mask.y + y },
        anchor,
        theta,
      );
      points.push({
        x: clamp(Math.round(rotated.x), 0, maxWidth - 1),
        y: clamp(Math.round(rotated.y), 0, maxHeight - 1),
      });
    }
  }
  return maskFromPixels(points) ?? mask;
}

function writeMaskToCoverage(mask: CompactMask, coverage: Uint8Array, coverageWidth: number): void {
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (!mask.data[y * mask.width + x]) continue;
      const worldX = mask.x + x;
      const worldY = mask.y + y;
      const offset = worldY * coverageWidth + worldX;
      if (offset >= 0 && offset < coverage.length) coverage[offset] = 1;
    }
  }
}

function sampleFromBuffer(
  buffer: ImageBuffers,
  x: number,
  y: number,
): PixelSource {
  const idx = (y * buffer.width + x) * 4;
  return {
    data: buffer.data.subarray(idx, idx + 4),
  };
}

function transformedMaskForResult(
  annotation: Stage3Annotation,
  result: Stage3ObjectResult,
  width: number,
  height: number,
): CompactMask | null {
  if (result.movement.type === "swapSlide") {
    return annotation.maskB
      ? dilateMask(annotation.maskB, 3, width, height)
      : null;
  }
  if (result.movement.type === "transition") {
    return dilateMask(
      translateMask(annotation.maskA, result.movement.dx, result.movement.dy, width, height),
      3,
      width,
      height,
    );
  }
  if (result.movement.type === "rotation") {
    return dilateMask(
      rotateMask(annotation.maskA, result.movement.anchor, result.movement.thetaDeg, width, height),
      3,
      width,
      height,
    );
  }
  return null;
}

function fillHoles(
  out: Uint8ClampedArray,
  known: Uint8Array,
  width: number,
  height: number,
): void {
  const maxPasses = 24;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    const nextKnown = known.slice();
    const nextOut = new Uint8ClampedArray(out);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx1 = y * width + x;
        if (known[idx1]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let count = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (ox === 0 && oy === 0) continue;
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const n1 = ny * width + nx;
            if (!known[n1]) continue;
            const n4 = n1 * 4;
            r += out[n4];
            g += out[n4 + 1];
            b += out[n4 + 2];
            a += out[n4 + 3];
            count += 1;
          }
        }
        if (count === 0) continue;
        const idx4 = idx1 * 4;
        nextOut[idx4] = Math.round(r / count);
        nextOut[idx4 + 1] = Math.round(g / count);
        nextOut[idx4 + 2] = Math.round(b / count);
        nextOut[idx4 + 3] = Math.round(a / count);
        nextKnown[idx1] = 1;
        changed = true;
      }
    }
    out.set(nextOut);
    known.set(nextKnown);
    if (!changed) break;
  }
}

export function buildCleanBackgroundPlateUrl(
  imageA: HTMLImageElement,
  imageB: HTMLImageElement,
  annotations: Stage3Annotation[],
  results: Stage3ObjectResult[],
): string {
  const width = imageA.naturalWidth;
  const height = imageA.naturalHeight;
  const bufferA = buildImageBuffersAtSize(imageA, width, height);
  const bufferB = buildImageBuffersAtSize(imageB, width, height);
  const coverageA = new Uint8Array(width * height);
  const coverageB = new Uint8Array(width * height);
  const resultById = new Map(results.map((result) => [result.id, result]));

  for (const annotation of annotations) {
    const result = resultById.get(annotation.id);
    if (!result) continue;
    writeMaskToCoverage(dilateMask(annotation.maskA, 3, width, height), coverageA, width);
    const targetMask = transformedMaskForResult(annotation, result, width, height);
    if (targetMask) writeMaskToCoverage(targetMask, coverageB, width);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create clean background canvas.");
  const imageData = ctx.createImageData(width, height);
  const known = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx1 = y * width + x;
      const idx4 = idx1 * 4;
      const useA = coverageA[idx1] === 0;
      const useB = coverageB[idx1] === 0;
      let pixel: PixelSource | null = null;
      if (useA) pixel = sampleFromBuffer(bufferA, x, y);
      else if (useB) pixel = sampleFromBuffer(bufferB, x, y);
      if (!pixel) continue;
      imageData.data[idx4] = pixel.data[0];
      imageData.data[idx4 + 1] = pixel.data[1];
      imageData.data[idx4 + 2] = pixel.data[2];
      imageData.data[idx4 + 3] = pixel.data[3];
      known[idx1] = 1;
    }
  }

  fillHoles(imageData.data, known, width, height);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

export function segmentImageAtPoint(
  image: HTMLImageElement,
  point: Position,
  tolerance = 42,
): CompactMask | null {
  const buffers = buildImageBuffers(image);
  const startX = clamp(Math.round(point.x), 0, buffers.width - 1);
  const startY = clamp(Math.round(point.y), 0, buffers.height - 1);
  const startIdx = (startY * buffers.width + startX) * 4;
  const seed: [number, number, number] = [
    buffers.data[startIdx],
    buffers.data[startIdx + 1],
    buffers.data[startIdx + 2],
  ];

  const visited = new Uint8Array(buffers.width * buffers.height);
  const selected = new Uint8Array(buffers.width * buffers.height);
  const queueX = new Int32Array(buffers.width * buffers.height);
  const queueY = new Int32Array(buffers.width * buffers.height);
  let head = 0;
  let tail = 0;
  queueX[tail] = startX;
  queueY[tail] = startY;
  tail += 1;
  visited[startY * buffers.width + startX] = 1;

  let minX = startX;
  let minY = startY;
  let maxX = startX;
  let maxY = startY;
  let area = 0;
  let sumX = 0;
  let sumY = 0;

  while (head < tail) {
    const x = queueX[head];
    const y = queueY[head];
    head += 1;

    const idx = (y * buffers.width + x) * 4;
    const current: [number, number, number] = [
      buffers.data[idx],
      buffers.data[idx + 1],
      buffers.data[idx + 2],
    ];
    if (colorDiff(seed, current) > tolerance) continue;

    selected[y * buffers.width + x] = 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    area += 1;
    sumX += x;
    sumY += y;

    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= buffers.width || ny >= buffers.height) continue;
      const offset = ny * buffers.width + nx;
      if (visited[offset]) continue;
      visited[offset] = 1;
      queueX[tail] = nx;
      queueY[tail] = ny;
      tail += 1;
    }
  }

  if (area < 12) return null;

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const data = new Uint8Array(width * height);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (selected[y * buffers.width + x]) {
        data[(y - minY) * width + (x - minX)] = 1;
      }
    }
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

export function buildMaskedObjectUrl(image: HTMLImageElement, mask: CompactMask): string {
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sctx = source.getContext("2d");
  if (!sctx) throw new Error("Could not prepare crop source.");
  sctx.drawImage(image, 0, 0);
  const sourceData = sctx.getImageData(mask.x, mask.y, mask.width, mask.height).data;

  const crop = document.createElement("canvas");
  crop.width = mask.width;
  crop.height = mask.height;
  const ctx = crop.getContext("2d");
  if (!ctx) throw new Error("Could not prepare crop canvas.");

  const imageData = ctx.createImageData(mask.width, mask.height);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const target = (y * mask.width + x) * 4;
      if (!mask.data[y * mask.width + x]) {
        imageData.data[target + 3] = 0;
        continue;
      }
      const sourceOffset = target;
      imageData.data[target] = sourceData[sourceOffset];
      imageData.data[target + 1] = sourceData[sourceOffset + 1];
      imageData.data[target + 2] = sourceData[sourceOffset + 2];
      imageData.data[target + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return crop.toDataURL("image/png");
}

export function inferStage3Object(
  annotation: Stage3Annotation,
  imageA: HTMLImageElement,
  imageB: HTMLImageElement,
): Stage3ObjectResult {
  const logs: string[] = [];

  if (!annotation.sameObject) {
    if (!annotation.maskB) {
      throw new Error("SwapSlide objects require mask_B.");
    }
    const movement = chooseSwapDirection(annotation.maskA, annotation.maskB);
    logs.push(`swapSlide selected directly because sameObject=false`);
    logs.push(
      `mask_A bbox=(${annotation.maskA.x}, ${annotation.maskA.y}, ${annotation.maskA.width}, ${annotation.maskA.height})`,
    );
    logs.push(
      `mask_B bbox=(${annotation.maskB.x}, ${annotation.maskB.y}, ${annotation.maskB.width}, ${annotation.maskB.height})`,
    );
    logs.push(`direction=${movement.direction}, pull=${movement.pullDirection}`);
    const result: Stage3ObjectResult = {
      id: annotation.id,
      maskA: maskSummary(annotation.maskA),
      maskB: maskSummary(annotation.maskB),
      pointA: roundPoint(annotation.pointA),
      pointB: roundPoint(annotation.pointB),
      movement,
      optimization: {
        kind: "rule",
        label: "swapSlide",
        reason: "sameObject=false, so the object pair is treated as a swap-slide mechanism.",
      },
      logs,
      layer: 0,
      warnings: [],
    };
    result.warnings = warningForObject(result);
    return result;
  }

  const buffersA = buildImageBuffers(imageA);
  const buffersB = buildImageBuffers(imageB);
  const translation = evaluateTranslation(annotation, buffersA, buffersB);
  const rotationEval = evaluateRotation(annotation, buffersA, buffersB);
  const rotation = rotationEval.movement;
  rotation.translationCost = translation.totalCost;

  logs.push(
    `inputs: point_A=(${annotation.pointA.x.toFixed(1)}, ${annotation.pointA.y.toFixed(1)}), point_B=(${annotation.pointB.x.toFixed(1)}, ${annotation.pointB.y.toFixed(1)})`,
  );
  logs.push(
    `mask_A: bbox=(${annotation.maskA.x}, ${annotation.maskA.y}, ${annotation.maskA.width}, ${annotation.maskA.height}), area=${annotation.maskA.area}`,
  );
  logs.push(
    `complexity penalty: transition=${COMPLEXITY_LAMBDA * TRANSLATION_COMPLEXITY}, rotation=${COMPLEXITY_LAMBDA * ROTATION_COMPLEXITY}`,
  );
  logs.push(
    `translation: dx=${translation.dx.toFixed(1)}, dy=${translation.dy.toFixed(1)}, image=${translation.imageMatchCost.toFixed(2)}, total=${translation.totalCost.toFixed(2)}`,
  );
  logs.push(
    `rotation search: anchors_tested=${rotationEval.anchorsTested}, sampled_pixels=${rotationEval.sampledPixels}`,
  );
  logs.push(
    `rotation best: anchor=(${rotation.anchor.x}, ${rotation.anchor.y}), theta=${rotation.thetaDeg.toFixed(1)}deg, image=${rotation.imageMatchCost.toFixed(2)}, total=${rotation.totalCost.toFixed(2)}`,
  );

  const movement = translation.totalCost <= rotation.totalCost ? translation : rotation;
  logs.push(
    `winner=${movement.type} (margin=${Math.abs(translation.totalCost - rotation.totalCost).toFixed(2)})`,
  );

  const result: Stage3ObjectResult = {
    id: annotation.id,
    maskA: maskSummary(annotation.maskA),
    pointA: roundPoint(annotation.pointA),
    pointB: roundPoint(annotation.pointB),
    movement,
    optimization: {
      kind: "comparison",
      translation,
      rotation,
      winner: movement.type,
      anchorsTested: rotationEval.anchorsTested,
      sampledPixels: rotationEval.sampledPixels,
      complexityLambda: COMPLEXITY_LAMBDA,
    },
    logs,
    layer: 0,
    warnings: [],
  };
  result.warnings = warningForObject(result);
  return result;
}

export function finalizeStage3Pipeline(
  imageA: Stage3ImageAsset,
  imageB: Stage3ImageAsset,
  results: Stage3ObjectResult[],
): Stage3PipelineResult {
  const { layerCount, layers, assignmentLogs } = assignLayers(results);
  const enriched = results.map((result) => ({
    ...result,
    layer: layers[result.id] ?? 0,
  }));
  const warnings = enriched.flatMap((result) =>
    result.warnings.map((warning) => `${result.id}: ${warning}`),
  );
  if (layerCount > 4) warnings.push(`Layer count is ${layerCount}, which may be hard to fabricate.`);
  return {
    schemaVersion: 1,
    imageA: {
      filename: imageA.filename,
      width: imageA.width,
      height: imageA.height,
    },
    imageB: {
      filename: imageB.filename,
      width: imageB.width,
      height: imageB.height,
    },
    layerCount,
    objects: enriched,
    assignmentLogs,
    warnings,
  };
}

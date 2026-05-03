// inverseDesign/imageAnalyzer.ts

export interface DetectedPart {
  id: string;
  label: string; // "head", "arm", "leg", "eye", etc.
  bounds: { x: number; y: number; w: number; h: number };
  defaultAnchor: { x: number; y: number };
  suggestedMotion: "rotate" | "translate" | "slide";
  confidence: number;
}

export interface SceneAnalysis {
  parts: DetectedPart[];
  background: { hasTransparent: boolean };
  relationships: Array<{
    parent: string;
    child: string;
    type: "attached" | "overlapping";
  }>;
}

/**
 * Analyzes an image and automatically detects movable parts
 * Uses simple heuristics + region analysis (no ML dependency)
 */
export async function analyzeImage(imageUrl: string): Promise<SceneAnalysis> {
  const img = await loadImage(imageUrl);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  const data = imageData.data;

  // Detect connected components based on color similarity
  const visited = new Uint8Array(img.width * img.height);
  const segments: Array<{ pixels: number[]; bounds: any; avgColor: number[] }> =
    [];

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const idx = y * img.width + x;
      if (visited[idx]) continue;

      // Flood fill to find connected region
      const region = floodFill(x, y, img.width, img.height, data, visited);
      if (region.pixels.length > 100) {
        // ignore tiny regions
        segments.push(region);
      }
    }
  }

  // Classify each segment based on position and shape
  const parts: DetectedPart[] = [];
  const centerX = img.width / 2;
  const centerY = img.height / 2;

  for (const seg of segments) {
    const aspectRatio = seg.bounds.w / seg.bounds.h;
    const centerRegionX = seg.bounds.x + seg.bounds.w / 2;
    const centerRegionY = seg.bounds.y + seg.bounds.h / 2;

    let label = "part";
    let suggestedMotion: "rotate" | "translate" | "slide" = "translate";
    let defaultAnchor = { x: 0, y: 0 };

    // Heuristic classification based on position
    if (
      centerRegionY < centerY * 0.6 &&
      Math.abs(centerRegionX - centerX) < centerX * 0.3
    ) {
      label = "head";
      suggestedMotion = "rotate";
      defaultAnchor = { x: 0, y: seg.bounds.h * 0.3 };
    } else if (centerRegionY > centerY * 0.7) {
      label = "body";
      suggestedMotion = "translate";
      defaultAnchor = { x: 0, y: 0 };
    } else if (
      Math.abs(centerRegionX - centerX) > centerX * 0.3 &&
      aspectRatio > 1.5
    ) {
      label = centerRegionX > centerX ? "right_arm" : "left_arm";
      suggestedMotion = "rotate";
      defaultAnchor = {
        x: centerRegionX > centerX ? -seg.bounds.w * 0.3 : seg.bounds.w * 0.3,
        y: 0,
      };
    } else if (
      aspectRatio > 0.8 &&
      aspectRatio < 1.2 &&
      seg.bounds.w < img.width * 0.15
    ) {
      label = "eye";
      suggestedMotion = "slide";
    }

    parts.push({
      id: `part_${parts.length}`,
      label,
      bounds: seg.bounds,
      defaultAnchor,
      suggestedMotion,
      confidence: 0.7,
    });
  }

  return {
    parts: parts.filter((p) => p.label !== "background"),
    background: { hasTransparent: checkTransparency(imageData) },
    relationships: inferRelationships(parts),
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function floodFill(
  startX: number,
  startY: number,
  w: number,
  h: number,
  data: Uint8ClampedArray,
  visited: Uint8Array,
): { pixels: number[]; bounds: any; avgColor: number[] } {
  const queue = [[startX, startY]];
  const pixels: number[] = [];
  let minX = startX,
    maxX = startX,
    minY = startY,
    maxY = startY;
  let rSum = 0,
    gSum = 0,
    bSum = 0;

  const startIdx = (startY * w + startX) * 4;
  const targetR = data[startIdx];
  const targetG = data[startIdx + 1];
  const targetB = data[startIdx + 2];
  const threshold = 30;

  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    const idx = y * w + x;
    if (visited[idx]) continue;

    const pixelIdx = idx * 4;
    const r = data[pixelIdx];
    const g = data[pixelIdx + 1];
    const b = data[pixelIdx + 2];

    // Color similarity check
    if (
      Math.abs(r - targetR) > threshold ||
      Math.abs(g - targetG) > threshold ||
      Math.abs(b - targetB) > threshold
    ) {
      continue;
    }

    visited[idx] = 1;
    pixels.push(idx);
    rSum += r;
    gSum += g;
    bSum += b;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    // Add neighbors
    if (x > 0) queue.push([x - 1, y]);
    if (x < w - 1) queue.push([x + 1, y]);
    if (y > 0) queue.push([x, y - 1]);
    if (y < h - 1) queue.push([x, y + 1]);
  }

  const count = pixels.length;
  return {
    pixels,
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    avgColor: [rSum / count, gSum / count, bSum / count],
  };
}

function checkTransparency(imageData: ImageData): boolean {
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

function inferRelationships(parts: DetectedPart[]): any[] {
  const relationships: any[] = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i].bounds;
      const b = parts[j].bounds;

      // Check if overlapping
      const overlap = !(
        a.x + a.w < b.x ||
        b.x + b.w < a.x ||
        a.y + a.h < b.y ||
        b.y + b.h < a.y
      );

      if (overlap) {
        relationships.push({
          parent: a.y < b.y ? parts[i].id : parts[j].id,
          child: a.y < b.y ? parts[j].id : parts[i].id,
          type: "overlapping",
        });
      }
    }
  }
  return relationships;
}

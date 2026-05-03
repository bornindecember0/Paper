import type { CompactMask } from "./stage3Pipeline";
import type { Position } from "./types";

const DEFAULT_SAM_SERVER = "http://127.0.0.1:8765";

export interface SamPromptPoint {
  position: Position;
  label: 0 | 1;
}

export interface SamHealth {
  ok: boolean;
  provider: "sam";
  model_type: string;
  model_path: string;
  device: string;
  loaded: boolean;
}

export interface SegmenterStatus {
  provider: "sam" | "fallback";
  label: string;
  detail: string;
}

function toDataUrl(image: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not encode image for SAM.");
  ctx.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function decodeMaskData(base64: string, width: number, height: number): Uint8Array {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  if (bytes.length !== width * height) {
    throw new Error("SAM returned a malformed mask.");
  }
  return bytes;
}

export async function fetchSamHealth(baseUrl = DEFAULT_SAM_SERVER): Promise<SamHealth> {
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) throw new Error(`SAM health check failed: ${res.status}`);
  return res.json();
}

export async function segmentWithSam(
  image: HTMLImageElement,
  points: SamPromptPoint[],
  baseUrl = DEFAULT_SAM_SERVER,
): Promise<CompactMask> {
  const res = await fetch(`${baseUrl}/segment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_data_url: toDataUrl(image),
      points: points.map((point) => [point.position.x, point.position.y]),
      labels: points.map((point) => point.label),
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `SAM request failed: ${res.status}`);
  }
  const payload = await res.json();
  return {
    x: payload.x,
    y: payload.y,
    width: payload.width,
    height: payload.height,
    area: payload.area,
    center: payload.center,
    data: decodeMaskData(payload.data_base64, payload.width, payload.height),
  };
}

export function samStatusFromHealth(_health: SamHealth): SegmenterStatus {
  return {
    provider: "sam",
    label: "Local SAM connected",
    detail: "",
  };
}

export function fallbackSegmenterStatus(): SegmenterStatus {
  return {
    provider: "fallback",
    label: "Fallback Point Segmenter",
    detail:
      "SAM server is unavailable. Run `npm run sam-server` to use your local SAM checkpoint; otherwise point clicks fall back to region-growing segmentation.",
  };
}

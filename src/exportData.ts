/**
 * Build export data for each object: position, size, movement type, params, lever length.
 * Used by the app (e.g. Export button) and by scripts/exportObjects.ts.
 */
import type { CanvasObject, Movement } from './types';
import { LEVER_ROW_H, getTransitionDims, getRotationDims, getRotationAnchor } from './leverGeometry';

export interface ExportMovementTransition {
  type: 'transition';
  startPosition: { x: number; y: number };
  endPoint: { x: number; y: number };
  leverLength: number;
  rodWidth: number;
}

export interface ExportMovementRotation {
  type: 'rotation';
  anchorOffset: { x: number; y: number };
  anchorAbsolute: { x: number; y: number };
  degrees: number;
  leverLength: number;
  rodWidth: number;
}

export interface ExportMovementSlide {
  type: 'slide';
  direction: 'horizontal' | 'vertical';
  pullDirection: 'up' | 'down' | 'left' | 'right';
  range: number;
  secondObjectId: string;
  leverRow: true;
}

export type ExportMovement =
  | ExportMovementTransition
  | ExportMovementRotation
  | ExportMovementSlide;

export interface ExportObjectEntry {
  id: string;
  filename: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  movement: ExportMovement;
}

export interface BuildExportOptions {
  canvasW: number;
  canvasH: number;
  revealRatio?: number;
}

/**
 * Build export entries for all objects that have movement.
 * Lever dimensions are computed with the same logic as PlayOverlay.
 */
export function buildExportData(
  objects: CanvasObject[],
  options: BuildExportOptions,
): ExportObjectEntry[] {
  const { canvasW, canvasH, revealRatio } = options;
  const objectsWithMovement = objects.filter((o): o is CanvasObject & { movement: Movement } => !!o.movement);
  const slideCount = objectsWithMovement.filter(o => o.movement.type === 'slide').length;
  const totalLeverH = slideCount * LEVER_ROW_H;

  return objectsWithMovement.map(obj => {
    const { id, filename, position, width, height, movement } = obj;
    const base = { id, filename, position: { ...position }, width, height };

    if (movement.type === 'transition') {
      const dims = getTransitionDims(
        obj,
        totalLeverH,
        canvasW,
        canvasH,
        revealRatio,
      );
      return {
        ...base,
        movement: {
          type: 'transition',
          startPosition: { ...position },
          endPoint: { ...movement.endPoint },
          leverLength: dims.leverLength,
          rodWidth: dims.rodWidth,
        },
      };
    }

    if (movement.type === 'rotation') {
      const dims = getRotationDims(
        obj,
        totalLeverH,
        canvasW,
        canvasH,
        revealRatio,
      );
      const anchorAbsolute = getRotationAnchor(obj);
      return {
        ...base,
        movement: {
          type: 'rotation',
          anchorOffset: { ...movement.anchorPoint },
          anchorAbsolute: { x: anchorAbsolute.x, y: anchorAbsolute.y },
          degrees: movement.angleDeg ?? 360,
          leverLength: dims.leverLength,
          rodWidth: dims.rodWidth,
        },
      };
    }

    if (movement.type === 'slide') {
      return {
        ...base,
        movement: {
          type: 'slide',
          direction: movement.direction,
          pullDirection: movement.pullDirection,
          range: movement.range,
          secondObjectId: movement.secondObjectId,
          leverRow: true,
        },
      };
    }

    throw new Error(`Unknown movement type: ${(movement as Movement).type}`);
  });
}

/** Convert a blob URL to base64 data URL. */
async function urlToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export interface SavePayload {
  version: 1;
  canvas: { width: number; height: number };
  background: { filename: string; imageData: string } | null;
  objects: Array<{
    id: string;
    filename: string;
    position: { x: number; y: number };
    width: number;
    height: number;
    movement?: ExportMovement;
    imageData: string;
  }>;
}

export interface SaveSceneOptions {
  background: string | null;
  bgFilename: string;
  objects: CanvasObject[];
  canvasW: number;
  canvasH: number;
  revealRatio?: number;
}

/**
 * Build full save payload with base64 image data for background and all objects.
 */
export async function buildSavePayload(options: SaveSceneOptions): Promise<SavePayload> {
  const { background, bgFilename, objects, canvasW, canvasH, revealRatio } = options;
  const exportData = buildExportData(objects, {
    canvasW,
    canvasH,
    revealRatio,
  });
  const exportById = new Map(exportData.map(e => [e.id, e]));

  const objectEntries = await Promise.all(
    objects.map(async (obj) => {
      const imageData = await urlToBase64(obj.imageUrl);
      const exported = exportById.get(obj.id);
      const base = {
        id: obj.id,
        filename: obj.filename,
        position: { ...obj.position },
        width: obj.width,
        height: obj.height,
        imageData,
      };
      if (exported?.movement) {
        return { ...base, movement: exported.movement };
      }
      return base;
    }),
  );

  let backgroundEntry: { filename: string; imageData: string } | null = null;
  if (background) {
    const imageData = await urlToBase64(background);
    backgroundEntry = { filename: bgFilename || 'background', imageData };
  }

  return {
    version: 1,
    canvas: { width: canvasW, height: canvasH },
    background: backgroundEntry,
    objects: objectEntries,
  };
}

/** Trigger download of save payload as JSON file. */
export function downloadSave(payload: SavePayload, filename = 'paper-scene.json') {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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
  clockwise: boolean;
  leverLength: number;
  rodWidth: number;
}

export interface ExportMovementSlide {
  type: 'slide';
  direction: 'horizontal' | 'vertical';
  range: number;
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
}

/**
 * Build export entries for all objects that have movement.
 * Lever dimensions are computed with the same logic as PlayOverlay.
 */
export function buildExportData(
  objects: CanvasObject[],
  options: BuildExportOptions,
): ExportObjectEntry[] {
  const { canvasW, canvasH } = options;
  const objectsWithMovement = objects.filter((o): o is CanvasObject & { movement: Movement } => !!o.movement);
  const slideCount = objectsWithMovement.filter(o => o.movement.type === 'slide').length;
  const totalLeverH = slideCount * LEVER_ROW_H;

  return objectsWithMovement.map(obj => {
    const { id, filename, position, width, height, movement } = obj;
    const base = { id, filename, position: { ...position }, width, height };

    if (movement.type === 'transition') {
      const dims = getTransitionDims(obj, totalLeverH, canvasW, canvasH);
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
      const dims = getRotationDims(obj, totalLeverH, canvasW, canvasH);
      const anchorAbsolute = getRotationAnchor(obj);
      return {
        ...base,
        movement: {
          type: 'rotation',
          anchorOffset: { ...movement.anchorPoint },
          anchorAbsolute: { x: anchorAbsolute.x, y: anchorAbsolute.y },
          degrees: movement.degrees,
          clockwise: movement.clockwise,
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
          range: movement.range,
          leverRow: true,
        },
      };
    }

    throw new Error(`Unknown movement type: ${(movement as Movement).type}`);
  });
}

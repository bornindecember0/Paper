#!/usr/bin/env npx tsx
/**
 * Export each object's position, lever length, movement type and parameters.
 *
 * Usage:
 *   npm run export-objects [input.json]
 *   npx tsx scripts/exportObjects.ts scripts/sample-state.json
 *
 * Input JSON: { "objects": CanvasObject[], "canvasW"?: number, "canvasH"?: number }
 * If no file given, reads from stdin.
 * Default canvas size: 800 x 600.
 *
 * Output: JSON array of ExportObjectEntry:
 *   - id, filename, position, width, height
 *   - movement: type + params + leverLength/rodWidth (for transition/rotation) or leverRow (slide)
 */
import { readFile } from 'fs';
import { buildExportData } from '../src/exportData';
import type { CanvasObject } from '../src/types';

const DEFAULT_CANVAS_W = 800;
const DEFAULT_CANVAS_H = 600;

interface InputState {
  objects: CanvasObject[];
  canvasW?: number;
  canvasH?: number;
}

function readInput(path?: string): Promise<string> {
  if (path) {
    return new Promise((resolve, reject) => {
      readFile(path, 'utf8', (err, data) => (err ? reject(err) : resolve(data)));
    });
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const inputPath = process.argv[2];
  const raw = await readInput(inputPath);
  let state: InputState;
  try {
    state = JSON.parse(raw) as InputState;
  } catch (e) {
    console.error('Invalid JSON input.');
    process.exit(1);
  }

  const objects = state.objects ?? [];
  const canvasW = state.canvasW ?? DEFAULT_CANVAS_W;
  const canvasH = state.canvasH ?? DEFAULT_CANVAS_H;

  const result = buildExportData(objects, { canvasW, canvasH });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

export interface Position {
  x: number;
  y: number;
}

// ── Movement types ──────────────────────────────────────────────────────────

export interface TransitionMovement {
  type: 'transition';
  /** End position (canvas absolute coordinates). */
  endPoint: Position;
}

export interface RotationMovement {
  type: 'rotation';
  /**
   * Anchor point in canvas absolute coordinates.
   * Must lie inside the object's bounding box.
   */
  anchorPoint: Position;
  /** Degrees to rotate (positive = clockwise). */
  degrees: number;
  clockwise: boolean;
}

export interface SlideMovement {
  type: 'slide';
  direction: 'horizontal' | 'vertical';
  /** Distance in pixels (positive = right / down). */
  range: number;
}

export type Movement = TransitionMovement | RotationMovement | SlideMovement;

// ── Canvas object ────────────────────────────────────────────────────────────

export interface CanvasObject {
  id: string;
  /** Object URL created from the uploaded file. */
  imageUrl: string;
  /** Center position on the canvas. */
  position: Position;
  width: number;
  height: number;
  movement?: Movement;
}

// ── Interaction modes ────────────────────────────────────────────────────────

export type InteractionMode =
  | 'idle'
  | 'setting-end-point'   // waiting for user to click canvas to set transition end
  | 'setting-anchor'      // waiting for user to click inside object for rotation anchor
  | 'play';               // play mode: sliders visible, no selection

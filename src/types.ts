export interface Position {
  x: number;
  y: number;
}

// ── Movement types ──────────────────────────────────────────────────────────

export interface TransitionMovement {
  type: 'transition';
  endPoint: Position;
}

export interface RotationMovement {
  type: 'rotation';
  anchorPoint: Position;
  degrees: number;
  clockwise: boolean;
}

export interface SlideMovement {
  type: 'slide';
  direction: 'horizontal' | 'vertical';
  range: number;
}

export type Movement = TransitionMovement | RotationMovement | SlideMovement;

// ── Canvas object ────────────────────────────────────────────────────────────

export interface CanvasObject {
  id: string;
  imageUrl: string;
  filename: string;
  position: Position;
  width: number;
  height: number;
  movement?: Movement;
  locked?: boolean;
}

// ── Interaction modes ────────────────────────────────────────────────────────

export type InteractionMode = 'idle' | 'play';

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
  angleDeg?: number;
}

export interface SlideMovement {
  type: 'slide';
  // axis of movement
  direction: 'horizontal' | 'vertical';
  // which edge the tab starts off-canvas from (the direction the user pulls toward)
  pullDirection: 'up' | 'down' | 'left' | 'right';
  // full canvas dimension along the movement axis, signed:
  //   pull=down/right → negative (strip starts below/right, moves toward 0)
  //   pull=up/left    → positive (strip starts above/left, moves away from 0)
  range: number;
  // ID of the "after" image object
  secondObjectId: string;
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

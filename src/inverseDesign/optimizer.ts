// inverseDesign/optimizer.ts
import type { CanvasObject, Position, Movement } from "../types";
import { CANVAS_W, CANVAS_H } from "../components/CanvasArea";

export interface MotionTarget {
  partId: string; // which object moves
  motionType: "translate" | "rotate" | "slide";
  targetPath?: Position[]; // keyframes along pull distance (0 to 1)
  targetAngle?: number; // for rotation
  targetDirection?: { x: number; y: number }; // for translate
  description?: string; // "leans forward", "turns head"
}

export interface OptimizationResult {
  objects: CanvasObject[];
  score: number;
  iterations: number;
}

// Motion primitive library
const MOTION_PRIMITIVES = {
  "turn head": { type: "rotation", degrees: 30, pivotBias: "top" },
  "lean forward": { type: "transition", bias: "downward" },
  "slide up": { type: "slide", direction: "vertical", pull: "up" },
  "slide down": { type: "slide", direction: "vertical", pull: "down" },
  "slide left": { type: "slide", direction: "horizontal", pull: "left" },
  "slide right": { type: "slide", direction: "horizontal", pull: "right" },
};

export class InverseDesignOptimizer {
  private objects: CanvasObject[];
  private canvasW: number;
  private canvasH: number;

  constructor(objects: CanvasObject[], canvasW = CANVAS_W, canvasH = CANVAS_H) {
    this.objects = objects;
    this.canvasW = canvasW;
    this.canvasH = canvasH;
  }

  /**
   * Main optimization entry point
   */
  async optimize(
    description: string,
    targetPart: string,
  ): Promise<OptimizationResult> {
    // Step 1: Parse description into motion target
    const target = this.parseDescription(description, targetPart);

    // Step 2: Select motion primitive
    const primitive = this.selectPrimitive(description);

    // Step 3: Generate initial candidate mechanisms
    let candidates = this.generateCandidates(target, primitive);

    // Step 4: Optimize continuous parameters
    let best = await this.optimizeParameters(candidates);

    // Step 5: Refine topology if needed
    if (best.score < 0.7) {
      candidates = this.refineTopology(best, target);
      best = await this.optimizeParameters(candidates);
    }

    return best;
  }

  private parseDescription(description: string, partId: string): MotionTarget {
    const lower = description.toLowerCase();
    const target: MotionTarget = { partId, motionType: "translate" };

    if (
      lower.includes("turn") ||
      lower.includes("rotate") ||
      lower.includes("head")
    ) {
      target.motionType = "rotate";
      target.targetAngle = this.extractAngle(description) || 30;
    } else if (lower.includes("lean") || lower.includes("bend")) {
      target.motionType = "translate";
      target.targetDirection = { x: 0, y: 15 }; // leans forward = downward
    } else if (lower.includes("slide")) {
      target.motionType = "slide";
    }

    return target;
  }

  private selectPrimitive(description: string): string {
    for (const [key, _] of Object.entries(MOTION_PRIMITIVES)) {
      if (description.toLowerCase().includes(key)) {
        return key;
      }
    }
    return "translate"; // default
  }

  private generateCandidates(
    target: MotionTarget,
    primitive: string,
  ): CanvasObject[] {
    const baseObj = this.objects.find((o) => o.id === target.partId);
    if (!baseObj) return [];

    const candidates: CanvasObject[] = [];

    switch (target.motionType) {
      case "rotate":
        // Generate rotation candidates with different anchor points
        const anchors = [
          { x: 0, y: -baseObj.height / 3 }, // top-center
          { x: 0, y: 0 }, // center
          { x: baseObj.width / 3, y: -baseObj.height / 3 }, // top-right
          { x: -baseObj.width / 3, y: -baseObj.height / 3 }, // top-left
        ];

        for (const anchor of anchors) {
          candidates.push({
            ...baseObj,
            movement: {
              type: "rotation",
              anchorPoint: anchor,
            },
          });
        }
        break;

      case "translate":
        // Generate candidates in 8 directions
        const directions = [
          { x: 0, y: 50 }, // down
          { x: 0, y: -50 }, // up
          { x: 50, y: 0 }, // right
          { x: -50, y: 0 }, // left
          { x: 35, y: 35 }, // down-right
          { x: -35, y: 35 }, // down-left
          { x: 35, y: -35 }, // up-right
          { x: -35, y: -35 }, // up-left
        ];

        for (const dir of directions) {
          candidates.push({
            ...baseObj,
            movement: {
              type: "transition",
              endPoint: {
                x: baseObj.position.x + dir.x,
                y: baseObj.position.y + dir.y,
              },
            },
          });
        }
        break;

      case "slide":
        const slideDirs: Array<{
          direction: "horizontal" | "vertical";
          pull: "up" | "down" | "left" | "right";
        }> = [
          { direction: "vertical", pull: "down" },
          { direction: "vertical", pull: "up" },
          { direction: "horizontal", pull: "right" },
          { direction: "horizontal", pull: "left" },
        ];

        for (const sd of slideDirs) {
          candidates.push({
            ...baseObj,
            movement: {
              type: "slide",
              direction: sd.direction,
              pullDirection: sd.pull,
              range: sd.direction === "vertical" ? this.canvasH : this.canvasW,
              secondObjectId: this.findSecondObject(target.partId),
            },
          });
        }
        break;
    }

    return candidates;
  }

  private async optimizeParameters(
    candidates: CanvasObject[],
  ): Promise<OptimizationResult> {
    let best: CanvasObject | null = null;
    let bestScore = -Infinity;
    let iterations = 0;

    for (const candidate of candidates) {
      if (!candidate.movement) continue;

      // Simulated annealing for continuous parameters
      let current = { ...candidate };
      let currentScore = this.evaluateMotion(current);

      // Temperature schedule
      let temp = 100;
      const coolingRate = 0.95;

      for (let iter = 0; iter < 200 && temp > 0.1; iter++) {
        iterations++;

        // Perturb parameters
        const neighbor = this.perturb(current);
        const neighborScore = this.evaluateMotion(neighbor);

        // Accept if better, or probabilistically if worse (annealing)
        const delta = neighborScore - currentScore;
        if (delta > 0 || Math.exp(delta / temp) > Math.random()) {
          current = neighbor;
          currentScore = neighborScore;
        }

        temp *= coolingRate;
      }

      if (currentScore > bestScore) {
        bestScore = currentScore;
        best = current;
      }
    }

    return {
      objects: best ? [best] : [],
      score: bestScore,
      iterations,
    };
  }

  private perturb(obj: CanvasObject): CanvasObject {
    const mutated = { ...obj };
    if (!mutated.movement) return mutated;

    const m = mutated.movement;

    if (m.type === "rotation") {
      // Perturb anchor point by ±5px
      mutated.movement = {
        ...m,
        anchorPoint: {
          x: m.anchorPoint.x + (Math.random() - 0.5) * 10,
          y: m.anchorPoint.y + (Math.random() - 0.5) * 10,
        },
      };
    } else if (m.type === "transition") {
      // Perturb end point by ±8px
      mutated.movement = {
        ...m,
        endPoint: {
          x: m.endPoint.x + (Math.random() - 0.5) * 16,
          y: m.endPoint.y + (Math.random() - 0.5) * 16,
        },
      };
    }

    return mutated;
  }

  private evaluateMotion(obj: CanvasObject): number {
    if (!obj.movement) return 0;

    let score = 0;
    const m = obj.movement;

    // Feasibility score (0-1)
    let feasibility = 1;

    // Check 1: Movement is not zero-length
    if (m.type === "transition") {
      const dx = m.endPoint.x - obj.position.x;
      const dy = m.endPoint.y - obj.position.y;
      const length = Math.hypot(dx, dy);
      if (length < 10) feasibility *= 0.3;
      if (length > 200) feasibility *= 0.7;
    }

    // Check 2: Anchor is within object bounds (rotation)
    if (m.type === "rotation") {
      const inBounds =
        Math.abs(m.anchorPoint.x) <= obj.width / 2 &&
        Math.abs(m.anchorPoint.y) <= obj.height / 2;
      if (!inBounds) feasibility *= 0.2;
    }

    // Check 3: Slide range is valid
    if (m.type === "slide") {
      const hasSecond = !!this.objects.find((o) => o.id === m.secondObjectId);
      if (!hasSecond) feasibility *= 0;
    }

    // Smoothness score (simulated)
    let smoothness = 0.8;

    // Expressiveness score (some motions are inherently more "expressive")
    let expressiveness = 0.6;
    if (m.type === "rotation") expressiveness = 0.9;
    if (m.type === "transition") expressiveness = 0.7;

    // Combine scores
    score = 0.4 * feasibility + 0.3 * smoothness + 0.3 * expressiveness;

    return score;
  }

  private refineTopology(
    best: OptimizationResult,
    target: MotionTarget,
  ): CanvasObject[] {
    // If best score is low, try more complex mechanisms
    const refined: CanvasObject[] = [];

    for (const obj of best.objects) {
      if (!obj.movement) continue;

      // Try adding intermediate linkage for rotation+translation (lean)
      if (target.motionType === "translate" && target.targetDirection?.y) {
        // Combine rotation and translation
        refined.push({
          ...obj,
          movement: {
            type: "transition", // Or create a new composite type
            endPoint: {
              x: obj.position.x + (target.targetDirection?.x || 0),
              y: obj.position.y + (target.targetDirection?.y || 0),
            },
          },
        });
      }
    }

    return refined;
  }

  private extractAngle(description: string): number | null {
    const match = description.match(/(\d+)\s*degrees?/i);
    return match ? parseInt(match[1], 10) : null;
  }

  private findSecondObject(currentId: string): string {
    return this.objects.find((o) => o.id !== currentId)?.id || currentId;
  }
}

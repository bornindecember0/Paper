// inverseDesign/autoPlanner.ts
import type { CanvasObject, Position } from "../types";
import type { DetectedPart, SceneAnalysis } from "./imageAnalyzer";
import { CANVAS_W, CANVAS_H } from "../components/CanvasArea";

export interface AnimationPlan {
  description: string;
  parts: Array<{
    sourcePart: DetectedPart;
    canvasObject: CanvasObject;
    motionType: "rotate" | "translate" | "slide";
    parameters: any;
  }>;
  score: number;
}

/**
 * Automatically plans the animation without user input
 */
export class AutoPlanner {
  private canvasW: number;
  private canvasH: number;

  constructor(canvasW = CANVAS_W, canvasH = CANVAS_H) {
    this.canvasW = canvasW;
    this.canvasH = canvasH;
  }

  /**
   * Generate an animation plan from a single image or a pair of images
   */
  async planAnimation(
    primaryImageUrl: string,
    secondaryImageUrl?: string,
    highLevelIntent?: string, // optional hint like "make it wave"
  ): Promise<AnimationPlan> {
    // Analyze the image(s)
    const analysis = await analyzeImage(primaryImageUrl);

    // Generate the plan automatically
    const plan = this.generatePlan(
      analysis,
      secondaryImageUrl,
      highLevelIntent,
    );

    return plan;
  }

  private generatePlan(
    analysis: SceneAnalysis,
    secondaryImageUrl?: string,
    intent?: string,
  ): AnimationPlan {
    const parts: AnimationPlan["parts"] = [];

    // Score different animation possibilities
    const candidates = this.scoreMotions(analysis, intent);

    // Pick the best candidate for each part
    for (const candidate of candidates) {
      if (candidate.score > 0.6) {
        parts.push({
          sourcePart: candidate.part,
          canvasObject: this.createCanvasObject(candidate),
          motionType: candidate.motionType,
          parameters: candidate.parameters,
        });
      }
    }

    // If we have two images, set up a slide transition
    if (secondaryImageUrl && parts.length > 0) {
      const mainPart = parts[0];
      const secondObj = this.createCanvasObject({
        part: mainPart.sourcePart,
        imageUrl: secondaryImageUrl,
        motionType: "slide",
        parameters: {},
        score: 1,
      });

      parts.push({
        sourcePart: mainPart.sourcePart,
        canvasObject: secondObj,
        motionType: "slide",
        parameters: {
          secondObjectId: mainPart.canvasObject.id,
          direction: "horizontal",
          pullDirection: "right",
        },
      });
    }

    return {
      description: this.generateDescription(parts, intent),
      parts,
      score:
        parts.reduce((sum, p) => sum + (p.sourcePart.confidence || 0.5), 0) /
        parts.length,
    };
  }

  private scoreMotions(
    analysis: SceneAnalysis,
    intent?: string,
  ): Array<{
    part: DetectedPart;
    motionType: "rotate" | "translate" | "slide";
    parameters: any;
    score: number;
    imageUrl?: string;
  }> {
    const candidates = [];

    for (const part of analysis.parts) {
      // Head → rotation
      if (part.label === "head") {
        candidates.push({
          part,
          motionType: "rotate",
          parameters: {
            anchorPoint: part.defaultAnchor,
            degrees: 360,
          },
          score: 0.9,
        });
      }

      // Arms → rotation (waving)
      if (part.label.includes("arm")) {
        candidates.push({
          part,
          motionType: "rotate",
          parameters: {
            anchorPoint: part.defaultAnchor,
            degrees: 45,
          },
          score: 0.85,
        });
      }

      // Body → translation (leaning)
      if (part.label === "body") {
        candidates.push({
          part,
          motionType: "translate",
          parameters: {
            endPoint: {
              x: part.bounds.x + part.bounds.w / 2 + 30,
              y: part.bounds.y + part.bounds.h / 2 + 20,
            },
          },
          score: 0.75,
        });
      }

      // Eyes → slide (blink/roll)
      if (part.label === "eye") {
        candidates.push({
          part,
          motionType: "slide",
          parameters: {
            direction: "horizontal",
            pullDirection: "right",
            range: 100,
          },
          score: 0.7,
        });
      }

      // Default: gentle translation
      candidates.push({
        part,
        motionType: "translate",
        parameters: {
          endPoint: {
            x: part.bounds.x + part.bounds.w / 2 + 50,
            y: part.bounds.y + part.bounds.h / 2,
          },
        },
        score: 0.5,
      });
    }

    // Adjust scores based on intent hint
    if (intent) {
      const lowerIntent = intent.toLowerCase();
      for (const c of candidates) {
        if (lowerIntent.includes("wave") && c.part.label.includes("arm")) {
          c.score += 0.2;
        }
        if (lowerIntent.includes("turn") && c.part.label === "head") {
          c.score += 0.2;
        }
        if (lowerIntent.includes("lean") && c.part.label === "body") {
          c.score += 0.2;
        }
      }
    }

    // Sort by score and return top candidates per part
    return candidates.sort((a, b) => b.score - a.score);
  }

  private createCanvasObject(candidate: {
    part: DetectedPart;
    motionType: string;
    parameters: any;
    imageUrl?: string;
  }): CanvasObject {
    const img = new Image();
    // This would need to actually crop the part from the original image
    // For now, create a placeholder

    return {
      id: `auto_${Date.now()}_${candidate.part.id}`,
      imageUrl: candidate.imageUrl || "",
      filename: `${candidate.part.label}.png`,
      position: {
        x: candidate.part.bounds.x + candidate.part.bounds.w / 2,
        y: candidate.part.bounds.y + candidate.part.bounds.h / 2,
      },
      width: candidate.part.bounds.w,
      height: candidate.part.bounds.h,
      movement: this.createMovement(candidate.motionType, candidate.parameters),
      locked: true,
    };
  }

  private createMovement(type: string, params: any) {
    switch (type) {
      case "rotate":
        return {
          type: "rotation" as const,
          anchorPoint: params.anchorPoint || { x: 0, y: -20 },
        };
      case "translate":
        return {
          type: "transition" as const,
          endPoint: params.endPoint || { x: 100, y: 0 },
        };
      case "slide":
        return {
          type: "slide" as const,
          direction: params.direction || "horizontal",
          pullDirection: params.pullDirection || "right",
          range: params.range || 200,
          secondObjectId: params.secondObjectId || "",
        };
      default:
        return undefined;
    }
  }

  private generateDescription(
    parts: AnimationPlan["parts"],
    intent?: string,
  ): string {
    if (intent) return intent;

    const motions = parts.map((p) => {
      if (p.motionType === "rotate") return `${p.sourcePart.label} rotates`;
      if (p.motionType === "translate") return `${p.sourcePart.label} moves`;
      return `${p.sourcePart.label} slides`;
    });

    return `Auto-generated: ${motions.join(", ")}`;
  }
}

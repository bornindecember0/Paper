// components/InversePanel.tsx
import { useState, useCallback } from "react";
import { AutoPlanner } from "../inverseDesign/autoPlanner";
import type { CanvasObject } from "../types";

interface Props {
  objects: CanvasObject[];
  onApplyResult: (objects: CanvasObject[]) => void;
  onAddObjects?: (objects: CanvasObject[]) => void;
}

const EXAMPLE_INTENTS = [
  "make the character wave",
  "turn head to look sideways",
  "lean forward",
  "blink eyes",
  "slide to reveal second face",
  "nod head up and down",
];

export function InversePanel({ objects, onApplyResult, onAddObjects }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [secondImageUrl, setSecondImageUrl] = useState<string | null>(null);
  const [intent, setIntent] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, isSecond = false) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const url = URL.createObjectURL(file);
      if (isSecond) {
        setSecondImageUrl(url);
      } else {
        setImageUrl(url);
      }
    },
    [],
  );

  const handleAutoDetect = useCallback(async () => {
    if (!imageUrl) {
      alert("Please upload an image first");
      return;
    }

    setOptimizing(true);
    setProgress(0);
    setStatusMessage("Analyzing image...");

    const interval = setInterval(() => {
      setProgress((p) => Math.min(90, p + 10));
    }, 200);

    try {
      const planner = new AutoPlanner();

      setStatusMessage("Detecting parts and planning motion...");
      const plan = await planner.planAnimation(
        imageUrl,
        secondImageUrl || undefined,
        intent || undefined,
      );

      setProgress(100);
      setStatusMessage(`Done! Generated ${plan.parts.length} animated parts`);

      // Create canvas objects from the plan
      const newObjects = plan.parts.map((p) => p.canvasObject);

      // Apply the result
      if (onAddObjects) {
        onAddObjects(newObjects);
      } else {
        onApplyResult(newObjects);
      }

      // Show summary
      console.log("Animation plan:", plan);
      alert(
        `✨ Auto-generated animation!\n\n${plan.description}\nConfidence: ${Math.round(plan.score * 100)}%`,
      );
    } catch (error) {
      console.error(error);
      alert(
        "Could not auto-detect. Try a simpler image with clear separation between parts.",
      );
    } finally {
      clearInterval(interval);
      setOptimizing(false);
      setProgress(0);
      setStatusMessage("");
    }
  }, [imageUrl, secondImageUrl, intent, onApplyResult, onAddObjects]);

  const handleExample = (example: string) => {
    setIntent(example);
  };

  return (
    <div className="inverse-panel">
      <div className="inverse-description">
        {/* Primary image upload */}
        <label>📷 Upload character image:</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => handleImageUpload(e, false)}
          disabled={optimizing}
        />
        {imageUrl && (
          <div className="image-preview">
            <img src={imageUrl} alt="Preview" />
            <button onClick={() => setImageUrl(null)}>✕</button>
          </div>
        )}

        {/* Optional second image (for before/after reveal) */}
        <label>🔄 Optional: Second image (for slide reveal):</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => handleImageUpload(e, true)}
          disabled={optimizing}
        />
        {secondImageUrl && (
          <div className="image-preview second">
            <img src={secondImageUrl} alt="Second preview" />
            <button onClick={() => setSecondImageUrl(null)}>✕</button>
          </div>
        )}

        {/* Optional intent hint */}
        <label>💭 What should happen? (optional):</label>
        <input
          type="text"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="e.g., make it wave, turn head, slide to reveal..."
          disabled={optimizing}
        />

        {/* Example hints */}
        <div className="inverse-examples">
          <div className="examples-title">Try these:</div>
          <div className="example-buttons">
            {EXAMPLE_INTENTS.map((ex) => (
              <button
                key={ex}
                className="btn-example"
                onClick={() => handleExample(ex)}
                disabled={optimizing}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {/* Progress */}
        {optimizing && (
          <div className="optimization-progress">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span>{statusMessage || `Optimizing... ${progress}%`}</span>
          </div>
        )}

        {/* Action button */}
        <button
          className="btn-optimize"
          onClick={handleAutoDetect}
          disabled={!imageUrl || optimizing}
        >
          ✨ Auto-Detect & Animate
        </button>

        <p className="save-hint" style={{ marginTop: 8, textAlign: "center" }}>
          The system will automatically detect movable parts
          <br />
          (head, arms, body) and generate the mechanism.
        </p>
      </div>
    </div>
  );
}

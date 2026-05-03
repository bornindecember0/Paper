import base64
import io
import os
from pathlib import Path
from typing import Literal

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
from segment_anything import SamPredictor, sam_model_registry
import uvicorn


DEFAULT_MODEL_PATH = Path.home() / "models/sam/sam_vit_b_01ec64.pth"
MODEL_TYPE = "vit_b"


class SegmentRequest(BaseModel):
    image_data_url: str
    points: list[tuple[float, float]]
    labels: list[int] | None = None


def decode_data_url(data_url: str) -> Image.Image:
    if "," not in data_url:
      raise ValueError("Invalid data URL.")
    _, encoded = data_url.split(",", 1)
    raw = base64.b64decode(encoded)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def choose_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class SamService:
    def __init__(self, model_path: Path):
        self.model_path = model_path
        self.device = choose_device()
        self.predictor: SamPredictor | None = None

    def load(self) -> SamPredictor:
        if self.predictor is None:
            if not self.model_path.exists():
                raise FileNotFoundError(f"SAM checkpoint not found: {self.model_path}")
            sam = sam_model_registry[MODEL_TYPE](checkpoint=str(self.model_path))
            sam.to(device=self.device)
            self.predictor = SamPredictor(sam)
        return self.predictor

    def predict(self, image: Image.Image, points: list[tuple[float, float]], labels: list[int] | None) -> dict:
        predictor = self.load()
        array = np.array(image)
        predictor.set_image(array)
        if len(points) == 0:
            raise ValueError("At least one point is required.")
        point_labels = labels if labels is not None else [1] * len(points)
        if len(point_labels) != len(points):
            raise ValueError("Point labels must match point count.")
        masks, scores, _ = predictor.predict(
            point_coords=np.array(points, dtype=np.float32),
            point_labels=np.array(point_labels, dtype=np.int32),
            multimask_output=len(points) == 1,
        )
        best_index = int(np.argmax(scores))
        mask = masks[best_index].astype(np.uint8)
        ys, xs = np.where(mask > 0)
        if len(xs) == 0 or len(ys) == 0:
            raise ValueError("SAM produced an empty mask.")
        min_x = int(xs.min())
        max_x = int(xs.max())
        min_y = int(ys.min())
        max_y = int(ys.max())
        cropped = mask[min_y : max_y + 1, min_x : max_x + 1]
        area = int(cropped.sum())
        center_x = float(xs.mean())
        center_y = float(ys.mean())
        return {
            "x": min_x,
            "y": min_y,
            "width": int(max_x - min_x + 1),
            "height": int(max_y - min_y + 1),
            "area": area,
            "center": {"x": center_x, "y": center_y},
            "score": float(scores[best_index]),
            "data_base64": base64.b64encode(cropped.tobytes()).decode("ascii"),
        }


MODEL_PATH = Path(os.environ.get("SAM_CHECKPOINT", DEFAULT_MODEL_PATH))
SERVICE = SamService(MODEL_PATH)

app = FastAPI(title="Local SAM Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "provider": "sam",
        "model_type": MODEL_TYPE,
        "model_path": str(MODEL_PATH),
        "device": SERVICE.device,
        "loaded": SERVICE.predictor is not None,
    }


@app.post("/segment")
def segment(req: SegmentRequest):
    try:
        image = decode_data_url(req.image_data_url)
        return SERVICE.predict(image, req.points, req.labels)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SAM inference failed: {exc}") from exc


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)

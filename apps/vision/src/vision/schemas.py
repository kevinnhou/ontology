from pydantic import BaseModel, Field


class TimeRange(BaseModel):
    startMs: float
    endMs: float


class CropRect(BaseModel):
    x: float = 0.0
    y: float = 0.0
    w: float = 1.0
    h: float = 1.0


class ProcessRequest(BaseModel):
    matchId: str
    videoUrl: str
    callbackUrl: str
    frameStride: int = Field(default=5, ge=1)
    ranges: list[TimeRange] = Field(default_factory=list)
    crop: CropRect | None = None
    fps: float | None = None


class BBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class Detection(BaseModel):
    label: str
    confidence: float
    bbox: BBox
    trackId: int | None = None
    alliance: str | None = None


class FrameResult(BaseModel):
    frameIndex: int
    timestampMs: float
    detections: list[Detection]


class ShotEvent(BaseModel):
    trackId: int | None = None
    alliance: str = "unknown"
    frameIndex: int
    timestampMs: float
    origin: dict[str, float]
    speed: float

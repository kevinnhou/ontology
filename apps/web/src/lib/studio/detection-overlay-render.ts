export const SHOT_FLASH_MS = 700;

export const ALLIANCE_COLOURS: Record<string, string> = {
	red: "#ef4444",
	blue: "#3b82f6",
	unknown: "#a3a3a3",
};
export const FUEL_COLOUR = "#facc15";

export interface OverlayDetection {
	alliance?: string;
	bbox: { x: number; y: number; w: number; h: number };
	confidence: number;
	label: string;
	trackId?: number;
}

export interface OverlayFrame {
	detections: OverlayDetection[];
	timestampMs: number;
}

export interface DisplayRect {
	height: number;
	width: number;
	x: number;
	y: number;
}

export function displayedVideoRect(
	video: HTMLVideoElement,
	containerWidth: number,
	containerHeight: number
): DisplayRect | null {
	const intrinsicWidth = video.videoWidth;
	const intrinsicHeight = video.videoHeight;
	if (intrinsicWidth === 0 || intrinsicHeight === 0) {
		return null;
	}

	const videoAspect = intrinsicWidth / intrinsicHeight;
	const containerAspect = containerWidth / containerHeight;

	let width: number;
	let height: number;
	if (containerAspect > videoAspect) {
		height = containerHeight;
		width = height * videoAspect;
	} else {
		width = containerWidth;
		height = width / videoAspect;
	}

	return {
		x: (containerWidth - width) / 2,
		y: (containerHeight - height) / 2,
		width,
		height,
	};
}

export function findFrameSpan(
	frames: OverlayFrame[],
	timeMs: number
): { current: OverlayFrame; next: OverlayFrame | null } | null {
	if (frames.length === 0) {
		return null;
	}

	let low = 0;
	let high = frames.length - 1;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		const frame = frames[mid];
		if (frame && frame.timestampMs <= timeMs) {
			low = mid;
		} else {
			high = mid - 1;
		}
	}

	const current = frames[low];
	if (!current || current.timestampMs > timeMs) {
		return null;
	}
	return { current, next: frames[low + 1] ?? null };
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function drawDetections(
	context: CanvasRenderingContext2D,
	span: { current: OverlayFrame; next: OverlayFrame | null },
	timeMs: number,
	rect: DisplayRect,
	layers: Record<"robots" | "fuel" | "shots", boolean>
): void {
	const { current, next } = span;
	const spanMs = next ? next.timestampMs - current.timestampMs : 0;
	const t =
		next && spanMs > 0 && spanMs < 2000
			? Math.min(1, (timeMs - current.timestampMs) / spanMs)
			: 0;

	const nextByTrack = new Map<number, OverlayDetection>();
	if (next) {
		for (const detection of next.detections) {
			if (detection.trackId !== undefined) {
				nextByTrack.set(detection.trackId, detection);
			}
		}
	}

	for (const detection of current.detections) {
		const isRobot = detection.label === "robot";
		if (isRobot && !layers.robots) {
			continue;
		}
		if (!(isRobot || layers.fuel)) {
			continue;
		}

		const bbox = interpolatedBbox(detection, isRobot, nextByTrack, t);
		const px = rect.x + bbox.x * rect.width;
		const py = rect.y + bbox.y * rect.height;
		const pw = bbox.w * rect.width;
		const ph = bbox.h * rect.height;

		if (isRobot) {
			drawRobotBox(context, detection, px, py, pw, ph);
		} else {
			drawFuelMarker(context, px, py, pw, ph);
		}
	}
}

function interpolatedBbox(
	detection: OverlayDetection,
	isRobot: boolean,
	nextByTrack: Map<number, OverlayDetection>,
	t: number
): { h: number; w: number; x: number; y: number } {
	const bbox = detection.bbox;
	if (!isRobot || detection.trackId === undefined || t <= 0) {
		return bbox;
	}
	const upcoming = nextByTrack.get(detection.trackId);
	if (!upcoming) {
		return bbox;
	}
	return {
		x: lerp(bbox.x, upcoming.bbox.x, t),
		y: lerp(bbox.y, upcoming.bbox.y, t),
		w: lerp(bbox.w, upcoming.bbox.w, t),
		h: lerp(bbox.h, upcoming.bbox.h, t),
	};
}

function drawRobotBox(
	context: CanvasRenderingContext2D,
	detection: OverlayDetection,
	px: number,
	py: number,
	pw: number,
	ph: number
): void {
	const colour = ALLIANCE_COLOURS[detection.alliance ?? "unknown"];
	context.strokeStyle = colour;
	context.lineWidth = 1.5;
	context.strokeRect(px, py, pw, ph);

	const label =
		detection.trackId === undefined ? "robot" : `R${detection.trackId}`;
	context.font = "9px ui-monospace, monospace";
	const textWidth = context.measureText(label).width;
	context.fillStyle = colour;
	context.fillRect(px, py - 11, textWidth + 6, 11);
	context.fillStyle = "#000";
	context.fillText(label, px + 3, py - 3);
}

function drawFuelMarker(
	context: CanvasRenderingContext2D,
	px: number,
	py: number,
	pw: number,
	ph: number
): void {
	context.strokeStyle = FUEL_COLOUR;
	context.lineWidth = 1;
	context.beginPath();
	context.ellipse(
		px + pw / 2,
		py + ph / 2,
		Math.max(2, pw / 2),
		Math.max(2, ph / 2),
		0,
		0,
		Math.PI * 2
	);
	context.stroke();
}

export function drawShotFlashes(
	context: CanvasRenderingContext2D,
	shots: {
		timestampMs: number;
		origin: { x: number; y: number };
		alliance: string;
	}[],
	timeMs: number,
	rect: DisplayRect
): void {
	for (const shot of shots) {
		const age = timeMs - shot.timestampMs;
		if (age < 0 || age > SHOT_FLASH_MS) {
			continue;
		}
		const progress = age / SHOT_FLASH_MS;
		const radius = 6 + progress * 22;
		const alpha = 1 - progress;
		const colour = ALLIANCE_COLOURS[shot.alliance] ?? ALLIANCE_COLOURS.unknown;

		const px = rect.x + shot.origin.x * rect.width;
		const py = rect.y + shot.origin.y * rect.height;

		context.save();
		context.globalAlpha = alpha;
		context.strokeStyle = colour;
		context.lineWidth = 2;
		context.beginPath();
		context.arc(px, py, radius, 0, Math.PI * 2);
		context.stroke();
		context.restore();
	}
}

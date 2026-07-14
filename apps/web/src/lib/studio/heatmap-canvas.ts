export interface HeatPoint {
	weight?: number;
	x: number;
	y: number;
}

const GRID_WIDTH = 120;
const GRID_HEIGHT = 68;
const SPLAT_RADIUS = 3;

const STOPS: [number, [number, number, number, number]][] = [
	[0, [37, 99, 235, 0]],
	[0.25, [37, 99, 235, 140]],
	[0.5, [34, 211, 238, 180]],
	[0.75, [250, 204, 21, 210]],
	[1, [239, 68, 68, 235]],
];

function colourAt(value: number): [number, number, number, number] {
	const clamped = Math.max(0, Math.min(1, value));
	for (let index = 1; index < STOPS.length; index++) {
		const [stop, colour] = STOPS[index] ?? [1, [0, 0, 0, 0]];
		if (clamped <= stop) {
			const [previousStop, previousColour] = STOPS[index - 1] ?? [0, colour];
			const t = (clamped - previousStop) / (stop - previousStop || 1);
			return [
				Math.round(previousColour[0] + (colour[0] - previousColour[0]) * t),
				Math.round(previousColour[1] + (colour[1] - previousColour[1]) * t),
				Math.round(previousColour[2] + (colour[2] - previousColour[2]) * t),
				Math.round(previousColour[3] + (colour[3] - previousColour[3]) * t),
			];
		}
	}
	return [239, 68, 68, 235];
}

export function buildHeatmapImage(points: HeatPoint[]): ImageData | null {
	if (points.length === 0) {
		return null;
	}

	const grid = new Float32Array(GRID_WIDTH * GRID_HEIGHT);

	for (const point of points) {
		const gridX = point.x * (GRID_WIDTH - 1);
		const gridY = point.y * (GRID_HEIGHT - 1);
		const weight = point.weight ?? 1;

		const minX = Math.max(0, Math.floor(gridX - SPLAT_RADIUS));
		const maxX = Math.min(GRID_WIDTH - 1, Math.ceil(gridX + SPLAT_RADIUS));
		const minY = Math.max(0, Math.floor(gridY - SPLAT_RADIUS));
		const maxY = Math.min(GRID_HEIGHT - 1, Math.ceil(gridY + SPLAT_RADIUS));

		for (let cellY = minY; cellY <= maxY; cellY++) {
			for (let cellX = minX; cellX <= maxX; cellX++) {
				const dx = cellX - gridX;
				const dy = cellY - gridY;
				const distanceSq = dx * dx + dy * dy;
				const sigmaSq = (SPLAT_RADIUS / 2) ** 2;
				grid[cellY * GRID_WIDTH + cellX] +=
					weight * Math.exp(-distanceSq / (2 * sigmaSq));
			}
		}
	}

	let max = 0;
	for (const value of grid) {
		if (value > max) {
			max = value;
		}
	}
	if (max <= 0) {
		return null;
	}

	const image = new ImageData(GRID_WIDTH, GRID_HEIGHT);
	for (let index = 0; index < grid.length; index++) {
		const intensity = Math.sqrt((grid[index] ?? 0) / max);
		const [r, g, b, a] = colourAt(intensity);
		const offset = index * 4;
		image.data[offset] = r;
		image.data[offset + 1] = g;
		image.data[offset + 2] = b;
		image.data[offset + 3] = a;
	}
	return image;
}

export function drawHeatmap(
	canvas: HTMLCanvasElement,
	image: ImageData | null,
	backdrop: HTMLVideoElement | null
): void {
	const context = canvas.getContext("2d");
	if (!context) {
		return;
	}

	const { width, height } = canvas;
	context.clearRect(0, 0, width, height);

	context.fillStyle = "#0a0a0a";
	context.fillRect(0, 0, width, height);

	if (backdrop && backdrop.videoWidth > 0) {
		context.save();
		context.globalAlpha = 0.35;
		context.drawImage(backdrop, 0, 0, width, height);
		context.restore();
	}

	if (!image) {
		return;
	}

	const offscreen = document.createElement("canvas");
	offscreen.width = image.width;
	offscreen.height = image.height;
	const offscreenContext = offscreen.getContext("2d");
	if (!offscreenContext) {
		return;
	}
	offscreenContext.putImageData(image, 0, 0);

	context.save();
	context.imageSmoothingEnabled = true;
	context.drawImage(offscreen, 0, 0, width, height);
	context.restore();
}

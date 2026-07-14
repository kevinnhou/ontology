export interface NormalisedPoint {
	x: number;
	y: number;
}

interface VideoLayout {
	displayHeight: number;
	displayWidth: number;
	intrinsicHeight: number;
	intrinsicWidth: number;
	offsetX: number;
	offsetY: number;
}

export function getVideoLayout(video: HTMLVideoElement): VideoLayout | null {
	const intrinsicWidth = video.videoWidth;
	const intrinsicHeight = video.videoHeight;
	if (intrinsicWidth === 0 || intrinsicHeight === 0) {
		return null;
	}

	const rect = video.getBoundingClientRect();
	const videoAspect = intrinsicWidth / intrinsicHeight;
	const elementAspect = rect.width / rect.height;

	let displayWidth: number;
	let displayHeight: number;
	if (elementAspect > videoAspect) {
		displayHeight = rect.height;
		displayWidth = displayHeight * videoAspect;
	} else {
		displayWidth = rect.width;
		displayHeight = displayWidth / videoAspect;
	}

	const offsetX = rect.left + (rect.width - displayWidth) / 2;
	const offsetY = rect.top + (rect.height - displayHeight) / 2;

	return {
		offsetX,
		offsetY,
		displayWidth,
		displayHeight,
		intrinsicWidth,
		intrinsicHeight,
	};
}

export function screenToNormalised(
	clientX: number,
	clientY: number,
	video: HTMLVideoElement
): NormalisedPoint | null {
	const layout = getVideoLayout(video);
	if (!layout) {
		return null;
	}

	const localX = clientX - layout.offsetX;
	const localY = clientY - layout.offsetY;
	if (
		localX < 0 ||
		localY < 0 ||
		localX > layout.displayWidth ||
		localY > layout.displayHeight
	) {
		return null;
	}

	return {
		x: localX / layout.displayWidth,
		y: localY / layout.displayHeight,
	};
}

export function normalisedToScreen(
	point: NormalisedPoint,
	video: HTMLVideoElement
): { x: number; y: number } | null {
	const layout = getVideoLayout(video);
	if (!layout) {
		return null;
	}

	return {
		x: layout.offsetX + point.x * layout.displayWidth,
		y: layout.offsetY + point.y * layout.displayHeight,
	};
}

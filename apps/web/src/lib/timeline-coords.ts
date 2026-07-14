export function msToPx(
	ms: number,
	durationMs: number,
	trackWidth: number
): number {
	if (durationMs <= 0 || trackWidth <= 0) {
		return 0;
	}
	return (ms / durationMs) * trackWidth;
}

export function pxToMs(
	px: number,
	durationMs: number,
	trackWidth: number
): number {
	if (durationMs <= 0 || trackWidth <= 0) {
		return 0;
	}
	const ratio = Math.min(1, Math.max(0, px / trackWidth));
	return ratio * durationMs;
}

export function clientXToMs(
	clientX: number,
	trackEl: HTMLElement,
	durationMs: number
): number {
	const rect = trackEl.getBoundingClientRect();
	return pxToMs(clientX - rect.left, durationMs, rect.width);
}

export function msToFrameIndex(ms: number, fps: number): number {
	if (fps <= 0) {
		return 0;
	}
	return Math.round((ms / 1000) * fps);
}

export function formatTimeMs(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const mins = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

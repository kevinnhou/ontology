import { R2 } from "@convex-dev/r2";

import { components } from "../_generated/api";

export const VIDEO_URL_EXPIRES_SECONDS = 60 * 60 * 24;

export const r2 = new R2(components.r2);

export function videoKeyForUser(userId: string): string {
	return `videos/${userId}/${crypto.randomUUID()}.mp4`;
}

export function assertVideoKeyOwnedByUser(
	userId: string,
	videoKey: string
): void {
	const prefix = `videos/${userId}/`;
	if (!videoKey.startsWith(prefix)) {
		throw new Error("Invalid video key");
	}
}

export function detectionsKeyForMatch(matchId: string): string {
	return `detections/${matchId}.json.gz`;
}

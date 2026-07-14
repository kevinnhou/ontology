import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

function isAuthorized(request: Request): boolean {
	const secret = process.env.VISION_CALLBACK_SECRET;
	if (!secret) {
		return false;
	}
	return request.headers.get("Authorization") === `Bearer ${secret}`;
}

function unauthorized(): Response {
	return new Response("Unauthorized", { status: 401 });
}

function ok(): Response {
	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

http.route({
	path: "/vision/detections",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!isAuthorized(request)) {
			return unauthorized();
		}
		const body = (await request.json()) as {
			matchId: Id<"matches">;
			frames: {
				frameIndex: number;
				timestampMs: number;
				detections: {
					label: string;
					confidence: number;
					bbox: { x: number; y: number; w: number; h: number };
					trackId?: number | null;
					alliance?: string | null;
				}[];
			}[];
		};
		await ctx.runMutation(internal.processing.ingestDetectionBatch, {
			matchId: body.matchId,
			frames: body.frames.map((frame) => ({
				frameIndex: frame.frameIndex,
				timestampMs: frame.timestampMs,
				detections: frame.detections.map((detection) => ({
					label: detection.label,
					confidence: detection.confidence,
					bbox: detection.bbox,
					trackId: detection.trackId ?? undefined,
					alliance: normaliseAlliance(detection.alliance),
				})),
			})),
		});
		return ok();
	}),
});

http.route({
	path: "/vision/progress",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!isAuthorized(request)) {
			return unauthorized();
		}
		const body = (await request.json()) as {
			matchId: Id<"matches">;
			processedFrames: number;
			totalFrames: number;
		};
		await ctx.runMutation(internal.processing.setProgress, {
			matchId: body.matchId,
			processedFrames: body.processedFrames,
			totalFrames: body.totalFrames,
		});
		return ok();
	}),
});

http.route({
	path: "/vision/complete",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!isAuthorized(request)) {
			return unauthorized();
		}
		const body = (await request.json()) as {
			matchId: Id<"matches">;
			shotEvents: {
				trackId?: number | null;
				alliance?: string | null;
				frameIndex: number;
				timestampMs: number;
				origin: { x: number; y: number };
				speed: number;
			}[];
			analytics: {
				totalShots: number;
				shotsByAlliance: { red: number; blue: number; unknown: number };
				shotsPerMinute: number;
				avgShotSpeed: number;
				byTrack: {
					trackId: number;
					alliance?: string | null;
					shots: number;
					avgSpeed: number;
				}[];
				processedFrames: number;
				processedDurationMs: number;
			};
		};
		await ctx.runMutation(internal.processing.finalize, {
			matchId: body.matchId,
			shotEvents: body.shotEvents.map((event) => ({
				trackId: event.trackId ?? undefined,
				alliance: normaliseAlliance(event.alliance) ?? "unknown",
				frameIndex: event.frameIndex,
				timestampMs: event.timestampMs,
				origin: event.origin,
				speed: event.speed,
			})),
			analytics: {
				...body.analytics,
				byTrack: body.analytics.byTrack.map((track) => ({
					...track,
					alliance: normaliseAlliance(track.alliance) ?? "unknown",
				})),
			},
		});
		return ok();
	}),
});

http.route({
	path: "/vision/failed",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!isAuthorized(request)) {
			return unauthorized();
		}
		const body = (await request.json()) as {
			matchId: Id<"matches">;
			error: string;
		};
		await ctx.runMutation(internal.processing.markFailed, {
			matchId: body.matchId,
			error: body.error,
		});
		return ok();
	}),
});

function normaliseAlliance(
	value: string | null | undefined
): "red" | "blue" | "unknown" | undefined {
	if (value === "red" || value === "blue" || value === "unknown") {
		return value;
	}
	return undefined;
}

export default http;

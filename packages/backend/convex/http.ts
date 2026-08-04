import { httpRouter } from "convex/server";
import { z } from "zod";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { r2, VIDEO_URL_EXPIRES_SECONDS } from "./lib/r2";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

const workerClaimSchema = z.object({
	workerId: z.string().trim().min(1).max(200),
});

const progressSchema = z.object({
	jobId: z.string().min(1),
	runId: z.string().min(1),
	processedFrames: z.number().int().nonnegative(),
	totalFrames: z.number().int().nonnegative(),
});

const heartbeatSchema = z.object({
	jobId: z.string().min(1),
	runId: z.string().min(1),
});

const failureSchema = z.object({
	jobId: z.string().min(1),
	runId: z.string().min(1),
	error: z.string().trim().min(1).max(500),
});

const completionSchema = z.object({
	jobId: z.string().min(1),
	runId: z.string().min(1),
	shotEvents: z.array(
		z.object({
			trackId: z.number().int().nullable().optional(),
			alliance: z.string().nullable().optional(),
			frameIndex: z.number().int(),
			timestampMs: z.number(),
			origin: z.object({
				x: z.number(),
				y: z.number(),
			}),
			speed: z.number(),
		})
	),
	analytics: z.object({
		totalShots: z.number(),
		shotsByAlliance: z.object({
			red: z.number(),
			blue: z.number(),
			unknown: z.number(),
		}),
		shotsPerMinute: z.number(),
		avgShotSpeed: z.number(),
		byTrack: z.array(
			z.object({
				trackId: z.number().int(),
				alliance: z.string().nullable().optional(),
				shots: z.number(),
				avgSpeed: z.number(),
			})
		),
		processedFrames: z.number(),
		processedDurationMs: z.number(),
	}),
	pathSamples: z.array(
		z.object({
			bucketIndex: z.number().int(),
			points: z.array(
				z.object({
					x: z.number(),
					y: z.number(),
					alliance: z.string().nullable().optional(),
					timestampMs: z.number(),
				})
			),
		})
	),
});

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

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
		},
	});
}

function badRequest(): Response {
	return jsonResponse({ ok: false, error: "Invalid request body" }, 400);
}

function stale(): Response {
	return jsonResponse({ ok: false, error: "Stale vision job run" }, 409);
}

async function parseBody<T>(
	request: Request,
	schema: z.ZodType<T>
): Promise<T | null> {
	try {
		const parsed = schema.safeParse(await request.json());
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

http.route({
	path: "/vision/claim",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!isAuthorized(request)) {
			return unauthorized();
		}

		const body = await parseBody(request, workerClaimSchema);
		if (!body) {
			return badRequest();
		}

		const claimed = await ctx.runMutation(internal.processing.claimNext, {
			workerId: body.workerId,
		});
		if (!claimed) {
			return new Response(null, { status: 204 });
		}

		const callbackUrl = process.env.CONVEX_SITE_URL;
		if (!callbackUrl) {
			await ctx.runMutation(internal.processing.markFailed, {
				jobId: claimed.jobId,
				runId: claimed.runId,
				error: "CONVEX_SITE_URL is not configured",
			});
			return jsonResponse(
				{ ok: false, error: "Vision callback URL is not configured" },
				503
			);
		}

		try {
			const videoUrl = await r2.getUrl(claimed.videoKey, {
				expiresIn: VIDEO_URL_EXPIRES_SECONDS,
			});
			const { url: detectionsUploadUrl } = await r2.generateUploadUrl(
				claimed.detectionsKey
			);

			return jsonResponse({
				...claimed,
				fps: claimed.fps ?? null,
				callbackUrl,
				videoUrl,
				detectionsUploadUrl,
			});
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Could not prepare vision job URLs";
			await ctx.runMutation(internal.processing.markFailed, {
				jobId: claimed.jobId,
				runId: claimed.runId,
				error: message,
			});
			return jsonResponse(
				{ ok: false, error: "Could not prepare vision job" },
				503
			);
		}
	}),
});

http.route({
	path: "/vision/progress",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!isAuthorized(request)) {
			return unauthorized();
		}

		const body = await parseBody(request, progressSchema);
		if (!body) {
			return badRequest();
		}

		const result = await ctx.runMutation(internal.processing.setProgress, {
			jobId: body.jobId as Id<"visionJobs">,
			runId: body.runId,
			processedFrames: body.processedFrames,
			totalFrames: body.totalFrames,
		});
		return result === "stale" ? stale() : jsonResponse({ ok: true });
	}),
});

http.route({
	path: "/vision/heartbeat",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!isAuthorized(request)) {
			return unauthorized();
		}

		const body = await parseBody(request, heartbeatSchema);
		if (!body) {
			return badRequest();
		}

		const result = await ctx.runMutation(internal.processing.heartbeat, {
			jobId: body.jobId as Id<"visionJobs">,
			runId: body.runId,
		});
		return result === "stale" ? stale() : jsonResponse({ ok: true });
	}),
});

http.route({
	path: "/vision/complete",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!isAuthorized(request)) {
			return unauthorized();
		}

		const body = await parseBody(request, completionSchema);
		if (!body) {
			return badRequest();
		}

		const result = await ctx.runMutation(internal.processing.finalise, {
			jobId: body.jobId as Id<"visionJobs">,
			runId: body.runId,
			shotEvents: body.shotEvents.map((event) => ({
				trackId: event.trackId ?? undefined,
				alliance: normaliseAlliance(event.alliance) ?? "unknown",
				frameIndex: event.frameIndex,
				timestampMs: event.timestampMs,
				origin: event.origin,
				speed: event.speed,
			})),
			analytics: {
				totalShots: body.analytics.totalShots,
				shotsByAlliance: body.analytics.shotsByAlliance,
				shotsPerMinute: body.analytics.shotsPerMinute,
				avgShotSpeed: body.analytics.avgShotSpeed,
				byTrack: body.analytics.byTrack.map((track) => ({
					trackId: track.trackId,
					alliance: normaliseAlliance(track.alliance) ?? "unknown",
					shots: track.shots,
					avgSpeed: track.avgSpeed,
				})),
				processedFrames: body.analytics.processedFrames,
				processedDurationMs: body.analytics.processedDurationMs,
			},
			pathSamples: body.pathSamples.map((bucket) => ({
				bucketIndex: bucket.bucketIndex,
				points: bucket.points.map((point) => ({
					x: point.x,
					y: point.y,
					timestampMs: point.timestampMs,
					alliance: normaliseAlliance(point.alliance),
				})),
			})),
		});

		if (result === "stale") {
			return stale();
		}
		return jsonResponse({ ok: true, duplicate: result === "duplicate" });
	}),
});

http.route({
	path: "/vision/failed",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!isAuthorized(request)) {
			return unauthorized();
		}

		const body = await parseBody(request, failureSchema);
		if (!body) {
			return badRequest();
		}

		const result = await ctx.runMutation(internal.processing.markFailed, {
			jobId: body.jobId as Id<"visionJobs">,
			runId: body.runId,
			error: body.error,
		});
		return result === "stale" ? stale() : jsonResponse({ ok: true });
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

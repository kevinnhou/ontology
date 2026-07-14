import {
	computeEffectiveRanges,
	deriveMatchSections,
	normaliseSectionAnalyse,
} from "@ontology/shared";
import { type Infer, v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation } from "./_generated/server";
import { requireUser, userIdFromAuth } from "./auth";
import { r2, VIDEO_URL_EXPIRES_SECONDS } from "./lib/r2";
import {
	detectionValidator,
	matchAnalyticsValidator,
	type pathSamplePointValidator,
	shotEventValidator,
	timeRangeValidator,
} from "./lib/validators";

const TRAILING_SLASH = /\/$/;
const CLEAR_BATCH_SIZE = 500;
const PATH_SAMPLE_BUCKET_MS = 5000;

const preparedValidator = v.object({
	videoKey: v.string(),
	frameStride: v.number(),
	fps: v.union(v.number(), v.null()),
	ranges: v.array(timeRangeValidator),
});

const detectionFrameValidator = v.object({
	frameIndex: v.number(),
	timestampMs: v.number(),
	detections: v.array(detectionValidator),
});

type DetectionFrame = Infer<typeof detectionFrameValidator>;
type PathSamplePoint = Infer<typeof pathSamplePointValidator>;

function extractRobotPoints(frame: DetectionFrame): PathSamplePoint[] {
	return frame.detections
		.filter((detection) => detection.label === "robot")
		.map((detection) => ({
			x: detection.bbox.x + detection.bbox.w / 2,
			y: detection.bbox.y + detection.bbox.h / 2,
			alliance: detection.alliance,
			timestampMs: frame.timestampMs,
		}));
}

export const startProcessing = action({
	args: { matchId: v.id("matches") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const user = await requireUser(ctx);

		const prepared = await ctx.runMutation(internal.processing.prepare, {
			matchId: args.matchId,
			userId: userIdFromAuth(user),
		});

		const visionUrl = process.env.VISION_SERVICE_URL;
		const callbackUrl = process.env.CONVEX_SITE_URL;
		if (!(visionUrl && callbackUrl)) {
			await ctx.runMutation(internal.processing.markFailed, {
				matchId: args.matchId,
				error: "Vision service is not configured",
			});
			throw new Error("Vision service is not configured");
		}

		const videoUrl = await r2.getUrl(prepared.videoKey, {
			expiresIn: VIDEO_URL_EXPIRES_SECONDS,
		});

		try {
			const response = await fetch(
				`${visionUrl.replace(TRAILING_SLASH, "")}/process`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						matchId: args.matchId,
						videoUrl,
						callbackUrl,
						frameStride: prepared.frameStride,
						ranges: prepared.ranges,
						fps: prepared.fps ?? undefined,
					}),
				}
			);
			if (!response.ok) {
				throw new Error(`Vision service responded with ${response.status}`);
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Vision service unreachable";
			await ctx.runMutation(internal.processing.markFailed, {
				matchId: args.matchId,
				error: message,
			});
			throw new Error(message);
		}

		return null;
	},
});

export const prepare = internalMutation({
	args: {
		matchId: v.id("matches"),
		userId: v.string(),
	},
	returns: preparedValidator,
	handler: async (ctx, args) => {
		const match = await ctx.db.get(args.matchId);
		if (!match || match.userId !== args.userId) {
			throw new Error("Match not found");
		}
		if (match.status === "processing") {
			throw new Error("Match is already processing");
		}
		if (!match.durationMs) {
			throw new Error("Video metadata not available yet");
		}
		if (match.matchStartMs === undefined) {
			throw new Error("Set the match start before processing");
		}

		const sections = deriveMatchSections(
			match.matchStartMs,
			match.durationMs,
			normaliseSectionAnalyse(match.sectionAnalyse)
		);
		const ranges = computeEffectiveRanges(
			sections,
			match.processingRange,
			match.durationMs
		);
		if (ranges.length === 0) {
			throw new Error("No sections selected for processing");
		}

		await ctx.scheduler.runAfter(0, internal.processing.clearStaleData, {
			matchId: args.matchId,
		});

		await ctx.db.patch(args.matchId, {
			status: "processing",
			progress: { processedFrames: 0, totalFrames: 0 },
			error: undefined,
			processedRanges: ranges,
		});

		return {
			videoKey: match.videoKey,
			frameStride: match.frameStride,
			fps: match.fps ?? null,
			ranges,
		};
	},
});

export const clearStaleData = internalMutation({
	args: { matchId: v.id("matches") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const staleDetections = await ctx.db
			.query("frameDetections")
			.withIndex("by_match_and_frame", (q) => q.eq("matchId", args.matchId))
			.take(CLEAR_BATCH_SIZE);
		for (const row of staleDetections) {
			await ctx.db.delete(row._id);
		}

		const stalePathSamples = await ctx.db
			.query("pathSamples")
			.withIndex("by_match_and_bucket", (q) => q.eq("matchId", args.matchId))
			.take(CLEAR_BATCH_SIZE);
		for (const row of stalePathSamples) {
			await ctx.db.delete(row._id);
		}

		const staleShots = await ctx.db
			.query("shotEvents")
			.withIndex("by_match", (q) => q.eq("matchId", args.matchId))
			.take(CLEAR_BATCH_SIZE);
		for (const row of staleShots) {
			await ctx.db.delete(row._id);
		}

		const hasMore =
			staleDetections.length === CLEAR_BATCH_SIZE ||
			stalePathSamples.length === CLEAR_BATCH_SIZE ||
			staleShots.length === CLEAR_BATCH_SIZE;

		if (hasMore) {
			await ctx.scheduler.runAfter(0, internal.processing.clearStaleData, args);
		}

		return null;
	},
});

export const ingestDetectionBatch = internalMutation({
	args: {
		matchId: v.id("matches"),
		frames: v.array(detectionFrameValidator),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const match = await ctx.db.get(args.matchId);
		if (!match) {
			throw new Error("Match not found");
		}

		const bucketPoints = new Map<number, PathSamplePoint[]>();

		for (const frame of args.frames) {
			await ctx.db.insert("frameDetections", {
				matchId: args.matchId,
				frameIndex: frame.frameIndex,
				timestampMs: frame.timestampMs,
				detections: frame.detections,
			});

			const points = extractRobotPoints(frame);
			if (points.length === 0) {
				continue;
			}
			const bucketIndex = Math.floor(frame.timestampMs / PATH_SAMPLE_BUCKET_MS);
			const existingPoints = bucketPoints.get(bucketIndex) ?? [];
			existingPoints.push(...points);
			bucketPoints.set(bucketIndex, existingPoints);
		}

		for (const [bucketIndex, points] of bucketPoints) {
			const existingBucket = await ctx.db
				.query("pathSamples")
				.withIndex("by_match_and_bucket", (q) =>
					q.eq("matchId", args.matchId).eq("bucketIndex", bucketIndex)
				)
				.unique();
			if (existingBucket) {
				await ctx.db.patch(existingBucket._id, {
					points: [...existingBucket.points, ...points],
				});
			} else {
				await ctx.db.insert("pathSamples", {
					matchId: args.matchId,
					bucketIndex,
					points,
				});
			}
		}

		return null;
	},
});

export const setProgress = internalMutation({
	args: {
		matchId: v.id("matches"),
		processedFrames: v.number(),
		totalFrames: v.number(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const match = await ctx.db.get(args.matchId);
		if (!match) {
			throw new Error("Match not found");
		}
		await ctx.db.patch(args.matchId, {
			progress: {
				processedFrames: args.processedFrames,
				totalFrames: args.totalFrames,
			},
		});
		return null;
	},
});

export const finalize = internalMutation({
	args: {
		matchId: v.id("matches"),
		shotEvents: v.array(shotEventValidator),
		analytics: matchAnalyticsValidator,
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const match = await ctx.db.get(args.matchId);
		if (!match) {
			throw new Error("Match not found");
		}

		for (const event of args.shotEvents) {
			await ctx.db.insert("shotEvents", {
				matchId: args.matchId,
				...event,
			});
		}

		const existing = await ctx.db
			.query("matchAnalytics")
			.withIndex("by_match", (q) => q.eq("matchId", args.matchId))
			.unique();
		if (existing) {
			await ctx.db.patch(existing._id, {
				analytics: args.analytics,
				updatedAt: Date.now(),
			});
		} else {
			await ctx.db.insert("matchAnalytics", {
				matchId: args.matchId,
				analytics: args.analytics,
				updatedAt: Date.now(),
			});
		}

		await ctx.db.patch(args.matchId, { status: "ready", error: undefined });
		return null;
	},
});

export const markFailed = internalMutation({
	args: {
		matchId: v.id("matches"),
		error: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const match = await ctx.db.get(args.matchId);
		if (!match) {
			throw new Error("Match not found");
		}
		await ctx.db.patch(args.matchId, {
			status: "failed",
			error: args.error,
		});
		return null;
	},
});

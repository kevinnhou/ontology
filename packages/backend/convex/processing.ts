import {
	computeEffectiveRanges,
	deriveMatchSections,
	normaliseSectionAnalyse,
} from "@ontology/shared";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation } from "./_generated/server";
import { requireUser, userIdFromAuth } from "./auth";
import { detectionsKeyForMatch, r2, VIDEO_URL_EXPIRES_SECONDS } from "./lib/r2";
import {
	matchAnalyticsValidator,
	pathSamplePointValidator,
	shotEventValidator,
	timeRangeValidator,
} from "./lib/validators";

const TRAILING_SLASH = /\/$/;
const CLEAR_BATCH_SIZE = 500;

const preparedValidator = v.object({
	videoKey: v.string(),
	frameStride: v.number(),
	fps: v.union(v.number(), v.null()),
	ranges: v.array(timeRangeValidator),
	detectionsKey: v.string(),
});

const pathSampleBucketValidator = v.object({
	bucketIndex: v.number(),
	points: v.array(pathSamplePointValidator),
});

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
		const { url: detectionsUploadUrl } = await r2.generateUploadUrl(
			prepared.detectionsKey
		);

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
						detectionsUploadUrl,
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

		const detectionsKey = detectionsKeyForMatch(args.matchId);
		if (match.detectionsKey) {
			await r2.deleteObject(ctx, match.detectionsKey);
		}

		await ctx.scheduler.runAfter(0, internal.processing.clearStaleData, {
			matchId: args.matchId,
		});

		await ctx.db.patch(args.matchId, {
			status: "processing",
			progress: { processedFrames: 0, totalFrames: 0 },
			error: undefined,
			processedRanges: ranges,
			detectionsKey: undefined,
		});

		return {
			videoKey: match.videoKey,
			frameStride: match.frameStride,
			fps: match.fps ?? null,
			ranges,
			detectionsKey,
		};
	},
});

export const clearStaleData = internalMutation({
	args: { matchId: v.id("matches") },
	returns: v.null(),
	handler: async (ctx, args) => {
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
			stalePathSamples.length === CLEAR_BATCH_SIZE ||
			staleShots.length === CLEAR_BATCH_SIZE;

		if (hasMore) {
			await ctx.scheduler.runAfter(0, internal.processing.clearStaleData, args);
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

export const finalise = internalMutation({
	args: {
		matchId: v.id("matches"),
		shotEvents: v.array(shotEventValidator),
		analytics: matchAnalyticsValidator,
		pathSamples: v.array(pathSampleBucketValidator),
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

		for (const bucket of args.pathSamples) {
			await ctx.db.insert("pathSamples", {
				matchId: args.matchId,
				bucketIndex: bucket.bucketIndex,
				points: bucket.points,
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

		await ctx.db.patch(args.matchId, {
			status: "ready",
			error: undefined,
			detectionsKey: detectionsKeyForMatch(args.matchId),
		});
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

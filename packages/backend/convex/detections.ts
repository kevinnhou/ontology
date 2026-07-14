import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser, userIdFromAuth } from "./auth";
import { detectionValidator, pathSamplePointValidator } from "./lib/validators";

const frameDetectionValidator = v.object({
	_id: v.id("frameDetections"),
	_creationTime: v.number(),
	matchId: v.id("matches"),
	frameIndex: v.number(),
	timestampMs: v.number(),
	detections: v.array(detectionValidator),
});

const MAX_WINDOW_MS = 60_000;

export const listWindow = query({
	args: {
		matchId: v.id("matches"),
		startMs: v.number(),
		endMs: v.number(),
	},
	returns: v.array(frameDetectionValidator),
	handler: async (ctx, args) => {
		const user = await requireUser(ctx);
		const match = await ctx.db.get(args.matchId);
		if (!match || match.userId !== userIdFromAuth(user)) {
			return [];
		}

		if (args.endMs < args.startMs) {
			throw new Error("endMs must be greater than or equal to startMs");
		}
		if (args.endMs - args.startMs > MAX_WINDOW_MS) {
			throw new Error(`Window too large: max ${MAX_WINDOW_MS}ms per request`);
		}

		return await ctx.db
			.query("frameDetections")
			.withIndex("by_match_and_timestamp", (q) =>
				q
					.eq("matchId", args.matchId)
					.gte("timestampMs", args.startMs)
					.lte("timestampMs", args.endMs)
			)
			.collect();
	},
});

export const listPathSamples = query({
	args: {
		matchId: v.id("matches"),
	},
	returns: v.array(pathSamplePointValidator),
	handler: async (ctx, args) => {
		const user = await requireUser(ctx);
		const match = await ctx.db.get(args.matchId);
		if (!match || match.userId !== userIdFromAuth(user)) {
			return [];
		}

		const buckets = await ctx.db
			.query("pathSamples")
			.withIndex("by_match_and_bucket", (q) => q.eq("matchId", args.matchId))
			.collect();

		return buckets.flatMap((bucket) => bucket.points);
	},
});

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser, userIdFromAuth } from "./auth";
import { r2, VIDEO_URL_EXPIRES_SECONDS } from "./lib/r2";
import { pathSamplePointValidator } from "./lib/validators";

export const getDetectionsUrl = query({
	args: {
		matchId: v.id("matches"),
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		const user = await requireUser(ctx);
		const match = await ctx.db.get(args.matchId);
		if (!match || match.userId !== userIdFromAuth(user)) {
			return null;
		}
		if (!match.detectionsKey) {
			return null;
		}

		return await r2.getUrl(match.detectionsKey, {
			expiresIn: VIDEO_URL_EXPIRES_SECONDS,
		});
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

		const buckets = match.visionJobId
			? await ctx.db
					.query("pathSamples")
					.withIndex("by_match_and_job_and_bucket", (q) =>
						q.eq("matchId", args.matchId).eq("visionJobId", match.visionJobId)
					)
					.collect()
			: await ctx.db
					.query("pathSamples")
					.withIndex("by_match_and_bucket", (q) =>
						q.eq("matchId", args.matchId)
					)
					.collect();

		return buckets.flatMap((bucket) => bucket.points);
	},
});

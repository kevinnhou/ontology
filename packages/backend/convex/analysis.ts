import { v } from "convex/values";

import { query } from "./_generated/server";
import { requireUser, userIdFromAuth } from "./auth";
import {
	allianceValidator,
	matchAnalyticsValidator,
	pointValidator,
} from "./lib/validators";

const shotEventDocValidator = v.object({
	_id: v.id("shotEvents"),
	_creationTime: v.number(),
	matchId: v.id("matches"),
	visionJobId: v.optional(v.id("visionJobs")),
	trackId: v.optional(v.number()),
	alliance: allianceValidator,
	frameIndex: v.number(),
	timestampMs: v.number(),
	origin: pointValidator,
	speed: v.number(),
});

export const listShotEvents = query({
	args: { matchId: v.id("matches") },
	returns: v.array(shotEventDocValidator),
	handler: async (ctx, args) => {
		const user = await requireUser(ctx);
		const match = await ctx.db.get(args.matchId);
		if (!match || match.userId !== userIdFromAuth(user)) {
			return [];
		}
		if (match.visionJobId) {
			return await ctx.db
				.query("shotEvents")
				.withIndex("by_match_and_job", (q) =>
					q.eq("matchId", args.matchId).eq("visionJobId", match.visionJobId)
				)
				.collect();
		}

		return await ctx.db
			.query("shotEvents")
			.withIndex("by_match", (q) => q.eq("matchId", args.matchId))
			.collect();
	},
});

export const getAnalytics = query({
	args: { matchId: v.id("matches") },
	returns: v.union(matchAnalyticsValidator, v.null()),
	handler: async (ctx, args) => {
		const user = await requireUser(ctx);
		const match = await ctx.db.get(args.matchId);
		if (!match || match.userId !== userIdFromAuth(user)) {
			return null;
		}
		const row = await ctx.db
			.query("matchAnalytics")
			.withIndex("by_match", (q) => q.eq("matchId", args.matchId))
			.unique();
		return row?.analytics ?? null;
	},
});

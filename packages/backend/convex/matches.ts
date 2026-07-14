import {
	buildTimelineFromMatch,
	DEFAULT_SECTION_ANALYSE,
	defaultProcessingRange,
	type SectionAnalyse,
} from "@ontology/shared";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireUser, userIdFromAuth } from "./auth";
import {
	assertVideoKeyOwnedByUser,
	r2,
	VIDEO_URL_EXPIRES_SECONDS,
} from "./lib/r2";
import {
	matchStartSourceValidator,
	matchStatusValidator,
	processingRangeValidator,
	sectionAnalyseValidator,
	timeRangeValidator,
} from "./lib/validators";

const DEFAULT_FRAME_STRIDE = 5;

const matchDocValidator = v.object({
	_id: v.id("matches"),
	_creationTime: v.number(),
	userId: v.string(),
	title: v.string(),
	source: v.literal("upload"),
	videoKey: v.string(),
	status: matchStatusValidator,
	fps: v.optional(v.number()),
	durationMs: v.optional(v.number()),
	width: v.optional(v.number()),
	height: v.optional(v.number()),
	frameCount: v.optional(v.number()),
	frameStride: v.number(),
	progress: v.optional(
		v.object({
			processedFrames: v.number(),
			totalFrames: v.number(),
		})
	),
	error: v.optional(v.string()),
	matchStartMs: v.optional(v.number()),
	matchStartSource: v.optional(matchStartSourceValidator),
	sectionAnalyse: v.optional(sectionAnalyseValidator),
	processingRange: v.optional(processingRangeValidator),
	processedRanges: v.optional(v.array(timeRangeValidator)),
	createdAt: v.number(),
});

const matchWithUrlValidator = v.object({
	match: matchDocValidator,
	videoUrl: v.union(v.string(), v.null()),
});

const timelineValidator = v.object({
	matchStartMs: v.union(v.number(), v.null()),
	matchStartSource: v.union(matchStartSourceValidator, v.null()),
	sectionAnalyse: v.union(sectionAnalyseValidator, v.null()),
	processingRange: v.union(processingRangeValidator, v.null()),
	durationMs: v.number(),
	fps: v.union(v.number(), v.null()),
});

async function requireOwnedMatch(
	ctx: QueryCtx | MutationCtx,
	matchId: Id<"matches">
) {
	const user = await requireUser(ctx);
	const match = await ctx.db.get(matchId);
	if (!match || match.userId !== userIdFromAuth(user)) {
		throw new Error("Match not found");
	}
	return { user, match };
}

export const createFromUpload = mutation({
	args: {
		videoKey: v.string(),
		title: v.string(),
	},
	returns: v.id("matches"),
	handler: async (ctx, args) => {
		const user = await requireUser(ctx);
		const userId = userIdFromAuth(user);
		assertVideoKeyOwnedByUser(userId, args.videoKey);
		const now = Date.now();

		return await ctx.db.insert("matches", {
			userId,
			title: args.title,
			source: "upload",
			videoKey: args.videoKey,
			status: "pending",
			frameStride: DEFAULT_FRAME_STRIDE,
			createdAt: now,
		});
	},
});

export const get = query({
	args: { matchId: v.id("matches") },
	returns: v.union(matchWithUrlValidator, v.null()),
	handler: async (ctx, args) => {
		const user = await requireUser(ctx);
		const match = await ctx.db.get(args.matchId);
		if (!match || match.userId !== userIdFromAuth(user)) {
			return null;
		}

		const videoUrl = await r2.getUrl(match.videoKey, {
			expiresIn: VIDEO_URL_EXPIRES_SECONDS,
		});
		return { match, videoUrl };
	},
});

export const listByUser = query({
	args: {},
	returns: v.array(matchDocValidator),
	handler: async (ctx) => {
		const user = await requireUser(ctx);
		return await ctx.db
			.query("matches")
			.withIndex("by_user", (q) => q.eq("userId", userIdFromAuth(user)))
			.order("desc")
			.collect();
	},
});

export const updateProbeMetadata = mutation({
	args: {
		matchId: v.id("matches"),
		durationMs: v.number(),
		fps: v.optional(v.number()),
		width: v.number(),
		height: v.number(),
		frameCount: v.optional(v.number()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { match } = await requireOwnedMatch(ctx, args.matchId);

		if (match.durationMs !== undefined) {
			return null;
		}

		const patch: {
			durationMs: number;
			fps?: number;
			width: number;
			height: number;
			frameCount?: number;
		} = {
			durationMs: args.durationMs,
			width: args.width,
			height: args.height,
		};

		if (args.fps !== undefined) {
			patch.fps = args.fps;
		}
		if (args.frameCount !== undefined) {
			patch.frameCount = args.frameCount;
		}

		await ctx.db.patch(args.matchId, patch);

		return null;
	},
});

export const setMatchStart = mutation({
	args: {
		matchId: v.id("matches"),
		matchStartMs: v.number(),
		matchStartSource: matchStartSourceValidator,
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { match } = await requireOwnedMatch(ctx, args.matchId);
		const durationMs = match.durationMs ?? 0;

		if (args.matchStartMs < 0) {
			throw new Error("Match start must be non-negative");
		}
		if (durationMs > 0 && args.matchStartMs >= durationMs) {
			throw new Error("Match start must be within video duration");
		}

		const patch: {
			matchStartMs: number;
			matchStartSource: "manual" | "audio" | "metadata";
			sectionAnalyse?: typeof DEFAULT_SECTION_ANALYSE;
			processingRange?: { startMs: number; endMs: number };
		} = {
			matchStartMs: args.matchStartMs,
			matchStartSource: args.matchStartSource,
		};

		if (!match.sectionAnalyse) {
			patch.sectionAnalyse = DEFAULT_SECTION_ANALYSE;
		}

		if (!match.processingRange) {
			patch.processingRange = defaultProcessingRange(args.matchStartMs);
		}

		await ctx.db.patch(args.matchId, patch);
		return null;
	},
});

export const updateTimeline = mutation({
	args: {
		matchId: v.id("matches"),
		sectionAnalyse: v.optional(sectionAnalyseValidator),
		processingRange: v.optional(processingRangeValidator),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { match } = await requireOwnedMatch(ctx, args.matchId);
		const durationMs = match.durationMs ?? 0;

		const patch: {
			sectionAnalyse?: SectionAnalyse;
			processingRange?: { startMs: number; endMs: number };
		} = {};

		if (args.sectionAnalyse) {
			patch.sectionAnalyse = args.sectionAnalyse;
		}

		if (args.processingRange) {
			const { startMs, endMs } = args.processingRange;
			if (startMs < 0 || endMs > durationMs || startMs >= endMs) {
				throw new Error("Invalid processing range");
			}
			patch.processingRange = args.processingRange;
		}

		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(args.matchId, patch);
		}

		return null;
	},
});

export const getTimeline = query({
	args: { matchId: v.id("matches") },
	returns: v.union(timelineValidator, v.null()),
	handler: async (ctx, args) => {
		const user = await requireUser(ctx);
		const match = await ctx.db.get(args.matchId);
		if (!match || match.userId !== userIdFromAuth(user)) {
			return null;
		}

		return buildTimelineFromMatch(match);
	},
});

import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireUser, userIdFromAuth } from "./auth";
import { annotationStyleValidator, geometryValidator } from "./lib/validators";

const annotationDocValidator = v.object({
	_id: v.id("annotations"),
	_creationTime: v.number(),
	matchId: v.id("matches"),
	userId: v.string(),
	frameIndex: v.number(),
	frameEnd: v.optional(v.number()),
	geometry: geometryValidator,
	text: v.optional(v.string()),
	style: v.optional(annotationStyleValidator),
	createdAt: v.number(),
	updatedAt: v.number(),
});

async function requireMatchOwnership(
	ctx: QueryCtx | MutationCtx,
	matchId: Id<"matches">,
	userId: string
) {
	const match = await ctx.db.get(matchId);
	if (!match || match.userId !== userId) {
		throw new Error("Match not found");
	}
	return match;
}

export const create = mutation({
	args: {
		matchId: v.id("matches"),
		frameIndex: v.number(),
		frameEnd: v.optional(v.number()),
		geometry: geometryValidator,
		text: v.optional(v.string()),
		style: v.optional(annotationStyleValidator),
	},
	returns: v.id("annotations"),
	handler: async (ctx, args) => {
		const user = await requireUser(ctx);
		const userId = userIdFromAuth(user);
		await requireMatchOwnership(ctx, args.matchId, userId);

		const now = Date.now();
		return await ctx.db.insert("annotations", {
			matchId: args.matchId,
			userId,
			frameIndex: args.frameIndex,
			frameEnd: args.frameEnd,
			geometry: args.geometry,
			text: args.text,
			style: args.style,
			createdAt: now,
			updatedAt: now,
		});
	},
});

export const update = mutation({
	args: {
		annotationId: v.id("annotations"),
		frameIndex: v.optional(v.number()),
		frameEnd: v.optional(v.number()),
		geometry: v.optional(geometryValidator),
		text: v.optional(v.string()),
		style: v.optional(annotationStyleValidator),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const user = await requireUser(ctx);
		const userId = userIdFromAuth(user);

		const annotation = await ctx.db.get(args.annotationId);
		if (!annotation || annotation.userId !== userId) {
			throw new Error("Annotation not found");
		}

		await requireMatchOwnership(ctx, annotation.matchId, userId);

		const { annotationId, ...updates } = args;
		const patch: Record<string, unknown> = { updatedAt: Date.now() };
		for (const [key, value] of Object.entries(updates)) {
			if (value !== undefined) {
				patch[key] = value;
			}
		}

		await ctx.db.patch(annotationId, patch);
		return null;
	},
});

export const remove = mutation({
	args: { annotationId: v.id("annotations") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const user = await requireUser(ctx);
		const userId = userIdFromAuth(user);

		const annotation = await ctx.db.get(args.annotationId);
		if (!annotation || annotation.userId !== userId) {
			throw new Error("Annotation not found");
		}

		await ctx.db.delete(args.annotationId);
		return null;
	},
});

export const listByMatch = query({
	args: { matchId: v.id("matches") },
	returns: v.array(annotationDocValidator),
	handler: async (ctx, args) => {
		const user = await requireUser(ctx);
		const userId = userIdFromAuth(user);
		await requireMatchOwnership(ctx, args.matchId, userId);

		const annotations = await ctx.db
			.query("annotations")
			.withIndex("by_match", (q) => q.eq("matchId", args.matchId))
			.collect();

		return annotations.sort((a, b) => a.frameIndex - b.frameIndex);
	},
});

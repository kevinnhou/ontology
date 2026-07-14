import { v } from "convex/values";

import type { DataModel } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { requireUser, userIdFromAuth } from "./auth";
import { r2, videoKeyForUser } from "./lib/r2";

export const { syncMetadata } = r2.clientApi<DataModel>({
	checkUpload: async (ctx) => {
		await requireUser(ctx);
	},
});

export const generateVideoUploadUrl = mutation({
	args: {},
	returns: v.object({ url: v.string(), key: v.string() }),
	handler: async (ctx) => {
		const user = await requireUser(ctx);
		const key = videoKeyForUser(userIdFromAuth(user));
		return await r2.generateUploadUrl(key);
	},
});

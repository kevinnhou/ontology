import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";

import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

// biome-ignore lint/style/noNonNullAssertion: PASS
const siteUrl = process.env.SITE_URL!;

function normaliseGoogleSecret(value: string): string {
	return value.replace(/\\n/g, "\n");
}

function googleSocialProviderConfig():
	| {
			clientId: string;
			clientSecret: string;
			prompt: "select_account";
	  }
	| undefined {
	const clientId = process.env.GOOGLE_CLIENT_ID;
	const clientSecret =
		process.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_PRIVATE_KEY;

	if (!(clientId && clientSecret)) {
		return undefined;
	}

	return {
		clientId,
		clientSecret: normaliseGoogleSecret(clientSecret),
		prompt: "select_account",
	};
}

export const authComponent = createClient<DataModel>(components.betterAuth);

function createAuth(ctx: GenericCtx<DataModel>) {
	const trustedOrigins = new Set([siteUrl]);
	if (process.env.NODE_ENV !== "production") {
		trustedOrigins.add("http://localhost:3000");
		trustedOrigins.add("http://localhost:3001");
	}

	const google = googleSocialProviderConfig();

	return betterAuth({
		baseURL: siteUrl,
		trustedOrigins: [...trustedOrigins],
		database: authComponent.adapter(ctx),
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: false,
		},
		socialProviders: google ? { google } : undefined,
		plugins: [
			convex({
				authConfig,
				jwksRotateOnTokenGenerationError: true,
			}),
		],
	});
}

export { createAuth };

export async function requireUser(ctx: GenericCtx<DataModel>) {
	const user = await authComponent.safeGetAuthUser(ctx);
	if (!user) {
		throw new Error("Not authenticated");
	}
	return user;
}

export function userIdFromAuth(user: { _id: string }) {
	return user._id;
}

export const getCurrentUser = query({
	args: {},
	handler: async (ctx) => {
		return await authComponent.safeGetAuthUser(ctx);
	},
});

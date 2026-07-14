import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { env } from "@ontology/env/web";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: env.NEXT_PUBLIC_SITE_URL,
	plugins: [convexClient()],
});

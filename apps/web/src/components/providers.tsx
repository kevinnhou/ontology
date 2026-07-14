"use client";

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { Toaster } from "@ontology/ui/components/sonner";

import { authClient } from "@/lib/auth-client";
import { convex } from "@/lib/convex-client";

import { ThemeProvider } from "./theme-provider";

export default function Providers({
	children,
	initialToken,
}: {
	children: React.ReactNode;
	initialToken?: string | null;
}) {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			disableTransitionOnChange
			enableSystem
		>
			<ConvexBetterAuthProvider
				authClient={authClient}
				client={convex}
				initialToken={initialToken}
			>
				{children}
			</ConvexBetterAuthProvider>
			<Toaster richColors />
		</ThemeProvider>
	);
}

"use client";

import { api } from "@ontology/backend/convex/_generated/api";
import { cn } from "@ontology/ui/lib/utils";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";

import AuthForm from "./auth-form";

export default function AuthOverlay({ children }: { children: ReactNode }) {
	const user = useQuery(api.auth.getCurrentUser);
	const isLoading = user === undefined;
	const showAuth = !isLoading && user === null;

	return (
		<div className="relative size-full">
			<div
				className={cn(
					"size-full",
					showAuth && "pointer-events-none select-none blur-[2px]"
				)}
			>
				{children}
			</div>

			{showAuth && (
				<div
					className="absolute inset-0 z-50 flex items-center justify-center bg-background/25 p-4"
					role="dialog"
				>
					<AuthForm />
				</div>
			)}
		</div>
	);
}

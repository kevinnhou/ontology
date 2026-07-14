"use client";

import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export default function SignOut() {
	const [pending, setPending] = useState(false);

	async function handleSignOut() {
		setPending(true);
		try {
			await authClient.signOut();
		} finally {
			setPending(false);
		}
	}

	return (
		<button
			className="border border-border px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-widest transition-colors hover:text-foreground disabled:opacity-50"
			disabled={pending}
			onClick={handleSignOut}
			type="button"
		>
			{pending ? "…" : "Sign out"}
		</button>
	);
}

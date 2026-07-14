"use client";

import { api } from "@ontology/backend/convex/_generated/api";
import { useQuery } from "convex/react";

import SignOut from "./signout";

export default function UserMenu({ inline = false }: { inline?: boolean }) {
	const user = useQuery(api.auth.getCurrentUser);

	if (!user) {
		return null;
	}

	return (
		<div
			className={
				inline
					? "flex items-center gap-3"
					: "absolute top-3 right-3 z-10 flex items-center gap-3"
			}
		>
			{user?.email && (
				<span className="max-w-48 truncate text-[10px] text-muted-foreground uppercase tracking-widest">
					{user.email}
				</span>
			)}
			<SignOut />
		</div>
	);
}

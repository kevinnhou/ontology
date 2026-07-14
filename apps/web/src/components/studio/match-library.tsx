"use client";

import { api } from "@ontology/backend/convex/_generated/api";
import type { Id } from "@ontology/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";

import { formatMatchDate } from "@/lib/studio/formatters";

export default function MatchLibrary({
	onOpenMatch,
}: {
	onOpenMatch: (matchId: Id<"matches">, title: string) => void;
}) {
	const user = useQuery(api.auth.getCurrentUser);
	const matches = useQuery(api.matches.listByUser, user ? {} : "skip");

	if (!user) {
		return null;
	}

	if (matches === undefined) {
		return (
			<div className="w-full border border-border bg-card p-4">
				<p className="text-[10px] text-muted-foreground uppercase tracking-widest">
					Loading matches
				</p>
			</div>
		);
	}

	if (matches.length === 0) {
		return null;
	}

	return (
		<div className="w-full border border-border bg-card">
			<div className="border-border border-b px-3 py-2">
				<p className="text-[10px] text-muted-foreground uppercase tracking-widest">
					Your matches
				</p>
			</div>
			<ul className="max-h-48 divide-y divide-border overflow-y-auto">
				{matches.map((match) => (
					<li key={match._id}>
						<button
							className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
							onClick={() => onOpenMatch(match._id, match.title)}
							type="button"
						>
							<span className="min-w-0 flex-1 truncate text-[10px] text-foreground uppercase tracking-wide">
								{match.title}
							</span>
							<span className="shrink-0 text-[9px] text-muted-foreground tabular-nums tracking-wide">
								{formatMatchDate(match.createdAt)}
							</span>
							<span className="shrink-0 border border-border px-1.5 py-0.5 text-[8px] text-muted-foreground uppercase tracking-widest">
								{match.status}
							</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

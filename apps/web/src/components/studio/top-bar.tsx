"use client";

import UserMenu from "@/components/auth/user";
import { useStudioStore } from "@/hooks/use-studio-store";
import { statusChipClass } from "@/lib/studio/style";

function MatchStatusChip() {
	const status = useStudioStore((state) => state.matchStatus);
	if (!status) {
		return null;
	}

	return (
		<span
			className={`border px-1.5 py-0.5 text-[8px] uppercase tracking-widest ${statusChipClass(status)}`}
		>
			{status}
		</span>
	);
}

export default function TopBar({
	matchTitle,
	onOpenLibrary,
	withMatch = false,
}: {
	matchTitle?: string;
	onOpenLibrary?: () => void;
	withMatch?: boolean;
}) {
	return (
		<header className="flex h-9 shrink-0 items-center gap-3 border border-border bg-card px-3">
			<span className="text-[10px] text-muted-foreground uppercase tracking-widest">
				Studio
			</span>

			{matchTitle && (
				<>
					<span className="text-muted-foreground/40">/</span>
					<span className="max-w-64 truncate text-[10px] text-foreground uppercase tracking-wide">
						{matchTitle}
					</span>
				</>
			)}

			{withMatch && <MatchStatusChip />}

			<div className="flex-1" />

			{onOpenLibrary && (
				<button
					className="border border-border px-2 py-0.5 text-[8px] text-muted-foreground uppercase tracking-widest hover:text-foreground"
					onClick={onOpenLibrary}
					type="button"
				>
					Library
				</button>
			)}

			<UserMenu inline />
		</header>
	);
}

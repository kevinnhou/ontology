"use client";

import { api } from "@ontology/backend/convex/_generated/api";
import { useAction } from "convex/react";
import { useCallback, useState } from "react";

import { useStudioStore } from "@/hooks/use-studio-store";

export default function ProcessButton() {
	const matchId = useStudioStore((state) => state.matchId);
	const matchStartMs = useStudioStore((state) => state.matchStartMs);
	const status = useStudioStore((state) => state.matchStatus);
	const progress = useStudioStore((state) => state.matchProgress);
	const matchError = useStudioStore((state) => state.matchError);
	const startProcessing = useAction(api.processing.startProcessing);
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleProcess = useCallback(async () => {
		setStarting(true);
		setError(null);
		try {
			await startProcessing({ matchId });
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "Failed to start processing"
			);
		} finally {
			setStarting(false);
		}
	}, [matchId, startProcessing]);

	if (status === null) {
		return null;
	}

	if (status === "processing") {
		const percent =
			progress && progress.totalFrames > 0
				? Math.round((progress.processedFrames / progress.totalFrames) * 100)
				: 0;
		return (
			<span className="flex items-center gap-1.5 border border-border px-2 py-0.5 text-[8px] text-muted-foreground uppercase tracking-widest">
				<span className="size-1.5 animate-pulse bg-foreground" />
				Processing {percent}%
			</span>
		);
	}

	const disabled = starting || matchStartMs === null;
	const label = status === "ready" ? "Reprocess" : "Process";

	return (
		<span className="flex items-center gap-1.5">
			<button
				className="border border-border px-2 py-0.5 text-[8px] text-foreground uppercase tracking-widest hover:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
				disabled={disabled}
				onClick={() => {
					handleProcess().catch(() => undefined);
				}}
				title={
					matchStartMs === null
						? "Set the match start before processing"
						: undefined
				}
				type="button"
			>
				{starting ? "Starting" : label}
			</button>
			{status === "failed" && (
				<span
					className="max-w-40 truncate text-[8px] text-destructive uppercase tracking-widest"
					title={matchError ?? undefined}
				>
					Failed
				</span>
			)}
			{error && (
				<span
					className="max-w-40 truncate text-[8px] text-destructive uppercase tracking-widest"
					title={error}
				>
					{error}
				</span>
			)}
		</span>
	);
}

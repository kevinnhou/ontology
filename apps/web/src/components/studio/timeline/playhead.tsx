"use client";

import { useShallow } from "zustand/react/shallow";
import { useStudioStore } from "@/hooks/use-studio-store";
import { msToPx } from "@/lib/timeline-coords";

export default function Playhead() {
	const { currentTimeMs, durationMs } = useStudioStore(
		useShallow((state) => ({
			currentTimeMs: state.currentTimeMs,
			durationMs: state.durationMs,
		}))
	);

	if (durationMs <= 0) {
		return null;
	}

	const left = msToPx(currentTimeMs, durationMs, 100);

	return (
		<div
			className="pointer-events-none absolute inset-y-0 z-20 w-px bg-foreground"
			style={{ left: `${left}%` }}
		/>
	);
}

"use client";

import { useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStudioStore } from "@/hooks/use-studio-store";
import { useTimelinePointerDrag } from "@/hooks/use-timeline-drag";
import { TICK_INTERVAL_MS } from "@/lib/studio/timeline-constants";
import { clientXToMs, formatTimeMs, msToPx } from "@/lib/timeline-coords";
import { selectRuler } from "@/store/studio-selectors";
import { Label } from "./track";

export default function Ruler() {
	const trackRef = useRef<HTMLDivElement>(null);
	const { durationMs, currentTimeMs, seek, setSeeking } = useStudioStore(
		useShallow(selectRuler)
	);

	const seekFromClientX = useCallback(
		(clientX: number) => {
			const track = trackRef.current;
			if (!track) {
				return;
			}
			const ms = clientXToMs(clientX, track, durationMs);
			seek(ms);
		},
		[durationMs, seek]
	);

	const startDrag = useTimelinePointerDrag({
		onStart: () => setSeeking(true),
		onMove: seekFromClientX,
		onEnd: () => setSeeking(false),
	});

	if (durationMs <= 0) {
		return (
			<div className="flex h-7 border-border border-t bg-card">
				<Label>Time</Label>
				<div className="flex flex-1 items-center px-2">
					<span className="text-[9px] text-muted-foreground uppercase tracking-widest">
						Loading timeline
					</span>
				</div>
			</div>
		);
	}

	const ticks: number[] = [];
	for (let ms = 0; ms <= durationMs; ms += TICK_INTERVAL_MS) {
		ticks.push(ms);
	}

	return (
		<div className="flex h-7 border-border border-t bg-card">
			<Label>Time</Label>
			<div
				aria-valuemax={durationMs}
				aria-valuemin={0}
				aria-valuenow={currentTimeMs}
				className="relative min-w-0 flex-1 cursor-pointer"
				onKeyDown={(e) => {
					if (e.key === "ArrowRight") {
						seek(Math.min(durationMs, currentTimeMs + 5000));
					}
					if (e.key === "ArrowLeft") {
						seek(Math.max(0, currentTimeMs - 5000));
					}
				}}
				onMouseDown={(e) => {
					startDrag(e.clientX);
				}}
				ref={trackRef}
				role="slider"
				tabIndex={0}
			>
				{ticks.map((ms) => (
					<span
						className="absolute top-1 text-[9px] text-muted-foreground tabular-nums tracking-wide"
						key={ms}
						style={{ left: `${msToPx(ms, durationMs, 100)}%` }}
					>
						{formatTimeMs(ms)}
					</span>
				))}
			</div>
		</div>
	);
}

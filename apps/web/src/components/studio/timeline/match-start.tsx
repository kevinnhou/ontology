"use client";

import { useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStudioStore, useStudioStoreApi } from "@/hooks/use-studio-store";
import { useTimelinePointerDrag } from "@/hooks/use-timeline-drag";
import { clientXToMs, msToPx } from "@/lib/timeline-coords";
import { selectDisplayMatchStartMs } from "@/store/studio";
import { selectMatchStart } from "@/store/studio-selectors";
import Track from "./track";

export default function MatchStart() {
	const trackRef = useRef<HTMLDivElement>(null);
	const anchorMsRef = useRef(0);
	const store = useStudioStoreApi();
	const { durationMs, displayMatchStartMs, setSeeking } = useStudioStore(
		useShallow(selectMatchStart)
	);

	const onMove = useCallback(
		(clientX: number) => {
			const track = trackRef.current;
			if (!track) {
				return;
			}
			const ms = clientXToMs(clientX, track, durationMs) - anchorMsRef.current;
			const clamped = Math.max(0, Math.min(ms, durationMs - 1));
			store.getState().setDraftMatchStartMs(clamped);
		},
		[durationMs, store]
	);

	const onEnd = useCallback(() => {
		setSeeking(false);
		const committedMs = selectDisplayMatchStartMs(store.getState());
		if (committedMs === null) {
			return;
		}
		store
			.getState()
			.commitMatchStart(committedMs)
			.catch(() => {
				store.getState().setDraftMatchStartMs(null);
			});
	}, [setSeeking, store]);

	const startDrag = useTimelinePointerDrag({
		onStart: () => setSeeking(true),
		onMove,
		onEnd,
	});

	if (durationMs <= 0) {
		return null;
	}

	const left =
		displayMatchStartMs === null
			? 0
			: msToPx(displayMatchStartMs, durationMs, 100);

	return (
		<Track height="h-7" label="Start">
			<div className="relative size-full" ref={trackRef}>
				{displayMatchStartMs !== null && (
					<div
						className="absolute inset-y-0 z-10 w-px bg-foreground"
						style={{ left: `${left}%` }}
					>
						<button
							className="absolute -top-0.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 cursor-ew-resize border border-foreground bg-foreground"
							onMouseDown={(e) => {
								e.stopPropagation();
								const track = trackRef.current;
								if (!track) {
									return;
								}
								anchorMsRef.current =
									clientXToMs(e.clientX, track, durationMs) -
									displayMatchStartMs;
								store.getState().setDraftMatchStartMs(displayMatchStartMs);
								startDrag(e.clientX);
							}}
							type="button"
						/>
					</div>
				)}
			</div>
		</Track>
	);
}

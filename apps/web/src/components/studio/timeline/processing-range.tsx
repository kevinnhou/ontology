"use client";

import type { TProcessingRange } from "@ontology/shared";
import { useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStudioStore, useStudioStoreApi } from "@/hooks/use-studio-store";
import { useTimelinePointerDrag } from "@/hooks/use-timeline-drag";
import { type HandleKind, MIN_RANGE_MS } from "@/lib/studio/timeline-constants";
import { clientXToMs, msToPx } from "@/lib/timeline-coords";
import { selectDisplayProcessingRange } from "@/store/studio";
import { selectProcessingTrack } from "@/store/studio-selectors";
import Track from "./track";
import WindowMarkers from "./window-markers";

export default function ProcessingRange() {
	const trackRef = useRef<HTMLDivElement>(null);
	const dragContextRef = useRef<{
		handle: HandleKind;
		startMsAtDrag: number;
		startRange: TProcessingRange;
	} | null>(null);
	const store = useStudioStoreApi();
	const {
		durationMs,
		fps,
		effectiveRanges,
		displayProcessingRange,
		setSeeking,
	} = useStudioStore(useShallow(selectProcessingTrack));

	const onMove = useCallback(
		(clientX: number) => {
			const track = trackRef.current;
			const context = dragContextRef.current;
			if (!(track && context)) {
				return;
			}

			const currentMs = clientXToMs(clientX, track, durationMs);
			const delta = currentMs - context.startMsAtDrag;

			const nextRange =
				context.handle === "start"
					? {
							startMs: Math.max(
								0,
								Math.min(
									context.startRange.startMs + delta,
									context.startRange.endMs - MIN_RANGE_MS
								)
							),
							endMs: context.startRange.endMs,
						}
					: {
							startMs: context.startRange.startMs,
							endMs: Math.min(
								durationMs,
								Math.max(
									context.startRange.endMs + delta,
									context.startRange.startMs + MIN_RANGE_MS
								)
							),
						};

			store.getState().setDraftProcessingRange(nextRange);
		},
		[durationMs, store]
	);

	const onEnd = useCallback(() => {
		setSeeking(false);
		dragContextRef.current = null;

		const committedRange = selectDisplayProcessingRange(store.getState());
		if (!committedRange) {
			return;
		}
		store
			.getState()
			.commitProcessingRange(committedRange)
			.catch(() => {
				store.getState().setDraftProcessingRange(null);
			});
	}, [setSeeking, store]);

	const startDrag = useTimelinePointerDrag({
		onStart: () => setSeeking(true),
		onMove,
		onEnd,
	});

	const beginHandleDrag = useCallback(
		(
			handle: HandleKind,
			startClientX: number,
			startRange: TProcessingRange
		) => {
			const track = trackRef.current;
			if (!track) {
				return;
			}

			dragContextRef.current = {
				handle,
				startMsAtDrag: clientXToMs(startClientX, track, durationMs),
				startRange,
			};
			store.getState().setDraftProcessingRange(startRange);
			startDrag(startClientX);
		},
		[durationMs, startDrag, store]
	);

	if (!displayProcessingRange || durationMs <= 0) {
		return (
			<Track label="Window">
				<span className="flex size-full items-center px-2 text-[9px] text-muted-foreground uppercase tracking-widest">
					Set match start first
				</span>
			</Track>
		);
	}

	const left = msToPx(displayProcessingRange.startMs, durationMs, 100);
	const width = msToPx(
		displayProcessingRange.endMs - displayProcessingRange.startMs,
		durationMs,
		100
	);

	return (
		<Track height="h-10" label="Window">
			<div className="absolute inset-0 bg-secondary/40" ref={trackRef}>
				<div
					className="absolute inset-y-0 bg-foreground/20"
					style={{ left: `${left}%`, width: `${width}%` }}
				>
					{effectiveRanges.map((range) => {
						const effectiveLeft = msToPx(
							range.startMs - displayProcessingRange.startMs,
							displayProcessingRange.endMs - displayProcessingRange.startMs,
							100
						);
						const effectiveWidth = msToPx(
							range.endMs - range.startMs,
							displayProcessingRange.endMs - displayProcessingRange.startMs,
							100
						);
						return (
							<div
								className="absolute inset-y-0 bg-foreground/50"
								key={`${range.startMs}-${range.endMs}`}
								style={{
									left: `${effectiveLeft}%`,
									width: `${effectiveWidth}%`,
								}}
							/>
						);
					})}
				</div>

				<WindowMarkers durationMs={durationMs} effectiveFps={fps} />

				<button
					className="absolute inset-y-0 z-10 w-1 -translate-x-1/2 cursor-ew-resize bg-foreground"
					onMouseDown={(e) => {
						e.stopPropagation();
						beginHandleDrag("start", e.clientX, displayProcessingRange);
					}}
					style={{ left: `${left}%` }}
					type="button"
				/>
				<button
					className="absolute inset-y-0 z-10 w-1 -translate-x-1/2 cursor-ew-resize bg-foreground"
					onMouseDown={(e) => {
						e.stopPropagation();
						beginHandleDrag("end", e.clientX, displayProcessingRange);
					}}
					style={{ left: `${left + width}%` }}
					type="button"
				/>
			</div>
		</Track>
	);
}

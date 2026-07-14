"use client";

import { memo, useMemo } from "react";

import { useStudioStore } from "@/hooks/use-studio-store";
import { shotMarkerClass } from "@/lib/studio/style";
import { DETECTION_BUCKET_MS } from "@/lib/studio/timeline-constants";
import { msToPx } from "@/lib/timeline-coords";

function WindowMarkers({
	durationMs,
	effectiveFps,
}: {
	durationMs: number;
	effectiveFps: number | null;
}) {
	const processedRanges = useStudioStore((state) => state.processedRanges);
	const annotations = useStudioStore((state) => state.annotations);
	const shotEvents = useStudioStore((state) => state.shotEvents);

	const detectionMarkers = useMemo(() => {
		const ranges = processedRanges;
		if (!ranges || durationMs <= 0) {
			return [];
		}

		const bucketCount = Math.ceil(durationMs / DETECTION_BUCKET_MS);
		const buckets = new Set<number>();

		for (const range of ranges) {
			const startIndex = Math.max(
				0,
				Math.floor(range.startMs / DETECTION_BUCKET_MS)
			);
			const endIndex = Math.min(
				bucketCount - 1,
				Math.floor(range.endMs / DETECTION_BUCKET_MS)
			);
			for (let index = startIndex; index <= endIndex; index++) {
				buckets.add(index * DETECTION_BUCKET_MS);
			}
		}

		return [...buckets];
	}, [processedRanges, durationMs]);

	const annotationMarkers = useMemo(() => {
		if (durationMs <= 0 || effectiveFps === null) {
			return [];
		}

		return annotations.map((annotation) => {
			const startMs = (annotation.frameIndex / effectiveFps) * 1000;
			const endMs = annotation.frameEnd
				? (annotation.frameEnd / effectiveFps) * 1000
				: null;
			return { id: annotation._id, startMs, endMs };
		});
	}, [annotations, durationMs, effectiveFps]);

	return (
		<>
			{annotationMarkers.map((marker) => {
				if (marker.endMs !== null) {
					const spanLeft = msToPx(marker.startMs, durationMs, 100);
					const spanWidth = msToPx(
						marker.endMs - marker.startMs,
						durationMs,
						100
					);
					return (
						<div
							className="pointer-events-none absolute top-1 h-px bg-foreground/70"
							key={marker.id}
							style={{
								left: `${spanLeft}%`,
								width: `${Math.max(spanWidth, 0.15)}%`,
							}}
						/>
					);
				}

				return (
					<div
						className="pointer-events-none absolute top-1 size-1 -translate-x-1/2 bg-foreground"
						key={marker.id}
						style={{ left: `${msToPx(marker.startMs, durationMs, 100)}%` }}
					/>
				);
			})}

			{shotEvents.map((shot) => (
				<div
					className={`pointer-events-none absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rotate-45 ${shotMarkerClass(shot.alliance)}`}
					key={shot._id}
					style={{ left: `${msToPx(shot.timestampMs, durationMs, 100)}%` }}
				/>
			))}

			{detectionMarkers.map((ms) => (
				<div
					className="pointer-events-none absolute bottom-1 size-1 -translate-x-1/2 bg-foreground/60"
					key={ms}
					style={{ left: `${msToPx(ms, durationMs, 100)}%` }}
				/>
			))}
		</>
	);
}

export default memo(WindowMarkers);

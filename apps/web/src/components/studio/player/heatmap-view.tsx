"use client";

import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import { useStudioStore, useStudioVideoRef } from "@/hooks/use-studio-store";
import {
	HEATMAP_CANVAS_HEIGHT,
	HEATMAP_CANVAS_WIDTH,
} from "@/lib/studio/constants";
import { buildHeatmapImage, drawHeatmap } from "@/lib/studio/heatmap-canvas";
import { buildHeatPoints } from "@/lib/studio/heatmap-data";
import { selectHeatmapView } from "@/store/studio-selectors";

export default function HeatmapView() {
	const videoRef = useStudioVideoRef();
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const {
		derivedSections,
		heatmapMode,
		heatmapAlliance,
		heatmapSection,
		matchStatus,
		pathSamples,
		shotEvents,
	} = useStudioStore(useShallow(selectHeatmapView));

	const status = matchStatus;

	const sectionRange = useMemo(() => {
		if (heatmapSection === "all") {
			return null;
		}
		const section = derivedSections.find((s) => s.kind === heatmapSection);
		return section ? { startMs: section.startMs, endMs: section.endMs } : null;
	}, [derivedSections, heatmapSection]);

	const heatPoints = useMemo(
		() =>
			buildHeatPoints(
				heatmapMode,
				shotEvents,
				pathSamples,
				sectionRange,
				heatmapAlliance
			),
		[heatmapMode, shotEvents, pathSamples, sectionRange, heatmapAlliance]
	);

	const showReprocessHint =
		heatmapMode === "pathing" && status === "ready" && pathSamples.length === 0;

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}
		const image = buildHeatmapImage(heatPoints);
		drawHeatmap(canvas, image, videoRef.current);
	}, [heatPoints, videoRef]);

	return (
		<div className="absolute inset-0 z-10 bg-black">
			<canvas
				className="size-full"
				height={HEATMAP_CANVAS_HEIGHT}
				ref={canvasRef}
				width={HEATMAP_CANVAS_WIDTH}
			/>
			{heatPoints.length === 0 && (
				<p className="absolute inset-0 flex items-center justify-center text-center text-[10px] text-muted-foreground uppercase tracking-widest">
					{showReprocessHint
						? "No pathing data — reprocess this match to generate it"
						: "No data for this filter"}
				</p>
			)}
		</div>
	);
}

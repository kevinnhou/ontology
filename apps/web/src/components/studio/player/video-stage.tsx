"use client";

import { useEffect, useRef } from "react";

import {
	useStudioStageRef,
	useStudioStore,
	useStudioVideoRef,
} from "@/hooks/use-studio-store";

import DetectionOverlay from "./detection-overlay";
import HeatmapView from "./heatmap-view";
import StageOverlay from "./stage-overlay";

export default function VideoStage() {
	const videoRef = useStudioVideoRef();
	const stageContainerRef = useStudioStageRef();
	const videoKey = useStudioStore((state) => state.videoKey);
	const videoUrl = useStudioStore((state) => state.videoUrl);
	const stageView = useStudioStore((state) => state.stageView);
	const appliedVideoKeyRef = useRef<string | null>(null);

	useEffect(() => {
		const video = videoRef.current;
		if (!(video && videoUrl && videoKey)) {
			return;
		}

		if (appliedVideoKeyRef.current === videoKey) {
			return;
		}

		appliedVideoKeyRef.current = videoKey;
		video.src = videoUrl;
	}, [videoKey, videoRef, videoUrl]);

	return (
		<div className="group relative size-full bg-black" ref={stageContainerRef}>
			<video
				className="size-full object-contain"
				onClick={() => {
					if (stageView === "heatmap") {
						return;
					}
					const video = videoRef.current;
					if (!video) {
						return;
					}
					if (video.paused) {
						video.play().catch(() => undefined);
					} else {
						video.pause();
					}
				}}
				playsInline
				preload="auto"
				ref={videoRef}
			>
				<track kind="captions" />
			</video>
			{stageView === "live" && <DetectionOverlay />}
			{stageView === "heatmap" && <HeatmapView />}
			<StageOverlay />
		</div>
	);
}

"use client";

import { useEffect, useMemo, useRef } from "react";
import { useDetectionFrames } from "@/hooks/use-detection-frames";
import { useStudioStore, useStudioVideoRef } from "@/hooks/use-studio-store";
import {
	displayedVideoRect,
	drawDetections,
	drawShotFlashes,
	findFrameSpan,
} from "@/lib/studio/detection-overlay-render";

export default function DetectionOverlay() {
	const videoRef = useStudioVideoRef();
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const matchId = useStudioStore((state) => state.matchId);
	const overlayLayers = useStudioStore((state) => state.overlayLayers);

	const { frames, isLoading } = useDetectionFrames(matchId);
	const shotEvents = useStudioStore((state) => state.shotEvents);

	const sortedShots = useMemo(() => {
		if (!shotEvents) {
			return [];
		}
		return [...shotEvents].sort((a, b) => a.timestampMs - b.timestampMs);
	}, [shotEvents]);

	useEffect(() => {
		const canvas = canvasRef.current;
		const video = videoRef.current;
		if (!(canvas && video)) {
			return;
		}

		const context = canvas.getContext("2d");
		if (!context) {
			return;
		}

		let rafId = 0;

		const draw = () => {
			rafId = requestAnimationFrame(draw);

			const parent = canvas.parentElement;
			if (!parent) {
				return;
			}
			const dpr = window.devicePixelRatio || 1;
			const cssWidth = parent.clientWidth;
			const cssHeight = parent.clientHeight;
			if (
				canvas.width !== Math.round(cssWidth * dpr) ||
				canvas.height !== Math.round(cssHeight * dpr)
			) {
				canvas.width = Math.round(cssWidth * dpr);
				canvas.height = Math.round(cssHeight * dpr);
			}

			context.setTransform(dpr, 0, 0, dpr, 0, 0);
			context.clearRect(0, 0, cssWidth, cssHeight);

			const rect = displayedVideoRect(video, cssWidth, cssHeight);
			if (!rect) {
				return;
			}

			const overlayFrames = frames ?? [];
			const timeMs = video.currentTime * 1000;
			const span = findFrameSpan(overlayFrames, timeMs);
			if (span && timeMs - span.current.timestampMs < 1500) {
				drawDetections(context, span, timeMs, rect, overlayLayers);
			}

			if (overlayLayers.shots) {
				drawShotFlashes(context, sortedShots, timeMs, rect);
			}
		};

		rafId = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(rafId);
	}, [frames, sortedShots, overlayLayers, videoRef]);

	return (
		<>
			{isLoading ? (
				<div className="pointer-events-none absolute top-2 right-2 rounded bg-black/60 px-2 py-1 text-white text-xs">
					Loading overlays…
				</div>
			) : null}
			<canvas
				className="pointer-events-none absolute inset-0 size-full"
				ref={canvasRef}
			/>
		</>
	);
}

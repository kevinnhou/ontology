"use client";

import { api } from "@ontology/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useStudioStore, useStudioVideoRef } from "@/hooks/use-studio-store";
import {
	displayedVideoRect,
	drawDetections,
	drawShotFlashes,
	findFrameSpan,
	OVERLAY_CHUNK_MS,
	type OverlayFrame,
} from "@/lib/studio/detection-overlay-render";

export default function DetectionOverlay() {
	const videoRef = useStudioVideoRef();
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const matchId = useStudioStore((state) => state.matchId);
	const overlayLayers = useStudioStore((state) => state.overlayLayers);

	const [playheadMs, setPlayheadMs] = useState(0);
	const chunkIndex = Math.floor(playheadMs / OVERLAY_CHUNK_MS);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}
		const handleTimeUpdate = () => setPlayheadMs(video.currentTime * 1000);
		video.addEventListener("timeupdate", handleTimeUpdate);
		video.addEventListener("seeked", handleTimeUpdate);
		return () => {
			video.removeEventListener("timeupdate", handleTimeUpdate);
			video.removeEventListener("seeked", handleTimeUpdate);
		};
	}, [videoRef]);

	const currentChunk = useQuery(api.detections.listWindow, {
		matchId,
		startMs: chunkIndex * OVERLAY_CHUNK_MS,
		endMs: (chunkIndex + 1) * OVERLAY_CHUNK_MS - 1,
	});
	const nextChunk = useQuery(api.detections.listWindow, {
		matchId,
		startMs: (chunkIndex + 1) * OVERLAY_CHUNK_MS,
		endMs: (chunkIndex + 2) * OVERLAY_CHUNK_MS - 1,
	});
	const shotEvents = useStudioStore((state) => state.shotEvents);

	const frames = useMemo<OverlayFrame[]>(() => {
		const rows = [...(currentChunk ?? []), ...(nextChunk ?? [])];
		return rows
			.sort((a, b) => a.timestampMs - b.timestampMs)
			.map((row) => ({
				timestampMs: row.timestampMs,
				detections: row.detections,
			}));
	}, [currentChunk, nextChunk]);

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

			const timeMs = video.currentTime * 1000;
			const span = findFrameSpan(frames, timeMs);
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
		<canvas
			className="pointer-events-none absolute inset-0 size-full"
			ref={canvasRef}
		/>
	);
}

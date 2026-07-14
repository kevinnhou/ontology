"use client";

import { Maximize, Minimize2, Pause, Play } from "lucide-react";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";

import { useFullscreen } from "@/hooks/use-fullscreen";
import {
	useStudioStageRef,
	useStudioStore,
	useStudioVideoRef,
} from "@/hooks/use-studio-store";
import { formatTimeMs } from "@/lib/timeline-coords";
import { selectVideoToolbar } from "@/store/studio-selectors";

import VolumeControl, { ICON_BUTTON_CLASSNAME } from "./volume-control";

export function PlayPauseButton({ disabled = false }: { disabled?: boolean }) {
	const videoRef = useStudioVideoRef();
	const playing = useStudioStore((state) => state.playing);

	const togglePlay = useCallback(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}
		if (video.paused) {
			video.play().catch(() => undefined);
		} else {
			video.pause();
		}
	}, [videoRef]);

	return (
		<button
			aria-label={playing ? "Pause" : "Play"}
			className={ICON_BUTTON_CLASSNAME}
			disabled={disabled}
			onClick={togglePlay}
			type="button"
		>
			{playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
		</button>
	);
}

export function Timecode() {
	const { currentTimeMs, durationMs } = useStudioStore(
		useShallow(selectVideoToolbar)
	);

	return (
		<span className="min-w-18 text-[10px] text-muted-foreground tabular-nums tracking-wide">
			{formatTimeMs(currentTimeMs)} / {formatTimeMs(durationMs)}
		</span>
	);
}

export function FullscreenButton() {
	const stageRef = useStudioStageRef();
	const { isFullscreen, toggleFullscreen } = useFullscreen(stageRef);

	return (
		<button
			aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
			className={ICON_BUTTON_CLASSNAME}
			onClick={toggleFullscreen}
			type="button"
		>
			{isFullscreen ? (
				<Minimize2 className="size-3.5" />
			) : (
				<Maximize className="size-3.5" />
			)}
		</button>
	);
}

export function TransportControls({
	playDisabled = false,
}: {
	playDisabled?: boolean;
}) {
	return (
		<div className="flex items-center gap-1">
			<PlayPauseButton disabled={playDisabled} />
			<Timecode />
			<VolumeControl />
			<FullscreenButton />
		</div>
	);
}

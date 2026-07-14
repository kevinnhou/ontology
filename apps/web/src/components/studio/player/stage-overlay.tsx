"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Timeline from "@/components/studio/timeline";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useStudioStageRef, useStudioStore } from "@/hooks/use-studio-store";

import {
	FullscreenButton,
	PlayPauseButton,
	Timecode,
} from "./transport-controls";
import VolumeControl from "./volume-control";

const OVERLAY_HIDE_MS = 2500;

export default function StageOverlay() {
	const stageRef = useStudioStageRef();
	const { isFullscreen } = useFullscreen(stageRef);
	const stageView = useStudioStore((state) => state.stageView);

	const [visible, setVisible] = useState(true);
	const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const showControls = useCallback(() => {
		setVisible(true);
		if (hideTimerRef.current) {
			clearTimeout(hideTimerRef.current);
		}
		hideTimerRef.current = setTimeout(() => {
			setVisible(false);
		}, OVERLAY_HIDE_MS);
	}, []);

	useEffect(() => {
		if (!isFullscreen) {
			setVisible(false);
			if (hideTimerRef.current) {
				clearTimeout(hideTimerRef.current);
			}
			return;
		}

		showControls();
		const stage = stageRef.current;
		if (!stage) {
			return;
		}

		const handlePointerMove = () => {
			showControls();
		};
		stage.addEventListener("pointermove", handlePointerMove);

		return () => {
			stage.removeEventListener("pointermove", handlePointerMove);
			if (hideTimerRef.current) {
				clearTimeout(hideTimerRef.current);
			}
		};
	}, [isFullscreen, showControls, stageRef]);

	if (!isFullscreen) {
		return null;
	}

	return (
		<div
			className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pt-12 pb-4 transition-opacity duration-300 ${
				visible ? "opacity-100" : "pointer-events-none opacity-0"
			}`}
		>
			<div className="flex flex-col gap-2">
				<Timeline variant="overlay" />

				<div className="flex items-center gap-2 border border-border bg-card/90 px-2 py-1.5">
					<PlayPauseButton disabled={stageView === "heatmap"} />
					<Timecode />
					<div className="flex-1" />
					<VolumeControl />
					<FullscreenButton />
				</div>
			</div>
		</div>
	);
}

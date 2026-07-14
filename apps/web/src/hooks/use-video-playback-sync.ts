"use client";

import { type RefObject, useEffect } from "react";

import type { createStudioStore } from "@/store/studio";

export function useVideoPlaybackSync({
	store,
	videoRef,
	seekingRef,
}: {
	store: ReturnType<typeof createStudioStore>;
	videoRef: RefObject<HTMLVideoElement | null>;
	seekingRef: RefObject<boolean>;
}) {
	useEffect(() => {
		const unsubscribe = store.subscribe((state, prevState) => {
			if (state.seeking !== prevState.seeking) {
				seekingRef.current = state.seeking;
			}
		});
		seekingRef.current = store.getState().seeking;
		return unsubscribe;
	}, [store, seekingRef]);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}

		const { setPlaying, setCurrentTimeMs, setDurationMs, probeVideoMetadata } =
			store.getState();

		const onPlay = () => setPlaying(true);
		const onPause = () => setPlaying(false);
		const onTimeUpdate = () => {
			if (!seekingRef.current) {
				setCurrentTimeMs(video.currentTime * 1000);
			}
		};
		const onDurationChange = () => {
			if (!store.getState().durationLocked && Number.isFinite(video.duration)) {
				setDurationMs(video.duration * 1000);
			}
			probeVideoMetadata();
		};
		const onLoadedMetadata = () => {
			if (!store.getState().durationLocked && Number.isFinite(video.duration)) {
				setDurationMs(video.duration * 1000);
			}
			probeVideoMetadata();
		};

		video.addEventListener("play", onPlay);
		video.addEventListener("pause", onPause);
		video.addEventListener("timeupdate", onTimeUpdate);
		video.addEventListener("durationchange", onDurationChange);
		video.addEventListener("loadedmetadata", onLoadedMetadata);

		setPlaying(!video.paused);
		setCurrentTimeMs(video.currentTime * 1000);
		if (!store.getState().durationLocked && Number.isFinite(video.duration)) {
			setDurationMs(video.duration * 1000);
		}

		return () => {
			video.removeEventListener("play", onPlay);
			video.removeEventListener("pause", onPause);
			video.removeEventListener("timeupdate", onTimeUpdate);
			video.removeEventListener("durationchange", onDurationChange);
			video.removeEventListener("loadedmetadata", onLoadedMetadata);
		};
	}, [store, videoRef, seekingRef]);
}

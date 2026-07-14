"use client";

import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

const VOLUME_STORAGE_KEY = "studio-video-volume";

export function useVideoAudio(videoRef: RefObject<HTMLVideoElement | null>) {
	const [volume, setVolume] = useState(1);
	const [muted, setMuted] = useState(false);
	const savedVolumeRef = useRef(1);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}

		const stored = localStorage.getItem(VOLUME_STORAGE_KEY);
		if (stored) {
			const parsed = Number.parseFloat(stored);
			if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
				video.volume = parsed;
				savedVolumeRef.current = parsed;
			}
		}

		const sync = () => {
			setVolume(video.volume);
			setMuted(video.muted);
			if (!video.muted && video.volume > 0) {
				savedVolumeRef.current = video.volume;
				localStorage.setItem(VOLUME_STORAGE_KEY, String(video.volume));
			}
		};

		video.addEventListener("volumechange", sync);
		sync();

		return () => {
			video.removeEventListener("volumechange", sync);
		};
	}, [videoRef]);

	const setVideoVolume = useCallback(
		(next: number) => {
			const video = videoRef.current;
			if (!video) {
				return;
			}
			const clamped = Math.max(0, Math.min(1, next));
			video.volume = clamped;
			if (clamped > 0) {
				video.muted = false;
				savedVolumeRef.current = clamped;
				localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
			}
		},
		[videoRef]
	);

	const toggleMute = useCallback(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}
		if (video.muted) {
			video.muted = false;
			video.volume = savedVolumeRef.current > 0 ? savedVolumeRef.current : 1;
		} else {
			if (video.volume > 0) {
				savedVolumeRef.current = video.volume;
			}
			video.muted = true;
		}
	}, [videoRef]);

	return { volume, muted, setVideoVolume, toggleMute };
}

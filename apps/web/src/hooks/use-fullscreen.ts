"use client";

import { type RefObject, useCallback, useEffect, useState } from "react";

export function useFullscreen(elementRef: RefObject<HTMLElement | null>) {
	const [isFullscreen, setIsFullscreen] = useState(false);

	useEffect(() => {
		const onFullscreenChange = () => {
			setIsFullscreen(document.fullscreenElement === elementRef.current);
		};

		document.addEventListener("fullscreenchange", onFullscreenChange);
		onFullscreenChange();

		return () => {
			document.removeEventListener("fullscreenchange", onFullscreenChange);
		};
	}, [elementRef]);

	const toggleFullscreen = useCallback(() => {
		const element = elementRef.current;
		if (!element) {
			return;
		}
		if (document.fullscreenElement) {
			document.exitFullscreen().catch(() => undefined);
		} else {
			element.requestFullscreen().catch(() => undefined);
		}
	}, [elementRef]);

	return { isFullscreen, toggleFullscreen };
}

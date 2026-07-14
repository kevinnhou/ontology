"use client";

import { useCallback } from "react";

export function useTimelinePointerDrag(options: {
	onStart?: () => void;
	onMove: (clientX: number) => void;
	onEnd: () => void;
}) {
	const { onStart, onMove, onEnd } = options;

	return useCallback(
		(startClientX: number) => {
			onStart?.();
			onMove(startClientX);

			const onDocumentMove = (moveEvent: MouseEvent) => {
				onMove(moveEvent.clientX);
			};
			const onDocumentUp = () => {
				document.removeEventListener("mousemove", onDocumentMove);
				document.removeEventListener("mouseup", onDocumentUp);
				onEnd();
			};

			document.addEventListener("mousemove", onDocumentMove);
			document.addEventListener("mouseup", onDocumentUp);
		},
		[onEnd, onMove, onStart]
	);
}

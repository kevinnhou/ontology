"use client";

import { api } from "@ontology/backend/convex/_generated/api";
import type { Id } from "@ontology/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";

import type { OverlayFrame } from "@/lib/studio/detection-overlay-render";

interface DetectionArtifact {
	frameStride: number;
	frames: OverlayFrame[];
	version: number;
}

function isGzip(buffer: ArrayBuffer): boolean {
	const bytes = new Uint8Array(buffer);
	return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function decodeArtifact(buffer: ArrayBuffer): Promise<DetectionArtifact> {
	let text: string;
	if (isGzip(buffer)) {
		text = await new Response(
			new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"))
		).text();
	} else {
		text = new TextDecoder().decode(buffer);
	}

	const parsed = JSON.parse(text) as DetectionArtifact;
	return {
		...parsed,
		frames: [...parsed.frames].sort((a, b) => a.timestampMs - b.timestampMs),
	};
}

export function useDetectionFrames(matchId: Id<"matches">): {
	frames: OverlayFrame[] | undefined;
	isLoading: boolean;
} {
	const detectionsUrl = useQuery(api.detections.getDetectionsUrl, { matchId });
	const [frames, setFrames] = useState<OverlayFrame[] | undefined>(undefined);
	const [isLoading, setIsLoading] = useState(false);

	useEffect(() => {
		if (detectionsUrl === undefined) {
			return;
		}

		if (detectionsUrl === null) {
			setFrames(undefined);
			setIsLoading(false);
			return;
		}

		let cancelled = false;
		setIsLoading(true);

		const load = async () => {
			const response = await fetch(detectionsUrl);
			if (!response.ok) {
				throw new Error(`Failed to fetch detections: ${response.status}`);
			}
			const buffer = await response.arrayBuffer();
			const artifact = await decodeArtifact(buffer);
			if (!cancelled) {
				setFrames(artifact.frames);
				setIsLoading(false);
			}
		};

		load().catch(() => {
			if (!cancelled) {
				setFrames(undefined);
				setIsLoading(false);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [detectionsUrl]);

	return { frames, isLoading };
}

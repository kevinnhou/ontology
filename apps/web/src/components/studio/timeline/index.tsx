"use client";

import { cn } from "@ontology/ui/lib/utils";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useStudioStageRef } from "@/hooks/use-studio-store";

import MatchStart from "./match-start";
import Playhead from "./playhead";
import ProcessingRange from "./processing-range";
import Ruler from "./ruler";
import TrackSection from "./track-section";

export default function Timeline({
	variant = "default",
}: {
	variant?: "default" | "overlay";
}) {
	const stageRef = useStudioStageRef();
	const { isFullscreen } = useFullscreen(stageRef);

	if (variant === "default" && isFullscreen) {
		return null;
	}

	return (
		<div
			className={cn(
				"relative w-full",
				variant === "overlay"
					? "border border-border bg-card/90"
					: "shrink-0 border border-border border-t-0 bg-card"
			)}
		>
			<Ruler />
			<MatchStart />
			<TrackSection />
			<ProcessingRange />
			<div className="pointer-events-none absolute inset-y-0 right-0 left-12 z-20">
				<Playhead />
			</div>
		</div>
	);
}

"use client";

import { useShallow } from "zustand/react/shallow";
import { useStudioStore } from "@/hooks/use-studio-store";
import { SECTION_COLORS } from "@/lib/studio/style";
import { msToPx } from "@/lib/timeline-coords";
import { selectTrackSection } from "@/store/studio-selectors";
import Track from "./track";

export default function TrackSection() {
	const {
		derivedSections,
		durationMs,
		displayMatchStartMs,
		toggleSectionAnalyse,
	} = useStudioStore(useShallow(selectTrackSection));

	return (
		<Track height="h-10" label="Phases">
			{displayMatchStartMs === null && (
				<div className="flex size-full items-center justify-center">
					<span className="text-[8px] text-muted-foreground uppercase tracking-widest">
						Set match start to show phases
					</span>
				</div>
			)}
			{derivedSections.map((section) => {
				const left = msToPx(section.startMs, durationMs, 100);
				const width = msToPx(section.endMs - section.startMs, durationMs, 100);
				return (
					<button
						className={`absolute inset-y-0 cursor-pointer border-border border-r text-left ${SECTION_COLORS[section.kind] ?? "bg-secondary"} ${section.analyse ? "" : "opacity-40"}`}
						key={section.kind}
						onClick={() => toggleSectionAnalyse(section.kind, !section.analyse)}
						style={{ left: `${left}%`, width: `${width}%` }}
						type="button"
					>
						<span className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden px-0.5 text-[9px] text-foreground uppercase tracking-widest">
							{section.label}
						</span>
					</button>
				);
			})}
		</Track>
	);
}

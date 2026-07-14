"use client";

import { CornerMarks } from "./inspector-primitives";
import {
	EmptyState,
	ProcessingBadge,
	StageControls,
	TelemetrySection,
	TracksSection,
} from "./inspector-sections";

export default function AnalysisPanel() {
	return (
		<aside className="relative flex h-full flex-col overflow-y-auto bg-[#111] p-3 font-mono">
			<CornerMarks />
			<ProcessingBadge />

			<div className="flex flex-col gap-5">
				<TelemetrySection />
				<StageControls />
				<TracksSection />
				<EmptyState />
			</div>
		</aside>
	);
}

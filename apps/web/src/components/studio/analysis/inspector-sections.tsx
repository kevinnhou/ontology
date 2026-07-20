"use client";

import { useShallow } from "zustand/react/shallow";

import { useStudioStore } from "@/hooks/use-studio-store";
import {
	ALLIANCE_OPTIONS,
	HEATMAP_MODES,
	OVERLAY_LAYERS,
} from "@/lib/studio/inspector-constants";
import {
	selectHasAnalytics,
	selectInspectorTelemetry,
	selectInspectorTracks,
	selectIsProcessing,
	selectSectionOptions,
} from "@/store/studio-selectors";
import {
	AllianceSplit,
	FilterChip,
	FilterGroup,
	FilterRail,
	LedgerRow,
	RobotRow,
	SectionRule,
} from "./inspector-primitives";

export function ProcessingBadge() {
	const isProcessing = useStudioStore(selectIsProcessing);
	if (!isProcessing) {
		return null;
	}

	return (
		<header className="mb-4 flex items-center gap-1.5 text-[8px] text-amber-400/90 uppercase tracking-[0.2em]">
			<span className="size-1 animate-pulse bg-amber-400" />
			Processing
		</header>
	);
}

export function TelemetrySection() {
	const hasAnalytics = useStudioStore(selectHasAnalytics);
	const telemetry = useStudioStore(useShallow(selectInspectorTelemetry));
	if (!hasAnalytics) {
		return null;
	}

	return (
		<section className="flex flex-col gap-3">
			<LedgerRow label="Total shots" large value={telemetry.totalShots} />
			<AllianceSplit blue={telemetry.blue} red={telemetry.red} />
			<div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1">
				<LedgerRow label="Rate" unit="/min" value={telemetry.rate} />
				<LedgerRow
					label="Average Speed"
					unit="u/s"
					value={telemetry.avgSpeed}
				/>
			</div>
		</section>
	);
}

function OverlaySection() {
	const overlayLayers = useStudioStore((state) => state.overlayLayers);
	const toggleOverlayLayer = useStudioStore(
		(state) => state.toggleOverlayLayer
	);

	return (
		<section className="flex flex-col gap-3">
			<SectionRule label="Overlays" />
			<div className="flex flex-col gap-0.5">
				{OVERLAY_LAYERS.map(({ key, label }) => (
					<FilterRail
						active={overlayLayers[key]}
						key={key}
						label={label}
						onClick={() => toggleOverlayLayer(key)}
					/>
				))}
			</div>
		</section>
	);
}

function HeatmapSection() {
	const heatmapMode = useStudioStore((state) => state.heatmapMode);
	const heatmapAlliance = useStudioStore((state) => state.heatmapAlliance);
	const heatmapSection = useStudioStore((state) => state.heatmapSection);
	const setHeatmapMode = useStudioStore((state) => state.setHeatmapMode);
	const setHeatmapAlliance = useStudioStore(
		(state) => state.setHeatmapAlliance
	);
	const setHeatmapSection = useStudioStore((state) => state.setHeatmapSection);
	const sectionOptions = useStudioStore(useShallow(selectSectionOptions));

	return (
		<section className="flex flex-col gap-3">
			<SectionRule label="Heatmap" />
			<div className="flex flex-col gap-0.5">
				{HEATMAP_MODES.map(({ mode, label }) => (
					<FilterRail
						active={heatmapMode === mode}
						key={mode}
						label={label}
						onClick={() => setHeatmapMode(mode)}
					/>
				))}
			</div>

			<FilterGroup label="Alliance">
				<div className="flex flex-wrap gap-x-2">
					{ALLIANCE_OPTIONS.map((value) => (
						<FilterChip
							active={heatmapAlliance === value}
							key={value}
							label={value}
							onClick={() => setHeatmapAlliance(value)}
						/>
					))}
				</div>
			</FilterGroup>

			<FilterGroup label="Phase">
				<div className="-mx-1 flex flex-wrap gap-x-1 gap-y-0.5">
					{sectionOptions.map((option) => (
						<FilterChip
							active={heatmapSection === option.kind}
							key={option.kind}
							label={option.label}
							onClick={() => setHeatmapSection(option.kind)}
						/>
					))}
				</div>
			</FilterGroup>
		</section>
	);
}

export function StageControls() {
	const stageView = useStudioStore((state) => state.stageView);
	if (stageView === "video") {
		return <OverlaySection />;
	}
	return <HeatmapSection />;
}

export function TracksSection() {
	const hasAnalytics = useStudioStore(selectHasAnalytics);
	const { tracks, maxShots } = useStudioStore(
		useShallow(selectInspectorTracks)
	);
	if (!hasAnalytics || tracks.length === 0) {
		return null;
	}

	return (
		<section className="flex flex-col gap-2">
			<SectionRule label="Tracks" />
			<div className="flex flex-col divide-y divide-foreground/6">
				{tracks.map((track) => (
					<RobotRow
						alliance={track.alliance}
						avgSpeed={track.avgSpeed}
						key={track.trackId}
						maxShots={maxShots}
						shots={track.shots}
						trackId={track.trackId}
					/>
				))}
			</div>
			<p className="text-[7px] text-muted-foreground/40 uppercase tracking-[0.16em]">
				Shots · avg speed
			</p>
		</section>
	);
}

export function EmptyState() {
	const hasAnalytics = useStudioStore(selectHasAnalytics);
	if (hasAnalytics) {
		return null;
	}

	return (
		<div className="flex flex-col gap-2 py-4">
			<p className="text-[9px] text-muted-foreground/50 uppercase tracking-[0.22em]">
				No signal
			</p>
			<p className="text-[8px] text-muted-foreground/35 uppercase leading-relaxed tracking-[0.14em]">
				Process match to populate telemetry
			</p>
		</div>
	);
}

import {
	type StudioStore,
	selectDisplayMatchStartMs,
	selectDisplayProcessingRange,
} from "./studio";
import type { MatchAnalytics, MatchStatus } from "./studio-data-types";

export interface InspectorTelemetry {
	avgSpeed: string;
	blue: number;
	rate: string;
	red: number;
	totalShots: string;
}

export interface InspectorTrack {
	alliance: string;
	avgSpeed: number;
	shots: number;
	trackId: number;
}

export interface SectionOption {
	kind: string;
	label: string;
}

const EMPTY_TELEMETRY: InspectorTelemetry = {
	totalShots: "—",
	red: 0,
	blue: 0,
	rate: "—",
	avgSpeed: "—",
};

const EMPTY_TRACKS_RESULT = {
	maxShots: 0,
	tracks: [] as InspectorTrack[],
};

const ALL_SECTION_OPTION: SectionOption = { kind: "all", label: "ALL" };

const UNSET = Symbol("memoize-unset");

function memoizeByReference<Input, Output>(
	compute: (input: Input) => Output
): (input: Input) => Output {
	let lastInput: Input | typeof UNSET = UNSET;
	let lastOutput: Output;
	return (input: Input) => {
		if (lastInput !== UNSET && input === lastInput) {
			return lastOutput;
		}
		lastInput = input;
		lastOutput = compute(input);
		return lastOutput;
	};
}

const computeInspectorTelemetry = memoizeByReference(
	(analytics: MatchAnalytics | null | undefined): InspectorTelemetry => {
		if (!analytics) {
			return EMPTY_TELEMETRY;
		}
		return {
			totalShots: String(analytics.totalShots).padStart(3, "0"),
			red: analytics.shotsByAlliance.red,
			blue: analytics.shotsByAlliance.blue,
			rate: analytics.shotsPerMinute.toFixed(1),
			avgSpeed: analytics.avgShotSpeed.toFixed(2),
		};
	}
);
const computeInspectorTracks = memoizeByReference(
	(byTrack: MatchAnalytics["byTrack"] | undefined) => {
		if (!byTrack || byTrack.length === 0) {
			return EMPTY_TRACKS_RESULT;
		}

		const tracks: InspectorTrack[] = byTrack.map((track) => ({
			trackId: track.trackId,
			alliance: track.alliance,
			shots: track.shots,
			avgSpeed: track.avgSpeed,
		}));
		const maxShots = Math.max(...tracks.map((track) => track.shots));
		return { tracks, maxShots };
	}
);

const computeSectionOptions = memoizeByReference(
	(derivedSections: StudioStore["derivedSections"]) => [
		ALL_SECTION_OPTION,
		...derivedSections.map((section) => ({
			kind: section.kind,
			label: section.label === "-" ? "DT" : section.label,
		})),
	]
);

export function selectMatchStatus(state: StudioStore): MatchStatus | null {
	return state.matchStatus;
}

export function selectHasAnalytics(state: StudioStore): boolean {
	return state.matchStatus === "ready" || state.matchStatus === "processing";
}

export function selectIsProcessing(state: StudioStore): boolean {
	return state.matchStatus === "processing";
}

export function selectInspectorTelemetry(
	state: StudioStore
): InspectorTelemetry {
	return computeInspectorTelemetry(state.analytics);
}

export function selectInspectorTracks(state: StudioStore): {
	maxShots: number;
	tracks: InspectorTrack[];
} {
	return computeInspectorTracks(state.analytics?.byTrack);
}

export function selectSectionOptions(state: StudioStore): SectionOption[] {
	return computeSectionOptions(state.derivedSections);
}

export function selectHeatmapView(state: StudioStore) {
	return {
		derivedSections: state.derivedSections,
		heatmapAlliance: state.heatmapAlliance,
		heatmapMode: state.heatmapMode,
		heatmapSection: state.heatmapSection,
		matchStatus: state.matchStatus,
		pathSamples: state.pathSamples,
		shotEvents: state.shotEvents,
	};
}

export function selectOverlay(state: StudioStore) {
	return {
		overlayLayers: state.overlayLayers,
		toggleOverlayLayer: state.toggleOverlayLayer,
	};
}

export function selectProcessingTrack(state: StudioStore) {
	return {
		durationMs: state.durationMs,
		fps: state.fps,
		effectiveRanges: state.effectiveRanges,
		displayProcessingRange: selectDisplayProcessingRange(state),
		setSeeking: state.setSeeking,
	};
}

export function selectRuler(state: StudioStore) {
	return {
		currentTimeMs: state.currentTimeMs,
		durationMs: state.durationMs,
		seek: state.seek,
		setSeeking: state.setSeeking,
	};
}

export function selectTrackSection(state: StudioStore) {
	return {
		derivedSections: state.derivedSections,
		durationMs: state.durationMs,
		displayMatchStartMs: selectDisplayMatchStartMs(state),
		toggleSectionAnalyse: state.toggleSectionAnalyse,
	};
}

export function selectMatchStart(state: StudioStore) {
	return {
		durationMs: state.durationMs,
		displayMatchStartMs: selectDisplayMatchStartMs(state),
		setSeeking: state.setSeeking,
	};
}

export function selectVideoToolbar(state: StudioStore) {
	return {
		currentTimeMs: state.currentTimeMs,
		durationMs: state.durationMs,
		playing: state.playing,
		setMatchStartAtPlayhead: state.setMatchStartAtPlayhead,
		setStageView: state.setStageView,
		stageView: state.stageView,
	};
}

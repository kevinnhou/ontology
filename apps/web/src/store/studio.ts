import type { Id } from "@ontology/backend/convex/_generated/dataModel";
import {
	computeEffectiveRanges,
	type DerivedSection,
	deriveMatchSections,
	normaliseSectionAnalyse,
	type SectionAnalyse,
	type SectionKind,
	sectionAnalyseEquals,
	type TimeRange,
	type TProcessingRange,
} from "@ontology/shared";
import { createStore } from "zustand";

import type { MatchDataPayload } from "./studio-data-types";
import type {
	ProbeMetadataArgs,
	TimelineData,
	UpdateTimelineArgs,
} from "./studio-types";

export interface StudioMutations {
	setMatchStart: (ms: number) => Promise<void>;
	updateProbeMetadata: (
		args: Pick<
			ProbeMetadataArgs,
			"durationMs" | "width" | "height" | "fps" | "frameCount"
		>
	) => Promise<void>;
	updateTimeline: (
		patch: Pick<UpdateTimelineArgs, "sectionAnalyse" | "processingRange">
	) => Promise<void>;
}

export interface CreateStudioStoreOptions {
	getVideoElement: () => HTMLVideoElement | null;
	matchId: Id<"matches">;
	matchTitle: string;
	mutations: StudioMutations;
	onOpenLibrary?: () => void;
	probedRef: { current: boolean };
	videoKey: string;
	videoUrl: string | null;
}

export interface StudioState extends MatchDataPayload {
	currentTimeMs: number;
	derivedSections: DerivedSection[];
	draftMatchStartMs: number | null;
	draftProcessingRange: TProcessingRange | null;
	durationLocked: boolean;
	durationMs: number;
	effectiveRanges: TimeRange[];
	fps: number | null;
	heatmapAlliance: HeatmapAlliance;
	heatmapMode: HeatmapMode;
	heatmapSection: string;
	matchId: Id<"matches">;
	matchStartMs: number | null;
	matchStartSource: "manual" | "audio" | "metadata" | null;
	matchTitle: string;
	onOpenLibrary?: () => void;
	optimisticSectionAnalyse: SectionAnalyse | null;
	overlayLayers: Record<"robots" | "fuel" | "shots", boolean>;
	playing: boolean;
	processingRange: TProcessingRange | null;
	sectionAnalyse: SectionAnalyse;
	seeking: boolean;
	stageView: StageView;
	videoKey: string;
	videoUrl: string | null;
}

export interface StudioActions {
	commitMatchStart: (ms: number) => Promise<void>;
	commitProcessingRange: (range: TProcessingRange) => Promise<void>;
	probeVideoMetadata: () => void;
	recomputeDerived: () => void;
	seek: (ms: number) => void;
	setCurrentTimeMs: (ms: number) => void;
	setDraftMatchStartMs: (ms: number | null) => void;
	setDraftProcessingRange: (range: TProcessingRange | null) => void;
	setDurationMs: (ms: number) => void;
	setHeatmapAlliance: (alliance: HeatmapAlliance) => void;
	setHeatmapMode: (mode: HeatmapMode) => void;
	setHeatmapSection: (section: string) => void;
	setMatchStartAtPlayhead: () => Promise<void>;
	setPlaying: (playing: boolean) => void;
	setSeeking: (seeking: boolean) => void;
	setSessionMeta: (
		meta: Partial<
			Pick<
				StudioState,
				"matchId" | "matchTitle" | "videoKey" | "videoUrl" | "onOpenLibrary"
			>
		>
	) => void;
	setStageView: (view: StageView) => void;
	syncFromServer: (timeline: TimelineData) => void;
	syncMatchData: (payload: Partial<MatchDataPayload>) => void;
	toggleOverlayLayer: (layer: OverlayLayer) => void;
	toggleSectionAnalyse: (kind: SectionKind, analyse: boolean) => Promise<void>;
}

export type StudioStore = StudioState & StudioActions;

export type OverlayLayer = "robots" | "fuel" | "shots";
export type StageView = "video" | "heatmap";
export type HeatmapMode = "pathing" | "shots";
export type HeatmapAlliance = "all" | "red" | "blue";

function processingRangeMatches(
	a: TProcessingRange,
	b: TProcessingRange
): boolean {
	return (
		Math.round(a.startMs) === Math.round(b.startMs) &&
		Math.round(a.endMs) === Math.round(b.endMs)
	);
}

const emptyMatchData: MatchDataPayload = {
	matchStatus: null,
	matchProgress: null,
	matchError: null,
	processedRanges: null,
	analytics: null,
	shotEvents: [],
	pathSamples: [],
	annotations: [],
};

function createInitialState(options: CreateStudioStoreOptions): StudioState {
	return {
		...emptyMatchData,
		matchId: options.matchId,
		matchTitle: options.matchTitle,
		videoKey: options.videoKey,
		videoUrl: options.videoUrl,
		onOpenLibrary: options.onOpenLibrary,
		matchStartMs: null,
		matchStartSource: null,
		sectionAnalyse: normaliseSectionAnalyse(),
		processingRange: null,
		durationMs: 0,
		durationLocked: false,
		fps: null,
		draftMatchStartMs: null,
		draftProcessingRange: null,
		optimisticSectionAnalyse: null,
		overlayLayers: { robots: true, fuel: true, shots: true },
		stageView: "video",
		heatmapMode: "pathing",
		heatmapAlliance: "all",
		heatmapSection: "all",
		currentTimeMs: 0,
		playing: false,
		seeking: false,
		derivedSections: [],
		effectiveRanges: [],
	};
}

function commitVideoSeek(
	getVideoElement: () => HTMLVideoElement | null,
	ms: number
): void {
	const video = getVideoElement();
	if (!(video && Number.isFinite(ms))) {
		return;
	}

	const seconds = ms / 1000;
	if (typeof video.fastSeek === "function") {
		video.fastSeek(seconds);
	} else {
		video.currentTime = seconds;
	}
}

export function createStudioStore(options: CreateStudioStoreOptions) {
	return createStore<StudioStore>((set, get) => {
		const recomputeDerived = () => {
			const state = get();
			const matchStartMs = state.draftMatchStartMs ?? state.matchStartMs;
			const processingRange =
				state.draftProcessingRange ?? state.processingRange;
			const sectionAnalyse =
				state.optimisticSectionAnalyse ?? state.sectionAnalyse;

			const derivedSections =
				matchStartMs === null
					? []
					: deriveMatchSections(matchStartMs, state.durationMs, sectionAnalyse);

			const effectiveRanges = computeEffectiveRanges(
				derivedSections,
				processingRange ?? undefined,
				state.durationMs
			);

			set({ derivedSections, effectiveRanges });
		};

		return {
			...createInitialState(options),

			recomputeDerived,

			setSessionMeta: (meta) => {
				const state = get();

				const resetMatchData =
					meta.matchId !== undefined && meta.matchId !== state.matchId;

				const preserveVideoUrl =
					meta.videoKey !== undefined &&
					meta.videoKey === state.videoKey &&
					meta.videoUrl !== undefined;

				if (preserveVideoUrl) {
					const { videoUrl: _ignored, ...rest } = meta;
					set(resetMatchData ? { ...rest, ...emptyMatchData } : rest);
					return;
				}

				set(resetMatchData ? { ...meta, ...emptyMatchData } : meta);
			},

			syncMatchData: (payload) => {
				set(payload);
			},

			syncFromServer: (timeline) => {
				const state = get();
				const sectionAnalyse = normaliseSectionAnalyse(
					timeline.sectionAnalyse ?? undefined
				);

				let draftMatchStartMs = state.draftMatchStartMs;
				if (
					draftMatchStartMs !== null &&
					timeline.matchStartMs !== null &&
					Math.round(timeline.matchStartMs) === Math.round(draftMatchStartMs)
				) {
					draftMatchStartMs = null;
				}

				let draftProcessingRange = state.draftProcessingRange;
				if (
					draftProcessingRange !== null &&
					timeline.processingRange !== null &&
					processingRangeMatches(timeline.processingRange, draftProcessingRange)
				) {
					draftProcessingRange = null;
				}

				let optimisticSectionAnalyse = state.optimisticSectionAnalyse;
				if (
					optimisticSectionAnalyse !== null &&
					sectionAnalyseEquals(sectionAnalyse, optimisticSectionAnalyse)
				) {
					optimisticSectionAnalyse = null;
				}

				const durationLocked = timeline.durationMs > 0;

				set({
					matchStartMs: timeline.matchStartMs,
					matchStartSource: timeline.matchStartSource,
					sectionAnalyse,
					processingRange: timeline.processingRange,
					durationMs: timeline.durationMs,
					durationLocked,
					fps: timeline.fps,
					draftMatchStartMs,
					draftProcessingRange,
					optimisticSectionAnalyse,
				});
				recomputeDerived();
			},

			setDraftMatchStartMs: (ms) => {
				set({ draftMatchStartMs: ms });
				recomputeDerived();
			},

			setDraftProcessingRange: (range) => {
				set({ draftProcessingRange: range });
				recomputeDerived();
			},

			setCurrentTimeMs: (ms) => {
				set({ currentTimeMs: ms });
			},

			setPlaying: (playing) => {
				set({ playing });
			},

			setSeeking: (seeking) => {
				const wasSeeking = get().seeking;
				set({ seeking });

				if (wasSeeking && !seeking) {
					commitVideoSeek(options.getVideoElement, get().currentTimeMs);
				}
			},

			setDurationMs: (ms) => {
				if (get().durationLocked) {
					return;
				}
				set({ durationMs: ms });
				recomputeDerived();
			},

			seek: (ms) => {
				const video = options.getVideoElement();
				if (!(video && Number.isFinite(ms))) {
					return;
				}

				const state = get();
				const maxMs =
					Number.isFinite(video.duration) && video.duration > 0
						? video.duration * 1000
						: state.durationMs;

				if (maxMs <= 0) {
					return;
				}

				const clampedMs = Math.max(0, Math.min(ms, maxMs));

				set({ currentTimeMs: clampedMs });

				if (!get().seeking) {
					commitVideoSeek(options.getVideoElement, clampedMs);
				}
			},

			commitMatchStart: async (ms) => {
				await options.mutations.setMatchStart(Math.round(ms));
			},

			commitProcessingRange: async (range) => {
				await options.mutations.updateTimeline({
					processingRange: {
						startMs: Math.round(range.startMs),
						endMs: Math.round(range.endMs),
					},
				});
			},

			toggleOverlayLayer: (layer) => {
				const { overlayLayers } = get();
				set({
					overlayLayers: {
						...overlayLayers,
						[layer]: !overlayLayers[layer],
					},
				});
			},

			setStageView: (view) => {
				set({ stageView: view });
			},

			setHeatmapMode: (mode) => {
				set({ heatmapMode: mode });
			},

			setHeatmapAlliance: (alliance) => {
				set({ heatmapAlliance: alliance });
			},

			setHeatmapSection: (section) => {
				set({ heatmapSection: section });
			},

			toggleSectionAnalyse: async (kind, analyse) => {
				const state = get();
				const current = state.optimisticSectionAnalyse ?? state.sectionAnalyse;
				const next: SectionAnalyse = { ...current };
				if (kind === "post_match") {
					next.post_match = analyse;
				} else {
					next[kind] = analyse;
				}
				set({ optimisticSectionAnalyse: next });
				recomputeDerived();
				try {
					await options.mutations.updateTimeline({ sectionAnalyse: next });
				} catch {
					set({ optimisticSectionAnalyse: null });
					recomputeDerived();
				}
			},

			setMatchStartAtPlayhead: async () => {
				const { currentTimeMs } = get();
				await options.mutations.setMatchStart(Math.round(currentTimeMs));
			},

			probeVideoMetadata: () => {
				const video = options.getVideoElement();
				if (!video || options.probedRef.current) {
					return;
				}
				if (!Number.isFinite(video.duration) || video.duration <= 0) {
					return;
				}

				const probedDurationMs = Math.round(video.duration * 1000);

				options.probedRef.current = true;
				if (!get().durationLocked) {
					set({ durationMs: probedDurationMs });
					recomputeDerived();
				}

				options.mutations
					.updateProbeMetadata({
						durationMs: probedDurationMs,
						width: video.videoWidth,
						height: video.videoHeight,
					})
					.catch(() => {
						options.probedRef.current = false;
					});
			},
		};
	});
}

export function selectDisplayMatchStartMs(state: StudioStore): number | null {
	return state.draftMatchStartMs ?? state.matchStartMs;
}

export function selectDisplayProcessingRange(
	state: StudioStore
): TProcessingRange | null {
	return state.draftProcessingRange ?? state.processingRange;
}

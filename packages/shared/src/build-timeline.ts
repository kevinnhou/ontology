import type { SectionAnalyse, TProcessingRange } from "./timing";

export type MatchStartSource = "manual" | "audio" | "metadata";

export function buildTimelineFromMatch(match: {
	matchStartMs?: number;
	matchStartSource?: MatchStartSource;
	sectionAnalyse?: SectionAnalyse & { teleop?: boolean; endgame?: boolean };
	processingRange?: TProcessingRange;
	durationMs?: number;
	fps?: number;
}) {
	return {
		matchStartMs: match.matchStartMs ?? null,
		matchStartSource: match.matchStartSource ?? null,
		sectionAnalyse: match.sectionAnalyse ?? null,
		processingRange: match.processingRange ?? null,
		durationMs: match.durationMs ?? 0,
		fps: match.fps ?? null,
	};
}

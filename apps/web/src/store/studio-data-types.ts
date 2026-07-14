import type { api } from "@ontology/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type MatchWithUrl = NonNullable<
	FunctionReturnType<typeof api.matches.get>
>;

export type MatchDoc = MatchWithUrl["match"];

export type MatchStatus = MatchDoc["status"];

export type MatchProgress = NonNullable<MatchDoc["progress"]>;

export type ProcessedRange = NonNullable<MatchDoc["processedRanges"]>[number];

export type MatchAnalytics = NonNullable<
	FunctionReturnType<typeof api.analysis.getAnalytics>
>;

export type ShotEventRow = FunctionReturnType<
	typeof api.analysis.listShotEvents
>[number];

export type PathSampleRow = FunctionReturnType<
	typeof api.detections.listPathSamples
>[number];

export type AnnotationRow = FunctionReturnType<
	typeof api.annotations.listByMatch
>[number];

export interface MatchDataPayload {
	analytics: MatchAnalytics | null;
	annotations: AnnotationRow[];
	matchError: string | null;
	matchProgress: MatchProgress | null;
	matchStatus: MatchStatus | null;
	pathSamples: PathSampleRow[];
	processedRanges: ProcessedRange[] | null;
	shotEvents: ShotEventRow[];
}

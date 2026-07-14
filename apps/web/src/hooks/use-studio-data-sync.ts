"use client";

import { api } from "@ontology/backend/convex/_generated/api";
import type { Id } from "@ontology/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useEffect } from "react";

import type { createStudioStore } from "@/store/studio";
import type { MatchDataPayload } from "@/store/studio-data-types";

/**
 * Mirrors reactive Convex match data into the studio Zustand store so that
 * workbench components read from one place instead of subscribing separately.
 */
export function useStudioDataSync({
	matchId,
	store,
}: {
	matchId: Id<"matches">;
	store: ReturnType<typeof createStudioStore>;
}) {
	const matchData = useQuery(api.matches.get, { matchId });
	const analytics = useQuery(api.analysis.getAnalytics, { matchId });
	const shotEvents = useQuery(api.analysis.listShotEvents, { matchId });
	const pathSamples = useQuery(api.detections.listPathSamples, { matchId });
	const annotations = useQuery(api.annotations.listByMatch, { matchId });

	useEffect(() => {
		const payload: Partial<MatchDataPayload> = {};

		if (matchData !== undefined) {
			const match = matchData?.match;
			payload.matchStatus = match?.status ?? null;
			payload.matchProgress = match?.progress ?? null;
			payload.matchError = match?.error ?? null;
			payload.processedRanges = match?.processedRanges ?? null;
		}
		if (analytics !== undefined) {
			payload.analytics = analytics;
		}
		if (shotEvents !== undefined) {
			payload.shotEvents = shotEvents;
		}
		if (pathSamples !== undefined) {
			payload.pathSamples = pathSamples;
		}
		if (annotations !== undefined) {
			payload.annotations = annotations;
		}

		if (Object.keys(payload).length > 0) {
			store.getState().syncMatchData(payload);
		}
	}, [store, matchData, analytics, shotEvents, pathSamples, annotations]);
}

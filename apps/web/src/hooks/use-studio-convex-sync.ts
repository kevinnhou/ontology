"use client";

import { api } from "@ontology/backend/convex/_generated/api";
import type { Id } from "@ontology/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { type RefObject, useEffect } from "react";

import type { createStudioStore, StudioMutations } from "@/store/studio";
import type { TimelineData } from "@/store/studio-types";

export function useStudioConvexSync({
	matchId,
	timeline,
	store,
	mutationsRef,
}: {
	matchId: Id<"matches">;
	timeline: TimelineData;
	store: ReturnType<typeof createStudioStore>;
	mutationsRef: RefObject<StudioMutations>;
}) {
	const updateProbeMetadata = useMutation(api.matches.updateProbeMetadata);
	const setMatchStartMutation = useMutation(api.matches.setMatchStart);
	const updateTimelineMutation = useMutation(api.matches.updateTimeline);

	mutationsRef.current = {
		setMatchStart: async (ms) => {
			await setMatchStartMutation({
				matchId,
				matchStartMs: ms,
				matchStartSource: "manual",
			});
		},
		updateProbeMetadata: async (args) => {
			await updateProbeMetadata({ matchId, ...args });
		},
		updateTimeline: async (patch) => {
			await updateTimelineMutation({ matchId, ...patch });
		},
	};

	useEffect(() => {
		store.getState().syncFromServer(timeline);
	}, [store, timeline]);
}

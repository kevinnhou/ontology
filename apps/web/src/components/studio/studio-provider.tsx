"use client";

import type { Id } from "@ontology/backend/convex/_generated/dataModel";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useStudioConvexSync } from "@/hooks/use-studio-convex-sync";
import { useStudioDataSync } from "@/hooks/use-studio-data-sync";
import { StudioStoreProvider } from "@/hooks/use-studio-store";
import { useVideoPlaybackSync } from "@/hooks/use-video-playback-sync";
import { stubMutations } from "@/lib/studio/stub-mutations";
import { createStudioStore, type StudioMutations } from "@/store/studio";
import type { TimelineData } from "@/store/studio-types";

export function StudioProvider({
	matchId,
	videoKey,
	videoUrl,
	matchTitle,
	timeline,
	onOpenLibrary,
	children,
}: {
	matchId: Id<"matches">;
	videoKey: string;
	videoUrl: string | null;
	matchTitle: string;
	timeline: TimelineData;
	onOpenLibrary?: () => void;
	children: ReactNode;
}) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const stageContainerRef = useRef<HTMLDivElement>(null);
	const seekingRef = useRef(false);
	const probedRef = useRef(false);
	const mutationsRef = useRef<StudioMutations>(stubMutations);

	const [store] = useState(() =>
		createStudioStore({
			matchId,
			matchTitle,
			videoKey,
			videoUrl,
			onOpenLibrary,
			probedRef,
			getVideoElement: () => videoRef.current,
			mutations: {
				setMatchStart: (ms) => mutationsRef.current.setMatchStart(ms),
				updateProbeMetadata: (args) =>
					mutationsRef.current.updateProbeMetadata(args),
				updateTimeline: (patch) => mutationsRef.current.updateTimeline(patch),
			},
		})
	);

	useStudioConvexSync({ matchId, timeline, store, mutationsRef });
	useStudioDataSync({ matchId, store });
	useVideoPlaybackSync({ store, videoRef, seekingRef });

	useEffect(() => {
		store
			.getState()
			.setSessionMeta({ matchTitle, videoKey, videoUrl, onOpenLibrary });
	}, [store, matchTitle, videoKey, videoUrl, onOpenLibrary]);

	return (
		<StudioStoreProvider
			stageContainerRef={stageContainerRef}
			store={store}
			videoRef={videoRef}
		>
			{children}
		</StudioStoreProvider>
	);
}

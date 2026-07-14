"use client";

import {
	createContext,
	createElement,
	type ReactNode,
	type RefObject,
	useContext,
} from "react";
import { useStore } from "zustand";

import type { StudioStore } from "@/store/studio";

type StudioStoreApi = ReturnType<
	typeof import("@/store/studio").createStudioStore
>;

const StudioStoreContext = createContext<StudioStoreApi | null>(null);

const VideoRefContext =
	createContext<RefObject<HTMLVideoElement | null> | null>(null);

const StageRefContext = createContext<RefObject<HTMLDivElement | null> | null>(
	null
);

export function StudioStoreProvider({
	store,
	videoRef,
	stageContainerRef,
	children,
}: {
	store: StudioStoreApi;
	videoRef: RefObject<HTMLVideoElement | null>;
	stageContainerRef: RefObject<HTMLDivElement | null>;
	children: ReactNode;
}) {
	return createElement(
		StudioStoreContext.Provider,
		{ value: store },
		createElement(
			VideoRefContext.Provider,
			{ value: videoRef },
			createElement(
				StageRefContext.Provider,
				{ value: stageContainerRef },
				children
			)
		)
	);
}

export function useStudioStore<T>(selector: (state: StudioStore) => T): T {
	const store = useContext(StudioStoreContext);
	if (!store) {
		throw new Error("useStudioStore must be used within StudioProvider");
	}
	return useStore(store, selector);
}

export function useStudioStoreApi(): StudioStoreApi {
	const store = useContext(StudioStoreContext);
	if (!store) {
		throw new Error("useStudioStoreApi must be used within StudioProvider");
	}
	return store;
}

export function useStudioVideoRef(): RefObject<HTMLVideoElement | null> {
	const videoRef = useContext(VideoRefContext);
	if (!videoRef) {
		throw new Error("useStudioVideoRef must be used within StudioProvider");
	}
	return videoRef;
}

export function useStudioStageRef(): RefObject<HTMLDivElement | null> {
	const stageRef = useContext(StageRefContext);
	if (!stageRef) {
		throw new Error("useStudioStageRef must be used within StudioProvider");
	}
	return stageRef;
}

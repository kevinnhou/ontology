"use client";

import { api } from "@ontology/backend/convex/_generated/api";
import type { Id } from "@ontology/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
	titleFromFilename,
	type UploadProgress,
	uploadVideoWithProgress,
} from "@/lib/upload-video";

export type StudioSessionState =
	| { status: "idle" }
	| { status: "uploading"; filename: string; progress: UploadProgress }
	| { status: "ready"; matchId: Id<"matches">; title: string }
	| { status: "error"; message: string };

function isMatchId(value: string): value is Id<"matches"> {
	return value.length > 0;
}

export function useStudioSession() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const generateVideoUploadUrl = useMutation(api.videos.generateVideoUploadUrl);
	const syncMetadata = useMutation(api.videos.syncMetadata);
	const createFromUpload = useMutation(api.matches.createFromUpload);
	const [state, setState] = useState<StudioSessionState>({ status: "idle" });
	const restoredFromUrl = useRef(false);

	const syncMatchUrl = useCallback(
		(matchId: Id<"matches"> | null) => {
			const params = new URLSearchParams(searchParams.toString());
			if (matchId) {
				params.set("match", matchId);
			} else {
				params.delete("match");
			}
			const query = params.toString();
			router.replace(query ? `/?${query}` : "/", { scroll: false });
		},
		[router, searchParams]
	);

	const openMatch = useCallback(
		(matchId: Id<"matches">, title: string) => {
			setState({ status: "ready", matchId, title });
			syncMatchUrl(matchId);
		},
		[syncMatchUrl]
	);

	const reset = useCallback(() => {
		setState({ status: "idle" });
		syncMatchUrl(null);
	}, [syncMatchUrl]);

	useEffect(() => {
		if (restoredFromUrl.current || state.status !== "idle") {
			return;
		}

		const matchParam = searchParams.get("match");
		if (matchParam && isMatchId(matchParam)) {
			restoredFromUrl.current = true;
			setState({
				status: "ready",
				matchId: matchParam,
				title: "Match",
			});
		}
	}, [searchParams, state.status]);

	const upload = useCallback(
		async (file: File) => {
			if (!file.name.toLowerCase().endsWith(".mp4")) {
				toast.error("Only MP4 files are supported");
				return;
			}

			const title = titleFromFilename(file.name);

			setState({
				status: "uploading",
				filename: file.name,
				progress: { loaded: 0, total: file.size, percent: 0 },
			});

			try {
				const { url, key } = await generateVideoUploadUrl();
				await uploadVideoWithProgress(url, file, (progress) => {
					setState({
						status: "uploading",
						filename: file.name,
						progress,
					});
				});
				await syncMetadata({ key });

				const matchId = await createFromUpload({
					videoKey: key,
					title,
				});

				openMatch(matchId, title);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Upload failed";
				if (message === "Not authenticated") {
					toast.error("Session expired — sign in again");
				} else {
					toast.error(message);
				}
				setState({ status: "error", message });
			}
		},
		[createFromUpload, generateVideoUploadUrl, openMatch, syncMetadata]
	);

	return { state, upload, openMatch, reset };
}

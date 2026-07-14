"use client";

import { api } from "@ontology/backend/convex/_generated/api";
import type { Id } from "@ontology/backend/convex/_generated/dataModel";
import { buildTimelineFromMatch } from "@ontology/shared";
import { useQuery } from "convex/react";
import { useCallback, useId } from "react";

import { useStudioSession } from "@/hooks/use-studio-session";
import { WORKBENCH_WIDTH } from "@/lib/studio/constants";
import AnalysisPanel from "./analysis";
import MatchLibrary from "./match-library";
import VideoStage from "./player/video-stage";
import VideoToolbar from "./player/video-toolbar";
import { StudioProvider } from "./studio-provider";
import Timeline from "./timeline";
import TopBar from "./top-bar";
import UploadProgress from "./upload-progress";

function DropZone({ onFile }: { onFile: (file: File) => void }) {
	const inputId = useId();

	const handleFiles = useCallback(
		(files: FileList | null) => {
			const file = files?.[0];
			if (file) {
				onFile(file);
			}
		},
		[onFile]
	);

	return (
		<label
			className="flex size-full cursor-pointer flex-col items-center justify-center border border-border border-dashed bg-card"
			htmlFor={inputId}
			onDragOver={(e) => {
				e.preventDefault();
			}}
			onDrop={(e) => {
				e.preventDefault();
				handleFiles(e.dataTransfer.files);
			}}
		>
			<p className="text-[10px] text-muted-foreground uppercase tracking-widest">
				Drop MP4
			</p>
			<p className="mt-2 text-[10px] text-muted-foreground/60 uppercase italic tracking-widest">
				or click to browse
			</p>
			<input
				accept="video/mp4,.mp4"
				className="sr-only"
				id={inputId}
				onChange={(e) => handleFiles(e.target.files)}
				type="file"
			/>
		</label>
	);
}

function MatchPlayer({
	matchId,
	fallbackTitle,
	onOpenLibrary,
}: {
	matchId: Id<"matches">;
	fallbackTitle: string;
	onOpenLibrary: () => void;
}) {
	const data = useQuery(api.matches.get, { matchId });

	if (data === undefined) {
		return (
			<div
				className={`flex ${WORKBENCH_WIDTH} flex-1 items-center justify-center border border-border bg-card`}
			>
				<p className="text-[10px] text-muted-foreground uppercase tracking-widest">
					Loading
				</p>
			</div>
		);
	}

	if (!data?.videoUrl) {
		return (
			<div
				className={`flex ${WORKBENCH_WIDTH} flex-1 items-center justify-center border border-border bg-card`}
			>
				<p className="text-[10px] text-muted-foreground uppercase tracking-widest">
					Video unavailable
				</p>
			</div>
		);
	}

	const timeline = buildTimelineFromMatch(data.match);
	const matchTitle = data.match.title || fallbackTitle;

	return (
		<StudioProvider
			key={matchId}
			matchId={matchId}
			matchTitle={matchTitle}
			onOpenLibrary={onOpenLibrary}
			timeline={timeline}
			videoKey={data.match.videoKey}
			videoUrl={data.videoUrl}
		>
			<div className="flex min-h-0 w-full flex-1 flex-col gap-0">
				<TopBar
					matchTitle={matchTitle}
					onOpenLibrary={onOpenLibrary}
					withMatch
				/>
				<div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] border border-border border-t-0">
					<div className="relative min-h-0 min-w-0 bg-black">
						<VideoStage />
					</div>
					<div className="min-h-0 overflow-y-auto border-border border-l">
						<AnalysisPanel />
					</div>
				</div>
				<Timeline />
				<VideoToolbar />
			</div>
		</StudioProvider>
	);
}

export default function DropFrame() {
	const { state, upload, openMatch, reset } = useStudioSession();

	return (
		<div className="flex min-h-0 flex-1 flex-col items-center overflow-hidden">
			{state.status === "idle" && (
				<div
					className={`flex ${WORKBENCH_WIDTH} flex-col gap-3 overflow-y-auto py-1`}
				>
					<TopBar />
					<div className="relative aspect-video border border-border bg-card">
						<DropZone onFile={upload} />
					</div>
					<MatchLibrary onOpenMatch={openMatch} />
				</div>
			)}
			{state.status === "uploading" && (
				<div className={`flex ${WORKBENCH_WIDTH} flex-col gap-3`}>
					<TopBar />
					<div className="relative aspect-video border border-border bg-card">
						<div className="flex size-full items-center justify-center bg-black/40">
							<p className="text-[10px] text-muted-foreground uppercase tracking-widest">
								Uploading
							</p>
						</div>
						<UploadProgress
							filename={state.filename}
							progress={state.progress}
						/>
					</div>
				</div>
			)}
			{state.status === "ready" && (
				<div className={`flex min-h-0 flex-1 ${WORKBENCH_WIDTH}`}>
					<MatchPlayer
						fallbackTitle={state.title}
						matchId={state.matchId}
						onOpenLibrary={reset}
					/>
				</div>
			)}
			{state.status === "error" && (
				<div className={`flex ${WORKBENCH_WIDTH} flex-col gap-3`}>
					<TopBar />
					<div className="relative flex aspect-video flex-col items-center justify-center gap-3 border border-border bg-card">
						<p className="text-[10px] text-destructive uppercase tracking-widest">
							{state.message}
						</p>
						<button
							className="border border-border px-3 py-1 text-[10px] text-foreground uppercase tracking-widest transition-colors hover:text-muted-foreground"
							onClick={reset}
							type="button"
						>
							Retry
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

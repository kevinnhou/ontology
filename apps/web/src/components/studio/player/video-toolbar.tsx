"use client";

import { useShallow } from "zustand/react/shallow";

import { useStudioStore } from "@/hooks/use-studio-store";
import { selectVideoToolbar } from "@/store/studio-selectors";

import ProcessButton from "./process-button";
import { TransportControls } from "./transport-controls";

function FilterButton({
	active,
	label,
	onClick,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			className={`border px-2 py-0.5 text-[8px] uppercase tracking-widest transition-colors ${
				active
					? "border-foreground/60 text-foreground"
					: "border-border text-muted-foreground/60 hover:text-muted-foreground"
			}`}
			onClick={onClick}
			type="button"
		>
			{label}
		</button>
	);
}

export default function VideoToolbar() {
	const { setMatchStartAtPlayhead, stageView, setStageView } = useStudioStore(
		useShallow(selectVideoToolbar)
	);

	return (
		<div className="shrink-0 border border-border border-t-0 bg-card">
			<div className="flex items-center gap-2 px-2 py-1.5">
				<TransportControls playDisabled={stageView === "heatmap"} />

				<div className="flex flex-1 items-center justify-center gap-2">
					<button
						className="border border-border px-2 py-0.5 text-[8px] text-foreground uppercase tracking-widest hover:text-muted-foreground"
						onClick={() => {
							setMatchStartAtPlayhead().catch(() => undefined);
						}}
						type="button"
					>
						Set match start
					</button>
					<ProcessButton />
				</div>

				<div className="flex items-center gap-2">
					<FilterButton
						active={stageView === "heatmap"}
						label="Heatmap"
						onClick={() =>
							setStageView(stageView === "heatmap" ? "video" : "heatmap")
						}
					/>
				</div>
			</div>
		</div>
	);
}

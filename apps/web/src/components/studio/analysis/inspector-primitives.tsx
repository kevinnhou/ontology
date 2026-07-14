import { cn } from "@ontology/ui/lib/utils";
import type { ReactNode } from "react";

import {
	allianceBarClass,
	allianceTone,
	formatPercent,
} from "@/lib/studio/inspector-format";

export function CornerMarks() {
	return (
		<span className="pointer-events-none absolute top-2 left-2 size-2 border-foreground/25 border-t border-l" />
	);
}

export function SectionRule({ label }: { label: string }) {
	return (
		<div className="flex items-center gap-2">
			<span className="shrink-0 text-[8px] text-muted-foreground/70 uppercase tracking-[0.2em]">
				{label}
			</span>
			<span className="h-px flex-1 bg-border/60" />
		</div>
	);
}

export function LedgerRow({
	label,
	value,
	unit,
	large = false,
}: {
	label: string;
	value: string;
	unit?: string;
	large?: boolean;
}) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="text-[8px] text-muted-foreground/70 uppercase tracking-[0.18em]">
				{label}
			</span>
			<span
				className={cn(
					"text-foreground tabular-nums tracking-tight",
					large ? "text-2xl leading-none" : "text-[11px]"
				)}
			>
				{value}
				{unit && (
					<span className="ml-1 text-[8px] text-muted-foreground/60">
						{unit}
					</span>
				)}
			</span>
		</div>
	);
}

export function AllianceSplit({ red, blue }: { red: number; blue: number }) {
	const total = red + blue;
	const redPct = total > 0 ? (red / total) * 100 : 50;
	const bluePct = total > 0 ? (blue / total) * 100 : 50;

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex h-1.5 w-full overflow-hidden bg-foreground/5">
				<div
					className="h-full bg-red-500/75 transition-[width] duration-300"
					style={{ width: `${redPct}%` }}
				/>
				<div
					className="h-full bg-blue-500/75 transition-[width] duration-300"
					style={{ width: `${bluePct}%` }}
				/>
			</div>
			<div className="flex justify-between text-[8px] uppercase tracking-widest">
				<span className="text-red-400/90 tabular-nums">
					red {red}
					<span className="ml-1 text-muted-foreground/50">
						{formatPercent(total, red)}
					</span>
				</span>
				<span className="text-blue-400/90 tabular-nums">
					<span className="mr-1 text-muted-foreground/50">
						{formatPercent(total, blue)}
					</span>
					blue {blue}
				</span>
			</div>
		</div>
	);
}

export function FilterRail({
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
			className={cn(
				"flex w-full items-center gap-2 py-0.5 text-left text-[9px] uppercase tracking-[0.16em] transition-colors",
				active
					? "text-foreground"
					: "text-muted-foreground/45 hover:text-muted-foreground"
			)}
			onClick={onClick}
			type="button"
		>
			<span
				className={cn(
					"w-2 shrink-0 text-[8px]",
					active ? "text-foreground" : "text-transparent"
				)}
			>
				▸
			</span>
			<span
				className={cn(
					active && "underline decoration-foreground/40 underline-offset-4"
				)}
			>
				{label}
			</span>
		</button>
	);
}

export function FilterChip({
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
			className={cn(
				"px-1 py-0.5 text-[8px] uppercase tracking-[0.14em] transition-colors",
				active
					? "text-foreground underline decoration-foreground/50 underline-offset-4"
					: "text-muted-foreground/45 hover:text-muted-foreground"
			)}
			onClick={onClick}
			type="button"
		>
			{label}
		</button>
	);
}

export function FilterGroup({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<span className="text-[8px] text-muted-foreground/45 uppercase tracking-[0.18em]">
				{label}
			</span>
			{children}
		</div>
	);
}

export function RobotRow({
	alliance,
	avgSpeed,
	maxShots,
	shots,
	trackId,
}: {
	alliance: string;
	avgSpeed: number;
	maxShots: number;
	shots: number;
	trackId: number;
}) {
	const barWidth = maxShots > 0 ? (shots / maxShots) * 100 : 0;

	return (
		<div className="group grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5 py-1">
			<span className={cn("text-[9px] tabular-nums", allianceTone(alliance))}>
				R{String(trackId).padStart(2, "0")}
			</span>
			<div className="flex flex-col gap-0.5">
				<div className="h-px w-full bg-foreground/8">
					<div
						className={cn(
							"h-px transition-[width] duration-300",
							allianceBarClass(alliance)
						)}
						style={{ width: `${barWidth}%` }}
					/>
				</div>
			</div>
			<span className="text-[8px] text-muted-foreground tabular-nums tracking-wide">
				{shots}
				<span className="text-muted-foreground/40"> · </span>
				{avgSpeed.toFixed(1)}
			</span>
		</div>
	);
}

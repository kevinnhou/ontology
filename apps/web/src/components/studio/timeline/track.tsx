"use client";

import type { ReactNode } from "react";

import { TIMELINE_LABEL_CLASS } from "@/lib/studio/timeline-constants";

export function Label({ children }: { children: ReactNode }) {
	return (
		<div
			className={`${TIMELINE_LABEL_CLASS} flex items-center border-border border-r px-1.5`}
		>
			<span className="text-[9px] text-muted-foreground uppercase tracking-widest">
				{children}
			</span>
		</div>
	);
}

export default function Track({
	label,
	children,
	height = "h-9",
}: {
	label: string;
	children: ReactNode;
	height?: string;
}) {
	return (
		<div className={`flex border-border border-t ${height}`}>
			<Label>{label}</Label>
			<div className="relative min-w-0 flex-1">{children}</div>
		</div>
	);
}

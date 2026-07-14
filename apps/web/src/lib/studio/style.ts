export function statusChipClass(status: string | undefined): string {
	switch (status) {
		case "ready":
			return "border-emerald-500/40 text-emerald-400";
		case "processing":
			return "border-amber-500/40 text-amber-400";
		case "failed":
			return "border-destructive/40 text-destructive";
		default:
			return "border-border text-muted-foreground";
	}
}

export function shotMarkerClass(alliance: string): string {
	if (alliance === "red") {
		return "bg-red-500";
	}
	if (alliance === "blue") {
		return "bg-blue-500";
	}
	return "bg-foreground/80";
}

export const SECTION_COLORS: Record<string, string> = {
	pre_match: "bg-muted-foreground/20",
	auto: "bg-foreground/25",
	downtime: "bg-muted-foreground/15",
	shift_1: "bg-foreground/12",
	shift_2: "bg-foreground/14",
	shift_3: "bg-foreground/16",
	shift_4: "bg-foreground/18",
	shift_5: "bg-foreground/20",
	end_game: "bg-foreground/30",
	post_match: "bg-muted-foreground/10",
};

export function allianceTone(alliance: string): string {
	if (alliance === "red") {
		return "text-red-400";
	}
	if (alliance === "blue") {
		return "text-blue-400";
	}
	return "text-muted-foreground";
}

export function allianceBarClass(alliance: string): string {
	if (alliance === "red") {
		return "bg-red-500/70";
	}
	if (alliance === "blue") {
		return "bg-blue-500/70";
	}
	return "bg-muted-foreground/40";
}

export function formatPercent(total: number, value: number): string {
	if (total <= 0) {
		return "—";
	}
	return `${((value / total) * 100).toFixed(0)}%`;
}

import type {
	HeatmapAlliance,
	HeatmapMode,
	OverlayLayer,
} from "@/store/studio";

export const OVERLAY_LAYERS: { key: OverlayLayer; label: string }[] = [
	{ key: "robots", label: "Robots" },
	{ key: "fuel", label: "Fuel" },
	{ key: "shots", label: "Shots" },
];

export const ALLIANCE_OPTIONS = [
	"all",
	"red",
	"blue",
] as const satisfies readonly HeatmapAlliance[];

export const HEATMAP_MODES: { mode: HeatmapMode; label: string }[] = [
	{ mode: "pathing", label: "Pathing density" },
	{ mode: "shots", label: "Shot origins" },
];

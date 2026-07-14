import type { HeatmapAlliance, HeatmapMode } from "@/store/studio";

import type { HeatPoint } from "./heatmap-canvas";

interface SectionRange {
	endMs: number;
	startMs: number;
}

interface ShotEventRow {
	alliance: string;
	origin: { x: number; y: number };
	timestampMs: number;
}

interface PathSamplePoint {
	alliance?: string;
	timestampMs: number;
	x: number;
	y: number;
}

function inSectionRange(
	timestampMs: number,
	range: SectionRange | null
): boolean {
	return !range || (timestampMs >= range.startMs && timestampMs <= range.endMs);
}

function allianceMatches(
	value: string | undefined,
	filter: HeatmapAlliance
): boolean {
	return filter === "all" || value === filter;
}

function shotHeatPoints(
	shots: ShotEventRow[],
	range: SectionRange | null,
	filter: HeatmapAlliance
): HeatPoint[] {
	return shots
		.filter(
			(shot) =>
				inSectionRange(shot.timestampMs, range) &&
				allianceMatches(shot.alliance, filter)
		)
		.map((shot) => ({ x: shot.origin.x, y: shot.origin.y, weight: 2 }));
}

function pathingHeatPoints(
	samples: PathSamplePoint[],
	range: SectionRange | null,
	filter: HeatmapAlliance
): HeatPoint[] {
	return samples
		.filter(
			(sample) =>
				inSectionRange(sample.timestampMs, range) &&
				allianceMatches(sample.alliance, filter)
		)
		.map((sample) => ({ x: sample.x, y: sample.y }));
}

export function buildHeatPoints(
	mode: HeatmapMode,
	shotEvents: ShotEventRow[] | undefined,
	pathSamples: PathSamplePoint[] | undefined,
	sectionRange: SectionRange | null,
	alliance: HeatmapAlliance
): HeatPoint[] {
	if (mode === "shots") {
		return shotHeatPoints(shotEvents ?? [], sectionRange, alliance);
	}
	return pathingHeatPoints(pathSamples ?? [], sectionRange, alliance);
}

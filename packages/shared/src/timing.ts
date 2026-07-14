export const MATCH_DURATION_MS = 165_000;

export const MATCH_PERIODS = [
	{ kind: "auto", label: "AUTO", elapsedMs: 0, durationMs: 20_000 },
	{ kind: "downtime", label: "-", elapsedMs: 20_000, durationMs: 5000 },
	{ kind: "shift_1", label: "S1", elapsedMs: 25_000, durationMs: 10_000 },
	{ kind: "shift_2", label: "S2", elapsedMs: 35_000, durationMs: 25_000 },
	{ kind: "shift_3", label: "S3", elapsedMs: 60_000, durationMs: 25_000 },
	{ kind: "shift_4", label: "S4", elapsedMs: 85_000, durationMs: 25_000 },
	{ kind: "shift_5", label: "S5", elapsedMs: 110_000, durationMs: 25_000 },
	{ kind: "end_game", label: "END", elapsedMs: 135_000, durationMs: 30_000 },
] as const;

export type MatchPeriodKind = (typeof MATCH_PERIODS)[number]["kind"];

export type SectionKind = "pre_match" | MatchPeriodKind | "post_match";

export interface SectionAnalyse {
	auto: boolean;
	downtime: boolean;
	end_game: boolean;
	post_match?: boolean;
	pre_match: boolean;
	shift_1: boolean;
	shift_2: boolean;
	shift_3: boolean;
	shift_4: boolean;
	shift_5: boolean;
}

export interface DerivedSection {
	analyse: boolean;
	endMs: number;
	kind: SectionKind;
	label: string;
	startMs: number;
}

export interface TimeRange {
	endMs: number;
	startMs: number;
}

export interface TProcessingRange {
	endMs: number;
	startMs: number;
}

export const DEFAULT_SECTION_ANALYSE: SectionAnalyse = {
	pre_match: false,
	auto: true,
	downtime: false,
	shift_1: true,
	shift_2: true,
	shift_3: true,
	shift_4: true,
	shift_5: true,
	end_game: true,
	post_match: false,
};

export function normaliseSectionAnalyse(
	input?: Partial<SectionAnalyse> & { endgame?: boolean; teleop?: boolean }
): SectionAnalyse {
	if (!input) {
		return DEFAULT_SECTION_ANALYSE;
	}

	const teleopEnabled = input.teleop ?? DEFAULT_SECTION_ANALYSE.shift_1;
	const endgameEnabled =
		input.endgame ?? input.end_game ?? DEFAULT_SECTION_ANALYSE.end_game;

	return {
		pre_match: input.pre_match ?? DEFAULT_SECTION_ANALYSE.pre_match,
		auto: input.auto ?? DEFAULT_SECTION_ANALYSE.auto,
		downtime: input.downtime ?? DEFAULT_SECTION_ANALYSE.downtime,
		shift_1: input.shift_1 ?? teleopEnabled,
		shift_2: input.shift_2 ?? teleopEnabled,
		shift_3: input.shift_3 ?? teleopEnabled,
		shift_4: input.shift_4 ?? teleopEnabled,
		shift_5: input.shift_5 ?? teleopEnabled,
		end_game: input.end_game ?? endgameEnabled,
		post_match: input.post_match ?? DEFAULT_SECTION_ANALYSE.post_match,
	};
}

export function defaultProcessingRange(matchStartMs: number): TProcessingRange {
	return {
		startMs: matchStartMs,
		endMs: matchStartMs + MATCH_DURATION_MS,
	};
}

function sectionAnalyseForKind(
	sectionAnalyse: SectionAnalyse,
	kind: SectionKind
): boolean {
	if (kind === "post_match") {
		return sectionAnalyse.post_match ?? false;
	}
	return sectionAnalyse[kind as keyof SectionAnalyse] as boolean;
}

function clampRange(
	startMs: number,
	endMs: number,
	durationMs: number
): TimeRange {
	const start = Math.max(0, Math.min(startMs, durationMs));
	const end = Math.max(start, Math.min(endMs, durationMs));
	return { startMs: start, endMs: end };
}

export function deriveMatchSections(
	matchStartMs: number,
	durationMs: number,
	sectionAnalyse: SectionAnalyse = DEFAULT_SECTION_ANALYSE
): DerivedSection[] {
	const matchEndMs = matchStartMs + MATCH_DURATION_MS;
	const sections: DerivedSection[] = [];

	if (matchStartMs > 0) {
		sections.push({
			kind: "pre_match",
			label: "PRE",
			startMs: 0,
			endMs: matchStartMs,
			analyse: sectionAnalyseForKind(sectionAnalyse, "pre_match"),
		});
	}

	for (const period of MATCH_PERIODS) {
		sections.push({
			kind: period.kind,
			label: period.label,
			startMs: matchStartMs + period.elapsedMs,
			endMs: matchStartMs + period.elapsedMs + period.durationMs,
			analyse: sectionAnalyseForKind(sectionAnalyse, period.kind),
		});
	}

	if (matchEndMs < durationMs) {
		sections.push({
			kind: "post_match",
			label: "POST",
			startMs: matchEndMs,
			endMs: durationMs,
			analyse: sectionAnalyseForKind(sectionAnalyse, "post_match"),
		});
	}

	return sections.map((section) => {
		const range = clampRange(section.startMs, section.endMs, durationMs);
		return { ...section, ...range };
	});
}

function intersectRanges(a: TimeRange, b: TimeRange): TimeRange | null {
	const startMs = Math.max(a.startMs, b.startMs);
	const endMs = Math.min(a.endMs, b.endMs);
	if (startMs >= endMs) {
		return null;
	}
	return { startMs, endMs };
}

function mergeRanges(ranges: TimeRange[]): TimeRange[] {
	if (ranges.length === 0) {
		return [];
	}

	const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs);
	const merged: TimeRange[] = [sorted[0] ?? { startMs: 0, endMs: 0 }];

	for (let index = 1; index < sorted.length; index++) {
		const current = sorted[index];
		const last = merged.at(-1);
		if (!(current && last)) {
			continue;
		}
		if (current.startMs <= last.endMs) {
			last.endMs = Math.max(last.endMs, current.endMs);
		} else {
			merged.push(current);
		}
	}

	return merged;
}

export function computeEffectiveRanges(
	sections: DerivedSection[],
	processingRange: TProcessingRange | undefined,
	durationMs: number
): TimeRange[] {
	if (!processingRange) {
		return [];
	}

	const window = clampRange(
		processingRange.startMs,
		processingRange.endMs,
		durationMs
	);

	const intersections: TimeRange[] = [];
	for (const section of sections) {
		if (!section.analyse) {
			continue;
		}
		const intersection = intersectRanges(window, section);
		if (intersection) {
			intersections.push(intersection);
		}
	}

	return mergeRanges(intersections);
}

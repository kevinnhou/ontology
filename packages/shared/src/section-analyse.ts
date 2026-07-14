import { normaliseSectionAnalyse, type SectionAnalyse } from "./timing";

export function sectionAnalyseEquals(
	a: SectionAnalyse,
	b: SectionAnalyse
): boolean {
	const normalisedA = normaliseSectionAnalyse(a);
	const normalisedB = normaliseSectionAnalyse(b);

	return (
		normalisedA.pre_match === normalisedB.pre_match &&
		normalisedA.auto === normalisedB.auto &&
		normalisedA.downtime === normalisedB.downtime &&
		normalisedA.shift_1 === normalisedB.shift_1 &&
		normalisedA.shift_2 === normalisedB.shift_2 &&
		normalisedA.shift_3 === normalisedB.shift_3 &&
		normalisedA.shift_4 === normalisedB.shift_4 &&
		normalisedA.shift_5 === normalisedB.shift_5 &&
		normalisedA.end_game === normalisedB.end_game &&
		(normalisedA.post_match ?? false) === (normalisedB.post_match ?? false)
	);
}

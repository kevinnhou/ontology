import { v } from "convex/values";

export const pointValidator = v.object({
	x: v.number(),
	y: v.number(),
});

export const sizeValidator = v.object({
	w: v.number(),
	h: v.number(),
});

export const geometryValidator = v.union(
	v.object({
		kind: v.literal("line"),
		start: pointValidator,
		end: pointValidator,
	}),
	v.object({
		kind: v.literal("polyline"),
		points: v.array(pointValidator),
	}),
	v.object({
		kind: v.literal("rect"),
		origin: pointValidator,
		size: sizeValidator,
	}),
	v.object({
		kind: v.literal("arrow"),
		start: pointValidator,
		end: pointValidator,
	}),
	v.object({
		kind: v.literal("point"),
		at: pointValidator,
	})
);

export const annotationStyleValidator = v.object({
	colour: v.optional(v.string()),
	strokeWidth: v.optional(v.number()),
});

export const bboxValidator = v.object({
	x: v.number(),
	y: v.number(),
	w: v.number(),
	h: v.number(),
});

export const allianceValidator = v.union(
	v.literal("red"),
	v.literal("blue"),
	v.literal("unknown")
);

export const detectionValidator = v.object({
	label: v.string(),
	confidence: v.number(),
	bbox: bboxValidator,
	trackId: v.optional(v.number()),
	alliance: v.optional(allianceValidator),
});

export const shotEventValidator = v.object({
	trackId: v.optional(v.number()),
	alliance: allianceValidator,
	frameIndex: v.number(),
	timestampMs: v.number(),
	origin: pointValidator,
	speed: v.number(),
});

export const matchAnalyticsValidator = v.object({
	totalShots: v.number(),
	shotsByAlliance: v.object({
		red: v.number(),
		blue: v.number(),
		unknown: v.number(),
	}),
	shotsPerMinute: v.number(),
	avgShotSpeed: v.number(),
	byTrack: v.array(
		v.object({
			trackId: v.number(),
			alliance: allianceValidator,
			shots: v.number(),
			avgSpeed: v.number(),
		})
	),
	processedFrames: v.number(),
	processedDurationMs: v.number(),
});

export const matchStatusValidator = v.union(
	v.literal("uploading"),
	v.literal("pending"),
	v.literal("processing"),
	v.literal("ready"),
	v.literal("failed")
);

export const matchProgressValidator = v.object({
	processedFrames: v.number(),
	totalFrames: v.number(),
});

export const matchStartSourceValidator = v.union(
	v.literal("manual"),
	v.literal("audio"),
	v.literal("metadata")
);

export const sectionAnalyseValidator = v.object({
	pre_match: v.boolean(),
	auto: v.boolean(),
	downtime: v.boolean(),
	shift_1: v.boolean(),
	shift_2: v.boolean(),
	shift_3: v.boolean(),
	shift_4: v.boolean(),
	shift_5: v.boolean(),
	end_game: v.boolean(),
	post_match: v.optional(v.boolean()),
});

export const processingRangeValidator = v.object({
	startMs: v.number(),
	endMs: v.number(),
});

export const sectionKindValidator = v.union(
	v.literal("pre_match"),
	v.literal("auto"),
	v.literal("downtime"),
	v.literal("shift_1"),
	v.literal("shift_2"),
	v.literal("shift_3"),
	v.literal("shift_4"),
	v.literal("shift_5"),
	v.literal("end_game"),
	v.literal("post_match")
);

export const derivedSectionValidator = v.object({
	kind: sectionKindValidator,
	label: v.string(),
	startMs: v.number(),
	endMs: v.number(),
	analyse: v.boolean(),
});

export const timeRangeValidator = v.object({
	startMs: v.number(),
	endMs: v.number(),
});

export const pathSamplePointValidator = v.object({
	x: v.number(),
	y: v.number(),
	alliance: v.optional(allianceValidator),
	timestampMs: v.number(),
});

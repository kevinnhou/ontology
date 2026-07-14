import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
	allianceValidator,
	annotationStyleValidator,
	detectionValidator,
	geometryValidator,
	matchAnalyticsValidator,
	matchProgressValidator,
	matchStartSourceValidator,
	matchStatusValidator,
	pathSamplePointValidator,
	pointValidator,
	processingRangeValidator,
	sectionAnalyseValidator,
	timeRangeValidator,
} from "./lib/validators";

export default defineSchema({
	matches: defineTable({
		userId: v.string(),
		title: v.string(),
		source: v.literal("upload"),
		videoKey: v.string(),
		status: matchStatusValidator,
		fps: v.optional(v.number()),
		durationMs: v.optional(v.number()),
		width: v.optional(v.number()),
		height: v.optional(v.number()),
		frameCount: v.optional(v.number()),
		frameStride: v.number(),
		progress: v.optional(matchProgressValidator),
		error: v.optional(v.string()),
		matchStartMs: v.optional(v.number()),
		matchStartSource: v.optional(matchStartSourceValidator),
		sectionAnalyse: v.optional(sectionAnalyseValidator),
		processingRange: v.optional(processingRangeValidator),
		processedRanges: v.optional(v.array(timeRangeValidator)),
		createdAt: v.number(),
	}).index("by_user", ["userId"]),

	frameDetections: defineTable({
		matchId: v.id("matches"),
		frameIndex: v.number(),
		timestampMs: v.number(),
		detections: v.array(detectionValidator),
	})
		.index("by_match_and_frame", ["matchId", "frameIndex"])
		.index("by_match_and_timestamp", ["matchId", "timestampMs"]),

	pathSamples: defineTable({
		matchId: v.id("matches"),
		bucketIndex: v.number(),
		points: v.array(pathSamplePointValidator),
	}).index("by_match_and_bucket", ["matchId", "bucketIndex"]),

	shotEvents: defineTable({
		matchId: v.id("matches"),
		trackId: v.optional(v.number()),
		alliance: allianceValidator,
		frameIndex: v.number(),
		timestampMs: v.number(),
		origin: pointValidator,
		speed: v.number(),
	}).index("by_match", ["matchId"]),

	matchAnalytics: defineTable({
		matchId: v.id("matches"),
		analytics: matchAnalyticsValidator,
		updatedAt: v.number(),
	}).index("by_match", ["matchId"]),

	annotations: defineTable({
		matchId: v.id("matches"),
		userId: v.string(),
		frameIndex: v.number(),
		frameEnd: v.optional(v.number()),
		geometry: geometryValidator,
		text: v.optional(v.string()),
		style: v.optional(annotationStyleValidator),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_match", ["matchId"]),
});

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
	allianceValidator,
	annotationStyleValidator,
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
	visionJobStatusValidator,
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
		detectionsKey: v.optional(v.string()),
		visionJobId: v.optional(v.id("visionJobs")),
		createdAt: v.number(),
	}).index("by_user", ["userId"]),

	pathSamples: defineTable({
		matchId: v.id("matches"),
		visionJobId: v.optional(v.id("visionJobs")),
		bucketIndex: v.number(),
		points: v.array(pathSamplePointValidator),
	})
		.index("by_match_and_bucket", ["matchId", "bucketIndex"])
		.index("by_match_and_job", ["matchId", "visionJobId"])
		.index("by_match_and_job_and_bucket", [
			"matchId",
			"visionJobId",
			"bucketIndex",
		]),

	shotEvents: defineTable({
		matchId: v.id("matches"),
		visionJobId: v.optional(v.id("visionJobs")),
		trackId: v.optional(v.number()),
		alliance: allianceValidator,
		frameIndex: v.number(),
		timestampMs: v.number(),
		origin: pointValidator,
		speed: v.number(),
	})
		.index("by_match", ["matchId"])
		.index("by_match_and_job", ["matchId", "visionJobId"]),

	matchAnalytics: defineTable({
		matchId: v.id("matches"),
		visionJobId: v.optional(v.id("visionJobs")),
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

	visionJobs: defineTable({
		matchId: v.id("matches"),
		videoKey: v.string(),
		frameStride: v.number(),
		fps: v.optional(v.number()),
		ranges: v.array(timeRangeValidator),
		status: visionJobStatusValidator,
		attemptCount: v.number(),
		maxAttempts: v.number(),
		progress: matchProgressValidator,
		detectionsKey: v.optional(v.string()),
		workerId: v.optional(v.string()),
		runId: v.optional(v.string()),
		queuedAt: v.number(),
		startedAt: v.optional(v.number()),
		heartbeatAt: v.optional(v.number()),
		leaseExpiresAt: v.optional(v.number()),
		completedAt: v.optional(v.number()),
		failedAt: v.optional(v.number()),
		error: v.optional(v.string()),
	})
		.index("by_status_and_queued_at", ["status", "queuedAt"])
		.index("by_match", ["matchId"])
		.index("by_status_and_lease", ["status", "leaseExpiresAt"]),
});

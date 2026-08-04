import {
	computeEffectiveRanges,
	deriveMatchSections,
	normaliseSectionAnalyse,
} from "@ontology/shared";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./_generated/server";
import { requireUser, userIdFromAuth } from "./auth";
import { detectionsKeyForAttempt, r2 } from "./lib/r2";
import {
	matchAnalyticsValidator,
	pathSamplePointValidator,
	shotEventValidator,
	timeRangeValidator,
} from "./lib/validators";
import {
	acceptVisionJobRun,
	claimVisionJob,
	failVisionJob,
	recoverExpiredVisionJob,
	VISION_JOB_LEASE_MS,
	VISION_JOB_MAX_ATTEMPTS,
	type VisionJobLifecycleState,
} from "./lib/vision-job-lifecycle";

const CLEAR_BATCH_SIZE = 500;

const pathSampleBucketValidator = v.object({
	bucketIndex: v.number(),
	points: v.array(pathSamplePointValidator),
});

const visionJobClaimValidator = v.object({
	jobId: v.id("visionJobs"),
	runId: v.string(),
	matchId: v.id("matches"),
	videoKey: v.string(),
	frameStride: v.number(),
	fps: v.union(v.number(), v.null()),
	ranges: v.array(timeRangeValidator),
	detectionsKey: v.string(),
});

const runTransitionValidator = v.union(
	v.literal("accepted"),
	v.literal("requeued"),
	v.literal("failed"),
	v.literal("duplicate"),
	v.literal("stale")
);

type VisionJobDoc = VisionJobLifecycleState & {
	_id: Id<"visionJobs">;
	matchId: Id<"matches">;
	videoKey: string;
	frameStride: number;
	fps?: number;
	ranges: Array<{ startMs: number; endMs: number }>;
	progress: { processedFrames: number; totalFrames: number };
	detectionsKey?: string;
};

function asLifecycleState(job: VisionJobDoc): VisionJobLifecycleState {
	return {
		status: job.status,
		attemptCount: job.attemptCount,
		maxAttempts: job.maxAttempts,
		queuedAt: job.queuedAt,
		runId: job.runId,
		workerId: job.workerId,
		startedAt: job.startedAt,
		heartbeatAt: job.heartbeatAt,
		leaseExpiresAt: job.leaseExpiresAt,
		completedAt: job.completedAt,
		failedAt: job.failedAt,
		error: job.error,
	};
}

function transitionPatch(state: VisionJobLifecycleState): Omit<
	VisionJobLifecycleState,
	"status" | "attemptCount" | "maxAttempts"
> & {
	status: VisionJobLifecycleState["status"];
	attemptCount: number;
} {
	return {
		status: state.status,
		attemptCount: state.attemptCount,
		queuedAt: state.queuedAt,
		runId: state.runId,
		workerId: state.workerId,
		startedAt: state.startedAt,
		heartbeatAt: state.heartbeatAt,
		leaseExpiresAt: state.leaseExpiresAt,
		completedAt: state.completedAt,
		failedAt: state.failedAt,
		error: state.error,
	};
}

async function prepareProcessing(
	ctx: MutationCtx,
	matchId: Id<"matches">,
	userId: string
): Promise<Id<"visionJobs">> {
	const match = await ctx.db.get(matchId);
	if (!match || match.userId !== userId) {
		throw new Error("Match not found");
	}
	if (match.status === "processing") {
		throw new Error("Match is already processing");
	}
	if (!match.durationMs) {
		throw new Error("Video metadata not available yet");
	}
	if (match.matchStartMs === undefined) {
		throw new Error("Set the match start before processing");
	}

	const sections = deriveMatchSections(
		match.matchStartMs,
		match.durationMs,
		normaliseSectionAnalyse(match.sectionAnalyse)
	);
	const ranges = computeEffectiveRanges(
		sections,
		match.processingRange,
		match.durationMs
	);
	if (ranges.length === 0) {
		throw new Error("No sections selected for processing");
	}

	if (match.detectionsKey) {
		await r2.deleteObject(ctx, match.detectionsKey);
	}

	const now = Date.now();
	const jobId = await ctx.db.insert("visionJobs", {
		matchId,
		videoKey: match.videoKey,
		frameStride: match.frameStride,
		fps: match.fps,
		ranges,
		status: "queued",
		attemptCount: 0,
		maxAttempts: VISION_JOB_MAX_ATTEMPTS,
		progress: { processedFrames: 0, totalFrames: 0 },
		queuedAt: now,
	});

	await ctx.db.patch(matchId, {
		status: "processing",
		progress: { processedFrames: 0, totalFrames: 0 },
		error: undefined,
		processedRanges: ranges,
		detectionsKey: undefined,
		visionJobId: jobId,
	});

	await ctx.scheduler.runAfter(0, internal.processing.clearStaleData, {
		matchId,
		visionJobId: jobId,
	});

	return jobId;
}

export const startProcessing = mutation({
	args: { matchId: v.id("matches") },
	returns: v.id("visionJobs"),
	handler: async (ctx, args) => {
		const user = await requireUser(ctx);
		return await prepareProcessing(ctx, args.matchId, userIdFromAuth(user));
	},
});

export const prepare = internalMutation({
	args: {
		matchId: v.id("matches"),
		userId: v.string(),
	},
	returns: v.id("visionJobs"),
	handler: async (ctx, args) => {
		return await prepareProcessing(ctx, args.matchId, args.userId);
	},
});

export const clearStaleData = internalMutation({
	args: {
		matchId: v.id("matches"),
		visionJobId: v.id("visionJobs"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const pathSampleRows = await ctx.db
			.query("pathSamples")
			.withIndex("by_match_and_bucket", (q) => q.eq("matchId", args.matchId))
			.filter((q) => q.neq(q.field("visionJobId"), args.visionJobId))
			.take(CLEAR_BATCH_SIZE);
		for (const row of pathSampleRows) {
			if (row.visionJobId !== args.visionJobId) {
				await ctx.db.delete(row._id);
			}
		}

		const shotRows = await ctx.db
			.query("shotEvents")
			.withIndex("by_match", (q) => q.eq("matchId", args.matchId))
			.take(CLEAR_BATCH_SIZE);
		for (const row of shotRows) {
			if (row.visionJobId !== args.visionJobId) {
				await ctx.db.delete(row._id);
			}
		}

		const hasMore =
			pathSampleRows.length === CLEAR_BATCH_SIZE ||
			shotRows.length === CLEAR_BATCH_SIZE;

		if (hasMore) {
			await ctx.scheduler.runAfter(0, internal.processing.clearStaleData, args);
		}

		return null;
	},
});

async function markCurrentMatchFailed(
	ctx: MutationCtx,
	job: VisionJobDoc,
	error: string
): Promise<void> {
	const match = await ctx.db.get(job.matchId);
	if (match?.visionJobId !== job._id || match.status !== "processing") {
		return;
	}

	await ctx.db.patch(job.matchId, {
		status: "failed",
		error,
	});
}

async function recoverExpiredJobs(
	ctx: MutationCtx,
	now: number
): Promise<number> {
	const expiredJobs = await ctx.db
		.query("visionJobs")
		.withIndex("by_status_and_lease", (q) =>
			q.eq("status", "running").lt("leaseExpiresAt", now)
		)
		.take(CLEAR_BATCH_SIZE);
	let recovered = 0;

	for (const job of expiredJobs) {
		const nextState = recoverExpiredVisionJob(asLifecycleState(job), now);
		if (!nextState) {
			continue;
		}

		await ctx.db.patch(job._id, transitionPatch(nextState));
		if (nextState.status === "failed") {
			await markCurrentMatchFailed(
				ctx,
				job,
				nextState.error ?? "Vision job failed"
			);
		}
		recovered += 1;
	}

	return recovered;
}

export const recoverExpired = internalMutation({
	args: {},
	returns: v.number(),
	handler: async (ctx) => {
		return await recoverExpiredJobs(ctx, Date.now());
	},
});

export const claimNext = internalMutation({
	args: { workerId: v.string() },
	returns: v.union(visionJobClaimValidator, v.null()),
	handler: async (ctx, args) => {
		const now = Date.now();
		await recoverExpiredJobs(ctx, now);

		const queuedJobs = await ctx.db
			.query("visionJobs")
			.withIndex("by_status_and_queued_at", (q) => q.eq("status", "queued"))
			.order("asc")
			.take(20);

		for (const job of queuedJobs) {
			const match = await ctx.db.get(job.matchId);
			if (!match || match.visionJobId !== job._id) {
				await ctx.db.patch(job._id, {
					status: "failed",
					failedAt: now,
					error: "Job is no longer the active run for its match",
				});
				continue;
			}

			const runId = crypto.randomUUID();
			const nextState = claimVisionJob(
				asLifecycleState(job),
				now,
				args.workerId,
				runId
			);
			if (!nextState) {
				await ctx.db.patch(job._id, {
					status: "failed",
					failedAt: now,
					error: "Job exceeded its maximum number of attempts",
				});
				await markCurrentMatchFailed(
					ctx,
					job,
					"Job exceeded its maximum number of attempts"
				);
				continue;
			}

			const detectionsKey = detectionsKeyForAttempt(job.matchId, runId);
			await ctx.db.patch(job._id, {
				...transitionPatch(nextState),
				detectionsKey,
				progress: { processedFrames: 0, totalFrames: 0 },
			});

			return {
				jobId: job._id,
				runId,
				matchId: job.matchId,
				videoKey: job.videoKey,
				frameStride: job.frameStride,
				fps: job.fps ?? null,
				ranges: job.ranges,
				detectionsKey,
			};
		}

		return null;
	},
});

async function updateHeartbeat(
	ctx: MutationCtx,
	jobId: Id<"visionJobs">,
	runId: string
): Promise<"accepted" | "stale"> {
	const job = await ctx.db.get(jobId);
	if (!job) {
		throw new Error("Vision job not found");
	}
	if (acceptVisionJobRun(asLifecycleState(job), runId) !== "active") {
		return "stale";
	}

	const match = await ctx.db.get(job.matchId);
	if (match?.visionJobId !== job._id || match.status !== "processing") {
		return "stale";
	}

	const now = Date.now();
	await ctx.db.patch(jobId, {
		heartbeatAt: now,
		leaseExpiresAt: now + VISION_JOB_LEASE_MS,
	});
	return "accepted";
}

export const heartbeat = internalMutation({
	args: {
		jobId: v.id("visionJobs"),
		runId: v.string(),
	},
	returns: v.union(v.literal("accepted"), v.literal("stale")),
	handler: async (ctx, args) => {
		return await updateHeartbeat(ctx, args.jobId, args.runId);
	},
});

export const setProgress = internalMutation({
	args: {
		jobId: v.id("visionJobs"),
		runId: v.string(),
		processedFrames: v.number(),
		totalFrames: v.number(),
	},
	returns: v.union(v.literal("accepted"), v.literal("stale")),
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job) {
			throw new Error("Vision job not found");
		}
		if (acceptVisionJobRun(asLifecycleState(job), args.runId) !== "active") {
			return "stale";
		}

		const match = await ctx.db.get(job.matchId);
		if (match?.visionJobId !== job._id || match.status !== "processing") {
			return "stale";
		}

		const now = Date.now();
		const progress = {
			processedFrames: args.processedFrames,
			totalFrames: args.totalFrames,
		};
		await ctx.db.patch(args.jobId, {
			progress,
			heartbeatAt: now,
			leaseExpiresAt: now + VISION_JOB_LEASE_MS,
		});
		await ctx.db.patch(job.matchId, { progress });
		return "accepted";
	},
});

export const finalise = internalMutation({
	args: {
		jobId: v.id("visionJobs"),
		runId: v.string(),
		shotEvents: v.array(shotEventValidator),
		analytics: matchAnalyticsValidator,
		pathSamples: v.array(pathSampleBucketValidator),
	},
	returns: v.union(
		v.literal("completed"),
		v.literal("duplicate"),
		v.literal("stale")
	),
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job) {
			throw new Error("Vision job not found");
		}

		const match = await ctx.db.get(job.matchId);
		if (!match || match.visionJobId !== job._id) {
			return "stale";
		}

		const acceptance = acceptVisionJobRun(asLifecycleState(job), args.runId);
		if (acceptance !== "active") {
			return acceptance;
		}
		if (!job.detectionsKey) {
			throw new Error("Vision job has no detection artifact key");
		}

		if (match.status !== "processing") {
			return "stale";
		}

		for (const event of args.shotEvents) {
			await ctx.db.insert("shotEvents", {
				matchId: job.matchId,
				visionJobId: job._id,
				...event,
			});
		}

		for (const bucket of args.pathSamples) {
			await ctx.db.insert("pathSamples", {
				matchId: job.matchId,
				visionJobId: job._id,
				bucketIndex: bucket.bucketIndex,
				points: bucket.points,
			});
		}

		const now = Date.now();
		const existing = await ctx.db
			.query("matchAnalytics")
			.withIndex("by_match", (q) => q.eq("matchId", job.matchId))
			.unique();
		if (existing) {
			await ctx.db.patch(existing._id, {
				visionJobId: job._id,
				analytics: args.analytics,
				updatedAt: now,
			});
		} else {
			await ctx.db.insert("matchAnalytics", {
				matchId: job.matchId,
				visionJobId: job._id,
				analytics: args.analytics,
				updatedAt: now,
			});
		}

		const completedState: VisionJobLifecycleState = {
			...asLifecycleState(job),
			status: "completed",
			completedAt: now,
			heartbeatAt: undefined,
			leaseExpiresAt: undefined,
			error: undefined,
		};
		await ctx.db.patch(job._id, transitionPatch(completedState));
		await ctx.db.patch(job.matchId, {
			status: "ready",
			error: undefined,
			detectionsKey: job.detectionsKey,
		});
		return "completed";
	},
});

async function failProcessing(
	ctx: MutationCtx,
	jobId: Id<"visionJobs">,
	runId: string,
	error: string
): Promise<"requeued" | "failed" | "stale"> {
	const job = await ctx.db.get(jobId);
	if (!job) {
		throw new Error("Vision job not found");
	}
	if (acceptVisionJobRun(asLifecycleState(job), runId) !== "active") {
		return "stale";
	}

	const now = Date.now();
	const nextState = failVisionJob(asLifecycleState(job), now, error);
	if (!nextState) {
		return "stale";
	}

	await ctx.db.patch(jobId, {
		...transitionPatch(nextState),
		detectionsKey: undefined,
		progress: { processedFrames: 0, totalFrames: 0 },
	});
	if (nextState.status === "failed") {
		await markCurrentMatchFailed(ctx, job, error);
		return "failed";
	}
	return "requeued";
}

export const retry = internalMutation({
	args: {
		jobId: v.id("visionJobs"),
		runId: v.string(),
		error: v.string(),
	},
	returns: runTransitionValidator,
	handler: async (ctx, args) => {
		return await failProcessing(ctx, args.jobId, args.runId, args.error);
	},
});

export const markFailed = internalMutation({
	args: {
		jobId: v.id("visionJobs"),
		runId: v.string(),
		error: v.string(),
	},
	returns: runTransitionValidator,
	handler: async (ctx, args) => {
		return await failProcessing(ctx, args.jobId, args.runId, args.error);
	},
});

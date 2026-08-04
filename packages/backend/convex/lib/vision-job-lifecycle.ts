export const VISION_JOB_MAX_ATTEMPTS = 3;
export const VISION_JOB_LEASE_MS = 5 * 60 * 1000;

export type VisionJobStatus = "queued" | "running" | "completed" | "failed";

export interface VisionJobLifecycleState {
	attemptCount: number;
	completedAt?: number;
	error?: string;
	failedAt?: number;
	heartbeatAt?: number;
	leaseExpiresAt?: number;
	maxAttempts: number;
	queuedAt: number;
	runId?: string;
	startedAt?: number;
	status: VisionJobStatus;
	workerId?: string;
}

export type VisionJobRunAcceptance = "active" | "duplicate" | "stale";

export function claimVisionJob(
	job: VisionJobLifecycleState,
	now: number,
	workerId: string,
	runId: string
): VisionJobLifecycleState | null {
	if (job.status !== "queued" || job.attemptCount >= job.maxAttempts) {
		return null;
	}

	return {
		...job,
		status: "running",
		attemptCount: job.attemptCount + 1,
		runId,
		workerId,
		startedAt: now,
		heartbeatAt: now,
		leaseExpiresAt: now + VISION_JOB_LEASE_MS,
		error: undefined,
	};
}

export function recoverExpiredVisionJob(
	job: VisionJobLifecycleState,
	now: number
): VisionJobLifecycleState | null {
	if (
		job.status !== "running" ||
		job.leaseExpiresAt === undefined ||
		job.leaseExpiresAt >= now
	) {
		return null;
	}

	if (job.attemptCount >= job.maxAttempts) {
		return {
			...job,
			status: "failed",
			failedAt: now,
			heartbeatAt: undefined,
			leaseExpiresAt: undefined,
			error: "Worker lease expired after the maximum number of attempts",
		};
	}

	return {
		...job,
		status: "queued",
		queuedAt: now,
		runId: undefined,
		workerId: undefined,
		heartbeatAt: undefined,
		leaseExpiresAt: undefined,
		error: "Worker lease expired; the job has been queued for retry",
	};
}

export function failVisionJob(
	job: VisionJobLifecycleState,
	now: number,
	error: string
): VisionJobLifecycleState | null {
	if (job.status !== "running") {
		return null;
	}

	if (job.attemptCount >= job.maxAttempts) {
		return {
			...job,
			status: "failed",
			failedAt: now,
			heartbeatAt: undefined,
			leaseExpiresAt: undefined,
			error,
		};
	}

	return {
		...job,
		status: "queued",
		queuedAt: now,
		runId: undefined,
		workerId: undefined,
		heartbeatAt: undefined,
		leaseExpiresAt: undefined,
		error,
	};
}

export function acceptVisionJobRun(
	job: VisionJobLifecycleState,
	runId: string
): VisionJobRunAcceptance {
	if (job.status === "completed" && job.runId === runId) {
		return "duplicate";
	}

	if (job.status !== "running" || job.runId !== runId) {
		return "stale";
	}

	return "active";
}

# pipeline

## Runtime

`vision-worker` is a long-lived process with one sequential worker loop and a
lightweight FastAPI health server. FastAPI does not own match execution or
retain an in-memory task. The worker:

1. Polls Convex `POST /vision/claim` with an authenticated worker ID. Convex
  atomically claims the oldest queued job and returns fresh signed URLs:
   `videoUrl`, `callbackUrl`, and an attempt-specific
   `detectionsUploadUrl`.
2. Loads the YOLO model once, then runs the existing pipeline for the claimed
  match.
3. Sends job scoped progress and heartbeat callbacks while processing.
4. Uploads the gzipped detection artefact to R2 and sends completion callbacks.
5. Reports failures to Convex. Retriable failures are requeued until the
  maximum attempt count is reached.

Completion is scoped to both `jobId` and `runId`. Convex finalisation is idempotent.  
(duplicate completion callbacks are ignored and expired runs cannot overwrite a newer run)

The worker stops claiming jobs as soon as shutdown begins. It finishes the
current job when the shutdown window allows. If the process is terminated while
the job is still running, heartbeats stop and Convex makes the job claimable
again after the lease expires.

## Endpoints

- `GET /health` checks that the process is serving HTTP.
- `GET /readiness` returns ready only after the worker has loaded its model and can
poll Convex.
- `POST /vision/claim` claims work through Convex.
- `POST /vision/progress` updates progress and extends the lease.
- `POST /vision/heartbeat` extends the lease independently of frame progress.
- `POST /vision/complete` uploads final analytics and metadata.
- `POST /vision/failed` requeues or fails the current attempt.


## Data flow

`startProcessing` prepares the match and inserts one queued `visionJobs` row. The pipeline downloads the video, runs YOLO, tracking and shot detection on sampled frames, and pushes progress. On completion, all frame detections are gzipped as `{ version, frameStride, frames }` and uploaded to R2. Robot path
samples use five-second buckets, while Convex stores shot events, analytics,
and the active detection key.

The web app fetches the signed detection artefact URL once per session and  
caches decompressed frames in memory for the detection overlay.

## Local Measurement

- `local_compute` is the optimisation signal. It uses a local video and model
with no Convex, R2, Railway, callbacks, retries, heartbeats or network
access. It measures decode, inference, robot tracking, fuel matching,
serialisation, analytics, throughput and peak memory.
- `local_integration` measures communication overhead separately using a
deterministic localhost server. It records callback, upload, polling,
heartbeat, retry, latency and payload-size behaviour.

Run the benchmark from the repository root so Bun resolves the vision
workspace package explicitly:

```bash
bun run --cwd apps/vision bench -- \
  --video /absolute/path/to/match.mp4 \
  --model models/frc2026.pt \
  --output benchmark-results/[MATCH]-001 \
  --variant candidate \
  --mode both \
  --batch-size 1 \
  --batch-size 8 \
  --warmups 1 \
  --repetitions 3
```

Use a new output directory for each comparison. Run the same command against
the baseline checkout with `--variant baseline`; both variants can append to
the same `runs.jsonl` when they use the same output directory.

For local integration overhead, use the same runner with
`--benchmark-kind local_integration`, optionally adding
`--integration-latency-ms 10` and `--integration-retryable-failures 1`.
These records must not be combined with `local_compute` results when choosing
algorithmic defaults.

Each measured repetition runs in a fresh child process. Cold mode includes
model loading; warm mode loads the model before the timed pipeline and matches
the long-lived worker. Warm-ups are excluded from summaries. The runner
records input and model hashes, source provenance, machine metadata,
configuration stage distributions, counters, throughput, peak memory, output
fingerprints and failures.

Output:

- `runs.jsonl`: one complete JSON object per measured repetition;
- `summary.json`: deterministic aggregate statistics and baseline/candidate
comparisons.
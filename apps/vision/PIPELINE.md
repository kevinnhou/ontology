# pipeline

1. Convex `startProcessing` prepares the match and inserts one queued `visionJobs` row.

2. The vision worker polls `/vision/claim`. Convex atomically claims a job, then returns fresh signed URLs and the processing inputs:
> `videoUrl`
> `callbackUrl`
> `detectionsUploadUrl` presigned PUT for an attempt specific R2 key
> `frameStride`, `ranges`

3. The pipeline downloads the video, runs YOLO + tracking + shot detection on sampled frames and pushes progress to `/vision/progress`.

4. When processing finishes:
> All frame detections are gzipped (`{ version, frameStride, frames }`) and uploaded to R2 via `detectionsUploadUrl`.
> Robot path samples (5s buckets) are computed in memory.
> `/vision/complete` receives `jobId`, `runId`, `shotEvents`, `analytics` and `pathSamples`.

5. Convex finalisation is scoped to the current `jobId` and `runId`. It inserts
shot events and path samples once, stores analytics and sets the
`matches.detectionsKey` only for the active run. Expired or duplicate runs are
ignored safely.

Web calls `detections.getDetectionsUrl` once per session, fetches the gzipped (R2) and caches frames in memory for the detection overlay.
# pipeline

1. Convex `startProcessing` prepares the match, clears stale shot/path data and POSTs to `/process` with:
> `videoUrl`
> `callbackUrl`
> `detectionsUploadUrl` presigned PUT for `detections/{matchId}.json.gz`
> `frameStride`, `ranges`, optional `fps`

2. The pipeline downloads the video, runs YOLO + tracking + shot detection on sampled frames and pushes progress to `/vision/progress`.

3. When processing finishes:
> All frame detections are gzipped as `{ version, frameStride, frames }` and uploaded to R2 via `detectionsUploadUrl`.
> Robot path samples (5s buckets) are computed in memory.
> `/vision/complete` receives `shotEvents`, `analytics`, and `pathSamples`.

4. Convex `finalise` inserts shot events and path samples, stores analytics and sets `matches.detectionsKey`.

Web calls `detections.getDetectionsUrl` once per session, fetches the gzipped (R2) and caches frames in memory for the detection overlay.
import type { api } from "@ontology/backend/convex/_generated/api";
import type { FunctionArgs, FunctionReturnType } from "convex/server";

export type TimelineData = NonNullable<
	FunctionReturnType<typeof api.matches.getTimeline>
>;

export type UpdateTimelineArgs = FunctionArgs<
	typeof api.matches.updateTimeline
>;

export type ProbeMetadataArgs = FunctionArgs<
	typeof api.matches.updateProbeMetadata
>;

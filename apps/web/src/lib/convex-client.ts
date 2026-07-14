import { env } from "@ontology/env/web";
import { ConvexReactClient } from "convex/react";

export const convex = new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL);

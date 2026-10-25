import { createHash } from "node:crypto";
import path from "node:path";

export const CACHE_DIRECTORY = path.resolve(process.cwd(), ".playwright-mcp");

export interface ExplorationCachePaths {
  stateFilePath: string;
  profilePath: string;
}

export function getExplorationCachePaths(targetUrl: URL, task: string, model: string): ExplorationCachePaths {
  const cacheKey = createHash("sha256")
    .update(`${targetUrl.toString()}\n${task}\n${model}`)
    .digest("hex");

  return {
    stateFilePath: path.join(CACHE_DIRECTORY, `exploration-${cacheKey}.json`),
    profilePath: path.join(
      CACHE_DIRECTORY,
      "profiles",
      createHash("sha256").update(targetUrl.origin).digest("hex"),
    ),
  };
}

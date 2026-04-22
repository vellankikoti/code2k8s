import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config.js";

export const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

export interface BuildJob {
  deploymentId: string;
}

export const buildQueue = new Queue<BuildJob>("builds", { connection: redis });
export const buildEvents = new QueueEvents("builds", { connection: redis });

export const LOG_CHANNEL = (id: string) => `logs:${id}`;

export async function publishLog(depId: string, line: string) {
  await redis.publish(LOG_CHANNEL(depId), line);
  await redis.xadd(`logs:hist:${depId}`, "MAXLEN", "~", "2000", "*", "line", line);
}

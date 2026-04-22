import { Worker } from "bullmq";
import { redis, type BuildJob } from "../lib/queue.js";
import { runDeployment } from "./deployer.js";
import { logger } from "../lib/logger.js";

export function startWorker() {
  const worker = new Worker<BuildJob>(
    "builds",
    async (job) => {
      logger.info({ depId: job.data.deploymentId }, "processing build");
      await runDeployment(job.data.deploymentId);
    },
    { connection: redis, concurrency: 2 },
  );
  worker.on("failed", (job, err) => logger.error({ err, id: job?.id }, "build failed"));
  return worker;
}

import express from "express";
import pinoHttp from "pino-http";
import { config } from "./config.js";
import { migrate } from "./lib/db.js";
import { deployments } from "./routes/deployments.js";
import { startWorker } from "./services/worker.js";
import { logger } from "./lib/logger.js";

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(pinoHttp({ logger }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.use("/api/deployments", deployments);

async function main() {
  await migrate();
  startWorker();
  app.listen(config.port, () => logger.info(`code2k8s-api listening on :${config.port}`));
}

main().catch((err) => {
  logger.error(err, "fatal");
  process.exit(1);
});

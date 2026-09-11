import Fastify from "fastify";
import { syncRoutes } from "./routes/sync.js";
import { connectorRoutes } from "./routes/connectors.js";
import { jobRoutes } from "./routes/jobs.js";
import { v1Routes } from "./routes/v1/index.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { googleRoutes } from "./routes/google.js";

const app = Fastify({ logger: true });

const PORT = Number(process.env.PORT) || 4000;

app.register(syncRoutes);
app.register(connectorRoutes);
app.register(jobRoutes);
app.register(v1Routes, { prefix: "/v1" });
app.register(dashboardRoutes);
app.register(googleRoutes);


app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`FinLayer API listening on ${address}`);
});

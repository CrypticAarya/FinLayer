import Fastify from "fastify";
import { syncRoutes } from "./routes/sync.js";

const app = Fastify({ logger: true });

const PORT = Number(process.env.PORT) || 4000;

app.register(syncRoutes);

app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`FinLayer API listening on ${address}`);
});

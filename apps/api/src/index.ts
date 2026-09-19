import { buildApp } from "./app.js";

const PORT = Number(process.env.PORT) || 4000;

async function main() {
  const app = await buildApp({ logger: true });

  app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    app.log.info(`FinLayer API listening on ${address}`);
  });
}

main().catch((err) => {
  console.error("Failed to start FinLayer API server:", err);
  process.exit(1);
});

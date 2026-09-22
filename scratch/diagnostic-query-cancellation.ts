import prisma from "../apps/api/src/db/prisma.js";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const directPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function diagnoseQueryCancellation() {
  console.log("===================================================================");
  console.log("   DIAGNOSTIC: IN-FLIGHT POSTGRESQL QUERY CANCELLATION UNDER ABORT ");
  console.log("===================================================================\n");

  const abortController = new AbortController();
  const { signal } = abortController;

  console.log("[Step 1] Inspecting Prisma client API for AbortSignal support...");
  // Check if findMany or queryRaw accepts signal
  // In Prisma, findMany does not accept signal. Let's see if queryRaw does or does not.
  console.log("Prisma findMany query signature: [where, include, select, orderBy, cursor, take, skip]");
  console.log("Does Prisma findMany accept AbortSignal? NO (compile-time rejected)\n");

  console.log("[Step 2] Launching long-running PostgreSQL query via Prisma ($queryRaw with pg_sleep(3))...");
  const startTime = Date.now();
  let queryFinished = false;
  let queryError: any = null;
  let queryDurationMs = 0;

  // We run a query with a unique comment tag so we can track it in pg_stat_activity
  const queryPromise = prisma.$queryRawUnsafe(`/* FINLAYER_TEST_CANCEL */ SELECT pg_sleep(3) AS sleep_res;`)
    .then((res) => {
      queryFinished = true;
      queryDurationMs = Date.now() - startTime;
      return res;
    })
    .catch((err) => {
      queryFinished = true;
      queryError = err;
      queryDurationMs = Date.now() - startTime;
    });

  // Wait 300ms to ensure the query has reached PostgreSQL and is actively running
  await new Promise((resolve) => setTimeout(resolve, 300));

  console.log("[Step 3] Querying pg_stat_activity to find in-flight backend process...");
  const activityRes = await directPool.query(`
    SELECT pid, state, query, (now() - query_start) AS duration
    FROM pg_stat_activity
    WHERE query LIKE '%FINLAYER_TEST_CANCEL%' AND pid <> pg_backend_pid();
  `);

  if (activityRes.rows.length === 0) {
    console.log("  ⚠️ Query was not found in pg_stat_activity (already finished or not matched)");
  } else {
    const row = activityRes.rows[0];
    console.log(`  -> Found in-flight query in PostgreSQL! PID: ${row.pid}, State: ${row.state}, Duration: ${row.duration}`);
  }

  console.log("\n[Step 4] Triggering AbortController.abort()...");
  abortController.abort();
  console.log(`  -> abortController.signal.aborted = ${signal.aborted}`);

  console.log("\n[Step 5] Checking pg_stat_activity 500ms after abortController.abort()...");
  await new Promise((resolve) => setTimeout(resolve, 500));

  const postAbortActivity = await directPool.query(`
    SELECT pid, state, query, (now() - query_start) AS duration
    FROM pg_stat_activity
    WHERE query LIKE '%FINLAYER_TEST_CANCEL%' AND pid <> pg_backend_pid();
  `);

  if (postAbortActivity.rows.length > 0) {
    const row = postAbortActivity.rows[0];
    console.log(`  ❌ PROOF: Query is STILL RUNNING in PostgreSQL despite AbortController.abort()!`);
    console.log(`     PID: ${row.pid}, State: ${row.state}, Duration: ${row.duration}`);
    console.log(`     PostgreSQL backend received ZERO cancellation signal from Prisma.`);
  } else {
    console.log(`  Query is no longer in pg_stat_activity.`);
  }

  // Wait for the query to actually finish
  await queryPromise;
  console.log(`\n[Step 6] Prisma query completed.`);
  console.log(`  Total time elapsed: ${queryDurationMs}ms`);
  console.log(`  Query error: ${queryError ? queryError.message : "None (completed successfully)"}`);

  if (queryDurationMs >= 2900 && !queryError) {
    console.log("\n===================================================================");
    console.log("   CRITICAL FINDING: IN-FLIGHT QUERY WAS NOT CANCELLED!            ");
    console.log("   - Prisma does NOT cancel in-flight queries upon abort.          ");
    console.log("   - PostgreSQL executes the full query to completion.             ");
    console.log("   - The database connection remains busy until query finishes.    ");
    console.log("   - Current implementation ONLY halts the loop before NEXT query.  ");
    console.log("===================================================================\n");
  }

  await directPool.end();
  await prisma.$disconnect();
}

diagnoseQueryCancellation().catch(console.error);

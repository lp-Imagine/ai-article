#!/usr/bin/env node
/**
 * Start embedded PostgreSQL for local development (no Docker/Homebrew required).
 * Data dir: .data/pg  |  Port: 5432  |  User/Pass/DB: draftly
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const EmbeddedPostgres = (await import("embedded-postgres")).default;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".data", "pg");
fs.mkdirSync(dataDir, { recursive: true });

const port = Number(process.env.PG_PORT || 5432);
const database = process.env.PG_DATABASE || "draftly";
const user = process.env.PG_USER || "draftly";
const password = process.env.PG_PASSWORD || "draftly";

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
  onLog: (msg) => process.stdout.write(String(msg)),
  onError: (msg) => process.stderr.write(String(msg)),
});

async function main() {
  const initialized = fs.existsSync(path.join(dataDir, "PG_VERSION"));
  if (!initialized) {
    console.log("Initializing PostgreSQL data directory…");
    await pg.initialise();
  }

  console.log(`Starting PostgreSQL on port ${port}…`);
  await pg.start();

  try {
    await pg.createDatabase(database);
    console.log(`Database "${database}" ready.`);
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/already exists/i.test(msg)) throw err;
    console.log(`Database "${database}" already exists.`);
  }

  console.log(
    `\nDATABASE_URL=postgresql://${user}:${password}@localhost:${port}/${database}`,
  );
  console.log("PostgreSQL is running. Press Ctrl+C to stop.\n");

  const stop = async () => {
    console.log("\nStopping PostgreSQL…");
    try {
      await pg.stop();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Keep process alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

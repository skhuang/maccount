import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import path from "node:path";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    test: {
      poolOptions: {
        workers: {
          singleWorker: true,
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
          },
          wrangler: { configPath: "./wrangler.toml" },
        },
      },
    },
  };
});

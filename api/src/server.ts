import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app";
import { config } from "./lib/config";
import { waitForDatabase } from "./lib/db";
import { ensureDemoProjects, ensureDemoTemplates, ensureDemoUsers } from "./lib/seed";

async function bootstrap() {
  fs.mkdirSync(path.resolve(config.UPLOAD_DIR), { recursive: true });
  await waitForDatabase();
  await ensureDemoUsers();
  await ensureDemoTemplates();
  await ensureDemoProjects();

  const app = createApp();
  app.listen(config.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on ${config.PORT}`);
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start API", error);
  process.exit(1);
});

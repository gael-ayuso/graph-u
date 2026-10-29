import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Match Next.js locally, while letting deployment environment variables win.
config({ path: ".env.local", quiet: true });
config({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});

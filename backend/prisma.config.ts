import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 moved the connection URL out of schema.prisma and into here.
 *
 * Pinned to 7.10.0 deliberately: npm's `latest` tag for prisma currently points
 * at 8.0.0-rc.13, a release candidate with a rewritten CLI, while stable sits
 * under `prev`. Installing "the latest" would have put an RC in the critical
 * path a week before a deadline.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "",
  },
});

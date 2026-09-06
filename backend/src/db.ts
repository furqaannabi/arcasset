import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma 7 talks to Postgres through a driver adapter rather than its own
 * engine binary, so the connection string is handed to node-postgres here.
 */
const connectionString = process.env["DATABASE_URL"];
if (!connectionString) throw new Error("DATABASE_URL is not set");

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

export async function dbHealthy(): Promise<boolean> {
  try {
    await prisma.$queryRaw`select 1`;
    return true;
  } catch {
    return false;
  }
}

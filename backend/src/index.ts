import { Hono } from "hono";
import { dbHealthy } from "./db";

const app = new Hono();

/**
 * What is actually running, and whether it is safe to trust. The agent's own
 * status is the interesting part: a process that is up but not servicing is a
 * different thing from one that is servicing, and this has to say which.
 */
app.get("/health", async (c) => {
  const agentConfigured = Boolean(process.env["AGENT_PRIVATE_KEY"]);
  return c.json({
    ok: true,
    database: (await dbHealthy()) ? "connected" : "unreachable",
    chainId: Number(process.env["CHAIN_ID"] ?? 0),
    agent: {
      running: agentConfigured,
      // Without a key nothing is serviced automatically and repayment still
      // works by hand. Saying so is better than implying an agent is watching.
      note: agentConfigured ? undefined : "AGENT_PRIVATE_KEY unset — nothing is serviced automatically",
      defaultDryRun: process.env["DEFAULT_DRY_RUN"] !== "false",
    },
  });
});

export default {
  port: Number(process.env["PORT"] ?? 3001),
  fetch: app.fetch,
};

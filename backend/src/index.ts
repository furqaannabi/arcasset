import { Hono } from "hono";
import { dbHealthy } from "./db";
import { loadConfig } from "./config";
import { loadDeployment } from "./chain/deployments";
import { publicClientFor, walletClientFor } from "./chain/client";
import { ChainExecutor } from "./agent/executor";
import { RpcNoteSource } from "./agent/source";
import { AgentRunner } from "./agent/runner";
import { intelRoutes } from "./intel/routes";
import { documentRoutes } from "./documents/routes";
import { storageFromEnv } from "./documents/storage";

const config = loadConfig();
const deployment = loadDeployment(config.chainId);
const publicClient = publicClientFor(config.chainId, config.rpcUrl);

let runner: AgentRunner | null = null;
// The same signer settles x402 payments and services notes. Both are hot keys
// doing bounded work; splitting them is a deployment decision, not a code one.
const wallet = config.agentKey
  ? walletClientFor(config.chainId, config.rpcUrl, config.agentKey)
  : null;

if (config.agentKey && wallet) {
  const executor = new ChainExecutor(publicClient, wallet, deployment.ServicingRelay);
  const source = new RpcNoteSource(
    publicClient,
    deployment.NoteFactory,
    deployment.ServicingRelay,
    deployment.RepaymentVault,
  );
  runner = new AgentRunner(
    source,
    executor,
    {
      agent: executor.address,
      maxActionsPerTick: config.maxActionsPerTick,
      maxLagBlocks: config.maxLagBlocks,
      minGasBalance: config.minGasBalance,
      defaultDryRun: config.defaultDryRun,
    },
    config.tickIntervalMs,
  );
  runner.start();
}

const app = new Hono();

app.get("/health", async (c) => {
  const [db, block, balance] = await Promise.all([
    dbHealthy(),
    publicClient.getBlockNumber().catch(() => null),
    runner ? publicClient.getBalance({ address: runner.agent }).catch(() => null) : null,
  ]);

  return c.json({
    ok: true,
    database: db ? "connected" : "unreachable",
    chain: { id: config.chainId, head: block === null ? null : Number(block) },
    documents: { storage: storage.kind, admins: admins.length },
    contracts: deployment,
    agent: runner
      ? {
          running: true,
          address: runner.agent,
          gasBalance: balance?.toString() ?? null,
          // Below the floor the agent stops rather than half-servicing a note.
          belowGasFloor: balance !== null && balance !== undefined && balance < config.minGasBalance,
          ticks: runner.ticks,
          lastTickAt: runner.lastTickAt,
          lastTickSkipped: runner.lastReport?.skipped ?? null,
          consecutiveFailures: runner.consecutiveFailures,
          defaultDryRun: config.defaultDryRun,
        }
      : {
          running: false,
          reason: "AGENT_PRIVATE_KEY unset — nothing is serviced automatically",
        },
  });
});

const storage = storageFromEnv();
const admins = (process.env["ADMIN_ADDRESSES"] ?? "").split(",").map((a) => a.trim()).filter(Boolean);

app.route("/intel", intelRoutes(config, publicClient, wallet, deployment.NoteFactory));
app.route("/documents", documentRoutes(storage, admins));

/** The decision trace. In a demo this log is the agent. */
app.get("/agent/log", (c) => {
  if (!runner) return c.json({ running: false, log: [] });
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  return c.json({ running: true, ticks: runner.ticks, log: runner.log.slice(0, limit) });
});

/** Drive one tick now, for demos and for operators who do not want to wait. */
app.post("/agent/tick", async (c) => {
  if (!runner) return c.json({ error: "agent_not_running" }, 409);
  const report = await runner.runOnce();
  return c.json(report ?? { error: "tick_already_in_progress" });
});

export default { port: config.port, fetch: app.fetch };

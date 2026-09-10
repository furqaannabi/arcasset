import { Hono } from "hono";
import { cors } from "hono/cors";
import { dbHealthy } from "./db";
import { loadConfig } from "./config";
import { loadDeployment } from "./chain/deployments";
import { publicClientFor, walletClientFor } from "./chain/client";
import { ChainExecutor, privateKeyFrom } from "./agent/executor";
import { privateKeyToAccount } from "viem/accounts";
import { RpcNoteSource } from "./agent/source";
import { AgentRunner } from "./agent/runner";
import { intelRoutes } from "./intel/routes";
import { documentRoutes } from "./documents/routes";
import { identityRoutes } from "./identity/routes";
import { mandateRoutes } from "./mandates/routes";
import { storageFromEnv, R2Storage } from "./documents/storage";

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

/**
 * The web app is a different origin in every environment we run, so the browser
 * needs this to talk to us at all.
 *
 * An allowlist rather than "*": documents and /identity/attest are gated on a
 * bearer session token, and a wildcard origin beside credentials lets any site
 * a signed-in user visits read their drafts or mint an attestation as them.
 *
 * The x402 headers are named explicitly. Custom request headers are blocked
 * unless allowed, and custom response headers are invisible to JS unless
 * exposed — so without PAYMENT-RESPONSE here the storefront could pay and then
 * fail to read back the transaction hash it just paid with.
 */
app.use(
  "*",
  cors({
    origin: config.corsOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["content-type", "authorization", "PAYMENT-SIGNATURE", "X-PAYMENT"],
    exposeHeaders: ["PAYMENT-RESPONSE"],
    maxAge: 86_400,
  }),
);

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
    documents: {
      storage: storage.kind,
      admins: admins.length,
      ...(storageWarning ? { WARNING: storageWarning } : {}),
    },
    identity: {
      attestor: attestorAddress,
      world: config.worldAppId ? "configured" : "not configured",
      // Loud on purpose: demoing with this on would mean demoing no gate at all.
      ...(config.dangerousAttestWithoutWorld
        ? { WARNING: "DANGEROUS_ATTEST_WITHOUT_WORLD is on — there is no personhood check" }
        : {}),
    },
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

/**
 * If the bucket turns out to be publicly readable, the access rule in the
 * documents route is decorative. Checked once at startup, reported by /health,
 * and logged loudly — not left for someone to discover.
 */
let storageWarning: string | null = null;
if (storage.kind === "r2") {
  void (storage as R2Storage).assertNotPubliclyReadable().then((problem) => {
    storageWarning = problem;
    if (problem) console.error(`[storage] ${problem}`);
  });
}
const admins = (process.env["ADMIN_ADDRESSES"] ?? "").split(",").map((a) => a.trim()).filter(Boolean);

// Reading logs from the deployment block, not from genesis: Arc refuses large
// getLogs ranges, and nothing before the deploy can concern these contracts.
const deployBlock = BigInt(process.env["DEPLOY_BLOCK"] ?? "0");

app.route(
  "/intel",
  intelRoutes(
    config, publicClient, wallet,
    deployment.NoteFactory, deployment.IssuanceQueue, deployment.RepaymentVault,
    deployment.ServicingRelay, deployBlock,
  ),
);
app.route("/documents", documentRoutes(storage, admins));

app.route(
  "/",
  mandateRoutes({
    publicClient,
    factory: deployment.NoteFactory,
    collector: deployment.RepaymentMandate,
    usdc: config.usdcErc20,
    chainId: config.chainId,
    agentAddress: runner ? runner.agent : null,
  }),
);

const attestorAddress = config.attestorKey ? privateKeyToAccount(config.attestorKey).address : null;
app.route(
  "/identity",
  identityRoutes({
    attestorKey: config.attestorKey,
    attestorAddress,
    verifier: deployment.PersonhoodVerifier,
    chainId: config.chainId,
    world:
      config.worldAppId && config.worldAction
        ? { appId: config.worldAppId, action: config.worldAction }
        : null,
    dangerousWithoutWorld: config.dangerousAttestWithoutWorld,
    publicClient,
  }),
);

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

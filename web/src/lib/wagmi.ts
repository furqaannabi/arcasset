import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { injected } from "wagmi/connectors";
import { CHAIN, CHAINS, RPC_URL } from "./chain";

/**
 * Created once per process. Cookie storage keeps the connection across SSR so
 * the first paint doesn't flash "disconnected" for an already-connected wallet.
 */
export const wagmiConfig = createConfig({
  chains: CHAINS,
  connectors: [injected()],
  transports: { [CHAIN.id]: http(RPC_URL) },
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Zama relayer SDK (and a couple of its transitive deps) expect a Node-y
// `global` to exist in the browser. Map it to `globalThis` at build time.
// The SDK is lazily imported (see src/lib/fhe.ts) and excluded from
// dep-optimization so it never blocks the initial bundle/build.
export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    include: [
      // Privy lazy-loads internal chunks (LandingScreen, OAuth flows, etc.)
      // when the login modal opens. Listing the SDK up front tells Vite to
      // pre-bundle it so those chunks don't 504 with "Outdated Optimize Dep"
      // the first time a user clicks "Continue with email".
      "@privy-io/react-auth",
    ],
    exclude: ["@zama-fhe/relayer-sdk"],
  },
});

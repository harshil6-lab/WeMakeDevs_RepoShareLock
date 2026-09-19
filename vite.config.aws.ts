// AWS Lambda build target.
//
// The default `vite.config.ts` keeps the platform default (cloudflare-module)
// for local development and preview. This config is used only by
// `npm run build:aws` and pins Nitro's `aws-lambda` preset into a separate
// output directory, so the deployable server bundle never disturbs the
// existing build.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    server: { entry: "server" },
  },
  nitro: {
    preset: "aws-lambda",
    output: {
      dir: ".output-aws",
    },
  },
});

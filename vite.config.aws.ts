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
    // The aws-lambda preset does not register Nitro's static handler, so the
    // built client assets would sit in .output-aws/public for an external host
    // to serve. This deployment has no CDN or S3 origin in front of the Lambda,
    // so the SSR handler itself must answer /assets/*, /favicon.ico and
    // /robots.txt: "inline" embeds the public assets into the server bundle.
    serveStatic: "inline",
    output: {
      dir: ".output-aws",
    },
  },
});

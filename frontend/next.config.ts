import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server only trusts `localhost` by default. Without this, opening
  // http://127.0.0.1:3000 (or a LAN IP) blocks dev assets and the page never hydrates.
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*", "10.*.*.*"],
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

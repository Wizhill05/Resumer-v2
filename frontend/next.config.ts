import type { NextConfig } from "next";

const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
const posthogAssets = posthogHost.replace("://us.i.", "://us-assets.i.").replace("://eu.i.", "://eu-assets.i.");

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "lanes-advisor-claims-purple.trycloudflare.com",
    "*.aryansingh.space",
    "*.resumer.buzz",
    "20.219.118.144",
    "localhost",
    "100.122.152.101",
  ],
  async headers() {
    return [
      {
        // Agent confirmation links carry a one-time token; never leak the page URL to other sites.
        source: "/connect/own-model",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: `${posthogAssets}/static/:path*`,
      },
      {
        source: "/ingest/array/:path*",
        destination: `${posthogAssets}/array/:path*`,
      },
      {
        source: "/ingest/:path*",
        destination: `${posthogHost}/:path*`,
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export default nextConfig;


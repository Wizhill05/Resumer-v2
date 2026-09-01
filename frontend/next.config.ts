import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "lanes-advisor-claims-purple.trycloudflare.com",
    "*.aryansingh.space",
    "20.219.118.144",
    "localhost",
  ],
};

export default nextConfig;

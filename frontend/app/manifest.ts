import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Résumer | ATS Résumé Builder",
    short_name: "Résumer",
    description:
      "Build ATS-friendly, job-focused résumés from messy job descriptions and export polished PDF drafts faster.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ff4631",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/resumer-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}

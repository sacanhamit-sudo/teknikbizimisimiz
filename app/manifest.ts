import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Teknik Satınalma Talebi",
    short_name: "Satınalma",
    description: "Bakım ekipleri için teknik satınalma talebi ve onay takibi",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F5F3EE",
    theme_color: "#F5F3EE",
    lang: "tr",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

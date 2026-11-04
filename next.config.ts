import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Document parsers for the knowledge base run as plain Node modules.
  serverExternalPackages: ["mammoth", "exceljs"],
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

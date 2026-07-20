import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "persimateriais.com.br",
      },
      {
        protocol: "https",
        hostname: "www.persimateriais.com.br",
      },
    ],
  },
};

export default nextConfig;

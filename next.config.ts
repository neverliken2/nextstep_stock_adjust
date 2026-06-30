import type { NextConfig } from "next";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  output: "standalone", // Enable standalone output for Docker
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

export default nextConfig;

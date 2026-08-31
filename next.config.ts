import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Pin the tracing root to this project. Without it Next walks up looking for
  // lockfiles, finds one further up the Downloads tree, and traces the wrong
  // directory into the deployment bundle.
  outputFileTracingRoot: path.resolve(process.cwd()),
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/node-only packages must not be bundled into the server build:
  // onnxruntime-node (embeddings) and pg ship platform binaries / dynamic requires.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "pg"],
};

export default nextConfig;

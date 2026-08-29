import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/node-only packages must not be bundled into the server build:
  // onnxruntime-node (embeddings) and pg ship platform binaries / dynamic requires.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "pg"],
  // Hide the dev-only overlay indicator (keeps captured screenshots clean).
  devIndicators: false,
  // The tracer only follows static imports, so the model weights and the
  // prebuilt index are invisible to it and get dropped from the serverless
  // bundle. Both are read at runtime by path, so name them explicitly.
  // Harmless when those directories are absent: local dev reads .cache instead.
  outputFileTracingIncludes: {
    // The widget surface renders the same chat, so it needs the same index the
    // tracer cannot see: it is read at runtime by path.
    "/embed": ["./data/index/**/*"],
    "/api/chat": [
      "./models/**/*",
      "./data/index/**/*",
      // onnxruntime-node ships a native .so that the tracer cannot see, since
      // nothing imports it statically. Without it the deployed function dies on
      // "libonnxruntime.so.1: cannot open shared object file".
      "./node_modules/onnxruntime-node/bin/**/*",
    ],
  },
};

export default nextConfig;

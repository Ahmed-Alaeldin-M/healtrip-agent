/** @type {import('next').NextConfig} */
const config = {
  serverExternalPackages: ["better-sqlite3", "onnxruntime-node", "@huggingface/transformers", "sharp"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/**/*"],
  },
};

export default config;

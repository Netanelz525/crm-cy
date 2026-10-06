/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "35mb"
    }
  },
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/docx-preview/dist/docx-preview.js",
      "./node_modules/jszip/dist/jszip.min.js"
    ]
  }
};

export default nextConfig;

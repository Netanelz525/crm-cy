/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "35mb"
    }
  }
};

export default nextConfig;

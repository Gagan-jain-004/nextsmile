/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: [
    "*.ngrok-free.dev",
    "https://*.ngrok-free.dev"
  ],
};

export default nextConfig;

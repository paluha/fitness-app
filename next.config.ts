import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sha коммита вшивается в клиентский бандл при сборке — /api/version отдаёт
  // sha текущего деплоя, клиент сравнивает и перезагружается при расхождении.
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
  },
  serverExternalPackages: [],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;

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
  // Базовые защитные заголовки. HSTS добавляет Vercel, остальных не было.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Не открывать приложение во фрейме: защита от кликджекинга,
          // когда чужая страница накрывает наши кнопки прозрачным слоем.
          { key: 'X-Frame-Options', value: 'DENY' },
          // Не угадывать тип файла по содержимому: загруженная картинка
          // с кодом внутри не должна исполниться как скрипт.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Не отдавать полный путь страницы на сторонние сайты.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Доступ к камере оставляем: с неё фотографируют еду и упражнения.
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), payment=()' },
        ],
      },
    ];
  },
};

export default nextConfig;

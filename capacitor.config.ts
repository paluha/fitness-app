import type { CapacitorConfig } from '@capacitor/cli';

// trainx (trainx.club) как iOS-приложение через Capacitor.
// Приложение грузит живой сайт с trainx.club (server.url) — так работают
// серверные фичи Next.js (авторизация, API-роуты, AI-анализ еды) без
// статического экспорта. Обновления сайта = обновления приложения без
// пересборки TestFlight (нужна пересборка только для нативных изменений).
const config: CapacitorConfig = {
  appId: 'club.trainx.app',
  appName: 'TrainX',
  webDir: 'public',
  server: {
    url: process.env.CAP_SERVER_URL || 'https://trainx.club',
    cleartext: false,
  },
  ios: {
    // Рисуем во весь экран, включая зоны чёлки и нижней полоски — иначе
    // WebView оставляет по краям цветные «гепы». Отступы делает сама страница
    // через env(safe-area-inset-*).
    contentInset: 'never',
  },
  // Метка в User-Agent, по которой сервер отличает приложение от браузера:
  // middleware не показывает в приложении маркетинговый лендинг.
  appendUserAgent: 'TrainXApp',
};

export default config;

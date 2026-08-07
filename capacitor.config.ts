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
    contentInset: 'always',
  },
};

export default config;

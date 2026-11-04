import type { LocalNotificationsPlugin } from '@capacitor/local-notifications';

/**
 * Сигнал конца отдыха, когда приложение свёрнуто.
 *
 * Колокольчик таймера играет страница, а свёрнутому приложению iOS
 * замораживает страницу целиком: человек ушёл листать рилсы — и отдых
 * кончается в тишине, сигнал звучит, только когда он вернётся. Поэтому
 * в момент старта отдыха системе отдаётся локальное уведомление на время
 * окончания: его сыграет сам iPhone, что бы ни было открыто.
 *
 * Работает только в приложении, где есть плагин уведомлений. В браузере
 * и в сборках TestFlight без плагина всё молча пропускается — остаётся
 * сигнал страницы, как было.
 */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
};

// Плагин лежит в обёртке { ln }, а не отдаётся из промиса как есть:
// прокси Capacitor отвечает на любое свойство, в том числе на .then, и
// промис принимал его за другой промис — вызов падал с «LocalNotifications
// .then() is not implemented».
let pluginPromise: Promise<{ ln: LocalNotificationsPlugin } | null> | null = null;

function getPlugin(): Promise<{ ln: LocalNotificationsPlugin } | null> {
  if (!pluginPromise) {
    // window.Capacitor подкладывает нативная обёртка до загрузки страницы;
    // сам модуль плагина грузим, только когда он точно пригодится.
    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    pluginPromise = cap?.isNativePlatform?.() && cap.isPluginAvailable?.('LocalNotifications')
      ? import('@capacitor/local-notifications').then(m => ({ ln: m.LocalNotifications }), () => null)
      : Promise.resolve(null);
  }
  return pluginPromise;
}

/**
 * Вызовы к плагину идут строго по очереди. Иначе «снять» могло обогнать
 * «поставить» (пауза сразу после старта), и уведомление прозвенело бы
 * посреди паузы.
 */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const next = queue.then(op, op);
  queue = next.catch(() => undefined);
  return next;
}

/** Номер уведомления — свой у каждого таймера на экране. */
let lastId = 0;
export function nextRestAlarmId(): number {
  return ++lastId;
}

/**
 * Ставит сигнал на момент at (мс). Повторный вызов с тем же id заменяет
 * прежний. Первый вызов показывает системный запрос на уведомления.
 *
 * Возвращает true, если iPhone действительно сыграет сигнал: плагин есть
 * и уведомления разрешены.
 */
export function scheduleRestAlarm(id: number, at: number, body: string): Promise<boolean> {
  return enqueue(async () => {
    const ln = (await getPlugin())?.ln;
    if (!ln) return false;
    await ln.schedule({
      notifications: [{
        id,
        title: 'Отдых закончен',
        body,
        schedule: { at: new Date(at) },
        // Лежит в public/ — Capacitor кладёт эту папку в сборку приложения.
        sound: 'rest-done.wav',
        // Приложение на экране — уведомление молчит, звенит сама страница.
        foreground: false,
      }],
    });
    const { display } = await ln.checkPermissions();
    return display === 'granted';
  }).catch(() => false);
}

/** Снимает сигнал: и ещё не прозвучавший, и уже висящий в Центре уведомлений. */
export function clearRestAlarm(id: number): void {
  enqueue(async () => {
    const ln = (await getPlugin())?.ln;
    if (!ln) return;
    await ln.cancel({ notifications: [{ id }] });
    await ln.removeDeliveredNotificationsById({ ids: [id] });
  }).catch(() => undefined);
}

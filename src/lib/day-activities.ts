/**
 * Активность сверх зала: велосипед, плавание, бег и т.п. — отдельной
 * записью дня (dayLog.activities), рядом с шагами. Тренировки программы
 * считаются по упражнениям, а это — просто «что ещё делал»: минуты,
 * дистанция и калории.
 *
 * Без импортов: модуль берут и экран тренировки, и ИИ-чат на сервере.
 */

export type ActivityType = 'bike' | 'swim' | 'run' | 'walk' | 'tennis' | 'yoga' | 'other';

export type DayActivity = {
  id: string;
  type: ActivityType;
  /** Своё название — для «Другое». */
  name?: string;
  minutes: number;
  km?: number | null;
  kcal?: number | null;
  /** Калории посчитаны приложением по весу, а не вписаны с часов. */
  kcalEstimated?: boolean;
};

/**
 * MET — во сколько раз нагрузка тратит больше покоя (средние значения
 * Compendium of Physical Activities). Ккал ≈ MET × вес, кг × часы.
 */
export const ACTIVITY_TYPES: { type: ActivityType; label: string; short: string; met: number; distance: boolean }[] = [
  { type: 'bike', label: 'Велосипед', short: 'вело', met: 7.5, distance: true },
  { type: 'swim', label: 'Плавание', short: 'плав', met: 7, distance: true },
  { type: 'run', label: 'Бег', short: 'бег', met: 9.8, distance: true },
  { type: 'walk', label: 'Ходьба', short: 'ходьба', met: 3.8, distance: true },
  { type: 'tennis', label: 'Теннис', short: 'теннис', met: 7.3, distance: false },
  { type: 'yoga', label: 'Йога, растяжка', short: 'йога', met: 2.8, distance: false },
  { type: 'other', label: 'Другое', short: 'актив', met: 5, distance: false },
];

export const activityMeta = (type: string) =>
  ACTIVITY_TYPES.find(t => t.type === type) ?? ACTIVITY_TYPES[ACTIVITY_TYPES.length - 1];

export const activityLabel = (a: Pick<DayActivity, 'type' | 'name'>) =>
  (a.type === 'other' && a.name?.trim()) || activityMeta(a.type).label;

export function estimateActivityKcal(type: string, minutes: number, weightKg: number | null | undefined): number | null {
  if (!weightKg || !(minutes > 0)) return null;
  return Math.round(activityMeta(type).met * weightKg * minutes / 60 / 10) * 10;
}

/** «Велосипед 60 мин, 18 км, ≈450 ккал» — для списка и для ИИ. */
export function describeActivity(a: DayActivity): string {
  const parts = [`${a.minutes} мин`];
  if (a.km) parts.push(`${String(a.km).replace('.', ',')} км`);
  if (a.kcal) parts.push(`${a.kcalEstimated ? '≈' : ''}${a.kcal} ккал`);
  return `${activityLabel(a)} ${parts.join(', ')}`;
}

/** Записи дня в надёжном виде: из старых данных и чужих клиентов может прийти что угодно. */
export function dayActivities(log: unknown): DayActivity[] {
  const list = (log as { activities?: unknown } | null | undefined)?.activities;
  return Array.isArray(list)
    ? list.filter((a): a is DayActivity => !!a && typeof a === 'object' && Number((a as DayActivity).minutes) > 0)
    : [];
}

/**
 * «Быстро добавить → Частые»: что человек ест регулярно.
 *
 * Раньше блюда считались по точному названию за всю историю. Но названия
 * даёт ИИ по фото, и одно и то же блюдо каждый раз записано чуть иначе:
 * «Яичница/болтунья — 1 целое яйцо + белки», «Яичница/болтунья (1 целое
 * яйцо + белки)», «Яичница/омлет: 2 целых яйца + 3 белка». Каждое такое —
 * «один раз», и наверх выходило то, что совпало дословно, хоть и полгода
 * назад. Здесь похожие названия сводятся к одному блюду, а недавние дни
 * весят больше старых.
 *
 * Без импортов: модуль чистый, его можно проверить на живых данных.
 */

const DAY_MS = 86_400_000;
/** Через сколько дней запись весит вдвое меньше. */
const HALF_LIFE_DAYS = 30;

/**
 * Ключ блюда: без порции и деталей в скобках, без количеств и брендов
 * латиницей, первый вариант из «А/Б». «Творог 5%» и «Творог» — одно.
 */
export function mealKey(name: string): string {
  let s = name.toLowerCase().replace(/ё/g, 'е')
    .replace(/\([^)]*\)?/g, ' ')
    .split(/\s[—–-]\s|:/)[0];
  // Бренд латиницей рядом с русским названием («Овсянка Whole Foods»).
  if (/[а-я]/.test(s)) s = s.replace(/[a-z][a-z'’&.]*/g, ' ');
  s = s.split('/')[0]
    .replace(/(^|\s)прот(еиновый)?\s+(шейк|коктейль|напиток)/, '$1протеиновый коктейль')
    .replace(/\d[\d.,]*\s*(%|гр?|мл|кг|шт)?(?!\p{L})/gu, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s || name.trim().toLowerCase();
}

/**
 * До `limit` блюд: похожие записи — одно блюдо, каждый день, когда его
 * ели, весит 0.5^(дней назад / 30). Показываем последнюю запись блюда —
 * с её порцией и КБЖУ; запись без калорий (недописанная) — только если
 * других нет, иначе быстрое добавление кладёт в дневник ноль.
 */
export function frequentMeals<T extends { name: string; calories?: number | null }>(
  mealsByDate: Record<string, T[]>,
  todayIso: string,
  limit = 8,
): T[] {
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  const groups = new Map<string, { score: number; last: string; meal: T }>();
  for (const date of Object.keys(mealsByDate).sort()) {
    const age = Math.max(0, (today - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);
    const weight = Number.isFinite(age) ? 0.5 ** (age / HALF_LIFE_DAYS) : 0;
    const seen = new Set<string>();
    for (const meal of mealsByDate[date] ?? []) {
      if (!meal?.name?.trim()) continue;
      const key = mealKey(meal.name);
      const g = groups.get(key);
      if (!g) groups.set(key, { score: weight, last: date, meal });
      else {
        // Два раза за день — всё равно один день с этим блюдом.
        if (!seen.has(key)) g.score += weight;
        g.last = date;
        if (Number(meal.calories) > 0 || !(Number(g.meal.calories) > 0)) g.meal = meal;
      }
      seen.add(key);
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.score - a.score || (a.last < b.last ? 1 : -1))
    .slice(0, limit)
    .map(g => g.meal);
}

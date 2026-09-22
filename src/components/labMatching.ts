/**
 * Сопоставление показателей между бланками.
 *
 * Главное правило: один и тот же аналит — это совпадение по
 * нормализованному ключу, биоматериалу, методике И совместимым единицам.
 * Похожего названия недостаточно: «Инсулин натощак» и «Инсулин через 2 ч»
 * — разные анализы, а мг/дл и ммоль/л — разные шкалы.
 *
 * Когда за один день есть несколько результатов одного аналита и выбрать
 * свежий нельзя, возвращаем конфликт, а не берём произвольный.
 */

export interface RawMarker {
  key?: string;
  name: string;
  value: number;
  unit: string;
  refLow?: number | null;
  refHigh?: number | null;
  optimalLow?: number | null;
  optimalHigh?: number | null;
  rawValue?: string | null;
  specimen?: string;
  method?: string;
  bound?: 'exact' | 'below' | 'above';
  needsReview?: boolean;
  group?: string;
  page?: number | null;
}

export interface RawReport {
  id: string;
  panelName: string | null;
  lab: string | null;
  /** ISO-дата забора. */
  collectedAt: string;
  /** Когда запись создана — для разрешения двух бланков в один день. */
  createdAt?: string | null;
  markers: RawMarker[];
}

/** Ключ аналита: для старых записей выводим из названия. */
export function analyteKey(m: RawMarker) {
  if (m.key && m.key.trim()) return m.key.trim().toLocaleLowerCase('ru');
  return m.name.trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');
}

/** Единицы сравниваем нестрого по написанию, но не по смыслу. */
export const unitKey = (u: string) => (u || '').trim().toLocaleLowerCase('ru').replace(/\s+/g, '');
const norm = (v?: string) => (v || '').trim().toLocaleLowerCase('ru');

/**
 * Полный идентификатор измерения. Два результата сопоставимы, только если
 * совпадают все составляющие.
 */
export function matchKey(m: RawMarker) {
  return [analyteKey(m), unitKey(m.unit), norm(m.specimen), norm(m.method)].join('|');
}

export const dayKey = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : String(iso).slice(0, 10);
};

export interface LatestPick {
  marker: RawMarker;
  report: RawReport;
  /** Несколько несопоставимых результатов на одну дату — выбирать нельзя. */
  conflict?: { count: number; labs: string[] };
}

/**
 * Самое свежее измерение каждого сопоставимого показателя.
 *
 * Свежесть определяем по дате забора; при равной дате — по времени
 * создания записи. Если и оно совпадает, а значения различаются, это
 * конфликт: показываем его, а не угадываем.
 */
export function latestByMarker(reports: RawReport[]): LatestPick[] {
  const buckets = new Map<string, { marker: RawMarker; report: RawReport }[]>();
  for (const report of reports) {
    for (const marker of report.markers) {
      const k = matchKey(marker);
      const list = buckets.get(k);
      if (list) list.push({ marker, report });
      else buckets.set(k, [{ marker, report }]);
    }
  }

  const out: LatestPick[] = [];
  for (const list of buckets.values()) {
    const sorted = [...list].sort((a, b) => {
      const byDay = dayKey(b.report.collectedAt).localeCompare(dayKey(a.report.collectedAt));
      if (byDay !== 0) return byDay;
      const at = a.report.createdAt || '';
      const bt = b.report.createdAt || '';
      return bt.localeCompare(at);
    });
    const top = sorted[0];
    const topDay = dayKey(top.report.collectedAt);
    // Кандидаты той же свежести — все результаты за самый свежий день.
    //
    // По времени сохранения выбирать нельзя: createdAt — это когда бланк
    // загрузили в приложение, а не когда взяли пробу. Два бланка одного дня
    // от разных лабораторий пришли бы в произвольном порядке, и «свежим»
    // оказался бы просто тот, который загрузили вторым.
    const tied = sorted.filter(x => dayKey(x.report.collectedAt) === topDay);
    const differing = tied.filter(x => x.marker.value !== top.marker.value);
    out.push(differing.length > 0
      ? {
          marker: top.marker,
          report: top.report,
          conflict: {
            count: tied.length,
            labs: [...new Set(tied.map(x => x.report.lab || 'без лаборатории'))],
          },
        }
      : { marker: top.marker, report: top.report });
  }
  return out;
}

/**
 * История одного показателя: только сопоставимые измерения, по возрастанию
 * даты, не позже выбранного бланка.
 */
export function historyFor(m: RawMarker, reports: RawReport[], upTo?: string) {
  const k = matchKey(m);
  const limit = upTo ? dayKey(upTo) : null;
  return reports
    .filter(r => !limit || dayKey(r.collectedAt) <= limit)
    .flatMap(r => r.markers
      .filter(x => matchKey(x) === k)
      .map(x => ({
        date: dayKey(r.collectedAt),
        value: x.value,
        refLow: x.refLow ?? null,
        refHigh: x.refHigh ?? null,
        optimalLow: x.optimalLow ?? null,
        optimalHigh: x.optimalHigh ?? null,
        lab: r.lab || undefined,
      })))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Раздел бланка: берём напечатанный, иначе «Другое». */
export function groupOf(m: RawMarker) {
  const g = (m.group || '').trim();
  return g || 'Другое';
}

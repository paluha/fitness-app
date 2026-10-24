/**
 * Карта здоровья: узлы (анализы, препараты, самочувствие) и связи между ними.
 *
 * Два вида связей, и они НЕ равнозначны:
 *
 *  - 'known'    — справочная связь из литературы («витамин D ↔ тестостерон»).
 *                 Рисуется пунктиром: это повод посмотреть, а не вывод о тебе.
 *  - 'observed' — связь, видная в ТВОИХ данных: начал курс — показатель
 *                 сдвинулся, отёчность выросла. Рисуется сплошной линией.
 *
 * Разделение принципиальное. Сплошная линия на справочном знании была бы
 * враньём: «у тебя витамин D поднял тестостерон» — утверждение, которого
 * данные не подтверждают. Пунктир честно говорит «так бывает, проверь».
 */

export type NodeKind = 'lab' | 'med' | 'feel';
export type LinkKind = 'known' | 'observed';

export type GraphNode = {
  id: string;
  label: string;
  kind: NodeKind;
  /** Есть ли данные: пустой узел рисуется бледным с приглашением заполнить. */
  filled: boolean;
  /** Короткая подпись: значение показателя, доза, последняя отметка. */
  detail?: string;
  /** Вне нормы — подсвечиваем узел, это и есть повод смотреть связи. */
  flag?: 'low' | 'high' | 'normal';
};

export type GraphLink = {
  from: string;
  to: string;
  kind: LinkKind;
  /** 0..1 — насколько связь сильная; толщина и яркость луча. */
  strength: number;
  /** Что именно показывать по тапу. */
  note: string;
};

/**
 * Справочные связи. Ключи — «канонические» имена, к которым приводятся
 * и показатели анализов, и названия препаратов.
 *
 * Список намеренно короткий: только то, что имеет смысл для силовых
 * тренировок и гормонального фона, и только то, где связь реально
 * описана. Выдумывать связи ради красивой картинки нельзя — человек
 * будет принимать по ним решения.
 */
export const KNOWN_LINKS: { a: string; b: string; strength: number; note: string }[] = [
  // Витамин D
  { a: 'vitamin_d', b: 'testosterone', strength: 0.6,
    note: 'При дефиците витамина D тестостерон обычно ниже. Восполнение дефицита помогает; при нормальном уровне добавка почти ничего не меняет.' },
  { a: 'vitamin_d', b: 'mood', strength: 0.5,
    note: 'Низкий витамин D связан с подавленным настроением, особенно зимой.' },
  { a: 'vitamin_d', b: 'immunity', strength: 0.5,
    note: 'Дефицит витамина D связан с более частыми простудами.' },

  // Тестостерон и его окружение
  { a: 'testosterone', b: 'libido', strength: 0.8,
    note: 'Либидо и утренние эрекции — самый быстрый субъективный отклик на уровень тестостерона.' },
  { a: 'testosterone', b: 'muscle', strength: 0.8,
    note: 'Тестостерон напрямую влияет на синтез белка и рост силы.' },
  { a: 'testosterone', b: 'mood', strength: 0.5,
    note: 'Низкий тестостерон часто идёт вместе с апатией и раздражительностью.' },
  { a: 'testosterone', b: 'estradiol', strength: 0.8,
    note: 'Часть тестостерона превращается в эстрадиол (ароматизация). Чем выше доза, тем заметнее.' },
  { a: 'testosterone', b: 'dht', strength: 0.7,
    note: 'Из тестостерона образуется ДГТ — он отвечает за часть эффектов, включая влияние на кожу и волосы.' },
  { a: 'testosterone', b: 'hematocrit', strength: 0.6,
    note: 'Тестостерон повышает гематокрит и гемоглобин. Это главный показатель безопасности на курсе — следи за ним.' },

  // Эстрадиол: то, ради чего и ведут самонаблюдение
  { a: 'estradiol', b: 'swelling', strength: 0.7,
    note: 'Высокий эстрадиол задерживает воду — отёчность один из первых признаков.' },
  { a: 'estradiol', b: 'nipples', strength: 0.7,
    note: 'Чувствительность сосков — характерный симптом повышенного эстрадиола.' },
  { a: 'estradiol', b: 'mood', strength: 0.5,
    note: 'И высокий, и слишком низкий эстрадиол ухудшают настроение. Слишком низкий — отдельная проблема, не «чем меньше, тем лучше».' },
  { a: 'estradiol', b: 'libido', strength: 0.5,
    note: 'Слишком низкий эстрадиол сам по себе сажает либидо, даже при высоком тестостероне.' },

  { a: 'prolactin', b: 'libido', strength: 0.6,
    note: 'Повышенный пролактин снижает либидо и может мешать эрекции.' },
  { a: 'dht', b: 'acne', strength: 0.6,
    note: 'ДГТ усиливает работу сальных желёз — отсюда акне на курсе.' },

  // Щитовидная железа
  { a: 'tsh', b: 'energy', strength: 0.7,
    note: 'Высокий ТТГ (гипотиреоз) — усталость, зябкость, набор веса.' },
  { a: 'tsh', b: 'mood', strength: 0.5,
    note: 'Нарушения щитовидной железы заметно влияют на настроение.' },
  { a: 'ferritin', b: 'energy', strength: 0.7,
    note: 'Низкий ферритин даёт усталость даже при нормальном гемоглобине.' },
  { a: 'b12', b: 'energy', strength: 0.6,
    note: 'Дефицит B12 — усталость, онемение, туман в голове.' },

  // Добавки
  { a: 'magnesium', b: 'sleep', strength: 0.5,
    note: 'Магний помогает засыпанию и качеству сна, особенно при дефиците.' },
  { a: 'magnesium', b: 'cramps', strength: 0.6,
    note: 'Судороги в мышцах — частый признак нехватки магния.' },
  { a: 'omega3', b: 'cholesterol', strength: 0.5,
    note: 'Омега-3 снижает триглицериды; на ЛПНП влияет слабее.' },
  { a: 'omega3', b: 'joints', strength: 0.4,
    note: 'Омега-3 немного уменьшает воспаление и боль в суставах.' },
  { a: 'creatine', b: 'muscle', strength: 0.7,
    note: 'Креатин — одна из немногих добавок с доказанным приростом силы.' },
  { a: 'zinc', b: 'testosterone', strength: 0.4,
    note: 'Цинк нужен для синтеза тестостерона, но добавка помогает только при дефиците.' },

  // Сон и восстановление
  { a: 'sleep', b: 'testosterone', strength: 0.7,
    note: 'Тестостерон вырабатывается во сне. Несколько ночей по 5 часов роняют его заметно.' },
  { a: 'sleep', b: 'mood', strength: 0.7, note: 'Недосып бьёт по настроению быстрее, чем что-либо ещё.' },
  { a: 'sleep', b: 'muscle', strength: 0.6, note: 'Восстановление и рост мышц идут во сне.' },
  { a: 'sleep', b: 'energy', strength: 0.8, note: 'Прямая связь, в пояснениях не нуждается.' },

  { a: 'cortisol', b: 'sleep', strength: 0.6, note: 'Высокий вечерний кортизол мешает засыпанию.' },
  { a: 'cortisol', b: 'muscle', strength: 0.5, note: 'Хронически высокий кортизол работает против набора мышц.' },

  { a: 'glucose', b: 'energy', strength: 0.5, note: 'Скачки сахара дают провалы энергии после еды.' },
  { a: 'hba1c', b: 'glucose', strength: 0.9, note: 'HbA1c — это средний сахар за 2-3 месяца. По сути один показатель в двух видах.' },
];

/** Человеческие названия узлов. */
export const NODE_LABELS: Record<string, string> = {
  testosterone: 'Тестостерон',
  estradiol: 'Эстрадиол',
  prolactin: 'Пролактин',
  dht: 'ДГТ',
  vitamin_d: 'Витамин D',
  tsh: 'ТТГ',
  ferritin: 'Ферритин',
  b12: 'B12',
  cortisol: 'Кортизол',
  glucose: 'Глюкоза',
  hba1c: 'HbA1c',
  hematocrit: 'Гематокрит',
  cholesterol: 'Холестерин',
  magnesium: 'Магний',
  omega3: 'Омега-3',
  creatine: 'Креатин',
  zinc: 'Цинк',
  // самочувствие
  libido: 'Либидо',
  mood: 'Настроение',
  sleep: 'Сон',
  energy: 'Энергия',
  swelling: 'Отёчность',
  nipples: 'Соски',
  acne: 'Акне',
  muscle: 'Мышцы',
  immunity: 'Иммунитет',
  cramps: 'Судороги',
  joints: 'Суставы',
  cholesterol_feel: 'Холестерин',
};

/** К каким узлам относится что: определяет цвет и группировку. */
export const NODE_KIND: Record<string, NodeKind> = {
  testosterone: 'lab', estradiol: 'lab', prolactin: 'lab', dht: 'lab',
  vitamin_d: 'lab', tsh: 'lab', ferritin: 'lab', b12: 'lab',
  cortisol: 'lab', glucose: 'lab', hba1c: 'lab', hematocrit: 'lab', cholesterol: 'lab',
  magnesium: 'med', omega3: 'med', creatine: 'med', zinc: 'med',
  libido: 'feel', mood: 'feel', sleep: 'feel', energy: 'feel',
  swelling: 'feel', nipples: 'feel', acne: 'feel', muscle: 'feel',
  immunity: 'feel', cramps: 'feel', joints: 'feel',
};

/**
 * Приводим название показателя из лаборатории к канону.
 *
 * Названия приходят как есть («TESTOSTERONE, FREE», «VITAMIN D,25-OH,TOTAL,IA»),
 * поэтому сопоставляем по вхождению, а не по точному совпадению.
 */
export function canonLab(rawName: string): string | null {
  const n = rawName.toUpperCase();
  // Порядок важен: «TESTOSTERONE, FREE» должен стать testosterone,
  // но «DIHYDROTESTOSTERONE» — это dht, а не тестостерон.
  if (/DIHYDROTESTOSTERONE|\bDHT\b/.test(n)) return 'dht';
  if (/TESTOSTERONE/.test(n)) return 'testosterone';
  if (/ESTRADIOL|\bE2\b/.test(n)) return 'estradiol';
  if (/PROLACTIN/.test(n)) return 'prolactin';
  if (/VITAMIN D/.test(n)) return 'vitamin_d';
  if (/\bTSH\b|THYROID STIMULATING/.test(n)) return 'tsh';
  if (/FERRITIN/.test(n)) return 'ferritin';
  if (/B12|COBALAMIN/.test(n)) return 'b12';
  if (/CORTISOL/.test(n)) return 'cortisol';
  if (/HEMOGLOBIN A1C|HBA1C/.test(n)) return 'hba1c';
  if (/GLUCOSE/.test(n)) return 'glucose';
  if (/HEMATOCRIT|\bHCT\b/.test(n)) return 'hematocrit';
  // Только общий холестерин: фракции (HDL/LDL/ratio) в карту не тащим,
  // иначе из одного анализа вырастает пять почти одинаковых узлов.
  if (/^CHOLESTEROL, TOTAL$|^CHOLESTEROL$/.test(n.trim())) return 'cholesterol';
  if (/MAGNESIUM/.test(n)) return 'magnesium';
  if (/\bZINC\b/.test(n)) return 'zinc';
  return null;
}

/** То же для препаратов и добавок, которые ведёт пользователь. */
export function canonMed(rawName: string): string | null {
  const n = rawName.toLowerCase();
  if (/витамин\s*d|vitamin\s*d|холекальциф/.test(n)) return 'vitamin_d';
  if (/магн|magnes/.test(n)) return 'magnesium';
  if (/омега|omega|рыбий жир|fish oil/.test(n)) return 'omega3';
  if (/креатин|creatine/.test(n)) return 'creatine';
  if (/цинк|zinc/.test(n)) return 'zinc';
  if (/тестостерон|testosterone|энантат|ципионат|сустанон/.test(n)) return 'testosterone';
  if (/b12|кобаламин|цианокобаламин/.test(n)) return 'b12';
  if (/железо|iron|ферритин/.test(n)) return 'ferritin';
  return null;
}

/** И для полей самонаблюдения, которые пользователь завёл сам. */
export function canonFeel(rawName: string): string | null {
  const n = rawName.toLowerCase();
  if (/отёчн|отечн|отёк|отек/.test(n)) return 'swelling';
  if (/соск/.test(n)) return 'nipples';
  if (/настроен/.test(n)) return 'mood';
  if (/акне|прыщ|кожа/.test(n)) return 'acne';
  if (/эрекц|либидо|влечен/.test(n)) return 'libido';
  if (/сон|сплю|высып/.test(n)) return 'sleep';
  if (/энерг|бодр|усталост/.test(n)) return 'energy';
  if (/судорог/.test(n)) return 'cramps';
  if (/сустав/.test(n)) return 'joints';
  if (/иммунит|просту/.test(n)) return 'immunity';
  if (/сил|мышц|масс/.test(n)) return 'muscle';
  return null;
}

/* ------------------------------------------------------------------ *
 * Связи, видные в ДАННЫХ пользователя
 * ------------------------------------------------------------------ */

export type FeelPoint = { date: string; value: number };
export type LabPoint = { date: string; value: number };

/**
 * Корреляция Спирмена (по рангам), а не Пирсона.
 *
 * Шкала самонаблюдения — порядковая: «слегка» и «заметно» отличаются на
 * единицу, но это не значит, что отёчность выросла ровно вдвое. Ранговая
 * корреляция про такие шкалы и предназначена, а Пирсон на них врёт.
 */
export function spearman(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 4 || ys.length !== n) return null;
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      // Связанные ранги — средний: иначе одинаковые значения
      // («нет, нет, нет») перекашивают результат.
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mx, b = ry[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return null; // всё одинаковое — связи не видно
  return num / Math.sqrt(dx * dy);
}

/** Минимум точек, ниже которого о связи говорить нельзя. */
export const MIN_POINTS = 6;

/**
 * Связь между двумя рядами самонаблюдения.
 *
 * Сопоставляем по датам: совпадающие дни, в обоих есть значение.
 * Возвращаем null, если точек мало или связь слабая — пустой луч хуже,
 * чем его отсутствие.
 */
export function observedLink(a: FeelPoint[], b: FeelPoint[]): { strength: number; n: number; r: number } | null {
  const byDate = new Map(b.map(p => [p.date, p.value]));
  const xs: number[] = [], ys: number[] = [];
  for (const p of a) {
    const other = byDate.get(p.date);
    if (other === undefined) continue;
    xs.push(p.value); ys.push(other);
  }
  if (xs.length < MIN_POINTS) return null;
  const r = spearman(xs, ys);
  if (r === null) return null;
  // |r| < 0.4 — шум на таком числе точек. Не рисуем.
  if (Math.abs(r) < 0.4) return null;
  return { strength: Math.min(1, Math.abs(r)), n: xs.length, r };
}

/**
 * Сдвиг показателя после начала курса.
 *
 * Корреляцию тут считать не на чем — анализов единицы. Поэтому просто
 * сравниваем последнее значение ДО начала приёма и первое ПОСЛЕ.
 * Это не доказательство причины, и формулировка в note должна это
 * отражать: «после начала», а не «из-за».
 */
export function shiftAfterStart(points: LabPoint[], startedAt: string): { delta: number; before: number; after: number } | null {
  const before = points.filter(p => p.date < startedAt).sort((a, b) => a.date.localeCompare(b.date)).pop();
  const after = points.filter(p => p.date >= startedAt).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!before || !after || before.value === 0) return null;
  return { delta: (after.value - before.value) / Math.abs(before.value), before: before.value, after: after.value };
}

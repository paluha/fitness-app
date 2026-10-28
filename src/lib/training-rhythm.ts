/**
 * Ритм тренировок для ИИ-чата: сколько и когда человек реально тренировался.
 *
 * На «идти сегодня в зал или отдыхать?» ассистент смотрел на вчерашний
 * день и на вкладку, выбранную на сегодня. Её приложение ставит само —
 * это следующая по кругу, а не план и не отметка о сделанном. Отсюда
 * «Тренировку 3 ты уже сделал вчера» при сделанной Т2 и «сегодня отдых»
 * на неделе, где из четырёх тренировок была одна. Здесь те же факты
 * готовыми цифрами: по неделям, за месяц, подряд и с последней.
 *
 * Без импортов: модуль чистый, его можно проверить на живых данных
 * простым скриптом.
 */

type DayWorkout = {
  workoutId?: string;
  workoutName?: string;
  exercises?: { completed?: boolean }[];
} | null | undefined;

type RhythmDay = {
  isOffDay?: boolean;
  workoutCompleted?: string | null;
  workoutSnapshot?: DayWorkout;
  workoutDraft?: DayWorkout;
};

type ProgramDay = { id?: string; name?: string; exercises?: unknown[] };

type Trained = { date: string; id: string | null; name: string; done: number; total: number };

const DAY_MS = 86_400_000;
const dayNum = (s: string) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS);
const dayStr = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const ddmm = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const days = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

/**
 * Тренировка дня, если в нём отмечено хоть одно упражнение — то же
 * правило, по которому приложение считает тренировки в календаре и
 * выбирает следующую. Название — того, что делали (снапшот или
 * драфт), а не выбранной вкладки.
 */
function dayTraining(date: string, log: RhythmDay | null | undefined, program: ProgramDay[]): Trained | null {
  const src = log?.workoutSnapshot ?? log?.workoutDraft;
  const exs = Array.isArray(src?.exercises) ? src.exercises : [];
  const done = exs.filter(e => e?.completed).length;
  if (done === 0) return null;
  const id = src?.workoutId ?? log?.workoutCompleted ?? null;
  const name = src?.workoutName || program.find(w => w.id === id)?.name || 'Тренировка';
  return { date, id, name, done, total: exs.length };
}

export function buildTrainingRhythm(dayLogs: unknown, workouts: unknown, todayIso: string): string {
  const logs = (dayLogs && typeof dayLogs === 'object' && !Array.isArray(dayLogs))
    ? dayLogs as Record<string, RhythmDay>
    : {};
  const program = (Array.isArray(workouts) ? workouts as ProgramDay[] : [])
    .filter(w => Array.isArray(w?.exercises) && w.exercises.length > 0);
  const today = dayNum(todayIso);

  const trained = Object.keys(logs)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= todayIso)
    .sort()
    .map(d => dayTraining(d, logs[d], program))
    .filter((t): t is Trained => t !== null);

  const out: string[] = [];
  const perWeek = program.length;
  if (perWeek > 0) {
    out.push(`Цель: ${perWeek} ${plural(perWeek, 'тренировка', 'тренировки', 'тренировок')} в неделю — по числу тренировок в программе (${program.map(w => w.name).join(', ')}). Их делают по кругу, расписания по датам нет.`);
  }

  const todayT = trained.find(t => t.date === todayIso);
  const weekday = WEEKDAYS[new Date(today * DAY_MS).getUTCDay()];
  out.push(`Сегодня ${ddmm(todayIso)}, ${weekday}: ` + (todayT
    ? `уже тренировался — ${todayT.name}, ${todayT.done} из ${todayT.total} упр.`
    : logs[todayIso]?.isOffDay ? 'отмечен как день отдыха.' : 'тренировки пока нет.'));

  const past = trained.filter(t => t.date < todayIso);
  const last = past[past.length - 1];
  if (last) {
    const ago = today - dayNum(last.date);
    // Сколько дней без пропуска заканчиваются последней тренировкой и
    // сколько он отдыхал перед ними.
    let streak = 1;
    while (streak < past.length
      && dayNum(past[past.length - streak].date) - dayNum(past[past.length - streak - 1].date) === 1) streak++;
    const before = past[past.length - streak - 1];
    const restBefore = before ? dayNum(past[past.length - streak].date) - dayNum(before.date) - 1 : null;
    const when = ago === 1 ? 'вчера' : `${days(ago)} назад`;
    const run = ago === 1
      ? ` Тренируется ${days(streak)} подряд` + (restBefore != null ? `, перед этим ${days(restBefore)} отдыха.` : '.')
      : ` С тех пор ${days(ago - 1)} отдыха.`;
    out.push(`Последняя до сегодня: ${when}, ${ddmm(last.date)} — ${last.name} (${last.done} из ${last.total} упр.).${run}`);
  } else {
    out.push('До сегодня тренировок не записано.');
  }

  // Следующая по кругу — как её выбирает приложение: после последней
  // тренировки, где отмечено хоть одно упражнение.
  const ref = todayT ?? last;
  if (ref && program.length) {
    const idx = program.findIndex(w => w.id === ref.id);
    if (idx >= 0) {
      const next = program[(idx + 1) % program.length];
      out.push(`Следующая по кругу: ${next.name} — последней была ${ref.name}.`);
    } else {
      out.push('Последняя тренировка — из прошлой программы, по текущей ещё не занимался.');
    }
  }

  const monday = today - ((new Date(today * DAY_MS).getUTCDay() + 6) % 7);
  const goal = perWeek ? ` из ${perWeek}` : '';
  out.push('По неделям (пн–вс), новые сверху:');
  for (let w = 0; w < 4; w++) {
    const from = monday - 7 * w, to = from + 6;
    const inWeek = trained.filter(t => dayNum(t.date) >= from && dayNum(t.date) <= to);
    const now = w === 0 ? `, эта неделя, сегодня ${today - from + 1}-й день из 7` : '';
    out.push(`  • ${ddmm(dayStr(from))}–${ddmm(dayStr(to))}${now}: ${inWeek.length}${goal}`
      + (inWeek.length ? ` — ${inWeek.map(t => `${ddmm(t.date)} ${t.name}`).join(', ')}` : ''));
  }

  const within = (n: number) => trained.filter(t => today - dayNum(t.date) < n).length;
  const month = trained.filter(t => t.date.slice(0, 7) === todayIso.slice(0, 7)).length;
  const avg = (within(28) / 4).toFixed(1).replace('.', ',');
  out.push(`За последние 7 дней: ${within(7)}. За 28 дней: ${within(28)}, в среднем ${avg} в неделю${perWeek ? ` при цели ${perWeek}` : ''}. С начала месяца: ${month}.`);

  return out.join('\n');
}

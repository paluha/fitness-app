import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { trackError } from '@/lib/monitor';
import Anthropic from '@anthropic-ai/sdk';
import { trainxSystem } from '@/lib/trainx-ai';
import { getMergedDayLogs } from '@/lib/fitness-merge';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

// AI-чат с фитнес-ассистентом, который "цепляет" данные пользователя.
// Паттерн как у /api/food/recommend: стабильный system-промпт кэшируется,
// а персональные данные + история чата идут в messages ПОСЛЕ кэш-брейкпоинта,
// поэтому не инвалидируют кэш.
export const maxDuration = 60;

const CHAT_SYSTEM = `Ты — персональный AI-ассистент в фитнес-приложении. Ты помогаешь пользователю с тренировками, питанием, восстановлением и прогрессом.

ТВОЯ РОЛЬ:
Ты соединяешь три экспертизы и переключаешься между ними сам, по сути вопроса — пользователь ничего не выбирает.

1. ТРЕНЕР по силовым тренировкам.
- Прогрессия: когда добавлять вес, когда объём, когда разгрузиться. Опирайся на рабочие веса и частоту из данных, а не на общие схемы.
- Техника: назови 2-3 ключевые точки и типичную ошибку, а не пересказ учебника.
- Восстановление: связывай застой в весах с недосыпом, недоеданием и частотой — у тебя есть эти данные.
- Если подключено кольцо Oura, смотри раздел СОН И ВОССТАНОВЛЕНИЕ: низкая готовность, упавшая ВСР или подскочивший пульс покоя — повод снизить нагрузку, а не добавить. Сравнивай день со средним этого человека, а не с чужой нормой.
- Разбирай суперсеты, дропсеты и работу до отказа: зачем нужны, кому рано, как встроить.

2. НУТРИЦИОЛОГ.
- Считай в граммах и калориях от веса и цели пользователя, а не «ешь больше белка».
- Смотри дневник еды: что реально ест, где дыры по белку, клетчатке, режиму.
- Предлагай замены продуктов под его вкусы и ограничения, а не идеальный рацион из учебника.
- Объясняй, как питание влияет на показатели из анализов и на результаты в зале.

3. ЗДОРОВЬЕ И АНАЛИЗЫ.
Рамка простая: ты помогаешь понять свои данные и собрать информацию для врача — не ставишь диагнозы и не назначаешь лечение.
- Разбирай показатели: что означает, в норме ли, куда движется динамика, как связан с тренировками, питанием, сном.
- БЕЗРЕЦЕПТУРНОЕ можно рекомендовать по данным: витамин D, магний, омега-3, креатин, железо, клетчатка, режим сна. Называй дозировки и сроки, говори, что перепроверить анализом и когда.
- РЕЦЕПТУРНОЕ не назначай. Если показатели указывают на тему, где нужен препарат по рецепту, — назови тему, объясни, почему к врачу, и помоги подготовиться: какие показатели показать, какие вопросы задать, каких данных не хватает. Доз не предлагай.
- Тревожные показатели и симптомы — прямо говори, что это к врачу, и не тяни с этим до конца ответа.

ОБЩЕЕ ДЛЯ ВСЕХ ТРЁХ:
- Опирайся на ДАННЫЕ ПОЛЬЗОВАТЕЛЯ ниже (цели, дневник еды, тренировки, замеры, анализы). Говори про КОНКРЕТНОГО человека: называй его цифры, даты, упражнения.
- Вопрос почти всегда лежит на стыке. Низкий ферритин — это и анализы, и питание, и падение выносливости в зале: отвечай целиком, а не из одной роли.
- Не объявляй, в какой роли отвечаешь, и не пиши «как тренер» — просто отвечай по существу.
- Если данных не хватает — скажи, чего именно, и дай ответ с оговоркой. Не отказывайся отвечать из-за неполноты.

КАРТОЧКИ ДАННЫХ:
Когда твой ответ опирается на конкретные данные пользователя, вставь в текст специальный плейсхолдер на отдельной строке — приложение заменит его красивой карточкой:
- [[card:macros:ГГГГ-ММ-ДД]] — макросы/калории за КОНКРЕТНУЮ дату (план vs съедено). ОБЯЗАТЕЛЬНО подставь дату того дня, про который идёт речь. Сегодня — это дата из поля СЕГОДНЯ выше. «Вчера» — это день минус один. Если пользователь спрашивает про вчера, ставь вчерашнюю дату, а не сегодняшнюю.
- [[card:lastWorkout]] — последняя тренировка. ОБЯЗАТЕЛЬНО вставляй всякий раз, когда речь идёт про последнюю/недавнюю тренировку пользователя.
- [[card:labs]] — последний анализ. ОБЯЗАТЕЛЬНО вставляй, когда говоришь про анализы пользователя.
Правило: если ответ опирается на данные пользователя из этих трёх областей (еда за день, последняя тренировка, анализы) — соответствующая карточка ОБЯЗАТЕЛЬНА, а не опциональна; текстом её содержимое не пересказывай, дай выводы. Каждый плейсхолдер вставляй ОДИН раз, на отдельной строке. Не выдумывай других плейсхолдеров.

ВАЖНО про карточку питания:
- Ставь [[card:macros:ДАТА]] ТОЛЬКО на дату из списка «ДАТЫ С ЗАПИСАННОЙ ЕДОЙ» ниже. За остальные дни еды нет, и карточка скажет «за этот день еда не записана».
- Если пользователь спрашивает про день, которого в этом списке нет, — не подставляй вместо него другую дату. Скажи прямо, что за тот день еды не записано, и назови ближайший день с записями.
- Плейсхолдер — это разметка приложения, не показывай его пользователю как текст и не объясняй его устройство.
- Если пользователь говорит, что не видит данных, — НЕ объявляй это технической проблемой приложения. Сначала проверь по списку выше, есть ли вообще еда за ту дату: скорее всего данных за этот день нет.

ПРАВКА ОДНОЙ ТРЕНИРОВКИ:
- Инструмент edit_workout меняет ОДНУ тренировку: заменить упражнение, добавить или убрать, поправить подходы, вес, отдых, пометки. Для «замени жим на гантели», «добавь подход», «убери это упражнение», «подними вес» используй именно его, а не замену всей программы — иначе потеряется всё остальное и архив заполнится мусором.
- Присылай тренировку ЦЕЛИКОМ в новом виде: и то, что изменил, и то, что осталось. Иначе пропадут упражнения, которых ты не коснулся.
- Правка НЕ применяется сразу: пользователь увидит, что меняется, и подтвердит кнопкой. Так и говори.
- Если сам заметил причину для правки (вес стоит месяц, объёма мало, упражнение дублирует другое) — предложи её словами и спроси, применить ли. Не вызывай инструмент без согласия.

ОБНОВЛЕНИЕ ПРОГРАММЫ:
- У тебя есть инструмент propose_program — им ты собираешь новую программу тренировок. Вызывай его, когда пользователь просит обновить, поменять или составить программу.
- Программа применяется НЕ сразу. Как только ты её соберёшь, откроется экран с полным списком упражнений и кнопками «Принять программу» и «Отклонить» — решает пользователь. Старая при этом уйдёт в историю программ, её можно вернуть. Так и говори: «сейчас откроется экран, посмотри и подтверди» — не обещай, что уже всё поменял.
- Перед вызовом спроси ОДНИМ вопросом, нужен ли продвинутый режим (суперсеты, дропсеты, работа до отказа) или стандартный. НЕ спрашивай, если режим уже известен: пользователь назвал его в этом разговоре, или в истории есть пометка о собранной программе — тогда бери тот же режим и собирай сразу.
- Правка уже собранной программы («сделай 4 дня», «убери становую», «добавь день на ноги») — это НЕ новая программа. Режим не переспрашивай, вопросов не задавай: примени замечание к тому, что уже предложил, и вызови инструмент снова.
- Опирайся на его рабочие веса, частоту тренировок и цель. Не пересказывай получившуюся программу текстом — она и так будет показана списком; напиши только, что в ней изменилось и почему.
- У экрана подтверждения три кнопки: «Принять программу», «Обсудить и поправить», «Отклонить». Если пользователь пришёл из «Обсудить» — программа всё ещё ждёт решения, она НЕ отменена. Обсуждай и правь её: на просьбу вроде «убери становую» или «сделай 4 дня вместо 3» собери программу заново инструментом с учётом замечания, а не начинай с нуля и не спрашивай всё сначала. После этого скажи, что экран откроется снова.
- В истории переписки есть отметки «Программа принята и уже действует» и «Программа отклонена». Читай их: если программа принята, она УЖЕ РАБОТАЕТ — не предлагай составить её снова и не говори «сейчас составлю». На вопросы про неё («она на сколько дней?», «что в ней?») отвечай по разделу ДЕЙСТВУЮЩАЯ ПРОГРАММА ниже.
- После принятия программы ТЕМА ЗАКРЫТА. Не спрашивай «составить ещё одну?», «хочешь другую программу?», «сделать вариант на другое число дней?» — пользователь только что выбрал эту. Предлагай новую программу ТОЛЬКО если он сам об этом попросит. Разбирать уже принятую программу, объяснять упражнения и технику — можно и нужно, это не то же самое.
- В скобках над программой написано, откуда она взялась. Если её принял пользователь по твоему предложению — так и говори. Если она заведена до этой переписки, не приписывай её себе: её мог задать тренер или собрать сам пользователь.
- Про прошлые программы отвечай по разделу ИСТОРИЯ ПРОГРАММ: когда меняли, сколько по какой тренировались. Любую можно вернуть на экране «Программа».

КАК ВЕСТИ ДИАЛОГ:
- НЕ переспрашивай то, что пользователь уже сказал в этом разговоре или что есть в его данных выше. Перед вопросом проверь историю переписки и данные: ответ часто уже есть.
- Не задавай больше ОДНОГО вопроса за ответ. Список из пяти вопросов — это допрос, а не разговор.
- Главное — дать ответ, а не собрать анкету. Отвечай на том, что известно сейчас, и сам укажи, на каких допущениях построен ответ. Спрашивай только тогда, когда без ответа рекомендация будет вредной или бессмысленной.
- Если данных не хватает — не отказывайся и не жди. Дай конкретный план с оговоркой «если X иначе — скорректируем».
- Конкретика значит цифры: вес, подходы, граммы, калории, дни недели. «Питайся правильно» и «работай над техникой» — это не ответ.
- Не пересказывай то, что уже говорил в предыдущих сообщениях. Если разговор пошёл по кругу — скажи об этом прямо и предложи следующий шаг.
- Если пользователь поправил тебя или сказал, что ты уходишь в сторону, — вернись к его исходному вопросу и ответь на него.

ПРАВИЛА:
- Пиши на языке пользователя (по умолчанию русский).
- Будь конкретным и практичным. Без воды.
- Не ставь медицинских диагнозов и не назначай рецептурные препараты — границы описаны выше в разделе про здоровье.
- Не выдумывай данные пользователя, которых нет в контексте.
- Форматируй ответ читабельно: короткие абзацы, списки где уместно.
- НИКАКИХ эмодзи и смайликов в ответах. Чистый текст.`;

// Безопасно сериализуем JSON-поле, обрезая по размеру, чтобы не раздувать
// контекст (и счёт за токены). Берём последние записи, если это объект по датам.
function compactJson(value: unknown, maxChars: number): string {
  if (value == null) return '—';
  try {
    let s = JSON.stringify(value);
    if (s.length > maxChars) s = s.slice(0, maxChars) + '…(обрезано)';
    return s;
  } catch {
    return '—';
  }
}

// Последние N ключей объекта-по-датам (dayLogs: { "2026-06-20": {...} }).
function recentByDate(value: unknown, n: number): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    // ключи-даты сортируем по убыванию, берём последние n
    entries.sort((a, b) => (a[0] < b[0] ? 1 : -1));
    return Object.fromEntries(entries.slice(0, n));
  }
  return value;
}

type DropStep = { weight?: number | string; reps?: number | string };
type ExSet = { weight?: number | string; reps?: number | string; completed?: boolean; toFailure?: boolean; drops?: DropStep[] };
type DayExercise = { name?: string; completed?: boolean; sets?: ExSet[]; actualSets?: string; supersetId?: string };
type DayEntry = { exercises?: DayExercise[] };

// Рабочие подходы упражнения строкой «вес×повторы»: 60×10, 60×8, 65×6.
// Берём структурные sets (колонка весов в UI); фолбэк — легаси-текст actualSets.
function exerciseSets(e: DayExercise): string {
  if (Array.isArray(e.sets) && e.sets.length) {
    const parts = e.sets
      .filter(s => s && (s.completed || s.reps || s.weight))
      .map(s => {
        // Техники показываем прямо в подходе: без них ИИ не видит
        // реальную нагрузку и планирует прогрессию как для обычных
        // подходов. Дропсет — один подход со сбросами, а не три подхода.
        let out = `${s.weight ?? '?'}×${s.reps ?? '?'}`;
        const drops = Array.isArray(s.drops) ? s.drops : [];
        if (drops.length) {
          out += ' (дропсет: ' + drops.map(d => `${d.weight ?? '?'}×${d.reps ?? '?'}`).join(' → ') + ')';
        }
        if (s.toFailure) out += ' до отказа';
        return out;
      });
    if (parts.length) {
      const sup = e.supersetId ? ` [суперсет ${e.supersetId}]` : '';
      return parts.join(', ') + sup;
    }
  }
  if (typeof e.actualSets === 'string' && e.actualSets.trim()) return e.actualSets.trim();
  return '';
}

// Человекочитаемая история ТРЕНИРОВОК по всем дневным логам. Последние дни —
// подробно, с рабочими весами и повторами по каждому подходу (иначе модель
// уверена, что пользователь весов не вводит); старые дни — одной строкой.
function buildWorkoutHistory(dayLogs: unknown, maxLines = 60, detailedDays = 15): string {
  if (!dayLogs || typeof dayLogs !== 'object' || Array.isArray(dayLogs)) return '—';
  const rows: { date: string; line: string; details: string[] }[] = [];
  for (const [date, raw] of Object.entries(dayLogs as Record<string, unknown>)) {
    const day = raw as { workoutSnapshot?: DayEntry & { workoutName?: string }; workoutDraft?: DayEntry & { workoutName?: string } } | null;
    const src = day?.workoutSnapshot ?? day?.workoutDraft;
    const ex = src?.exercises ?? [];
    if (!Array.isArray(ex) || ex.length === 0) continue;
    const done = ex.filter(e => e?.completed).length;
    if (done === 0) continue; // день без выполненных упражнений = отдых, пропускаем
    const name = (src as { workoutName?: string })?.workoutName || 'Тренировка';
    const details = ex
      .filter(e => e?.completed)
      .slice(0, 12)
      .map(e => {
        const sets = exerciseSets(e);
        return `  • ${e.name || 'упражнение'}${sets ? `: ${sets}` : ''}`;
      });
    rows.push({ date, line: `${date}: ${name} — ${done}/${ex.length} упр.`, details });
  }
  if (rows.length === 0) return 'Нет записанных тренировок.';
  // новые сверху; свежие дни разворачиваем с подходами, старые — одной строкой
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = rows.length;
  const shown = rows.slice(0, maxLines).map((r, i) =>
    i < detailedDays && r.details.length ? r.line + '\n' + r.details.join('\n') : r.line
  );
  const head = `Всего дней с тренировками: ${total}. Список (новые сверху; у свежих дней указаны подходы «вес×повторы»):`;
  return head + '\n' + shown.join('\n') + (total > maxLines ? `\n…и ещё ${total - maxLines} дней` : '');
}

type Meal = { name?: string; time?: string; calories?: number; protein?: number; fat?: number; carbs?: number };

// Читаемая сводка ЕДЫ по последним дням: дата, блюда с макросами и дневные
// итоги. Надёжнее, чем сырой JSON дня — модель не теряет еду из-за обрезки.
/**
 * Действующая программа человекочитаемым списком.
 *
 * Раньше сюда шёл сырой JSON с лимитом 2000 символов — программа на
 * пятнадцать упражнений обрезалась на середине, и модель не могла
 * ответить даже на «сколько дней в программе».
 */
export function buildProgramText(workouts: unknown): string {
  if (!Array.isArray(workouts)) return '—';
  const days = (workouts as { id?: string; name?: string; exercises?: { name?: string; plannedSets?: string; restTime?: string; notes?: string; supersetId?: string }[] }[])
    .filter(w => Array.isArray(w?.exercises) && w.exercises.length > 0);
  if (days.length === 0) return 'Программа не задана.';

  const blocks = days.map((w, i) => {
    const lines = (w.exercises || []).map((e, j) => {
      const sup = e.supersetId ? ` [суперсет ${e.supersetId}]` : '';
      const note = e.notes ? ` — ${e.notes}` : '';
      return `  ${j + 1}. ${e.name || '?'} — ${e.plannedSets || 'план не указан'}${sup}${note}`;
    });
    return `${w.name || 'Тренировка ' + (i + 1)} (${w.id || 't' + (i + 1)}):\n${lines.join('\n')}`;
  });
  return `Всего тренировок в программе: ${days.length}.\n\n${blocks.join('\n\n')}`;
}

/**
 * История программ: что было до текущей и когда её сменили.
 *
 * Без неё ассистент не понимает, откуда взялись тренировки — он сам их
 * предложил, их задал тренер или пользователь собрал руками, — и когда
 * это случилось. Отсюда вопросы вроде «а какая у тебя программа?» при
 * том, что он же её и составил.
 */
export function buildProgramHistory(archive: unknown, dayLogs: unknown): string {
  if (!Array.isArray(archive) || archive.length === 0) {
    return 'Прошлых программ нет — текущая первая либо история не велась.';
  }
  const items = archive as { label?: string; archivedAt?: string; workouts?: { exercises?: { name?: string }[] }[] }[];

  // Когда по программе реально тренировались: archivedAt — это момент
  // замены в базе, а заниматься по ней могли ещё долго после.
  const logs = (dayLogs && typeof dayLogs === 'object' && !Array.isArray(dayLogs))
    ? dayLogs as Record<string, { workoutDraft?: { exercises?: { name?: string; sets?: unknown[] }[] }; workoutSnapshot?: { exercises?: { name?: string; sets?: unknown[] }[] } }>
    : {};

  // У программ бывают общие упражнения, поэтому день отдаём той, чьих
  // упражнений в нём больше: иначе все программы показывают один и тот
  // же период «от первой тренировки до последней».
  const nameSets = items.map(a => new Set(
    (a.workouts || []).flatMap(w => (w.exercises || []).map(e => (e.name || '').trim().toLowerCase())).filter(Boolean),
  ));

  const lines = items.slice(0, 5).map((a, idx) => {
    const days: string[] = [];
    for (const d of Object.keys(logs).sort()) {
      const cand = logs[d]?.workoutDraft ?? logs[d]?.workoutSnapshot;
      const exs = cand?.exercises;
      if (!Array.isArray(exs)) continue;
      const done = exs.filter(e => Array.isArray(e?.sets) && e.sets.length > 0)
        .map(e => (e.name || '').trim().toLowerCase());
      if (done.length === 0) continue;
      const score = done.filter(n => nameSets[idx].has(n)).length;
      if (score === 0) continue;
      // При равном счёте день достаётся более новой программе: архив
      // отсортирован новыми сверху, поэтому проигрываем только тем, кто
      // выше нас по списку, а нижним уступаем лишь при явном перевесе.
      const beaten = nameSets.some((s, j) => {
        if (j === idx) return false;
        const other = done.filter(n => s.has(n)).length;
        return j < idx ? other >= score : other > score;
      });
      if (!beaten) days.push(d);
    }
    // Мало дней — перечисляем их прямо: диапазон «апрель — октябрь» при
    // трёх тренировках вводит в заблуждение, будто занимались полгода.
    const period = days.length === 0
      ? 'тренировок по ней не записано'
      : days.length <= 3
        ? `тренировки: ${days.join(', ')}`
        : `тренировались ${days[0]} — ${days[days.length - 1]}, ${days.length} раз`;
    const when = a.archivedAt ? String(a.archivedAt).slice(0, 10) : '—';
    const count = (a.workouts || []).filter(w => (w.exercises || []).length > 0).length;
    return `  • «${a.label || 'без названия'}» — ${count} трен., заменена ${when}; ${period}`;
  });

  return `Прошлых программ: ${items.length}. Последние:\n${lines.join('\n')}`;
}

/**
 * Лента последних событий: тренировки, записи еды, замеры, смены
 * программы, загрузки анализов — в одном хронологическом списке.
 *
 * Отдельного журнала действий в приложении нет, поэтому собираем ленту
 * из того, что уже хранится. Так ассистент видит, чем человек занимался,
 * и не спрашивает о том, что произошло на днях.
 */
export function buildActivityLog(dayLogs: unknown, archive: unknown, labs: LabRow[], limit = 14): string {
  const events: { date: string; text: string }[] = [];

  if (dayLogs && typeof dayLogs === 'object' && !Array.isArray(dayLogs)) {
    const logs = dayLogs as Record<string, {
      meals?: unknown[];
      steps?: number | null;
      workoutDraft?: { workoutName?: string; exercises?: { name?: string; completed?: boolean; sets?: unknown[] }[] };
      workoutSnapshot?: { workoutName?: string; exercises?: { name?: string; completed?: boolean; sets?: unknown[] }[] };
    }>;
    for (const d of Object.keys(logs)) {
      const log = logs[d];
      const cand = log?.workoutSnapshot ?? log?.workoutDraft;
      const exs = cand?.exercises;
      if (Array.isArray(exs)) {
        const done = exs.filter(e => e?.completed || (Array.isArray(e?.sets) && e.sets.length > 0));
        if (done.length) {
          events.push({ date: d, text: `тренировка «${cand?.workoutName || '—'}»: ${done.length} из ${exs.length} упражнений` });
        }
      }
      if (Array.isArray(log?.meals) && log.meals.length) {
        events.push({ date: d, text: `записана еда: ${log.meals.length} приём(ов)` });
      }
    }
  }

  if (Array.isArray(archive)) {
    for (const a of archive as { label?: string; archivedAt?: string }[]) {
      if (a?.archivedAt) {
        events.push({ date: String(a.archivedAt).slice(0, 10), text: `сменили программу (прежняя «${a.label || '—'}» ушла в историю)` });
      }
    }
  }

  for (const r of labs || []) {
    const d = r.collectedAt instanceof Date ? r.collectedAt.toISOString().slice(0, 10) : String(r.collectedAt).slice(0, 10);
    events.push({ date: d, text: `анализы${r.panelName ? ` «${r.panelName}»` : ''}` });
  }

  if (events.length === 0) return 'Событий пока нет.';
  events.sort((a, b) => (a.date < b.date ? 1 : -1)); // новые сверху
  return events.slice(0, limit).map(e => `  ${e.date} — ${e.text}`).join('\n');
}

type OuraRow = {
  date: string;
  sleepScore: number | null;
  totalSleepMin: number | null;
  deepSleepMin: number | null;
  remSleepMin: number | null;
  readinessScore: number | null;
  restingHr: number | null;
  hrvMs: number | null;
  steps: number | null;
};

/**
 * Сон и восстановление строками по дням плюс средние за период.
 *
 * Средние нужны, чтобы ассистент видел норму человека: пульс покоя 58
 * сам по себе ни о чём не говорит, а «58 при среднем 52» — уже сигнал.
 */
function buildOuraText(rows: unknown): string {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 'Кольцо не подключено или данных пока нет. Не выдумывай цифры сна и пульса — если они нужны для ответа, скажи, что их нет.';
  }
  const list = rows as OuraRow[];

  const hhmm = (min: number | null) =>
    min == null ? '—' : `${Math.floor(min / 60)}ч ${String(min % 60).padStart(2, '0')}м`;
  const avg = (pick: (r: OuraRow) => number | null) => {
    const v = list.map(pick).filter((x): x is number => typeof x === 'number');
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };

  const head = `За ${list.length} дн. в среднем: сон ${hhmm(avg(r => r.totalSleepMin))}, `
    + `оценка сна ${avg(r => r.sleepScore) ?? '—'}, готовность ${avg(r => r.readinessScore) ?? '—'}, `
    + `пульс покоя ${avg(r => r.restingHr) ?? '—'}, ВСР ${avg(r => r.hrvMs) ?? '—'} мс.`;

  const lines = list.slice(0, 10).map(r =>
    `  ${r.date}: сон ${hhmm(r.totalSleepMin)}`
    + (r.sleepScore != null ? ` (оценка ${r.sleepScore})` : '')
    + (r.deepSleepMin != null ? `, глубокий ${hhmm(r.deepSleepMin)}` : '')
    + (r.remSleepMin != null ? `, REM ${hhmm(r.remSleepMin)}` : '')
    + (r.readinessScore != null ? `; готовность ${r.readinessScore}` : '')
    + (r.restingHr != null ? `; пульс покоя ${r.restingHr}` : '')
    + (r.hrvMs != null ? `; ВСР ${r.hrvMs} мс` : '')
    + (r.steps != null ? `; шагов ${r.steps}` : ''));

  return `${head}\n${lines.join('\n')}`;
}

function buildFoodLog(dayLogs: unknown, days = 7): string {
  if (!dayLogs || typeof dayLogs !== 'object' || Array.isArray(dayLogs)) return '—';
  const entries = Object.entries(dayLogs as Record<string, { meals?: unknown; steps?: number | null }>);
  entries.sort((a, b) => (a[0] < b[0] ? 1 : -1)); // новые сверху
  const blocks: string[] = [];
  for (const [date, day] of entries) {
    const meals = Array.isArray(day?.meals) ? (day.meals as Meal[]) : [];
    if (meals.length === 0) continue;
    let kcal = 0, p = 0, f = 0, c = 0;
    const lines = meals.map(m => {
      kcal += m.calories || 0; p += m.protein || 0; f += m.fat || 0; c += m.carbs || 0;
      const t = m.time ? `${m.time} ` : '';
      return `  • ${t}${m.name} — ${m.calories || 0} ккал (Б${m.protein || 0}/Ж${m.fat || 0}/У${m.carbs || 0})`;
    });
    blocks.push(`${date}: ${meals.length} приём(ов), итог ${kcal} ккал (Б${p}/Ж${f}/У${c})\n${lines.join('\n')}`);
    if (blocks.length >= days) break;
  }
  return blocks.length ? blocks.join('\n\n') : 'Еда не записана за последние дни.';
}

type LabMarker = { name?: string; value?: number; unit?: string; refLow?: number | null; refHigh?: number | null; flag?: string };
type LabRow = { panelName?: string | null; lab?: string | null; collectedAt: Date; markers: unknown };

// Человекочитаемая сводка анализов: дата, панель, показатели с пометкой
// отклонений (↓/↑). Чтобы AI мог отвечать «какой у меня холестерин»,
// «что изменилось» и связывать с тренировками/едой.
function buildLabSummary(labs: LabRow[]): string {
  if (!labs || labs.length === 0) return 'Анализы не загружены.';
  const blocks: string[] = [];
  for (const r of labs) {
    const date = r.collectedAt instanceof Date ? r.collectedAt.toISOString().slice(0, 10) : String(r.collectedAt).slice(0, 10);
    const markers = Array.isArray(r.markers) ? (r.markers as LabMarker[]) : [];
    const lines = markers.slice(0, 40).map(m => {
      const ref = (m.refLow != null || m.refHigh != null) ? ` [реф: ${m.refLow ?? '—'}–${m.refHigh ?? '—'}]` : '';
      const mark = m.flag === 'high' ? ' ↑' : m.flag === 'low' ? ' ↓' : '';
      return `  • ${m.name}: ${m.value} ${m.unit || ''}${ref}${mark}`.trimEnd();
    });
    const title = [date, r.panelName, r.lab].filter(Boolean).join(' · ');
    blocks.push(`${title}\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const userId = session.user.id;

  const limit = await rateLimit(userId, 'chat');
  if (!limit.ok) return rateLimitResponse(limit);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Anthropic API key not configured' }), { status: 500 });
  }

  const { message, image, images, files } = await request.json();

  // Вложения опциональны, их может быть несколько. Старые поля `image` и
  // `images` продолжаем принимать: у пользователя может быть открыта
  // вкладка со старой версией страницы.
  type Attachment = { name?: string; data: string };
  const incomingRaw: Attachment[] = Array.isArray(files)
    ? (files as unknown[]).filter((f): f is Attachment =>
        !!f && typeof f === 'object' && typeof (f as Attachment).data === 'string')
    : (Array.isArray(images) ? images : (typeof image === 'string' ? [image] : []))
        .filter((x): x is string => typeof x === 'string')
        .map((data) => ({ data }));

  const MAX_FILES = 4;
  const incoming = incomingRaw.slice(0, MAX_FILES);

  // Что модель умеет читать: картинки, PDF и обычный текст. Всё прочее
  // отправлять бессмысленно — вместо ответа пришла бы ошибка API.
  const attBlocks: Anthropic.ContentBlockParam[] = [];
  const rejected: string[] = [];

  for (const f of incoming) {
    const src = f.data;
    const label = (f.name || 'файл').slice(0, 80);

    const img = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(src);
    if (img) {
      const mediaType = (img[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : img[1].toLowerCase()) as
        'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
      attBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: img[2] } });
      continue;
    }

    const pdf = /^data:application\/pdf;base64,(.+)$/i.exec(src);
    if (pdf) {
      attBlocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdf[1] },
        title: label,
      });
      continue;
    }

    // Текстовые файлы (csv, txt, json, md…) вставляем прямо в сообщение.
    const txt = /^data:text\/[^;]+;base64,(.+)$/i.exec(src)
      || /^data:application\/json;base64,(.+)$/i.exec(src);
    if (txt) {
      let decoded = '';
      try { decoded = Buffer.from(txt[1], 'base64').toString('utf8').slice(0, 20000); } catch { decoded = ''; }
      if (decoded.trim()) {
        attBlocks.push({ type: 'text', text: `Содержимое файла «${label}»:\n\n${decoded}` });
        continue;
      }
    }

    rejected.push(label);
  }

  if ((!message || typeof message !== 'string' || !message.trim()) && attBlocks.length === 0) {
    // Файлы прислали, но прочитать нечего — объясняем, а не падаем.
    if (rejected.length) {
      return new Response(JSON.stringify({ error: 'unsupported_file', files: rejected }), { status: 415 });
    }
    return new Response(JSON.stringify({ error: 'no_message' }), { status: 400 });
  }

  const hasImg = attBlocks.some((b) => b.type === 'image');
  const text = (typeof message === 'string' ? message.trim() : '')
    || (attBlocks.length > 1 ? 'Посмотри на эти файлы.' : hasImg ? 'Посмотри на это фото.' : 'Посмотри на этот файл.');

  // --- собираем данные пользователя + историю чата + анализы ---
  const [user, fitness, history, oura, labs, mergedDayLogs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true, lastName: true, name: true, language: true, timezone: true,
        birthYear: true, heightCm: true, sex: true,
        goalProtein: true, goalFat: true, goalCarbs: true, goalCalories: true,
        program: { select: { nutritionRecommendations: true } },
      },
    }),
    prisma.fitnessData.findUnique({
      where: { userId },
      select: {
        workouts: true, dayLogs: true, progressHistory: true,
        bodyMeasurements: true, habits: true,
        // Нужен, чтобы ассистент знал, откуда взялась текущая программа
        // и что было до неё: без этого он не отличает программу, которую
        // сам же составил, от заданной тренером или собранной вручную.
        programArchive: true,
        updatedAt: true,
      },
    }),
    // ПОСЛЕДНИЕ сообщения диалога. Здесь был orderBy 'asc' + take, то есть
    // брались ПЕРВЫЕ 30 сообщений за всю историю: при 134 сообщениях модель
    // видела переписку трёхмесячной давности и ничего из текущего разговора.
    // Отсюда и повторные вопросы о том, что пользователь уже ответил.
    // Сортируем по убыванию, берём свежие, а порядок восстанавливаем ниже.
    prisma.chatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { role: true, content: true, createdAt: true },
    }),
    // Сон и восстановление из кольца Oura, если оно подключено.
    prisma.ouraDaily.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 14,
    }),
    prisma.labResult.findMany({
      where: { userId },
      orderBy: { collectedAt: 'desc' },
      take: 12, // последние результаты анализов
      select: { panelName: true, lab: true, collectedAt: true, markers: true },
    }),
    // Точные dayLogs: блоб + построчные записи (веса из колонки в UI живут
    // в WorkoutLogEntry и до блоба доезжают позже — без merge их не видно).
    getMergedDayLogs(prisma, userId),
  ]);

  const displayName = user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Пользователь';

  // Компактная сводка данных юзера для модели.
  // «Сегодня» в таймзоне пользователя (как клиент сохраняет даты), не в UTC —
  // иначе ночью модель неверно считает «вчера/сегодня».
  const tz = user?.timezone || 'Europe/Moscow';
  let todayIso: string;
  try {
    todayIso = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  } catch {
    todayIso = new Date().toISOString().slice(0, 10);
  }
  // «О себе» + текущий вес из последнего замера — без этого модель не знает
  // возраст/рост/пол и не может считать нормы.
  const age = user?.birthYear ? Math.max(0, new Date().getFullYear() - user.birthYear) : null;
  const bms = Array.isArray(fitness?.bodyMeasurements) ? (fitness?.bodyMeasurements as { date?: string; weight?: number }[]) : [];
  const lastWeighIn = [...bms].reverse().find(b => b && typeof b.weight === 'number' && b.weight > 0);

  /**
   * Откуда взялась действующая программа.
   *
   * Ассистент не отличал программу, которую сам же предложил, от
   * заданной тренером или собранной вручную — и переспрашивал «а какая
   * у тебя программа?». Отметку о принятии он уже пишет в чат при
   * подтверждении, поэтому достаточно найти последнюю.
   */
  const acceptedNote = [...history]
    .reverse()
    .find(m => m.role === 'assistant' && /Программа принята и уже действует/.test(m.content || ''));
  const programOrigin = acceptedNote
    ? `(Эту программу предложил ты, пользователь принял её ${acceptedNote.createdAt.toISOString().slice(0, 10)} — она уже действует. Не предлагай составить новую, пока не попросят.)`
    : (Array.isArray(fitness?.programArchive) && fitness.programArchive.length > 0
      ? '(Программу меняли; кто её составил — в переписке не отмечено. Если это важно для ответа, спроси.)'
      : '(Программа заведена до начала этой переписки — её мог задать тренер или собрать сам пользователь. Не приписывай её себе.)');

  // Даты, за которые еда реально записана. Нужны в промпте явным списком:
  // модель ставила карточку на дату без записей (например, назвала «вчера»
  // день из прошлого сезона), карточка выходила пустой, и модель объясняла
  // это «технической проблемой приложения».
  const foodDates = Object.entries(
    (mergedDayLogs as Record<string, { meals?: unknown }>) || {}
  )
    .filter(([, day]) => Array.isArray(day?.meals) && (day.meals as unknown[]).length > 0)
    .map(([date]) => date)
    .sort()
    .reverse()
    .slice(0, 14);

  const userContext = `ДАННЫЕ ПОЛЬЗОВАТЕЛЯ (${displayName})
СЕГОДНЯ: ${todayIso} (таймзона ${tz}; используй для подсчётов «сколько дней назад», «вчера», «на этой неделе»)

О ПОЛЬЗОВАТЕЛЕ:
- Возраст: ${age ? `${age} лет (год рождения ${user?.birthYear})` : 'не указан'}
- Рост: ${user?.heightCm ? `${user.heightCm} см` : 'не указан'}
- Пол: ${user?.sex === 'm' ? 'мужской' : user?.sex === 'f' ? 'женский' : 'не указан'}
- Текущий вес: ${lastWeighIn ? `${lastWeighIn.weight} (последний замер ${lastWeighIn.date || ''})` : 'нет замеров веса'}
(Если возраст/рост/пол не указаны и это важно для ответа — скажи, что их можно заполнить в Настройках, раздел «О себе».)

🎯 ЦЕЛИ ПО МАКРОСАМ (в день):
- Белок: ${user?.goalProtein ?? '—'} г
- Жиры: ${user?.goalFat ?? '—'} г
- Углеводы: ${user?.goalCarbs ?? '—'} г
- Калории: ${user?.goalCalories ?? '—'} ккал

🏋️ ИСТОРИЯ ТРЕНИРОВОК (когда и что делал; у свежих дней — рабочие подходы «вес×повторы», веса пользователь вводит в колонке весов):
${buildWorkoutHistory(mergedDayLogs, 60)}

💍 СОН И ВОССТАНОВЛЕНИЕ (кольцо Oura; связывай с результатами в зале — застой в весах часто идёт от недосыпа, а не от программы):
${buildOuraText(oura)}

📋 ДЕЙСТВУЮЩАЯ ПРОГРАММА (это текущие тренировки пользователя — на вопросы «сколько дней», «что в программе» отвечай по ней):
${programOrigin}
${buildProgramText(fitness?.workouts)}

🗂 ИСТОРИЯ ПРОГРАММ (что было раньше; вернуть любую можно на экране «Программа»):
${buildProgramHistory(fitness?.programArchive, mergedDayLogs)}

🕒 ЧТО ПРОИСХОДИЛО В ПРИЛОЖЕНИИ (последние события — по ним понятно, чем пользователь занимался):
${buildActivityLog(mergedDayLogs, fitness?.programArchive, labs)}

🍽️ ЕДА (дневник по дням, новые сверху; если сегодняшней даты нет — за сегодня еда не записана):
${buildFoodLog(mergedDayLogs, 7)}

ДАТЫ С ЗАПИСАННОЙ ЕДОЙ (только на них имеет смысл карточка [[card:macros:ДАТА]]):
${foodDates.length ? foodDates.join(', ') : 'нет ни одной'}

📅 ДЕТАЛИ ПОСЛЕДНИХ ДНЕЙ (шаги и пр.):
${compactJson(recentByDate(mergedDayLogs, 3), 2000)}

📈 ПРОГРЕСС ПО УПРАЖНЕНИЯМ:
${compactJson(fitness?.progressHistory, 1500)}

📏 ЗАМЕРЫ ТЕЛА (вес, талия и т.д.):
${compactJson(fitness?.bodyMeasurements, 1500)}

✅ ПРИВЫЧКИ:
${compactJson(fitness?.habits, 800)}

🎯 РЕКОМЕНДАЦИИ ТРЕНЕРА:
${compactJson(user?.program?.nutritionRecommendations, 1500)}

🩸 АНАЛИЗЫ (последние результаты; ↓ ниже нормы, ↑ выше нормы):
${buildLabSummary(labs as LabRow[])}`;

  // Сохраняем сообщение пользователя сразу. В текст идёт только пометка,
  // сами файлы — отдельной таблицей, чтобы к ним можно было вернуться.
  const attNote = attBlocks.length === 0 ? ''
    : attBlocks.length === 1 ? '\n📎 [вложение]'
    : `\n📎 [вложений: ${attBlocks.length}]`;
  const savedContent = (text + attNote).trim();
  const savedMessage = await prisma.chatMessage.create({
    data: { userId, role: 'user', content: savedContent },
  });

  // Файлы кладём в хранилище чата: раньше они жили только в запросе к
  // модели и после отправки исчезали — вернуться к присланному анализу
  // было невозможно.
  if (incoming.length > 0) {
    const rows = incoming
      .map((f) => {
        const m = /^data:([^;,]+)[;,]/.exec(f.data);
        const mimeType = m ? m[1] : 'application/octet-stream';
        const comma = f.data.indexOf(',');
        const size = comma >= 0 ? Math.floor((f.data.length - comma - 1) * 0.75) : 0;
        return {
          userId,
          messageId: savedMessage.id,
          name: (f.name || 'файл').slice(0, 200),
          mimeType: mimeType.slice(0, 100),
          size,
          data: f.data,
        };
      });
    // Падение записи не должно ронять ответ: сообщение уже сохранено,
    // модель уже получила файлы — потеряем только возможность открыть их.
    await prisma.chatAttachment.createMany({ data: rows }).catch(async (err) => {
      await trackError({
        route: '/api/chat', method: 'POST',
        error: 'failed to store chat attachments',
        details: err instanceof Error ? err.message : String(err),
        userId,
      });
    });
  }

  // Новое сообщение: вложения (сколько прислали) + текст.
  const lastContent: Anthropic.ContentBlockParam[] = [];
  for (const b of attBlocks) lastContent.push(b);
  // Про нечитаемые файлы говорим честно, чтобы модель не делала вид,
  // будто видела их содержимое.
  const note = rejected.length
    ? `\n\n(Файлы, которые не удалось прочитать: ${rejected.join(', ')}. Скажи пользователю, что такой формат не поддерживается — подойдут фото, PDF или текстовый файл.)`
    : '';
  lastContent.push({ type: 'text', text: text + note });

  // Собираем messages: контекст данных + история + новое сообщение.
  // Кэшируем system; данные/история идут после, не инвалидируя кэш.
  const messages: Anthropic.MessageParam[] = [
    /**
     * Контекст данных кэшируем.
     *
     * Он меняется от силы раз в день (тренировка, еда, анализы), а
     * уезжает заново в КАЖДОМ сообщении — при активной переписке это
     * десятки тысяч входных токенов на ровном месте. Кэш живёт пять
     * минут, то есть всю сессию разговора.
     */
    {
      role: 'user',
      content: [{
        type: 'text',
        text: `[Контекст моих данных на сейчас]\n${userContext}`,
        cache_control: { type: 'ephemeral' },
      }],
    },
    { role: 'assistant', content: 'Понял, я вижу твои данные. Чем помочь?' },
    // История пришла новыми сверху — возвращаем хронологический порядок.
    // Окно могло начаться с ответа ассистента (реплика пользователя не
    // попала), а пустое содержимое API не принимает — отсекаем и то, и то.
    ...(() => {
      const ordered = [...history].reverse()
        .filter((m) => (m.content || '').trim().length > 0);
      while (ordered.length && ordered[0].role !== 'user') ordered.shift();
      return ordered.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    })(),
    { role: 'user', content: lastContent },
  ];

/**
 * Инструмент: собрать новую программу тренировок.
 *
 * Модель НЕ меняет программу сама — она готовит предложение, а
 * заменяет его пользователь кнопкой. Так старая программа уходит в
 * архив тем же путём, что и при генерации с экрана «Программа»:
 * одна дорога, один архив, возврат работает одинаково.
 */
/**
 * Правка ОДНОЙ тренировки, в отличие от замены всей программы.
 *
 * «Замени жим на гантели», «добавь подход», «подними вес» — менять ради
 * этого программу целиком неправильно: потеряется всё остальное и
 * архив наполнится мусором. Модель присылает тренировку в новом виде,
 * применяет её пользователь кнопкой.
 */
const EDIT_WORKOUT_TOOL: Anthropic.Tool = {
  name: 'edit_workout',
  description:
    'Изменить ОДНУ тренировку текущей программы: заменить упражнение, добавить или убрать, ' +
    'поменять подходы, вес, отдых, пометки о технике. Вызывай, когда пользователь просит ' +
    'поправить конкретное упражнение или тренировку — а не собрать программу заново. ' +
    'Изменения НЕ применяются сразу: пользователь увидит, что меняется, и подтвердит кнопкой. ' +
    'Присылай тренировку ЦЕЛИКОМ в новом виде, включая упражнения, которые не меняются.',
  input_schema: {
    type: 'object',
    properties: {
      workoutId: {
        type: 'string',
        description: 'id тренировки из раздела ДЕЙСТВУЮЩАЯ ПРОГРАММА: t1, t2, t3…',
      },
      summary: {
        type: 'string',
        description: 'Одной фразой, что меняется и почему: «Жим штанги → гантели: убрать нагрузку с плеча»',
      },
      exercises: {
        type: 'array',
        description: 'Тренировка целиком после правки, в нужном порядке',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Название упражнения по-русски' },
            plannedSets: { type: 'string', description: 'План: «80кг 3x8-10» или «3x12»' },
            restTime: { type: 'string', description: 'Отдых: «2-3 мин»' },
            notes: { type: 'string', description: 'Короткая приписка: группа мышц или техника' },
            supersetId: { type: 'string', description: 'Метка суперсета («A»), одинаковая у упражнений связки; иначе пустая строка' },
          },
          required: ['name', 'plannedSets', 'restTime', 'notes'],
        },
      },
    },
    required: ['workoutId', 'summary', 'exercises'],
  },
};

const PROGRAM_TOOL: Anthropic.Tool = {
  name: 'propose_program',
  description:
    'Собрать новую программу тренировок на замену текущей. Вызывай, когда пользователь просит ' +
    'обновить, поменять, составить программу или тренировки. Программа НЕ применяется сразу: ' +
    'пользователь увидит её в чате и заменит кнопкой, старая уйдёт в архив. ' +
    'Перед вызовом спроси, нужен ли продвинутый режим (суперсеты, дропсеты, работа до отказа) ' +
    'или стандартный — если он ещё не сказал.',
  input_schema: {
    type: 'object',
    properties: {
      rationale: {
        type: 'string',
        description: 'Коротко (2-4 предложения): что за сплит и почему это следующий шаг для пользователя',
      },
      advanced: {
        type: 'boolean',
        description: 'true — продвинутый режим с суперсетами, дропсетами и работой до отказа; false — обычные прямые подходы',
      },
      workouts: {
        type: 'array',
        description: 'Тренировки программы, по числу дней в неделю',
        items: {
          type: 'object',
          properties: {
            focus: { type: 'string', description: 'Фокус дня: «Грудь + трицепс», «Ноги»…' },
            exercises: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Название упражнения по-русски' },
                  plannedSets: { type: 'string', description: 'План: «40кг 3x10-12» или «3x15»; опирайся на рабочие веса пользователя' },
                  restTime: { type: 'string', description: 'Отдых: «2-3 мин»' },
                  notes: { type: 'string', description: 'Короткая приписка: группа мышц или техника' },
                  supersetId: { type: 'string', description: 'Только в продвинутом режиме: одинаковая метка («A», «B») у двух упражнений связки, идущих подряд. Иначе пустая строка.' },
                  toFailure: { type: 'boolean', description: 'Только в продвинутом режиме: последний подход до отказа' },
                  dropSet: { type: 'boolean', description: 'Только в продвинутом режиме: последний подход дропсетом' },
                },
                required: ['name', 'plannedSets', 'restTime', 'notes'],
              },
            },
          },
          required: ['focus', 'exercises'],
        },
      },
    },
    required: ['rationale', 'advanced', 'workouts'],
  },
};

  // Разделитель между текстом ответа и данными предложения: текст
  // стримится как есть, а служебная часть идёт одной строкой в конце.
  const PROPOSAL_MARKER = '\u0000PROPOSAL\u0000';
  // Подпись к индикатору «ИИ думает»: короткая строка о том, что сейчас
  // происходит. Идёт в том же потоке, в парных маркерах — закрывающий
  // обязателен, иначе подпись «съела» бы весь последующий текст.
  const STAGE_MARKER = '\u0000STAGE\u0000';
  const STAGE_END = '\u0000/STAGE\u0000';

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();
  let assistantText = '';

  const stream = new ReadableStream({
    async start(controller) {
      /**
       * Отправка в поток, переживающая уход пользователя.
       *
       * Закрыл экран или свернул приложение — соединение рвётся, и
       * enqueue бросает ошибку. Раньше она уводила выполнение в catch, и
       * ответ не дописывался и не сохранялся: вернувшись, пользователь
       * не находил ни ответа, ни собранной программы. Теперь обрыв
       * просто прекращает отправку, а работа идёт до конца — результат
       * всё равно ляжет в историю.
       */
      let clientGone = false;
      const push = (text: string) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          clientGone = true;
        }
      };

      try {
        const llmStream = client.messages.stream({
          model: 'claude-sonnet-4-6',
          // Программа — это десятки упражнений, в 1500 токенов она не
          // поместится и оборвётся на середине.
          max_tokens: 8000,
          system: trainxSystem(CHAT_SYSTEM),
          tools: [PROGRAM_TOOL, EDIT_WORKOUT_TOOL],
          messages,
        });

        for await (const event of llmStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const chunk = event.delta.text;
            assistantText += chunk;
            push(chunk);
          }
          // Модель начала собирать программу. Сообщаем сразу: сборка
          // занимает секунд пятнадцать, и всё это время клиенту нечего
          // показать — без сигнала экран выглядит зависшим.
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
            push(STAGE_MARKER + 'Собираю программу' + STAGE_END);
          }
        }

        const final = await llmStream.finalMessage();

        // Модель собрала программу — отдаём её клиенту отдельной
        // строкой после текста. Применит её пользователь кнопкой.
        const toolUse = final.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'propose_program',
        );
        if (toolUse) {
          const payload = JSON.stringify({ type: 'program_proposal', data: toolUse.input });
          push(PROPOSAL_MARKER + payload);
          // В историю кладём пометку: сама программа туда не нужна
          // (длинная), но без следа модель в следующем сообщении не
          // вспомнит, что уже составила её и ждёт решения.
          const input = toolUse.input as {
            workouts?: { focus?: string; exercises?: { name?: string }[] }[];
            advanced?: boolean;
          };
          const list = Array.isArray(input.workouts) ? input.workouts : [];
          // Кладём и состав: без него на просьбу «сделай 4 дня вместо 3»
          // модель не знает, что правит, и начинает опрос заново.
          const composition = list
            .map((w, i) => `Т${i + 1} (${w.focus || '—'}): ${(w.exercises || []).map(e => e.name).filter(Boolean).join(', ')}`)
            .join('; ');
          assistantText += `${assistantText.trim() ? '\n\n' : ''}[Собрал новую программу: ${list.length} трен., ${input.advanced ? 'продвинутая' : 'стандартная'}. Состав — ${composition}. Пользователь решает, заменять ли.]`;
        }

        // Правка одной тренировки — тот же путь: показываем, что
        // меняется, применяет пользователь кнопкой.
        const editUse = final.content.find(
          (bl): bl is Anthropic.ToolUseBlock => bl.type === 'tool_use' && bl.name === 'edit_workout',
        );
        if (editUse) {
          push(PROPOSAL_MARKER + JSON.stringify({ type: 'workout_edit', data: editUse.input }));
          const input = editUse.input as { workoutId?: string; summary?: string };
          assistantText += `${assistantText.trim() ? '\n\n' : ''}[Подготовил правку тренировки ${input.workoutId || ''}: ${input.summary || ''}. Пользователь решает, применять ли.]`;
        }

        if (final.stop_reason === 'refusal') {
          const note = '\n\n(Не могу ответить на этот запрос.)';
          assistantText += note;
          push(note);
        }
      } catch (err) {
        await trackError({
          route: '/api/chat', method: 'POST',
          error: 'AI chat failed',
          details: err instanceof Error ? err.message : String(err),
          userId,
        });
        const note = '\n\n(Произошла ошибка, попробуйте ещё раз.)';
        assistantText += note;
        push(note);
      } finally {
        // Сохраняем ответ ассистента в историю.
        if (assistantText.trim()) {
          await prisma.chatMessage.create({ data: { userId, role: 'assistant', content: assistantText } });
        }
        try { controller.close(); } catch { /* клиент уже ушёл */ }
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Загрузка истории чата для UI.
/**
 * Отметка о решении пользователя по предложенной программе.
 *
 * Без неё модель видела в истории только «собрал программу, пользователь
 * решает» и при следующем вопросе предлагала составить ещё раз — хотя
 * программа уже была принята и работает.
 */
export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const body = await request.json().catch(() => ({}));
  const accepted = body?.accepted === true;
  const days = Number(body?.days) || 0;
  const edit = typeof body?.edit === 'string' ? body.edit.slice(0, 200) : '';

  // Правка одной тренировки — отдельная отметка: это не смена программы.
  if (edit) {
    await prisma.chatMessage.create({
      data: {
        userId: session.user.id,
        role: 'assistant',
        content: accepted
          ? `Тренировка обновлена: ${edit}`
          : `Правка отклонена: ${edit}`,
      },
    });
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Отметку видит и пользователь в чате, и модель в истории — поэтому
  // пишем её обычными словами, а не служебной строкой в скобках.
  const note = accepted
    ? `Программа принята и уже действует${days ? ` — ${days} ${days === 1 ? 'тренировка' : days < 5 ? 'тренировки' : 'тренировок'} в неделю` : ''}. Старая ушла в историю программ, её можно вернуть.`
    : 'Программа отклонена — осталась прежняя.';

  await prisma.chatMessage.create({
    data: { userId: session.user.id, role: 'assistant', content: note },
  });
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const messages = await prisma.chatMessage.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return new Response(JSON.stringify({ messages }), { headers: { 'Content-Type': 'application/json' } });
}

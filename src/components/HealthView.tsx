'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { MoveHorizontal, Heart, Plus, CircleDot, Moon, Waves, ChevronDown, MoreHorizontal, ArrowRight } from 'lucide-react';
import { TxDialog } from './TxDialog';
import {
  type BodyMeasurement, type CheckinField, type CheckinEntry, type MedCourse, type MedLog, type VitalEntry,
  SCALE_LABELS, SYMPTOM_PRESETS, newId,
} from '@/lib/health-types';

/**
 * Раздел «Здоровье» (бывшие «Замеры») по макету редизайна: вкладки
 * Обзор · Что принимаю · Журнал. Данные прежние — замеры тела, показатели
 * (давление, SpO₂, состав тела, симптомы), самонаблюдение и препараты;
 * здесь только другая подача: быстрые записи плитками и общий журнал.
 */

type Kind = 'weight' | 'body' | 'vitals' | 'metric' | 'mood' | 'sleep' | 'symptom' | 'intake';
type Tab = 'overview' | 'meds' | 'journal';

const KIND_NAMES: Record<Kind, string> = {
  weight: 'Вес', body: 'Объёмы тела', vitals: 'Давление и пульс', metric: 'Показатель',
  mood: 'Самочувствие', sleep: 'Сон', symptom: 'Симптом', intake: 'Приём / инъекция',
};
const DIALOG_TITLES: Record<Kind, string> = {
  weight: 'Записать вес', body: 'Объёмы тела', vitals: 'Давление и пульс', metric: 'Показатель',
  mood: 'Самочувствие', sleep: 'Записать сон', symptom: 'Записать симптом', intake: 'Приём или инъекция',
};

const ZONES: [keyof BodyMeasurement, string][] = [
  ['waist', 'Талия'], ['chest', 'Грудь'], ['hips', 'Бёдра (таз)'],
  ['thighs', 'Бедро'], ['bicepsLeft', 'Бицепс левый'], ['bicepsRight', 'Бицепс правый'],
];
const VITAL_TAGS = ['до тренировки', 'после тренировки', 'левая рука', 'правая рука', 'сидя', 'лёжа', 'утро', 'вечер'];
const METRICS: { key: string; name: string; unit: string }[] = [
  { key: 'temp', name: 'Температура', unit: '°C' },
  { key: 'glucose', name: 'Глюкоза', unit: 'мг/дл' },
  { key: 'spo2', name: 'SpO₂', unit: '%' },
  { key: 'pulse', name: 'Пульс в покое', unit: 'уд/мин' },
  { key: 'fat', name: 'Жир (состав тела)', unit: '%' },
  { key: 'custom', name: 'Свой показатель', unit: '' },
];
const SLEEP_QUALITY = ['Выспался', 'Средне', 'Плохо'];
const SEVERITY = ['Лёгкая', 'Умеренная', 'Сильная'];
const MED_FORMS = ['Таблетка', 'Капсула', 'Укол', 'Капли', 'Порошок', 'Добавка'];
const WEEK_DAYS: [number, string][] = [[1, 'пн'], [2, 'вт'], [3, 'ср'], [4, 'чт'], [5, 'пт'], [6, 'сб'], [7, 'вс']];
const PAGE = 8;

const pad = (n: number) => String(n).padStart(2, '0');
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDay = (d: Date, year = false) => d
  .toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) })
  .replace(/\s*г\.$/, '');
/** День из YYYY-MM-DD (самонаблюдение, курсы) — без сдвига поясов. */
const dayOf = (ymd: string, year = false) => fmtDay(new Date(ymd.slice(0, 10) + 'T12:00:00'), year);
/**
 * День замера тела. Дата замера — ISO-момент; показываем по местному
 * времени, как график веса и остальное приложение.
 */
const measureDay = (iso: string, year = false) => fmtDay(new Date(iso), year);
/** Выбранный в форме день → местный полдень: так день не уезжает при смене пояса. */
const noonIso = (ymd: string) => new Date(`${ymd}T12:00:00`).toISOString();
const num = (s: string | undefined) => { const n = parseFloat((s ?? '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const comma = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
/** Локальные дата и время из формы → ISO-момент. */
const isoAt = (date: string, time: string) => new Date(`${date}T${time || '12:00'}:00`).toISOString();

interface JournalItem {
  key: string;
  kind: Kind;
  ts: number;
  when: string;
  value: string;
  details: string[];
  tone?: 'out';
  onDelete: () => void;
  onEdit?: () => void;
}

type Removed =
  | { type: 'measure'; item: BodyMeasurement }
  | { type: 'vital'; item: VitalEntry }
  | { type: 'checkin'; item: CheckinEntry }
  | { type: 'medlog'; item: MedLog };

export function HealthView({
  today, measurements, vitals, checkinFields, checkinEntries, medCourses, medLogs,
  onSaveMeasurement, onDeleteMeasurement, onEditMeasurement, onSaveVitals, onSaveCheckins, onSaveMeds,
}: {
  /** Сегодня в часовом поясе пользователя, YYYY-MM-DD. */
  today: string;
  measurements: BodyMeasurement[];
  vitals: VitalEntry[];
  checkinFields: CheckinField[];
  checkinEntries: CheckinEntry[];
  medCourses: MedCourse[];
  medLogs: MedLog[];
  onSaveMeasurement: (m: BodyMeasurement) => void;
  onDeleteMeasurement: (id: string) => void;
  /** Полная правка замера в прежнем окне (все объёмы сразу). */
  onEditMeasurement: (m: BodyMeasurement) => void;
  onSaveVitals: (next: VitalEntry[]) => void;
  onSaveCheckins: (fields: CheckinField[], entries: CheckinEntry[]) => void;
  onSaveMeds: (courses: MedCourse[], logs: MedLog[]) => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [filter, setFilter] = useState<'all' | Kind>('all');
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<Kind | null>(null);
  const [medEdit, setMedEdit] = useState<{ course?: MedCourse } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [days, setDays] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [removed, setRemoved] = useState<Removed | null>(null);

  const set = (k: string, v: string) => setDraft(d => ({ ...d, [k]: v }));
  const activeCourses = medCourses.filter(c => !c.endedAt);
  const finishedCourses = medCourses.filter(c => c.endedAt);

  // ---------- Вес ----------
  const weights = useMemo(() => measurements
    .filter(m => typeof m.weight === 'number' && m.weight > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date)), [measurements]);
  const lastWeight = weights[weights.length - 1];

  // ---------- Журнал: все записи одним списком ----------
  const fieldById = useMemo(() => new Map(checkinFields.map(f => [f.id, f])), [checkinFields]);
  const courseById = useMemo(() => new Map(medCourses.map(c => [c.id, c])), [medCourses]);

  const journal = useMemo<JournalItem[]>(() => {
    const items: JournalItem[] = [];
    const noon = (ymd: string) => new Date(ymd.slice(0, 10) + 'T12:00:00').getTime();
    const clock = (iso: string) => { const d = new Date(iso); return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · ${localTime(d)}`; };

    for (const m of measurements) {
      const zones = ZONES.filter(([k]) => typeof m[k] === 'number' && (m[k] as number) > 0)
        .map(([k, label]) => `${label} ${comma(m[k] as number)} см`);
      if (m.biceps && !m.bicepsLeft && !m.bicepsRight) zones.push(`Бицепс ${comma(m.biceps)} см`);
      const hasWeight = typeof m.weight === 'number' && m.weight > 0;
      if (!hasWeight && zones.length === 0 && !m.notes) continue;
      items.push({
        key: 'm' + m.id,
        kind: hasWeight ? 'weight' : 'body',
        ts: new Date(m.date).getTime(),
        when: measureDay(m.date, true),
        value: hasWeight ? `${comma(m.weight!)} кг` : zones[0] ?? 'Заметка',
        details: [...(hasWeight ? zones : zones.slice(1)), ...(m.notes ? [m.notes] : [])],
        onDelete: () => { onDeleteMeasurement(m.id); setRemoved({ type: 'measure', item: m }); },
        onEdit: () => onEditMeasurement(m),
      });
    }

    for (const v of vitals) {
      let kind: Kind = 'metric';
      let value = '';
      let tone: 'out' | undefined;
      const extra: string[] = [];
      if (v.symptom) {
        kind = 'symptom';
        value = v.symptom;
      } else if (v.systolic !== undefined && v.diastolic !== undefined) {
        kind = 'vitals';
        value = `${v.systolic}/${v.diastolic}${v.pulse !== undefined ? ` · ♥ ${v.pulse}` : ''}`;
        if (v.systolic >= 140 || v.diastolic >= 90) tone = 'out';
        if (v.spo2 !== undefined) extra.push(`SpO₂ ${v.spo2}%`);
      } else if (v.customName === 'Сон' && v.customValue !== undefined) {
        kind = 'sleep';
        value = `${comma(v.customValue)} ч`;
      } else {
        const parts: string[] = [];
        if (v.spo2 !== undefined) { parts.push(`SpO₂ ${v.spo2}%`); if (v.spo2 < 94) tone = 'out'; }
        if (v.pulse !== undefined) parts.push(`♥ ${v.pulse}`);
        if (v.fatPct !== undefined) parts.push(`жир ${comma(v.fatPct)}%`);
        if (v.customValue !== undefined) parts.push(`${v.customName || 'показатель'}: ${comma(v.customValue)}${v.customUnit ? ' ' + v.customUnit : ''}`);
        value = parts.join(' · ') || '—';
      }
      items.push({
        key: 'v' + v.id,
        kind,
        ts: new Date(v.at).getTime(),
        when: clock(v.at),
        value,
        tone,
        details: [...extra, ...(v.tags.length ? [v.tags.join(', ')] : []), ...(v.note ? [v.note] : [])],
        onDelete: () => { onSaveVitals(vitals.filter(x => x.id !== v.id)); setRemoved({ type: 'vital', item: v }); },
      });
    }

    for (const e of checkinEntries) {
      const parts = Object.entries(e.values).map(([fid, val]) => {
        const f = fieldById.get(fid);
        if (!f) return null;
        const shown = f.kind === 'scale' ? ((f.labels ?? SCALE_LABELS)[Number(val)] ?? String(val))
          : f.kind === 'yesno' ? (val ? 'да' : 'нет')
          : `${val}${f.unit ? ' ' + f.unit : ''}`;
        return `${f.name}: ${shown}`;
      }).filter(Boolean) as string[];
      if (parts.length === 0 && !e.note) continue;
      items.push({
        key: 'c' + e.id,
        kind: 'mood',
        ts: noon(e.date),
        when: dayOf(e.date, true),
        value: parts[0] ?? 'Заметка',
        details: [...parts.slice(1), ...(e.note ? [e.note] : [])],
        onDelete: () => {
          onSaveCheckins(checkinFields, checkinEntries.filter(x => x.id !== e.id));
          setRemoved({ type: 'checkin', item: e });
        },
      });
    }

    for (const l of medLogs) {
      const c = courseById.get(l.courseId);
      items.push({
        key: 'l' + l.id,
        kind: 'intake',
        ts: new Date(l.at).getTime(),
        when: clock(l.at),
        value: `${c?.name ?? 'Препарат'}${l.dose ? ' · ' + l.dose : ''}`,
        details: [...(c?.form ? [c.form] : []), ...(l.note ? [l.note] : [])],
        onDelete: () => { onSaveMeds(medCourses, medLogs.filter(x => x.id !== l.id)); setRemoved({ type: 'medlog', item: l }); },
      });
    }
    return items.sort((a, b) => b.ts - a.ts);
  }, [measurements, vitals, checkinEntries, checkinFields, medLogs, medCourses, fieldById, courseById,
    onDeleteMeasurement, onEditMeasurement, onSaveVitals, onSaveCheckins, onSaveMeds]);

  const visible = filter === 'all' ? journal : journal.filter(i => i.kind === filter);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const pageNow = Math.min(page, pages - 1);

  const undo = () => {
    if (!removed) return;
    if (removed.type === 'measure') onSaveMeasurement(removed.item);
    if (removed.type === 'vital') onSaveVitals([removed.item, ...vitals]);
    if (removed.type === 'checkin') onSaveCheckins(checkinFields, [...checkinEntries, removed.item].sort((a, b) => a.date.localeCompare(b.date)));
    if (removed.type === 'medlog') onSaveMeds(medCourses, [...medLogs, removed.item]);
    setRemoved(null);
  };

  // ---------- Окна записи ----------
  const openRecord = (kind: Kind, course?: MedCourse) => {
    const now = new Date();
    setDraft({
      date: today, time: localTime(now), metric: 'temp', unit: '°C',
      quality: SLEEP_QUALITY[0], severity: SEVERITY[0],
      courseId: course?.id ?? activeCourses[0]?.id ?? 'new', dose: course?.dose ?? activeCourses[0]?.dose ?? '',
    });
    setTags([]);
    setError('');
    setDialog(kind);
  };

  const finishRecord = () => {
    setDialog(null);
    setTab('journal');
    setFilter('all');
    setPage(0);
    setRemoved(null);
  };

  const submitRecord = (kind: Kind) => {
    const note = (draft.note ?? '').trim() || undefined;
    const at = isoAt(draft.date || today, draft.time);
    if (kind === 'weight') {
      const w = num(draft.weight);
      if (!(w >= 30 && w <= 350)) return setError('Вес — от 30 до 350 кг.');
      onSaveMeasurement({ id: newId('w'), date: noonIso(draft.date || today), weight: Math.round(w * 10) / 10, notes: note });
    } else if (kind === 'body') {
      const m: BodyMeasurement = { id: newId('b'), date: noonIso(draft.date || today), notes: note };
      let any = false;
      for (const [k] of ZONES) {
        const v = num(draft[k as string]);
        if (v >= 10 && v <= 250) { (m as unknown as Record<string, number>)[k as string] = Math.round(v * 10) / 10; any = true; }
      }
      if (!any) return setError('Заполни хотя бы один обхват (10–250 см).');
      onSaveMeasurement(m);
    } else if (kind === 'vitals') {
      const s = num(draft.systolic), d = num(draft.diastolic), p = num(draft.pulse);
      if (!(s >= 40 && s <= 300) || !(d >= 20 && d <= 200)) return setError('Проверь давление: верхнее 40–300, нижнее 20–200.');
      if (s <= d) return setError('Верхнее давление должно быть больше нижнего.');
      onSaveVitals([{ id: newId('v'), at, systolic: s, diastolic: d, pulse: p >= 20 && p <= 250 ? p : undefined, tags, note }, ...vitals].slice(0, 500));
    } else if (kind === 'metric') {
      const v = num(draft.value);
      if (!Number.isFinite(v)) return setError('Укажи значение.');
      const base: VitalEntry = { id: newId('v'), at, tags, note };
      const key = draft.metric;
      if (key === 'spo2') base.spo2 = v;
      else if (key === 'pulse') { base.pulse = v; base.tags = [...tags, 'в покое']; }
      else if (key === 'fat') base.fatPct = v;
      else {
        const name = key === 'custom' ? (draft.customName ?? '').trim() : METRICS.find(m => m.key === key)?.name;
        if (!name) return setError('Назови показатель.');
        base.customName = name.slice(0, 60);
        base.customValue = v;
        base.customUnit = (draft.unit ?? '').trim() || undefined;
      }
      onSaveVitals([base, ...vitals].slice(0, 500));
    } else if (kind === 'sleep') {
      const h = num(draft.hours);
      if (!(h > 0 && h <= 24)) return setError('Сон — от 0 до 24 часов.');
      onSaveVitals([{ id: newId('v'), at, customName: 'Сон', customValue: Math.round(h * 10) / 10, customUnit: 'ч', tags: [draft.quality], note }, ...vitals].slice(0, 500));
    } else if (kind === 'symptom') {
      const s = (draft.symptom ?? '').trim();
      if (!s) return setError('Что беспокоит?');
      const where = (draft.location ?? '').trim();
      onSaveVitals([{ id: newId('v'), at, symptom: s.slice(0, 60), tags: [draft.severity, ...(where ? [where] : [])], note }, ...vitals].slice(0, 500));
    } else if (kind === 'intake') {
      let courses = medCourses;
      let courseId = draft.courseId;
      if (courseId === 'new') {
        const name = (draft.name ?? '').trim();
        if (!name) return setError('Как называется препарат?');
        const course: MedCourse = {
          id: newId('k'), name: name.slice(0, 100),
          ...(draft.form?.trim() ? { form: draft.form.trim() } : {}),
          ...(draft.dose?.trim() ? { dose: draft.dose.trim() } : {}),
          schedule: 'разово', startedAt: draft.date || today, endedAt: draft.date || today,
        };
        courses = [...medCourses, course];
        courseId = course.id;
      }
      const dose = (draft.dose ?? '').trim();
      onSaveMeds(courses, [...medLogs, { id: newId('m'), courseId, at, ...(dose ? { dose } : {}), ...(note ? { note } : {}) }]);
    }
    finishRecord();
  };

  // ---------- Препараты ----------
  const lastLog = (courseId: string) => medLogs
    .filter(l => l.courseId === courseId)
    .reduce<MedLog | null>((best, l) => (!best || l.at > best.at ? l : best), null);
  const whenLog = (iso: string) => {
    const d = new Date(iso);
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const d0 = new Date(d); d0.setHours(0, 0, 0, 0);
    const diff = Math.round((t0.getTime() - d0.getTime()) / 86400000);
    if (diff === 0) return `сегодня в ${localTime(d)}`;
    if (diff === 1) return `вчера в ${localTime(d)}`;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };
  const markTaken = (c: MedCourse) => {
    onSaveMeds(medCourses, [...medLogs, { id: newId('m'), courseId: c.id, at: new Date().toISOString(), ...(c.dose ? { dose: c.dose } : {}) }]);
  };
  const openMedEdit = (course?: MedCourse) => {
    setDraft({
      name: course?.name ?? '', form: course?.form ?? '', dose: course?.dose ?? '',
      schedule: course?.schedule ?? '', remindAt: course?.remindAt ?? '', note: course?.note ?? '',
      status: course?.endedAt ? 'ended' : 'active',
    });
    setDays(course?.days ?? []);
    setError('');
    setMedEdit({ course });
  };
  const submitMed = () => {
    const name = (draft.name ?? '').trim();
    if (!name) return setError('Название обязательно.');
    const prev = medEdit?.course;
    const opt = (k: string) => (draft[k] ?? '').trim();
    // Пустые поля не храним — как и раньше
    const course: MedCourse = {
      id: prev?.id ?? newId('k'),
      name: name.slice(0, 100),
      ...(opt('dose') ? { dose: opt('dose') } : {}),
      ...(opt('form') ? { form: opt('form') } : {}),
      ...(opt('schedule') ? { schedule: opt('schedule') } : {}),
      ...(opt('note') ? { note: opt('note') } : {}),
      ...(days.length ? { days } : {}),
      ...(opt('remindAt') ? { remindAt: opt('remindAt') } : {}),
      startedAt: prev?.startedAt ?? today,
      ...(draft.status === 'ended' ? { endedAt: prev?.endedAt ?? today } : {}),
    };
    onSaveMeds(prev ? medCourses.map(c => c.id === prev.id ? course : c) : [...medCourses, course], medLogs);
    setMedEdit(null);
    setTab('meds');
  };

  // ---------- Разметка ----------
  const tiles: [Kind, ReactNode, string, string][] = [
    ['body', <MoveHorizontal key="i" />, 'Объёмы', 'Талия, грудь, бёдра…'],
    ['vitals', <Heart key="i" />, 'Давление / пульс', 'Одна короткая запись'],
    ['metric', <Plus key="i" />, 'Показатель', 'Температура, глюкоза, SpO₂…'],
    ['mood', <CircleDot key="i" />, 'Самочувствие', checkinFields.some(f => !f.archived) ? 'Твои поля за день' : 'Настроение и энергия'],
    ['sleep', <Moon key="i" />, 'Сон', 'Часы и качество'],
    ['symptom', <Waves key="i" />, 'Симптом', 'Что, где и когда'],
  ];

  const spark = (() => {
    const pts = weights.slice(-12);
    if (pts.length < 2) return null;
    const vals = pts.map(p => p.weight!);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    const xy = vals.map((v, i) => [4 + (i / (vals.length - 1)) * 292, 6 + (1 - (v - min) / span) * 36] as const);
    return { d: xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' '), last: xy[xy.length - 1], min, max, count: weights.length };
  })();

  return (
    <div className="tx health-view">
      <div className="page-title">
        <div>
          <h1>Здоровье</h1>
          <p>Тело, самочувствие и то, что принимаешь.</p>
        </div>
      </div>

      <div className="health-tabs" role="tablist">
        {([['overview', 'Обзор'], ['meds', 'Что принимаю'], ['journal', 'Журнал']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : undefined}
            onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <section className="card ux-measure-hero">
            <span className="ux-eyebrow">Последний вес</span>
            <div className="hero-value">
              <strong>{lastWeight ? comma(lastWeight.weight!) : '—'} <small>кг</small></strong>
              <span>{lastWeight ? measureDay(lastWeight.date, true) : 'ещё нет записей'}</span>
            </div>
            {spark && (
              <div className="weight-spark" aria-label={`Вес: от ${comma(spark.min)} до ${comma(spark.max)} кг`}>
                <svg viewBox="0 0 300 48" aria-hidden="true">
                  <path d={spark.d} />
                  <circle cx={spark.last[0]} cy={spark.last[1]} r="3.5" />
                </svg>
                <small>{comma(spark.min)}–{comma(spark.max)} кг · {spark.count} {spark.count % 10 === 1 && spark.count % 100 !== 11 ? 'замер' : spark.count % 10 >= 2 && spark.count % 10 <= 4 && (spark.count % 100 < 12 || spark.count % 100 > 14) ? 'замера' : 'замеров'}</small>
              </div>
            )}
            <button type="button" className="dark-action" onClick={() => openRecord('weight')}>＋ Записать вес</button>
          </section>

          <div className="health-action-grid">
            {tiles.map(([kind, icon, name, hint]) => (
              <button key={kind} type="button" onClick={() => openRecord(kind)}>
                <span>{icon}</span>
                <b>{name}</b>
                <small>{hint}</small>
              </button>
            ))}
          </div>

          <button type="button" className="health-meds-link" onClick={() => setTab('meds')}>
            <span>
              <b>Препараты, добавки, инъекции</b>
              <small>{activeCourses.length} в текущем списке · журнал приёма</small>
            </span>
            <ArrowRight aria-hidden="true" />
          </button>
        </>
      )}

      {tab === 'meds' && (
        <section className="card health-meds">
          <div className="section-title">
            <h2>Что принимаю</h2>
            <button type="button" className="text-button" onClick={() => openMedEdit()}>＋ Добавить</button>
          </div>
          <p className="health-caption">Твой список и отметки приёма. Дозу и схему указываешь из назначения — ИИ видит этот список, когда разбирает анализы и самочувствие.</p>
          {activeCourses.length ? activeCourses.map(c => {
            const last = lastLog(c.id);
            return (
              <article key={c.id} className="health-med">
                <div>
                  <span className="health-type">{c.form || 'Препарат'}</span>
                  <b>{c.name}</b>
                  <small>{[c.dose, c.schedule].filter(Boolean).join(' · ') || 'Без расписания'}{c.remindAt ? ` · напомню в ${c.remindAt}` : ''}</small>
                  <small className={last ? 'is-logged' : undefined}>{last ? `последний приём: ${whenLog(last.at)}` : 'ещё не отмечено'}</small>
                </div>
                <div className="health-med-actions">
                  <button type="button" onClick={() => markTaken(c)}>Отметить</button>
                  <button type="button" onClick={() => openMedEdit(c)} aria-label={`Изменить ${c.name}`}><MoreHorizontal /></button>
                </div>
              </article>
            );
          }) : (
            <div className="health-empty">
              <strong>Собери свой список</strong>
              <p>Таблетки, добавки и инъекции — каждая запись со своей дозой, формой и расписанием.</p>
              <button type="button" className="dark-action" onClick={() => openMedEdit()}>Добавить первый препарат</button>
            </div>
          )}
          {finishedCourses.length > 0 && (
            <details className="health-finished">
              <summary>Завершённые · {finishedCourses.length}</summary>
              {finishedCourses.map(c => (
                <article key={c.id} className="health-med is-paused">
                  <div>
                    <span className="health-type">{c.form || 'Препарат'}</span>
                    <b>{c.name}</b>
                    <small>{[c.dose, c.schedule].filter(Boolean).join(' · ') || '—'}{c.endedAt ? ` · до ${dayOf(c.endedAt)}` : ''}</small>
                  </div>
                  <div className="health-med-actions">
                    <button type="button" onClick={() => openMedEdit(c)} aria-label={`Изменить ${c.name}`}><MoreHorizontal /></button>
                  </div>
                </article>
              ))}
            </details>
          )}
          <button type="button" className="health-text-action" onClick={() => openRecord('intake')}>＋ Записать разовый приём или инъекцию</button>
        </section>
      )}

      {tab === 'journal' && (
        <section className="card ux-measure-log">
          <div className="section-title">
            <h2>Журнал здоровья</h2>
            <span className="count">{visible.length}</span>
          </div>
          <label className="health-filter">
            <span>Показать</span>
            <select value={filter} onChange={e => { setFilter(e.target.value as 'all' | Kind); setPage(0); }} aria-label="Тип записи">
              <option value="all">Все записи</option>
              {(Object.keys(KIND_NAMES) as Kind[]).map(k => <option key={k} value={k}>{KIND_NAMES[k]}</option>)}
            </select>
          </label>
          {removed && (
            <button type="button" className="health-text-action" onClick={undo}>Запись удалена · Отменить</button>
          )}
          {visible.length === 0 ? (
            <p className="health-caption">Пока нет записей этого типа. Выбери действие на вкладке «Обзор».</p>
          ) : visible.slice(pageNow * PAGE, pageNow * PAGE + PAGE).map(item => (
            <details key={item.key} className="health-log-entry">
              <summary>
                <span>
                  <b>{KIND_NAMES[item.kind]}</b>
                  <small>{item.when}</small>
                </span>
                <strong className={item.tone === 'out' ? 'is-out' : undefined}>{item.value}</strong>
                <ChevronDown className="chev" aria-hidden="true" />
              </summary>
              {item.details.length > 0 ? item.details.map((d, i) => <p key={i}>{d}</p>) : <p>Без заметки</p>}
              <div className="health-log-actions">
                {item.onEdit && <button type="button" onClick={item.onEdit}>Изменить</button>}
                <button type="button" onClick={item.onDelete}>Удалить запись</button>
              </div>
            </details>
          ))}
          {pages > 1 && (
            <div className="health-log-pages">
              <button type="button" disabled={pageNow === 0} onClick={() => setPage(pageNow - 1)} aria-label="Назад">←</button>
              <span>{pageNow + 1} / {pages}</span>
              <button type="button" disabled={pageNow >= pages - 1} onClick={() => setPage(pageNow + 1)} aria-label="Дальше">→</button>
            </div>
          )}
        </section>
      )}

      {dialog && dialog !== 'mood' && (
        <TxDialog title={DIALOG_TITLES[dialog]} onClose={() => setDialog(null)}>
          <form className="health-dialog" onSubmit={e => { e.preventDefault(); submitRecord(dialog); }}>
            {dialog === 'weight' && (
              <label>Вес
                <span className="ux-unit-input"><input type="number" inputMode="decimal" step="0.1" min={30} max={350} required autoFocus value={draft.weight ?? ''} onChange={e => set('weight', e.target.value)} placeholder={lastWeight ? comma(lastWeight.weight!) : ''} /><span>кг</span></span>
              </label>
            )}
            {dialog === 'body' && (
              <div className="health-form-grid">
                {ZONES.map(([k, label]) => (
                  <label key={k as string}>{label}
                    <span className="ux-unit-input"><input type="number" inputMode="decimal" step="0.1" min={10} max={250} value={draft[k as string] ?? ''} onChange={e => set(k as string, e.target.value)} /><span>см</span></span>
                  </label>
                ))}
              </div>
            )}
            {dialog === 'vitals' && (
              <>
                <div className="health-form-pair">
                  <label>Верхнее
                    <span className="ux-unit-input"><input type="number" inputMode="numeric" min={40} max={300} required autoFocus value={draft.systolic ?? ''} onChange={e => set('systolic', e.target.value)} /><span>мм</span></span>
                  </label>
                  <label>Нижнее
                    <span className="ux-unit-input"><input type="number" inputMode="numeric" min={20} max={200} required value={draft.diastolic ?? ''} onChange={e => set('diastolic', e.target.value)} /><span>мм</span></span>
                  </label>
                </div>
                <label>Пульс
                  <span className="ux-unit-input"><input type="number" inputMode="numeric" min={20} max={250} value={draft.pulse ?? ''} onChange={e => set('pulse', e.target.value)} /><span>уд/мин</span></span>
                </label>
              </>
            )}
            {dialog === 'metric' && (
              <>
                <label>Показатель
                  <select value={draft.metric} onChange={e => { const m = METRICS.find(x => x.key === e.target.value)!; setDraft(d => ({ ...d, metric: m.key, unit: m.unit })); }}>
                    {METRICS.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}
                  </select>
                </label>
                {draft.metric === 'custom' && (
                  <label>Название
                    <input value={draft.customName ?? ''} onChange={e => set('customName', e.target.value)} maxLength={60} required placeholder="Например: кетоны" />
                  </label>
                )}
                <div className="health-form-pair">
                  <label>Значение
                    <input type="number" inputMode="decimal" step="0.01" required value={draft.value ?? ''} onChange={e => set('value', e.target.value)} />
                  </label>
                  <label>Единица
                    <input value={draft.unit ?? ''} onChange={e => set('unit', e.target.value)} maxLength={20} disabled={['spo2', 'pulse', 'fat'].includes(draft.metric)} />
                  </label>
                </div>
              </>
            )}
            {dialog === 'sleep' && (
              <div className="health-form-pair">
                <label>Продолжительность
                  <span className="ux-unit-input"><input type="number" inputMode="decimal" step="0.1" min={0.1} max={24} required autoFocus value={draft.hours ?? ''} onChange={e => set('hours', e.target.value)} /><span>ч</span></span>
                </label>
                <label>Качество
                  <select value={draft.quality} onChange={e => set('quality', e.target.value)}>
                    {SLEEP_QUALITY.map(q => <option key={q}>{q}</option>)}
                  </select>
                </label>
              </div>
            )}
            {dialog === 'symptom' && (
              <>
                <div className="health-chips">
                  {SYMPTOM_PRESETS.map(s => (
                    <button key={s} type="button" className={draft.symptom === s ? 'is-on' : undefined} onClick={() => set('symptom', s)}>{s}</button>
                  ))}
                </div>
                <label>Что беспокоит
                  <input value={draft.symptom ?? ''} onChange={e => set('symptom', e.target.value)} maxLength={60} required placeholder="Или впиши своё" />
                </label>
                <div className="health-form-pair">
                  <label>Где
                    <input value={draft.location ?? ''} onChange={e => set('location', e.target.value)} maxLength={60} placeholder="Необязательно" />
                  </label>
                  <label>Выраженность
                    <select value={draft.severity} onChange={e => set('severity', e.target.value)}>
                      {SEVERITY.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                </div>
              </>
            )}
            {dialog === 'intake' && (
              <>
                <label>Что
                  <select value={draft.courseId} onChange={e => { const c = medCourses.find(x => x.id === e.target.value); setDraft(d => ({ ...d, courseId: e.target.value, dose: c?.dose ?? d.dose })); }}>
                    {activeCourses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    <option value="new">Другое — разово</option>
                  </select>
                </label>
                {draft.courseId === 'new' && (
                  <div className="health-form-pair">
                    <label>Название
                      <input value={draft.name ?? ''} onChange={e => set('name', e.target.value)} maxLength={100} required placeholder="Как на упаковке" />
                    </label>
                    <label>Форма
                      <input list="tx-med-forms" value={draft.form ?? ''} onChange={e => set('form', e.target.value)} maxLength={40} placeholder="Укол, таблетка…" />
                    </label>
                  </div>
                )}
                <label>Доза
                  <input value={draft.dose ?? ''} onChange={e => set('dose', e.target.value)} maxLength={60} placeholder="250 мг, 2 капсулы…" />
                </label>
              </>
            )}

            {(dialog === 'vitals' || dialog === 'metric') && (
              <div className="health-chips small">
                {VITAL_TAGS.map(t => (
                  <button key={t} type="button" className={tags.includes(t) ? 'is-on' : undefined}
                    onClick={() => setTags(x => x.includes(t) ? x.filter(y => y !== t) : [...x, t])}>{t}</button>
                ))}
              </div>
            )}

            <div className="health-form-pair">
              <label>Дата
                <input type="date" value={draft.date ?? today} max={today} required onChange={e => set('date', e.target.value)} />
              </label>
              {dialog !== 'weight' && dialog !== 'body' ? (
                <label>Время
                  <input type="time" value={draft.time ?? ''} required onChange={e => set('time', e.target.value)} />
                </label>
              ) : <span />}
            </div>
            <label>Заметка
              <textarea value={draft.note ?? ''} onChange={e => set('note', e.target.value)} maxLength={1000} placeholder="Контекст, условия или наблюдение" />
            </label>
            {error && <p className="ux-form-status" role="alert">{error}</p>}
            <button type="submit" className="primary">Сохранить запись</button>
          </form>
          <datalist id="tx-med-forms">{MED_FORMS.map(f => <option key={f} value={f} />)}</datalist>
        </TxDialog>
      )}

      {dialog === 'mood' && (
        <TxDialog title="Самочувствие" onClose={() => setDialog(null)}>
          <label className="health-day-pick">День
            <input type="date" value={draft.date ?? today} max={today} onChange={e => set('date', e.target.value)} />
          </label>
          <CheckinForm
            fields={checkinFields}
            entries={checkinEntries}
            date={draft.date || today}
            onSave={onSaveCheckins}
          />
          <button type="button" className="primary" onClick={() => setDialog(null)}>Готово</button>
        </TxDialog>
      )}

      {medEdit && (
        <TxDialog title={medEdit.course ? 'Изменить запись' : 'Добавить в мой список'} onClose={() => setMedEdit(null)}>
          <form className="health-dialog" onSubmit={e => { e.preventDefault(); submitMed(); }}>
            <label>Название
              <input value={draft.name ?? ''} onChange={e => set('name', e.target.value)} maxLength={100} required autoFocus placeholder="Как в назначении или на упаковке" />
            </label>
            <div className="health-form-pair">
              <label>Форма
                <input list="tx-med-forms-edit" value={draft.form ?? ''} onChange={e => set('form', e.target.value)} maxLength={40} placeholder="Укол, таблетка…" />
              </label>
              <label>Доза
                <input value={draft.dose ?? ''} onChange={e => set('dose', e.target.value)} maxLength={60} placeholder="250 мг" />
              </label>
            </div>
            <label>Расписание
              <input value={draft.schedule ?? ''} onChange={e => set('schedule', e.target.value)} maxLength={160} placeholder="Например: пн и чт, утром" />
            </label>
            <span className="health-label">Напоминание (необязательно)</span>
            <div className="health-weekdays">
              {WEEK_DAYS.map(([n, label]) => (
                <button key={n} type="button" className={days.includes(n) ? 'is-on' : undefined}
                  onClick={() => setDays(d => d.includes(n) ? d.filter(x => x !== n) : [...d, n].sort())}>{label}</button>
              ))}
            </div>
            <div className="health-form-pair">
              <label>Во сколько
                <input type="time" value={draft.remindAt ?? ''} onChange={e => set('remindAt', e.target.value)} />
              </label>
              <label>Статус
                <select value={draft.status} onChange={e => set('status', e.target.value)}>
                  <option value="active">Принимаю</option>
                  <option value="ended">Завершён</option>
                </select>
              </label>
            </div>
            <p className="health-caption">Дни без отметок — напоминание каждый день, если указано время. Это запись твоей схемы, а не назначение приложения.</p>
            {error && <p className="ux-form-status" role="alert">{error}</p>}
            <button type="submit" className="primary">Сохранить в список</button>
          </form>
          <datalist id="tx-med-forms-edit">{MED_FORMS.map(f => <option key={f} value={f} />)}</datalist>
        </TxDialog>
      )}
    </div>
  );
}

/**
 * Самонаблюдение за день: свои поля пользователя. Каждое нажатие
 * сохраняется сразу, как и раньше; пустой день не храним.
 */
function CheckinForm({ fields, entries, date, onSave }: {
  fields: CheckinField[];
  entries: CheckinEntry[];
  date: string;
  onSave: (fields: CheckinField[], entries: CheckinEntry[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [manage, setManage] = useState(false);
  const [form, setForm] = useState<{ name: string; kind: CheckinField['kind']; unit: string }>({ name: '', kind: 'scale', unit: '' });

  const live = fields.filter(f => !f.archived);
  const day = entries.find(e => e.date === date);
  const values = day?.values ?? {};

  const write = (nextValues: Record<string, number | string>, note: string | undefined) => {
    const rest = entries.filter(e => e.date !== date);
    // Пустую запись не храним: иначе день считался бы заполненным
    const hasAny = Object.keys(nextValues).length > 0 || (note ?? '').trim();
    const next = hasAny ? [...rest, { id: day?.id ?? newId('c'), date, values: nextValues, note }] : rest;
    onSave(fields, next.sort((a, b) => a.date.localeCompare(b.date)));
  };
  const setValue = (fieldId: string, v: number | string | undefined) => {
    const nextValues = { ...values };
    if (v === undefined || v === '') delete nextValues[fieldId];
    else nextValues[fieldId] = v;
    write(nextValues, day?.note);
  };
  const addField = () => {
    const name = form.name.trim();
    if (!name) return;
    onSave([...fields, {
      id: newId('f'), name, kind: form.kind,
      ...(form.kind === 'number' && form.unit.trim() ? { unit: form.unit.trim() } : {}),
    }], entries);
    setForm({ name: '', kind: 'scale', unit: '' });
    setAdding(false);
  };
  // Прошлые значения поля — видно динамику, не уходя из окна
  const trend = (fieldId: string) => entries
    .filter(e => e.values[fieldId] !== undefined && e.date !== date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
  const shown = (f: CheckinField, v: number | string) => f.kind === 'scale' ? (f.labels ?? SCALE_LABELS)[Number(v)] ?? v
    : f.kind === 'yesno' ? (v ? 'да' : 'нет') : v;

  return (
    <div className="checkin-form">
      {live.length === 0 && !adding && (
        <p className="health-caption">Заведи то, что хочешь отслеживать: настроение, энергию, отёчность, акне — что угодно. Отмечать можно в любой день.</p>
      )}
      {live.map(f => (
        <div key={f.id} className="checkin-field">
          <div className="checkin-head">
            <b>{f.name}</b>
            {trend(f.id).length > 0 && <small>было: {trend(f.id).map(e => shown(f, e.values[f.id])).join(' · ')}</small>}
            {manage && (
              <button type="button" className="checkin-remove" aria-label={`Убрать поле ${f.name}`}
                onClick={() => onSave(fields.map(x => x.id === f.id ? { ...x, archived: true } : x), entries)}>×</button>
            )}
          </div>
          {f.kind === 'scale' && (
            <div className="checkin-options four">
              {(f.labels ?? SCALE_LABELS).map((label, i) => (
                <button key={i} type="button" className={values[f.id] === i ? 'is-on' : undefined}
                  onClick={() => setValue(f.id, values[f.id] === i ? undefined : i)}>{label}</button>
              ))}
            </div>
          )}
          {f.kind === 'yesno' && (
            <div className="checkin-options">
              {([['да', 1], ['нет', 0]] as const).map(([label, v]) => (
                <button key={label} type="button" className={values[f.id] === v ? 'is-on' : undefined}
                  onClick={() => setValue(f.id, values[f.id] === v ? undefined : v)}>{label}</button>
              ))}
            </div>
          )}
          {f.kind === 'number' && (
            <span className="ux-unit-input">
              <input type="number" inputMode="decimal" value={values[f.id] ?? ''} placeholder="0"
                onChange={e => setValue(f.id, e.target.value === '' ? undefined : Number(e.target.value))} />
              {f.unit && <span>{f.unit}</span>}
            </span>
          )}
        </div>
      ))}
      {live.length > 0 && (
        <label>Заметка к дню
          <input value={day?.note ?? ''} onChange={e => write(values, e.target.value)} placeholder="Необязательно" />
        </label>
      )}
      {adding ? (
        <div className="checkin-add">
          <input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Название: настроение, отёчность…" />
          <div className="checkin-options three">
            {([['scale', 'шкала'], ['yesno', 'да / нет'], ['number', 'число']] as const).map(([k, label]) => (
              <button key={k} type="button" className={form.kind === k ? 'is-on' : undefined} onClick={() => setForm(f => ({ ...f, kind: k }))}>{label}</button>
            ))}
          </div>
          {form.kind === 'number' && (
            <input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="Единица: часов, кг, мг…" />
          )}
          <div className="checkin-add-actions">
            <button type="button" className="secondary-btn" onClick={() => { setAdding(false); setForm({ name: '', kind: 'scale', unit: '' }); }}>Отмена</button>
            <button type="button" className="accent-btn" disabled={!form.name.trim()} onClick={addField}>Добавить поле</button>
          </div>
        </div>
      ) : (
        <div className="checkin-tools">
          <button type="button" onClick={() => setAdding(true)}>＋ Добавить поле</button>
          {live.length > 0 && <button type="button" onClick={() => setManage(m => !m)}>{manage ? 'Готово' : 'Убрать поле'}</button>}
        </div>
      )}
    </div>
  );
}

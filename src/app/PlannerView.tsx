'use client';

import React, { useState, useMemo } from 'react';
import { Plus, ChevronLeft, ChevronRight, CalendarDays, Sparkles, Pill, Trash2, ArrowLeft } from 'lucide-react';
import PlannerChat from './PlannerChat';
import { TxDialog } from '@/components/TxDialog';
import type { MedCourse } from '@/lib/health-types';

// ── Types ──
export interface PlannerEvent {
  id: string;
  date: string; // YYYY-MM-DD or '' for undated todos
  time: string; // HH:MM or empty
  title: string;
  description: string;
  category: EventCategory;
  done: boolean;
  reminder: boolean;
  type: 'event' | 'todo' | 'idea'; // event = calendar, todo = backlog, idea = ideas
  priority?: 'low' | 'medium' | 'high';
  reminderOffsets?: string[]; // e.g. ['5m', '1h', '1d', '2d']
  remindersSent?: string[]; // track which reminders were already sent
  archived?: boolean;
  archivedAt?: string;
  /**
   * Это дело — «Пора сменить программу»: дата дела — конец срока.
   * Откуда считать недели и сколько их — хранится здесь же, чтобы срок
   * программы жил вместе с напоминанием (Планер + Telegram).
   */
  programEnd?: { startedAt: string; weeks: number };
}

export type HabitSchedule = 'daily' | 'weekdays' | 'weekends' | 'custom';

export interface Habit {
  id: string;
  title: string;
  time: string; // HH:MM — when to do it
  icon: string; // emoji
  reminderEnabled: boolean;
  reminderMinutesBefore: number; // 0 = at time, 5, 15, 30
  schedule: HabitSchedule; // when to repeat
  customDays?: number[]; // [1,2,3,4,5] = Mon-Fri (0=Sun, 1=Mon, ...)
  active: boolean;
  completedDates: string[];
  // Marks this habit as a supplement/vitamin. Displayed in its own section
  // above regular habits. Supplements can have a dosage string.
  isSupplement?: boolean;
  dosage?: string; // e.g. "500mg", "1 capsule", "1 tsp"
}

export const REMINDER_OPTIONS = [
  { key: '5m', label: 'За 5 мин', labelEn: '5 min before', minutes: 5 },
  { key: '1h', label: 'За 1 час', labelEn: '1 hour before', minutes: 60 },
  { key: '3h', label: 'За 3 часа', labelEn: '3 hours before', minutes: 180 },
  { key: '1d', label: 'За 1 день', labelEn: '1 day before', minutes: 1440 },
  { key: '2d', label: 'За 2 дня', labelEn: '2 days before', minutes: 2880 },
];

export type EventCategory = 'health' | 'business' | 'personal' | 'finance' | 'fitness' | 'travel' | 'other';

const CATEGORIES: { key: EventCategory; label: string; labelEn: string }[] = [
  { key: 'fitness', label: 'Тренировки', labelEn: 'Workouts' },
  { key: 'health', label: 'Здоровье', labelEn: 'Health' },
  { key: 'personal', label: 'Личное', labelEn: 'Personal' },
  { key: 'business', label: 'Бизнес', labelEn: 'Business' },
  { key: 'finance', label: 'Финансы', labelEn: 'Finance' },
  { key: 'travel', label: 'Поездки', labelEn: 'Travel' },
  { key: 'other', label: 'Другое', labelEn: 'Other' },
];

const PRIORITIES = [
  { key: 'high' as const, label: 'Важно', labelEn: 'High' },
  { key: 'medium' as const, label: 'Средне', labelEn: 'Medium' },
  { key: 'low' as const, label: 'Не срочно', labelEn: 'Low' },
];

const catLabel = (cat: EventCategory, isRu: boolean) => {
  const c = CATEGORIES.find(x => x.key === cat) ?? CATEGORIES[CATEGORIES.length - 1];
  return isRu ? c.label : c.labelEn;
};

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
const parseDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

const MONTH_NAMES_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DAY_NAMES_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface PlannerViewProps {
  events: PlannerEvent[];
  onEventsChange: (events: PlannerEvent[]) => void;
  /* Привычки («Протокол») больше не показываются в планере: в новом
     дизайне этого раздела нет. Данные пользователя в базе сохранены. */
  todayStr: string;
  lang: 'ru' | 'en';
  /** Часовой пояс пользователя — ИИ считает по нему «завтра» и «в среду». */
  timezone: string;
  /** Курсы препаратов: их напоминания попадают в «Ближайшее». */
  medCourses?: MedCourse[];
}

/**
 * Планер по макету редизайна: неделя полосой (месяц — по кнопке), фильтр
 * по категориям, дела дня с отметкой, «Без даты» с назначением на день и
 * «Ближайшее» — следующие дела и приёмы по расписанию. ИИ-планировщик
 * открывается кнопкой со звёздочкой рядом с «+».
 */
export default function PlannerView({ events, onEventsChange, todayStr, lang, timezone, medCourses = [] }: PlannerViewProps) {
  const [viewMonth, setViewMonth] = useState(() => {
    if (!todayStr) return new Date();
    const [y, m] = todayStr.split('-').map(Number);
    return new Date(y, m - 1, 1);
  });
  const [selectedDay, setSelectedDay] = useState<string>(todayStr || formatDate(new Date()));
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<PlannerEvent | null>(null);
  const [addType, setAddType] = useState<'event' | 'todo' | 'idea'>('event');
  const [monthOpen, setMonthOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [dayFilter, setDayFilter] = useState<'all' | 'fitness' | 'health' | 'personal'>('all');
  // Чат создаём при первом открытии и дальше не размонтируем — иначе
  // черновики и переписка терялись бы при возврате к плану.
  const [aiEverOpened, setAiEverOpened] = useState(false);
  // «Без даты» бывает длинным — показываем первые пять, остальное по кнопке
  const [undatedAll, setUndatedAll] = useState(false);

  const isRu = lang === 'ru';
  const monthNames = isRu ? MONTH_NAMES_RU : MONTH_NAMES_EN;
  const dayNames = isRu ? DAY_NAMES_RU : DAY_NAMES_EN;
  const loc = isRu ? 'ru-RU' : 'en-US';

  const active = useMemo(() => events.filter(e => !e.archived), [events]);
  const calendarEvents = useMemo(() => active.filter(e => e.type === 'event' || (!e.type && e.date)), [active]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, PlannerEvent[]> = {};
    for (const ev of calendarEvents) {
      if (!ev.date) continue;
      (map[ev.date] ||= []).push(ev);
    }
    for (const key of Object.keys(map)) map[key].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    return map;
  }, [calendarEvents]);

  // Неделя (пн–вс), в которую попадает выбранный день
  const week = useMemo(() => {
    const d = parseDay(selectedDay);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => { const x = new Date(monday); x.setDate(monday.getDate() + i); return formatDate(x); });
  }, [selectedDay]);

  const calendarDays = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const last = new Date(year, month + 1, 0).getDate();
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: last }, (_, i) => formatDate(new Date(year, month, i + 1))),
    ];
  }, [viewMonth]);

  /**
   * Дела без даты («Когда-нибудь») — старые записи типа todo. Показываем
   * отдельной карточкой: кнопка «На день» ставит их на выбранный день.
   */
  const undated = useMemo(() => active.filter(e => !e.date && e.type !== 'idea'), [active]);

  const dayList = (eventsByDate[selectedDay] || []).filter(e => dayFilter === 'all' || e.category === dayFilter);
  const undatedList = undated.filter(e => dayFilter === 'all' || e.category === dayFilter);
  const undatedPending = undatedList.filter(e => !e.done);
  const undatedDone = undatedList.filter(e => e.done);

  const dayHeading = (() => {
    const text = parseDay(selectedDay).toLocaleDateString(loc, { day: 'numeric', month: 'long' });
    if (selectedDay === todayStr) return isRu ? `Сегодня, ${text}` : `Today, ${text}`;
    const w = parseDay(selectedDay).toLocaleDateString(loc, { weekday: 'long' });
    return `${w.charAt(0).toUpperCase() + w.slice(1)}, ${text}`;
  })();

  const plural = (n: number) => isRu
    ? `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'дело' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'дела' : 'дел'}`
    : `${n} ${n === 1 ? 'task' : 'tasks'}`;

  /**
   * Ближайшее: следующие дела после сегодня и приёмы препаратов по
   * расписанию напоминаний (дни недели + время) на неделю вперёд.
   */
  const upcoming = useMemo(() => {
    const rows: { key: string; date: string; time: string; title: string; meta: string; kind: 'event' | 'med' }[] = [];
    for (const ev of calendarEvents) {
      if (ev.done || !ev.date || ev.date <= todayStr) continue;
      rows.push({ key: ev.id, date: ev.date, time: ev.time, title: ev.title, meta: catLabel(ev.category, isRu), kind: 'event' });
    }
    const now = new Date();
    const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    for (const c of medCourses) {
      if (c.endedAt || !c.remindAt) continue;
      for (let i = 0; i < 8; i++) {
        const d = parseDay(todayStr);
        d.setDate(d.getDate() + i);
        const iso = (d.getDay() + 6) % 7 + 1; // 1 — пн … 7 — вс
        if (c.days?.length && !c.days.includes(iso)) continue;
        if (i === 0 && c.remindAt <= nowHm) continue;
        rows.push({ key: 'med' + c.id, date: formatDate(d), time: c.remindAt, title: c.name, meta: isRu ? 'по расписанию' : 'scheduled', kind: 'med' });
        break;
      }
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99')).slice(0, 4);
  }, [calendarEvents, medCourses, todayStr, isRu]);

  const selectDay = (d: string) => {
    setSelectedDay(d);
    const x = parseDay(d);
    setViewMonth(new Date(x.getFullYear(), x.getMonth(), 1));
  };
  const goToToday = () => { selectDay(todayStr); setMonthOpen(false); };

  const addEvent = (ev: PlannerEvent) => {
    onEventsChange([...events, ev]);
    setShowAddModal(false);
    setEditingEvent(null);
  };
  const updateEvent = (ev: PlannerEvent) => {
    onEventsChange(events.map(e => e.id === ev.id ? ev : e));
    setEditingEvent(null);
    setShowAddModal(false);
  };
  const archiveEvent = (id: string) => {
    onEventsChange(events.map(e => e.id === id ? { ...e, archived: true, archivedAt: new Date().toISOString() } : e));
    setEditingEvent(null);
    setShowAddModal(false);
  };
  const toggleDone = (id: string) => {
    onEventsChange(events.map(e => e.id === id ? { ...e, done: !e.done } : e));
  };
  // «На день»: дело без даты становится событием выбранного дня
  const scheduleToDay = (id: string) => {
    onEventsChange(events.map(e => e.id === id ? { ...e, date: selectedDay, type: 'event' } : e));
  };
  const openAddModal = (type: 'event' | 'todo' | 'idea') => {
    setAddType(type);
    setEditingEvent(null);
    setShowAddModal(true);
  };
  const openEdit = (e: PlannerEvent) => { setEditingEvent(e); setAddType(e.type || 'event'); setShowAddModal(true); };

  const monthTitle = `${monthNames[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`;

  return (
    <div className="tx planner-view">
      <div className="page-title">
        <div>
          <h1>{isRu ? 'Планер' : 'Planner'}</h1>
          <p>{isRu ? 'Меньше хаоса. Больше ритма.' : 'Less chaos. More rhythm.'}</p>
        </div>
        <div className="planner-actions">
          <button type="button" className={'round big' + (aiOpen ? ' is-on' : '')} aria-pressed={aiOpen}
            aria-label={isRu ? 'ИИ-планировщик' : 'AI planner'}
            onClick={() => { setAiOpen(v => !v); setAiEverOpened(true); }}>
            <Sparkles />
          </button>
          <button type="button" className="round big primary" aria-label={isRu ? 'Добавить дело' : 'Add task'} onClick={() => openAddModal('event')}>
            <Plus />
          </button>
        </div>
      </div>

      {aiOpen && (
        <button type="button" className="text-button planner-back" onClick={() => setAiOpen(false)}>
          <ArrowLeft /> {isRu ? 'К плану' : 'Back to plan'}
        </button>
      )}

      {/* ИИ-чат держим смонтированным и прячем: размонтирование стирало бы
          подготовленные черновики, а человек как раз уходит проверить день. */}
      {aiEverOpened && (
        <div className="plv2 planner-ai" hidden={!aiOpen}>
          <PlannerChat
            events={events}
            selectedDate={selectedDay}
            todayStr={todayStr}
            timezone={timezone}
            onAdd={fresh => onEventsChange([...events, ...fresh])}
            onOpenDate={date => { selectDay(date); setAiOpen(false); }}
          />
        </div>
      )}

      {!aiOpen && (
        <>
          <div className="calendar-top">
            <strong>{monthTitle}</strong>
            <div className="calendar-tools">
              {selectedDay !== todayStr && (
                <button type="button" className="text-button quiet" onClick={goToToday}>{isRu ? 'Сегодня' : 'Today'}</button>
              )}
              <button type="button" className="text-button" aria-expanded={monthOpen} onClick={() => setMonthOpen(v => !v)}>
                {monthOpen ? (isRu ? 'Неделя' : 'Week') : (isRu ? 'Месяц' : 'Month')} <CalendarDays />
              </button>
            </div>
          </div>

          {monthOpen ? (
            <div className="month-card">
              <div className="month-nav">
                <button type="button" className="round" aria-label={isRu ? 'Предыдущий месяц' : 'Previous month'}
                  onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}><ChevronLeft /></button>
                <span>{monthTitle}</span>
                <button type="button" className="round" aria-label={isRu ? 'Следующий месяц' : 'Next month'}
                  onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}><ChevronRight /></button>
              </div>
              <div className="month-grid">
                {dayNames.map(d => <span key={d} className="dow">{d}</span>)}
                {calendarDays.map((d, i) => d === null ? <span key={'e' + i} /> : (
                  <button key={d} type="button"
                    className={[d === selectedDay ? 'active' : '', d === todayStr ? 'is-today' : '', (eventsByDate[d] || []).some(e => !e.done) ? 'has-tasks' : ''].filter(Boolean).join(' ') || undefined}
                    aria-pressed={d === selectedDay}
                    onClick={() => { selectDay(d); setMonthOpen(false); }}>
                    {parseDay(d).getDate()}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="week-strip">
              {week.map((d, i) => {
                const has = (eventsByDate[d] || []).some(e => !e.done);
                return (
                  <button key={d} type="button"
                    className={['day', d === selectedDay ? 'active' : '', d === todayStr ? 'is-today' : ''].filter(Boolean).join(' ')}
                    aria-pressed={d === selectedDay} onClick={() => selectDay(d)}>
                    <small>{dayNames[i]}</small>
                    <strong>{parseDay(d).getDate()}</strong>
                    <i className={has ? 'has' : undefined} />
                  </button>
                );
              })}
            </div>
          )}

          <div className="filter-bar" aria-label={isRu ? 'Фильтр дел' : 'Filter'}>
            {([
              ['all', isRu ? 'Все дела' : 'All'],
              ['fitness', isRu ? 'Тренировки' : 'Workouts'],
              ['health', isRu ? 'Здоровье' : 'Health'],
              ['personal', isRu ? 'Личное' : 'Personal'],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" className={'pill' + (dayFilter === key ? ' active' : '')}
                aria-pressed={dayFilter === key} onClick={() => setDayFilter(key)}>{label}</button>
            ))}
          </div>

          <div className="section-title">
            <h2>{dayHeading}</h2>
            <span className="muted">{plural(dayList.length)}</span>
          </div>

          {dayList.length > 0 ? (
            <div className="task-list">
              {dayList.map(ev => (
                <TaskItem key={ev.id} ev={ev} isRu={isRu} onToggle={toggleDone} onEdit={openEdit} />
              ))}
            </div>
          ) : (
            <div className="card empty planner-empty">
              <span className="empty-icon"><CalendarDays /></span>
              <h3>{isRu ? 'День в твоём ритме' : 'A day at your pace'}</h3>
              <p>{dayFilter === 'all'
                ? (isRu ? 'Пока ничего не запланировано. Добавь тренировку, дело или напоминание.' : 'Nothing planned yet. Add a workout, a task or a reminder.')
                : (isRu ? 'В этой категории на этот день ничего нет.' : 'Nothing in this category for the day.')}</p>
              <button type="button" className="primary" onClick={() => openAddModal('event')}><Plus /> {isRu ? 'Добавить дело' : 'Add task'}</button>
            </div>
          )}

          {(undatedPending.length > 0 || undatedDone.length > 0) && (
            <section className="card undated-card">
              <div className="section-title">
                <h2>{isRu ? 'Без даты' : 'No date'}</h2>
                <span className="count">{undatedPending.length}</span>
              </div>
              {(undatedAll ? undatedPending : undatedPending.slice(0, 5)).map(ev => (
                <div key={ev.id} className="row undated-row">
                  <input type="checkbox" className="tx-box" checked={false} onChange={() => toggleDone(ev.id)}
                    aria-label={`${isRu ? 'Выполнено' : 'Done'}: ${ev.title}`} />
                  <button type="button" className="row-copy" onClick={() => openEdit(ev)}>
                    <strong>{ev.title}</strong>
                    <small>{catLabel(ev.category, isRu)}{ev.description ? (isRu ? ' · есть заметка' : ' · has note') : ''}</small>
                  </button>
                  <button type="button" className="text-button" onClick={() => scheduleToDay(ev.id)}>{isRu ? 'На день +' : 'To day +'}</button>
                </div>
              ))}
              {undatedPending.length > 5 && (
                <button type="button" className="text-button undated-more" onClick={() => setUndatedAll(v => !v)}>
                  {undatedAll ? (isRu ? 'Свернуть' : 'Show less') : (isRu ? `Показать все · ${undatedPending.length}` : `Show all · ${undatedPending.length}`)}
                </button>
              )}
              {undatedDone.length > 0 && (
                <details className="undated-done">
                  <summary>{isRu ? 'Выполненные' : 'Done'} · {undatedDone.length}</summary>
                  {undatedDone.map(ev => (
                    <div key={ev.id} className="row undated-row is-done">
                      <input type="checkbox" className="tx-box" checked onChange={() => toggleDone(ev.id)}
                        aria-label={`${isRu ? 'Снять отметку' : 'Undo'}: ${ev.title}`} />
                      <button type="button" className="row-copy" onClick={() => openEdit(ev)}>
                        <strong>{ev.title}</strong>
                      </button>
                    </div>
                  ))}
                </details>
              )}
            </section>
          )}

          {upcoming.length > 0 && (
            <section className="card">
              <div className="section-title"><h2>{isRu ? 'Ближайшее' : 'Coming up'}</h2></div>
              {upcoming.map(u => (
                <button key={u.key} type="button" className="row upcoming-row" onClick={() => selectDay(u.date)}>
                  <span className="icon-tile">{u.kind === 'med' ? <Pill /> : <CalendarDays />}</span>
                  <div className="row-copy">
                    <strong>{u.title}</strong>
                    <small>
                      {(() => { const s = parseDay(u.date).toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1); })()}
                      {u.time ? ` · ${u.time}` : ''} · {u.meta}
                    </small>
                  </div>
                </button>
              ))}
            </section>
          )}
        </>
      )}

      {showAddModal && (
        <EventModal
          event={editingEvent}
          date={selectedDay}
          type={addType}
          lang={lang}
          onSave={(ev) => editingEvent ? updateEvent(ev) : addEvent(ev)}
          onClose={() => { setShowAddModal(false); setEditingEvent(null); }}
          onDelete={editingEvent ? () => archiveEvent(editingEvent.id) : undefined}
        />
      )}
    </div>
  );
}

/** Дело дня: отметка слева, название и «время · категория»; тап — правка. */
function TaskItem({ ev, isRu, onToggle, onEdit }: {
  ev: PlannerEvent;
  isRu: boolean;
  onToggle: (id: string) => void;
  onEdit: (ev: PlannerEvent) => void;
}) {
  return (
    <div className={'task-item' + (ev.done ? ' done' : '')}>
      <input type="checkbox" className="tx-box" checked={Boolean(ev.done)} onChange={() => onToggle(ev.id)}
        aria-label={`${ev.done ? (isRu ? 'Снять отметку' : 'Undo') : (isRu ? 'Выполнено' : 'Done')}: ${ev.title}`} />
      <button type="button" className="task-copy" onClick={() => onEdit(ev)}
        aria-label={`${ev.title}. ${isRu ? 'Открыть и изменить' : 'Open and edit'}`}>
        <strong>{ev.title}</strong>
        <small>{[ev.time, catLabel(ev.category, isRu), ev.description ? (isRu ? 'есть заметка' : 'has note') : ''].filter(Boolean).join(' · ')}</small>
      </button>
    </div>
  );
}

// ── Event Add/Edit Modal ──
function EventModal({ event, date, type, lang, onSave, onClose, onDelete }: {
  event: PlannerEvent | null; date: string; type: 'event' | 'todo' | 'idea';
  lang: 'ru' | 'en'; onSave: (ev: PlannerEvent) => void; onClose: () => void; onDelete?: () => void;
}) {
  const isRu = lang === 'ru';
  const [title, setTitle] = useState(event?.title || '');
  const [description, setDescription] = useState(event?.description || '');
  const [time, setTime] = useState(event?.time || '');
  const [category, setCategory] = useState<EventCategory>(event?.category || (type === 'idea' ? 'personal' : 'other'));
  const [eventDate, setEventDate] = useState(event?.date || (type === 'event' ? date : ''));
  const [reminder, setReminder] = useState(event?.reminder ?? (type === 'event'));
  const [reminderOffsets, setReminderOffsets] = useState<string[]>(event?.reminderOffsets || (type === 'event' ? ['1h'] : []));
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>(event?.priority || 'medium');
  const kind = event?.type || type;

  const toggleOffset = (key: string) => {
    setReminderOffsets(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
    if (!reminder) setReminder(true);
  };

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      id: event?.id || `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      date: eventDate, time, title: title.trim(), description: description.trim(),
      category, done: event?.done || false, reminder,
      reminderOffsets: reminder ? reminderOffsets : [],
      remindersSent: event?.remindersSent || [],
      // Дата есть — дело в календаре (event), даты нет — в «Без даты» (todo)
      type: kind === 'idea' ? 'idea' : eventDate ? 'event' : 'todo', priority,
    });
  };

  const titles = { event: isRu ? 'Новое дело' : 'New task', todo: isRu ? 'Задача' : 'Task', idea: isRu ? 'Идея' : 'Idea' };

  return (
    <TxDialog title={event ? (isRu ? 'Изменить дело' : 'Edit task') : titles[type]} onClose={onClose}>
      <form className="planner-form" onSubmit={e => { e.preventDefault(); handleSave(); }}>
        <label>{isRu ? 'Название' : 'Title'}
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus required maxLength={120}
            placeholder={kind === 'idea' ? (isRu ? 'Опиши идею…' : 'Describe your idea…') : (isRu ? 'Что запланируем?' : 'What are we planning?')} />
        </label>
        {kind !== 'idea' && (
          <div className="pair">
            <label>{isRu ? 'Дата' : 'Date'}
              <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
            </label>
            <label>{isRu ? 'Время' : 'Time'}
              <input type="time" value={time} onChange={e => setTime(e.target.value)} />
            </label>
          </div>
        )}
        <label>{isRu ? 'Категория' : 'Category'}
          <select value={category} onChange={e => setCategory(e.target.value as EventCategory)}>
            {CATEGORIES.map(c => <option key={c.key} value={c.key}>{isRu ? c.label : c.labelEn}</option>)}
          </select>
        </label>
        {kind === 'todo' && (
          <label>{isRu ? 'Приоритет' : 'Priority'}
            <select value={priority} onChange={e => setPriority(e.target.value as 'low' | 'medium' | 'high')}>
              {PRIORITIES.map(p => <option key={p.key} value={p.key}>{isRu ? p.label : p.labelEn}</option>)}
            </select>
          </label>
        )}
        <label>{isRu ? 'Подробности' : 'Details'}
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
            placeholder={isRu ? 'Необязательно' : 'Optional'} />
        </label>
        {kind !== 'idea' && eventDate && (
          <>
            <span className="field-label">{isRu ? 'Напомнить в Telegram' : 'Remind via Telegram'}</span>
            <div className="chips">
              {REMINDER_OPTIONS.map(opt => (
                <button key={opt.key} type="button" className={reminderOffsets.includes(opt.key) ? 'is-on' : undefined}
                  onClick={() => toggleOffset(opt.key)}>{isRu ? opt.label : opt.labelEn}</button>
              ))}
            </div>
          </>
        )}
        <div className="form-actions">
          {onDelete && (
            <button type="button" className="delete" onClick={onDelete} aria-label={isRu ? 'Удалить' : 'Delete'}><Trash2 size={16} /></button>
          )}
          <button type="submit" className="primary" disabled={!title.trim()}>{isRu ? 'Сохранить' : 'Save'}</button>
        </div>
      </form>
    </TxDialog>
  );
}

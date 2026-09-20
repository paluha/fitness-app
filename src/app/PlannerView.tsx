'use client';

import React, { useState, useMemo } from 'react';
import { X, ChevronLeft, ChevronRight, Trash2, Save, Check, Bell } from 'lucide-react';
import PlannerChat from './PlannerChat';

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

const CATEGORIES: { key: EventCategory; label: string; labelEn: string; emoji: string; color: string }[] = [
  { key: 'health', label: 'Здоровье', labelEn: 'Health', emoji: '🏥', color: '#ef4444' },
  { key: 'business', label: 'Бизнес', labelEn: 'Business', emoji: '💼', color: '#3b82f6' },
  { key: 'personal', label: 'Личное', labelEn: 'Personal', emoji: '👤', color: '#a855f7' },
  { key: 'finance', label: 'Финансы', labelEn: 'Finance', emoji: '💰', color: '#22c55e' },
  { key: 'fitness', label: 'Фитнес', labelEn: 'Fitness', emoji: '💪', color: '#eab308' },
  { key: 'travel', label: 'Поездки', labelEn: 'Travel', emoji: '✈️', color: '#06b6d4' },
  { key: 'other', label: 'Другое', labelEn: 'Other', emoji: '📌', color: '#6b7280' },
];

const PRIORITIES = [
  { key: 'high' as const, label: 'Важно', labelEn: 'High', color: '#ef4444', emoji: '🔴' },
  { key: 'medium' as const, label: 'Средне', labelEn: 'Medium', color: '#eab308', emoji: '🟡' },
  { key: 'low' as const, label: 'Не срочно', labelEn: 'Low', color: '#6b7280', emoji: '⚪' },
];

function getCategoryInfo(cat: EventCategory) {
  return CATEGORIES.find(c => c.key === cat) || CATEGORIES[6];
}

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
}

export default function PlannerView({ events, onEventsChange, todayStr, lang, timezone }: PlannerViewProps) {
  const [viewMonth, setViewMonth] = useState(() => {
    if (!todayStr) return new Date();
    const [y, m] = todayStr.split('-').map(Number);
    return new Date(y, m - 1, 1);
  });
  const [selectedDay, setSelectedDay] = useState<string>(todayStr || formatDate(new Date()));
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<PlannerEvent | null>(null);
  const [addType, setAddType] = useState<'event' | 'todo' | 'idea'>('event');
  // Вид внутри календаря по эталону: день, месяц или ИИ-чат.
  const [calMode, setCalMode] = useState<'day' | 'month' | 'ai'>('day');
  const [dayFilter, setDayFilter] = useState<'all' | 'fitness' | 'health' | 'personal'>('all');
  const [showDone, setShowDone] = useState(false);
  // Чат создаём при первом открытии и дальше не размонтируем — иначе
  // черновики и переписка терялись бы при переходе на «День».
  const [aiEverOpened, setAiEverOpened] = useState(false);

  const isRu = lang === 'ru';
  const monthNames = isRu ? MONTH_NAMES_RU : MONTH_NAMES_EN;
  const dayNames = isRu ? DAY_NAMES_RU : DAY_NAMES_EN;

  // Split events by type (exclude archived)
  const active = useMemo(() => events.filter(e => !e.archived), [events]);
  const calendarEvents = useMemo(() => active.filter(e => e.type === 'event' || (!e.type && e.date)), [active]);


  // Calendar grid
  const calendarDays = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;
    const days: { date: string; day: number; isCurrentMonth: boolean }[] = [];
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({ date: formatDate(d), day: d.getDate(), isCurrentMonth: false });
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push({ date: formatDate(new Date(year, month, d)), day: d, isCurrentMonth: true });
    }
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      days.push({ date: formatDate(new Date(year, month + 1, d)), day: d, isCurrentMonth: false });
    }
    return days;
  }, [viewMonth]);

  // Events grouped by date (calendar only)
  const eventsByDate = useMemo(() => {
    const map: Record<string, PlannerEvent[]> = {};
    for (const ev of calendarEvents) {
      if (!ev.date) continue;
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    }
    return map;
  }, [calendarEvents]);

  const selectedEvents = useMemo(() => eventsByDate[selectedDay] || [], [eventsByDate, selectedDay]);

  // Заголовок дня: «Сегодня, 21 сентября» либо дата, снизу — день недели.
  const dayHeadingText = useMemo(() => {
    if (!selectedDay) return '';
    const d = new Date(`${selectedDay}T12:00:00`);
    const text = d.toLocaleDateString(isRu ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long' });
    if (selectedDay === todayStr) return isRu ? `Сегодня, ${text}` : `Today, ${text}`;
    return text;
  }, [selectedDay, todayStr, isRu]);
  const daySubtitleText = useMemo(() => {
    if (!selectedDay) return '';
    const w = new Date(`${selectedDay}T12:00:00`).toLocaleDateString(isRu ? 'ru-RU' : 'en-US', { weekday: 'long' });
    return w.charAt(0).toUpperCase() + w.slice(1);
  }, [selectedDay, isRu]);
  // Тренировки открытого месяца — список под календарём в режиме «Месяц».
  const monthWorkouts = useMemo(() => {
    const prefix = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, '0')}`;
    return calendarEvents
      .filter(e => e.category === 'fitness' && e.date.startsWith(prefix))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  }, [calendarEvents, viewMonth]);

  const prevMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1));
  const nextMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1));
  const goToToday = () => {
    if (!todayStr) return;
    const [y, m] = todayStr.split('-').map(Number);
    setViewMonth(new Date(y, m - 1, 1));
    setSelectedDay(todayStr);
    setCalMode('day');
  };

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




  const openAddModal = (type: 'event' | 'todo' | 'idea') => {
    setAddType(type);
    setEditingEvent(null);
    setShowAddModal(true);
  };

  return (
    <div style={{ padding: '0 20px 100px' }}>
        <div className="plv2">
          {/* Вид календаря: День / Месяц / ИИ-чат — по эталону */}
          <div className="seg" aria-label="Вид календаря">
            {([
              ['day', isRu ? 'День' : 'Day'],
              ['month', isRu ? 'Месяц' : 'Month'],
              ['ai', isRu ? 'ИИ-чат' : 'AI chat'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={calMode === key}
                onClick={() => { setCalMode(key); if (key === 'ai') setAiEverOpened(true); }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Месячный календарь виден сразу в режимах «День» и «Месяц» */}
          {calMode !== 'ai' && (
            <section>
              <div className="date-tools">
                <h2>{monthNames[viewMonth.getMonth()]} {viewMonth.getFullYear()}</h2>
                <div className="arrows">
                  <button className="icon-btn" type="button" onClick={prevMonth} aria-label={isRu ? 'Предыдущий месяц' : 'Previous month'}>
                    <ChevronLeft size={17} />
                  </button>
                  <button className="icon-btn" type="button" onClick={nextMonth} aria-label={isRu ? 'Следующий месяц' : 'Next month'}>
                    <ChevronRight size={17} />
                  </button>
                </div>
              </div>
              <div className="month-card">
                <div className="week-labels">
                  {dayNames.map(d => <span key={d}>{d.toUpperCase()}</span>)}
                </div>
                <div className="month-grid">
                  {calendarDays.map((day, i) => {
                    const dayEvents = eventsByDate[day.date] || [];
                    const allDone = dayEvents.length > 0 && dayEvents.every(e => e.done);
                    const hasWorkout = dayEvents.some(e => !e.done && e.category === 'fitness');
                    const hasOther = dayEvents.some(e => !e.done && e.category !== 'fitness');
                    return (
                      <button
                        key={i}
                        type="button"
                        className={['month-day', day.isCurrentMonth ? '' : 'outside', day.date === todayStr ? 'today' : ''].filter(Boolean).join(' ')}
                        aria-pressed={day.date === selectedDay}
                        aria-label={`${day.day}, ${isRu ? 'дел' : 'events'}: ${dayEvents.length}`}
                        onClick={() => { setSelectedDay(day.date); setCalMode('day'); }}
                      >
                        {day.day}
                        <span className="dots">
                          {allDone ? <i className="dot done" /> : (<>
                            {hasWorkout && <i className="dot workout" />}
                            {hasOther && <i className="dot" />}
                          </>)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="month-legend">
                  <span><i className="dot workout" />{isRu ? 'Тренировка' : 'Workout'}</span>
                  <span><i className="dot" />{isRu ? 'Дела' : 'Tasks'}</span>
                  <span><i className="dot done" />{isRu ? 'Выполнено' : 'Done'}</span>
                </div>
              </div>
            </section>
          )}

          {/* День: фильтры, дела выбранного дня, выполненные */}
          {calMode === 'day' && (() => {
            const list = selectedEvents.filter(e => dayFilter === 'all' || e.category === dayFilter);
            const pending = list.filter(e => !e.done);
            const done = list.filter(e => e.done);
            return (
              <section style={{ marginTop: 18 }}>
                <div className="filters" aria-label={isRu ? 'Фильтр дел' : 'Filter'}>
                  {([
                    ['all', isRu ? 'Все дела' : 'All'],
                    ['fitness', isRu ? 'Тренировки' : 'Workouts'],
                    ['health', isRu ? 'Здоровье' : 'Health'],
                    ['personal', isRu ? 'Личное' : 'Personal'],
                  ] as const).map(([key, label]) => (
                    <button key={key} type="button" aria-pressed={dayFilter === key} onClick={() => setDayFilter(key)}>{label}</button>
                  ))}
                </div>
                <div className="day-heading">
                  <div>
                    <h2>{dayHeadingText}</h2>
                    <p>{daySubtitleText}</p>
                  </div>
                  {selectedDay !== todayStr && (
                    <button className="quiet" type="button" onClick={goToToday}>{isRu ? 'К сегодня' : 'Today'}</button>
                  )}
                </div>
                <div className="agenda">
                  {pending.length ? pending.map(ev => (
                    <TaskRow
                      key={ev.id}
                      ev={ev}
                      isRu={isRu}
                      onToggle={toggleDone}
                      onEdit={e => { setEditingEvent(e); setAddType(e.type || 'event'); setShowAddModal(true); }}
                    />
                  )) : (
                    <div className="empty">
                      <h3>{done.length ? (isRu ? 'Всё на этот день выполнено' : 'All done') : (isRu ? 'Пока свободно' : 'Nothing planned')}</h3>
                      <p>{dayFilter === 'all'
                        ? (isRu ? 'Можно оставить время для себя или добавить дело.' : 'Keep the time free or add something.')
                        : (isRu ? 'В этой категории больше нет запланированных дел.' : 'Nothing left in this category.')}</p>
                      <button className="quiet" type="button" onClick={() => openAddModal('event')}>{isRu ? 'Добавить дело' : 'Add task'}</button>
                    </div>
                  )}
                </div>
                {done.length > 0 && (
                  <>
                    <button
                      className="done-toggle"
                      type="button"
                      aria-expanded={showDone}
                      onClick={() => setShowDone(v => !v)}
                    >
                      <ChevronRight size={12} />
                      {isRu ? 'Выполнено' : 'Done'} <b>{done.length}</b>
                    </button>
                    {showDone && (
                      <div className="agenda completed">
                        {done.map(ev => (
                          <TaskRow
                            key={ev.id}
                            ev={ev}
                            isRu={isRu}
                            onToggle={toggleDone}
                            onEdit={e => { setEditingEvent(e); setAddType(e.type || 'event'); setShowAddModal(true); }}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            );
          })()}

          {/* Месяц: тренировки этого месяца списком */}
          {calMode === 'month' && (
            <section className="week-plan">
              <h2>{isRu ? 'Тренировки в этом месяце' : 'Workouts this month'}</h2>
              {monthWorkouts.length ? monthWorkouts.map(t => (
                <button
                  key={t.id}
                  className="upcoming-row"
                  type="button"
                  onClick={() => { setSelectedDay(t.date); setCalMode('day'); }}
                >
                  <span className="upcoming-date">
                    {new Date(`${t.date}T12:00:00`).toLocaleDateString(isRu ? 'ru-RU' : 'en-US', { weekday: 'short' })}
                    <b>{new Date(`${t.date}T12:00:00`).getDate()}</b>
                  </span>
                  <span className="upcoming-title">{t.title}</span>
                  <span>{t.done ? (isRu ? 'Выполнено' : 'Done') : (t.time || (isRu ? 'Без времени' : 'No time'))}</span>
                </button>
              )) : <p className="month-copy">{isRu ? 'Тренировок пока нет' : 'No workouts yet'}</p>}
            </section>
          )}

          {/* ИИ-чат: черновики из настоящего ИИ */}
          {/* Чат держим смонтированным и прячем стилем: при уходе на «День»
              размонтирование стирало бы подготовленные черновики и переписку,
              а пользователь как раз уходит проверить занятый день. */}
          {aiEverOpened && (
            <div hidden={calMode !== 'ai'}>
              <PlannerChat
                events={events}
                selectedDate={selectedDay}
                todayStr={todayStr}
                timezone={timezone}
                onAdd={fresh => onEventsChange([...events, ...fresh])}
                onOpenDate={date => { setSelectedDay(date); setCalMode('day'); }}
              />
            </div>
          )}
        </div>

      {/* ── Add/Edit Modal ── */}
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

// ── Event Card Component ──
/**
 * Строка дела по эталону: слева время и длительность, справа компактная
 * карточка (мин. 56px) и область отметки 44x44. Длинный текст переносится
 * и увеличивает высоту — фиксированной высоты у карточки нет.
 */
function TaskRow({ ev, isRu, onToggle, onEdit }: {
  ev: PlannerEvent;
  isRu: boolean;
  onToggle: (id: string) => void;
  onEdit: (ev: PlannerEvent) => void;
}) {
  const cat = getCategoryInfo(ev.category);
  return (
    <div className="task-row">
      <div className="task-time">
        {ev.time || (isRu ? 'Любое' : 'Any')}
      </div>
      <div className="task-card">
        <button
          className="task-body"
          type="button"
          onClick={() => onEdit(ev)}
          aria-label={`${ev.title}. ${isRu ? 'Открыть и изменить' : 'Open and edit'}`}
        >
          <h3>{ev.title}</h3>
          <span className={`task-meta ${ev.category === 'fitness' ? 'category-workout' : ''}`}>
            {isRu ? cat.label : cat.labelEn}
            {ev.description ? (isRu ? ' · Есть заметка' : ' · Has note') : ''}
          </span>
        </button>
        <button
          className="task-check"
          type="button"
          aria-pressed={Boolean(ev.done)}
          aria-label={`${ev.done ? (isRu ? 'Снять отметку' : 'Undo') : (isRu ? 'Выполнено' : 'Done')}: ${ev.title}`}
          onClick={() => onToggle(ev.id)}
        >
          <span>{ev.done ? <Check size={14} /> : null}</span>
        </button>
      </div>
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
      type: event?.type || type, priority,
    });
  };

  const titles = { event: isRu ? 'Событие' : 'Event', todo: isRu ? 'Задача' : 'Task', idea: isRu ? 'Идея' : 'Idea' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg-primary)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: '480px', padding: '24px 20px 32px', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700 }}>{event ? (isRu ? 'Редактировать' : 'Edit') : titles[type]}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '4px' }}><X size={20} /></button>
        </div>

        <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
          placeholder={type === 'idea' ? (isRu ? 'Опишите идею...' : 'Describe your idea...') : (isRu ? 'Что нужно сделать?' : 'What needs to be done?')}
          style={{ width: '100%', padding: '14px 16px', borderRadius: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: '15px', marginBottom: '12px' }}
        />

        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
          placeholder={isRu ? 'Подробности (необязательно)' : 'Details (optional)'}
          style={{ width: '100%', padding: '12px 16px', borderRadius: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: '13px', marginBottom: '12px', resize: 'vertical', fontFamily: 'inherit' }}
        />

        {/* Date & Time — for events and optionally todos */}
        {type !== 'idea' && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
            <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)}
              style={{ flex: 1, padding: '12px 14px', borderRadius: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: '13px' }}
            />
            <input type="time" value={time} onChange={e => setTime(e.target.value)}
              style={{ width: '120px', padding: '12px 14px', borderRadius: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: '13px' }}
            />
          </div>
        )}

        {/* Priority — for todos */}
        {type === 'todo' && (
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', display: 'block' }}>
              {isRu ? 'Приоритет' : 'Priority'}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {PRIORITIES.map(p => (
                <button key={p.key} onClick={() => setPriority(p.key)} style={{
                  flex: 1, padding: '10px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                  border: priority === p.key ? `2px solid ${p.color}` : '1px solid var(--border)',
                  background: priority === p.key ? `${p.color}15` : 'var(--bg-elevated)',
                  color: priority === p.key ? p.color : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
                }}>
                  {p.emoji} {isRu ? p.label : p.labelEn}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Category */}
        <div style={{ marginBottom: '16px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', display: 'block' }}>
            {isRu ? 'Категория' : 'Category'}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {CATEGORIES.map(cat => (
              <button key={cat.key} onClick={() => setCategory(cat.key)} style={{
                padding: '8px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                border: category === cat.key ? `2px solid ${cat.color}` : '1px solid var(--border)',
                background: category === cat.key ? `${cat.color}15` : 'var(--bg-elevated)',
                color: category === cat.key ? cat.color : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', gap: '6px'
              }}>
                {cat.emoji} {isRu ? cat.label : cat.labelEn}
              </button>
            ))}
          </div>
        </div>

        {/* Reminders — for events with date+time */}
        {type === 'event' && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <Bell size={14} style={{ color: reminder ? 'var(--yellow)' : 'var(--text-muted)' }} />
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                {isRu ? 'Напомнить в Telegram' : 'Remind via Telegram'}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {REMINDER_OPTIONS.map(opt => {
                const active = reminderOffsets.includes(opt.key);
                return (
                  <button key={opt.key} onClick={() => toggleOffset(opt.key)} style={{
                    padding: '8px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                    border: active ? '2px solid var(--yellow)' : '1px solid var(--border)',
                    background: active ? 'rgba(234, 179, 8, 0.1)' : 'var(--bg-elevated)',
                    color: active ? 'var(--yellow)' : 'var(--text-muted)',
                  }}>
                    {isRu ? opt.label : opt.labelEn}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {onDelete && (
            <button onClick={onDelete} style={{ padding: '14px 20px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', fontSize: '14px', fontWeight: 700 }}>
              <Trash2 size={16} />
            </button>
          )}
          <button onClick={handleSave} disabled={!title.trim()} style={{
            flex: 1, padding: '14px', borderRadius: '12px',
            background: title.trim() ? 'var(--yellow)' : 'var(--bg-elevated)',
            border: 'none', color: title.trim() ? '#000' : 'var(--text-muted)',
            fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
          }}>
            <Save size={16} /> {isRu ? 'Сохранить' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

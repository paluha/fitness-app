'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Plus, X, ChevronLeft, ChevronRight, Edit2, Trash2, Save, Clock, Bell, Check, Lightbulb, ListTodo, CalendarDays, Archive, RotateCcw, Repeat } from 'lucide-react';

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

type PlannerTab = 'calendar' | 'todos' | 'ideas' | 'habits' | 'archive';

const HABIT_ICONS = ['💊', '🪥', '💧', '🏃', '📖', '🧘', '💤', '🍎', '🧴', '☀️'];

interface PlannerViewProps {
  events: PlannerEvent[];
  onEventsChange: (events: PlannerEvent[]) => void;
  habits: Habit[];
  onHabitsChange: (habits: Habit[]) => void;
  todayStr: string;
  lang: 'ru' | 'en';
}

export default function PlannerView({ events, onEventsChange, habits, onHabitsChange, todayStr, lang }: PlannerViewProps) {
  const [tab, setTab] = useState<PlannerTab>('calendar');
  const [viewMonth, setViewMonth] = useState(() => {
    if (!todayStr) return new Date();
    const [y, m] = todayStr.split('-').map(Number);
    return new Date(y, m - 1, 1);
  });
  const [selectedDay, setSelectedDay] = useState<string>(todayStr || formatDate(new Date()));
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<PlannerEvent | null>(null);
  const [addType, setAddType] = useState<'event' | 'todo' | 'idea'>('event');
  const [quickAddText, setQuickAddText] = useState('');

  const isRu = lang === 'ru';
  const monthNames = isRu ? MONTH_NAMES_RU : MONTH_NAMES_EN;
  const dayNames = isRu ? DAY_NAMES_RU : DAY_NAMES_EN;

  // Split events by type (exclude archived)
  const active = useMemo(() => events.filter(e => !e.archived), [events]);
  const archived = useMemo(() => events.filter(e => e.archived).sort((a, b) => (b.archivedAt || b.id).localeCompare(a.archivedAt || a.id)), [events]);
  const calendarEvents = useMemo(() => active.filter(e => e.type === 'event' || (!e.type && e.date)), [active]);
  const todos = useMemo(() => active.filter(e => e.type === 'todo'), [active]);
  const ideas = useMemo(() => active.filter(e => e.type === 'idea'), [active]);

  // Undone todos count for badge
  const undoneTodos = useMemo(() => todos.filter(t => !t.done).length, [todos]);

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

  const todayEvents = useMemo(() => (eventsByDate[todayStr] || []).filter(e => !e.done), [eventsByDate, todayStr]);
  const tomorrowStr = useMemo(() => {
    if (!todayStr) return '';
    const [y, m, d] = todayStr.split('-').map(Number);
    return formatDate(new Date(y, m - 1, d + 1));
  }, [todayStr]);
  const tomorrowEvents = useMemo(() => eventsByDate[tomorrowStr] || [], [eventsByDate, tomorrowStr]);
  const selectedEvents = useMemo(() => eventsByDate[selectedDay] || [], [eventsByDate, selectedDay]);

  const prevMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1));
  const nextMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1));
  const goToToday = () => {
    if (!todayStr) return;
    const [y, m] = todayStr.split('-').map(Number);
    setViewMonth(new Date(y, m - 1, 1));
    setSelectedDay(todayStr);
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
  const restoreEvent = (id: string) => {
    onEventsChange(events.map(e => e.id === id ? { ...e, archived: false, archivedAt: undefined } : e));
  };
  const permanentDelete = (id: string) => {
    onEventsChange(events.filter(e => e.id !== id));
  };
  const toggleDone = (id: string) => {
    onEventsChange(events.map(e => e.id === id ? { ...e, done: !e.done } : e));
  };

  // Quick add for todos/ideas
  const handleQuickAdd = (type: 'todo' | 'idea') => {
    if (!quickAddText.trim()) return;
    const ev: PlannerEvent = {
      id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      date: '',
      time: '',
      title: quickAddText.trim(),
      description: '',
      category: type === 'idea' ? 'personal' : 'other',
      done: false,
      reminder: false,
      type,
      priority: 'medium',
    };
    onEventsChange([...events, ev]);
    setQuickAddText('');
  };

  // Move todo to calendar
  const moveToCalendar = (id: string, date: string) => {
    onEventsChange(events.map(e => e.id === id ? { ...e, type: 'event' as const, date } : e));
  };

  // Convert idea to todo
  const ideaToTodo = (id: string) => {
    onEventsChange(events.map(e => e.id === id ? { ...e, type: 'todo' as const } : e));
  };

  const openAddModal = (type: 'event' | 'todo' | 'idea') => {
    setAddType(type);
    setEditingEvent(null);
    setShowAddModal(true);
  };

  return (
    <div style={{ padding: '0 20px 100px' }}>
      {/* ── Tab Switcher ── */}
      <div style={{
        display: 'flex', gap: '4px', padding: '4px',
        background: 'var(--bg-elevated)', borderRadius: '14px',
        marginBottom: '16px'
      }}>
        {([
          { key: 'calendar' as PlannerTab, icon: <CalendarDays size={14} />, label: isRu ? 'Календарь' : 'Calendar', badge: todayEvents.length || undefined },
          { key: 'todos' as PlannerTab, icon: <ListTodo size={14} />, label: isRu ? 'Дела' : 'To-Do', badge: undoneTodos || undefined },
          { key: 'habits' as PlannerTab, icon: <Repeat size={14} />, label: isRu ? 'Протокол' : 'Protocol', badge: (() => { const dow = (() => { const [y,m,d] = todayStr.split('-').map(Number); return new Date(y,m-1,d).getDay(); })(); return habits.filter(h => { if (!h.active) return false; const s = h.schedule||'daily'; if (s==='daily') return true; if (s==='weekdays') return dow>=1&&dow<=5; if (s==='weekends') return dow===0||dow===6; if (s==='custom'&&h.customDays) return h.customDays.includes(dow); return true; }).filter(h => !h.completedDates.includes(todayStr)).length || undefined; })() },
          { key: 'ideas' as PlannerTab, icon: <Lightbulb size={14} />, label: isRu ? 'Идеи' : 'Ideas', badge: ideas.length || undefined },
          { key: 'archive' as PlannerTab, icon: <Archive size={14} />, label: isRu ? 'Архив' : 'Archive', badge: archived.length || undefined },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: '10px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
              background: tab === t.key ? 'var(--yellow)' : 'transparent',
              color: tab === t.key ? '#000' : 'var(--text-muted)',
              border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              position: 'relative'
            }}
          >
            {t.icon}
            {t.label}
            {t.badge && t.badge > 0 && (
              <span style={{
                background: tab === t.key ? '#000' : 'var(--yellow)',
                color: tab === t.key ? 'var(--yellow)' : '#000',
                fontSize: '10px', fontWeight: 700, borderRadius: '6px',
                padding: '1px 5px', minWidth: '16px', textAlign: 'center'
              }}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════ CALENDAR TAB ══════════ */}
      {tab === 'calendar' && (
        <>
          {/* Notification Bar */}
          {(todayEvents.length > 0 || tomorrowEvents.length > 0) && (
            <div style={{ marginBottom: '16px' }}>
              {todayEvents.length > 0 && (
                <div style={{ background: 'rgba(234, 179, 8, 0.08)', border: '1px solid rgba(234, 179, 8, 0.2)', borderRadius: '12px', padding: '12px 16px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Bell size={14} style={{ color: 'var(--yellow)' }} />
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--yellow)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {isRu ? 'Сегодня' : 'Today'}
                    </span>
                  </div>
                  {todayEvents.map(ev => {
                    const cat = getCategoryInfo(ev.category);
                    return (
                      <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', fontSize: '13px' }}>
                        <span>{cat.emoji}</span>
                        {ev.time && <span style={{ color: 'var(--text-muted)', fontWeight: 600, minWidth: '42px' }}>{ev.time}</span>}
                        <span style={{ flex: 1 }}>{ev.title}</span>
                        <button onClick={() => toggleDone(ev.id)} style={{ background: 'none', border: 'none', color: 'var(--green)', padding: '4px' }}>
                          <Check size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {tomorrowEvents.length > 0 && (
                <div style={{ background: 'rgba(59, 130, 246, 0.06)', border: '1px solid rgba(59, 130, 246, 0.15)', borderRadius: '12px', padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Clock size={14} style={{ color: '#3b82f6' }} />
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {isRu ? 'Завтра' : 'Tomorrow'}
                    </span>
                  </div>
                  {tomorrowEvents.map(ev => {
                    const cat = getCategoryInfo(ev.category);
                    return (
                      <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                        <span>{cat.emoji}</span>
                        {ev.time && <span style={{ fontWeight: 600, minWidth: '42px' }}>{ev.time}</span>}
                        <span>{ev.title}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Calendar Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '8px' }}><ChevronLeft size={20} /></button>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '18px', fontWeight: 700 }}>{monthNames[viewMonth.getMonth()]} {viewMonth.getFullYear()}</span>
              {selectedDay !== todayStr && (
                <button onClick={goToToday} style={{ display: 'block', margin: '4px auto 0', background: 'none', border: 'none', color: 'var(--yellow)', fontSize: '11px', fontWeight: 600 }}>
                  {isRu ? '← Сегодня' : '← Today'}
                </button>
              )}
            </div>
            <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '8px' }}><ChevronRight size={20} /></button>
          </div>

          {/* Day Names */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
            {dayNames.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, padding: '4px' }}>{d}</div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '20px' }}>
            {calendarDays.map((day, i) => {
              const dayEvents = eventsByDate[day.date] || [];
              const isToday = day.date === todayStr;
              const isSelected = day.date === selectedDay;
              const isPast = day.date < todayStr;
              return (
                <button key={i} onClick={() => setSelectedDay(day.date)} style={{
                  background: isSelected ? 'var(--yellow)' : isToday ? 'rgba(234, 179, 8, 0.1)' : 'transparent',
                  border: isToday && !isSelected ? '1px solid rgba(234, 179, 8, 0.3)' : '1px solid transparent',
                  borderRadius: '10px', padding: '6px 2px', minHeight: '48px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                  opacity: day.isCurrentMonth ? 1 : 0.3,
                  color: isSelected ? '#000' : isPast && !isToday ? 'var(--text-muted)' : 'var(--text-primary)',
                  fontWeight: isToday ? 700 : 400, fontSize: '13px', cursor: 'pointer'
                }}>
                  <span>{day.day}</span>
                  {dayEvents.length > 0 && (
                    <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap', justifyContent: 'center' }}>
                      {dayEvents.slice(0, 3).map((ev, j) => (
                        <span key={j} style={{ width: '5px', height: '5px', borderRadius: '50%', background: ev.done ? 'var(--green)' : getCategoryInfo(ev.category).color, opacity: ev.done ? 0.5 : 1 }} />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected Day Events */}
          <div style={{ background: 'var(--bg-secondary)', borderRadius: '16px', border: '1px solid var(--border)', padding: '16px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '15px', fontWeight: 700 }}>
                {selectedDay === todayStr ? (isRu ? 'Сегодня' : 'Today') :
                  selectedDay === tomorrowStr ? (isRu ? 'Завтра' : 'Tomorrow') :
                    (() => { const [y, m, d] = selectedDay.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(isRu ? 'ru-RU' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' }); })()}
              </span>
              <button onClick={() => openAddModal('event')} style={{
                background: 'var(--yellow)', border: 'none', borderRadius: '10px', padding: '8px 14px',
                color: '#000', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px'
              }}>
                <Plus size={14} /> {isRu ? 'Добавить' : 'Add'}
              </button>
            </div>
            {selectedEvents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                {isRu ? 'Нет дел на этот день' : 'No events for this day'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {selectedEvents.map(ev => <EventCard key={ev.id} ev={ev} isRu={isRu} onToggle={toggleDone} onEdit={(e) => { setEditingEvent(e); setAddType(e.type || 'event'); setShowAddModal(true); }} onDelete={archiveEvent} />)}
              </div>
            )}
          </div>
        </>
      )}

      {/* ══════════ TO-DO TAB ══════════ */}
      {tab === 'todos' && (
        <>
          {/* Quick Add */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <input
              value={quickAddText}
              onChange={e => setQuickAddText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleQuickAdd('todo')}
              placeholder={isRu ? 'Быстро добавить дело...' : 'Quick add task...'}
              style={{
                flex: 1, padding: '12px 16px', borderRadius: '12px',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', fontSize: '14px'
              }}
            />
            <button onClick={() => handleQuickAdd('todo')} style={{
              background: 'var(--yellow)', border: 'none', borderRadius: '12px', padding: '12px 16px',
              color: '#000', fontWeight: 700, display: 'flex', alignItems: 'center'
            }}>
              <Plus size={18} />
            </button>
          </div>

          {/* Add detailed todo button */}
          <button onClick={() => openAddModal('todo')} style={{
            width: '100%', padding: '10px', borderRadius: '10px', background: 'transparent',
            border: '1px dashed var(--border)', color: 'var(--text-muted)', fontSize: '12px',
            fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
          }}>
            <Plus size={14} /> {isRu ? 'Подробная задача' : 'Detailed task'}
          </button>

          {/* Undone todos */}
          {todos.filter(t => !t.done).length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', display: 'block' }}>
                {isRu ? `Активные (${todos.filter(t => !t.done).length})` : `Active (${todos.filter(t => !t.done).length})`}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {todos.filter(t => !t.done).sort((a, b) => {
                  const prio = { high: 0, medium: 1, low: 2 };
                  const prioDiff = (prio[a.priority || 'medium'] || 1) - (prio[b.priority || 'medium'] || 1);
                  if (prioDiff !== 0) return prioDiff;
                  // Newer first (higher id timestamp = newer)
                  return b.id.localeCompare(a.id);
                }).map(ev => (
                  <EventCard key={ev.id} ev={ev} isRu={isRu} onToggle={toggleDone}
                    onEdit={(e) => { setEditingEvent(e); setAddType('todo'); setShowAddModal(true); }}
                    onDelete={archiveEvent}
                    onMoveToCalendar={(id) => moveToCalendar(id, todayStr)}
                    showPriority
                  />
                ))}
              </div>
            </div>
          )}

          {/* Done todos */}
          {todos.filter(t => t.done).length > 0 && (
            <div>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', display: 'block' }}>
                {isRu ? `Выполнено (${todos.filter(t => t.done).length})` : `Done (${todos.filter(t => t.done).length})`}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {todos.filter(t => t.done).sort((a, b) => b.id.localeCompare(a.id)).slice(0, 10).map(ev => (
                  <EventCard key={ev.id} ev={ev} isRu={isRu} onToggle={toggleDone}
                    onEdit={(e) => { setEditingEvent(e); setAddType('todo'); setShowAddModal(true); }}
                    onDelete={archiveEvent}
                  />
                ))}
              </div>
            </div>
          )}

          {todos.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              <ListTodo size={32} style={{ marginBottom: '12px', opacity: 0.3 }} />
              <p style={{ fontSize: '14px' }}>{isRu ? 'Список дел пуст' : 'No tasks yet'}</p>
              <p style={{ fontSize: '12px', marginTop: '4px' }}>{isRu ? 'Добавьте первое дело выше' : 'Add your first task above'}</p>
            </div>
          )}
        </>
      )}

      {/* ══════════ IDEAS TAB ══════════ */}
      {tab === 'ideas' && (
        <>
          {/* Quick Add Idea */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <input
              value={quickAddText}
              onChange={e => setQuickAddText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleQuickAdd('idea')}
              placeholder={isRu ? 'Записать идею...' : 'Write down an idea...'}
              style={{
                flex: 1, padding: '12px 16px', borderRadius: '12px',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', fontSize: '14px'
              }}
            />
            <button onClick={() => handleQuickAdd('idea')} style={{
              background: '#a855f7', border: 'none', borderRadius: '12px', padding: '12px 16px',
              color: '#fff', fontWeight: 700, display: 'flex', alignItems: 'center'
            }}>
              <Lightbulb size={18} />
            </button>
          </div>

          <button onClick={() => openAddModal('idea')} style={{
            width: '100%', padding: '10px', borderRadius: '10px', background: 'transparent',
            border: '1px dashed var(--border)', color: 'var(--text-muted)', fontSize: '12px',
            fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
          }}>
            <Plus size={14} /> {isRu ? 'Подробная идея' : 'Detailed idea'}
          </button>

          {ideas.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[...ideas].sort((a, b) => b.id.localeCompare(a.id)).map(ev => (
                <div key={ev.id} style={{
                  padding: '14px', background: 'rgba(168, 85, 247, 0.05)', borderRadius: '12px',
                  border: '1px solid rgba(168, 85, 247, 0.15)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <Lightbulb size={16} style={{ color: '#a855f7', marginTop: '2px', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600 }}>{ev.title}</div>
                      {ev.description && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.4 }}>{ev.description}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      <button onClick={() => ideaToTodo(ev.id)} title={isRu ? 'В дела' : 'To tasks'}
                        style={{ background: 'none', border: 'none', color: 'var(--yellow)', padding: '4px' }}>
                        <ListTodo size={14} />
                      </button>
                      <button onClick={() => { setEditingEvent(ev); setAddType('idea'); setShowAddModal(true); }}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '4px' }}>
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => { archiveEvent(ev.id); }}
                        style={{ background: 'none', border: 'none', color: '#ef4444', padding: '4px' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              <Lightbulb size={32} style={{ marginBottom: '12px', opacity: 0.3 }} />
              <p style={{ fontSize: '14px' }}>{isRu ? 'Пока нет идей' : 'No ideas yet'}</p>
              <p style={{ fontSize: '12px', marginTop: '4px' }}>{isRu ? 'Запишите первую идею выше' : 'Write your first idea above'}</p>
            </div>
          )}
        </>
      )}

      {/* ══════════ HABITS TAB ══════════ */}
      {tab === 'habits' && (
        <HabitsSection habits={habits} onHabitsChange={onHabitsChange} todayStr={todayStr} isRu={isRu} />
      )}

      {/* ══════════ ARCHIVE TAB ══════════ */}
      {tab === 'archive' && (
        <>
          {archived.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {archived.map(ev => {
                const cat = CATEGORIES.find(c => c.key === ev.category) || CATEGORIES[6];
                return (
                  <div key={ev.id} style={{
                    display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
                    background: 'var(--bg-elevated)', borderRadius: '12px',
                    border: '1px solid var(--border)', opacity: 0.7
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600 }}>
                        {cat.emoji} {ev.title}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                        <span style={{ color: cat.color, background: `${cat.color}15`, padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                          {isRu ? cat.label : cat.labelEn}
                        </span>
                        {ev.date && <span>{ev.date}</span>}
                        <span>{ev.type === 'event' ? '📅' : ev.type === 'idea' ? '💡' : '📋'}</span>
                      </div>
                    </div>
                    <button onClick={() => restoreEvent(ev.id)}
                      title={isRu ? 'Восстановить' : 'Restore'}
                      style={{ background: 'none', border: 'none', color: 'var(--green)', padding: '8px' }}>
                      <RotateCcw size={16} />
                    </button>
                    <button onClick={() => permanentDelete(ev.id)}
                      title={isRu ? 'Удалить навсегда' : 'Delete permanently'}
                      style={{ background: 'none', border: 'none', color: '#ef4444', padding: '8px', opacity: 0.5 }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              <Archive size={32} style={{ marginBottom: '12px', opacity: 0.3 }} />
              <p style={{ fontSize: '14px' }}>{isRu ? 'Архив пуст' : 'Archive is empty'}</p>
              <p style={{ fontSize: '12px', marginTop: '4px' }}>{isRu ? 'Удалённые записи будут здесь' : 'Deleted items will appear here'}</p>
            </div>
          )}
        </>
      )}

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
function EventCard({ ev, isRu, onToggle, onEdit, onDelete, onMoveToCalendar, showPriority }: {
  ev: PlannerEvent; isRu: boolean;
  onToggle: (id: string) => void;
  onEdit: (ev: PlannerEvent) => void;
  onDelete: (id: string) => void;
  onMoveToCalendar?: (id: string) => void;
  showPriority?: boolean;
}) {
  const cat = getCategoryInfo(ev.category);
  const prio = PRIORITIES.find(p => p.key === ev.priority);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
      background: ev.done ? 'rgba(34, 197, 94, 0.05)' : 'var(--bg-elevated)',
      borderRadius: '12px', border: `1px solid ${ev.done ? 'rgba(34, 197, 94, 0.15)' : 'var(--border)'}`,
      opacity: ev.done ? 0.6 : 1
    }}>
      <button onClick={() => onToggle(ev.id)} style={{
        width: '22px', height: '22px', borderRadius: '6px',
        border: ev.done ? 'none' : '2px solid var(--border-strong)',
        background: ev.done ? 'var(--green)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', padding: 0
      }}>
        {ev.done && <Check size={14} style={{ color: '#000' }} />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '14px', fontWeight: 600,
          textDecoration: 'none',
          color: ev.done ? 'var(--text-muted)' : 'var(--text-primary)'
        }}>
          {cat.emoji} {ev.title}
        </div>
        {ev.description && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{ev.description}</div>}
        <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
          {ev.time && <span style={{ fontSize: '11px', color: cat.color, fontWeight: 600 }}>{ev.time}</span>}
          {showPriority && prio && (
            <span style={{ fontSize: '10px', color: prio.color, fontWeight: 600 }}>{prio.emoji} {isRu ? prio.label : prio.labelEn}</span>
          )}
          <span style={{ fontSize: '10px', color: cat.color, background: `${cat.color}15`, padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
            {isRu ? cat.label : cat.labelEn}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
        {onMoveToCalendar && !ev.done && (
          <button onClick={() => onMoveToCalendar(ev.id)} title={isRu ? 'В календарь' : 'To calendar'}
            style={{ background: 'none', border: 'none', color: 'var(--yellow)', padding: '6px' }}>
            <CalendarDays size={14} />
          </button>
        )}
        <button onClick={() => onEdit(ev)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '6px' }}><Edit2 size={14} /></button>
        <button onClick={() => { onDelete(ev.id); }} style={{ background: 'none', border: 'none', color: '#ef4444', padding: '6px' }}><Trash2 size={14} /></button>
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

// ── Habits Section ──
function HabitsSection({ habits, onHabitsChange, todayStr, isRu }: {
  habits: Habit[]; onHabitsChange: (h: Habit[]) => void; todayStr: string; isRu: boolean;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);

  // Filter habits that are scheduled for today
  const todayDayOfWeek = (() => { const [y, m, d] = todayStr.split('-').map(Number); return new Date(y, m - 1, d).getDay(); })();
  const isHabitScheduledToday = (h: Habit): boolean => {
    const sched = h.schedule || 'daily';
    if (sched === 'daily') return true;
    if (sched === 'weekdays') return todayDayOfWeek >= 1 && todayDayOfWeek <= 5;
    if (sched === 'weekends') return todayDayOfWeek === 0 || todayDayOfWeek === 6;
    if (sched === 'custom' && h.customDays) return h.customDays.includes(todayDayOfWeek);
    return true;
  };
  const activeHabits = habits.filter(h => h.active);
  const todayHabits = activeHabits.filter(isHabitScheduledToday);
  const doneToday = todayHabits.filter(h => h.completedDates.includes(todayStr)).length;

  const toggleToday = (id: string) => {
    onHabitsChange(habits.map(h => {
      if (h.id !== id) return h;
      const done = h.completedDates.includes(todayStr);
      return { ...h, completedDates: done ? h.completedDates.filter(d => d !== todayStr) : [...h.completedDates, todayStr] };
    }));
  };

  const saveHabit = (habit: Habit) => {
    if (editingHabit) {
      onHabitsChange(habits.map(h => h.id === habit.id ? habit : h));
    } else {
      onHabitsChange([...habits, habit]);
    }
    setShowAdd(false);
    setEditingHabit(null);
  };

  const deleteHabit = (id: string) => {
    onHabitsChange(habits.filter(h => h.id !== id));
  };

  const getStreak = (habit: Habit): number => {
    let streak = 0;
    const [y, m, d] = todayStr.split('-').map(Number);
    let checkDate = habit.completedDates.includes(todayStr) ? new Date(y, m - 1, d) : new Date(y, m - 1, d - 1);
    for (let i = 0; i < 365; i++) {
      if (habit.completedDates.includes(formatDate(checkDate))) { streak++; checkDate.setDate(checkDate.getDate() - 1); }
      else break;
    }
    return streak;
  };

  const last7 = useMemo(() => {
    const days: { date: string }[] = [];
    const [y, m, d] = todayStr.split('-').map(Number);
    for (let i = 6; i >= 0; i--) days.push({ date: formatDate(new Date(y, m - 1, d - i)) });
    return days;
  }, [todayStr]);

  return (
    <>
      {activeHabits.length > 0 && (
        <div style={{ background: 'var(--bg-secondary)', borderRadius: '14px', border: '1px solid var(--border)', padding: '14px 16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700 }}>{isRu ? 'Сегодня' : 'Today'}</span>
            <span style={{ fontSize: '12px', color: doneToday === todayHabits.length ? 'var(--green)' : 'var(--text-muted)', fontWeight: 600 }}>{doneToday}/{todayHabits.length}</span>
          </div>
          <div style={{ height: '4px', background: 'var(--bg-elevated)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: '2px', transition: 'width 0.3s', width: todayHabits.length > 0 ? `${(doneToday / todayHabits.length) * 100}%` : '0%', background: doneToday === todayHabits.length ? 'var(--green)' : 'var(--yellow)' }} />
          </div>
        </div>
      )}

      {(() => {
        const sortedToday = [...todayHabits].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
        const supplements = sortedToday.filter(h => h.isSupplement);
        const regular = sortedToday.filter(h => !h.isSupplement);
        const schedLabels: Record<string, string> = isRu
          ? { daily: '', weekdays: 'Будни', weekends: 'Выходные', custom: 'По дням' }
          : { daily: '', weekdays: 'Weekdays', weekends: 'Weekends', custom: 'Custom' };
        const renderHabitCard = (habit: Habit) => {
          const done = habit.completedDates.includes(todayStr);
          const streak = getStreak(habit);
          const schedLabel = schedLabels[habit.schedule || 'daily'];
          return (
            <div key={habit.id} style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
              background: done ? 'rgba(34, 197, 94, 0.05)' : 'var(--bg-elevated)',
              borderRadius: '12px', border: `1px solid ${done ? 'rgba(34, 197, 94, 0.15)' : 'var(--border)'}`
            }}>
              <button onClick={() => toggleToday(habit.id)} style={{
                width: '28px', height: '28px', borderRadius: '8px',
                border: done ? 'none' : '2px solid var(--border-strong)',
                background: done ? 'var(--green)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', padding: 0, fontSize: '14px'
              }}>{done ? <Check size={16} style={{ color: '#000' }} /> : habit.icon}</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, opacity: done ? 0.6 : 1 }}>
                  {habit.title}
                  {habit.dosage && <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)' }}>· {habit.dosage}</span>}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '2px' }}>
                  {habit.time && <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>{habit.time}</span>}
                  {streak > 0 && <span style={{ fontSize: '10px', color: 'var(--yellow)', fontWeight: 600 }}>🔥 {streak} {isRu ? 'дн.' : 'd'}</span>}
                  {habit.reminderEnabled && <Bell size={10} style={{ color: 'var(--text-muted)' }} />}
                  {schedLabel && <span style={{ fontSize: '9px', color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '1px 5px', borderRadius: '3px' }}>{schedLabel}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                {last7.map(day => (
                  <div key={day.date} style={{ width: '6px', height: '6px', borderRadius: '50%', background: habit.completedDates.includes(day.date) ? 'var(--green)' : 'var(--border-strong)' }} />
                ))}
              </div>
              <button onClick={() => { setEditingHabit(habit); setShowAdd(true); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '4px' }}><Edit2 size={14} /></button>
            </div>
          );
        };
        const sectionHeader = (text: string, count: number, total: number) => (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 4px', marginTop: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.6px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{text}</span>
            <span style={{ fontSize: '11px', fontWeight: 600, color: count === total ? 'var(--green)' : 'var(--text-muted)' }}>{count}/{total}</span>
          </div>
        );
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            {supplements.length > 0 && (
              <>
                {sectionHeader(isRu ? 'Добавки' : 'Supplements', supplements.filter(h => h.completedDates.includes(todayStr)).length, supplements.length)}
                {supplements.map(renderHabitCard)}
              </>
            )}
            {regular.length > 0 && (
              <>
                {supplements.length > 0 && sectionHeader(isRu ? 'Привычки' : 'Habits', regular.filter(h => h.completedDates.includes(todayStr)).length, regular.length)}
                {regular.map(renderHabitCard)}
              </>
            )}
          </div>
        );
      })()}

      <button onClick={() => { setEditingHabit(null); setShowAdd(true); }} style={{
        width: '100%', padding: '12px', borderRadius: '12px', background: 'var(--bg-elevated)',
        border: '1px dashed var(--border)', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 600,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', cursor: 'pointer'
      }}><Plus size={14} /> {isRu ? 'Добавить в протокол' : 'Add to protocol'}</button>

      {activeHabits.length === 0 && (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
          <Repeat size={32} style={{ marginBottom: '12px', opacity: 0.3 }} />
          <p style={{ fontSize: '14px' }}>{isRu ? 'Добавь ежедневный протокол' : 'Set up your daily protocol'}</p>
          <p style={{ fontSize: '12px', marginTop: '4px' }}>{isRu ? 'Лекарства, витамины, зубы, вода...' : 'Meds, vitamins, teeth, water...'}</p>
        </div>
      )}

      {showAdd && (
        <HabitModal habit={editingHabit} isRu={isRu} onSave={saveHabit}
          onDelete={editingHabit ? () => { deleteHabit(editingHabit.id); setShowAdd(false); setEditingHabit(null); } : undefined}
          onClose={() => { setShowAdd(false); setEditingHabit(null); }} />
      )}
    </>
  );
}

// ── Habit Add/Edit Modal ──
function HabitModal({ habit, isRu, onSave, onDelete, onClose }: {
  habit: Habit | null; isRu: boolean; onSave: (h: Habit) => void; onDelete?: () => void; onClose: () => void;
}) {
  const [title, setTitle] = useState(habit?.title || '');
  const [time, setTime] = useState(habit?.time || '');
  const [icon, setIcon] = useState(habit?.icon || '💊');
  const [reminderEnabled, setReminderEnabled] = useState(habit?.reminderEnabled ?? true);
  const [reminderMinutesBefore, setReminderMinutesBefore] = useState(habit?.reminderMinutesBefore ?? 0);
  const [schedule, setSchedule] = useState<HabitSchedule>(habit?.schedule || 'daily');
  const [customDays, setCustomDays] = useState<number[]>(habit?.customDays || [1, 2, 3, 4, 5]);
  const [isSupplement, setIsSupplement] = useState<boolean>(habit?.isSupplement ?? false);
  const [dosage, setDosage] = useState<string>(habit?.dosage || '');

  const toggleDay = (day: number) => {
    setCustomDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort());
  };

  const QUICK_TIMES = ['06:00', '07:00', '08:00', '09:00', '12:00', '14:00', '18:00', '20:00', '21:00', '22:00'];
  const REMINDER_BEFORE = [
    { min: 0, label: isRu ? 'Точно в срок' : 'On time' },
    { min: 5, label: isRu ? 'За 5 мин' : '5 min before' },
    { min: 15, label: isRu ? 'За 15 мин' : '15 min before' },
    { min: 30, label: isRu ? 'За 30 мин' : '30 min before' },
  ];
  const SCHEDULE_OPTIONS: { key: HabitSchedule; label: string }[] = [
    { key: 'daily', label: isRu ? 'Каждый день' : 'Every day' },
    { key: 'weekdays', label: isRu ? 'Будни (Пн-Пт)' : 'Weekdays' },
    { key: 'weekends', label: isRu ? 'Выходные (Сб-Вс)' : 'Weekends' },
    { key: 'custom', label: isRu ? 'По дням' : 'Custom days' },
  ];
  const DAY_LABELS = isRu ? ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      id: habit?.id || `hab_${Date.now()}`,
      title: title.trim(), time, icon, reminderEnabled, reminderMinutesBefore,
      schedule, customDays: schedule === 'custom' ? customDays : undefined,
      active: true, completedDates: habit?.completedDates || [],
      isSupplement,
      dosage: dosage.trim() || undefined,
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg-primary)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: '480px', padding: '24px 20px 32px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700 }}>{habit ? (isRu ? 'Редактировать' : 'Edit') : (isRu ? 'Новый пункт протокола' : 'New Protocol Item')}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '4px' }}><X size={20} /></button>
        </div>

        {/* Icon */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {HABIT_ICONS.map(ic => (
            <button key={ic} onClick={() => setIcon(ic)} style={{
              width: '40px', height: '40px', borderRadius: '10px', fontSize: '20px',
              border: icon === ic ? '2px solid var(--yellow)' : '1px solid var(--border)',
              background: icon === ic ? 'rgba(234, 179, 8, 0.1)' : 'var(--bg-elevated)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
            }}>{ic}</button>
          ))}
        </div>

        {/* Title */}
        <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
          placeholder={isRu ? 'Название' : 'Name'}
          style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: '15px', marginBottom: '12px' }} />

        {/* Supplement toggle + dosage */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button type="button" onClick={() => setIsSupplement(v => !v)}
            style={{
              padding: '10px 14px', borderRadius: '12px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              border: isSupplement ? '1px solid rgba(234, 179, 8, 0.4)' : '1px solid var(--border)',
              background: isSupplement ? 'rgba(234, 179, 8, 0.1)' : 'var(--bg-elevated)',
              color: isSupplement ? 'var(--yellow)' : 'var(--text-muted)',
              display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0,
            }}>
            {isSupplement ? '💊 ✓' : '💊'} {isRu ? 'Добавка' : 'Supplement'}
          </button>
          {isSupplement && (
            <input value={dosage} onChange={e => setDosage(e.target.value)}
              placeholder={isRu ? 'Дозировка (напр. 500мг, 1 капс.)' : 'Dosage (e.g. 500mg, 1 cap)'}
              style={{ flex: 1, minWidth: 0, padding: '10px 14px', borderRadius: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: '13px' }} />
          )}
        </div>

        {/* Time — quick select */}
        <div style={{ marginBottom: '16px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            ⏰ {isRu ? 'Время' : 'Time'}
          </span>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {QUICK_TIMES.map(t => (
              <button key={t} onClick={() => setTime(t)} style={{
                padding: '8px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                border: time === t ? '2px solid var(--yellow)' : '1px solid var(--border)',
                background: time === t ? 'rgba(234, 179, 8, 0.1)' : 'var(--bg-elevated)',
                color: time === t ? 'var(--yellow)' : 'var(--text-muted)', cursor: 'pointer'
              }}>{t.replace(':00', '')}</button>
            ))}
            <input type="time" value={time} onChange={e => setTime(e.target.value)}
              style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: '13px', width: '90px' }} />
          </div>
        </div>

        {/* Schedule */}
        <div style={{ marginBottom: '16px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            📅 {isRu ? 'Повтор' : 'Schedule'}
          </span>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {SCHEDULE_OPTIONS.map(opt => (
              <button key={opt.key} onClick={() => setSchedule(opt.key)} style={{
                padding: '8px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                border: schedule === opt.key ? '2px solid var(--green)' : '1px solid var(--border)',
                background: schedule === opt.key ? 'rgba(34, 197, 94, 0.08)' : 'var(--bg-elevated)',
                color: schedule === opt.key ? 'var(--green)' : 'var(--text-muted)', cursor: 'pointer'
              }}>{opt.label}</button>
            ))}
          </div>
          {/* Custom days picker */}
          {schedule === 'custom' && (
            <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
              {DAY_LABELS.map((label, i) => (
                <button key={i} onClick={() => toggleDay(i)} style={{
                  flex: 1, padding: '10px 0', borderRadius: '8px', fontSize: '12px', fontWeight: 700,
                  border: customDays.includes(i) ? '2px solid var(--green)' : '1px solid var(--border)',
                  background: customDays.includes(i) ? 'rgba(34, 197, 94, 0.1)' : 'var(--bg-elevated)',
                  color: customDays.includes(i) ? 'var(--green)' : 'var(--text-muted)', cursor: 'pointer'
                }}>{label}</button>
              ))}
            </div>
          )}
        </div>

        {/* Reminder */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <Bell size={14} style={{ color: reminderEnabled ? 'var(--yellow)' : 'var(--text-muted)' }} />
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {isRu ? 'Напоминание' : 'Reminder'}
            </span>
            <button onClick={() => setReminderEnabled(!reminderEnabled)} style={{
              marginLeft: 'auto', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
              background: reminderEnabled ? 'rgba(234, 179, 8, 0.1)' : 'var(--bg-elevated)',
              border: '1px solid var(--border)', color: reminderEnabled ? 'var(--yellow)' : 'var(--text-muted)', cursor: 'pointer'
            }}>{reminderEnabled ? (isRu ? 'Вкл' : 'On') : (isRu ? 'Выкл' : 'Off')}</button>
          </div>
          {reminderEnabled && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {REMINDER_BEFORE.map(r => (
                <button key={r.min} onClick={() => setReminderMinutesBefore(r.min)} style={{
                  padding: '8px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 600,
                  border: reminderMinutesBefore === r.min ? '2px solid var(--yellow)' : '1px solid var(--border)',
                  background: reminderMinutesBefore === r.min ? 'rgba(234, 179, 8, 0.1)' : 'var(--bg-elevated)',
                  color: reminderMinutesBefore === r.min ? 'var(--yellow)' : 'var(--text-muted)', cursor: 'pointer'
                }}>{r.label}</button>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {onDelete && (
            <button onClick={onDelete} style={{ padding: '14px 20px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', fontSize: '14px', fontWeight: 700 }}><Trash2 size={16} /></button>
          )}
          <button onClick={handleSave} disabled={!title.trim()} style={{
            flex: 1, padding: '14px', borderRadius: '12px',
            background: title.trim() ? 'var(--yellow)' : 'var(--bg-elevated)',
            border: 'none', color: title.trim() ? '#000' : 'var(--text-muted)',
            fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
          }}><Save size={16} /> {isRu ? 'Сохранить' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

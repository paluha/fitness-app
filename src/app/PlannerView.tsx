'use client';

import React, { useState, useMemo } from 'react';
import { Plus, X, ChevronLeft, ChevronRight, Edit2, Trash2, Save, Clock, Bell, Check } from 'lucide-react';

// ── Types ──
export interface PlannerEvent {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM or empty
  title: string;
  description: string;
  category: EventCategory;
  done: boolean;
  reminder: boolean; // show in today/tomorrow notifications
}

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
  todayStr: string;
  lang: 'ru' | 'en';
}

export default function PlannerView({ events, onEventsChange, todayStr, lang }: PlannerViewProps) {
  const [viewMonth, setViewMonth] = useState(() => {
    if (!todayStr) return new Date();
    const [y, m] = todayStr.split('-').map(Number);
    return new Date(y, m - 1, 1);
  });
  const [selectedDay, setSelectedDay] = useState<string>(todayStr || formatDate(new Date()));
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<PlannerEvent | null>(null);
  const [showNotifications, setShowNotifications] = useState(true);

  const isRu = lang === 'ru';
  const monthNames = isRu ? MONTH_NAMES_RU : MONTH_NAMES_EN;
  const dayNames = isRu ? DAY_NAMES_RU : DAY_NAMES_EN;

  // Calendar grid
  const calendarDays = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Monday = 0 offset
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    const days: { date: string; day: number; isCurrentMonth: boolean }[] = [];

    // Previous month padding
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({ date: formatDate(d), day: d.getDate(), isCurrentMonth: false });
    }

    // Current month
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      days.push({ date: formatDate(date), day: d, isCurrentMonth: true });
    }

    // Next month padding
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const date = new Date(year, month + 1, d);
      days.push({ date: formatDate(date), day: d, isCurrentMonth: false });
    }

    return days;
  }, [viewMonth]);

  // Events grouped by date
  const eventsByDate = useMemo(() => {
    const map: Record<string, PlannerEvent[]> = {};
    for (const ev of events) {
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    }
    // Sort by time
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    }
    return map;
  }, [events]);

  // Today & tomorrow events for notification bar
  const todayEvents = useMemo(() => eventsByDate[todayStr] || [], [eventsByDate, todayStr]);
  const tomorrowStr = useMemo(() => {
    if (!todayStr) return '';
    const [y, m, d] = todayStr.split('-').map(Number);
    return formatDate(new Date(y, m - 1, d + 1));
  }, [todayStr]);
  const tomorrowEvents = useMemo(() => eventsByDate[tomorrowStr] || [], [eventsByDate, tomorrowStr]);

  // Selected day events
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
  };

  const updateEvent = (ev: PlannerEvent) => {
    onEventsChange(events.map(e => e.id === ev.id ? ev : e));
    setEditingEvent(null);
  };

  const deleteEvent = (id: string) => {
    onEventsChange(events.filter(e => e.id !== id));
    setEditingEvent(null);
  };

  const toggleDone = (id: string) => {
    onEventsChange(events.map(e => e.id === id ? { ...e, done: !e.done } : e));
  };

  return (
    <div style={{ padding: '0 20px 100px' }}>
      {/* ── Notification Bar ── */}
      {showNotifications && (todayEvents.length > 0 || tomorrowEvents.length > 0) && (
        <div style={{ marginBottom: '16px' }}>
          {/* Today */}
          {todayEvents.filter(e => !e.done).length > 0 && (
            <div style={{
              background: 'rgba(234, 179, 8, 0.08)',
              border: '1px solid rgba(234, 179, 8, 0.2)',
              borderRadius: '12px',
              padding: '12px 16px',
              marginBottom: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Bell size={14} style={{ color: 'var(--yellow)' }} />
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--yellow)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {isRu ? 'Сегодня' : 'Today'}
                </span>
              </div>
              {todayEvents.filter(e => !e.done).map(ev => {
                const cat = getCategoryInfo(ev.category);
                return (
                  <div key={ev.id} style={{
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0',
                    fontSize: '13px'
                  }}>
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

          {/* Tomorrow */}
          {tomorrowEvents.length > 0 && (
            <div style={{
              background: 'rgba(59, 130, 246, 0.06)',
              border: '1px solid rgba(59, 130, 246, 0.15)',
              borderRadius: '12px',
              padding: '12px 16px'
            }}>
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

      {/* ── Calendar Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '16px'
      }}>
        <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '8px' }}>
          <ChevronLeft size={20} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <span style={{ fontSize: '18px', fontWeight: 700 }}>
            {monthNames[viewMonth.getMonth()]} {viewMonth.getFullYear()}
          </span>
          {selectedDay !== todayStr && (
            <button onClick={goToToday} style={{
              display: 'block', margin: '4px auto 0', background: 'none', border: 'none',
              color: 'var(--yellow)', fontSize: '11px', fontWeight: 600
            }}>
              {isRu ? '← Сегодня' : '← Today'}
            </button>
          )}
        </div>
        <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '8px' }}>
          <ChevronRight size={20} />
        </button>
      </div>

      {/* ── Day Names ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
        {dayNames.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, padding: '4px' }}>
            {d}
          </div>
        ))}
      </div>

      {/* ── Calendar Grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '20px' }}>
        {calendarDays.map((day, i) => {
          const dayEvents = eventsByDate[day.date] || [];
          const isToday = day.date === todayStr;
          const isSelected = day.date === selectedDay;
          const hasDone = dayEvents.some(e => e.done);
          const hasUndone = dayEvents.some(e => !e.done);
          const isPast = day.date < todayStr;

          return (
            <button
              key={i}
              onClick={() => setSelectedDay(day.date)}
              style={{
                background: isSelected ? 'var(--yellow)' : isToday ? 'rgba(234, 179, 8, 0.1)' : 'transparent',
                border: isToday && !isSelected ? '1px solid rgba(234, 179, 8, 0.3)' : '1px solid transparent',
                borderRadius: '10px',
                padding: '6px 2px',
                minHeight: '48px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                opacity: day.isCurrentMonth ? 1 : 0.3,
                color: isSelected ? '#000' : isPast && !isToday ? 'var(--text-muted)' : 'var(--text-primary)',
                fontWeight: isToday ? 700 : 400,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              <span>{day.day}</span>
              {dayEvents.length > 0 && (
                <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {dayEvents.slice(0, 3).map((ev, j) => (
                    <span key={j} style={{
                      width: '5px', height: '5px', borderRadius: '50%',
                      background: ev.done ? 'var(--green)' : getCategoryInfo(ev.category).color,
                      opacity: ev.done ? 0.5 : 1
                    }} />
                  ))}
                  {dayEvents.length > 3 && (
                    <span style={{ fontSize: '8px', color: isSelected ? '#000' : 'var(--text-muted)' }}>+{dayEvents.length - 3}</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Selected Day Events ── */}
      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: '16px',
        border: '1px solid var(--border)',
        padding: '16px',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ fontSize: '15px', fontWeight: 700 }}>
            {selectedDay === todayStr ? (isRu ? 'Сегодня' : 'Today') :
              selectedDay === tomorrowStr ? (isRu ? 'Завтра' : 'Tomorrow') :
                (() => {
                  const [y, m, d] = selectedDay.split('-').map(Number);
                  const date = new Date(y, m - 1, d);
                  return date.toLocaleDateString(isRu ? 'ru-RU' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' });
                })()}
          </span>
          <button
            onClick={() => { setShowAddModal(true); setEditingEvent(null); }}
            style={{
              background: 'var(--yellow)',
              border: 'none',
              borderRadius: '10px',
              padding: '8px 14px',
              color: '#000',
              fontSize: '13px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Plus size={14} />
            {isRu ? 'Добавить' : 'Add'}
          </button>
        </div>

        {selectedEvents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
            {isRu ? 'Нет дел на этот день' : 'No events for this day'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {selectedEvents.map(ev => {
              const cat = getCategoryInfo(ev.category);
              return (
                <div key={ev.id} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '12px',
                  background: ev.done ? 'rgba(34, 197, 94, 0.05)' : 'var(--bg-elevated)',
                  borderRadius: '12px',
                  border: `1px solid ${ev.done ? 'rgba(34, 197, 94, 0.15)' : 'var(--border)'}`,
                  opacity: ev.done ? 0.6 : 1
                }}>
                  {/* Done toggle */}
                  <button
                    onClick={() => toggleDone(ev.id)}
                    style={{
                      width: '22px', height: '22px', borderRadius: '6px',
                      border: ev.done ? 'none' : `2px solid ${cat.color}`,
                      background: ev.done ? 'var(--green)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, cursor: 'pointer', padding: 0
                    }}
                  >
                    {ev.done && <Check size={14} style={{ color: '#000' }} />}
                  </button>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '14px', fontWeight: 600,
                      textDecoration: ev.done ? 'line-through' : 'none',
                      color: ev.done ? 'var(--text-muted)' : 'var(--text-primary)'
                    }}>
                      {cat.emoji} {ev.title}
                    </div>
                    {ev.description && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {ev.description}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center' }}>
                      {ev.time && (
                        <span style={{ fontSize: '11px', color: cat.color, fontWeight: 600 }}>
                          {ev.time}
                        </span>
                      )}
                      <span style={{
                        fontSize: '10px', color: cat.color, background: `${cat.color}15`,
                        padding: '2px 8px', borderRadius: '4px', fontWeight: 600
                      }}>
                        {isRu ? cat.label : cat.labelEn}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={() => { setEditingEvent(ev); setShowAddModal(true); }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '6px' }}>
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => deleteEvent(ev.id)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', padding: '6px' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Category Legend ── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center',
        padding: '8px', fontSize: '11px', color: 'var(--text-muted)'
      }}>
        {CATEGORIES.map(cat => (
          <span key={cat.key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: cat.color }} />
            {isRu ? cat.label : cat.labelEn}
          </span>
        ))}
      </div>

      {/* ── Add/Edit Modal ── */}
      {showAddModal && (
        <EventModal
          event={editingEvent}
          date={selectedDay}
          lang={lang}
          onSave={(ev) => editingEvent ? updateEvent(ev) : addEvent(ev)}
          onClose={() => { setShowAddModal(false); setEditingEvent(null); }}
          onDelete={editingEvent ? () => deleteEvent(editingEvent.id) : undefined}
        />
      )}
    </div>
  );
}

// ── Event Add/Edit Modal ──
function EventModal({
  event, date, lang, onSave, onClose, onDelete
}: {
  event: PlannerEvent | null;
  date: string;
  lang: 'ru' | 'en';
  onSave: (ev: PlannerEvent) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const isRu = lang === 'ru';
  const [title, setTitle] = useState(event?.title || '');
  const [description, setDescription] = useState(event?.description || '');
  const [time, setTime] = useState(event?.time || '');
  const [category, setCategory] = useState<EventCategory>(event?.category || 'personal');
  const [eventDate, setEventDate] = useState(event?.date || date);
  const [reminder, setReminder] = useState(event?.reminder ?? true);

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      id: event?.id || `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      date: eventDate,
      time,
      title: title.trim(),
      description: description.trim(),
      category,
      done: event?.done || false,
      reminder,
    });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      zIndex: 1000, padding: '0 0 0 0'
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--bg-primary)',
        borderRadius: '20px 20px 0 0',
        width: '100%', maxWidth: '480px',
        padding: '24px 20px 32px',
        maxHeight: '85vh', overflowY: 'auto'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700 }}>
            {event ? (isRu ? 'Редактировать' : 'Edit Event') : (isRu ? 'Новое дело' : 'New Event')}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '4px' }}>
            <X size={20} />
          </button>
        </div>

        {/* Title */}
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={isRu ? 'Что нужно сделать?' : 'What needs to be done?'}
          autoFocus
          style={{
            width: '100%', padding: '14px 16px', borderRadius: '12px',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', fontSize: '15px', marginBottom: '12px'
          }}
        />

        {/* Description */}
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={isRu ? 'Подробности (необязательно)' : 'Details (optional)'}
          rows={2}
          style={{
            width: '100%', padding: '12px 16px', borderRadius: '12px',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', fontSize: '13px', marginBottom: '12px',
            resize: 'vertical', fontFamily: 'inherit'
          }}
        />

        {/* Date & Time */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
          <input
            type="date"
            value={eventDate}
            onChange={e => setEventDate(e.target.value)}
            style={{
              flex: 1, padding: '12px 14px', borderRadius: '12px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', fontSize: '13px'
            }}
          />
          <input
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            style={{
              width: '120px', padding: '12px 14px', borderRadius: '12px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', fontSize: '13px'
            }}
          />
        </div>

        {/* Category */}
        <div style={{ marginBottom: '16px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', display: 'block' }}>
            {isRu ? 'Категория' : 'Category'}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {CATEGORIES.map(cat => (
              <button
                key={cat.key}
                onClick={() => setCategory(cat.key)}
                style={{
                  padding: '8px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                  border: category === cat.key ? `2px solid ${cat.color}` : '1px solid var(--border)',
                  background: category === cat.key ? `${cat.color}15` : 'var(--bg-elevated)',
                  color: category === cat.key ? cat.color : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}
              >
                {cat.emoji} {isRu ? cat.label : cat.labelEn}
              </button>
            ))}
          </div>
        </div>

        {/* Reminder toggle */}
        <button
          onClick={() => setReminder(!reminder)}
          style={{
            display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
            padding: '12px 16px', borderRadius: '12px',
            background: reminder ? 'rgba(234, 179, 8, 0.08)' : 'var(--bg-elevated)',
            border: reminder ? '1px solid rgba(234, 179, 8, 0.2)' : '1px solid var(--border)',
            color: reminder ? 'var(--yellow)' : 'var(--text-muted)',
            fontSize: '13px', fontWeight: 600, marginBottom: '20px'
          }}
        >
          <Bell size={16} />
          {isRu ? 'Напоминание' : 'Reminder'}
          <span style={{ marginLeft: 'auto', fontSize: '11px' }}>
            {reminder ? (isRu ? 'Вкл' : 'On') : (isRu ? 'Выкл' : 'Off')}
          </span>
        </button>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {onDelete && (
            <button onClick={onDelete} style={{
              padding: '14px 20px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', fontSize: '14px', fontWeight: 700
            }}>
              <Trash2 size={16} />
            </button>
          )}
          <button onClick={handleSave} style={{
            flex: 1, padding: '14px', borderRadius: '12px',
            background: title.trim() ? 'var(--yellow)' : 'var(--bg-elevated)',
            border: 'none', color: title.trim() ? '#000' : 'var(--text-muted)',
            fontSize: '15px', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
          }} disabled={!title.trim()}>
            <Save size={16} />
            {isRu ? 'Сохранить' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

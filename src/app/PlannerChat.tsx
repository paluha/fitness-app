'use client';

/**
 * Вкладка «ИИ-чат» планера по эталону design/trainx-planner-reference.html.
 *
 * Пользователь описывает планы текстом → настоящий ИИ (/api/planner/plan)
 * возвращает ЧЕРНОВИКИ → их можно править прямо здесь и уточнять в чате →
 * только по кнопке «Добавить в календарь» они становятся делами.
 *
 * До нажатия ничего не сохраняется в календарь. Локального разбора текста
 * из макета здесь нет: без ИИ раздел честно сообщает, что недоступен.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { PlannerEvent, EventCategory } from './PlannerView';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
}

/** Черновик — ещё НЕ дело календаря. */
export interface PlannerDraft {
  id: string;
  title: string;
  date: string;
  time: string;
  category: 'workout' | 'health' | 'personal';
  duration: number | null;
  note: string;
}

const CATEGORY_LABELS: Record<PlannerDraft['category'], string> = {
  workout: 'Тренировка',
  health: 'Здоровье',
  personal: 'Личное',
};

/** Категории планера богаче трёх из макета — сводим одну к другой. */
const toEventCategory = (c: PlannerDraft['category']): EventCategory =>
  c === 'workout' ? 'fitness' : c === 'health' ? 'health' : 'personal';

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const parseDate = (s: string) => new Date(`${s}T12:00:00`);
const dateLabel = (s: string, opts: Intl.DateTimeFormatOptions) =>
  parseDate(s).toLocaleDateString('ru-RU', opts);

/** Пересечение по времени — предупреждаем, но не запрещаем. */
function overlaps(a: { date: string; time: string; duration: number | null }, b: { date: string; time: string; duration: number | null; done?: boolean }) {
  if (a.date !== b.date || !a.time || !b.time || b.done) return false;
  const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const x = min(a.time), y = min(b.time);
  return x < y + (b.duration || 1) && y < x + (a.duration || 1);
}

export default function PlannerChat({
  events, selectedDate, todayStr, timezone, onAdd, onOpenDate,
}: {
  events: PlannerEvent[];
  selectedDate: string;
  todayStr: string;
  timezone: string;
  /** Добавить готовые дела в календарь. Вызывается только по кнопке. */
  onAdd: (events: PlannerEvent[]) => void;
  onOpenDate: (date: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [drafts, setDrafts] = useState<PlannerDraft[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [lastAddedDate, setLastAddedDate] = useState<string | null>(null);
  const [openDrafts, setOpenDrafts] = useState<string[]>([]);
  // Один запрос за раз: отменённый ответ не должен подменить черновики.
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Защита от двойного нажатия «Добавить в календарь».
  const addingRef = useRef(false);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const run = ++runRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setMessages(prev => [...prev, { role: 'user' as const, text: trimmed }].slice(-40));

    try {
      const res = await fetch('/api/planner/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: trimmed,
          today: todayStr,
          selectedDate,
          timezone,
          history: messages.slice(-12),
          // id черновика нужен только интерфейсу — модели он не интересен.
          drafts: drafts.map(d => ({ title: d.title, date: d.date, time: d.time, category: d.category, duration: d.duration, note: d.note })),
          existingTasks: events
            .filter(e => e.date && !e.archived)
            .slice(0, 60)
            .map(e => ({ title: e.title, date: e.date, time: e.time, done: e.done })),
        }),
      });
      if (run !== runRef.current) return;
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Не удалось разобрать сообщение.');
      }
      // Ответ пришёл — поле очищаем только теперь, при ошибке текст остаётся.
      setInput('');
      setMessages(prev => [...prev, { role: 'assistant' as const, text: data.reply }].slice(-40));
      // Модель возвращает ВЕСЬ список черновиков, включая неизменённые.
      if (Array.isArray(data.tasks) && !data.needsClarification) {
        setDrafts(data.tasks.map((t: Omit<PlannerDraft, 'id'>) => ({ ...t, id: uid() })));
        setDraftError('');
      }
    } catch (e) {
      if (run !== runRef.current || (e as Error).name === 'AbortError') return;
      setMessages(prev => [...prev, {
        role: 'assistant' as const,
        text: (e as Error).message || 'Не получилось разобрать сообщение. Текст остался в поле — попробуй ещё раз.',
        error: true,
      }].slice(-40));
    } finally {
      if (run === runRef.current) { setBusy(false); abortRef.current = null; }
    }
  }, [busy, drafts, events, messages, selectedDate, timezone, todayStr]);

  const cancel = () => {
    runRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setMessages(prev => [...prev, { role: 'assistant' as const, text: 'Разбор остановлен. В календарь ничего не добавлено.' }].slice(-40));
  };

  const patchDraft = (id: string, field: keyof PlannerDraft, value: string) => {
    setDrafts(prev => prev.map(d => d.id === id
      ? { ...d, [field]: field === 'duration' ? (value === '' ? null : Number(value)) : value }
      : d));
  };

  const addToCalendar = () => {
    if (busy || addingRef.current || !drafts.length) return;
    // Проверяем черновики перед записью: кривую дату в календарь не пускаем.
    const bad = drafts.find(d =>
      !d.title.trim() || d.title.length > 140
      || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)
      || !Number.isFinite(parseDate(d.date).getTime())
      || (d.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time))
      || (d.duration !== null && (!Number.isInteger(d.duration) || d.duration < 1 || d.duration > 1440)));
    if (bad) {
      setDraftError('Проверь название, дату, время и длительность в черновиках.');
      return;
    }
    addingRef.current = true;
    try {
      // Дубли не добавляем: тот же день, время и название уже есть в календаре.
      const keyOf = (t: { date: string; time: string; title: string }) =>
        `${t.date}|${t.time}|${t.title.trim().toLocaleLowerCase('ru')}`;
      const known = new Set(events.filter(e => !e.archived).map(keyOf));
      const fresh: PlannerEvent[] = [];
      for (const d of drafts) {
        const k = keyOf(d);
        if (known.has(k)) continue;
        known.add(k);
        fresh.push({
          id: uid(),
          date: d.date,
          time: d.time,
          title: d.title.trim(),
          description: d.note || '',
          category: toEventCategory(d.category),
          done: false,
          reminder: false,
          type: 'event',
          priority: 'medium',
          reminderOffsets: [],
        });
      }
      const skipped = drafts.length - fresh.length;
      if (fresh.length) {
        onAdd(fresh);
        setLastAddedDate(fresh[0].date);
      }
      setDrafts([]);
      setDraftError('');
      setMessages(prev => [...prev, {
        role: 'assistant' as const,
        text: `${fresh.length ? `Добавлено в календарь: ${fresh.length}.` : 'Эти дела уже есть в календаре.'}${skipped ? ` Повторы не добавлены: ${skipped}.` : ''}`,
      }].slice(-40));
    } finally {
      addingRef.current = false;
    }
  };

  const conflictFor = (d: PlannerDraft) =>
    [...events.filter(e => e.date && !e.archived).map(e => ({
      title: e.title, date: e.date, time: e.time, duration: null as number | null, done: e.done,
    })), ...drafts.filter(x => x.id !== d.id)].find(t => overlaps(d, t));

  const contextLine = useMemo(
    () => `Без уточнения даты — ${dateLabel(selectedDate, { day: 'numeric', month: 'long' })}`,
    [selectedDate],
  );

  return (
    <section>
      <div className="ai-heading">
        <div>
          <h2>Расскажи о планах</h2>
          <p>{contextLine}</p>
        </div>
        <span className="ai-mode">ИИ</span>
      </div>

      {messages.length === 0 && (
        <div className="chat-welcome">
          <h3>Напиши всё одним сообщением</h3>
          <p>Я разложу дела по датам и времени, дам им названия и подготовлю для календаря.</p>
          <button
            className="example"
            type="button"
            disabled={busy}
            onClick={() => {
              const text = 'Завтра в 18:00 тренировка 60 мин\nВ 20:00 прогулка 30 мин\nВ среду в 08:00 взвеситься';
              setInput(text);
              send(text);
            }}
          >
            Попробовать пример <span>Тренировка, прогулка и замеры ↗</span>
          </button>
        </div>
      )}

      <div className="chat-log" role="log" aria-live="polite" aria-label="Переписка с планером">
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}${m.error ? ' error' : ''}`}>
            {m.role === 'assistant' && <span className="message-label">TRAINX</span>}
            {m.text}
          </div>
        ))}
      </div>

      {drafts.length > 0 && (
        <section className="draft-section">
          <div className="draft-title">
            <h3>Черновики · {drafts.length}</h3>
            <span>Проверь перед добавлением</span>
          </div>
          <div>
            {drafts.map(d => {
              const conflict = conflictFor(d);
              const isOpen = openDrafts.includes(d.id);
              return (
                <details
                  key={d.id}
                  className="draft-card"
                  open={isOpen}
                  onToggle={e => {
                    const open = (e.currentTarget as HTMLDetailsElement).open;
                    setOpenDrafts(prev => open ? (prev.includes(d.id) ? prev : [...prev, d.id]) : prev.filter(x => x !== d.id));
                  }}
                >
                  <summary>
                    <span>
                      <strong>{d.title || 'Без названия'}</strong>
                      <small>
                        {dateLabel(d.date, { day: 'numeric', month: 'short' })} · {d.time || 'Без времени'}
                        {d.duration ? ` · ${d.duration} мин` : ''} · {CATEGORY_LABELS[d.category]}
                      </small>
                    </span>
                    <span>Изменить</span>
                  </summary>
                  {conflict && (
                    <p className="draft-conflict">Пересекается с «{conflict.title}» — можно изменить время.</p>
                  )}
                  <div className="draft-editor">
                    <label className="field">
                      <span>Название</span>
                      <input value={d.title} maxLength={140} onChange={e => patchDraft(d.id, 'title', e.target.value)} />
                    </label>
                    <div className="fields-2">
                      <label className="field">
                        <span>Дата</span>
                        <input type="date" value={d.date} onChange={e => patchDraft(d.id, 'date', e.target.value)} />
                      </label>
                      <label className="field">
                        <span>Время</span>
                        <input type="time" value={d.time} onChange={e => patchDraft(d.id, 'time', e.target.value)} />
                      </label>
                    </div>
                    <div className="fields-2">
                      <label className="field">
                        <span>Категория</span>
                        <select value={d.category} onChange={e => patchDraft(d.id, 'category', e.target.value)}>
                          {Object.entries(CATEGORY_LABELS).map(([v, label]) => (
                            <option key={v} value={v}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Длительность, мин</span>
                        <input
                          type="number" min={1} max={1440}
                          value={d.duration ?? ''}
                          onChange={e => patchDraft(d.id, 'duration', e.target.value)}
                        />
                      </label>
                    </div>
                    <button
                      className="draft-remove"
                      type="button"
                      onClick={() => setDrafts(prev => prev.filter(x => x.id !== d.id))}
                    >
                      Убрать из списка
                    </button>
                  </div>
                </details>
              );
            })}
          </div>
          {!!draftError && <p className="form-error">{draftError}</p>}
          <button className="primary add-drafts" type="button" disabled={busy} onClick={addToCalendar}>
            Добавить в календарь · {drafts.length}
          </button>
        </section>
      )}

      {lastAddedDate && (
        <button className="open-added" type="button" onClick={() => onOpenDate(lastAddedDate)}>
          Открыть {dateLabel(lastAddedDate, { day: 'numeric', month: 'long' })} →
        </button>
      )}

      <form
        className="chat-compose"
        onSubmit={e => { e.preventDefault(); send(input); }}
      >
        <label className="sr-only" htmlFor="plannerChatInput">Сообщение планеру</label>
        <textarea
          id="plannerChatInput"
          rows={2}
          maxLength={3000}
          readOnly={busy}
          placeholder="Завтра в 18:00 тренировка, в 20:00 прогулка…"
          value={input}
          onChange={e => setInput(e.target.value)}
        />
        <div className="compose-bottom">
          <span>Можно уточнять подготовленные задания</span>
          <button className="primary" type="submit" disabled={busy || !input.trim()}>
            {busy ? 'Разбираю…' : 'Отправить'}
          </button>
          {busy && <button className="quiet" type="button" onClick={cancel}>Стоп</button>}
        </div>
      </form>
    </section>
  );
}

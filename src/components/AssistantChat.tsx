'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Paperclip, X, Flame, Dumbbell, FlaskConical } from 'lucide-react';

type Msg = { id?: string; role: 'user' | 'assistant'; content: string; createdAt?: string };

type Eaten = { kcal: number; p: number; f: number; c: number };
type Snapshot = {
  today: string;
  macros: {
    goal: { kcal: number | null; p: number | null; f: number | null; c: number | null };
    eaten: Eaten; meals: number;
    byDate: Record<string, { eaten: Eaten; meals: number }>;
  };
  lastWorkout: { date: string; name: string; done: number; total: number } | null;
  labs: { date: string; panelName: string | null; abnormal: number; total: number } | null;
};

// Время сообщения для подписи под капсулой: сегодня — «14:32», раньше — «28 авг, 14:32».
function fmtWhen(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  // am/pm-формат: «2:32 pm»
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  if (d.toDateString() === now.toDateString()) return time;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '') + ', ' + time;
}

// AI-ассистент. Режим `embedded` — полноэкранная вкладка (как в Superpower),
// рендерится внутри контентной области под нижним таб-баром.
// Цепляет данные пользователя на сервере (/api/chat) и помнит историю.
// Дизайн: белый «лист» чата; текст ИИ — без капсул; ответы пользователя —
// белая капсула с временем снизу; подтянутые данные — оформленные карточки.
export function AssistantChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [image, setImage] = useState<string | null>(null); // data-URL прикреплённого фото
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); // данные для карточек
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // история + снапшот данных для карточек подгружаются один раз при монтировании
  useEffect(() => {
    if (loaded) return;
    setLoaded(true);
    fetch('/api/chat')
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => {});
    fetch('/api/chat/snapshot')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSnapshot(d))
      .catch(() => {});
  }, [loaded]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Выбор фото: читаем в data-URL, сжимаем по ширине, чтобы не слать мегабайты.
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // позволяем выбрать тот же файл повторно
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const maxW = 1024;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) { setImage(src); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setImage(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => setImage(src);
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !image) || busy) return;
    const img = image;
    setInput('');
    setImage(null);
    setBusy(true);
    setMessages((m) => [
      ...m,
      { role: 'user', content: (text || '') + (img ? '\n📎 [фото]' : ''), createdAt: new Date().toISOString() },
      { role: 'assistant', content: '' },
    ]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, image: img }),
      });
      if (!res.ok || !res.body) throw new Error('chat failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      // дописываем последнее (assistant) сообщение по мере стрима
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + chunk };
          return copy;
        });
      }
    } catch {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { ...copy[copy.length - 1], content: 'Ошибка. Попробуйте ещё раз.' };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const canSend = !busy && (!!input.trim() || !!image);

  return (
    // Чат лежит прямо на белой странице (фон страницы красит page.tsx,
    // когда открыта вкладка ИИ) — без собственной капсулы и без шапки.
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* сообщения */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, textAlign: 'center', marginTop: 32, lineHeight: 1.5 }}>
            Спроси меня про тренировки, питание, прогресс.<br />Я вижу твои данные 💪
          </div>
        )}
        {messages.map((m, i) => {
          if (m.role === 'user') {
            const when = fmtWhen(m.createdAt);
            return (
              /* Ответ пользователя — белая капсула, снизу время отправки */
              <div key={m.id ?? i} style={{ alignSelf: 'flex-end', maxWidth: '88%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                <div style={{
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  boxShadow: '0 1px 2px rgba(26, 23, 18, 0.05)',
                  padding: '10px 13px', borderRadius: '14px 14px 4px 14px',
                  fontSize: 14, lineHeight: 1.45, wordBreak: 'break-word',
                }}>
                  <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>
                </div>
                {when && <span style={{ fontSize: 10, color: 'var(--text-muted)', paddingRight: 4 }}>{when}</span>}
              </div>
            );
          }
          return (
            /* Текст ИИ — без капсулы, обычный текст; капсулы остаются только
               у подтягиваемых данных (карточки питания/тренировки/анализов) */
            <div
              key={m.id ?? i}
              style={{
                alignSelf: 'stretch',
                color: 'var(--text-primary)',
                fontSize: 14, lineHeight: 1.55, wordBreak: 'break-word',
              }}
            >
              {renderWithCards(m.content || (busy ? '…' : ''), snapshot)}
            </div>
          );
        })}
      </div>

      {/* превью прикреплённого фото */}
      {image && (
        <div style={{ paddingTop: 10, display: 'flex' }}>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="вложение" style={{ maxHeight: 84, borderRadius: 10, border: '1px solid var(--border)' }} />
            <button
              onClick={() => setImage(null)}
              aria-label="убрать фото"
              style={{
                position: 'absolute', top: -8, right: -8, width: 22, height: 22, borderRadius: '50%',
                border: 'none', background: 'var(--bg-card)', color: 'var(--text-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ввод */}
      <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: '1px solid var(--border)', alignItems: 'flex-end' }}>
        <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} style={{ display: 'none' }} />
        {/* attach: прикрепить фото */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label="прикрепить фото"
          style={{
            width: 46, height: 46, borderRadius: 12, flexShrink: 0,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            color: image ? 'var(--yellow)' : 'var(--text-secondary)',
            cursor: busy ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Paperclip size={18} />
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Спроси что-нибудь…"
          rows={1}
          style={{
            flex: 1, resize: 'none', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            border: '1px solid var(--border)', borderRadius: 12,
            padding: '11px 13px', fontSize: 14, outline: 'none', maxHeight: 120,
          }}
        />
        {/* отправить — графитовая, не оранжевая */}
        <button
          onClick={send}
          disabled={!canSend}
          aria-label="отправить"
          style={{
            width: 46, height: 46, borderRadius: 12, border: 'none', flexShrink: 0,
            cursor: canSend ? 'pointer' : 'not-allowed',
            background: canSend ? 'var(--text-primary)' : 'var(--bg-elevated)',
            color: canSend ? 'var(--bg-primary)' : 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

// Разбиваем текст ответа на части по плейсхолдерам [[card:xxx]] или
// [[card:macros:ГГГГ-ММ-ДД]] и рендерим карточками, подставляя данные из snapshot.
function renderWithCards(text: string, snap: Snapshot | null): React.ReactNode {
  const parts = text.split(/(\[\[card:[a-zA-Z]+(?::\d{4}-\d{2}-\d{2})?\]\])/g);
  return parts.map((part, idx) => {
    const m = /^\[\[card:([a-zA-Z]+)(?::(\d{4}-\d{2}-\d{2}))?\]\]$/.exec(part);
    if (m) {
      const card = renderCard(m[1], m[2], snap);
      // если данных нет — не показываем пустой плейсхолдер
      return card ? <div key={idx}>{card}</div> : null;
    }
    if (!part) return null;
    return <span key={idx} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
  });
}

// Цветной пилюль-бейдж в правом углу карточки
function Pill({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span style={{ padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, color, background: bg, whiteSpace: 'nowrap', flexShrink: 0 }}>
      {text}
    </span>
  );
}

function renderCard(kind: string, date: string | undefined, snap: Snapshot | null): React.ReactNode {
  if (!snap) return null;
  if (kind === 'macros') {
    const { goal } = snap.macros;
    // дата из плейсхолдера, иначе сегодня
    const d = date || snap.today;
    const dayData = snap.macros.byDate[d] ?? (d === snap.today ? { eaten: snap.macros.eaten, meals: snap.macros.meals } : null);
    if (!dayData) return null; // за этот день еды нет — карточку не показываем
    const { eaten, meals } = dayData;
    const isToday = d === snap.today;
    const dateLabel = isToday ? 'сегодня' : (() => { try { return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', ''); } catch { return d; } })();
    const mealsWord = meals === 1 ? 'приём' : meals >= 2 && meals <= 4 ? 'приёма' : 'приёмов';
    const row = (label: string, val: number, g: number | null, color: string) => {
      const pct = g ? Math.min(100, Math.round((val / g) * 100)) : 0;
      return (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {val}{g ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> / {g}</span> : ''}
            </span>
          </div>
          {g ? (
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(26, 23, 18, 0.07)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color, transition: 'width 0.4s ease' }} />
            </div>
          ) : null}
        </div>
      );
    };
    return (
      <CardShell icon={<Flame size={15} />} accent="#f59e0b" title={`Питание · ${dateLabel}`}
        right={<span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{meals} {mealsWord}</span>}>
        {row('Калории', eaten.kcal, goal.kcal, '#f59e0b')}
        {row('Белок', eaten.p, goal.p, '#22c55e')}
        {row('Жиры', eaten.f, goal.f, '#f97316')}
        {row('Углеводы', eaten.c, goal.c, '#3b82f6')}
      </CardShell>
    );
  }
  if (kind === 'lastWorkout') {
    const w = snap.lastWorkout;
    if (!w) return null;
    const full = w.done === w.total;
    return (
      <CardShell icon={<Dumbbell size={15} />} accent="var(--blue)" title="Последняя тренировка"
        right={<Pill text={`${w.done}/${w.total}`} color={full ? 'var(--green)' : '#b45309'} bg={full ? 'var(--green-dim)' : 'rgba(245, 158, 11, 0.15)'} />}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{w.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{w.date}</div>
      </CardShell>
    );
  }
  if (kind === 'labs') {
    const l = snap.labs;
    if (!l) return null;
    return (
      <CardShell icon={<FlaskConical size={15} />} accent="var(--purple)" title="Последний анализ"
        right={<Pill text={l.abnormal > 0 ? `${l.abnormal} вне нормы` : 'всё в норме'}
          color={l.abnormal > 0 ? 'var(--red)' : 'var(--green)'}
          bg={l.abnormal > 0 ? 'var(--red-dim)' : 'var(--green-dim)'} />}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{l.panelName || 'Анализ'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{l.date} · {l.total} показателей</div>
      </CardShell>
    );
  }
  return null;
}

// Карточка «подтянутых данных»: мягкий тёплый фон, иконка в белом чипе с
// акцентным цветом, заголовок и бейдж справа — как поверхности Superpower.
function CardShell({ icon, title, accent, right, children }: {
  icon: React.ReactNode; title: string; accent: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={{
      margin: '10px 0', background: 'var(--bg-elevated)',
      borderRadius: 16, padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 9, background: 'var(--bg-card)', color: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          boxShadow: '0 1px 2px rgba(26, 23, 18, 0.06)',
        }}>
          {icon}
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

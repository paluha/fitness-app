'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, Send, Paperclip, X, Flame, Dumbbell, FlaskConical } from 'lucide-react';

type Msg = { id?: string; role: 'user' | 'assistant'; content: string };

type Snapshot = {
  today: string;
  macros: { goal: { kcal: number | null; p: number | null; f: number | null; c: number | null }; eaten: { kcal: number; p: number; f: number; c: number }; meals: number };
  lastWorkout: { date: string; name: string; done: number; total: number } | null;
  labs: { date: string; panelName: string | null; abnormal: number; total: number } | null;
};

// AI-ассистент. Режим `embedded` — полноэкранная вкладка (как в Superpower),
// рендерится внутри контентной области под нижним таб-баром.
// Цепляет данные пользователя на сервере (/api/chat) и помнит историю.
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
      { role: 'user', content: (text || '') + (img ? '\n📎 [фото]' : '') },
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* шапка */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px 12px', fontWeight: 700, color: 'var(--text-primary)' }}>
        <Sparkles size={20} color="var(--yellow)" /> AI-ассистент
      </div>

      {/* сообщения */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 8 }}>
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, textAlign: 'center', marginTop: 32, lineHeight: 1.5 }}>
            Спроси меня про тренировки, питание, прогресс.<br />Я вижу твои данные 💪
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={m.id ?? i}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '88%',
              background: m.role === 'user' ? 'var(--yellow)' : 'var(--bg-elevated)',
              color: m.role === 'user' ? '#000' : 'var(--text-primary)',
              border: m.role === 'user' ? 'none' : '1px solid var(--border)',
              padding: '10px 13px', borderRadius: 14,
              fontSize: 14, lineHeight: 1.45, wordBreak: 'break-word',
            }}
          >
            {m.role === 'assistant'
              ? renderWithCards(m.content || (busy ? '…' : ''), snapshot)
              : <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>}
          </div>
        ))}
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
        <button
          onClick={send}
          disabled={busy || (!input.trim() && !image)}
          aria-label="отправить"
          style={{
            width: 46, height: 46, borderRadius: 12, border: 'none', flexShrink: 0,
            cursor: busy || (!input.trim() && !image) ? 'not-allowed' : 'pointer',
            background: busy || (!input.trim() && !image) ? 'var(--bg-elevated)' : 'var(--yellow)',
            color: busy || (!input.trim() && !image) ? 'var(--text-secondary)' : '#000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

// Разбиваем текст ответа на части по плейсхолдерам [[card:xxx]] и
// рендерим их красивыми карточками, подставляя данные из snapshot.
function renderWithCards(text: string, snap: Snapshot | null): React.ReactNode {
  const parts = text.split(/(\[\[card:[a-zA-Z]+\]\])/g);
  return parts.map((part, idx) => {
    const m = /^\[\[card:([a-zA-Z]+)\]\]$/.exec(part);
    if (m) {
      const card = renderCard(m[1], snap);
      // если данных нет — не показываем пустой плейсхолдер
      return card ? <div key={idx}>{card}</div> : null;
    }
    if (!part) return null;
    return <span key={idx} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
  });
}

function renderCard(kind: string, snap: Snapshot | null): React.ReactNode {
  if (!snap) return null;
  if (kind === 'macros') {
    const { goal, eaten, meals } = snap.macros;
    const row = (label: string, val: number, g: number | null, color: string) => {
      const pct = g ? Math.min(100, Math.round((val / g) * 100)) : 0;
      return (
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
            <span style={{ fontWeight: 700 }}>{val}{g ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> / {g}</span> : ''}</span>
          </div>
          {g ? (
            <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color }} />
            </div>
          ) : null}
        </div>
      );
    };
    return (
      <CardShell icon={<Flame size={15} />} title={`Питание сегодня · ${meals} приём(ов)`}>
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
    return (
      <CardShell icon={<Dumbbell size={15} />} title="Последняя тренировка">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{w.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{w.date}</div>
          </div>
          <div style={{ fontWeight: 800, fontSize: 15, color: w.done === w.total ? 'var(--green)' : '#f59e0b' }}>
            {w.done}/{w.total}
          </div>
        </div>
      </CardShell>
    );
  }
  if (kind === 'labs') {
    const l = snap.labs;
    if (!l) return null;
    return (
      <CardShell icon={<FlaskConical size={15} />} title="Последний анализ">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{l.panelName || 'Анализ'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.date} · {l.total} показателей</div>
          </div>
          <div style={{ fontWeight: 800, fontSize: 13, color: l.abnormal > 0 ? '#ef4444' : 'var(--green)' }}>
            {l.abnormal > 0 ? `${l.abnormal} вне нормы` : 'всё в норме'}
          </div>
        </div>
      </CardShell>
    );
  }
  return null;
}

function CardShell({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      margin: '8px 0', background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: 'var(--yellow)', fontSize: 12, fontWeight: 700 }}>
        {icon}<span style={{ color: 'var(--text-secondary)' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

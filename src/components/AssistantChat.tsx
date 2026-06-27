'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, Send } from 'lucide-react';

type Msg = { id?: string; role: 'user' | 'assistant'; content: string };

// AI-ассистент. Режим `embedded` — полноэкранная вкладка (как в Superpower),
// рендерится внутри контентной области под нижним таб-баром.
// Цепляет данные пользователя на сервере (/api/chat) и помнит историю.
export function AssistantChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // история подгружается один раз при монтировании
  useEffect(() => {
    if (loaded) return;
    setLoaded(true);
    fetch('/api/chat')
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => {});
  }, [loaded]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
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
        <MessageCircle size={20} color="var(--yellow)" /> AI-ассистент
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
              fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          >
            {m.content || (m.role === 'assistant' && busy ? '…' : '')}
          </div>
        ))}
      </div>

      {/* ввод */}
      <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
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
          disabled={busy || !input.trim()}
          aria-label="отправить"
          style={{
            width: 46, borderRadius: 12, border: 'none', cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
            background: busy || !input.trim() ? 'var(--bg-elevated)' : 'var(--yellow)',
            color: busy || !input.trim() ? 'var(--text-secondary)' : '#000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

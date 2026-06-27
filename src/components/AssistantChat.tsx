'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';

type Msg = { id?: string; role: 'user' | 'assistant'; content: string };

// AI-ассистент: плавающая кнопка + выезжающая панель чата со стримингом.
// Цепляет данные пользователя на сервере (/api/chat) и помнит историю.
export function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // история подгружается при первом открытии
  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    fetch('/api/chat')
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => {});
  }, [open, loaded]);

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
    <>
      {/* плавающая кнопка */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="AI-ассистент"
          style={{
            position: 'fixed', right: 16, bottom: 84, zIndex: 1000,
            width: 56, height: 56, borderRadius: '50%', border: 'none',
            background: 'linear-gradient(135deg,#7c5cff,#5b8cff)', color: '#fff',
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <MessageCircle size={26} />
        </button>
      )}

      {/* панель чата */}
      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1001,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)',
          }}
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 480, height: '85vh',
              background: '#15171e', color: '#fff',
              borderRadius: '16px 16px 0 0', display: 'flex', flexDirection: 'column',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
            }}
          >
            {/* шапка */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                <MessageCircle size={18} color="#8b7bff" /> AI-ассистент
              </div>
              <button onClick={() => setOpen(false)} aria-label="закрыть" style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {/* сообщения */}
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {messages.length === 0 && (
                <div style={{ color: '#8a8f9c', fontSize: 13, textAlign: 'center', marginTop: 24 }}>
                  Спроси меня про тренировки, питание, прогресс. Я вижу твои данные 💪
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={m.id ?? i}
                  style={{
                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    background: m.role === 'user' ? 'linear-gradient(135deg,#7c5cff,#5b8cff)' : '#23262f',
                    color: '#fff', padding: '9px 12px', borderRadius: 12,
                    fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}
                >
                  {m.content || (m.role === 'assistant' && busy ? '…' : '')}
                </div>
              ))}
            </div>

            {/* ввод */}
            <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                placeholder="Спроси что-нибудь…"
                rows={1}
                style={{
                  flex: 1, resize: 'none', background: '#0f1116', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
                  padding: '10px 12px', fontSize: 14, outline: 'none', maxHeight: 120,
                }}
              />
              <button
                onClick={send}
                disabled={busy || !input.trim()}
                aria-label="отправить"
                style={{
                  width: 44, borderRadius: 10, border: 'none', cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
                  background: busy || !input.trim() ? '#333' : 'linear-gradient(135deg,#7c5cff,#5b8cff)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

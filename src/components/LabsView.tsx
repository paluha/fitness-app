'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { FlaskConical, Upload, Loader2, Trash2, Check, X, ChevronDown, ChevronUp } from 'lucide-react';

type Marker = { name: string; value: number; unit: string; refLow?: number | null; refHigh?: number | null; flag: 'low' | 'normal' | 'high' };
type LabResult = { id: string; panelName: string | null; lab: string | null; collectedAt: string; markers: Marker[] };
type Draft = { panelName: string; lab: string; collectedAt: string; markers: Marker[] };

// Раздел «Анализы»: загрузка фото/скана результата → AI извлекает показатели →
// пользователь подтверждает → сохранение и просмотр динамики. Данные также
// попадают в контекст AI-чата (видит анализы).
export function LabsView() {
  const [results, setResults] = useState<LabResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/labs');
      const d = await r.json();
      setResults(d.results ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Конвертируем выбранный файл в data-URL (фото) и шлём на парсинг.
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Загрузите фото результата (JPG/PNG). PDF — сделайте скриншот страницы.');
      return;
    }
    setParsing(true);
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const r = await fetch('/api/labs/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) {
        alert(d.error || 'Не удалось распознать анализ.');
        return;
      }
      // Открываем черновик на подтверждение
      setDraft({
        panelName: d.data.panelName || '',
        lab: d.data.lab || '',
        collectedAt: d.data.collectedAt || new Date().toISOString().slice(0, 10),
        markers: d.data.markers || [],
      });
    } catch {
      alert('Ошибка при разборе. Попробуйте ещё раз.');
    } finally {
      setParsing(false);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    try {
      const r = await fetch('/api/labs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!r.ok) { alert('Не удалось сохранить.'); return; }
      setDraft(null);
      await load();
    } catch { alert('Ошибка сохранения.'); }
  };

  const remove = async (id: string) => {
    if (!confirm('Удалить этот анализ?')) return;
    await fetch(`/api/labs?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  };

  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const flagColor = (f: string) => f === 'high' ? '#ef4444' : f === 'low' ? '#3b82f6' : 'var(--green)';
  const fmtDate = (s: string) => { try { return new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };

  return (
    <div className="view-content">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FlaskConical size={20} color="var(--yellow)" /> Анализы
        </h2>
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, cursor: parsing ? 'wait' : 'pointer',
          fontSize: 13, fontWeight: 700, padding: '9px 14px', borderRadius: 10,
          background: 'var(--yellow)', color: '#000', opacity: parsing ? 0.6 : 1,
        }}>
          {parsing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {parsing ? 'Распознаю…' : 'Загрузить'}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} disabled={parsing} onChange={onPickFile} />
        </label>
      </div>

      {/* Черновик на подтверждение */}
      {draft && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--yellow)', borderRadius: 14,
          padding: 14, marginBottom: 16,
        }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Проверь и сохрани</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <input value={draft.panelName} onChange={e => setDraft({ ...draft, panelName: e.target.value })}
              placeholder="Название панели" style={inp} />
            <input value={draft.lab} onChange={e => setDraft({ ...draft, lab: e.target.value })}
              placeholder="Лаборатория" style={inp} />
            <input type="date" value={draft.collectedAt} onChange={e => setDraft({ ...draft, collectedAt: e.target.value })}
              style={inp} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
            {draft.markers.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ flex: 1 }}>{m.name}</span>
                <span style={{ fontWeight: 700, color: flagColor(m.flag) }}>{m.value} {m.unit}</span>
                {(m.refLow != null || m.refHigh != null) && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 70, textAlign: 'right' }}>
                    {m.refLow ?? '—'}–{m.refHigh ?? '—'}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => setDraft(null)} style={{ ...btn, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
              <X size={16} /> Отмена
            </button>
            <button onClick={saveDraft} style={{ ...btn, background: 'var(--yellow)', color: '#000' }}>
              <Check size={16} /> Сохранить
            </button>
          </div>
        </div>
      )}

      {/* Список сохранённых анализов */}
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : results.length === 0 && !draft ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 20px', fontSize: 14, lineHeight: 1.6 }}>
          <FlaskConical size={32} style={{ opacity: 0.4, marginBottom: 8 }} /><br />
          Загрузи фото результата анализа —<br />AI извлечёт показатели и сохранит динамику.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {results.map(r => {
            const isOpen = expanded.has(r.id);
            const abnormal = r.markers.filter(m => m.flag !== 'normal').length;
            return (
              <div key={r.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                <button onClick={() => toggle(r.id)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: 14,
                  background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                      {r.panelName || 'Анализ'} {r.lab ? <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {r.lab}</span> : null}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {fmtDate(r.collectedAt)} · {r.markers.length} показателей
                      {abnormal > 0 && <span style={{ color: '#ef4444', marginLeft: 6 }}>· {abnormal} вне нормы</span>}
                    </div>
                  </div>
                  {isOpen ? <ChevronUp size={18} color="var(--text-muted)" /> : <ChevronDown size={18} color="var(--text-muted)" />}
                </button>
                {isOpen && (
                  <div style={{ padding: '0 14px 14px' }}>
                    {r.markers.map((m, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                        <span style={{ flex: 1 }}>{m.name}</span>
                        <span style={{ fontWeight: 700, color: flagColor(m.flag) }}>
                          {m.flag === 'high' ? '↑ ' : m.flag === 'low' ? '↓ ' : ''}{m.value} {m.unit}
                        </span>
                        {(m.refLow != null || m.refHigh != null) && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 70, textAlign: 'right' }}>
                            {m.refLow ?? '—'}–{m.refHigh ?? '—'}
                          </span>
                        )}
                      </div>
                    ))}
                    <button onClick={() => remove(r.id)} style={{
                      marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12,
                      background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer',
                    }}>
                      <Trash2 size={14} /> Удалить
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 16, textAlign: 'center', lineHeight: 1.5 }}>
        Образовательная информация, не диагноз. Для интерпретации — обратись к врачу.
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  flex: 1, minWidth: 120, background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none',
};
const btn: React.CSSProperties = {
  flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
};

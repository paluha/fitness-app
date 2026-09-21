'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FlaskConical, Upload, Loader2, Trash2, Check, X, Search, FileText } from 'lucide-react';
import LabMarkerList, { labStatus, hasRef, isOutOfRange, refText, LAB_TONES } from './LabMarkerList';
import type { LabMarkerRow, LabMarkerPoint } from './LabMarkerList';

type Marker = {
  /** Стабильный идентификатор аналита — по нему собирается история. */
  key?: string;
  name: string;
  value: number;
  unit: string;
  refLow?: number | null;
  refHigh?: number | null;
  /** Оптимальный диапазон задаётся отдельно; только он даёт статус «Оптимально». */
  optimalLow?: number | null;
  optimalHigh?: number | null;
  flag: 'low' | 'normal' | 'high';
};
type LabResult = { id: string; panelName: string | null; lab: string | null; collectedAt: string; markers: Marker[] };
type Draft = { panelName: string; lab: string; collectedAt: string; markers: Marker[] };

/**
 * Ключ аналита. Для новых разборов его даёт ИИ; для записей, сохранённых до
 * появления поля, выводим из названия — иначе один и тот же показатель из
 * разных бланков не собрался бы в одну историю.
 */
function markerKey(m: Marker) {
  if (m.key) return m.key;
  return m.name.trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');
}

/** Единицы сравниваем нестрого: «ммоль/л» и «ММОЛЬ/Л» — одно и то же. */
const unitKey = (u: string) => u.trim().toLocaleLowerCase('ru').replace(/\s+/g, '');

/**
 * Платформа обрывает запрос тяжелее 4.5 МБ ещё до нашего кода: приходит
 * HTML c 413, функция не выполняет ни строки. Держим запас: data-URL
 * (base64) весит примерно на треть больше самого файла.
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_PDF_BYTES = 3 * 1024 * 1024;

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : iso.slice(0, 10);
};

// Раздел «Анализы»: загрузка фото/скана результата → AI извлекает показатели →
// пользователь подтверждает → сохранение и просмотр динамики. Данные также
// попадают в контекст AI-чата (видит анализы).
export function LabsView() {
  const [results, setResults] = useState<LabResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<'markers' | 'documents'>('markers');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'flagged'>('all');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const trendRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/labs');
      const d = await r.json();
      setResults(d.results ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Самый свежий бланк — он и открыт по умолчанию.
  const sorted = useMemo(
    () => [...results].sort((a, b) => dayKey(b.collectedAt).localeCompare(dayKey(a.collectedAt))),
    [results],
  );
  const current = useMemo(
    () => sorted.find(r => r.id === selectedReportId) ?? sorted[0] ?? null,
    [sorted, selectedReportId],
  );

  /**
   * Показатели выбранного бланка с историей: каждая точка — тот же аналит
   * (совпадает key) в совместимых единицах из более ранних бланков.
   */
  const rows: LabMarkerRow[] = useMemo(() => {
    if (!current) return [];
    const currentDay = dayKey(current.collectedAt);
    return current.markers.map(m => {
      const k = markerKey(m);
      const u = unitKey(m.unit);
      const history: LabMarkerPoint[] = results
        .filter(r => dayKey(r.collectedAt) <= currentDay)
        .flatMap(r => r.markers
          .filter(x => markerKey(x) === k && unitKey(x.unit) === u)
          .map(x => ({
            date: dayKey(r.collectedAt),
            value: x.value,
            // Референсы берём из ТОГО бланка, откуда точка: лаборатории
            // печатают разные пределы, и статус на дату считается по ним.
            refLow: x.refLow ?? null,
            refHigh: x.refHigh ?? null,
            optimalLow: x.optimalLow ?? null,
            optimalHigh: x.optimalHigh ?? null,
          })))
        .sort((a, b) => a.date.localeCompare(b.date));
      return {
        key: k,
        name: m.name,
        value: m.value,
        unit: m.unit,
        refLow: m.refLow ?? null,
        refHigh: m.refHigh ?? null,
        // Оптимальный диапазон переносится как есть: сам по себе он нигде
        // не выдумывается, демозначения макета в приложение не попадают.
        optimalLow: m.optimalLow ?? null,
        optimalHigh: m.optimalHigh ?? null,
        history: history.length ? history : [{ date: currentDay, value: m.value }],
      };
    });
  }, [current, results]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('ru');
    return rows.filter(m =>
      (filter !== 'flagged' || isOutOfRange(m)) &&
      (!q || m.name.toLocaleLowerCase('ru').includes(q)));
  }, [rows, search, filter]);

  const selected = useMemo(
    () => rows.find(m => m.key === selectedKey) ?? null,
    [rows, selectedKey],
  );

  const outsideCount = rows.filter(m => isOutOfRange(m)).length;

  // Конвертируем выбранный файл в data-URL (фото) и шлём на парсинг.
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf && !file.type.startsWith('image/')) {
      alert('Загрузите PDF или фото результата (JPG/PNG).');
      return;
    }
    // PDF уходит как есть, поэтому его размер проверяем сразу: base64
    // раздувает вес на треть, а платформа рвёт запрос больше 4.5 МБ.
    // Фото ниже ужимается через canvas, для него проверка после сжатия.
    if (isPdf && file.size > MAX_PDF_BYTES) {
      alert(`PDF весит ${(file.size / 1024 / 1024).toFixed(1)} МБ — это больше, чем можно отправить. Сожми файл (например, «Уменьшить размер» в просмотрщике) или сохрани страницы как фото: их приложение уменьшит само.`);
      return;
    }
    setParsing(true);
    try {
      const readAsDataUrl = (f: File) => new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(f);
      });
      // PDF отправляем как есть — модель читает его документом. Картинку
      // прогоняем через canvas: это и уменьшает вес бланка, и переводит
      // HEIC с айфона в JPEG, который модель принимает.
      const dataUrl: string = isPdf
        ? await readAsDataUrl(file)
        : await new Promise<string>((res, rej) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
              URL.revokeObjectURL(url);
              const maxSize = 2000; // мелкий шрифт бланка должен остаться читаемым
              let { width, height } = img;
              if (width > maxSize || height > maxSize) {
                const ratio = Math.min(maxSize / width, maxSize / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
              }
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (!ctx) { rej(new Error('No canvas context')); return; }
              ctx.drawImage(img, 0, 0, width, height);
              res(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = () => {
              URL.revokeObjectURL(url);
              // HEIC иногда не декодируется в вебвью — отправляем оригинал,
              // сервер ответит понятной ошибкой про формат.
              readAsDataUrl(file).then(res, rej);
            };
            img.src = url;
          });
      // Тело запроса не должно превышать лимит платформы (4.5 МБ):
      // иначе запрос обрывается ДО нашего кода и приходит HTML с 413,
      // а не JSON — пользователь видел невнятное «Ошибка при разборе».
      if (dataUrl.length > MAX_UPLOAD_BYTES) {
        alert(isPdf
          ? `PDF слишком большой (${(dataUrl.length / 1024 / 1024).toFixed(1)} МБ после кодирования). Сожми файл или сохрани страницы как фото — их приложение уменьшит само.`
          : 'Фото слишком большое даже после сжатия. Сними бланк ещё раз или загрузи по одной странице.');
        return;
      }
      const r = await fetch('/api/labs/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      // При 413 и других отказах платформы тело — HTML, а не JSON.
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.success) {
        alert(
          d?.error
          || (r.status === 413 ? 'Файл слишком большой для загрузки. Сожми его и попробуй снова.' : '')
          || (r.status === 504 ? 'Разбор занял слишком долго. Попробуй загрузить страницы по отдельности.' : '')
          || `Не удалось распознать анализ (ошибка ${r.status}).`
        );
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
      setSelectedReportId(null);
      setSelectedKey(null);
      await load();
    } catch { alert('Ошибка сохранения.'); }
  };

  const remove = async (id: string) => {
    if (!confirm('Удалить этот анализ?')) return;
    await fetch(`/api/labs?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (selectedReportId === id) setSelectedReportId(null);
    setSelectedKey(null);
    await load();
  };

  const flagColor = (f: string) => f === 'high' ? '#ef4444' : f === 'low' ? '#3b82f6' : 'var(--green)';
  const fmtDate = (s: string) => { try { return new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return s; } };
  const shortDate = (s: string) => { try { return new Date(`${s}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); } catch { return s; } };
  const num = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);
  const indicatorCount = (n: number) =>
    `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'показатель' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'показателя' : 'показателей'}`;

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
          {/* accept без «image/*»: с ним iOS открывает галерею фото, и папки
              iCloud Drive не видно. Перечисленные типы дают выбор
              «Фото / Файлы», а из «Файлов» доступен iCloud. */}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/gif,image/webp,.pdf,.jpg,.jpeg,.png,.heic"
            style={{ display: 'none' }}
            disabled={parsing}
            onChange={onPickFile}
          />
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

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : !current && !draft ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 20px', fontSize: 14, lineHeight: 1.6 }}>
          <FlaskConical size={32} style={{ opacity: 0.4, marginBottom: 8 }} /><br />
          Загрузи PDF или фото результата анализа —<br />AI извлечёт показатели и сохранит динамику.
        </div>
      ) : current ? (
        <>
          {/* Шапка выбранного бланка: название, дата, лаборатория, сводка */}
          <section style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 18, padding: '15px 16px', marginBottom: 4,
          }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '.25px' }}>Результат лаборатории</span>
            <h3 style={{ fontSize: 16, fontWeight: 650, letterSpacing: '-.35px', margin: '8px 0 4px' }}>
              {current.panelName || 'Анализ'}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 11 }}>
              <select
                aria-label="Выбрать результат по дате"
                value={current.id}
                onChange={e => { setSelectedReportId(e.target.value); setSelectedKey(null); }}
                style={{
                  minWidth: 0, maxWidth: '100%', fontSize: 11, minHeight: 32, border: 0,
                  padding: '0 3px 0 0', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                {sorted.map(r => <option key={r.id} value={r.id}>{fmtDate(r.collectedAt)}</option>)}
              </select>
              {current.lab ? <span>· {current.lab}</span> : null}
            </div>
            <div style={{
              borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center',
              flexWrap: 'wrap', marginTop: 12, paddingTop: 12, fontSize: 10, color: 'var(--text-muted)',
            }}>
              <span>{indicatorCount(current.markers.length)}</span>
              {outsideCount > 0
                ? <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '4px 7px',
                    borderRadius: 6, background: '#fff0e8', color: '#ad593d', fontWeight: 550,
                  }}>{outsideCount} вне референса</span>
                : <span style={{ color: 'var(--green)' }}>Нет отмеченных отклонений</span>}
            </div>
          </section>

          {/* Переключатель «Показатели / Документы» */}
          <div role="tablist" aria-label="Раздел анализов" style={{
            display: 'flex', gap: 3, background: '#eee8df', padding: 3, borderRadius: 10, margin: '20px 0 14px',
          }}>
            {(['markers', 'documents'] as const).map(id => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                style={{
                  flex: 1, minHeight: 39, borderRadius: 7, fontSize: 12, fontWeight: 550, cursor: 'pointer',
                  border: 'none',
                  background: tab === id ? '#fff' : 'transparent',
                  color: tab === id ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: tab === id ? '0 1px 4px #302a2209' : 'none',
                }}
              >
                {id === 'markers' ? 'Показатели' : `Документы ${results.length}`}
              </button>
            ))}
          </div>

          {tab === 'markers' ? (
            <>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 9, minHeight: 44,
                border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-card)', padding: '0 12px',
              }}>
                <Search size={17} color="var(--text-muted)" />
                <input
                  type="search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Найти показатель"
                  aria-label="Найти показатель"
                  style={{
                    border: 0, background: 'none', outline: 'none', width: '100%', minWidth: 0,
                    fontSize: 16, padding: '10px 0', color: 'var(--text-primary)',
                  }}
                />
              </label>

              <div aria-label="Фильтр показателей" style={{ display: 'flex', gap: 7, margin: '11px 0 12px' }}>
                {([['all', 'Все', rows.length], ['flagged', 'Вне референса', outsideCount]] as const).map(([id, label, count]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                    style={{
                      fontSize: 10, borderRadius: 7, padding: '8px 10px', minHeight: 34, cursor: 'pointer',
                      border: 'none',
                      background: filter === id ? '#eae4da' : 'transparent',
                      color: filter === id ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontWeight: filter === id ? 550 : 400,
                    }}
                  >
                    {label} <span style={{ marginLeft: 5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
                  </button>
                ))}
              </div>

              <LabMarkerList
                markers={visibleRows}
                selectedKey={selectedKey}
                onSelect={m => {
                  setSelectedKey(m.key);
                  requestAnimationFrame(() => trendRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                }}
              />

              <p style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 10, color: 'var(--text-muted)', margin: '10px 2px 0' }}>
                Референсы указаны из выбранного бланка
              </p>

              {/* Подробная динамика выбранного показателя */}
              {selected && (
                <section ref={trendRef} style={{
                  marginTop: 22, padding: 16, background: 'var(--bg-card)',
                  border: '1px solid var(--border)', borderRadius: 18, scrollMarginTop: 15,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 650, letterSpacing: '-.35px' }}>Динамика</h3>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(null)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)' }}
                    >
                      Свернуть
                    </button>
                  </div>
                  <p style={{ margin: '12px 0 0', fontSize: 13, fontWeight: 550 }}>{selected.name}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', margin: '6px 0 1px' }}>
                    <div style={{ fontSize: 31, fontWeight: 650, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>
                      {num(selected.value)} <small style={{ fontSize: 11, letterSpacing: 0, fontWeight: 400, color: 'var(--text-muted)' }}>{selected.unit}</small>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right', lineHeight: 1.6 }}>
                      {selected.history.length > 1 ? (() => {
                        const first = selected.history[0];
                        const delta = selected.value - first.value;
                        return (
                          <>
                            <b style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 550 }}>
                              {delta > 0 ? '+' : ''}{num(delta)} {selected.unit}
                            </b>
                            с {shortDate(first.date)}
                          </>
                        );
                      })() : 'Первое измерение'}
                    </div>
                  </div>
                  <p style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 10 }}>
                    {hasRef(selected)
                      ? `Референс выбранного бланка: ${refText(selected)} ${selected.unit}`
                      : 'Референс в бланке не указан'}
                  </p>
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selected.history.slice().reverse().map(p => (
                      <div key={p.date} style={{
                        display: 'flex', justifyContent: 'space-between', gap: 10,
                        fontSize: 11, color: 'var(--text-secondary)',
                        padding: '6px 0', borderTop: '1px solid var(--border)',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        <span>{shortDate(p.date)}</span>
                        <span style={{ fontWeight: 600 }}>{num(p.value)} {selected.unit}</span>
                      </div>
                    ))}
                  </div>
                  <p style={{ marginTop: 10, fontSize: 10, color: LAB_TONES[labStatus(selected)].ink }}>
                    {LAB_TONES[labStatus(selected)].label}
                  </p>
                </section>
              )}
            </>
          ) : (
            /* Документы: сохранённые бланки */
            <div style={{ display: 'grid', gap: 10 }}>
              {sorted.map(r => (
                <article key={r.id} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 18, padding: 15,
                }}>
                  <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                    <span style={{
                      width: 37, height: 42, background: 'var(--bg-elevated)', color: '#8f8171',
                      borderRadius: 10, display: 'grid', placeItems: 'center', flex: 'none',
                    }}>
                      <FileText size={19} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{r.panelName || 'Анализ'}</h3>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                        {fmtDate(r.collectedAt)}{r.lab ? ` · ${r.lab}` : ''}
                      </p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                        {indicatorCount(r.markers.length)}
                      </p>
                    </div>
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 5,
                  }}>
                    <button
                      type="button"
                      onClick={() => { setSelectedReportId(r.id); setSelectedKey(null); setTab('markers'); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', minHeight: 34, fontSize: 11, color: 'var(--text-secondary)' }}
                    >
                      Показатели →
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(r.id)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 34, fontSize: 11,
                        background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={14} /> Удалить
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}

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

'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FlaskConical, Upload, Loader2, Trash2, Check, X, Search, FileText } from 'lucide-react';
import LabMarkerList, { hasRef, isOutOfRange, reading } from './LabMarkerList';
import type { LabMarkerRow } from './LabMarkerList';
import LabMarkerDetail from './LabMarkerDetail';
import { latestByMarker, historyFor, groupOf, dayKey as dayOf } from './labMatching';
import type { RawReport } from './labMatching';

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
  /** Значение как напечатано: «<5», «5,9». Не нормализуем. */
  rawValue?: string | null;
  bound?: 'exact' | 'below' | 'above';
  /** Биоматериал и методика: часть признака сопоставимости. */
  specimen?: string;
  method?: string;
  /** Распознано неуверенно — показываем на проверку. */
  needsReview?: boolean;
  /** Раздел бланка для группировки. */
  group?: string;
  page?: number | null;
};
type LabResult = { id: string; panelName: string | null; lab: string | null; collectedAt: string; markers: Marker[] };
type Draft = { panelName: string; lab: string; collectedAt: string; markers: Marker[] };


/**
 * Платформа обрывает запрос тяжелее 4.5 МБ ещё до нашего кода: приходит
 * HTML c 413, функция не выполняет ни строки. Держим запас: data-URL
 * (base64) весит примерно на треть больше самого файла.
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_PDF_BYTES = 3 * 1024 * 1024;


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
  const [filter, setFilter] = useState<'all' | 'flagged' | 'unknown'>('all');
  // «Один бланк» показывает выбранный документ, «Последние значения» —
  // самое свежее измерение каждого показателя из разных дат.
  const [scope, setScope] = useState<'report' | 'latest'>('report');
  const [group, setGroup] = useState<string>('all');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  // Индекс открытого показателя в текущем отфильтрованном списке.
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const [pointIndex, setPointIndex] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Позиция списка: после закрытия деталей возвращаемся точно на неё.
  const listScrollRef = useRef(0);

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
  // Бланки от новых к старым: первый открыт по умолчанию.
  const sorted = useMemo(
    () => [...results].sort((a, b) => dayOf(b.collectedAt).localeCompare(dayOf(a.collectedAt))),
    [results],
  );
  const current = useMemo(
    () => sorted.find(r => r.id === selectedReportId) ?? sorted[0] ?? null,
    [sorted, selectedReportId],
  );

  /** Записи в форме, понятной правилам сопоставления. */
  const asRaw: RawReport[] = useMemo(() => results.map(r => ({
    id: r.id,
    panelName: r.panelName,
    lab: r.lab,
    collectedAt: r.collectedAt,
    createdAt: (r as LabResult & { createdAt?: string }).createdAt ?? null,
    markers: r.markers,
  })), [results]);

  /**
   * Показатели текущего режима.
   *
   * «Один бланк» — строки выбранного документа. «Последние значения» —
   * самое свежее сопоставимое измерение каждого показателя, у каждой
   * строки видна своя дата и лаборатория.
   */
  const rows: LabMarkerRow[] = useMemo(() => {
    const build = (m: typeof results[number]['markers'][number], r: RawReport, withSource: boolean, conflict?: string) => {
      const history = historyFor(m, asRaw, withSource ? undefined : r.collectedAt);
      return {
        key: `${r.id}|${m.key || m.name}|${m.unit}|${m.specimen || ''}|${m.method || ''}`,
        name: m.name,
        value: m.value,
        unit: m.unit,
        refLow: m.refLow ?? null,
        refHigh: m.refHigh ?? null,
        // Оптимум переносится как есть: сам он нигде не выдумывается.
        optimalLow: m.optimalLow ?? null,
        optimalHigh: m.optimalHigh ?? null,
        specimen: m.specimen,
        method: m.method,
        rawValue: m.rawValue ?? null,
        bound: m.bound,
        // Конфликт двух бланков за день — тоже повод свериться с оригиналом.
        needsReview: m.needsReview || !!conflict,
        group: groupOf(m),
        sourceDate: withSource ? dayOf(r.collectedAt) : undefined,
        sourceLab: withSource ? (conflict || r.lab || undefined) : undefined,
        history: history.length ? history : [{
          date: dayOf(r.collectedAt),
          value: m.value,
          refLow: m.refLow ?? null,
          refHigh: m.refHigh ?? null,
          lab: r.lab || undefined,
        }],
      } as LabMarkerRow;
    };

    if (scope === 'latest') {
      return latestByMarker(asRaw).map(({ marker, report, conflict }) => build(
        marker as typeof results[number]['markers'][number],
        report,
        true,
        conflict ? `${conflict.count} результата за день: ${conflict.labs.join(', ')}` : undefined,
      ));
    }
    if (!current) return [];
    const raw = asRaw.find(r => r.id === current.id);
    if (!raw) return [];
    return current.markers.map(m => build(m, raw, false));
  }, [scope, current, asRaw]);

  /** Разделы бланка для выпадающего списка групп. */
  const groups = useMemo(() => [...new Set(rows.map(m => m.group || 'Другое'))], [rows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('ru');
    return rows.filter(m =>
      (filter === 'all'
        || (filter === 'flagged' && hasRef(m) && isOutOfRange(m))
        || (filter === 'unknown' && !hasRef(m)))
      && (group === 'all' || (m.group || 'Другое') === group)
      && (!q || m.name.toLocaleLowerCase('ru').includes(q)));
  }, [rows, search, filter, group]);

  // Открытый показатель берём из отфильтрованного списка: «предыдущий» и
  // «следующий» ходят по тому, что пользователь видит.
  const detail = detailIndex != null ? visibleRows[detailIndex] ?? null : null;

  /** Выход за референс считаем только там, где референс есть. */
  const outsideCount = rows.filter(m => hasRef(m) && isOutOfRange(m)).length;
  const unknownCount = rows.filter(m => !hasRef(m)).length;
  /** До трёх отклонений в блоке внимания; порядок — не срочность. */
  const attention = useMemo(
    () => rows.map((m, i) => ({ m, i })).filter(({ m }) => hasRef(m) && isOutOfRange(m)),
    [rows],
  );

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
      await load();
    } catch { alert('Ошибка сохранения.'); }
  };

  const remove = async (id: string) => {
    if (!confirm('Удалить этот анализ?')) return;
    await fetch(`/api/labs?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (selectedReportId === id) setSelectedReportId(null);
    await load();
  };

  /**
   * Открыть показатель. Запоминаем позицию списка: после закрытия
   * возвращаемся ровно туда, а не к началу.
   */
  const openDetailFor = (m: LabMarkerRow) => {
    const i = visibleRows.findIndex(x => x.key === m.key);
    if (i < 0) return;
    listScrollRef.current = window.scrollY;
    setDetailIndex(i);
    setPointIndex(Math.max(0, (visibleRows[i].history.length || 1) - 1));
  };

  const closeDetail = () => {
    setDetailIndex(null);
    // Возврат на прежнее место после того, как список снова отрисован.
    requestAnimationFrame(() => window.scrollTo(0, listScrollRef.current));
  };

  const stepDetail = (delta: number) => {
    setDetailIndex(prev => {
      if (prev == null) return prev;
      const next = prev + delta;
      if (next < 0 || next >= visibleRows.length) return prev;
      setPointIndex(Math.max(0, (visibleRows[next].history.length || 1) - 1));
      return next;
    });
  };

  const refTextOf = (m: { refLow?: number | null; refHigh?: number | null }) =>
    m.refLow != null && m.refHigh != null ? `${num(m.refLow)}–${num(m.refHigh)}`
      : m.refLow != null ? `от ${num(m.refLow)}`
        : m.refHigh != null ? `до ${num(m.refHigh)}`
          : 'не указан';

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
          {/* Режим: один бланк или последние значения из разных дат */}
          <div className="labv2">
            <div className="scope-switch" aria-label="Какие результаты показывать">
              {([['report', 'Один бланк'], ['latest', 'Последние значения']] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={scope === id}
                  onClick={() => { setScope(id); setFilter('all'); setGroup('all'); setSearch(''); }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Шапка: дата сдачи крупно, выбор бланка, сводка */}
          <section style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 18, padding: '12px 14px', marginBottom: 4,
          }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '.25px' }}>
              {scope === 'report' ? 'Сейчас показан один бланк' : 'Сводка из нескольких бланков'}
            </span>
            <h3 style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-.35px', margin: '7px 0' }}>
              {scope === 'report' ? fmtDate(current.collectedAt) : 'Последние значения'}
            </h3>
            {scope === 'report' && (
              <select
                aria-label="Выбрать результат по дате"
                value={current.id}
                onChange={e => { setSelectedReportId(e.target.value); setGroup('all'); setFilter('all'); setSearch(''); }}
                style={{
                  width: '100%', minHeight: 44, fontSize: 12, border: '1px solid var(--border)',
                  padding: 9, borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)',
                }}
              >
                {sorted.map(r => (
                  <option key={r.id} value={r.id}>
                    {(r.panelName || 'Анализ')} · {shortDate(dayOf(r.collectedAt))}
                  </option>
                ))}
              </select>
            )}
            <span style={{ display: 'block', marginTop: 5, fontSize: 11, color: 'var(--text-muted)' }}>
              {scope === 'report'
                ? (current.lab || 'Лаборатория не указана')
                : `${new Set(rows.map(m => m.sourceDate)).size} даты · дата указана у каждого результата`}
            </span>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.55 }}>
              {scope === 'report'
                ? 'Показатели только из этого бланка. Дата сдачи, не дата загрузки.'
                : 'Самые свежие доступные измерения. Даты могут отличаться.'}
            </p>
            <div style={{
              borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center',
              flexWrap: 'wrap', marginTop: 8, paddingTop: 7, fontSize: 11, color: 'var(--text-muted)',
            }}>
              <span>{indicatorCount(rows.length)}</span>
              <button
                type="button"
                onClick={() => { setFilter('flagged'); setTab('markers'); }}
                style={{
                  minHeight: 32, fontSize: 11, padding: '4px 7px', borderRadius: 6, border: 0,
                  background: '#fff0e8', color: '#ad593d', fontWeight: 550, cursor: 'pointer',
                }}
              >
                {outsideCount} вне референса
              </button>
              <button
                type="button"
                onClick={() => { setFilter('unknown'); setTab('markers'); }}
                style={{ minHeight: 32, fontSize: 11, border: 0, background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                {unknownCount} без диапазона
              </button>
            </div>
          </section>

          {/* Переключатель «Показатели / Документы» */}
          <div role="tablist" aria-label="Раздел анализов" style={{
            display: 'flex', gap: 3, background: '#eee8df', padding: 3, borderRadius: 10, margin: '15px 0 12px',
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
            <div className="labv2">
              {/* На что обратить внимание: до трёх выходов за референс. */}
              <section className="attention">
                <div className="attention-head">
                  <h2>На что обратить внимание</h2>
                  <span>{attention.length ? `${attention.length} вне референса` : 'Отклонений не отмечено'}</span>
                </div>
                <div className="attention-list">
                  {attention.length ? attention.slice(0, 3).map(({ m, i }) => (
                    <button
                      key={m.key}
                      type="button"
                      className="attention-item"
                      onClick={() => openDetailFor(m)}
                    >
                      <em>{reading(m)} {m.unit}</em>
                      <strong>{m.name}</strong>
                      <small>
                        {m.refHigh != null && m.value > m.refHigh ? 'Выше' : 'Ниже'} референса {refTextOf(m)}
                        {m.sourceDate ? ` · ${shortDate(m.sourceDate)}` : ''}
                      </small>
                      <span hidden>{i}</span>
                    </button>
                  )) : (
                    <div className="attention-item">
                      <strong>Выходов за указанные диапазоны нет</strong>
                      <small>Результаты без диапазона проверяются отдельно.</small>
                    </div>
                  )}
                </div>
                <p className="attention-foot">
                  {attention.length > 3
                    ? 'Первые 3 отклонения. Все доступны в фильтре «Вне референса». Порядок не означает медицинскую срочность.'
                    : 'Выход за референс ≠ медицинская срочность.'}
                </p>
              </section>

              <button type="button" className="ai-report" onClick={() => setAiOpen(true)}>
                Разобрать с ИИ <span>Источники и правила →</span>
              </button>

              <div style={{ height: 16 }} />

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

              {/* Счётчики считаем из того, что реально показано. */}
              <div aria-label="Фильтр показателей" style={{ display: 'flex', gap: 3, flexWrap: 'wrap', margin: '11px 0 12px' }}>
                {([['all', 'Все', rows.length], ['flagged', 'Вне референса', outsideCount], ['unknown', 'Без диапазона', unknownCount]] as const).map(([id, label, count]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                    style={{
                      fontSize: 10, borderRadius: 7, padding: '7px 8px', minHeight: 34, cursor: 'pointer',
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

              <div className="group-row">
                <select value={group} onChange={e => setGroup(e.target.value)} aria-label="Группа показателей">
                  <option value="all">Все группы</option>
                  {groups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <span>Показано {visibleRows.length} из {rows.length}</span>
              </div>

              <LabMarkerList
                markers={visibleRows}
                selectedKey={detail?.key ?? null}
                onSelect={m => openDetailFor(m)}
                emptyText="Нет показателей по этому фильтру. Попробуй другую группу или поиск."
              />

              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '10px 2px 0', lineHeight: 1.5 }}>
                Диапазон и дата взяты из бланка каждого показателя. Выход за диапазон сам по себе не определяет срочность.
              </p>
            </div>
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
                      onClick={() => { setSelectedReportId(r.id); setTab('markers'); }}
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

      {/* Отдельный экран показателя поверх списка */}
      {detail && detailIndex != null && (
        <LabMarkerDetail
          key={detail.key}
          marker={detail}
          source={{
            date: detail.sourceDate || (current ? dayOf(current.collectedAt) : ''),
            lab: detail.sourceLab || current?.lab || '',
            panelName: current?.panelName || '',
            hasFile: false,
          }}
          position={detailIndex + 1}
          total={visibleRows.length}
          selectedPoint={pointIndex}
          onClose={closeDetail}
          onPrev={() => stepDetail(-1)}
          onNext={() => stepDetail(1)}
          onSelectPoint={setPointIndex}
          onOpenSource={() => alert('Исходный файл бланка пока не сохраняется в приложении. Сейчас доступны распознанные значения.')}
          onDiscuss={() => { closeDetail(); setAiOpen(true); }}
        />
      )}

      {/* Что должно стоять за ИИ-разбором. Сам разбор не подключён —
          показываем это прямо, а не подставляем демоответ. */}
      {aiOpen && (
        <div
          onClick={() => setAiOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: '#241d1755', backdropFilter: 'blur(3px)',
            display: 'grid', placeItems: 'center', zIndex: 60, padding: 12,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fdfcfa', color: '#1a1712', borderRadius: 21, padding: 17,
              width: '100%', maxWidth: 420, maxHeight: 'calc(100dvh - 28px)', overflow: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
              <h2 style={{ fontSize: 19, fontWeight: 650, margin: 0 }}>Разбор с ИИ</h2>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={() => setAiOpen(false)}
                style={{ width: 44, height: 44, border: 0, background: 'none', cursor: 'pointer', fontSize: 20 }}
              >
                ×
              </button>
            </div>
            <p style={{ fontSize: 11, color: '#82796d', lineHeight: 1.55 }}>
              {scope === 'report'
                ? `${current?.panelName || 'Бланк'} · ${current ? fmtDate(current.collectedAt) : ''}`
                : `Последние значения · ${rows.length} показателей из разных дат`}
            </p>
            <div style={{ padding: 12, background: '#f4f0ea', borderRadius: 10, fontSize: 12, lineHeight: 1.6, margin: '12px 0' }}>
              ИИ-разбор ещё не подключён. Сейчас доступны результаты из бланков и их история.
              Медицинские выводы и подбор добавок здесь не сгенерированы.
            </div>
            <h3 style={{ fontSize: 13, fontWeight: 600 }}>На чём должен основываться разбор</h3>
            <ul style={{ paddingLeft: 19, fontSize: 12, lineHeight: 1.8, color: '#57534c' }}>
              <li>Клинические рекомендации и систематические обзоры.</li>
              <li>
                <a href="https://ods.od.nih.gov/factsheets/list-all/" target="_blank" rel="noopener noreferrer" style={{ color: '#8c5e47' }}>
                  NIH: сведения о добавках
                </a>.
              </li>
              <li>
                Проверки конкретного продукта в{' '}
                <a href="https://www.usp.org/verification-services/dietary-supplements-verification-program" target="_blank" rel="noopener noreferrer" style={{ color: '#8c5e47' }}>USP</a>
                {' / '}
                <a href="https://www.nsfsport.com/" target="_blank" rel="noopener noreferrer" style={{ color: '#8c5e47' }}>NSF</a>.
              </li>
            </ul>
            <p style={{ fontSize: 12, lineHeight: 1.65, color: '#57534c', margin: '12px 0' }}>
              Сначала — значение результатов, ограничения и вопросы врачу. Продукты — только при
              обоснованной необходимости. Проверка состава не гарантирует лечебный эффект или
              отсутствие побочных реакций.
            </p>
          </div>
        </div>
      )}
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

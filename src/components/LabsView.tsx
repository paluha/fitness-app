'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FlaskConical, Loader2, Trash2, Check, X, Search, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { hasRef, isOutOfRange, reading, refText } from './LabMarkerList';
import type { LabMarkerRow } from './LabMarkerList';
import LabMarkerDetail from './LabMarkerDetail';
import { latestByMarker, historyFor, groupOf, dayKey as dayOf } from './labMatching';
import type { RawReport } from './labMatching';
import { HealthMap } from './HealthMap';
import { TxDialog } from './TxDialog';
import { OrganismView, BodySvg, SYSTEMS, systemOf, markersWord, type SystemKey } from './LabsOrganism';

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

/**
 * Один показатель может стоять в бланке дважды (билирубин — и в
 * биохимии, и во фракциях). Ключ строки должен быть уникальным: по нему
 * React различает строки, а экран показателя ищет открытую.
 */
function uniqueKeys(list: LabMarkerRow[]): LabMarkerRow[] {
  const seen = new Map<string, number>();
  return list.map(r => {
    const n = seen.get(r.key) ?? 0;
    seen.set(r.key, n + 1);
    return n ? { ...r, key: `${r.key}#${n}` } : r;
  });
}


/**
 * Раздел «Анализы» по макету редизайна: «Результаты» (сводка, строки
 * показателей с раскрытием, история бланков и архив) и «Организм»
 * (показатели по системам на схеме тела). Загрузка: фото/PDF → ИИ
 * извлекает показатели → подтверждение → сохранение. Данные также
 * попадают в контекст ИИ-чата.
 */
export function LabsView({ onDiscuss }: {
  /** Открыть ИИ-чат с готовым вопросом про показатель или группу. */
  onDiscuss?: (prompt: string) => void;
} = {}) {
  const [results, setResults] = useState<LabResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [section, setSection] = useState<'results' | 'organism'>('results');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'flagged' | SystemKey>('all');
  // Один бланк или самое свежее измерение каждого показателя из разных дат.
  const [scope, setScope] = useState<'report' | 'latest'>('report');
  /**
   * Данные для карты связей: препараты и самонаблюдение лежат не в
   * анализах, а в FitnessData. Грузим их только когда карту открыли.
   */
  const [mapOpen, setMapOpen] = useState(false);
  const [mapData, setMapData] = useState<{
    courses: { id: string; name: string; dose?: string; endedAt?: string }[];
    fields: { id: string; name: string; kind: string; archived?: boolean }[];
    entries: { date: string; values: Record<string, number | string> }[];
  } | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  // Открытый показатель: индекс в списке, по которому ходят стрелки.
  const [detailRows, setDetailRows] = useState<LabMarkerRow[] | null>(null);
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const [pointIndex, setPointIndex] = useState(0);
  // Архив бланков
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState('');
  const [archiveYear, setArchiveYear] = useState('all');
  const [archiveSize, setArchiveSize] = useState(10);
  const [archivePage, setArchivePage] = useState(0);
  const [archiveItem, setArchiveItem] = useState<LabResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLElement>(null);
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

  useEffect(() => {
    if (!mapOpen || mapData) return;
    fetch('/api/fitness')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setMapData({
        courses: Array.isArray(d.medCourses) ? d.medCourses : [],
        fields: Array.isArray(d.checkinFields) ? d.checkinFields : [],
        entries: Array.isArray(d.checkinEntries) ? d.checkinEntries : [],
      }))
      .catch(() => setMapData({ courses: [], fields: [], entries: [] }));
  }, [mapOpen, mapData]);

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

  /** Строка показателя с историей. withSource — показать дату и лабораторию строки. */
  const build = useCallback((m: Marker, r: RawReport, withSource: boolean, conflict?: string): LabMarkerRow => {
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
    };
  }, [asRaw]);

  /** Самое свежее сопоставимое измерение каждого показателя — для «Организма». */
  const latestRows: LabMarkerRow[] = useMemo(() => uniqueKeys(latestByMarker(asRaw).map(({ marker, report, conflict }) => build(
    marker as Marker,
    report,
    true,
    conflict ? `${conflict.count} результата за день: ${conflict.labs.join(', ')}` : undefined,
  ))), [asRaw, build]);

  /** Показатели списка: выбранный бланк или последние значения. */
  const rows: LabMarkerRow[] = useMemo(() => {
    if (scope === 'latest') return latestRows;
    if (!current) return [];
    const raw = asRaw.find(r => r.id === current.id);
    if (!raw) return [];
    return uniqueKeys(current.markers.map(m => build(m, raw, false)));
  }, [scope, current, asRaw, latestRows, build]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('ru');
    return rows.filter(m =>
      (filter === 'all'
        || (filter === 'flagged' && hasRef(m) && isOutOfRange(m))
        || systemOf(m) === filter)
      && (!q || m.name.toLocaleLowerCase('ru').includes(q)));
  }, [rows, search, filter]);

  const detail = detailIndex != null && detailRows ? detailRows[detailIndex] ?? null : null;

  /** Выход за референс считаем только там, где референс есть. */
  const outsideCount = rows.filter(m => hasRef(m) && isOutOfRange(m)).length;
  const inRangeCount = rows.filter(m => hasRef(m) && !isOutOfRange(m)).length;

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
    setParsing(true);
    try {
      const readAsDataUrl = (f: File) => new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(f);
      });

      /**
       * Текст из PDF достаём ПРЯМО В БРАУЗЕРЕ.
       *
       * Так вес файла перестаёт иметь значение: по сети уходит несколько
       * килобайт текста вместо многомегабайтного PDF, и лимит платформы
       * в 4.5 МБ на запрос больше не мешает. Раньше бланк тяжелее 3 МБ
       * приходилось сжимать вручную.
       *
       * Не получилось (скан без текстового слоя или сбой разбора) —
       * отправляем файл как раньше, там его прочитает зрение.
       */
      let pdfText: string | null = null;
      if (isPdf) {
        try {
          const { extractText, getDocumentProxy } = await import('unpdf');
          const doc = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
          const { text } = await extractText(doc, { mergePages: true });
          const clean = String(text || '').replace(/\u0000/g, '').trim();
          // Мало текста — это скан: там только картинка, нужно зрение.
          if (clean.length >= 200) pdfText = clean.slice(0, 200_000);
        } catch {
          // Разбор не удался — ниже уйдёт сам файл.
        }
      }

      // Текстовый PDF: файл по сети не отправляем вовсе.
      if (pdfText) {
        const r = await fetch('/api/labs/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdfText, filename: file.name }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d?.success) {
          alert(d?.error || `Не удалось распознать анализ (ошибка ${r.status}).`);
          return;
        }
        setDraft({
          panelName: d.data.panelName || '',
          lab: d.data.lab || '',
          collectedAt: d.data.collectedAt || new Date().toISOString().slice(0, 10),
          markers: d.data.markers || [],
        });
        return;
      }

      // Скан или фото: отправляем сам файл, читать будет зрение. Такой
      // PDF всё ещё ограничен размером запроса.
      if (isPdf && file.size > MAX_PDF_BYTES) {
        alert(`В этом PDF нет текстового слоя — его нужно читать как картинку, а файл весит ${(file.size / 1024 / 1024).toFixed(1)} МБ. Сожми его или сохрани страницы как фото: их приложение уменьшит само.`);
        return;
      }
      // Картинку прогоняем через canvas: это и уменьшает вес бланка, и
      // переводит HEIC с айфона в JPEG, который модель принимает.
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
    setArchiveItem(null);
    await load();
  };

  /**
   * Открыть показатель. Список, по которому ходят «предыдущий/следующий»,
   * — тот, откуда открыли: результаты или группа «Организма».
   */
  const openDetail = (list: LabMarkerRow[], m: LabMarkerRow) => {
    const i = list.findIndex(x => x.key === m.key);
    if (i < 0) return;
    listScrollRef.current = window.scrollY;
    setDetailRows(list);
    setDetailIndex(i);
    setPointIndex(Math.max(0, (list[i].history.length || 1) - 1));
  };

  const closeDetail = () => {
    setDetailIndex(null);
    setDetailRows(null);
    // Возврат на прежнее место после того, как список снова отрисован.
    requestAnimationFrame(() => window.scrollTo(0, listScrollRef.current));
  };

  const stepDetail = (delta: number) => {
    if (!detailRows) return;
    setDetailIndex(prev => {
      if (prev == null) return prev;
      const next = prev + delta;
      if (next < 0 || next >= detailRows.length) return prev;
      setPointIndex(Math.max(0, (detailRows[next].history.length || 1) - 1));
      return next;
    });
  };

  const discussMarker = (m: LabMarkerRow) => onDiscuss?.(
    `Объясни мой показатель «${m.name}»: ${reading(m)} ${m.unit}` +
    (hasRef(m) ? ` при диапазоне ${refText(m)} ${m.unit}` : '') +
    (m.history.length > 1 ? `; раньше: ${m.history.slice(0, -1).slice(-3).map(p => `${shortDate(p.date)} — ${num(p.value)}`).join(', ')}` : '') +
    '. Что это значит и что спросить у врача?',
  );

  const fmtDate = (s: string) => { try { return new Date(`${dayOf(s)}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, ''); } catch { return s; } };
  const shortDate = (s: string) => { try { return new Date(`${s}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); } catch { return s; } };
  const num = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);
  const flagColor = (f: string) => f === 'high' ? 'var(--out)' : f === 'low' ? '#3b82f6' : 'var(--ok)';

  // Архив: поиск по названию и лаборатории, год, постранично
  const years = [...new Set(sorted.map(r => dayOf(r.collectedAt).slice(0, 4)))];
  const archiveList = sorted.filter(r =>
    (archiveYear === 'all' || dayOf(r.collectedAt).startsWith(archiveYear))
    && (`${r.panelName || 'Анализ'} ${r.lab || ''}`).toLocaleLowerCase('ru').includes(archiveQuery.trim().toLocaleLowerCase('ru')));
  const archivePages = Math.max(1, Math.ceil(archiveList.length / archiveSize));
  const archivePageNow = Math.min(archivePage, archivePages - 1);

  const latestDate = sorted[0] ? fmtDate(sorted[0].collectedAt) : '';
  const latestShort = sorted[0] ? shortDate(dayOf(sorted[0].collectedAt)) : '';
  const systemsHere = (Object.keys(SYSTEMS) as SystemKey[]).filter(k => rows.some(r => systemOf(r) === k));

  return (
    <div className="view-content tx labs-view">
      <div className="page-title">
        <div>
          <h1>Анализы</h1>
          <p>{section === 'organism' ? 'Твоя общая картина' : sorted[0] ? `Последний чек-ап · ${latestShort}` : 'Загрузи первый бланк'}</p>
        </div>
        {/* accept без «image/*»: с ним iOS открывает галерею фото, и папки
            iCloud Drive не видно. Перечисленные типы дают выбор
            «Фото / Файлы», а из «Файлов» доступен iCloud. */}
        <label className={'round big primary lab-upload' + (parsing ? ' is-busy' : '')} aria-label="Добавить анализ" title="Загрузить PDF или фото бланка">
          {parsing ? <Loader2 className="spin" /> : <Plus />}
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

      {parsing && <p className="notice">Распознаю бланк — это займёт до минуты. Можно не закрывать экран.</p>}

      {/* Черновик на подтверждение */}
      {draft && (
        <section className="card lab-draft">
          <div className="section-title"><h2>Проверь и сохрани</h2></div>
          <div className="lab-draft-fields">
            <input value={draft.panelName} onChange={e => setDraft({ ...draft, panelName: e.target.value })} placeholder="Название панели" />
            <input value={draft.lab} onChange={e => setDraft({ ...draft, lab: e.target.value })} placeholder="Лаборатория" />
            <input type="date" value={draft.collectedAt} onChange={e => setDraft({ ...draft, collectedAt: e.target.value })} />
          </div>
          <div className="lab-draft-list">
            {draft.markers.map((m, i) => (
              <div key={i} className="lab-draft-row">
                <span>{m.name}</span>
                <b style={{ color: flagColor(m.flag) }}>{m.value} {m.unit}</b>
                {(m.refLow != null || m.refHigh != null) && <small>{m.refLow ?? '—'}–{m.refHigh ?? '—'}</small>}
              </div>
            ))}
          </div>
          <div className="lab-draft-actions">
            <button type="button" className="secondary" onClick={() => setDraft(null)}><X /> Отмена</button>
            <button type="button" className="primary" onClick={saveDraft}><Check /> Сохранить</button>
          </div>
        </section>
      )}

      <div className="segmented lab-switch">
        <button type="button" className={section === 'results' ? 'active' : undefined} onClick={() => setSection('results')}>Результаты</button>
        <button type="button" className={section === 'organism' ? 'active' : undefined} onClick={() => setSection('organism')}>Организм</button>
      </div>

      {loading ? (
        <div className="center" style={{ padding: 40, color: 'var(--muted)' }}><Loader2 className="spin" /></div>
      ) : !current ? (
        !draft && (
          <section className="card empty">
            <span className="empty-icon"><FlaskConical /></span>
            <h3>Пока нет анализов</h3>
            <p>Загрузи PDF или фото бланка — ИИ извлечёт показатели, а приложение соберёт их историю.</p>
            <button type="button" className="primary" onClick={() => fileRef.current?.click()}><Plus /> Загрузить бланк</button>
          </section>
        )
      ) : section === 'organism' ? (
        <>
          <OrganismView
            rows={latestRows}
            dateLabel={latestDate}
            onOpen={m => openDetail(latestRows, m)}
            onDiscuss={p => onDiscuss?.(p)}
          />
          <button type="button" className="health-map-link" onClick={() => setMapOpen(true)}>
            <span><b>Карта связей</b><small>Анализы, препараты и самочувствие — что с чем связано</small></span>
            <ChevronRight />
          </button>
        </>
      ) : (
        <div className="results-main">
          <div className="result-summary">
            <div><strong>{rows.length}</strong><span>{markersWord(rows.length).replace(/^\d+ /, '')}</span></div>
            <div><i className="status-dot status-okay" /><strong>{inRangeCount}</strong><span>в диапазоне</span></div>
            <button type="button" onClick={() => setFilter('flagged')}>
              <i className="status-dot status-out" /><strong>{outsideCount}</strong><span>вне диапазона ↗</span>
            </button>
          </div>

          <button type="button" className="organism-teaser" onClick={() => setSection('organism')}>
            <span className="teaser-copy">
              <span className="scene-eyebrow">КАРТА ОРГАНИЗМА</span>
              <strong>Увидеть<br />общую картину.</strong>
              <small>Показатели и системы <span>↗</span></small>
            </span>
            <span className="teaser-body" aria-hidden="true">
              <BodySvg id="teaser" systems={systemsHere} />
            </span>
          </button>

          <label className="search-field">
            <Search />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Найти показатель" aria-label="Найти показатель" />
          </label>

          <div className="pills lab-filters">
            <button type="button" className={'pill' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>Все</button>
            <button type="button" className={'pill' + (filter === 'flagged' ? ' active' : '')} onClick={() => setFilter('flagged')}>Вне диапазона</button>
            {systemsHere.map(k => (
              <button key={k} type="button" className={'pill' + (filter === k ? ' active' : '')} onClick={() => setFilter(k)}>{SYSTEMS[k].name}</button>
            ))}
          </div>

          <section className="card lab-results" ref={listRef}>
            <div className="section-title">
              <h2>{scope === 'report' ? fmtDate(current.collectedAt) : 'Последние значения'}</h2>
              <select className="lab-scope" aria-label="Какие результаты показывать"
                value={scope === 'latest' ? 'latest' : current.id}
                onChange={e => {
                  if (e.target.value === 'latest') setScope('latest');
                  else { setScope('report'); setSelectedReportId(e.target.value); }
                }}>
                {sorted.map(r => <option key={r.id} value={r.id}>{shortDate(dayOf(r.collectedAt))} · {r.panelName || 'Анализ'}</option>)}
                <option value="latest">Последние значения по всем</option>
              </select>
            </div>
            <p className="lab-source">
              {scope === 'report'
                ? `${current.panelName || 'Анализ'} · ${current.lab || 'лаборатория не указана'} · ${markersWord(current.markers.length)}`
                : 'Самые свежие измерения из разных бланков — дата у каждого показателя своя.'}
            </p>
            {visibleRows.length === 0 ? (
              <p className="muted">Показатели не найдены. Попробуй другой запрос или фильтр.</p>
            ) : visibleRows.map(m => {
              const out = hasRef(m) && isOutOfRange(m);
              const status = out ? (m.refHigh != null && m.value > m.refHigh ? 'Выше диапазона' : 'Ниже диапазона') : hasRef(m) ? 'В диапазоне' : 'Без диапазона';
              const trail = m.history.slice(-3);
              return (
                <details key={m.key} className={'lab-inline ' + (out ? 'is-outside' : hasRef(m) ? 'is-normal' : 'is-unknown')}>
                  <summary>
                    <span className={'lab-status' + (out ? ' outside' : hasRef(m) ? '' : ' unknown')} role="img" aria-label={status}>
                      {out ? (status === 'Ниже диапазона' ? '↓' : '↑') : hasRef(m) ? '✓' : '–'}
                    </span>
                    <strong>{m.name}</strong>
                    <span className="lab-inline-value">{reading(m)} <small>{m.unit}</small></span>
                    <ChevronDown className="lab-expand" aria-hidden="true" />
                  </summary>
                  <div className="lab-inline-body">
                    <div className="lab-inline-meta">
                      <span>{status}</span>
                      <span>Диапазон: {refText(m)}{hasRef(m) && m.unit ? ` ${m.unit}` : ''}</span>
                    </div>
                    {m.sourceDate && <div className="lab-inline-meta"><span /><span>{shortDate(m.sourceDate)}{m.sourceLab ? ` · ${m.sourceLab}` : ''}</span></div>}
                    {trail.length > 1 && (
                      <div className="lab-trail">
                        {trail.map((p, i) => (
                          <span key={p.date + i} className="lab-trail-point">
                            {i > 0 && <i>→</i>}
                            <span><small>{shortDate(p.date)}</small><b>{num(p.value)}</b></span>
                          </span>
                        ))}
                      </div>
                    )}
                    {m.needsReview && <p className="lab-review">Распознано неуверенно — сверь с бланком.</p>}
                    <div className="lab-inline-actions">
                      <button type="button" onClick={() => openDetail(visibleRows, m)}>Динамика ↗</button>
                      {onDiscuss && <button type="button" onClick={() => discussMarker(m)}>✦ Обсудить с ИИ</button>}
                    </div>
                  </div>
                </details>
              );
            })}
          </section>

          <section className="card ux-lab-history">
            <div className="section-title"><h2>История анализов</h2></div>
            {sorted.slice(0, 3).map(r => (
              <button key={r.id} type="button" className="document-row" onClick={() => {
                setScope('report'); setSelectedReportId(r.id); setFilter('all'); setSearch('');
                requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
              }}>
                <time>{shortDate(dayOf(r.collectedAt))}</time>
                <span>
                  <strong>{r.panelName || 'Анализ'}</strong>
                  <small>{markersWord(r.markers.length)}{r.lab ? ` · ${r.lab}` : ''}</small>
                </span>
                <span>↗</span>
              </button>
            ))}
            <button type="button" className="archive-open" onClick={() => { setArchiveOpen(true); setArchiveItem(null); }}>Весь архив · поиск и фильтры →</button>
          </section>

          <p className="muted center">Открой показатель, чтобы увидеть его историю.</p>
        </div>
      )}

      <p className="muted center lab-disclaimer">Образовательная информация, не диагноз. Для интерпретации — обратись к врачу.</p>

      {/* Отдельный экран показателя поверх списка */}
      {detail && detailIndex != null && detailRows && (
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
          total={detailRows.length}
          selectedPoint={pointIndex}
          onClose={closeDetail}
          onPrev={() => stepDetail(-1)}
          onNext={() => stepDetail(1)}
          onSelectPoint={setPointIndex}
          onOpenSource={() => alert('Исходный файл бланка пока не сохраняется в приложении. Сейчас доступны распознанные значения.')}
          onDiscuss={() => { const m = detail; closeDetail(); discussMarker(m); }}
        />
      )}

      {archiveOpen && (
        <TxDialog title={archiveItem ? (archiveItem.panelName || 'Анализ') : 'Архив анализов'} onClose={() => setArchiveOpen(false)} wide>
          {archiveItem ? (
            <div className="archive-detail">
              <button type="button" onClick={() => setArchiveItem(null)}>← К результатам поиска</button>
              <dl>
                <dt>Дата сдачи</dt><dd>{fmtDate(archiveItem.collectedAt)}</dd>
                <dt>Лаборатория</dt><dd>{archiveItem.lab || 'не указана'}</dd>
                <dt>Показатели</dt><dd>{archiveItem.markers.length}</dd>
                <dt>Вне диапазона</dt><dd>{archiveItem.markers.filter(m => hasRef(m) && isOutOfRange(m)).length}</dd>
              </dl>
              <button type="button" className="primary" onClick={() => {
                setScope('report'); setSelectedReportId(archiveItem.id); setFilter('all'); setSearch('');
                setSection('results'); setArchiveOpen(false);
                requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
              }}>Открыть показатели</button>
              <button type="button" className="archive-delete" onClick={() => remove(archiveItem.id)}><Trash2 size={14} /> Удалить бланк</button>
            </div>
          ) : (
            <>
              <label className="archive-search">
                <Search size={16} />
                <input type="search" value={archiveQuery} onChange={e => { setArchiveQuery(e.target.value); setArchivePage(0); }} placeholder="Название или лаборатория" aria-label="Поиск по архиву" />
              </label>
              <div className="archive-filters">
                <label>Год
                  <select value={archiveYear} onChange={e => { setArchiveYear(e.target.value); setArchivePage(0); }}>
                    <option value="all">Все</option>
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </label>
                <label>На странице
                  <select value={archiveSize} onChange={e => { setArchiveSize(Number(e.target.value)); setArchivePage(0); }}>
                    {[10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              </div>
              <div className="archive-count" role="status">
                {archiveList.length
                  ? `${archivePageNow * archiveSize + 1}–${Math.min((archivePageNow + 1) * archiveSize, archiveList.length)} из ${archiveList.length}`
                  : 'Записи не найдены'}
              </div>
              <div className="archive-results">
                {archiveList.slice(archivePageNow * archiveSize, archivePageNow * archiveSize + archiveSize).map(r => {
                  const d = dayOf(r.collectedAt);
                  return (
                    <button key={r.id} type="button" className="archive-row" onClick={() => setArchiveItem(r)}>
                      <time>{d.slice(8)}.{d.slice(5, 7)}<small>{d.slice(0, 4)}</small></time>
                      <span><b>{r.panelName || 'Анализ'}</b><small>{r.lab || 'Лаборатория не указана'} · {markersWord(r.markers.length)}</small></span>
                      <span>↗</span>
                    </button>
                  );
                })}
                {archiveList.length === 0 && <p className="archive-empty">Измени запрос или выбери другой год.</p>}
              </div>
              {archivePages > 1 && (
                <div className="archive-pagination">
                  <button type="button" disabled={archivePageNow === 0} onClick={() => setArchivePage(archivePageNow - 1)} aria-label="Предыдущая страница">←</button>
                  <span>{archivePageNow + 1} из {archivePages}</span>
                  <button type="button" disabled={archivePageNow >= archivePages - 1} onClick={() => setArchivePage(archivePageNow + 1)} aria-label="Следующая страница">→</button>
                </div>
              )}
            </>
          )}
        </TxDialog>
      )}

      {mapOpen && (
        <TxDialog title="Карта связей" onClose={() => setMapOpen(false)} wide>
          <p>Анализы, препараты и самочувствие — и что с чем связано.</p>
          {mapData ? (
            <HealthMap
              labs={sorted.map(r => ({
                collectedAt: dayOf(r.collectedAt),
                markers: (r.markers || []).map(m => ({ name: m.name, value: m.value, flag: m.flag, unit: m.unit })),
              }))}
              courses={mapData.courses}
              fields={mapData.fields}
              entries={mapData.entries}
            />
          ) : (
            <p className="center"><Loader2 className="spin" size={18} /> Собираю карту…</p>
          )}
        </TxDialog>
      )}
    </div>
  );
}

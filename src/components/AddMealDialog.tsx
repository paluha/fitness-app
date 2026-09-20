'use client';

/**
 * Попап добавления приёма пищи по макету design/trainx-nutrition-reference.html.
 *
 * Поток: «Фото еды» / «Этикетка» → превью, дата-время снимка → анализ
 * существующим сервисом /api/food/analyze → автосохранение ОДНОЙ записи →
 * карточка результата с «Исправить» и «Посмотреть в дневнике».
 *
 * Защита от дублей: одна операция = один operationId. Повторы анализа и
 * повторы сохранения относятся к той же записи; двойное нажатие блокируется,
 * закрытие окна отменяет анализ, поздний ответ отменённого анализа игнорируется.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconCamera, IconScan, IconEdit, IconDown, IconPlus, IconFlame, num, asDate } from './NutritionPage';
import type { NutritionMeal } from './NutritionPage';

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const nowTime = () => new Date().toTimeString().slice(0, 5);
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export type CaptureMode = 'food' | 'label';
type Stamp = { date: string; time: string; source: 'exif' | 'upload' | 'manual' };

const validStamp = (date: string, time: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) && keyOf(asDate(date)) === date;

/**
 * Время съёмки берём из EXIF DateTimeOriginal (0x9003). Время изменения файла
 * (lastModified) временем съёмки НЕ считается — по заданию.
 */
export function readJpegCaptureTime(buffer: ArrayBuffer): Stamp | null {
  try {
    const v = new DataView(buffer), n = v.byteLength;
    if (n < 4 || v.getUint16(0) !== 0xffd8) return null;
    for (let p = 2; p + 4 < n;) {
      if (v.getUint8(p) !== 0xff) break;
      while (p + 1 < n && v.getUint8(p + 1) === 0xff) p++;
      const marker = v.getUint8(p + 1);
      if (marker === 0xda || marker === 0xd9) break;
      const size = v.getUint16(p + 2), end = p + 2 + size;
      if (size < 2 || end > n) break;
      const start = p + 4;
      if (marker === 0xe1 && size > 16 && v.getUint32(start) === 0x45786966 && v.getUint16(start + 4) === 0) {
        const t = start + 6, order = v.getUint16(t), little = order === 0x4949;
        if (order !== 0x4949 && order !== 0x4d4d) return null;
        if (v.getUint16(t + 2, little) !== 42) return null;
        const find = (offset: number, tag: number) => {
          const at = t + offset;
          if (at < t || at + 2 > end) return null;
          const count = v.getUint16(at, little);
          if (at + 2 + count * 12 > end) return null;
          for (let i = 0; i < count; i++) { const e = at + 2 + i * 12; if (v.getUint16(e, little) === tag) return e; }
          return null;
        };
        const pointer = find(v.getUint32(t + 4, little), 0x8769);
        if (pointer === null) return null;
        const entry = find(v.getUint32(pointer + 8, little), 0x9003);
        if (entry === null || v.getUint16(entry + 2, little) !== 2) return null;
        const length = v.getUint32(entry + 4, little);
        if (length < 19 || length > 100) return null;
        const at = t + v.getUint32(entry + 8, little);
        if (at < t || at + length > end) return null;
        const text = String.fromCharCode(...new Uint8Array(buffer, at, 19));
        const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):\d{2}$/.exec(text);
        if (!m) return null;
        const date = `${m[1]}-${m[2]}-${m[3]}`, time = `${m[4]}:${m[5]}`;
        return validStamp(date, time) ? { date, time, source: 'exif' } : null;
      }
      p = end;
    }
  } catch { /* повреждённый EXIF — считаем, что времени съёмки нет */ }
  return null;
}

export interface AnalyzeResult {
  name: string;
  protein: number; fat: number; carbs: number; calories: number;
  sugar?: number | null;
  /** Масса съеденной порции, если модель её определила. */
  weight?: number | null;
}

export interface AddMealDialogProps {
  open: boolean;
  selectedDate: string;
  quickItems: NutritionMeal[];
  editing?: NutritionMeal | null;
  onClose: () => void;
  /** Анализ фото существующим сервисом приложения. */
  onAnalyze: (args: { file: File; mode: CaptureMode; hint: string; signal: AbortSignal }) => Promise<AnalyzeResult>;
  /** Сохранение записи. Один operationId = одна запись (повтор обновляет её). */
  onSave: (meal: NutritionMeal, ctx: { date: string; operationId: string }) => Promise<void>;
  onQuickAdd: (meal: NutritionMeal) => void;
  onViewInDiary: (mealId: string, date: string) => void;
}

type View = 'start' | 'review' | 'result';

export default function AddMealDialog(props: AddMealDialogProps) {
  const { open, selectedDate, quickItems, editing, onClose, onAnalyze, onSave, onQuickAdd, onViewInDiary } = props;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [view, setView] = useState<View>('start');
  const [manualOpen, setManualOpen] = useState(false);
  const [mode, setMode] = useState<CaptureMode>('food');
  const [hint, setHint] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stamp, setStamp] = useState<Stamp | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [failure, setFailure] = useState<{ kind: 'network' | 'unrecognized' | 'save'; message: string } | null>(null);

  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [savedMeal, setSavedMeal] = useState<NutritionMeal | null>(null);
  const [portion, setPortion] = useState<string>('');

  // Одна операция добавления = один идентификатор. Повторы (анализа или
  // сохранения) не создают второй записи.
  const operationId = useRef<string>(uid());
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const savingRef = useRef(false);

  const [form, setForm] = useState({ time: nowTime(), name: '', protein: '', fat: '', carbs: '', calories: '', sugar: '', date: selectedDate });
  const [formError, setFormError] = useState<string | null>(null);

  const resetCapture = useCallback(() => {
    runRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setFile(null); setStamp(null); setResult(null); setSavedMeal(null);
    setAnalyzing(false); setFailure(null); setPortion('');
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
  }, []);

  // Открытие/закрытие нативного диалога
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      operationId.current = uid();
      setView('start'); setManualOpen(!!editing); setMode('food'); setHint(''); setInputError(null);
      resetCapture();
      setFormError(null);
      setForm(editing
        ? { time: editing.time, name: editing.name, protein: String(editing.protein), fat: String(editing.fat), carbs: String(editing.carbs), calories: String(editing.calories), sugar: editing.sugar == null ? '' : String(editing.sugar), date: selectedDate }
        : { time: nowTime(), name: '', protein: '', fat: '', carbs: '', calories: '', sugar: '', date: selectedDate });
    }
    if (!open && d.open) d.close();
  }, [open, editing, selectedDate, resetCapture]);

  // Закрытие окна отменяет анализ; уже сохранённая запись остаётся в дневнике.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const onCloseEvt = () => { resetCapture(); onClose(); };
    d.addEventListener('close', onCloseEvt);
    return () => d.removeEventListener('close', onCloseEvt);
  }, [onClose, resetCapture]);

  useEffect(() => () => { abortRef.current?.abort(); if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const stampText = (s: Stamp) =>
    `${asDate(s.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · ${s.time}`;

  /** Сохраняем результат: один operationId — одна запись, повтор её обновляет. */
  const persist = useCallback(async (analysis: AnalyzeResult, s: Stamp, grams: number | null) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const base = {
        grams: grams ?? 0,
        protein: analysis.protein, fat: analysis.fat, carbs: analysis.carbs,
        calories: analysis.calories, sugar: analysis.sugar ?? null,
      };
      const meal: NutritionMeal = {
        id: savedMeal?.id || operationId.current,
        time: s.time,
        name: analysis.name.trim().slice(0, 180),
        protein: analysis.protein, fat: analysis.fat, carbs: analysis.carbs, calories: analysis.calories,
        sugar: analysis.sugar ?? null,
        photoStamp: { ...s },
        captureKind: mode,
        portionGrams: grams,
        basePortion: grams ? base : null,
      };
      await onSave(meal, { date: s.date, operationId: operationId.current });
      setSavedMeal(meal);
      setFailure(null);
      setView('result');
    } catch {
      // Результат не теряем: повтор сохранения без нового распознавания.
      setFailure({ kind: 'save', message: 'Не удалось сохранить запись. Проверь соединение и повтори — распознавать заново не нужно.' });
    } finally {
      savingRef.current = false;
    }
  }, [mode, onSave, savedMeal]);

  const runAnalysis = useCallback(async (f: File, s: Stamp, currentHint: string, currentMode: CaptureMode) => {
    const run = ++runRef.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAnalyzing(true); setFailure(null);
    try {
      const res = await onAnalyze({ file: f, mode: currentMode, hint: currentHint, signal: ctrl.signal });
      if (run !== runRef.current) return;               // отменённый анализ записи не создаёт
      const ok = res && typeof res.name === 'string' && res.name.trim()
        && ['protein', 'fat', 'carbs', 'calories'].every(k => Number.isFinite(Number((res as unknown as Record<string, unknown>)[k])) && Number((res as unknown as Record<string, unknown>)[k]) >= 0);
      if (!ok) {
        setAnalyzing(false);
        setFailure({ kind: 'unrecognized', message: 'Не удалось определить блюдо по фото. Попробуй другое фото или введи данные вручную.' });
        return;
      }
      setResult(res);
      const grams = Number.isFinite(Number(res.weight)) && Number(res.weight) > 0 ? Number(res.weight) : null;
      setPortion(grams ? String(grams) : '');
      setAnalyzing(false);
      await persist(res, s, grams);
    } catch (e) {
      if (run !== runRef.current) return;
      setAnalyzing(false);
      if ((e as Error)?.name === 'AbortError') return;
      setFailure({ kind: 'network', message: 'Сеть не ответила. Фото и уточнение сохранены — можно повторить.' });
    }
  }, [onAnalyze, persist]);

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setInputError('Выбери фотографию.'); return; }
    if (f.size > 15 * 1024 * 1024) { setInputError('Выбери фото размером до 15 МБ.'); return; }
    setInputError(null);
    resetCapture();
    operationId.current = uid();
    const captured = readJpegCaptureTime(await f.arrayBuffer());
    const s: Stamp = captured || { date: keyOf(new Date()), time: nowTime(), source: 'upload' };
    const url = URL.createObjectURL(f);
    setFile(f); setStamp(s); setPreviewUrl(url); setView('review');
    await runAnalysis(f, s, hint.trim(), mode);
  };

  /** Пересчёт КБЖУ от ИСХОДНОЙ массы и исходных значений — без накопления ошибки. */
  const applyPortion = async () => {
    if (!result || !stamp || !savedMeal?.basePortion) return;
    const grams = Number(portion);
    if (!Number.isFinite(grams) || grams <= 0) return;
    const b = savedMeal.basePortion;
    const k = grams / b.grams;
    const scaled: AnalyzeResult = {
      name: result.name,
      protein: Math.round(b.protein * k * 10) / 10,
      fat: Math.round(b.fat * k * 10) / 10,
      carbs: Math.round(b.carbs * k * 10) / 10,
      calories: Math.round(b.calories * k),
      sugar: b.sugar == null ? null : Math.round(b.sugar * k * 10) / 10,
      weight: grams,
    };
    await persist(scaled, stamp, grams);
  };

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) { setFormError('Укажи название блюда.'); return; }
    const n = (v: string) => Number(v) || 0;
    const meal: NutritionMeal = {
      id: editing?.id || operationId.current,
      time: form.time, name,
      protein: n(form.protein), fat: n(form.fat), carbs: n(form.carbs), calories: n(form.calories),
      sugar: form.sugar === '' ? null : n(form.sugar),
      isFavorite: editing?.isFavorite,
    };
    try {
      await onSave(meal, { date: form.date, operationId: operationId.current });
      onClose();
    } catch {
      setFormError('Не удалось сохранить. Проверь соединение и повтори.');
    }
  };

  const retry = () => { if (file && stamp) runAnalysis(file, stamp, hint.trim(), mode); };

  return (
    <dialog ref={dialogRef} className="nutv2-dialog photo-dialog" aria-labelledby="addMealTitle">
      <div className="photo-sheet">
        <div className="sheet-top">
          <h2 id="addMealTitle">
            {view === 'result' ? 'Готово' : editing ? 'Изменить приём пищи' : view === 'review' ? (mode === 'label' ? 'По этикетке' : 'Еда по фото') : 'Добавить приём пищи'}
          </h2>
          <button className="icon-btn" type="button" aria-label="Закрыть окно" onClick={() => dialogRef.current?.close()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </div>
        <p className="sheet-copy">
          {view === 'result' ? 'Блюдо уже в дневнике. Калории и БЖУ пересчитаны.'
            : editing ? 'Данные на съеденную порцию.'
              : view === 'review' ? 'Определим блюдо и добавим его в дневник.'
                : 'По фото, этикетке или вручную.'}
        </p>
        {inputError && <p className="capture-note" role="alert">{inputError}</p>}

        {/* --- Начальный экран --- */}
        {view === 'start' && (
          <div>
            {!editing && (
              <>
                <div className="scan-buttons">
                  <button className="scan-button food-scan" type="button" aria-label="Добавить по фото еды"
                    onClick={() => { setMode('food'); fileRef.current?.click(); }}><IconCamera />Фото еды</button>
                  <button className="scan-button label-scan" type="button" aria-label="Добавить по фото этикетки"
                    onClick={() => { setMode('label'); fileRef.current?.click(); }}><IconScan />Этикетка</button>
                </div>
                <div className="scan-source-note"><span>Камера или фото из галереи</span></div>
                <div className="hint-label-row">
                  <label htmlFor="aiHint">Уточнение к фото <span>Необязательно</span></label>
                </div>
                <input className="ai-hint" id="aiHint" type="text" maxLength={400} value={hint}
                  onChange={e => setHint(e.target.value)} placeholder="Без масла, порция около 200 г" />
                <p className="portion-hint">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg>
                  <span>{mode === 'label' ? 'Укажи съеденную порцию: например, 150 г.' : 'Вес порции поможет точнее оценить КБЖУ.'}</span>
                </p>

                {quickItems.length > 0 && (
                  <div className="dialog-quick-section">
                    <div className="dialog-quick-heading"><IconPlus />Быстрое добавление</div>
                    <div className="dialog-quick" aria-label="Быстрые продукты">
                      {quickItems.slice(0, 8).map((m, i) => (
                        <button key={`${m.name}-${i}`} type="button" className="dialog-quick-item"
                          aria-label={`Добавить: ${m.name}, ${num(m.calories)} ккал`}
                          onClick={() => { onQuickAdd(m); dialogRef.current?.close(); }}>
                          <strong>{m.name}</strong><span>1 порция · {num(m.calories)} ккал</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="manual-entry">
                  <button className="manual-toggle" type="button" aria-expanded={manualOpen}
                    onClick={() => setManualOpen(v => !v)}>
                    <span className="manual-icon"><IconEdit /></span>Ввести вручную<IconDown />
                  </button>
                </div>
              </>
            )}

            {(manualOpen || editing) && (
              <form className="modal-meal-form" onSubmit={submitManual}>
                <div className="meal-name-fields">
                  <label className="field"><span>Время</span>
                    <input type="time" required value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} /></label>
                  <label className="field"><span>Название</span>
                    <input type="text" maxLength={180} required placeholder="Например, курица с рисом"
                      value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></label>
                </div>
                <div className="manual-macros">
                  {([['protein', 'Белки, г', 'var(--protein)'], ['fat', 'Жиры, г', 'var(--fat)'], ['carbs', 'Углев., г', 'var(--carbs)'], ['calories', 'Ккал', 'var(--accent)']] as const).map(([k, label, color]) => (
                    <label className="field" key={k}>
                      <span style={{ color }}>{label}</span>
                      <input type="number" min={0} step="0.1" placeholder="0" required
                        value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
                    </label>
                  ))}
                </div>
                <p className="manual-portion-note">На съеденную порцию</p>
                <div className="manual-extras">
                  <label className="field"><span>Сахар, г</span>
                    <input type="number" min={0} step="0.1" placeholder="—" value={form.sugar}
                      onChange={e => setForm(f => ({ ...f, sugar: e.target.value }))} /></label>
                  <label className="field"><span>Дата</span>
                    <input type="date" required value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></label>
                </div>
                {formError && <p className="form-error">{formError}</p>}
                <div className="form-actions">
                  <button type="button" className="secondary" onClick={() => dialogRef.current?.close()}>Отмена</button>
                  <button type="submit" className="primary">{editing ? 'Сохранить' : 'Добавить'}</button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* --- Превью и анализ --- */}
        {view === 'review' && (
          <div>
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="photo-review-image" src={previewUrl} alt="Выбранное фото блюда" />
            )}
            {stamp && (
              <div className="photo-time">
                <div className="photo-time-line">
                  <span>{stamp.source === 'upload' ? 'Время добавления' : 'Снимок сделан'}</span>
                  <strong>{stampText(stamp)}</strong>
                </div>
                <p className="photo-time-note">
                  {stamp.source === 'exif' ? 'Дата и время взяты из данных фотографии.'
                    : stamp.source === 'upload' ? 'Время съёмки не найдено. Указано время загрузки — при необходимости исправь.'
                      : 'Дата и время указаны тобой.'}
                </p>
                <details>
                  <summary>Изменить дату и время</summary>
                  <div className="fields-2">
                    <label className="field"><span>Дата</span>
                      <input type="date" value={stamp.date} disabled={analyzing}
                        onChange={e => { const d = e.target.value; if (validStamp(d, stamp.time)) setStamp({ date: d, time: stamp.time, source: 'manual' }); }} /></label>
                    <label className="field"><span>Время</span>
                      <input type="time" value={stamp.time} disabled={analyzing}
                        onChange={e => { const tm = e.target.value; if (validStamp(stamp.date, tm)) setStamp({ date: stamp.date, time: tm, source: 'manual' }); }} /></label>
                  </div>
                </details>
              </div>
            )}

            {analyzing && (
              <div className="analysis-status" role="status">
                <i className="analysis-spinner" aria-hidden="true" />
                <div>
                  <span>{mode === 'label' ? 'Читаем этикетку и КБЖУ' : 'Определяем блюдо и БЖУ…'}</span>
                  <p>После ответа запись появится в дневнике.</p>
                </div>
              </div>
            )}

            {failure && (
              <div>
                <p className="capture-note">{failure.message}</p>
                <div className="capture-actions">
                  {failure.kind === 'network' && <button type="button" className="primary" onClick={retry}>Повторить</button>}
                  {failure.kind === 'save' && <button type="button" className="primary"
                    onClick={() => { if (result && stamp) persist(result, stamp, Number(portion) || null); }}>Повторить сохранение</button>}
                  <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>Другое фото</button>
                  <button type="button" className="secondary" onClick={() => { setView('start'); setManualOpen(true); }}>Ввести вручную</button>
                </div>
              </div>
            )}

            {!analyzing && !failure && <button type="button" className="text-btn" onClick={() => fileRef.current?.click()}>Выбрать другое фото</button>}
          </div>
        )}

        {/* --- Результат: запись уже в дневнике --- */}
        {view === 'result' && savedMeal && stamp && (
          <div aria-live="polite">
            <div className="result-status">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>
              Добавлено в дневник
            </div>
            <div className="result-food">
              <div className="result-food-heading">
                {previewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="result-thumb" src={previewUrl} alt="Фото добавленного блюда" />
                )}
                <div>
                  <h3>{savedMeal.name}</h3>
                  <p className="result-time">
                    {mode === 'label' ? <IconScan /> : <IconCamera />}
                    {stamp.source === 'upload' ? 'Добавлено' : mode === 'label' ? 'Этикетка' : 'Фото'} {stampText(stamp)}
                  </p>
                </div>
              </div>
              <div className="result-kcal">{num(savedMeal.calories)} <small>ккал</small></div>
              <div className="result-macros">
                <div><span>Белки</span><b>{num(savedMeal.protein)} г</b></div>
                <div><span>Жиры</span><b>{num(savedMeal.fat)} г</b></div>
                <div><span>Углеводы</span><b>{num(savedMeal.carbs)} г</b></div>
              </div>

              {/* Порция: пересчёт от исходной массы. Массы нет — честно говорим. */}
              <div className="fields-2" style={{ marginTop: 12, alignItems: 'end' }}>
                <label className="field">
                  <span>Порция, г</span>
                  <input type="number" min={1} step={1} value={portion}
                    placeholder={savedMeal.basePortion ? '' : 'Не определена'}
                    onChange={e => setPortion(e.target.value)} />
                </label>
                <button type="button" className="secondary" disabled={!savedMeal.basePortion || !portion}
                  onClick={applyPortion}>Пересчитать</button>
              </div>
              {!savedMeal.basePortion && <p className="manual-portion-note">Массу порции определить не удалось — укажи её вручную через «Исправить».</p>}
            </div>

            {failure?.kind === 'save' && <p className="capture-note">{failure.message}</p>}

            <p className="result-footnote">
              {mode === 'label' ? 'Проверь размер порции. Данные можно поправить.' : 'КБЖУ по фото — оценка. Данные можно поправить.'}
            </p>
            <div className="result-buttons">
              <button className="primary" type="button"
                onClick={() => { onViewInDiary(savedMeal.id, stamp.date); dialogRef.current?.close(); }}>Посмотреть в дневнике</button>
              <button className="secondary" type="button"
                onClick={() => {
                  setForm({
                    time: savedMeal.time, name: savedMeal.name,
                    protein: String(savedMeal.protein), fat: String(savedMeal.fat),
                    carbs: String(savedMeal.carbs), calories: String(savedMeal.calories),
                    sugar: savedMeal.sugar == null ? '' : String(savedMeal.sugar),
                    date: stamp.date,
                  });
                  setView('start'); setManualOpen(true);
                }}>Исправить</button>
            </div>
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*" hidden
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; pickFile(f); }} />
      </div>
    </dialog>
  );
}

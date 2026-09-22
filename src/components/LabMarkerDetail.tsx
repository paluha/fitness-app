'use client';

/**
 * Отдельный экран показателя по эталону design/trainx-analyses-reference.html.
 *
 * На телефоне — во всю высоту, на широком экране — боковая панель. Закрывается
 * кнопкой «К списку», Escape и системной кнопкой «Назад»; список при этом
 * остаётся на своей позиции с прежними фильтрами.
 *
 * Здесь только описание результата: что измерено, каким бланком и как
 * менялось. Медицинских выводов и срочности экран не делает.
 */

import { useEffect, useRef } from 'react';
import { LAB_TONES, labStatus, hasRef, isOutOfRange, refText } from './LabMarkerList';
import type { LabMarkerRow, LabMarkerPoint } from './LabMarkerList';

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const num = (n: number) => nf.format(n);
const dateText = (s: string) =>
  new Date(`${s}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (s: string) =>
  new Date(`${s}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

/** Как читать значение: «<5» — это не точная пятёрка. */
export function readingText(m: { value: number; rawValue?: string | null; bound?: 'exact' | 'below' | 'above' }) {
  if (m.rawValue && m.rawValue.trim()) return m.rawValue.trim();
  if (m.bound === 'below') return `< ${num(m.value)}`;
  if (m.bound === 'above') return `> ${num(m.value)}`;
  return num(m.value);
}

/**
 * Описание наблюдаемого отклонения. Строго фактическое: насколько значение
 * вышло за указанный предел. Причину, опасность и срочность здесь не
 * называем — для этого нужен контекст и специалист.
 */
function explanation(m: LabMarkerRow): string {
  if (!hasRef(m)) {
    return 'В исходном бланке не указан диапазон. Поэтому результат не отмечен как нормальный или отклонённый. Сначала уточни референс лаборатории.';
  }
  if (m.bound && m.bound !== 'exact') {
    return `Лаборатория указала результат как «${readingText(m)}» — это граница определения, а не точное значение. Сравнение с диапазоном здесь приблизительное.`;
  }
  if (!isOutOfRange(m)) {
    return 'Значение находится в пределах указанного лабораторией диапазона. Это описание результата, а не заключение об отсутствии заболеваний.';
  }
  const high = m.refHigh != null && m.value > m.refHigh;
  const limit = high ? m.refHigh! : m.refLow!;
  return `${high ? 'Выше верхнего' : 'Ниже нижнего'} предела на ${num(Math.abs(m.value - limit))} ${m.unit}. `
    + 'Отклонение само по себе не определяет причину или срочность: нужны контекст, симптомы и оценка специалиста.';
}

export interface LabDetailSource {
  date: string;
  lab: string;
  panelName: string;
  /** Есть ли сохранённый исходный файл бланка. */
  hasFile: boolean;
}

export default function LabMarkerDetail({
  marker, source, position, total, selectedPoint,
  onClose, onPrev, onNext, onSelectPoint, onOpenSource, onDiscuss,
}: {
  marker: LabMarkerRow;
  source: LabDetailSource;
  /** Номер в текущем отфильтрованном списке, с 1. */
  position: number;
  total: number;
  selectedPoint: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSelectPoint: (i: number) => void;
  onOpenSource: () => void;
  onDiscuss: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // Открываем модально: это даёт фокус-ловушку и Escape без своего кода.
  useEffect(() => {
    const el = ref.current;
    if (!el || el.open) return;
    el.showModal();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  /**
   * Системная кнопка «Назад» закрывает экран, а не уводит из раздела.
   *
   * Эффект должен встать РОВНО ОДИН раз: onClose приходит новой функцией
   * на каждый рендер родителя, и с ним в зависимостях эффект переподключался
   * — cleanup вызывал history.back(), popstate закрывал только что открытый
   * экран. Ссылку на колбэк держим в ref, а зависимости оставляем пустыми.
   */
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  /**
   * Системная кнопка «Назад» закрывает экран, а не уводит из раздела.
   *
   * Запись в историю добавляем ОДИН раз за открытие и не снимаем её в
   * cleanup: в разработке эффекты монтируются дважды, и history.back() из
   * первого cleanup закрывал только что открытый экран. Лишняя запись
   * безвредна — по «назад» пользователь всё равно попадает в список.
   */
  const historyPushed = useRef(false);
  useEffect(() => {
    if (!historyPushed.current) {
      historyPushed.current = true;
      history.pushState({ labMarker: true }, '');
    }
    const onPop = () => { closeRef.current(); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const tone = LAB_TONES[labStatus(marker)];
  const points: LabMarkerPoint[] = marker.history;
  const point = points[selectedPoint] ?? points[points.length - 1];
  const first = points[0];
  const delta = point && first ? point.value - first.value : 0;

  return (
    <dialog
      ref={ref}
      className="labv2-detail"
      aria-labelledby="labDetailName"
      onCancel={e => { e.preventDefault(); onClose(); }}
      onClose={onClose}
    >
      <header className="detail-top">
        <button type="button" onClick={onClose}>← К списку</button>
        <span>{total > 0 ? `${position} из ${total}` : 'Показатель из сводки'}</span>
      </header>

      <div className="detail-body">
        <h2 id="labDetailName">{marker.name}</h2>
        <p className="detail-context">
          {dateText(source.date)}
          {source.lab ? ` · ${source.lab}` : ''}
          {source.panelName ? ` · ${source.panelName}` : ''}
          {marker.specimen ? ` · ${marker.specimen}` : ''}
          {marker.method ? ` · ${marker.method}` : ''}
        </p>

        <div className="detail-reading">
          {readingText(marker)} <small>{marker.unit}</small>
          <div className="detail-state" style={{ color: tone.ink }}>
            {tone.label} · реф. {refText(marker)}
          </div>
        </div>

        <div className="explanation">
          <h3>Что отмечено</h3>
          <p>{explanation(marker)}</p>
        </div>

        {/* История: настоящие замеры, без домысленной линии на одной точке. */}
        <section className="card trend" style={{ marginTop: 16, padding: 14 }}>
          <div className="trend-head">
            <h2 style={{ fontSize: 15, letterSpacing: 0, fontWeight: 650, margin: 0 }}>Динамика</h2>
          </div>
          {points.length > 1 ? (
            <>
              <div className="trend-metric">
                <div className="trend-value" style={{ fontSize: 25 }}>
                  {num(point.value)} <small>{marker.unit}</small>
                </div>
                <div className="trend-change" style={{ maxWidth: '45%' }}>
                  {selectedPoint > 0 ? (
                    <>
                      <b>{delta > 0 ? '+' : ''}{num(delta)} {marker.unit}</b>
                      с {shortDate(first.date)}
                    </>
                  ) : 'Начало периода'}
                </div>
              </div>
              <div>
                {points.slice().reverse().map((p, i) => {
                  const idx = points.length - 1 - i;
                  return (
                    <button
                      key={p.date + idx}
                      type="button"
                      className="history-row"
                      aria-pressed={idx === selectedPoint}
                      onClick={() => onSelectPoint(idx)}
                    >
                      <span>{shortDate(p.date)}{p.lab ? ` · ${p.lab}` : ''}</span>
                      <span>
                        {num(p.value)} {marker.unit}
                        {' · реф. '}
                        {refText({ refLow: p.refLow ?? null, refHigh: p.refHigh ?? null })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="history-single">
              Один замер: {num(point?.value ?? marker.value)} {marker.unit} от {shortDate(point?.date ?? source.date)}.
              Линию динамики построить не по чему — нужен хотя бы ещё один результат того же показателя.
            </p>
          )}
          <button className="text-btn ai-link" type="button" onClick={onDiscuss}>
            <span>Обсудить показатель с ИИ</span>
            <span>→</span>
          </button>
        </section>

        <p className="scope-note">
          История сопоставляет один показатель в одинаковых единицах, биоматериале и методике.
          Референс показан у каждого замера: у прежних бланков он мог отличаться.
        </p>

        <button className="source-link" type="button" onClick={onOpenSource}>
          {source.hasFile ? 'Открыть исходный бланк' : 'Исходный файл не приложен к этому бланку'}
        </button>

        <div className="detail-actions">
          <button type="button" onClick={onPrev} disabled={position <= 1}>← Предыдущий</button>
          <button type="button" onClick={onNext} disabled={position >= total}>Следующий →</button>
        </div>
      </div>
    </dialog>
  );
}

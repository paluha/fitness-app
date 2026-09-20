'use client';

/**
 * Список показателей анализов по эталону design/trainx-analyses-reference.html.
 *
 * Строка на показатель: слева название, под ним референс и статус, справа
 * значение с единицами и мини-график истории. Фон мини-графика — цвет
 * текущего статуса; высота фона одинакова у всех строк и не зависит от
 * значения. Начало графика растворяется слева, последняя точка чёткая.
 *
 * Оформление изолировано классами .labv2 (см. globals.css).
 */

import { useMemo } from 'react';

export interface LabMarkerPoint {
  /** Дата забора, YYYY-MM-DD — по ней строится история. */
  date: string;
  value: number;
  /** Референсы того бланка, откуда точка: статус считается по ним. */
  refLow?: number | null;
  refHigh?: number | null;
  optimalLow?: number | null;
  optimalHigh?: number | null;
}

export interface LabMarkerRow {
  /** Стабильный идентификатор аналита: по нему собирается история. */
  key: string;
  name: string;
  value: number;
  unit: string;
  refLow?: number | null;
  refHigh?: number | null;
  /**
   * Оптимальный диапазон — ЗАДАЁТСЯ ОТДЕЛЬНО и только им определяется
   * статус «Оптимально». Если его нет, показатель может быть максимум
   * «В диапазоне» (или «Нет референса»). Демозначения из макета сюда не
   * переносятся.
   */
  optimalLow?: number | null;
  optimalHigh?: number | null;
  /** История этого же показателя в совместимых единицах, по возрастанию даты. */
  history: LabMarkerPoint[];
}

export type LabStatus = 'out' | 'normal' | 'optimal' | 'unknown';

/** Оттенки статусов — ровно те, что в эталоне. */
export const LAB_TONES: Record<LabStatus, { ink: string; fill: string; label: string }> = {
  out: { ink: '#c86246', fill: '#f9e2d9', label: 'Вне диапазона' },
  normal: { ink: '#9a7b26', fill: '#f4ecd1', label: 'В диапазоне' },
  optimal: { ink: '#438564', fill: '#dfeee4', label: 'Оптимально' },
  unknown: { ink: '#918777', fill: '#efebe5', label: 'Нет референса' },
};

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const num = (n: number) => nf.format(n);

export function hasRef(m: { refLow?: number | null; refHigh?: number | null }) {
  return m.refLow != null || m.refHigh != null;
}

/** Вне референса? Пустая граница означает, что с этой стороны предела нет. */
export function isOutOfRange(m: { value: number; refLow?: number | null; refHigh?: number | null }) {
  if (m.refLow != null && m.value < m.refLow) return true;
  if (m.refHigh != null && m.value > m.refHigh) return true;
  return false;
}

/**
 * Статус показателя. «Оптимально» возможно ТОЛЬКО при заданном оптимальном
 * диапазоне, который к тому же лежит внутри референса — иначе это просто
 * «В диапазоне».
 */
export function labStatus(m: LabMarkerRow): LabStatus {
  if (!hasRef(m)) return 'unknown';
  if (isOutOfRange(m)) return 'out';
  const { optimalLow: lo, optimalHigh: hi } = m;
  const optimalDefined = typeof lo === 'number' && Number.isFinite(lo)
    && typeof hi === 'number' && Number.isFinite(hi) && lo <= hi
    && (m.refLow == null || lo >= m.refLow)
    && (m.refHigh == null || hi <= m.refHigh);
  if (optimalDefined && m.value >= (lo as number) && m.value <= (hi as number)) return 'optimal';
  return 'normal';
}

export function refText(m: { refLow?: number | null; refHigh?: number | null }) {
  if (m.refLow != null && m.refHigh != null) return `${num(m.refLow)}–${num(m.refHigh)}`;
  if (m.refLow != null) return `от ${num(m.refLow)}`;
  if (m.refHigh != null) return `до ${num(m.refHigh)}`;
  return 'не указан';
}

/**
 * Мини-график истории. Размеры и геометрия — из эталона: поле 72×42,
 * фон-плашка от y=5 высотой 30 (одинаковая у всех строк), линия и точки
 * внутри. Маска даёт растворение слева, последняя точка остаётся чёткой.
 */
function MiniChart({ row, status, index }: { row: LabMarkerRow; status: LabStatus; index: number }) {
  const tone = LAB_TONES[status];
  const ps = row.history;

  const geom = useMemo(() => {
    if (!ps.length) return null;
    const values = ps.map(p => p.value);
    const bounds = [...values];
    if (row.refLow != null) bounds.push(row.refLow);
    if (row.refHigh != null) bounds.push(row.refHigh);
    const mn = Math.min(...bounds);
    const mx = Math.max(...bounds);
    const spread = Math.max(mx - mn, Math.abs(mx) * 0.08, 0.1);
    const lo = mn - spread * 0.18;
    const hi = mx + spread * 0.18;
    const y = (v: number) => 31 - ((v - lo) / (hi - lo)) * 22;
    const times = ps.map(p => new Date(`${p.date}T12:00:00`).getTime());
    const t0 = times[0];
    const tn = times[times.length - 1];
    const x = (i: number) => ps.length === 1 ? 36 : 5 + ((times[i] - t0) / Math.max(tn - t0, 1)) * 61;
    return { x, y };
  }, [ps, row.refLow, row.refHigh]);

  const bgId = `lab-mini-bg-${index}`;
  const fadeId = `lab-mini-fade-${index}`;
  const maskId = `lab-mini-mask-${index}`;

  return (
    <span className="marker-mini" aria-hidden="true">
      <svg className="mini-chart" viewBox="0 0 72 42">
        <defs>
          <linearGradient id={bgId}>
            <stop offset="0" stopColor={tone.fill} stopOpacity="0" />
            <stop offset=".35" stopColor={tone.fill} stopOpacity=".7" />
            <stop offset=".7" stopColor={tone.fill} />
            <stop offset="1" stopColor={tone.fill} stopOpacity=".6" />
          </linearGradient>
          <linearGradient id={fadeId}>
            <stop offset="0" stopColor="white" stopOpacity="0" />
            <stop offset=".4" stopColor="white" stopOpacity=".7" />
            <stop offset=".8" stopColor="white" />
          </linearGradient>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="72" height="42">
            <rect width="72" height="42" fill={`url(#${fadeId})`} />
          </mask>
        </defs>
        {/* Плашка одинаковой высоты во всех строках: её размер не зависит
            от значения показателя — только цвет говорит о статусе. */}
        <rect className="mini-background" x="0" y="5" width="72" height="30" rx="3" fill={`url(#${bgId})`} />
        {geom && (
          <g mask={`url(#${maskId})`}>
            {ps.length > 1 && (
              <polyline
                className="mini-line"
                pathLength={1}
                points={ps.map((p, i) => `${geom.x(i)},${geom.y(p.value)}`).join(' ')}
              />
            )}
            {/* Каждая точка окрашена своим статусом на ту дату: видно, когда
                показатель выходил за референс, а не только где он сейчас. */}
            {ps.map((p, i) => (
              <circle
                key={p.date}
                cx={geom.x(i)}
                cy={geom.y(p.value)}
                r={i === ps.length - 1 ? 3.1 : 2.1}
                fill={LAB_TONES[labStatus({
                  key: row.key, name: row.name, unit: row.unit, history: [],
                  value: p.value,
                  refLow: p.refLow ?? row.refLow,
                  refHigh: p.refHigh ?? row.refHigh,
                  optimalLow: p.optimalLow ?? row.optimalLow,
                  optimalHigh: p.optimalHigh ?? row.optimalHigh,
                })].ink}
              />
            ))}
          </g>
        )}
        {ps.length === 1 && <text x="36" y="41" textAnchor="middle">1 замер</text>}
      </svg>
    </span>
  );
}

export default function LabMarkerList({
  markers, selectedKey, onSelect, emptyText = 'Показателей по этому фильтру нет',
}: {
  markers: LabMarkerRow[];
  selectedKey?: string | null;
  onSelect: (m: LabMarkerRow) => void;
  emptyText?: string;
}) {
  if (!markers.length) {
    return <div className="labv2"><div className="markers"><div className="empty">{emptyText}</div></div></div>;
  }
  return (
    <div className="labv2">
      <div className="markers">
        {markers.map((m, i) => {
          const status = labStatus(m);
          const tone = LAB_TONES[status];
          return (
            <button
              key={m.key}
              className="marker"
              type="button"
              data-status={status}
              aria-pressed={m.key === selectedKey}
              aria-label={`${m.name}, ${num(m.value)} ${m.unit}. ${tone.label}. Открыть динамику`}
              onClick={() => onSelect(m)}
            >
              <div className="marker-top"><h3>{m.name}</h3></div>
              <div className="marker-reading">
                <span className="marker-value">{num(m.value)}</span>
                <span className="marker-unit">{m.unit}</span>
              </div>
              <MiniChart row={m} status={status} index={i} />
              <div className="marker-bottom">
                <span className="marker-ref">Реф. {refText(m)}</span>
                <span className="marker-state" style={{ color: tone.ink }}>{tone.label}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';

/**
 * График «Мой прогресс» по макету редизайна: плавная линия с заливкой,
 * период «Все / последние 3», ползунок по точкам — под графиком дата и
 * значение выбранного замера. data/dates — старые→новые.
 */
export function ProgressChart({ data, dates, unit }: { data: number[]; dates: string[]; unit: string }) {
  const [range, setRange] = useState<'all' | 'last3'>('all');
  const [picked, setPicked] = useState<number | null>(null);
  const from = range === 'last3' ? Math.max(0, data.length - 3) : 0;
  const vals = data.slice(from);
  const labs = dates.slice(from);
  const idx = picked == null || picked >= vals.length ? vals.length - 1 : picked;

  const W = 310, H = 150, L = 36, R = 14, T = 16, B = 24;
  const cw = W - L - R, ch = H - T - B;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.15, 0.5);
  const min = lo - pad, max = hi + pad;
  const pts = vals.map((v, i) => ({
    x: L + (vals.length === 1 ? cw / 2 : (i / (vals.length - 1)) * cw),
    y: T + ch - ((v - min) / (max - min)) * ch,
  }));
  // Плавная кривая через точки (кардинальный сплайн → кубические Безье)
  const line = pts.map((p, i) => {
    if (i === 0) return `M${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    const p0 = pts[i - 2] ?? pts[i - 1], p1 = pts[i - 1], p3 = pts[i + 1] ?? p;
    const c1x = p1.x + (p.x - p0.x) / 6, c1y = p1.y + (p.y - p0.y) / 6;
    const c2x = p.x - (p3.x - p1.x) / 6, c2y = p.y - (p3.y - p1.y) / 6;
    return `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${T + ch} L${pts[0].x.toFixed(1)},${T + ch} Z`;
  const sel = pts[idx];
  const fmt = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

  return (
    <div className="ux-progress">
      <svg className="ux-progress-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`График: от ${fmt(lo)} до ${fmt(hi)} ${unit}`}>
        <defs>
          <linearGradient id="ux-progress-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff5c35" stopOpacity=".2" />
            <stop offset="100%" stopColor="#ff5c35" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[max - pad, (min + max) / 2, min + pad].map((v, i) => {
          const y = T + ch - ((v - min) / (max - min)) * ch;
          return (
            <g key={i}>
              <line x1={L} x2={W - R} y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 4" />
              <text x={L - 6} y={y + 3} fontSize="9" textAnchor="end" fill="var(--text-muted)">{fmt(v)}</text>
            </g>
          );
        })}
        <path d={area} fill="url(#ux-progress-fill)" className="ux-progress-area" />
        <path d={line} fill="none" stroke="#ff5c35" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="ux-progress-line" />
        <line x1={sel.x} x2={sel.x} y1={T} y2={T + ch} stroke="#ff5c35" strokeOpacity=".35" strokeDasharray="2 3" />
        <circle className="ux-chart-halo" cx={sel.x} cy={sel.y} r="10" fill="#ff5c35" opacity=".16" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === idx ? 5 : 3} fill={i === idx ? '#ff5c35' : 'var(--bg-card)'} stroke="#ff5c35" strokeWidth="2"
            style={{ cursor: 'pointer' }} onClick={() => setPicked(i)} />
        ))}
        <text x={L} y={H - 6} fontSize="9" fill="var(--text-muted)">{labs[0]}</text>
        {labs.length > 1 && <text x={W - R} y={H - 6} fontSize="9" textAnchor="end" fill="var(--text-muted)">{labs[labs.length - 1]}</text>}
      </svg>
      <div className="ux-progress-controls">
        <span><b>{fmt(vals[idx])} {unit}</b> · {labs[idx]}</span>
        <div>
          <button type="button" className={range === 'last3' ? 'is-active' : undefined} onClick={() => { setRange('last3'); setPicked(null); }}>Последние 3</button>
          <button type="button" className={range === 'all' ? 'is-active' : undefined} onClick={() => { setRange('all'); setPicked(null); }}>Все</button>
          <button type="button" aria-label="Сбросить" onClick={() => { setRange('all'); setPicked(null); }}>↻</button>
        </div>
      </div>
      {vals.length > 1 && (
        <input className="ux-progress-scrub" type="range" min={0} max={vals.length - 1} step={1} value={idx}
          onChange={e => setPicked(Number(e.target.value))} aria-label="Выбрать замер" />
      )}
    </div>
  );
}

// График веса по замерам (bodyMeasurements). Самодостаточный SVG,
// тема через CSS-переменные. data — веса по датам (старые→новые), labels — даты.
export function WeightChart({ data, labels }: { data: number[]; labels: string[] }) {
  if (data.length === 0) return null;

  if (data.length === 1) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <p style={{ fontSize: 32, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {data[0].toFixed(1)}
          <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>кг</span>
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>{labels[0]}</p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '12px 0 0' }}>
          Добавь ещё замер — построю график динамики.
        </p>
      </div>
    );
  }

  // Геометрия и акцент — по макету design/trainx-workout-dev.html.
  const width = 310, height = 168;
  const padding = { top: 22, right: 18, bottom: 30, left: 42 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const min = Math.min(...data) - 1;
  const max = Math.max(...data) + 1;
  const range = max - min || 1;

  const points = data.map((value, index) => ({
    x: padding.left + (index / (data.length - 1)) * chartWidth,
    y: padding.top + chartHeight - ((value - min) / range) * chartHeight,
    value,
  }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');

  // В макете линия всегда фирменная оранжевая — направление читается
  // по самой кривой и подписи дельты над графиком.
  const stroke = '#ff5c35';

  const gridLines = [0, 0.5, 1].map(ratio => ({
    y: padding.top + chartHeight * (1 - ratio),
    value: min + range * ratio,
  }));

  return (
    <div style={{ width: '100%' }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
        {gridLines.map((line, i) => (
          <g key={i}>
            <line x1={padding.left} y1={line.y} x2={width - padding.right} y2={line.y}
              stroke="var(--border)" strokeDasharray="4,4" />
            <text x={padding.left - 8} y={line.y + 4} fill="var(--text-muted)" fontSize="10" textAnchor="end">
              {line.value.toFixed(0)}
            </text>
          </g>
        ))}
        <defs>
          <linearGradient id="wgt" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.17" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${pathD} L ${points[points.length - 1].x},${padding.top + chartHeight} L ${points[0].x},${padding.top + chartHeight} Z`} fill="url(#wgt)" />
        <path d={pathD} fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill="var(--bg-card)" stroke={stroke} strokeWidth="2" />
            {(i === 0 || i === points.length - 1) && (
              <text x={p.x} y={p.y - 10} fill="var(--text-primary)" fontSize="11" fontWeight="600" textAnchor="middle">
                {p.value.toFixed(1)}
              </text>
            )}
          </g>
        ))}
        {labels.length <= 7 ? labels.map((label, i) => (
          <text key={i} x={padding.left + (i / (labels.length - 1)) * chartWidth} y={height - 8}
            fill="var(--text-muted)" fontSize="9" textAnchor="middle">{label}</text>
        )) : (
          <>
            <text x={padding.left} y={height - 8} fill="var(--text-muted)" fontSize="9" textAnchor="start">{labels[0]}</text>
            <text x={width - padding.right} y={height - 8} fill="var(--text-muted)" fontSize="9" textAnchor="end">{labels[labels.length - 1]}</text>
          </>
        )}
      </svg>
    </div>
  );
}

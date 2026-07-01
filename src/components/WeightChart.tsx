'use client';

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

  const width = 320, height = 150;
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

  const change = data[data.length - 1] - data[0];
  const isDecreasing = change < 0;
  const stroke = isDecreasing ? '#22c55e' : '#f59e0b';

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
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <path d={`${pathD} L ${points[points.length - 1].x},${padding.top + chartHeight} L ${points[0].x},${padding.top + chartHeight} Z`} fill="url(#wgt)" />
        <path d={pathD} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
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
      <div style={{ textAlign: 'center', marginTop: 6, fontSize: 13, fontWeight: 700, color: stroke }}>
        {change === 0 ? 'без изменений' : `${change > 0 ? '+' : ''}${change.toFixed(1)} кг`}
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>
          за период
        </span>
      </div>
    </div>
  );
}

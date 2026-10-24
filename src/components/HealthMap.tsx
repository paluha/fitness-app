'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  KNOWN_LINKS, NODE_LABELS, NODE_KIND,
  canonLab, canonMed, canonFeel, observedLink,
  type GraphNode, type LinkKind,
} from '@/lib/health-graph';

/**
 * Карта здоровья: анализы, препараты и самочувствие одним графом.
 *
 * Связи двух видов, и они НЕ равнозначны:
 *  — сплошная линия: связь видна в данных пользователя;
 *  — пунктир: справочное знание, повод проверить, а не вывод о нём.
 *
 * Разделение сделано намеренно. Сплошная линия на справочном знании
 * означала бы «у тебя витамин D поднял тестостерон» — утверждение,
 * которого данные не подтверждают.
 */

type LabMarker = { name: string; value: number | null; flag?: string; unit?: string };
type LabReport = { collectedAt: string; markers: LabMarker[] };
type Course = { id: string; name: string; dose?: string; endedAt?: string };
type Field = { id: string; name: string; kind: string; archived?: boolean };
type Entry = { date: string; values: Record<string, number | string> };

type Link = { from: string; to: string; kind: LinkKind; strength: number; note: string };

export function HealthMap({ labs, courses, fields, entries }: {
  labs: LabReport[];
  courses: Course[];
  fields: Field[];
  entries: Entry[];
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [size, setSize] = useState(340);

  // Круг подгоняем под ширину экрана: на 390px телефоне и на планшете
  // радиус должен быть разным, иначе подписи либо жмутся, либо теряются.
  useEffect(() => {
    const fit = () => setSize(Math.min(380, Math.max(280, window.innerWidth - 56)));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const { nodes, links } = useMemo(() => {
    // --- Что у пользователя есть: показатели, препараты, самонаблюдение
    const present = new Map<string, GraphNode>();

    // Анализы: берём самое свежее значение каждого показателя.
    const sortedLabs = [...labs].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
    for (const rep of sortedLabs) {
      for (const m of (rep.markers || [])) {
        const id = canonLab(String(m.name || ''));
        if (!id || present.has(id)) continue;
        if (m.value == null) continue;
        present.set(id, {
          id, label: NODE_LABELS[id] ?? m.name, kind: 'lab', filled: true,
          detail: `${m.value}${m.unit ? ' ' + m.unit : ''}`,
          flag: m.flag === 'low' ? 'low' : m.flag === 'high' ? 'high' : 'normal',
        });
      }
    }

    // Препараты: активные курсы.
    for (const c of courses) {
      if (c.endedAt) continue;
      const id = canonMed(c.name);
      if (!id) continue;
      const existing = present.get(id);
      if (existing) {
        // Витамин D может быть и анализом, и добавкой — это один узел,
        // просто теперь у него есть обе стороны.
        existing.detail = `${existing.detail ?? ''} · принимаю${c.dose ? ' ' + c.dose : ''}`.trim();
        continue;
      }
      present.set(id, {
        id, label: NODE_LABELS[id] ?? c.name, kind: 'med', filled: true,
        detail: c.dose || 'принимаю',
      });
    }

    // Самонаблюдение: поля с хотя бы одним значением.
    const feelSeries = new Map<string, { date: string; value: number }[]>();
    for (const f of fields) {
      if (f.archived) continue;
      const id = canonFeel(f.name);
      if (!id) continue;
      const series = entries
        .filter(e => e.values[f.id] !== undefined)
        .map(e => ({ date: e.date, value: Number(e.values[f.id]) }))
        .filter(p => Number.isFinite(p.value));
      if (series.length === 0) continue;
      feelSeries.set(id, series);
      present.set(id, {
        id, label: NODE_LABELS[id] ?? f.name, kind: 'feel', filled: true,
        detail: `${series.length} ${series.length === 1 ? 'запись' : 'записей'}`,
      });
    }

    // --- Связи
    const out: Link[] = [];

    // Наблюдаемые: только между рядами самонаблюдения — там есть
    // достаточно точек. Анализов единицы, корреляцию по ним считать
    // нечестно.
    const feelIds = [...feelSeries.keys()];
    for (let i = 0; i < feelIds.length; i++) {
      for (let j = i + 1; j < feelIds.length; j++) {
        const a = feelIds[i], b = feelIds[j];
        const res = observedLink(feelSeries.get(a)!, feelSeries.get(b)!);
        if (!res) continue;
        out.push({
          from: a, to: b, kind: 'observed', strength: res.strength,
          note: `В твоих записях эти два показателя идут ${res.r > 0 ? 'вместе' : 'в противофазе'}`
            + ` (${res.n} совпадающих дней). Это наблюдение, а не доказательство причины.`,
        });
      }
    }

    // Справочные: показываем те, где хотя бы один конец у пользователя есть.
    // Иначе карта превратилась бы в учебник, не связанный с ним.
    const seen = new Set(out.map(l => [l.from, l.to].sort().join('|')));
    for (const k of KNOWN_LINKS) {
      const hasA = present.has(k.a), hasB = present.has(k.b);
      if (!hasA && !hasB) continue;
      const key = [k.a, k.b].sort().join('|');
      if (seen.has(key)) continue; // наблюдаемая связь важнее справочной
      seen.add(key);
      // Второй конец добавляем бледным узлом — это и есть приглашение:
      // «начни отмечать отёчность, и связь оживёт».
      for (const id of [k.a, k.b]) {
        if (present.has(id)) continue;
        present.set(id, {
          id, label: NODE_LABELS[id] ?? id, kind: NODE_KIND[id] ?? 'feel',
          filled: false,
          detail: NODE_KIND[id] === 'lab' ? 'нет в анализах'
            : NODE_KIND[id] === 'med' ? 'не принимаешь'
            : 'не отслеживаешь',
        });
      }
      out.push({ from: k.a, to: k.b, kind: 'known', strength: k.strength, note: k.note });
    }

    // Узлы без единой связи только засоряют круг.
    const linked = new Set(out.flatMap(l => [l.from, l.to]));
    let list = [...present.values()].filter(n => linked.has(n.id));

    /**
     * Ограничиваем круг: на 28 узлах подписи налезают друг на друга и
     * карта перестаёт читаться (видно на первом же прогоне).
     *
     * Режем по пользе: сначала то, где есть данные и наблюдаемые связи,
     * пустые справочные узлы отбрасываем первыми. Полностью убирать их
     * нельзя — это и есть приглашение «начни отмечать».
     */
    const MAX_NODES = 16;
    if (list.length > MAX_NODES) {
      const observedIds = new Set(out.filter(l => l.kind === 'observed').flatMap(l => [l.from, l.to]));
      const degree = new Map<string, number>();
      for (const l of out) {
        degree.set(l.from, (degree.get(l.from) ?? 0) + 1);
        degree.set(l.to, (degree.get(l.to) ?? 0) + 1);
      }
      const score = (n: GraphNode) =>
        (observedIds.has(n.id) ? 1000 : 0)        // связь видна в данных — важнее всего
        + (n.filled ? 100 : 0)                     // есть данные
        + ((n.flag === 'low' || n.flag === 'high') ? 50 : 0) // вне нормы — повод смотреть
        + (degree.get(n.id) ?? 0);
      list = [...list].sort((a, b) => score(b) - score(a)).slice(0, MAX_NODES);
      const keep = new Set(list.map(n => n.id));
      for (let i = out.length - 1; i >= 0; i--) {
        if (!keep.has(out[i].from) || !keep.has(out[i].to)) out.splice(i, 1);
      }
    }

    // Порядок по кругу: группируем по типу, чтобы анализы, препараты и
    // самочувствие шли секторами — так читается легче, чем вперемешку.
    const order: Record<string, number> = { lab: 0, med: 1, feel: 2 };
    list.sort((a, b) => (order[a.kind] - order[b.kind]) || a.label.localeCompare(b.label));
    return { nodes: list, links: out };
  }, [labs, courses, fields, entries]);

  // Радиус меньше, чем половина холста: подписи выносятся наружу круга,
  // и им нужно место, иначе они срезаются краем SVG.
  const R = size / 2 - 68;
  const cx = size / 2, cy = size / 2;
  const ang = useMemo(() => {
    const m = new Map<string, number>();
    nodes.forEach((n, i) => m.set(n.id, (i / nodes.length) * Math.PI * 2 - Math.PI / 2));
    return m;
  }, [nodes]);
  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    nodes.forEach(n => {
      const a = ang.get(n.id)!;
      m.set(n.id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
    });
    return m;
  }, [nodes, ang, R, cx, cy]);

  const shown = picked ? links.filter(l => l.from === picked || l.to === picked) : links;
  const active = new Set(shown.flatMap(l => [l.from, l.to]));
  const pickedNode = nodes.find(n => n.id === picked);
  const pickedLinks = picked ? links.filter(l => l.from === picked || l.to === picked) : [];

  const COLOR: Record<string, string> = { lab: '#5b8def', med: '#b07bd4', feel: '#34c17b' };

  if (nodes.length === 0) {
    return (
      <div style={{ padding: '18px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Карта появится, когда будут данные: загрузи анализы, добавь препараты
        или заведи поля самонаблюдения в «Замерах».
      </div>
    );
  }

  return (
    <div>
      <svg width={size} height={size} style={{ display: 'block', margin: '0 auto', touchAction: 'manipulation' }}>
        <defs>
          <filter id="hm-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Лучи. Наблюдаемые — сплошные и ярче, справочные — пунктир. */}
        {shown.map((l, i) => {
          const a = pos.get(l.from), b = pos.get(l.to);
          if (!a || !b) return null;
          const dim = picked && l.from !== picked && l.to !== picked;
          return (
            <line
              key={i}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={l.kind === 'observed' ? '#2fbf71' : '#9bd9b4'}
              strokeWidth={l.kind === 'observed' ? 1 + l.strength * 2.5 : 1}
              strokeDasharray={l.kind === 'known' ? '3 4' : undefined}
              strokeOpacity={dim ? 0.1 : (l.kind === 'observed' ? 0.85 : 0.5)}
              filter={l.kind === 'observed' ? 'url(#hm-glow)' : undefined}
            />
          );
        })}

        {/* Узлы */}
        {nodes.map(n => {
          const p = pos.get(n.id)!;
          const on = !picked || active.has(n.id);
          const c = COLOR[n.kind];
          return (
            <g key={n.id} onClick={() => setPicked(picked === n.id ? null : n.id)} style={{ cursor: 'pointer' }}>
              <circle
                cx={p.x} cy={p.y} r={picked === n.id ? 15 : 11}
                fill={n.filled ? c : 'transparent'}
                stroke={c}
                strokeWidth={n.filled ? 0 : 1.5}
                strokeDasharray={n.filled ? undefined : '2 3'}
                opacity={on ? (n.filled ? 1 : 0.5) : 0.18}
              />
              {/* Показатель вне нормы — кольцо вокруг узла. */}
              {n.filled && (n.flag === 'low' || n.flag === 'high') && (
                <circle cx={p.x} cy={p.y} r={picked === n.id ? 19 : 15}
                  fill="none" stroke="#e8894a" strokeWidth={1.5} opacity={on ? 0.9 : 0.2} />
              )}
              {/* Подпись выносим НАРУЖУ круга по радиусу: при подписях
                  строго над/под узлом соседи на боках налезали друг на
                  друга (видно было на 28 узлах). */}
              <text
                x={cx + (R + 20) * Math.cos(ang.get(n.id)!)}
                y={cy + (R + 20) * Math.sin(ang.get(n.id)!) + 3}
                textAnchor={
                  Math.abs(Math.cos(ang.get(n.id)!)) < 0.3 ? 'middle'
                    : Math.cos(ang.get(n.id)!) > 0 ? 'start' : 'end'
                }
                fontSize={10}
                fontWeight={600}
                fill="var(--text-secondary)"
                opacity={on ? 1 : 0.3}
              >{n.label}</text>
            </g>
          );
        })}
      </svg>

      {/* Легенда: без неё сплошная и пунктирная линии неразличимы по смыслу. */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', margin: '2px 0 10px', fontSize: '10px', color: 'var(--text-muted)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#2fbf71" strokeWidth="2.5" /></svg>
          видно в твоих данных
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#9bd9b4" strokeWidth="1" strokeDasharray="3 4" /></svg>
          известная связь
        </span>
      </div>

      {/* Подробности выбранного узла */}
      {pickedNode ? (
        <div style={{
          padding: '12px 14px', borderRadius: '12px',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 700 }}>{pickedNode.label}</span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{pickedNode.detail}</span>
          </div>
          {pickedLinks.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Связей пока нет.</div>
          ) : pickedLinks
            .sort((a, b) => (a.kind === b.kind ? b.strength - a.strength : a.kind === 'observed' ? -1 : 1))
            .map((l, i) => {
              const otherId = l.from === picked ? l.to : l.from;
              const other = nodes.find(n => n.id === otherId);
              return (
                <div key={i} style={{ marginBottom: '9px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '2px', color: l.kind === 'observed' ? '#2fbf71' : 'var(--text-secondary)' }}>
                    {l.kind === 'observed' ? '● ' : '○ '}{other?.label ?? otherId}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.45 }}>{l.note}</div>
                </div>
              );
            })}
          {!pickedNode.filled && (
            <div style={{ fontSize: '11px', color: '#b07b3c', marginTop: '6px', lineHeight: 1.45 }}>
              Данных по этому узлу нет. Добавь его — и связь можно будет проверить на тебе.
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
          Нажми на узел, чтобы увидеть его связи.
          {links.every(l => l.kind === 'known') && (
            <><br />Пока все связи справочные: начни отмечать самочувствие, и появятся свои.</>
          )}
        </div>
      )}
    </div>
  );
}

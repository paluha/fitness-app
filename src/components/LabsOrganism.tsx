'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { hasRef, isOutOfRange, reading, refText } from './LabMarkerList';
import type { LabMarkerRow } from './LabMarkerList';

/**
 * «Организм» по макету редизайна: схематичный силуэт, системы с точками
 * на теле и подписи по бокам. Это тематическая группировка анализов, а
 * не медицинская модель: положение точек условное.
 */

export type SystemKey = 'heart' | 'metabolism' | 'blood' | 'liver' | 'kidneys' | 'hormones' | 'vitamins';

export const SYSTEMS: Record<SystemKey, {
  name: string; short: string; label: string; color: string;
  node: [number, number]; side: 'left' | 'right'; top: number; summary: string;
}> = {
  hormones: { name: 'Гормоны', short: 'Гормоны', label: 'Эндокринная система', color: '#c9a7d8', node: [180, 92], side: 'left', top: 26, summary: 'Половые гормоны, щитовидная железа, кортизол и ПСА — одна группа для совместного просмотра.' },
  heart: { name: 'Сердце и сосуды', short: 'Сосуды', label: 'Липиды и воспаление', color: '#edaa7a', node: [190, 143], side: 'right', top: 58, summary: 'Липидный профиль, апоB, окисленные ЛПНП и маркеры воспаления сосудов.' },
  blood: { name: 'Кровь', short: 'Кровь', label: 'Общий анализ и железо', color: '#dca39c', node: [133, 161], side: 'left', top: 104, summary: 'Клетки крови, гемоглобин и показатели железа.' },
  liver: { name: 'Печень', short: 'Печень', label: 'Ферменты и белки', color: '#b9c27a', node: [201, 178], side: 'right', top: 140, summary: 'Ферменты печени, билирубин и белки крови.' },
  metabolism: { name: 'Обмен веществ', short: 'Обмен', label: 'Углеводный обмен', color: '#8fc5bc', node: [170, 192], side: 'left', top: 182, summary: 'Глюкоза, HbA1c, инсулин и мочевая кислота — одна группа для совместного просмотра.' },
  vitamins: { name: 'Витамины', short: 'Витамины', label: 'Витамины и минералы', color: '#d8bf80', node: [207, 251], side: 'right', top: 222, summary: 'Витамин D, B12, фолаты и минералы.' },
  kidneys: { name: 'Почки', short: 'Почки', label: 'Почки и электролиты', color: '#94b6d6', node: [186, 214], side: 'left', top: 260, summary: 'Креатинин, СКФ, мочевина, электролиты и анализ мочи.' },
};

/** К какой системе относится показатель: по названию, затем по разделу бланка. */
export function systemOf(m: { name: string; group?: string }): SystemKey | null {
  const n = m.name.toUpperCase();
  const g = (m.group || '').toUpperCase();
  if (/URINALYSIS/.test(g)) return 'kidneys';
  if (/TESTOSTERONE|ESTRADIOL|\bLH\b|\bFSH\b|PROLACTIN|DHEA|CORTISOL|IGF|PROGESTERONE|SEX HORMONE|\bSHBG\b|\bTSH\b|\bT3\b|\bT4\b|THYRO|\bPSA\b|DIHYDROTESTOSTERONE|Z SCORE/.test(n)) return 'hormones';
  if (/CHOLESTEROL|\bHDL|\bLDL|TRIGLYCERIDES|APOLIPOPROTEIN|LIPOPROTEIN|OXIDIZED|OXLDL|\bADMA\b|ASYMMETRIC|HS CRP|C-REACTIVE|HOMOCYSTEINE/.test(n)) return 'heart';
  if (/A1C|GLUCOSE|\bEAG\b|INSULIN|C-PEPTIDE|FRUCTOSAMINE|URIC ACID/.test(n)) return 'metabolism';
  if (/VITAMIN|B12|FOLATE|MAGNESIUM|ZINC/.test(n)) return 'vitamins';
  if (/\bALT\b|\bAST\b|ALKALINE|BILIRUBIN|\bGGT\b|ALBUMIN|GLOBULIN|PROTEIN, TOTAL/.test(n)) return 'liver';
  if (/CREATININE|UREA|\bBUN\b|EGFR|SODIUM|POTASSIUM|CHLORIDE|CARBON DIOXIDE|CALCIUM|\bSDMA\b|SYMMETRIC/.test(n)) return 'kidneys';
  if (/BLOOD CELL|HEMOGLOBIN|HEMATOCRIT|\bMCV\b|\bMCH|\bRDW\b|PLATELET|\bMPV\b|NEUTROPHIL|LYMPHOCYTE|MONOCYTE|EOSINOPHIL|BASOPHIL|IRON|FERRITIN|SATURATION|SED RATE/.test(n)) return 'blood';
  if (/LIPID|CARDIO/.test(g)) return 'heart';
  if (/CBC|IRON/.test(g)) return 'blood';
  if (/THYROID|TESTOSTERONE|ENDOCRIN/.test(g)) return 'hormones';
  if (/METABOLIC/.test(g)) return 'kidneys';
  return null;
}

const BODY_PATH = 'M170 75Q168 88 153 91L137 96Q126 100 123 116L115 162 102 211 95 234Q92 245 99 247Q106 250 110 238L122 212 139 169 143 142 146 189Q139 212 146 233L148 275 143 338 141 370Q140 378 150 379L161 379Q169 376 163 369L165 336 174 279 180 245 186 279 195 336 197 369Q191 376 199 379L210 379Q220 378 219 370L217 338 212 275 214 233Q221 212 214 189L217 142 221 169 238 212 250 238Q254 250 261 247Q268 245 265 234L258 211 245 162 237 116Q234 100 223 96L207 91Q192 88 190 75Z';
const ROUTES: [SystemKey, string][] = [
  ['heart', 'M190 143C184 125 180 104 180 68'],
  ['blood', 'M190 143C163 117 142 119 135 153L107 230'],
  ['blood', 'M190 143C209 117 222 119 226 152L253 230'],
  ['metabolism', 'M190 143C177 163 184 177 180 202C169 222 163 238 161 267L153 359'],
  ['vitamins', 'M190 143C202 163 194 186 180 202C192 224 201 241 200 267L207 359'],
];

/** Силуэт с системами. leaders — линии от точек к подписям по бокам. */
export function BodySvg({ id, systems, leaders }: { id: string; systems: SystemKey[]; leaders?: Record<SystemKey, number> }) {
  const color = (k: SystemKey) => SYSTEMS[k].color;
  const routes = ROUTES.filter(([g]) => systems.includes(g));
  return (
    <svg className="body-svg" viewBox="0 0 360 410" role="img" aria-label="Схематический силуэт с группами анализов">
      <defs>
        <linearGradient id={`${id}-skin`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#d0a57d" stopOpacity=".22" />
          <stop offset=".48" stopColor="#a0c2b3" stopOpacity=".08" />
          <stop offset="1" stopColor="#c59b73" stopOpacity=".2" />
        </linearGradient>
        <radialGradient id={`${id}-aura`}>
          <stop stopColor="#a7b9a0" stopOpacity=".14" />
          <stop offset="1" stopColor="#a7b9a0" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <path d={BODY_PATH} />
          <ellipse cx="180" cy="50" rx="21" ry="27" />
        </clipPath>
      </defs>
      <ellipse cx="180" cy="205" rx="135" ry="190" fill={`url(#${id}-aura)`} />
      <g fill="none" stroke="#9baf9b" strokeOpacity=".12">
        <ellipse cx="180" cy="215" rx="131" ry="57" transform="rotate(-29 180 215)" />
        <ellipse cx="180" cy="215" rx="121" ry="74" transform="rotate(38 180 215)" />
        <path d="M28 215H332M180 16V395" strokeDasharray="2 7" />
      </g>
      <g className="living-body">
        <path d={BODY_PATH} fill={`url(#${id}-skin)`} stroke="#c8c2a1" strokeOpacity=".42" strokeWidth=".8" />
        <ellipse cx="180" cy="50" rx="21" ry="27" fill={`url(#${id}-skin)`} stroke="#c8c2a1" strokeOpacity=".45" strokeWidth=".8" />
        <g clipPath={`url(#${id}-clip)`} stroke="#bbbaa1" strokeOpacity=".13" fill="none" strokeWidth=".7">
          {[108, 118, 128, 138, 148, 158, 168].map((y, i) => (
            <path key={y} d={`M${146 + i * .6} ${y}Q163 ${y + 10} 179 ${y + 3}Q199 ${y + 10} ${214 - i * .6} ${y}`} />
          ))}
          <path d="M180 80V231M153 184Q180 198 207 184M150 208Q180 219 210 208M147 229Q164 232 177 249M213 229Q196 232 183 249M168 94Q152 103 145 130M192 94Q208 103 215 130" />
        </g>
        <g fill="none" strokeWidth="1.1" strokeLinecap="round">
          {routes.map(([g, d], i) => (
            <g key={i}>
              <path className={`vessel vessel-${g}`} d={d} stroke={color(g)} strokeOpacity=".4" />
              <path className={`flow-line vessel-${g}`} d={d} stroke={color(g)} strokeDasharray="2 22" />
            </g>
          ))}
        </g>
        <path className="heart-shape" d="M189 135C180 124 174 136 182 144L191 154 199 142C205 130 194 127 189 135Z" fill="#e2a17e" fillOpacity=".48" stroke="#e2a17e" strokeWidth=".7" />
        <path d="M158 179C162 169 181 171 192 179Q196 186 180 189Q163 194 158 179Z" fill="#8fc5bc" fillOpacity=".15" stroke="#8fc5bc" strokeOpacity=".45" strokeWidth=".6" />
        {routes.map(([g, d], i) => (
          <circle key={'p' + i} r="1.8" fill={color(g)}>
            <animateMotion dur={`${5 + i * .8}s`} begin={`-${i}s`} repeatCount="indefinite" path={d} />
          </circle>
        ))}
        {systems.map(k => {
          const [x, y] = SYSTEMS[k].node;
          return (
            <g key={k} className={`body-node node-${k}`}>
              <circle className="node-halo" cx={x} cy={y} r="12" fill={color(k)} opacity=".12" />
              <circle className="node-ring" cx={x} cy={y} r="9" fill="none" stroke={color(k)} opacity=".6" />
              <circle cx={x} cy={y} r="3" fill={color(k)} />
            </g>
          );
        })}
      </g>
      <g className="scene-specks" fill="#c7c5a5" opacity=".28">
        {Array.from({ length: 22 }, (_, i) => (
          <circle key={i} cx={37 + (i * 43) % 290} cy={26 + (i * 67) % 350} r={i % 3 === 0 ? 1.1 : .65} style={{ animationDelay: `-${i % 7}s` }} />
        ))}
      </g>
      {leaders && (
        <g className="leaders" fill="none" strokeWidth=".7" strokeOpacity=".4">
          {systems.map(k => {
            const s = SYSTEMS[k];
            const [x, y] = s.node;
            const ly = leaders[k];
            const ex = s.side === 'left' ? 47 : 313;
            const mx = s.side === 'left' ? Math.min(x - 22, 118) : Math.max(x + 22, 242);
            return <path key={k} d={`M${x} ${y}L${mx} ${ly}H${ex}`} stroke={s.color} />;
          })}
        </g>
      )}
    </svg>
  );
}

const plural = (n: number, one: string, few: string, many: string) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many}`;
export const markersWord = (n: number) => plural(n, 'показатель', 'показателя', 'показателей');

/** Группы с их показателями: вне диапазона первыми. */
export function groupBySystem(rows: LabMarkerRow[]) {
  const map = new Map<SystemKey, LabMarkerRow[]>();
  for (const r of rows) {
    const k = systemOf(r);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  for (const list of map.values()) list.sort((a, b) => Number(hasRef(b) && isOutOfRange(b)) - Number(hasRef(a) && isOutOfRange(a)));
  return map;
}

export function OrganismView({ rows, dateLabel, onOpen, onDiscuss }: {
  /** Последние значения по всем бланкам. */
  rows: LabMarkerRow[];
  dateLabel: string;
  onOpen: (row: LabMarkerRow) => void;
  onDiscuss: (prompt: string) => void;
}) {
  const groups = useMemo(() => groupBySystem(rows), [rows]);
  const present = (Object.keys(SYSTEMS) as SystemKey[]).filter(k => groups.has(k));
  const firstOut = present.find(k => groups.get(k)!.some(r => hasRef(r) && isOutOfRange(r)));
  const [chosen, setChosen] = useState<SystemKey | null>(null);
  const active = chosen && present.includes(chosen) ? chosen : (firstOut ?? present[0] ?? null);
  const [showAll, setShowAll] = useState(false);
  const [paused, setPaused] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // Пауза анимаций: CSS-класс для keyframes и pauseAnimations для SMIL
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      const stop = paused || reduce.matches;
      stageRef.current?.querySelectorAll('svg').forEach(s => (stop ? s.pauseAnimations() : s.unpauseAnimations()));
    };
    apply();
    reduce.addEventListener('change', apply);
    return () => reduce.removeEventListener('change', apply);
  }, [paused]);

  if (present.length === 0) {
    return (
      <section className="card">
        <p className="muted">Пока не из чего собрать карту: загрузи бланк анализов — показатели разложатся по системам.</p>
      </section>
    );
  }

  const total = present.reduce((s, k) => s + groups.get(k)!.length, 0);
  // Подписи ставим на их «полки»; линии ведём к центру подписи (в единицах viewBox)
  const leaders = Object.fromEntries(present.map(k => [k, (SYSTEMS[k].top + 24) / 365 * 410])) as Record<SystemKey, number>;
  const list = active ? groups.get(active)! : [];
  const shown = showAll ? list : list.slice(0, 6);
  const s = active ? SYSTEMS[active] : null;

  return (
    <>
      <section className={'organism-scene' + (paused ? ' motion-paused' : '')} data-active-system={active ?? undefined}>
        <div className="scene-top">
          <div>
            <span className="scene-eyebrow">КАРТА ОРГАНИЗМА</span>
            <p>{dateLabel} <span>· последние значения</span></p>
          </div>
          <button type="button" className="motion-toggle" aria-pressed={paused}
            aria-label={paused ? 'Включить эффекты' : 'Приостановить эффекты'} onClick={() => setPaused(p => !p)}>
            {paused ? '▷' : 'Ⅱ'}
          </button>
        </div>
        <div className="body-stage" ref={stageRef}>
          <BodySvg id="organism" systems={present} leaders={leaders} />
          {present.map(k => {
            const items = groups.get(k)!;
            const out = items.filter(r => hasRef(r) && isOutOfRange(r)).length;
            const sys = SYSTEMS[k];
            return (
              <button key={k} type="button" aria-pressed={active === k}
                className={`system-pick pick-${sys.side}` + (active === k ? ' is-chosen' : '')}
                style={{ top: sys.top, color: sys.color }}
                onClick={() => { setChosen(k); setShowAll(false); }}>
                <span className="system-dot" />
                <b>{sys.short}</b>
                <small>{out ? `${out} вне диапазона` : markersWord(items.length)}</small>
              </button>
            );
          })}
        </div>
        <div className="scene-bottom">
          <span><i />{plural(present.length, 'группа', 'группы', 'групп')} · {markersWord(total)}</span>
          <span>Выбери систему ↑</span>
        </div>
      </section>

      {s && active && (
        <section className="system-detail" aria-live="polite">
          <div className="system-detail-top">
            <div>
              <span className="eyebrow">{s.label}</span>
              <h2>{s.name}</h2>
            </div>
            <button type="button" className="text-button" onClick={() => onDiscuss(
              `Разбери мою группу анализов «${s.name}»: ${list.slice(0, 12).map(r => `${r.name} ${reading(r)} ${r.unit}`).join('; ')}. Что важно и что спросить у врача?`,
            )}>✦ Обсудить</button>
          </div>
          {shown.map(r => {
            const out = hasRef(r) && isOutOfRange(r);
            const dir = out ? (r.refHigh != null && r.value > r.refHigh ? 'Выше диапазона' : 'Ниже диапазона') : hasRef(r) ? 'В диапазоне' : 'Без диапазона';
            return (
              <button key={r.key} type="button" className="system-value" onClick={() => onOpen(r)}>
                <span>
                  <strong>{r.name}</strong>
                  <small>Диапазон: {refText(r)}{hasRef(r) && r.unit ? ` ${r.unit}` : ''}</small>
                </span>
                <span>
                  <b>{reading(r)} <em>{r.unit}</em></b>
                  <small className={out ? 'out-of-range' : undefined}>{dir} ↗</small>
                </span>
              </button>
            );
          })}
          {list.length > 6 && (
            <button type="button" className="text-button system-more" onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Свернуть' : `Показать все · ${list.length}`}
            </button>
          )}
          <p>{s.summary} Выбери значение, чтобы посмотреть историю.</p>
        </section>
      )}

      <details className="map-explanation">
        <summary>Как читать эту карту</summary>
        <p>Это схематический обзор тематических групп, а не медицинская модель. Положение точек и движение частиц условные: они не показывают кровоток, работу органов или причинно-следственные связи.</p>
        <p>В группе — самые свежие значения из всех загруженных бланков. Подсветка относится к выбранной группе и не является оценкой здоровья органа.</p>
      </details>
    </>
  );
}

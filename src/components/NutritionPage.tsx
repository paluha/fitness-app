'use client';

/**
 * Экран «Питание» по утверждённому макету design/trainx-nutrition-reference.html.
 *
 * Оформление изолировано классами .nutv2 (см. globals.css) — другие экраны
 * приложения оно не задевает. Данные, цели, история и сервисы — из приложения:
 * компонент ничего не хранит сам и получает всё пропсами.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export interface NutritionMeal {
  id: string;
  time: string;
  name: string;
  protein: number;
  fat: number;
  carbs: number;
  calories: number;
  sugar?: number | null;
  isFavorite?: boolean;
  /** Отметка о происхождении записи: фото или этикетка, с датой снимка. */
  photoStamp?: { date: string; time: string; source: 'exif' | 'upload' | 'manual' } | null;
  captureKind?: 'food' | 'label';
  /** Масса порции, если ИИ её вернул — для пересчёта КБЖУ. */
  portionGrams?: number | null;
  /** Исходные значения на исходную массу, чтобы пересчёт не накапливал ошибку. */
  basePortion?: { grams: number; protein: number; fat: number; carbs: number; calories: number; sugar: number | null } | null;
}

export interface NutritionGoals {
  protein: number;
  fat: number;
  carbs: number;
  calories: number;
}

export interface NutritionDay {
  date: string;
  meals: NutritionMeal[];
}

export const NUTRITION_FLAME_PERCENT = 90;

/**
 * Огонёк: день засчитывается, когда набрано НЕ МЕНЕЕ 90% цели по калориям.
 * Сравнение без округления вверх — при цели 2410 огонёк с 2169 ккал, на 2168 нет.
 */
export function flameStatus(meals: { calories?: number }[] | undefined, goalCalories?: number | null) {
  const list = Array.isArray(meals) ? meals : [];
  const kcal = list.reduce((sum, m) => sum + (Number(m?.calories) || 0), 0);
  const goal = Number(goalCalories);
  const valid = Number.isFinite(goal) && goal > 0 && Number.isFinite(kcal);
  return {
    has: list.length > 0,
    kcal,
    ratio: valid ? kcal / goal : 0,
    lit: valid && list.length > 0 && kcal * 100 >= goal * NUTRITION_FLAME_PERCENT,
    over: valid && kcal > goal ? kcal - goal : 0,
  };
}

const num = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const asDate = (key: string) => new Date(`${key}T12:00:00`);
const plusDays = (key: string, days: number) => { const d = asDate(key); d.setDate(d.getDate() + days); return keyOf(d); };
const mondayOf = (key: string) => plusDays(key, -((asDate(key).getDay() + 6) % 7));

/* Иконки макета — те же контуры, что в эталоне. */
const Ico = ({ d, cls, viewBox = '0 0 24 24', fill }: { d: ReactNode; cls?: string; viewBox?: string; fill?: string }) => (
  <svg className={cls} viewBox={viewBox} aria-hidden="true" style={fill ? { fill, stroke: 'none' } : undefined}>{d}</svg>
);
const IconCalendar = () => <Ico d={<><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 10h16M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01M16 17h.01" /></>} />;
const IconChevron = ({ flip }: { flip?: boolean }) => <svg viewBox="0 0 24 24" aria-hidden="true" style={flip ? { transform: 'rotate(180deg)' } : undefined}><path d="m8 5 7 7-7 7" /></svg>;
const IconDown = ({ cls }: { cls?: string }) => <Ico cls={cls} d={<path d="m6 9 6 6 6-6" />} />;
const IconSliders = () => <Ico d={<path d="M4 7h5m4 0h7M4 17h9m4 0h3M9 4v6m4 4v6" />} />;
const IconHistory = () => <Ico d={<path d="M3 11a9 9 0 1 1 2.7 7M3 5v6h6M12 7v5l3 2" />} />;
const IconHeart = ({ cls }: { cls?: string }) => <Ico cls={cls} d={<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />} />;
const IconEdit = () => <Ico d={<path d="m16 3 5 5M4 20l1-6L16 3a2 2 0 0 1 5 5L10 19l-6 1Z" />} />;
const IconTrash = () => <Ico d={<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />} />;
const IconClock = () => <Ico d={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} />;
const IconBook = () => <Ico d={<path d="M12 5C9 3 5 3 2 5v15c3-2 7-2 10 0 3-2 7-2 10 0V5c-3-2-7-2-10 0Zm0 0v15" />} />;
const IconCamera = () => <Ico d={<><path d="M8 5 9.5 3h5L16 5h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /><circle cx="12" cy="12" r="4" /></>} />;
const IconScan = () => <Ico d={<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3M7 9h10M7 12h10M7 15h6" />} />;
const IconPlus = () => <Ico d={<path d="M12 5v14M5 12h14" />} />;
const IconFood = () => <Ico d={<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M20 3c-4 3-5 7-4 10h4m0-10v18" />} />;
export const IconFlame = ({ cls }: { cls?: string }) => (
  <svg className={cls ? `flame-icon ${cls}` : 'flame-icon'} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M13 2c.5 4.6-3.9 5.6-3.9 9.5C7.7 10.6 7.2 9.4 7 8c-2.2 2.3-3 4.6-3 7a8 8 0 0 0 16 0c0-5-3.8-9.9-7-13Z" />
    <path d="M12.4 12c.2 2.4-2.3 3.1-2.3 5.2a2.5 2.5 0 0 0 5 0c0-1.9-1.3-3.7-2.7-5.2Z" fill="#ffc49f" />
  </svg>
);

export interface NutritionPageProps {
  userName: string;
  selectedDate: string;
  todayStr: string;
  goals: NutritionGoals;
  mealsByDate: Record<string, NutritionMeal[]>;
  quickFrequent: NutritionMeal[];
  quickFavorites: NutritionMeal[];
  onSelectDate: (key: string) => void;
  onOpenAdd: () => void;
  onQuickAdd: (meal: NutritionMeal) => void;
  onEditMeal: (meal: NutritionMeal) => void;
  onDeleteMeal: (meal: NutritionMeal) => void;
  onToggleFavorite: (meal: NutritionMeal) => void;
  onSaveGoals: (goals: NutritionGoals) => void;
  onOpenProfile: () => void;
  onNavigateWorkout: () => void;
  /** Блоки приложения, которые остаются как есть: «Когда есть» и «Рецепты». */
  rhythmSlot?: ReactNode;
  recipesSlot?: ReactNode;
}

export default function NutritionPage(props: NutritionPageProps) {
  const {
    userName, selectedDate, todayStr, goals, mealsByDate,
    quickFrequent, quickFavorites,
    onSelectDate, onOpenAdd, onQuickAdd, onEditMeal, onDeleteMeal,
    onToggleFavorite, onSaveGoals, onOpenProfile, onNavigateWorkout,
    rhythmSlot, recipesSlot,
  } = props;

  const [weekStart, setWeekStart] = useState(() => mondayOf(selectedDate));
  const [monthCursor, setMonthCursor] = useState(() => { const d = asDate(selectedDate); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [monthOpen, setMonthOpen] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [quickTab, setQuickTab] = useState<'frequent' | 'favorites'>('frequent');
  const [openedMeal, setOpenedMeal] = useState<string | null>(null);
  const [goalDraft, setGoalDraft] = useState(goals);

  // Лента и месяц следуют за выбранной датой (в т.ч. когда её меняет запись по фото).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- синхронизация с внешней датой
    setWeekStart(mondayOf(selectedDate));
    const d = asDate(selectedDate);
    setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [selectedDate]);

  const meals = useMemo(() => mealsByDate[selectedDate] || [], [mealsByDate, selectedDate]);
  const totals = useMemo(() => meals.reduce((a, m) => {
    a.protein += Number(m.protein) || 0; a.fat += Number(m.fat) || 0;
    a.carbs += Number(m.carbs) || 0; a.calories += Number(m.calories) || 0;
    if (m.sugar === null || m.sugar === undefined) a.unknownSugar++; else a.sugar += Number(m.sugar) || 0;
    return a;
  }, { protein: 0, fat: 0, carbs: 0, calories: 0, sugar: 0, unknownSugar: 0 }), [meals]);

  const dayFlame = useCallback((key: string) => flameStatus(mealsByDate[key], goals.calories), [mealsByDate, goals.calories]);
  const status = dayFlame(selectedDate);

  // Короткая анимация только при переходе через порог в текущем дне.
  const prevFlame = useRef<{ day: string; lit: boolean }>({ day: selectedDate, lit: status.lit });
  const [igniting, setIgniting] = useState(false);
  useEffect(() => {
    const same = prevFlame.current.day === selectedDate;
    if (same && !prevFlame.current.lit && status.lit) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- разовая анимация при переходе порога
      setIgniting(true);
      const t = setTimeout(() => setIgniting(false), 700);
      prevFlame.current = { day: selectedDate, lit: status.lit };
      return () => clearTimeout(t);
    }
    prevFlame.current = { day: selectedDate, lit: status.lit };
  }, [selectedDate, status.lit]);

  const dayAria = (key: string) => {
    const s = dayFlame(key);
    return asDate(key).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      + (s.lit ? ', огонёк: набрано не менее 90% цели по калориям' : s.has ? ', есть записи' : ', нет записей');
  };
  const marker = (s: ReturnType<typeof flameStatus>) => (
    <span className="day-marker" aria-hidden="true">
      {s.lit ? <IconFlame /> : <i className={`day-status${s.has ? '' : ' empty'}`} />}
    </span>
  );

  const weekKeys = Array.from({ length: 7 }, (_, i) => plusDays(weekStart, i));
  const recorded = weekKeys.filter(k => dayFlame(k).has).length;
  const selDate = asDate(selectedDate);
  const wStart = asDate(weekStart), wEnd = asDate(plusDays(weekStart, 6));
  const weekCaption = wStart.getMonth() === wEnd.getMonth()
    ? `${wStart.getDate()}–${wEnd.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
    : `${wStart.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${wEnd.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;

  const monthDays = useMemo(() => {
    const first = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const count = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate();
    const cells: (string | null)[] = Array.from({ length: offset }, () => null);
    for (let n = 1; n <= count; n++) cells.push(keyOf(new Date(monthCursor.getFullYear(), monthCursor.getMonth(), n)));
    return cells;
  }, [monthCursor]);

  const quickItems = quickTab === 'favorites' ? quickFavorites : quickFrequent;
  const sorted = [...meals].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const pct = Math.floor(status.ratio * 100);
  const macro = (key: 'protein' | 'fat' | 'carbs', label: string, cssVar: string) => (
    <div style={{ ['--macro' as keyof CSSProperties]: `var(${cssVar})` } as CSSProperties}>
      <div className="macro-name"><i className="macro-dot" />{label}</div>
      <div className="macro-value"><span>{num(totals[key])}</span><small> / {num(goals[key])} г</small></div>
      <div className="macro-progress"><span style={{ width: `${Math.min(100, (totals[key] / (goals[key] || 1)) * 100)}%` }} /></div>
    </div>
  );

  return (
    <div className="nutv2">
      <header className="welcome">
        <div className="welcome-text">Welcome to <b className="wordmark">Train<span>X</span></b>, {userName}</div>
        <button type="button" className="avatar" aria-label="Профиль" onClick={onOpenProfile}>{(userName || 'A')[0].toUpperCase()}</button>
      </header>

      <main>
        <nav className="section-switch" aria-label="Разделы главного экрана">
          <button type="button" onClick={onNavigateWorkout}>Тренировки</button>
          <button type="button" aria-current="page" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Питание</button>
        </nav>

        <div className="title-row">
          <div>
            <h1>Питание</h1>
            <p className="date-subtitle">
              {selDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} · {selDate.toLocaleDateString('ru-RU', { weekday: 'long' })}
            </p>
          </div>
          <button
            type="button"
            className="icon-btn calendar-toggle"
            aria-label={monthOpen ? 'Скрыть календарь' : 'Открыть календарь'}
            aria-expanded={monthOpen}
            onClick={() => setMonthOpen(v => !v)}
          ><IconCalendar /></button>
        </div>

        <section aria-label="Выбор дня">
          <div className="week-heading">
            <span className="week-caption">{weekCaption}</span>
            <div className="week-controls">
              {selectedDate !== todayStr && <button className="today-link" type="button" onClick={() => onSelectDate(todayStr)}>Сегодня</button>}
              <button className="icon-btn" type="button" aria-label="Предыдущая неделя" onClick={() => setWeekStart(w => plusDays(w, -7))}><IconChevron flip /></button>
              <button className="icon-btn" type="button" aria-label="Следующая неделя" onClick={() => setWeekStart(w => plusDays(w, 7))}><IconChevron /></button>
            </div>
          </div>

          <div className="week">
            {weekKeys.map(key => {
              const d = asDate(key), s = dayFlame(key);
              return (
                <button
                  key={key}
                  type="button"
                  className={`day${key === todayStr ? ' is-today' : ''}`}
                  aria-pressed={key === selectedDate}
                  aria-label={dayAria(key)}
                  onClick={() => onSelectDate(key)}
                >
                  <span className="day-weekday">{d.toLocaleDateString('ru-RU', { weekday: 'short' })}</span>
                  <span className="day-number">{d.getDate()}</span>
                  {marker(s)}
                </button>
              );
            })}
          </div>

          {monthOpen && (
            <div className="month-panel">
              <div className="month-top">
                <span className="month-title">{monthCursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '')}</span>
                <div className="week-controls">
                  <button className="icon-btn" type="button" aria-label="Предыдущий месяц" onClick={() => setMonthCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}><IconChevron flip /></button>
                  <button className="icon-btn" type="button" aria-label="Следующий месяц" onClick={() => setMonthCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}><IconChevron /></button>
                </div>
              </div>
              <div className="month-grid">
                {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(x => <span key={x} className="month-dow">{x}</span>)}
                {monthDays.map((key, i) => key === null ? <span key={`e${i}`} /> : (
                  <button
                    key={key}
                    type="button"
                    className={`month-day${dayFlame(key).has ? ' has-record' : ''}${key === todayStr ? ' is-today' : ''}`}
                    aria-pressed={key === selectedDate}
                    aria-label={dayAria(key)}
                    onClick={() => onSelectDate(key)}
                  >{asDate(key).getDate()}{marker(dayFlame(key))}</button>
                ))}
              </div>
            </div>
          )}

          <div className="calendar-foot">
            <div className="legend">
              <span><IconFlame />≥ 90% калорий</span>
              <span><i className="day-status" />Есть записи</span>
              <span><i className="day-status empty" />Нет записей</span>
            </div>
            <span>{recorded} из 7 дней</span>
          </div>
        </section>

        <section className="card balance" aria-labelledby="balanceTitle">
          <div className="balance-heading">
            <div className="balance-title">
              <h2 id="balanceTitle">Баланс дня</h2>
              {status.lit && (
                <span
                  className={`goal-flame${igniting ? ' is-igniting' : ''}`}
                  title="Набрано не менее 90% дневной цели по калориям"
                  aria-label="Набрано не менее 90% дневной цели по калориям"
                ><IconFlame /><span aria-hidden="true">90%+</span></span>
              )}
            </div>
            <button className="text-btn" type="button" aria-expanded={goalsOpen}
              onClick={() => { setGoalDraft(goals); setGoalsOpen(v => !v); }}><IconSliders />Цели</button>
          </div>

          <div className="energy">
            <div>
              <div className="energy-label">Съедено</div>
              <div className="energy-value"><span>{num(totals.calories)}</span><span className="energy-unit">ккал</span></div>
            </div>
            <div className="energy-left">
              <div className="energy-label">{totals.calories > goals.calories ? 'Сверх цели' : 'Осталось'}</div>
              <strong>{num(Math.abs(goals.calories - totals.calories))}</strong>
            </div>
          </div>
          <div className="energy-progress" role="progressbar" aria-label="Калории относительно цели"
            aria-valuemin={0} aria-valuemax={goals.calories} aria-valuenow={Math.min(goals.calories, totals.calories)}
            aria-valuetext={`${num(totals.calories)} из ${num(goals.calories)} ккал`}>
            <span style={{ width: `${Math.min(100, status.ratio * 100)}%` }} />
          </div>
          <div className="energy-track-labels"><span>{pct}% от цели</span><span>Цель {num(goals.calories)} ккал</span></div>

          <div className="macros">
            {macro('protein', 'Белки', '--protein')}
            {macro('fat', 'Жиры', '--fat')}
            {macro('carbs', 'Углеводы', '--carbs')}
          </div>

          <div className="sugar">
            <span>Сахар за день</span>
            <strong>{!meals.length ? 'Нет записей'
              : meals.length === totals.unknownSugar ? 'Не указан'
                : `${num(totals.sugar)} г${totals.unknownSugar ? ' · не все записи' : ''}`}</strong>
          </div>

          {goalsOpen && (
            <form className="goal-editor" onSubmit={e => { e.preventDefault(); onSaveGoals(goalDraft); setGoalsOpen(false); }}>
              <h3>Дневные цели</h3>
              <div className="fields-3">
                {(['protein', 'fat', 'carbs'] as const).map(k => (
                  <label className="field" key={k}>
                    <span>{k === 'protein' ? 'Белки, г' : k === 'fat' ? 'Жиры, г' : 'Углеводы, г'}</span>
                    <input type="number" min={1} max={2000} step={1} required value={goalDraft[k]}
                      onChange={e => setGoalDraft(g => ({ ...g, [k]: Number(e.target.value) }))} />
                  </label>
                ))}
              </div>
              <label className="field"><span>Калории, ккал</span>
                <input type="number" min={1} max={20000} step={1} required value={goalDraft.calories}
                  onChange={e => setGoalDraft(g => ({ ...g, calories: Number(e.target.value) }))} />
              </label>
              <div className="form-actions">
                <button type="submit" className="primary">Сохранить цели</button>
                <button type="button" className="text-btn" onClick={() => setGoalsOpen(false)}>Отмена</button>
              </div>
            </form>
          )}
        </section>

        <section aria-labelledby="mealsTitle">
          <div className="section-heading">
            <h2 id="mealsTitle">Приёмы пищи<span className="heading-count">{meals.length}</span></h2>
            <button className="primary" type="button" onClick={onOpenAdd} aria-haspopup="dialog"><IconCamera />Добавить</button>
          </div>

          <div className="quick-head">
            <span className="quick-title"><IconHistory />Быстро добавить</span>
            <div className="quick-tabs" aria-label="Источник быстрого добавления">
              <button type="button" aria-pressed={quickTab === 'frequent'} onClick={() => setQuickTab('frequent')}>Частые</button>
              <button type="button" aria-pressed={quickTab === 'favorites'} onClick={() => setQuickTab('favorites')}>Избранное</button>
            </div>
          </div>
          <div className="quick-list" aria-label="Продукты для быстрого добавления">
            {quickItems.length ? quickItems.map((m, i) => (
              <button key={`${m.name}-${i}`} type="button" className="quick-item"
                aria-label={`Добавить: ${m.name}, ${num(m.calories)} ккал`} onClick={() => onQuickAdd(m)}>
                <span className="quick-name">{m.name}</span>
                <span className="quick-info">{num(m.calories)} ккал · {num(m.protein)} г белка</span>
                <span className="quick-plus"><IconPlus /></span>
              </button>
            )) : <p className="quick-empty">Отметь сердечком блюдо в дневнике — оно появится здесь.</p>}
          </div>

          <div className="meal-list">
            {sorted.length ? sorted.map(m => {
              const open = openedMeal === m.id;
              return (
                <article className="card meal" key={m.id} data-meal-card={m.id}>
                  <button type="button" className="meal-toggle" aria-expanded={open}
                    onClick={() => setOpenedMeal(open ? null : m.id)}>
                    <div className="meal-meta">
                      <span className="meal-meta-left">
                        <span>{m.time}</span>
                        {m.isFavorite && <IconHeart cls="favorite-mini" />}
                      </span>
                      <span className="meal-calories"><b>{num(m.calories)}</b> ккал</span>
                    </div>
                    <h3 className="meal-name">{m.name}</h3>
                    {m.photoStamp && (
                      <span className="photo-origin">
                        {m.captureKind === 'label' ? <IconScan /> : <IconCamera />}
                        {m.photoStamp.source === 'upload' ? 'Добавлено' : m.captureKind === 'label' ? 'Этикетка' : 'Фото'}
                        {' '}{asDate(m.photoStamp.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · {m.photoStamp.time}
                      </span>
                    )}
                    <div className="meal-bottom">
                      <div className="meal-macros">
                        <span>Б <b>{num(m.protein)} г</b></span>
                        <span>Ж <b>{num(m.fat)} г</b></span>
                        <span>У <b>{num(m.carbs)} г</b></span>
                      </div>
                      <IconDown cls="meal-chevron" />
                    </div>
                  </button>
                  {open && (
                    <div className="meal-actions">
                      <button type="button" className={`text-btn favorite${m.isFavorite ? ' is-favorite' : ''}`}
                        aria-pressed={!!m.isFavorite} onClick={() => onToggleFavorite(m)}>
                        <IconHeart />{m.isFavorite ? 'В избранном' : 'В избранное'}
                      </button>
                      <button type="button" className="text-btn" onClick={() => onEditMeal(m)}><IconEdit />Изменить</button>
                      <button type="button" className="icon-btn delete-btn" aria-label={`Удалить: ${m.name}`}
                        onClick={() => onDeleteMeal(m)}><IconTrash /></button>
                    </div>
                  )}
                </article>
              );
            }) : (
              <div className="card empty-day">
                <IconFood />
                <h3>Дневник этого дня пока пуст</h3>
                <p>Добавь первый приём пищи.</p>
                <button type="button" className="secondary" onClick={onOpenAdd}><IconCamera />Добавить еду</button>
              </div>
            )}
          </div>
        </section>

        {rhythmSlot ?? null}
        {recipesSlot ?? null}
      </main>
    </div>
  );
}

export { IconCamera, IconScan, IconClock, IconBook, IconPlus, IconEdit, IconDown, num, keyOf, asDate };

'use client';

/**
 * «Когда и что есть» — план питания от ИИ по макету
 * design/trainx-nutrition-reference.html (секция .rhythm).
 *
 * Раздел показывает ПЛАН, а не дневник: время → приём → конкретное блюдо →
 * порции → КБЖУ на эти порции, снизу сумма по плану. План хранится отдельно
 * от съеденного: замена блюда и порций НЕ создаёт записей в дневнике, не
 * меняет фактические итоги дня и огонёк.
 *
 * Оформление изолировано классами .nutv2 (см. globals.css).
 */

import { useMemo, useState } from 'react';

export interface PlanSlot {
  /** Время приёма, ЧЧ:ММ. */
  time: string;
  /** Название приёма: Завтрак, Обед, Перекус… */
  label: string;
  /** Выбранное блюдо: id из списка вариантов, либо null — ещё не выбрано. */
  dishId: string | null;
  /** Сколько порций, шаг 0.25. */
  portions: number;
}

/** Вариант блюда для плана: либо рецепт пользователя, либо предложение ИИ. */
export interface PlanDish {
  id: string;
  name: string;
  /** КБЖУ ОДНОЙ порции — от них считается всё остальное. */
  protein: number;
  fat: number;
  carbs: number;
  calories: number;
  /** id сохранённого рецепта, если блюдо связано с ним: даёт кнопку «Рецепт». */
  recipeId?: string;
  /** Время приготовления в минутах — только если оно известно. */
  durationMinutes?: number | null;
}

export interface NutritionPlanSectionProps {
  /** Слоты плана. null — опрос ещё не пройден, показываем пустое состояние. */
  slots: PlanSlot[] | null;
  /** Блюда на выбор: рецепты пользователя + предложения ИИ. */
  dishes: PlanDish[];
  /** Текст сохранённых предпочтений из анкеты. */
  preferencesText?: string;
  /** План строится — показываем ожидание вместо пустого списка. */
  loading?: boolean;
  onChangeSlot: (index: number, patch: { dishId?: string; portions?: number }) => void;
  onOpenSurvey: () => void;
  onOpenRecipe: (recipeId: string) => void;
  /** Открыть ИИ-чат с готовым вопросом про приём пищи или предпочтения. */
  onAskAi?: (prompt: string) => void;
}

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const num = (n: number) => nf.format(Math.round(n * 10) / 10);
// Порции идут шагом 0.25, поэтому здесь два знака: «1,25 порции», а не «1,3».
const portionsNf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/** «1 порция» / «2 порции» / «5 порций» — по правилам русского языка. */
export function portionsText(count: number) {
  const form = new Intl.PluralRules('ru').select(count);
  const value = portionsNf.format(count);
  return `${value} ${form === 'one' ? 'порция' : form === 'few' || form === 'other' ? 'порции' : 'порций'}`;
}

const IconChevron = ({ flip }: { flip?: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" style={flip ? { transform: 'rotate(180deg)' } : undefined}>
    <path d="m8 5 7 7-7 7" />
  </svg>
);

export default function NutritionPlanSection({
  slots, dishes, preferencesText, loading,
  onChangeSlot, onOpenSurvey, onOpenRecipe, onAskAi,
}: NutritionPlanSectionProps) {
  // Какой приём выбран. По умолчанию — ближайший по времени: «твой
  // следующий выбор» (по макету редизайна).
  const [picked, setPicked] = useState<number | null>(null);
  // Замена блюда и порций идёт прямо в карточке, без попапа.
  const [editing, setEditing] = useState(false);

  const byId = useMemo(() => new Map(dishes.map(d => [d.id, d])), [dishes]);

  const totals = useMemo(() => {
    const sum = { protein: 0, fat: 0, carbs: 0, calories: 0 };
    let planned = 0;
    for (const slot of slots || []) {
      const dish = slot.dishId ? byId.get(slot.dishId) : undefined;
      if (!dish) continue;
      planned++;
      const p = slot.portions > 0 ? slot.portions : 1;
      sum.protein += dish.protein * p;
      sum.fat += dish.fat * p;
      sum.carbs += dish.carbs * p;
      sum.calories += dish.calories * p;
    }
    return { ...sum, planned };
  }, [slots, byId]);

  const hasPlan = !!slots && slots.length > 0;
  const nextIndex = useMemo(() => {
    if (!slots?.length) return 0;
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const i = slots.findIndex(s => s.time >= hm);
    return i >= 0 ? i : 0;
  }, [slots]);
  const index = picked != null && slots && picked < slots.length ? picked : nextIndex;
  const slot = hasPlan ? slots[index] : null;
  const dish = slot?.dishId ? byId.get(slot.dishId) : undefined;
  const portions = slot && slot.portions > 0 ? slot.portions : 1;

  // Короткая сводка предпочтений для свёрнутой строки
  const prefShort = hasPlan ? `${slots.length} ${slots.length === 1 ? 'приём' : slots.length < 5 ? 'приёма' : 'приёмов'}` : '';

  return (
    <section className="card rhythm" id="meal-rhythm" aria-labelledby="rhythmTitle">
      <div className="support-head">
        <div>
          <span className="ux-eyebrow">Твой следующий выбор</span>
          <h2 id="rhythmTitle">Когда и что есть</h2>
        </div>
        <span className="subtle-tag">{hasPlan ? prefShort : 'Под тебя'}</span>
      </div>

      {hasPlan && slot ? (
        <>
          <div className="ux-meal-times" style={{ gridTemplateColumns: `repeat(${Math.min(slots.length, 3)}, 1fr)` }}>
            {slots.map((s, i) => (
              <button key={`${s.time}-${i}`} type="button" className={i === index ? 'is-active' : undefined}
                aria-pressed={i === index} onClick={() => { setPicked(i); setEditing(false); }}>
                <small>{s.time}</small>
                <b>{s.label}</b>
              </button>
            ))}
          </div>

          <article className="ux-next-meal">
            <span className="ux-eyebrow">
              {slot.label}{dish?.durationMinutes ? ` · ${num(dish.durationMinutes)} мин` : ''}
            </span>
            <h3>{dish ? dish.name : 'Выбери, что будешь есть'}</h3>
            {dish && (
              <p>
                {num(dish.calories * portions)} ккал <i>·</i> {num(dish.protein * portions)} г белка <i>·</i> {portionsText(portions)}
              </p>
            )}
            <div className="ux-food-actions">
              {dish?.recipeId && (
                <button type="button" onClick={() => onOpenRecipe(dish.recipeId!)}>Открыть рецепт ↗</button>
              )}
              <button type="button" aria-expanded={editing} aria-controls={`plan-picker-${index}`} onClick={() => setEditing(e => !e)}>
                {dish ? '⇄ Заменить' : 'Выбрать блюдо'}
              </button>
            </div>
          </article>

          {editing && (
            <PlanPicker
              index={index}
              dishes={dishes}
              dishId={slot.dishId}
              portions={portions}
              onSave={patch => { onChangeSlot(index, patch); setEditing(false); }}
              onCancel={() => setEditing(false)}
            />
          )}

          {onAskAi && (
            <button type="button" className="ux-inline-ai" onClick={() => onAskAi(
              `Подбери мне блюдо на ${slot.label.toLowerCase()} (${slot.time}) под мои цели и предпочтения. Сейчас в плане: ${dish ? `${dish.name}, ${portionsText(portions)}` : 'ничего не выбрано'}.`,
            )}>
              ✦ Подобрать вместе с ИИ <span>→</span>
            </button>
          )}

          {totals.planned > 0 && (
            <p className="plan-total-line">
              {totals.planned === slots.length ? 'Итого по плану' : `Выбрано ${totals.planned} из ${slots.length}`}: <b>{num(totals.calories)} ккал</b>
              {' '}· Б {num(totals.protein)} · Ж {num(totals.fat)} · У {num(totals.carbs)} г. Съеденное отмечай в дневнике.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="rhythm-copy">Время, блюда и порции с учётом твоих привычек.</p>
          {loading && <p className="plan-empty">Собираем план под твои цели…</p>}
        </>
      )}

      {hasPlan || preferencesText ? (
        <details className="ux-preferences">
          <summary>Предпочтения {prefShort && <span>{prefShort}</span>}</summary>
          {preferencesText && <p>{preferencesText}</p>}
          <button type="button" onClick={onOpenSurvey}>Изменить расписание и предпочтения</button>
          {onAskAi && (
            <button type="button" onClick={() => onAskAi('Давай обсудим мои предпочтения в питании и расписание приёмов пищи: что стоит поменять под мою цель?')}>
              Обсудить предпочтения с ИИ
            </button>
          )}
        </details>
      ) : (
        <button className="survey-link" type="button" onClick={onOpenSurvey}>
          <span>Пройти короткий опрос</span>
          <IconChevron />
        </button>
      )}
    </section>
  );
}

/**
 * Выбор блюда и количества порций прямо в строке плана. Собственное
 * состояние — чтобы правка не пересчитывала итог плана на каждый символ:
 * итог меняется после «Сохранить в плане».
 */
function PlanPicker({
  index, dishes, dishId, portions, onSave, onCancel,
}: {
  index: number;
  dishes: PlanDish[];
  dishId: string | null;
  portions: number;
  onSave: (patch: { dishId: string; portions: number }) => void;
  onCancel: () => void;
}) {
  const [dish, setDish] = useState(dishId || '');
  const [count, setCount] = useState(String(portions));

  return (
    <form
      className="plan-picker"
      id={`plan-picker-${index}`}
      onSubmit={e => {
        e.preventDefault();
        if (!dish) return;
        const parsed = Number(String(count).replace(',', '.'));
        const safe = Number.isFinite(parsed) && parsed > 0
          ? Math.min(10, Math.max(0.25, Math.round(parsed * 4) / 4))
          : 1;
        onSave({ dishId: dish, portions: safe });
      }}
    >
      <label className="field">
        <span>Что есть</span>
        <select value={dish} onChange={e => setDish(e.target.value)} required autoFocus>
          <option value="" disabled>Выбери блюдо</option>
          {dishes.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <div className="fields-2">
        <p className="form-hint">КБЖУ пересчитываются на выбранное количество порций.</p>
        <label className="field">
          <span>Порций</span>
          <input
            type="number" min="0.25" max="10" step="0.25" required
            value={count} onChange={e => setCount(e.target.value)}
          />
        </label>
      </div>
      <div className="form-actions">
        <button className="primary" type="submit">Сохранить в плане</button>
        <button className="text-btn" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  );
}

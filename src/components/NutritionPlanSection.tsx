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
import type { ReactNode } from 'react';

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

const Ico = ({ d, cls }: { d: ReactNode; cls?: string }) => (
  <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">{d}</svg>
);
const IconClock = () => <Ico d={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} />;
const IconBook = () => <Ico d={<path d="M12 5C9 3 5 3 2 5v15c3-2 7-2 10 0 3-2 7-2 10 0V5c-3-2-7-2-10 0Zm0 0v15" />} />;
const IconChevron = ({ flip }: { flip?: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" style={flip ? { transform: 'rotate(180deg)' } : undefined}>
    <path d="m8 5 7 7-7 7" />
  </svg>
);

export default function NutritionPlanSection({
  slots, dishes, preferencesText, loading,
  onChangeSlot, onOpenSurvey, onOpenRecipe,
}: NutritionPlanSectionProps) {
  // Какой слот сейчас редактируется. Замена блюда и порций идёт прямо в
  // плане, без попапа — как в макете.
  const [editing, setEditing] = useState<number | null>(null);

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

  return (
    <section className="card rhythm" id="meal-rhythm" aria-labelledby="rhythmTitle">
      <div className="support-head">
        <div className="support-title">
          <IconClock />
          <h2 id="rhythmTitle">Когда и что есть</h2>
        </div>
        <span className="subtle-tag">
          {hasPlan ? `${slots.length} ${slots.length === 5 ? 'приёмов' : 'приёма'}` : 'Под тебя'}
        </span>
      </div>
      <p className="rhythm-copy">
        {hasPlan
          ? 'Пример меню на обычный день. Блюда и порции можно менять.'
          : 'Время, блюда и порции с учётом твоих привычек.'}
      </p>

      {hasPlan && (
        <div className="schedule">
          {slots.map((slot, index) => {
            const dish = slot.dishId ? byId.get(slot.dishId) : undefined;
            const portions = slot.portions > 0 ? slot.portions : 1;
            const isEditing = editing === index;
            return (
              <article className="schedule-slot" key={`${slot.time}-${index}`}>
                <time>{slot.time}</time>
                <div className="plan-meal">
                  <span className="plan-meal-type">{slot.label}</span>
                  {dish ? (
                    <>
                      <h3>{dish.name}</h3>
                      <p className="plan-portion">
                        {portionsText(portions)}
                        {dish.durationMinutes ? ` · ${num(dish.durationMinutes)} мин на приготовление` : ''}
                      </p>
                      <div className="plan-macros">
                        <b>{num(dish.calories * portions)} ккал</b>
                        <span>Б {num(dish.protein * portions)} г</span>
                        <span>Ж {num(dish.fat * portions)} г</span>
                        <span>У {num(dish.carbs * portions)} г</span>
                      </div>
                    </>
                  ) : (
                    <p className="plan-empty">Выбери, что будешь есть</p>
                  )}
                  <div className="plan-actions">
                    {dish?.recipeId && (
                      <button type="button" className="text-btn" onClick={() => onOpenRecipe(dish.recipeId!)}>
                        <IconBook />Рецепт
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-btn"
                      aria-expanded={isEditing}
                      aria-controls={`plan-picker-${index}`}
                      onClick={() => setEditing(isEditing ? null : index)}
                    >
                      {dish ? 'Заменить' : 'Выбрать блюдо'}
                    </button>
                  </div>
                </div>
                {isEditing && (
                  <PlanPicker
                    index={index}
                    dishes={dishes}
                    dishId={slot.dishId}
                    portions={portions}
                    onSave={patch => { onChangeSlot(index, patch); setEditing(null); }}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}

      {hasPlan && totals.planned > 0 && (
        <div className="plan-total">
          <div className="plan-total-top">
            <span>
              {totals.planned === slots.length
                ? 'Итого по плану'
                : `Выбрано ${totals.planned} из ${slots.length} приёмов`}
            </span>
            <strong>{num(totals.calories)} ккал</strong>
          </div>
          <p className="plan-total-macros">
            Б {num(totals.protein)} г · Ж {num(totals.fat)} г · У {num(totals.carbs)} г
          </p>
          <p className="plan-note">Съеденное отмечай отдельно в дневнике.</p>
        </div>
      )}

      {loading && !hasPlan && <p className="plan-empty">Собираем план под твои цели…</p>}

      {!!preferencesText && (
        <div className="saved-preferences">
          <h3>Твои предпочтения</h3>
          <p>{preferencesText}</p>
        </div>
      )}

      <button className="survey-link" type="button" onClick={onOpenSurvey}>
        <span>{hasPlan ? 'Изменить расписание и предпочтения' : 'Пройти короткий опрос'}</span>
        <IconChevron />
      </button>
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

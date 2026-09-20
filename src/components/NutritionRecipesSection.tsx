'use client';

/**
 * «Рецепты» по макету design/trainx-nutrition-reference.html (секция .recipes).
 *
 * В списке — название, время приготовления (если известно), выход в порциях
 * и КБЖУ на ОДНУ порцию. Раскрытие показывает ингредиенты на весь рецепт и
 * пронумерованные шаги. «Добавить 1 порцию» кладёт в дневник выбранного дня
 * ровно одну порцию, дата назначения подписана под кнопкой, рецепт остаётся
 * раскрытым, добавление можно отменить.
 */

import type { ReactNode } from 'react';
import { portionsText } from './NutritionPlanSection';

export interface RecipeCard {
  id: string;
  name: string;
  /** Выход рецепта в порциях. */
  servings: number;
  /** Время приготовления. Необязательное: неизвестное значение не выдумываем. */
  durationMinutes?: number | null;
  ingredients: string[];
  steps: string[];
  /** КБЖУ ОДНОЙ порции. */
  perServing: { calories: number; protein: number; fat: number; carbs: number; sugar?: number };
  photo?: string | null;
}

export interface NutritionRecipesSectionProps {
  recipes: RecipeCard[];
  /** Подпись под кнопкой: в какой день уйдёт порция, например «20 сентября». */
  selectedDateText: string;
  /** Какие рецепты раскрыты — снаружи, чтобы «Рецепт» из плана мог раскрыть нужный. */
  openIds: string[];
  onToggle: (id: string) => void;
  onAddPortion: (recipe: RecipeCard) => void;
  onScan: () => void;
  onCreate: () => void;
}

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const num = (n: number) => nf.format(Math.round(n * 10) / 10);

const Ico = ({ d, cls }: { d: ReactNode; cls?: string }) => (
  <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">{d}</svg>
);
const IconBook = () => <Ico d={<path d="M12 5C9 3 5 3 2 5v15c3-2 7-2 10 0 3-2 7-2 10 0V5c-3-2-7-2-10 0Zm0 0v15" />} />;
const IconClock = () => <Ico d={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} />;
const IconCamera = () => <Ico d={<><path d="M8 5 9.5 3h5L16 5h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /><circle cx="12" cy="12" r="4" /></>} />;
const IconPlus = () => <Ico d={<path d="M12 5v14M5 12h14" />} />;
const IconDown = () => <Ico d={<path d="m6 9 6 6 6-6" />} />;

/**
 * Ингредиент в макете выровнен по краям: слева продукт, справа количество.
 * Разделитель — « — », как его вводит пользователь; без него строка идёт
 * одной колонкой.
 */
function splitIngredient(line: string): [string, string | null] {
  const at = line.lastIndexOf(' — ');
  return at < 0 ? [line, null] : [line.slice(0, at), line.slice(at + 3)];
}

export default function NutritionRecipesSection({
  recipes, selectedDateText, openIds, onToggle, onAddPortion, onScan, onCreate,
}: NutritionRecipesSectionProps) {
  return (
    <section className="card recipes" id="saved-recipes" aria-labelledby="recipesTitle">
      <div className="recipe-heading">
        <div className="support-title">
          <IconBook />
          <h2 id="recipesTitle">
            Рецепты
            {recipes.length > 0 && <span className="recipe-count">{recipes.length}</span>}
          </h2>
        </div>
        <div className="recipe-buttons">
          <button className="text-btn" type="button" onClick={onScan}><IconCamera />Скан</button>
          <button className="text-btn" type="button" onClick={onCreate}><IconPlus />Свой</button>
        </div>
      </div>

      {recipes.length > 0 && <p className="recipes-caption">Сохранённые блюда · КБЖУ на 1 порцию</p>}

      {recipes.length === 0 ? (
        <div className="recipes-empty">
          <strong>Любимые рецепты — под рукой</strong>
          <p>Добавь свой рецепт или фото страницы. Ингредиенты и приготовление будут здесь.</p>
        </div>
      ) : (
        <div>
          {recipes.map(r => {
            const isOpen = openIds.includes(r.id);
            return (
              <article className="saved-recipe" key={r.id} data-recipe={r.id}>
                <button
                  className="recipe-expand"
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`recipe-${r.id}`}
                  onClick={() => onToggle(r.id)}
                >
                  <span>
                    <strong>{r.name}</strong>
                    <span className="recipe-meta">
                      {Number(r.durationMinutes) > 0 && (
                        <>
                          <IconClock />
                          <span>{num(Number(r.durationMinutes))} мин</span>
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      <span>{portionsText(r.servings)}</span>
                    </span>
                    <span className="recipe-nutrition">
                      <span className="recipe-kcal">{num(r.perServing.calories)} ккал</span>
                      <span><i>Б</i>{num(r.perServing.protein)} г</span>
                      <span><i>Ж</i>{num(r.perServing.fat)} г</span>
                      <span><i>У</i>{num(r.perServing.carbs)} г</span>
                    </span>
                  </span>
                  <IconDown />
                </button>
                <div className="recipe-details" id={`recipe-${r.id}`} hidden={!isOpen}>
                  <div className="recipe-detail-heading">
                    <h4>Ингредиенты</h4>
                    <span>На весь рецепт · {portionsText(r.servings)}</span>
                  </div>
                  <ul className="recipe-ingredients">
                    {r.ingredients.map((line, i) => {
                      const [name, amount] = splitIngredient(line);
                      return (
                        <li key={i}>
                          <span>{name}</span>
                          {amount !== null && <span>{amount}</span>}
                        </li>
                      );
                    })}
                  </ul>
                  <h4>Как приготовить</h4>
                  <ol className="recipe-steps">
                    {r.steps.map((line, i) => (
                      <li key={i}><span>{line.replace(/^\s*\d+[.)]\s*/, '')}</span></li>
                    ))}
                  </ol>
                  {r.photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="saved-recipe-photo" src={r.photo} alt={`Фото рецепта ${r.name}`} />
                  )}
                  <button type="button" className="primary" onClick={() => onAddPortion(r)}>
                    <IconPlus />Добавить 1 порцию
                  </button>
                  <p className="recipe-destination">
                    В дневник за {selectedDateText} · {num(r.perServing.calories)} ккал
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

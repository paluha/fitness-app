'use client';

import { useState, type ReactNode } from 'react';
import { SlidersHorizontal, ChevronRight, ChevronDown, LogOut } from 'lucide-react';
import { TxDialog } from './TxDialog';

export type GoalType = 'lose' | 'maintain' | 'gain' | 'recomp';
export interface MacroGoal { protein: number; fat: number; carbs: number; calories: number }
export interface AboutMe { birthYear: string; heightCm: string; sex: string }

/**
 * Направление цели: короткое название, смысл и по каким признакам
 * оцениваем прогресс. Тексты — из макета редизайна (кадр «Профиль»).
 */
const GOALS: Record<GoalType, { ru: { name: string; short: string; logic: string; focus: string[] }; en: { name: string; short: string; logic: string; focus: string[] } }> = {
  recomp: {
    ru: { name: 'Атлетичная форма', short: 'Атлетика (мышцы + сушка)', logic: 'Снижать жировую массу, сохраняя силу и мышечную массу.', focus: ['Стабильность тренировок', 'Динамика объёмов', 'Самочувствие и восстановление'] },
    en: { name: 'Athletic shape', short: 'Recomp (muscle + cut)', logic: 'Lose body fat while keeping strength and muscle.', focus: ['Training consistency', 'Body measurements trend', 'Wellbeing and recovery'] },
  },
  gain: {
    ru: { name: 'Сильнее и объёмнее', short: 'Набор массы', logic: 'Постепенно набирать мышечную массу и улучшать силовые показатели.', focus: ['Прогресс рабочих весов', 'Регулярность питания', 'Восстановление'] },
    en: { name: 'Stronger and bigger', short: 'Gain', logic: 'Gradually build muscle and improve strength.', focus: ['Working weights progress', 'Regular nutrition', 'Recovery'] },
  },
  maintain: {
    ru: { name: 'Форма в балансе', short: 'Поддержание', logic: 'Поддерживать достигнутую форму, силу и устойчивый режим.', focus: ['Стабильный режим', 'Поддержание силы', 'Комфортная активность'] },
    en: { name: 'Balanced shape', short: 'Maintain', logic: 'Keep the shape, strength and a steady routine you have.', focus: ['Steady routine', 'Keeping strength', 'Comfortable activity'] },
  },
  lose: {
    ru: { name: 'Легче и энергичнее', short: 'Похудение', logic: 'Плавно снижать вес за счёт жира, не теряя силу и самочувствие.', focus: ['Умеренный дефицит калорий', 'Регулярные тренировки', 'Сон и восстановление'] },
    en: { name: 'Lighter and energetic', short: 'Lose fat', logic: 'Lose weight from fat steadily without losing strength or wellbeing.', focus: ['Moderate calorie deficit', 'Regular training', 'Sleep and recovery'] },
  },
};

const TIMEZONES: { id: string; ru: string; en: string; offset: string }[] = [
  { id: 'Europe/Moscow', ru: 'Москва', en: 'Moscow', offset: 'UTC+3' },
  { id: 'Europe/Kiev', ru: 'Киев', en: 'Kyiv', offset: 'UTC+2' },
  { id: 'Europe/London', ru: 'Лондон', en: 'London', offset: 'UTC+0' },
  { id: 'America/New_York', ru: 'Нью-Йорк', en: 'New York', offset: 'UTC−5' },
  { id: 'America/Los_Angeles', ru: 'Лос-Анджелес', en: 'Los Angeles', offset: 'UTC−8' },
  { id: 'Asia/Dubai', ru: 'Дубай', en: 'Dubai', offset: 'UTC+4' },
  { id: 'Asia/Tokyo', ru: 'Токио', en: 'Tokyo', offset: 'UTC+9' },
];

const fmt = (n: number) => n.toLocaleString('ru-RU');
const kcalOf = (p: number, f: number, c: number) => Math.round(p * 4 + f * 9 + c * 4);

export function ProfileView({
  lang, name, email, goalType, goal, timezone, about, latestWeight,
  onSettings, onAbout, onDiscussGoal, onSignOut, extraSettings,
}: {
  lang: 'ru' | 'en';
  name?: string;
  email?: string;
  goalType: GoalType;
  goal: MacroGoal;
  timezone: string;
  about: AboutMe;
  /** Последний записанный вес — для блока «На чём основана цель». */
  latestWeight?: { kg: number; date: string } | null;
  onSettings: (patch: { language?: 'ru' | 'en'; timezone?: string; goalType?: GoalType; goal?: MacroGoal; name?: string }) => void;
  onAbout: (next: AboutMe) => void;
  /** Открыть ИИ-ассистента с подготовленным вопросом. */
  onDiscussGoal: (prompt: string) => void;
  onSignOut: () => void;
  /** Дополнительные блоки внутри «Настроек» (например, кольцо Oura). */
  extraSettings?: ReactNode;
}) {
  const ru = lang === 'ru';
  const g = GOALS[goalType][lang];
  const [modal, setModal] = useState<null | 'personal' | 'macros' | 'direction'>(null);

  // Черновики форм заполняются при открытии окна
  const [personal, setPersonal] = useState({ name: '', birthYear: '', heightCm: '', sex: '' });
  const [macros, setMacros] = useState({ protein: '', fat: '', carbs: '' });
  const [direction, setDirection] = useState<GoalType>(goalType);

  const openPersonal = () => {
    setPersonal({ name: name || '', birthYear: about.birthYear, heightCm: about.heightCm, sex: about.sex });
    setModal('personal');
  };
  const openMacros = () => {
    setMacros({ protein: String(goal.protein), fat: String(goal.fat), carbs: String(goal.carbs) });
    setModal('macros');
  };
  const openDirection = () => { setDirection(goalType); setModal('direction'); };

  const num = (s: string) => { const n = parseInt(s, 10); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const draftKcal = kcalOf(num(macros.protein), num(macros.fat), num(macros.carbs));

  const tz = TIMEZONES.find(z => z.id === timezone);
  const summary = [ru ? 'Русский' : 'English', tz ? tz[lang] : timezone].join(' · ');

  const age = about.birthYear ? new Date().getFullYear() - parseInt(about.birthYear, 10) : null;
  const basisData = [
    latestWeight ? `${ru ? 'вес' : 'weight'} ${String(latestWeight.kg).replace('.', ru ? ',' : '.')} ${ru ? 'кг' : 'kg'} (${latestWeight.date})` : null,
    about.heightCm ? `${ru ? 'рост' : 'height'} ${about.heightCm} ${ru ? 'см' : 'cm'}` : null,
    age && age > 0 && age < 120 ? `${age} ${ru ? 'лет' : 'y.o.'}` : null,
  ].filter(Boolean).join(' · ');

  const discussPrompt = ru
    ? `Давай обсудим мою цель «${g.name}» (${g.short.toLowerCase()}). Подходит ли она мне сейчас и какие ориентиры поставить на ближайшие 4–6 недель?`
    : `Let's discuss my goal "${g.name}". Does it fit me now, and what targets should I set for the next 4–6 weeks?`;

  return (
    <div className="tx tx-profile-view">
      <div className="page-title">
        <div>
          <h1>{ru ? 'Профиль' : 'Profile'}</h1>
          <p>{ru ? 'Твои цели и настройки' : 'Your goals and settings'}</p>
        </div>
      </div>

      <div className="profile-card">
        <span className="avatar big">{name?.[0]?.toUpperCase() || '·'}</span>
        <div>
          <h2>{name || (ru ? 'Без имени' : 'No name')}</h2>
          <p>{email}</p>
        </div>
        <button type="button" className="round" onClick={openPersonal} aria-label={ru ? 'Редактировать профиль' : 'Edit profile'}>
          <SlidersHorizontal />
        </button>
      </div>

      <section className="card ux-goal">
        <div className="section-title"><h2>{ru ? 'Моя цель' : 'My goal'}</h2></div>
        <span className="ux-eyebrow">{ru ? 'Твоё направление' : 'Your direction'}</span>
        <h3>{g.name}</h3>
        <p className="ux-goal-logic">{g.logic}</p>
        <div className="ux-goal-focus">
          {g.focus.map((f, i) => <div key={f}><span>0{i + 1}</span><b>{f}</b></div>)}
        </div>
        <details open>
          <summary>{ru ? 'Почему именно эта цель' : 'Why this goal'}</summary>
          <p>{ru
            ? 'Название описывает направление, а прогресс оценивается по нескольким признакам. ИИ учитывает цель, когда советует питание и нагрузку, и помогает уточнить ориентиры в диалоге.'
            : 'The name describes the direction; progress is judged by several signs. The AI uses this goal for nutrition and training advice and helps refine targets in a conversation.'}</p>
        </details>
        <details className="goal-evidence">
          <summary>{ru ? 'На чём основана цель' : 'What the goal is based on'}</summary>
          <div>
            <span>{ru ? 'Направление' : 'Direction'}</span>
            <p>{g.short}{ru ? ' — выбрано в профиле.' : ' — chosen in your profile.'}</p>
          </div>
          {basisData && (
            <div>
              <span>{ru ? 'Твои данные' : 'Your data'}</span>
              <p>{basisData}</p>
            </div>
          )}
          <div>
            <span>{ru ? 'Питание' : 'Nutrition'}</span>
            <p>{fmt(goal.calories)} {ru ? 'ккал' : 'kcal'} · {ru ? 'Б' : 'P'} {goal.protein} · {ru ? 'Ж' : 'F'} {goal.fat} · {ru ? 'У' : 'C'} {goal.carbs} {ru ? 'г — по ним ИИ сверяет план питания.' : 'g — the AI checks the meal plan against these.'}</p>
          </div>
        </details>
        <button type="button" className="dark-action" onClick={() => onDiscussGoal(discussPrompt)}>✦ {ru ? 'Обсудить цель с ИИ' : 'Discuss the goal with AI'}</button>
        <button type="button" className="ux-goal-rename" onClick={openDirection}>{ru ? 'Сменить направление' : 'Change direction'}</button>
      </section>

      <section className="card profile-nutrition">
        <div className="section-title">
          <h2>{ru ? 'Питание' : 'Nutrition'}</h2>
          <button type="button" className="text-button" onClick={openMacros}>{ru ? 'Изменить' : 'Edit'}</button>
        </div>
        <div className="calorie-heading">
          <strong>{fmt(goal.calories)}</strong>
          <span>{ru ? 'ккал / день' : 'kcal / day'}</span>
        </div>
        <div className="macro-grid">
          <div><b>{goal.protein} {ru ? 'г' : 'g'}</b><small>{ru ? 'Белки' : 'Protein'}</small></div>
          <div><b>{goal.fat} {ru ? 'г' : 'g'}</b><small>{ru ? 'Жиры' : 'Fat'}</small></div>
          <div><b>{goal.carbs} {ru ? 'г' : 'g'}</b><small>{ru ? 'Углеводы' : 'Carbs'}</small></div>
        </div>
      </section>

      <section className="card profile-settings-card">
        <details className="profile-settings">
          <summary>
            <b>{ru ? 'Настройки' : 'Settings'}</b>
            <span>{summary}</span>
            <ChevronDown className="chev" aria-hidden="true" />
          </summary>
          <div>
            <label className="setting">
              <span>{ru ? 'Язык' : 'Language'}</span>
              <select value={lang} onChange={e => onSettings({ language: e.target.value as 'ru' | 'en' })}>
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="setting">
              <span>{ru ? 'Часовой пояс' : 'Time zone'}</span>
              <select value={timezone} onChange={e => onSettings({ timezone: e.target.value })}>
                {!tz && <option value={timezone}>{timezone}</option>}
                {TIMEZONES.map(z => <option key={z.id} value={z.id}>{z[lang]} ({z.offset})</option>)}
              </select>
            </label>
            {extraSettings}
          </div>
        </details>
      </section>

      <button type="button" className="wide secondary about-button" onClick={openPersonal}>
        {ru ? 'О себе и предпочтениях' : 'About you'} <ChevronRight aria-hidden="true" />
      </button>
      <button type="button" className="wide text-button signout-button" onClick={onSignOut}>
        <LogOut aria-hidden="true" /> {ru ? 'Выйти' : 'Sign out'}
      </button>

      {modal === 'personal' && (
        <TxDialog title={ru ? 'О себе' : 'About you'} onClose={() => setModal(null)}>
          <form onSubmit={e => {
            e.preventDefault();
            if (personal.name.trim() && personal.name.trim() !== name) onSettings({ name: personal.name.trim() });
            onAbout({ birthYear: personal.birthYear, heightCm: personal.heightCm, sex: personal.sex });
            setModal(null);
          }}>
            <label>{ru ? 'Имя' : 'Name'}
              <input value={personal.name} onChange={e => setPersonal(p => ({ ...p, name: e.target.value }))} maxLength={60} required />
            </label>
            <label>{ru ? 'Год рождения' : 'Birth year'}
              <input type="number" inputMode="numeric" min={1920} max={2020} placeholder="1990" value={personal.birthYear} onChange={e => setPersonal(p => ({ ...p, birthYear: e.target.value }))} />
            </label>
            <label>{ru ? 'Рост, см' : 'Height, cm'}
              <input type="number" inputMode="numeric" min={100} max={250} placeholder="180" value={personal.heightCm} onChange={e => setPersonal(p => ({ ...p, heightCm: e.target.value }))} />
            </label>
            <label>{ru ? 'Пол' : 'Sex'}
              <select value={personal.sex} onChange={e => setPersonal(p => ({ ...p, sex: e.target.value }))}>
                <option value="">{ru ? 'Не указан' : 'Not set'}</option>
                <option value="m">{ru ? 'Мужской' : 'Male'}</option>
                <option value="f">{ru ? 'Женский' : 'Female'}</option>
              </select>
            </label>
            <p>{ru ? 'ИИ учитывает это в рекомендациях. Вес берётся из замеров.' : 'The AI uses this in recommendations. Weight comes from measurements.'}</p>
            <button type="submit" className="primary">{ru ? 'Сохранить' : 'Save'}</button>
          </form>
        </TxDialog>
      )}

      {modal === 'macros' && (
        <TxDialog title={ru ? 'Цели питания' : 'Nutrition targets'} onClose={() => setModal(null)}>
          <form onSubmit={e => {
            e.preventDefault();
            onSettings({ goal: { protein: num(macros.protein), fat: num(macros.fat), carbs: num(macros.carbs), calories: draftKcal } });
            setModal(null);
          }}>
            <label>{ru ? 'Белки, г' : 'Protein, g'}
              <input type="number" inputMode="numeric" min={0} max={500} required value={macros.protein} onChange={e => setMacros(m => ({ ...m, protein: e.target.value }))} />
            </label>
            <label>{ru ? 'Жиры, г' : 'Fat, g'}
              <input type="number" inputMode="numeric" min={0} max={300} required value={macros.fat} onChange={e => setMacros(m => ({ ...m, fat: e.target.value }))} />
            </label>
            <label>{ru ? 'Углеводы, г' : 'Carbs, g'}
              <input type="number" inputMode="numeric" min={0} max={1000} required value={macros.carbs} onChange={e => setMacros(m => ({ ...m, carbs: e.target.value }))} />
            </label>
            <p>{ru ? 'Калорийность считается из БЖУ (4 / 9 / 4 ккал на грамм): ' : 'Calories come from macros (4 / 9 / 4 kcal per gram): '}<b>{fmt(draftKcal)} {ru ? 'ккал' : 'kcal'}</b></p>
            <button type="submit" className="primary">{ru ? 'Сохранить' : 'Save'}</button>
          </form>
        </TxDialog>
      )}

      {modal === 'direction' && (
        <TxDialog title={ru ? 'Направление цели' : 'Goal direction'} onClose={() => setModal(null)}>
          <form onSubmit={e => { e.preventDefault(); onSettings({ goalType: direction }); setModal(null); }}>
            <div className="direction-list">
              {(['recomp', 'lose', 'maintain', 'gain'] as GoalType[]).map(k => (
                <label key={k} className={direction === k ? 'is-active' : ''}>
                  <input type="radio" name="direction" value={k} checked={direction === k} onChange={() => setDirection(k)} />
                  <span><b>{GOALS[k][lang].name}</b><small>{GOALS[k][lang].short}</small></span>
                </label>
              ))}
            </div>
            <p>{ru ? 'От направления зависят советы ИИ по питанию и нагрузке.' : 'The AI tailors nutrition and training advice to the direction.'}</p>
            <button type="submit" className="primary">{ru ? 'Сохранить' : 'Save'}</button>
          </form>
        </TxDialog>
      )}
    </div>
  );
}

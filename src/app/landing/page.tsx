'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Dumbbell, Utensils, TrendingUp, ChevronRight } from 'lucide-react';

type Language = 'ru' | 'en';

// Лендинг по макету редизайна (all-screens.html, кадр «Лендинг»):
// одна колонка, превью следующей тренировки и три коротких блока.
const COPY = {
  ru: {
    badge: 'Твой фитнес. Без лишнего.',
    title: 'Всё, что нужно.',
    titleSoft: ['Для твоего', 'результата.'],
    intro: 'Тренируйся по плану, следи за питанием и замечай свой прогресс.',
    cta: 'Открыть приложение',
    nextWorkout: 'Твоя следующая тренировка',
    workoutName: 'Спина и бицепс',
    ex1: 'Тяга штанги в наклоне', ex1Sets: '4 подхода',
    ex2: 'Тяга гантели', ex2Sets: '3 подхода',
    progress: 'Один подход ближе к цели.',
    rhythm: 'Один понятный ритм.',
    features: [
      { title: 'Тренировки', text: 'Программа, рабочие веса и история подходов. Всё под рукой.' },
      { title: 'Питание', text: 'Калории, БЖУ и любимые блюда без лишних действий.' },
      { title: 'Прогресс', text: 'Вес, замеры и наблюдения, которые складываются в общую картину.' },
    ],
  },
  en: {
    badge: 'Your fitness. Nothing extra.',
    title: 'Everything you need.',
    titleSoft: ['For your', 'results.'],
    intro: 'Train by plan, keep an eye on nutrition and notice your progress.',
    cta: 'Open the app',
    nextWorkout: 'Your next workout',
    workoutName: 'Back and biceps',
    ex1: 'Bent-over barbell row', ex1Sets: '4 sets',
    ex2: 'Dumbbell row', ex2Sets: '3 sets',
    progress: 'One set closer to your goal.',
    rhythm: 'One clear rhythm.',
    features: [
      { title: 'Workouts', text: 'Program, working weights and set history. All at hand.' },
      { title: 'Nutrition', text: 'Calories, macros and favourite meals without extra steps.' },
      { title: 'Progress', text: 'Weight, measurements and notes that add up to the big picture.' },
    ],
  },
} as const;

const FEATURE_ICONS = [Dumbbell, Utensils, TrendingUp];

// Язык выбирает middleware (cookie lang по Accept-Language), здесь только читаем.
const readCookieLang = (): Language => (document.cookie.match(/lang=(ru|en)/)?.[1] as Language) || 'ru';
const noSubscribe = () => () => {};

export default function LandingPage() {
  const cookieLang = useSyncExternalStore(noSubscribe, readCookieLang, (): Language => 'ru');
  const [chosen, setChosen] = useState<Language | null>(null);
  const lang = chosen ?? cookieLang;

  const switchLang = () => {
    const next: Language = lang === 'ru' ? 'en' : 'ru';
    setChosen(next);
    document.cookie = `lang=${next};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
  };

  const t = COPY[lang];

  return (
    <div className="tx landing">
      <div className="landing-inner">
        <header className="auth-head">
          <div className="welcome-text">Welcome to <b className="wordmark">Train<span>X</span></b></div>
          <button type="button" className="lang-switch" onClick={switchLang} aria-label="Language">
            {lang === 'ru' ? 'EN' : 'RU'}
          </button>
        </header>

        <span className="badge">{t.badge}</span>
        <h1>{t.title}<br /><span>{t.titleSoft[0]}<br />{t.titleSoft[1]}</span></h1>
        <p className="intro">{t.intro}</p>
        <Link href="/" className="wide primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, textDecoration: 'none' }}>
          {t.cta} <ChevronRight strokeWidth={1.65} aria-hidden="true" />
        </Link>

        <div className="landing-preview" aria-hidden="true">
          <div className="section-title">
            <span className="eyebrow">{t.nextWorkout}</span>
            <span className="badge">T1</span>
          </div>
          <h2>{t.workoutName}</h2>
          <div className="row">
            <span className="icon-tile"><Dumbbell strokeWidth={1.65} /></span>
            <div className="row-copy"><strong>{t.ex1}</strong><small>{t.ex1Sets}</small></div>
            <ChevronRight strokeWidth={1.65} />
          </div>
          <div className="row">
            <span className="icon-tile"><Dumbbell strokeWidth={1.65} /></span>
            <div className="row-copy"><strong>{t.ex2}</strong><small>{t.ex2Sets}</small></div>
            <ChevronRight strokeWidth={1.65} />
          </div>
          <div className="mini-bar"><i /></div>
          <p className="muted">{t.progress}</p>
        </div>

        <h2 className="landing-subtitle">{t.rhythm}</h2>
        {t.features.map((f, i) => {
          const Icon = FEATURE_ICONS[i];
          return (
            <section className="card" key={f.title}>
              <div className="section-title">
                <h2>{f.title}</h2>
                <Icon strokeWidth={1.65} aria-hidden="true" />
              </div>
              <p className="body-copy">{f.text}</p>
            </section>
          );
        })}
        <p className="center muted">Trainx · {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}

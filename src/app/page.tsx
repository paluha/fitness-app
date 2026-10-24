'use client';

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { signOut } from 'next-auth/react';
import {
  Plus, X, Dumbbell, Apple, ChevronLeft, ChevronRight, Check, CheckCheck,
  TrendingUp, Edit2, Trash2, Save, ChevronDown,
  ChevronUp, Calendar, Cloud, CloudOff, Footprints, History,
  Zap, Timer, Play, Pause, RotateCcw, Settings, User,
  BarChart3, Scale,
  Camera, ScanLine, Video, ExternalLink, Sparkles, CalendarDays,
  Home, Trophy, FlaskConical, Hourglass, Brain, Loader2, Image as ImageIcon, BookOpen, Clock, AlertTriangle, Flame, ChevronsDown, Link2,
} from 'lucide-react';
import PlannerView, { PlannerEvent, Habit } from './PlannerView';
import { AssistantChat, type WorkoutEdit } from '@/components/AssistantChat';
import { LabsView } from '@/components/LabsView';
import { ProfileView } from '@/components/ProfileView';
import { HealthView } from '@/components/HealthView';
import {
  type BodyMeasurement, type CheckinField, type CheckinEntry, type MedCourse, type MedLog, type VitalEntry,
} from '@/lib/health-types';
import { WeightChart } from '@/components/WeightChart';
import NutritionPage from '@/components/NutritionPage';
import AddMealDialog from '@/components/AddMealDialog';
import NutritionPlanSection from '@/components/NutritionPlanSection';
import NutritionRecipesSection from '@/components/NutritionRecipesSection';
import type { NutritionMeal } from '@/components/NutritionPage';
import type { PlanSlot, PlanDish } from '@/components/NutritionPlanSection';
import type { RecipeCard } from '@/components/NutritionRecipesSection';
import { upsertWorkoutLog, upsertDayLog, flushNow, startSyncLoop, getPendingOpsCount } from '@/lib/sync';

// Parse rest time string like "2-3 мин" or "3 мин" to seconds
function parseRestTime(restTime: string | undefined | null): number {
  const raw = String(restTime ?? '').trim();
  // Точное значение из карточки: «1:45», «0:15». Пишется степпером отдыха,
  // поэтому проверяется первым — иначе настройка откатывалась бы к 2 минутам.
  const exact = raw.match(/^(\d+):([0-5]\d)$/);
  if (exact) {
    const sec = parseInt(exact[1], 10) * 60 + parseInt(exact[2], 10);
    if (sec > 0) return Math.min(600, sec);
  }
  // Формат программы: «2-3 мин», «3 мин» — середина диапазона.
  const match = raw.match(/(\d+)(?:-(\d+))?\s*мин/);
  if (match) {
    const min = parseInt(match[1]);
    const max = match[2] ? parseInt(match[2]) : min;
    // Use the middle value for range, or exact value
    return Math.round((min + max) / 2) * 60;
  }
  // Секунды: ассистент пишет и так («30 сек до A2», «45-60 сек»). Без
  // этой ветки любое значение в секундах молча превращалось в 2 минуты.
  const sec = raw.match(/(\d+)(?:-(\d+))?\s*сек/);
  if (sec) {
    const min = parseInt(sec[1]);
    const max = sec[2] ? parseInt(sec[2]) : min;
    const v = Math.round((min + max) / 2);
    if (v > 0) return Math.min(600, v);
  }
  return 120; // Default 2 minutes
}

// Format seconds to MM:SS
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Rest Timer Component
function RestTimer({ restTime, startSignal, stopSignal, onSecondsChange, idleLabel, onFinish }: {
  restTime: string;
  // Подпись до запуска: в суперсете отдых относится к КРУГУ, а не к
  // подходу, и «Отдых после подхода» там читается неверно.
  idleLabel?: string;
  // Счётчик-«сигнал»: увеличивается родителем, когда отмечен подход —
  // таймер перезапускается. Ручные Play/Pause при этом сохраняются.
  startSignal?: number;
  // Счётчик-«сигнал» на остановку: последний подход упражнения и «Отметить
  // все» гасят отдых — отдыхать уже не от чего.
  stopSignal?: number;
  // Сообщает родителю выбранное время в секундах (для настройки в карточке).
  onSecondsChange?: (sec: number) => void;
  // Отдых закончился. Карточка закрытого упражнения по этому сигналу
  // схлопывается и раскрывает следующее — но не раньше, иначе таймер
  // исчезал бы вместе с ней сразу после последнего подхода.
  onFinish?: () => void;
} = { restTime: '' }) {
  const totalSeconds = parseRestTime(restTime);
  /**
   * Отсчёт идёт по ЧАСАМ, а не по тикам.
   *
   * deadline — момент, когда отдых закончится (Date.now() + остаток).
   * Интервал лишь перерисовывает цифры; сколько именно раз он успел
   * сработать, на результат не влияет. Это важно, потому что в свёрнутом
   * приложении и в фоновой вкладке браузер душит таймеры: setInterval на
   * секунду начинает приходить раз в минуту или не приходить вовсе, и
   * счётчик «минус один за тик» замирал посреди отдыха.
   *
   * null означает «не идёт»: на паузе и до старта остаток фиксирован и
   * лежит в timeLeft, часы на него не влияют.
   */
  const [deadline, setDeadline] = useState<number | null>(null);
  const [isFinished, setIsFinished] = useState(false);
  /**
   * Показываемый остаток. Пересчитывается из deadline в эффекте, а не при
   * рендере: Date.now() в рендере — нечистая функция, два рендера подряд
   * дали бы разные числа. Пока таймер стоит, здесь лежит остаток с паузы.
   */
  const [timeLeft, setTimeLeft] = useState(totalSeconds);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const isRunning = deadline !== null;

  // Приятный «фитнесовый» сигнал: мягкий двухнотный колокольчик (E5→A5)
  // с обертоном и длинным затуханием, повторяется дважды.
  const playBeep = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const chime = (freq: number, at: number) => {
        const t = ctx.currentTime + at;
        for (const [mult, vol] of [[1, 0.22], [2, 0.07]] as const) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.value = freq * mult;
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(vol, t + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
          osc.start(t);
          osc.stop(t + 0.65);
        }
      };
      chime(659.25, 0);      // E5
      chime(880, 0.22);      // A5
      chime(659.25, 0.9);
      chime(880, 1.12);
    } catch {
      console.log('Audio not supported');
    }
  }, []);

  // Пока таймер идёт — не даём экрану погаснуть (Wake Lock, где поддерживается)
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const acquire = async () => {
      try {
        const wl = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen');
        if (wl) { if (cancelled) wl.release(); else wakeLockRef.current = wl; }
      } catch { /* не поддерживается — не критично */ }
    };
    const release = () => {
      try { wakeLockRef.current?.release(); } catch { /* ignore */ }
      wakeLockRef.current = null;
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && isRunning) acquire();
    };
    if (isRunning) {
      acquire();
      document.addEventListener('visibilitychange', onVisible);
    }
    return () => {
      cancelled = true;
      release();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isRunning]);

  /**
   * Завершение отдыха. Вызывается и тиком, и возвратом на экран: если
   * приложение было свёрнуто дольше, чем шёл отдых, время вышло ещё в
   * фоне, и показать это надо сразу, не дожидаясь тиков.
   */
  const finish = useCallback((withSound: boolean) => {
    setDeadline(null);
    setTimeLeft(0);
    setIsFinished(true);
    if (withSound) playBeep();
    onFinish?.();
  }, [playBeep, onFinish]);

  useEffect(() => {
    if (deadline === null) return;

    const check = (withSound: boolean) => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (left === 0) finish(withSound);
      else setTimeLeft(left);
    };

    // Сверяемся с часами сразу: первый тик придёт только через интервал,
    // а цифры должны встать на место немедленно.
    check(false);

    // Раз в 250мс: цифры не «проскакивают» секунду, когда тик приходит
    // с задержкой, а нагрузка остаётся незаметной.
    intervalRef.current = setInterval(() => check(true), 250);

    // Вернулись на экран — сверяемся с часами немедленно, не дожидаясь
    // тика: в фоне он мог не приходить вовсе. Если время вышло, пока
    // приложение было свёрнуто, звук прозвучит сейчас — в фоне браузер
    // его всё равно глушит, а услышать сигнал нужно. Прозвучит один раз:
    // finish() снимает deadline, и эффект больше не висит.
    const onVisible = () => {
      if (document.visibilityState === 'visible') check(true);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [deadline, finish]);

  // Реакция на сигналы родителя: отметили подход — отдых пошёл, закрыли
  // упражнение — погас. Сигнал приходит извне как счётчик, поэтому это
  // синхронизация с внешним событием, а не производное состояние: setState
  // здесь осознанный, ререндер ровно один на сигнал.
  const prevStartRef = useRef(startSignal ?? 0);
  useEffect(() => {
    const sig = startSignal ?? 0;
    if (sig === prevStartRef.current || sig === 0) return;
    prevStartRef.current = sig;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- внешнее событие: подход отмечен
    setIsFinished(false);
    setTimeLeft(totalSeconds);
    setDeadline(Date.now() + totalSeconds * 1000);
  }, [startSignal, totalSeconds]);

  const prevStopRef = useRef(stopSignal ?? 0);
  useEffect(() => {
    const sig = stopSignal ?? 0;
    if (sig === prevStopRef.current || sig === 0) return;
    prevStopRef.current = sig;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- внешнее событие: упражнение закрыто
    setDeadline(null);
    setIsFinished(false);
    setTimeLeft(totalSeconds);
  }, [stopSignal, totalSeconds]);

  // Время отдыха поменяли степпером — подхватываем, пока таймер стоит.
  const prevTotalRef = useRef(totalSeconds);
  useEffect(() => {
    if (totalSeconds === prevTotalRef.current) return;
    prevTotalRef.current = totalSeconds;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- внешнее событие: изменена настройка отдыха
    if (!isRunning && !isFinished) setTimeLeft(totalSeconds);
  }, [totalSeconds, isRunning, isFinished]);

  const toggleTimer = () => {
    if (isFinished) {
      // «Заново» — полный круг отдыха с нуля.
      setIsFinished(false);
      setTimeLeft(totalSeconds);
      setDeadline(Date.now() + totalSeconds * 1000);
    } else if (isRunning) {
      // Пауза: остаток уже посчитан тиком, достаточно убрать deadline —
      // дальше timeLeft не меняется, сколько бы времени ни прошло.
      setDeadline(null);
    } else {
      // Старт/продолжение от показанного остатка.
      const left = timeLeft > 0 ? timeLeft : totalSeconds;
      setTimeLeft(left);
      setDeadline(Date.now() + left * 1000);
    }
  };

  const resetTimer = () => {
    setDeadline(null);
    setTimeLeft(totalSeconds);
    setIsFinished(false);
  };

  const progress = ((totalSeconds - timeLeft) / totalSeconds) * 100;

  // Вид по макету: одна бежевая полоса вместо синей кнопки Play.
  // Идёт отдых — оранжевая с обратным отсчётом, закончился — зелёная.
  return (
    <div className={['exercise-rest', 'tx-rest', isRunning ? 'is-running' : '', isFinished ? 'is-done' : ''].filter(Boolean).join(' ')}>
      {/* Время — отдельной крупной строкой: таймер смотрят с пола, когда
          телефон лежит рядом, и 11px там не прочитать. */}
      <span className="rest-state" role="status">
        <span className="rest-label">
          {isFinished ? 'Отдых закончен' : isRunning ? 'Отдых' : (idleLabel ?? 'Отдых после подхода')}
        </span>
        <span className="rest-time">
          {isFinished ? 'Можно начинать' : formatTime(isRunning ? timeLeft : totalSeconds)}
        </span>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
        {isRunning && (
          <span aria-hidden style={{ width: '46px', height: '3px', borderRadius: '2px', background: 'rgba(182,83,52,0.22)', overflow: 'hidden', display: 'inline-block' }}>
            <span style={{ display: 'block', width: `${progress}%`, height: '100%', background: '#b65334', transition: 'width 1s linear' }} />
          </span>
        )}
        <button type="button" onClick={toggleTimer}>
          {isFinished ? 'Заново' : isRunning ? 'Пауза' : 'Старт'}
        </button>
        {(isRunning || timeLeft < totalSeconds) && (
          <button type="button" onClick={resetTimer} aria-label="Сбросить отдых">Сброс</button>
        )}
      </span>
    </div>
  );
}

/**
 * Проверка подхода на опечатку в цифрах.
 *
 * Набирая вес на телефоне, легко потерять последнюю цифру: 70 уходит
 * как 7. В журнале такие записи уже есть — «160,160,160,16»,
 * «150,15,15», «140,40,40» — и после закрытия дня они портят и
 * статистику, и тренд.
 *
 * Сравниваем с МАКСИМУМОМ соседних подходов, а не со средним:
 * потерянная цифра всегда уменьшает число, поэтому максимум от неё не
 * страдает, а медиана — страдает (при «150,15,15» она уезжает к 15, и
 * жалоба полетела бы на правильный подход).
 *
 * Ввод НЕ блокируем: бывает, что вес действительно сброшен.
 */
const SET_RATIO = 3;    // во столько раз вес должен выбиваться из соседей
const PREV_RATIO = 3;   // ...или из прошлой тренировки
const MAX_REPS = 40;    // больше — похоже, что вес попал в поле повторов

/** Выглядит ли число как target с потерянной цифрой: 7↔70, 15↔150. */
const looksTruncated = (value: number, target: number) => {
  if (value <= 0 || target <= 0) return false;
  const v = Math.round(value);
  const t = Math.round(target);
  // Не дописан нуль. Строго, без допуска: «9 при 100» — не потерянная
  // цифра, и предлагать 100 было бы выдумкой.
  if (v * 10 === t) return true;
  // Потеряна первая цифра: 40 вместо 140, 15 вместо 150.
  const str = String(t);
  if (str.length > 1 && Number(str.slice(1)) === v) return true;
  return false;
};

type SetWarning = { field: 'weight' | 'reps'; text: string };

const checkSetSanity = (
  set: ExerciseSet,
  i: number,
  sets: ExerciseSet[],
  prevMax: number,
): SetWarning | null => {
  const w = set.weight || 0;
  const reps = set.reps || 0;

  if (reps > MAX_REPS) {
    return { field: 'reps', text: `${reps} повторов — это вес?` };
  }

  if (w > 0) {
    const others = sets
      .filter((_, j) => j !== i)
      .map(x => x.weight || 0)
      .filter(x => x > 0);

    if (others.length >= 1) {
      const top = Math.max(...others);
      // Плавно меняющийся вес — не опечатка, а техника: разминка
      // «70→140→210» или дропсет «150→100→50». Отличие в размере ШАГА:
      // при потерянной цифре вес обрывается разом втрое и больше.
      const filled = sets.map(x => x.weight || 0).filter(x => x > 0);
      const steps = filled.slice(1).map((x, j) => {
        const prev = filled[j];
        return prev > 0 ? Math.max(x / prev, prev / x) : 1;
      });
      const smooth = filled.length >= 2 && steps.every(r => r < SET_RATIO);
      const monotone = smooth && (
        filled.every((x, j) => j === 0 || x >= filled[j - 1]) ||
        filled.every((x, j) => j === 0 || x <= filled[j - 1])
      );
      if (top > 0 && w * SET_RATIO <= top && !monotone) {
        // Когда видно потерянную цифру, не повторяем число дважды:
        // «Может, 70?» вместо «В других подходах 70. Может, 70?».
        return {
          field: 'weight',
          text: looksTruncated(w, top) ? `Может, ${top}?` : `В других подходах ${top}`,
        };
      }
    }

    // Сравнивать внутри упражнения не с чем — смотрим на прошлый раз.
    if (others.length === 0 && prevMax > 0) {
      if (w * PREV_RATIO <= prevMax || w >= prevMax * PREV_RATIO) {
        return {
          field: 'weight',
          text: looksTruncated(w, prevMax) ? `Может, ${prevMax}?` : `В прошлый раз ${prevMax}`,
        };
      }
    }
  }
  return null;
};
// Types
// One row in the new per-set table view. `completed` is per-set so the
// outer `completed` flag below can be derived (all sets done → exercise done).
/** Ступень дропсета: вес сбросили, отдыха не было. */
export interface DropStep {
  reps: number;
  weight: number;
}

/**
 * Техника, выполняемая ВНУТРИ одного подхода.
 *
 * Все они устроены одинаково: основная работа, потом несколько ступеней
 * без полноценного отдыха. Отличается только то, что меняется между
 * ступенями, поэтому структура данных у них общая (step[]), а интерфейс
 * подписывает ступени по-своему.
 *
 * - drop     — сброс веса без отдыха («100×8 → 75×6 → 55×5»)
 * - restPause — вес тот же, между ступенями пауза 10-20 сек
 * - cluster  — подход разбит на блоки с паузами («3+3+3» вместо 9)
 *
 * Пирамида и негативы сюда не входят: пирамида — это про веса МЕЖДУ
 * подходами (флаг на упражнении), а негативы — свойство самого подхода
 * (темп), а не отдельные ступени.
 */
export type SetTechnique = 'drop' | 'restPause' | 'cluster';

export interface ExerciseSet {
  reps: number;
  weight: number;   // pounds
  completed: boolean;
  /**
   * Подход сделан до отказа — последнее повторение далось на пределе.
   * Нужно и для истории, и для ИИ: при работе до отказа прогрессия и
   * восстановление планируются иначе.
   */
  toFailure?: boolean;
  /**
   * Дропсет: сбросы веса внутри ОДНОГО подхода, без отдыха между ними.
   * «100×8 → 70×6 → 50×5» — это один подход с двумя ступенями, а не три
   * подхода: иначе тренд видит падение рабочего веса, которого не было.
   *
   * Поле осталось с прежним именем ради сохранённых тренировок: его
   * читают закрытые дни и история. Какая именно техника — в `tech`.
   */
  drops?: DropStep[];
  /**
   * Чем являются ступени в `drops`. Пусто = дропсет (так было до
   * появления других техник, и старые записи читаются без миграции).
   */
  tech?: SetTechnique;
  /**
   * Негативы: медленная уступающая фаза. Не ступени, а свойство
   * подхода — сколько секунд опускание.
   */
  negativeSec?: number;
}

interface Exercise {
  id: string;
  name: string;
  plannedSets: string;
  actualSets: string; // legacy free-text — kept for closed-day snapshots
  // New per-set list. When undefined the UI initializes it from plannedSets
  // (e.g. "3x10-12" → three empty sets).
  sets?: ExerciseSet[];
  newWeight: string;
  restTime: string;
  notes: string;
  feedback: string;
  completed: boolean;
  videoUrl?: string;
  imageUrl?: string;
  /**
   * Метка суперсета: упражнения с одинаковой меткой выполняются по
   * кругу без отдыха между ними, отдых — только после всей связки.
   * Пустое значение — обычное упражнение.
   */
  supersetId?: string;
  /**
   * Запланировано программой: последний подход — дропсет.
   *
   * Отличается от ExerciseSet.drops: там ФАКТ (какие веса реально
   * сбросил в зале), здесь ПЛАН (что собирался). Без отдельного флага
   * план было видно только текстом в notes, и пользователь не понимал,
   * на каком подходе и что делать.
   */
  planDropSet?: boolean;
  /** Запланировано программой: последний подход до отказа. */
  planToFailure?: boolean;
  /**
   * Запланированная техника внутри подхода, если это не дропсет:
   * rest-pause или кластер. Дропсет остаётся в planDropSet, чтобы не
   * ломать уже сохранённые программы.
   */
  planTech?: SetTechnique;
  /**
   * Пирамида: вес осознанно меняется ОТ ПОДХОДА К ПОДХОДУ.
   *
   * Без этой метки тренд видел бы скачки рабочего веса как провал: при
   * пирамиде «60×12 → 80×10 → 100×6» максимум не падал, схема такая.
   * 'up' — вес растёт, повторы падают; 'down' — наоборот.
   */
  planPyramid?: 'up' | 'down';
}

interface Workout {
  id: string;
  name: string;
  exercises: Exercise[];
}

interface Meal {
  id: string;
  time: string;
  name: string;
  protein: number;
  fat: number;
  carbs: number;
  calories: number;
  // Общий сахар в граммах (природный + добавленный, единым числом)
  sugar?: number;
  isFavorite?: boolean;
}

// Архив программ тренировок: старая программа никуда не пропадает,
// а уходит сюда — видно, что делал раньше и когда, можно вернуть.
// Анкета питания/здоровья — на ней строятся ИИ-рекомендации по еде
interface NutritionProfile {
  conditions: string[];
  intolerances: string[];
  mealsPerDay: number;
  snacking: string;
  trainingTime: string;
  dietStyle: string;
  dislikes: string;
  notes: string;
  completedAt: string;
}

// Рецепт пользователя (введён вручную или распарсен ИИ с фото)
interface Recipe {
  id: string;
  name: string;
  servings: number;
  ingredients: string[];
  steps: string[];
  perServing: { calories: number; protein: number; fat: number; carbs: number; sugar: number };
  category?: string; // завтрак | обед | ужин | перекус | десерт | другое
  source: 'manual' | 'photo';
  createdAt: string;
}

const RECIPE_CATEGORIES = ['завтрак', 'обед', 'ужин', 'перекус', 'десерт', 'другое'] as const;

interface ArchivedProgram {
  id: string;
  archivedAt: string;
  label: string;
  workouts: Workout[];
}

/** Сводка по программе: когда по ней тренировались и сколько. */
interface ProgramSpan {
  from: string;
  to: string;
  count: number;
  spanDays: number;
  perWeek: number | null;
  maxGap: number;
}

/** Набор названий упражнений программы — по нему узнаём её дни в журнале. */
const programExerciseNames = (workouts: Workout[]) => {
  const set = new Set<string>();
  for (const w of workouts || []) {
    for (const e of w.exercises || []) {
      const n = (e.name || '').trim().toLowerCase();
      if (n) set.add(n);
    }
  }
  return set;
};

/**
 * За какой период тренировались по этой программе и сколько раз.
 *
 * Считаем из журнала, а не из даты архивации: archivedAt — это момент
 * замены в базе, а на телефоне старая программа могла жить ещё долго
 * (так и было: программу заменили 22 августа, а тренировки по ней шли
 * до 17 октября). Поэтому дни привязываем по НАЗВАНИЯМ упражнений:
 * день засчитывается программе, чьих упражнений в нём больше.
 */
const programSpan = (
  target: Workout[],
  others: Workout[][],
  dayLogs: Record<string, DayLog>,
): ProgramSpan | null => {
  const mine = programExerciseNames(target);
  if (mine.size === 0) return null;
  const rivals = others.map(programExerciseNames);

  const days: string[] = [];
  for (const d of Object.keys(dayLogs).sort()) {
    const cand = dayLogs[d]?.workoutDraft ?? dayLogs[d]?.workoutSnapshot;
    const exs = cand?.exercises;
    if (!Array.isArray(exs)) continue;
    // Только подходы с цифрами: открытая и брошенная тренировка в
    // статистику попадать не должна.
    const done = exs.filter(e => {
      const sets = (e as { sets?: ExerciseSet[] }).sets;
      return Array.isArray(sets) && sets.some(x => (x.weight || 0) > 0 || (x.reps || 0) > 0);
    });
    if (done.length === 0) continue;

    const names = done.map(e => (e.name || '').trim().toLowerCase());
    const score = names.filter(n => mine.has(n)).length;
    if (score === 0) continue;
    const best = rivals.reduce((mx, r) => Math.max(mx, names.filter(n => r.has(n)).length), 0);
    if (score > best) days.push(d);
  }
  if (days.length === 0) return null;

  // Дату разбираем по частям: new Date("2026-04-27") читается как
  // UTC-полночь и при западном смещении даёт предыдущий день.
  const asDate = (v: string) => {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const from = days[0];
  const to = days[days.length - 1];
  const spanDays = Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86400000) + 1;

  let maxGap = 0;
  for (let i = 1; i < days.length; i++) {
    const g = Math.round((asDate(days[i]).getTime() - asDate(days[i - 1]).getTime()) / 86400000);
    if (g > maxGap) maxGap = g;
  }

  // Регулярность считаем только когда есть что усреднять: по одной
  // тренировке за день «7 раз в неделю» — бессмысленная цифра.
  const perWeek = spanDays >= 14 && days.length >= 3
    ? Math.round((days.length / (spanDays / 7)) * 10) / 10
    : null;

  return { from, to, count: days.length, spanDays, perWeek, maxGap };
};

/** «27 апр 2026» — без сдвига на день, в отличие от new Date(строка). */
const fmtSpanDate = (v: string) => {
  try {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
      .replace(/\s*г\.$/, '').replace(/\.$/, '');
  } catch { return v; }
};

interface MacroGoal {
  protein: number;
  fat: number;
  carbs: number;
  calories: number;
}

interface UserSettings {
  language: 'ru' | 'en';
  timezone: string;
  name?: string;
  email?: string;
  // Theme preference. 'auto' picks dark between 22:00–06:00 (legacy night mode),
  // 'light'/'dark' force the theme regardless of time.
  theme?: 'light' | 'dark' | 'auto';
  // Per-user daily nutrition goal. The server returns either the user's saved
  // overrides or the app-wide fallback; both shapes look the same here.
  goal?: MacroGoal;
  // Цель питания — на неё опираются ИИ-рекомендации по еде.
  goalType?: 'lose' | 'maintain' | 'gain' | 'recomp';
}

interface NutritionRecommendation {
  id: string;
  emoji: string;
  title: string;
  description: string;
  color: 'yellow' | 'green' | 'blue' | 'red' | 'purple';
}

/**
 * Приём пищи в плане «когда и что есть». КБЖУ здесь — на ОДНУ порцию:
 * от них считаются и строка плана, и итог, поэтому изменение числа
 * порций не накапливает ошибку округления.
 */
interface PlanMeal {
  id: string;
  time: string;
  label: string;
  dish: string;
  portions: number;
  protein: number;
  fat: number;
  carbs: number;
  calories: number;
  emoji: string;
  note: string;
  /** Блюдо заменено на сохранённый рецепт — отсюда кнопка «Рецепт». */
  recipeId?: string | null;
}

interface WorkoutSnapshot {
  workoutId: string;
  workoutName: string;
  exercises: Exercise[];
}

interface DayLog {
  date: string;
  selectedWorkout: string | null; // Currently selected workout for this day
  workoutCompleted: string | null;
  workoutRating: number | null;
  workoutSnapshot: WorkoutSnapshot | null; // Snapshot of the workout when day was closed
  workoutDraft: WorkoutSnapshot | null; // Live draft saved on every exercise change (before day close)
  meals: Meal[];
  notes: string;
  steps: number | null;
  dayClosed: boolean;
  isOffDay?: boolean; // Day off - no workout required
  cycleStartDate?: string; // Date when new workout cycle was started
}

interface ExerciseProgress {
  date: string;
  weight: string;
  notes: string;
}

// Parse "3x10", "4x8-12", "3x30", "5x12-15" → number of sets.
// Falls back to 3 when it can't make sense of the planned string.
function parsePlannedSetCount(planned: string | undefined | null): number {
  if (!planned) return 3;
  const m = String(planned).match(/(\d+)\s*[xх×]/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (!Number.isNaN(n) && n > 0 && n < 20) return n;
  }
  return 3;
}

// Build the initial empty sets array for an exercise based on its plannedSets.
function makeInitialSets(planned: string | undefined | null): ExerciseSet[] {
  const count = parsePlannedSetCount(planned);
  return Array.from({ length: count }, () => ({ reps: 0, weight: 0, completed: false }));
}

interface ProgressHistory {
  [exerciseId: string]: ExerciseProgress[];
}

// Maximum workouts allowed
const MAX_WORKOUTS = 7;

/**
 * Разбор названия упражнения: ОСНОВА (само движение) + УТОЧНЕНИЯ по осям.
 *
 * История берётся по названию, а не по id: id вида «1».."7"
 * переиспользуются во всех тренировках программы, и один id означает
 * разные движения в T1, T2 и T3.
 *
 * Названия со временем правят, и уточнение добавляется или исчезает:
 * «Вертикальная тяга к груди» → «Вертикальная тяга к груди широким
 * хватом», «Протяжка со штангой» → «…к подбородку». Для пользователя это
 * то же движение, история должна сохраняться.
 *
 * Но просто выбросить уточнения нельзя: «тяга к груди широким хватом» и
 * «тяга обратным хватом» — разные упражнения, смешивать их веса нельзя.
 * Поэтому уточнения не отбрасываются, а сравниваются по осям: указанное
 * против указанного. Не написанное уточнение совместимо с любым.
 */
const SPEC_AXES: Record<string, string[]> = {
  grip: ['широким хватом', 'узким хватом', 'обратным хватом', 'прямым хватом',
         'нейтральным хватом', 'параллельным хватом'],
  target: ['к подбородку', 'к груди', 'за голову', 'из-за головы', 'над головой'],
  pose: ['стоя', 'сидя', 'лежа', 'в наклоне', 'в висе', 'на коленях'],
  gear: ['со штангой', 'с гантелями', 'с гантелей', 'в тренажере', 'в блоке',
         'в кроссовере', 'на брусьях', 'в смите'],
};

/**
 * Уточнения без «противоположности»: их наличие или отсутствие никогда не
 * делает движение другим, поэтому в основу они не входят вовсе.
 */
const SPEC_FREE = [
  'горизонтально', 'бабочка', 'канат', 'наклонной скамье', 'скамье скотта',
  'на месте', 'по одной руке', 'одной рукой', 'поочередно',
];

const normName = (s: string) => (s || '').toLowerCase().replace(/ё/g, 'е')
  // Скобки и то, что в них: «(бабочка)», «(канат)» — уточнение.
  .replace(/\([^)]*\)/g, ' ')
  // «или» и «/» перечисляют варианты: упражнение допускает оба.
  .replace(/\s+или\s+/g, ' ')
  .replace(/[\/,]+/g, ' ')
  // Цифры и градусы («30°», «45») — уточнение, а не другое движение.
  .replace(/\d+\s*°?/g, ' ')
  .replace(/[^а-яa-z\s]/g, ' ')
  .replace(/\s+/g, ' ').trim();

type ParsedName = { base: string; specs: Record<string, string[]> };

const parseExerciseName = (raw: string): ParsedName => {
  let k = normName(raw);
  const specs: Record<string, string[]> = {};
  for (const axis of Object.keys(SPEC_AXES)) {
    // Длинные варианты сначала, иначе «широким хватом» распадётся.
    const values = [...SPEC_AXES[axis]].sort((a, b) => b.length - a.length);
    const hits: string[] = [];
    for (const v of values) {
      if (k.includes(v)) { hits.push(v); k = k.split(v).join(' '); }
    }
    if (hits.length) specs[axis] = hits;
  }
  for (const free of SPEC_FREE) k = k.split(free).join(' ');
  const base = k.replace(/\s+/g, ' ').trim();
  // Если от названия осталась пустота («Стоя», «С гантелями»), основой
  // считаем название целиком — иначе такие записи слиплись бы в одну.
  return { base: base || normName(raw), specs };
};

/** Одно ли это упражнение: основа совпала и уточнения не расходятся. */
const sameExercise = (a: ParsedName, b: ParsedName) => {
  if (a.base !== b.base) return false;
  for (const axis of Object.keys(SPEC_AXES)) {
    const p = a.specs[axis];
    const q = b.specs[axis];
    if (p && q && !p.some((v) => q.includes(v))) return false;
  }
  return true;
};

/**
 * По скольким осям уточнения названы одинаково.
 *
 * Нужно, когда на старую запись без уточнения претендуют два упражнения:
 * «Вертикальная тяга к груди» ближе к «…к груди широким хватом» (совпала
 * ось «к груди»), чем к «Вертикальная тяга обратным хватом» (не совпало
 * ничего). Это не догадка о технике, а то, что написано в названиях.
 */
const specOverlap = (a: ParsedName, b: ParsedName) => {
  let n = 0;
  for (const axis of Object.keys(SPEC_AXES)) {
    const p = a.specs[axis];
    const q = b.specs[axis];
    if (p && q && p.some((v) => q.includes(v))) n++;
  }
  return n;
};

// Translations
const translations = {
  ru: {
    // Navigation
    workout: 'Тренировка',
    food: 'Еда',
    gains: 'Замеры',
    statistics: 'Статистика',
    settings: 'Настройки',
    profile: 'Профиль',

    // Header
    syncing: 'Сохранение...',
    synced: 'Синхронизировано',
    offline: 'Оффлайн',
    today: 'Сегодня',
    yesterday: 'Вчера',
    date: 'Дата',

    // Workout view
    steps: 'Шаги',
    offDay: 'День отдыха',
    cancel: 'Отмена',
    cancelOffDay: 'Отменить',
    progress: 'Прогресс',
    closeDay: 'Закрыть день',
    dayCompleted: 'День закрыт',
    exercises: 'упражнений',
    rest: 'Отдых',
    note: 'Заметка',
    done: 'Готово',
    feedback: 'Обратная связь',

    // Nutrition view
    goal: 'Цель:',
    protein: 'Б',
    fat: 'Ж',
    carbs: 'У',
    kcal: 'ккал',
    meals: 'Приёмы пищи',
    addMeal: 'Добавить',
    noMeals: 'Пока нет приёмов пищи',
    addFirstMeal: 'Добавьте первый приём!',
    mealName: 'Название',
    time: 'Время',

    // Meal modal
    addMealTitle: 'Добавить приём пищи',
    editMealTitle: 'Редактировать',
    mealPlaceholder: 'Творог с вареньем',

    // GAINS
    trackProgress: 'Отслеживай свой прогресс',
    addMeasurements: 'Добавить замеры',
    noMeasurements: 'Пока нет замеров',
    addFirst: 'Добавь первый замер!',
    weight: 'Вес (кг)',
    waist: 'талия',
    chest: 'грудь',
    biceps: 'бицепс',
    bicepsLeft: 'бицепс Л',
    bicepsRight: 'бицепс П',
    thighs: 'бедра',
    hips: 'ягодицы',
    favoriteMeals: 'Любимые блюда',
    favoriteMealsHint: 'Нажмите ❤️ на блюде чтобы добавить в избранное',

    // Profile/Settings
    language: 'Язык',
    timezone: 'Часовой пояс',
    signOut: 'Выйти',
    signOutConfirm: 'Выйти из аккаунта?',

    // Measurements modal
    newMeasurements: 'Новые замеры',
    waistCm: 'Талия (см)',
    chestCm: 'Грудь (см)',
    bicepsCm: 'Бицепс (см)',
    bicepsLeftCm: 'Бицепс Л (см)',
    bicepsRightCm: 'Бицепс П (см)',
    thighsCm: 'Бедра (см)',
    hipsCm: 'Ягодицы (см)',
    save: 'Сохранить',
    edit: 'Изменить',
    editMeasurements: 'Редактировать замер',
    deleteMeasurementConfirm: 'Удалить замер?',

    // Workout editor
    editWorkout: 'Редактирование упражнений',
    addExercise: 'Добавить упражнение',
    editExercise: 'Редактировать упражнение',
    exerciseName: 'Название упражнения',
    sets: 'Подходы',
    setsPlaceholder: '3x12',
    restTime: 'Отдых',
    restTimePlaceholder: '2-3 мин',
    lastTimeCol: 'В прошлый раз',
    notes: 'Заметки (опционально)',
    add: 'Добавить',
    delete: 'Удалить',
    deleteWorkout: 'Удалить тренировку',

    // Calendar
    weekdays: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
    months: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],

    // Additional
    reopenDay: 'Открыть день',
    russian: 'Русский',
    english: 'English',
    measurementNotes: 'Заметки',
    measurementNotesPlaceholder: 'Как себя чувствуешь?',
  },
  en: {
    // Navigation
    workout: 'Train',
    food: 'Food',
    gains: 'GAINS',
    statistics: 'Statistics',
    settings: 'Settings',
    profile: 'Profile',

    // Header
    syncing: 'Saving...',
    synced: 'Synced',
    offline: 'Offline',
    today: 'Today',
    yesterday: 'Yesterday',
    date: 'Date',

    // Workout view
    steps: 'Steps',
    offDay: 'Rest Day',
    cancel: 'Cancel',
    cancelOffDay: 'Cancel',
    progress: 'Progress',
    closeDay: 'Close Day',
    dayCompleted: 'Day Closed',
    exercises: 'exercises',
    rest: 'Rest',
    note: 'Note',
    done: 'Done',
    feedback: 'Feedback',

    // Nutrition view
    goal: 'Goal:',
    protein: 'P',
    fat: 'F',
    carbs: 'C',
    kcal: 'kcal',
    meals: 'Meals',
    addMeal: 'Add',
    noMeals: 'No meals yet',
    addFirstMeal: 'Add your first meal!',
    mealName: 'Name',
    time: 'Time',

    // Meal modal
    addMealTitle: 'Add Meal',
    editMealTitle: 'Edit Meal',
    mealPlaceholder: 'Chicken and rice',

    // GAINS
    trackProgress: 'Track your progress',
    addMeasurements: 'Add Measurements',
    noMeasurements: 'No measurements yet',
    addFirst: 'Add your first measurement!',
    weight: 'Weight (kg)',
    waist: 'waist',
    chest: 'chest',
    biceps: 'biceps',
    bicepsLeft: 'biceps L',
    bicepsRight: 'biceps R',
    thighs: 'thighs',
    hips: 'hips',
    favoriteMeals: 'Favorite Meals',
    favoriteMealsHint: 'Tap ❤️ on a meal to add to favorites',

    // Profile/Settings
    language: 'Language',
    timezone: 'Timezone',
    signOut: 'Sign Out',
    signOutConfirm: 'Sign out?',

    // Measurements modal
    newMeasurements: 'New Measurements',
    waistCm: 'Waist (cm)',
    chestCm: 'Chest (cm)',
    bicepsCm: 'Biceps (cm)',
    bicepsLeftCm: 'Biceps L (cm)',
    bicepsRightCm: 'Biceps R (cm)',
    thighsCm: 'Thighs (cm)',
    hipsCm: 'Hips (cm)',
    save: 'Save',
    edit: 'Edit',
    editMeasurements: 'Edit Measurement',
    deleteMeasurementConfirm: 'Delete measurement?',

    // Workout editor
    editWorkout: 'Edit Exercises',
    addExercise: 'Add Exercise',
    editExercise: 'Edit Exercise',
    exerciseName: 'Exercise name',
    sets: 'Sets',
    setsPlaceholder: '3x12',
    restTime: 'Rest',
    restTimePlaceholder: '2-3 min',
    lastTimeCol: 'Last time',
    notes: 'Notes (optional)',
    add: 'Add',
    delete: 'Delete',
    deleteWorkout: 'Delete Workout',

    // Calendar
    weekdays: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],

    // Additional
    reopenDay: 'Reopen Day',
    russian: 'Русский',
    english: 'English',
    measurementNotes: 'Notes',
    measurementNotesPlaceholder: 'How do you feel?',
  }
} as const;

type TranslationKey = keyof typeof translations.ru;

// Default workout templates
const DEFAULT_WORKOUTS: Workout[] = [
  {
    id: 't1',
    name: 'Тренировка 1',
    exercises: [
      { id: '1', name: 'Скручивания лежа', plannedSets: '3x30', actualSets: '', restTime: '1-2 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '2', name: 'Румынская тяга со штангой', plannedSets: '40-50кг 3x10-12', actualSets: '', restTime: '3 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '3', name: 'Вертикальная тяга к груди', plannedSets: '50-60 3x12', actualSets: '', restTime: '2-3 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '4', name: 'Отведения с гантелями сидя', plannedSets: '10-12 кг 3x15-20', actualSets: '', restTime: '2 мин', notes: 'средняя дельта', newWeight: '', feedback: '', completed: false },
      { id: '5', name: 'Горизонтальная тяга блока', plannedSets: '50-60 3x12', actualSets: '', restTime: '2-3 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '6', name: 'Подъем штанги на бицепс стоя', plannedSets: '25 кгм 5x12-15', actualSets: '', restTime: '2 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '7', name: 'Отведения с гантелями в наклоне', plannedSets: '8-10кг 3x15-20', actualSets: '', restTime: '2 мин', notes: 'задняя дельта', newWeight: '', feedback: '', completed: false },
    ]
  },
  {
    id: 't2',
    name: 'Тренировка 2',
    exercises: [
      { id: '1', name: 'Подъем ног в висе', plannedSets: '3x15-20', actualSets: '', restTime: '1-2 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '2', name: 'Жим ногами', plannedSets: '3x12-15', actualSets: '', restTime: '3-4 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '3', name: 'Жим гантелей на наклонной скамье 30°', plannedSets: '3x12', actualSets: '', restTime: '2-3мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '4', name: 'Горизонтальный жим в тренажере', plannedSets: '3x12', actualSets: '', restTime: '2-3 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '5', name: 'Отжимания на брусьях', plannedSets: '3xмакс', actualSets: '', restTime: '2-3 мин', notes: 'руки забиты после предыдущих упр', newWeight: '', feedback: '', completed: false },
      { id: '6', name: 'Разгибания на трицепс в блоке', plannedSets: '3x12-15', actualSets: '', restTime: '2 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '7', name: 'Подъем штанги перед собой стоя', plannedSets: '3x15', actualSets: '', restTime: '2 мин', notes: 'передняя дельта', newWeight: '', feedback: '', completed: false },
    ]
  },
  {
    id: 't3',
    name: 'Тренировка 3',
    exercises: [
      { id: '1', name: 'Боковая планка в динамике', plannedSets: '3x10-15', actualSets: '', restTime: '1 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '2', name: 'Ягодичный мост', plannedSets: '3x12-15', actualSets: '', restTime: '3 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '3', name: 'Тяга штанги в наклоне', plannedSets: '3x10-12', actualSets: '', restTime: '3 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '4', name: 'Пуловер в блоке', plannedSets: '3x12', actualSets: '', restTime: '2-3 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '5', name: 'Протяжка со штангой', plannedSets: '3x12-15', actualSets: '', restTime: '2-3 мин', notes: 'средняя дельта', newWeight: '', feedback: '', completed: false },
      { id: '6', name: 'Подъем гантелей на бицепс поочередно', plannedSets: '5x12-15', actualSets: '', restTime: '2 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '7', name: 'Отведения с гантелями в наклоне', plannedSets: '3x12', actualSets: '', restTime: '2 мин', notes: 'задняя дельта', newWeight: '', feedback: '', completed: false },
    ]
  },
  {
    id: 't4',
    name: 'Тренировка 4',
    exercises: [
      { id: '1', name: 'Перекрестные скручивания', plannedSets: '3x50', actualSets: '', restTime: '1-2 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '2', name: 'Болгарский сплит присед', plannedSets: '3x12', actualSets: '', restTime: '3 мин', notes: 'ВИДЕО ОБЯЗАТЕЛЬНО', newWeight: '', feedback: '', completed: false },
      { id: '3', name: 'Жим на наклонной скамье или в смите', plannedSets: '3x12', actualSets: '', restTime: '3 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '4', name: 'Сведение в кроссовере или бабочка', plannedSets: '3x12', actualSets: '', restTime: '2-3 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '5', name: 'Вертикальный жим сидя с гантелями или в тренажере', plannedSets: '3x12-15', actualSets: '', restTime: '2-3 мин', notes: 'передняя дельта', newWeight: '', feedback: '', completed: false },
      { id: '6', name: 'Французский жим', plannedSets: '3x12-15', actualSets: '', restTime: '2-3 мин', notes: '', newWeight: '', feedback: '', completed: false },
      { id: '7', name: 'Разгибание гантели из-за головы по одной руке', plannedSets: '3-12', actualSets: '', restTime: '2 мин', notes: '', newWeight: '', feedback: '', completed: false },
    ]
  },
  {
    id: 't5',
    name: 'Тренировка 5',
    exercises: []
  },
  {
    id: 't6',
    name: 'Тренировка 6',
    exercises: []
  },
  {
    id: 't7',
    name: 'Тренировка 7',
    exercises: []
  }
];

// App-wide fallback used when the user hasn't set their own daily goal.
// Inside FitnessPage we shadow this with `MACRO_TARGETS` derived from
// userSettings.goal, so every reference to MACRO_TARGETS below the
// component boundary automatically picks up per-user values.
const MACRO_TARGETS_FALLBACK = {
  protein: 200,
  fat: 90,
  carbs: 200,
  calories: 2410
};

// Food products by category
interface FoodProduct {
  id: string;
  name: string;
  category: 'protein' | 'carbs' | 'vegetables' | 'dairy' | 'fats' | 'fruits';
}

const DEFAULT_FOOD_PRODUCTS: FoodProduct[] = [
  // БЕЛОК
  { id: 'p1', name: 'Куриная грудка', category: 'protein' },
  { id: 'p2', name: 'Куриные бёдра без кожи', category: 'protein' },
  { id: 'p3', name: 'Индейка', category: 'protein' },
  { id: 'p4', name: 'Крольчатина', category: 'protein' },
  { id: 'p5', name: 'Телятина постная', category: 'protein' },
  { id: 'p6', name: 'Говядина постная (5–10% жира)', category: 'protein' },
  { id: 'p7', name: 'Филе утки без кожи', category: 'protein' },
  { id: 'p8', name: 'Хек', category: 'protein' },
  { id: 'p9', name: 'Треска', category: 'protein' },
  { id: 'p10', name: 'Минтай', category: 'protein' },
  { id: 'p11', name: 'Палтус', category: 'protein' },
  { id: 'p12', name: 'Тунец (в воде)', category: 'protein' },
  { id: 'p13', name: 'Креветки', category: 'protein' },
  { id: 'p14', name: 'Гребешки', category: 'protein' },
  // УГЛЕВОДЫ
  { id: 'c1', name: 'Белый рис', category: 'carbs' },
  { id: 'c2', name: 'Жасмин / басмати', category: 'carbs' },
  { id: 'c3', name: 'Cream of rice', category: 'carbs' },
  { id: 'c4', name: 'Картофель отварной / запечённый', category: 'carbs' },
  { id: 'c5', name: 'Рисовые хлебцы', category: 'carbs' },
  { id: 'c6', name: 'Рисовая лапша', category: 'carbs' },
  // ОВОЩИ
  { id: 'v1', name: 'Огурцы', category: 'vegetables' },
  { id: 'v2', name: 'Кабачки', category: 'vegetables' },
  { id: 'v3', name: 'Цукини', category: 'vegetables' },
  { id: 'v4', name: 'Шпинат', category: 'vegetables' },
  { id: 'v5', name: 'Салат ромэн', category: 'vegetables' },
  { id: 'v6', name: 'Айсберг', category: 'vegetables' },
  { id: 'v7', name: 'Морковь (немного)', category: 'vegetables' },
  // МОЛОЧНОЕ
  { id: 'd1', name: 'Творог 0–0.5% (150–200 г)', category: 'dairy' },
  { id: 'd2', name: 'Whey isolate', category: 'dairy' },
  { id: 'd3', name: 'Casein (если переносится)', category: 'dairy' },
  // ЖИРЫ
  { id: 'f1', name: 'Оливковое масло', category: 'fats' },
  { id: 'f2', name: 'Авокадо', category: 'fats' },
  { id: 'f3', name: 'Рыбий жир', category: 'fats' },
  // ФРУКТЫ
  { id: 'fr1', name: 'Черника', category: 'fruits' },
  { id: 'fr2', name: 'Клубника', category: 'fruits' },
  { id: 'fr3', name: 'Малина', category: 'fruits' },
];

const FOOD_CATEGORIES = {
  protein: { name: 'Белок', color: 'var(--red)', bg: 'var(--red-dim)' },
  carbs: { name: 'Углеводы', color: 'var(--yellow)', bg: 'var(--yellow-dim)' },
  vegetables: { name: 'Овощи', color: 'var(--green)', bg: 'var(--green-dim)' },
  dairy: { name: 'Молочное', color: 'var(--blue)', bg: 'var(--blue-dim)' },
  fats: { name: 'Жиры', color: 'var(--orange)', bg: 'rgba(255, 159, 67, 0.12)' },
  fruits: { name: 'Фрукты', color: 'var(--purple)', bg: 'var(--purple-dim)' },
};

function formatDate(date: Date): string {
  // Use local date, not UTC (toISOString converts to UTC which can shift the date)
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get current date in specified timezone
function getTodayInTimezone(timezone: string): Date {
  const now = new Date();
  // Get the date string in the target timezone
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA gives YYYY-MM-DD format
  // Parse as local date (midnight)
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Format date in specific timezone for display
function formatDateInTimezone(date: Date, timezone: string): string {
  return date.toLocaleDateString('en-CA', { timeZone: timezone });
}

function getDateLabel(date: Date, todayDateStr: string): string {
  const dateStr = formatDate(date);

  // Compare as strings to avoid UTC parsing issues
  if (dateStr === todayDateStr) return 'Сегодня';

  // Calculate yesterday/tomorrow from todayDateStr using local date parts
  const [y, m, d] = todayDateStr.split('-').map(Number);
  const todayLocal = new Date(y, m - 1, d);
  const yesterdayLocal = new Date(y, m - 1, d - 1);
  const tomorrowLocal = new Date(y, m - 1, d + 1);

  if (dateStr === formatDate(yesterdayLocal)) return 'Вчера';
  if (dateStr === formatDate(tomorrowLocal)) return 'Завтра';
  return date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Просмотр фото упражнения: щипком увеличить, двумя пальцами подвинуть.
 *
 * Раньше жесты были запрещены намеренно (touchAction: none, preventDefault
 * на touchmove, pointerEvents: none на картинке) — чтобы случайный свайп
 * не прокручивал страницу под модалкой. Но вместе с этим пропала и
 * возможность разглядеть технику на схеме, а заменить фото можно было
 * только долгим нажатием на карточке, которое его УДАЛЯЕТ, и об этом
 * нигде не написано.
 */
function ImageViewer({ url, name, onClose, onReplace, onDelete }: {
  url: string;
  name: string;
  onClose: () => void;
  onReplace: () => void;
  onDelete: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  // Идёт ли жест — состоянием, а не ref: во время щипка анимацию
  // перехода надо выключать, а ref читать в рендере нельзя.
  const [dragging, setDragging] = useState(false);
  // Расстояние между пальцами и смещение на начало жеста.
  const gesture = useRef<{ dist: number; scale: number; x: number; y: number; tx: number; ty: number } | null>(null);
  const MIN = 1, MAX = 5;

  const reset = () => { setScale(1); setTx(0); setTy(0); };

  const dist = (t: React.TouchList) =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t: React.TouchList) => ({
    x: (t[0].clientX + t[1].clientX) / 2,
    y: (t[0].clientY + t[1].clientY) / 2,
  });

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const m = mid(e.touches);
      gesture.current = { dist: dist(e.touches), scale, x: m.x, y: m.y, tx, ty };
      setDragging(true);
    } else if (e.touches.length === 1 && scale > 1) {
      // Одним пальцем двигаем только когда уже приблизили — иначе
      // перехватывали бы обычный тап по фону.
      gesture.current = { dist: 0, scale, x: e.touches[0].clientX, y: e.touches[0].clientY, tx, ty };
      setDragging(true);
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (e.touches.length === 2 && g.dist > 0) {
      e.preventDefault();
      const next = Math.max(MIN, Math.min(MAX, g.scale * (dist(e.touches) / g.dist)));
      const m = mid(e.touches);
      setScale(next);
      setTx(g.tx + (m.x - g.x));
      setTy(g.ty + (m.y - g.y));
    } else if (e.touches.length === 1 && scale > 1) {
      e.preventDefault();
      setTx(g.tx + (e.touches[0].clientX - g.x));
      setTy(g.ty + (e.touches[0].clientY - g.y));
    }
  };

  const onTouchEnd = () => {
    gesture.current = null;
    setDragging(false);
    // Отпустили около единицы — возвращаем ровно 1, чтобы картинка не
    // застревала чуть сдвинутой.
    if (scale <= 1.05) reset();
  };

  return (
    <div
      onClick={() => { if (scale === 1) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: '56px 16px 92px', overflow: 'hidden',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={() => (scale === 1 ? setScale(2.5) : reset())}
        style={{
          position: 'relative', maxWidth: '460px', width: '100%',
          touchAction: 'none',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          draggable={false}
          style={{
            width: '100%', borderRadius: '12px', objectFit: 'contain',
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: 'center center',
            transition: dragging ? 'none' : 'transform 0.18s ease',
            userSelect: 'none', pointerEvents: 'none',
          }}
        />
        <div style={{ textAlign: 'center', marginTop: '10px', color: 'rgba(255,255,255,0.75)', fontSize: '13px', fontWeight: 600 }}>
          {name}
          {scale > 1 && <span style={{ marginLeft: 8, fontWeight: 500 }}>{scale.toFixed(1)}×</span>}
        </div>
      </div>

      {/* Крестик — в углу экрана, а не у картинки: при увеличении
          картинка выходит за свои границы и перекрывала бы его. */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Закрыть"
        style={{
          position: 'fixed', top: '14px', right: '14px',
          width: '36px', height: '36px', borderRadius: '50%',
          background: 'rgba(255,255,255,0.14)', border: 'none', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}
      ><X size={18} /></button>

      {/* Масштаб кнопками: щипок есть не везде (мышь на десктопе). */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', top: '14px', left: '14px', display: 'flex', gap: '6px',
        }}
      >
        <button
          onClick={() => setScale(s => Math.max(MIN, +(s - 0.5).toFixed(2)))}
          aria-label="Уменьшить"
          style={viewerBtn}
        >−</button>
        <button
          onClick={() => setScale(s => Math.min(MAX, +(s + 0.5).toFixed(2)))}
          aria-label="Увеличить"
          style={viewerBtn}
        >+</button>
        {scale !== 1 && (
          <button onClick={reset} aria-label="Сбросить масштаб" style={{ ...viewerBtn, width: 'auto', padding: '0 12px', fontSize: '12px' }}>
            1:1
          </button>
        )}
      </div>

      {/* Заменить и удалить — внизу, где их ищут. Раньше заменить было
          нельзя вовсе, а удаление пряталось в долгом нажатии. */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 'calc(20px + env(safe-area-inset-bottom))',
          display: 'flex', justifyContent: 'center', gap: '10px', padding: '0 16px',
        }}
      >
        <button onClick={onReplace} style={viewerAction}>
          <ImageIcon size={14} /> Заменить фото
        </button>
        <button onClick={onDelete} style={{ ...viewerAction, color: '#ff8a80' }}>
          <X size={14} /> Удалить
        </button>
      </div>
    </div>
  );
}

const viewerBtn: React.CSSProperties = {
  width: '36px', height: '36px', borderRadius: '50%',
  background: 'rgba(255,255,255,0.14)', border: 'none', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', fontSize: '18px', fontWeight: 600, fontFamily: 'inherit',
  lineHeight: 1,
};

const viewerAction: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  height: '40px', padding: '0 16px', borderRadius: '20px',
  background: 'rgba(255,255,255,0.14)', border: 'none', color: '#fff',
  fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
};

/** Подписи техник: как называется в интерфейсе и как подписаны ступени. */
const TECH_META: Record<SetTechnique, { label: string; step: string; hint: string }> = {
  drop: {
    label: 'дропсет',
    step: 'сброс',
    hint: 'Сбрось вес и продолжай без отдыха',
  },
  restPause: {
    label: 'rest-pause',
    step: 'подход',
    hint: 'Вес тот же, между блоками пауза 10-20 сек',
  },
  cluster: {
    label: 'кластер',
    step: 'блок',
    hint: 'Подход разбит на блоки с паузами 10-15 сек',
  },
};

/**
 * Техники внутри подхода: отметки и ступени.
 *
 * Раньше это была тесная строка чипов, где «вес × повторы» шли подряд
 * без подписей — непонятно, что это одна ступень сброса, а не ещё один
 * подход. Теперь ступени идут списком с номерами и подписями, а вес
 * следующей ступени подставляется сам.
 */
function SetTechPanel({
  set, setNo, planned, onToggleFailure, onToggleNegative, onSetNegative,
  onAddStep, onUpdateStep, onRemoveStep,
}: {
  set: ExerciseSet;
  /** Номер подхода — строка висит под таблицей и без него «ничья». */
  setNo: number;
  /** Техника, запланированная программой на этот подход. */
  planned?: SetTechnique;
  onToggleFailure: () => void;
  onToggleNegative: () => void;
  onSetNegative: (sec: number) => void;
  onAddStep: (tech: SetTechnique) => void;
  onUpdateStep: (di: number, patch: Partial<DropStep>) => void;
  onRemoveStep: (di: number) => void;
}) {
  // Редкие техники прячем, пока не попросят: пять кнопок подряд
  // переносились на три строки и выглядели как список «на весь экран».
  const [more, setMore] = useState(false);
  const steps = set.drops ?? [];
  const tech: SetTechnique = set.tech ?? planned ?? 'drop';
  const meta = TECH_META[tech];
  // Итог по подходу: сколько всего повторов с учётом ступеней. В зале
  // это единственное число, которое хочется видеть сразу.
  const totalReps = (set.reps || 0) + steps.reduce((s, d) => s + (d.reps || 0), 0);

  // Что уже отмечено на подходе — одной строкой.
  const marks: string[] = [];
  if (set.toFailure) marks.push('до отказа');
  if (steps.length > 0) marks.push(`${meta.label} ${steps.length}`);
  if (set.negativeSec) marks.push(`негатив ${set.negativeSec} сек`);

  return (
    <div className="tx-techwrap">
      {/* Вместо россыпи пилюль — одна строка: что отмечено и ссылка
          «Техника». Пилюли занимали две-три строки под каждым подходом
          и спорили с самой таблицей за внимание. */}
      <button
        type="button"
        className={['tx-techline', marks.length ? 'is-on' : ''].filter(Boolean).join(' ')}
        onClick={() => setMore(v => !v)}
        aria-expanded={more}
      >
        {marks.length > 0 ? (
          <>
            <Flame size={11} />
            <span>{marks.join(' · ')}</span>
          </>
        ) : (
          /* Номер подхода в самой строке: без него она висела под
             таблицей и читалась как подпись ко всему упражнению, а не
             к последнему подходу — непонятно, что именно отмечать. */
          <span className="tx-techadd">
            + техника для подхода {setNo}
          </span>
        )}
        <ChevronsDown size={11} className={more ? 'is-flip' : ''} />
      </button>

      {more && (
        <div className="tx-techmenu">
          <button
            type="button"
            className={['tx-techitem', set.toFailure ? 'is-on' : ''].filter(Boolean).join(' ')}
            onClick={onToggleFailure}
          >
            <Flame size={13} />
            <span><b>До отказа</b><i>последнее повторение на пределе</i></span>
            {set.toFailure && <Check size={13} strokeWidth={3} />}
          </button>
          <button
            type="button"
            className={['tx-techitem', set.negativeSec ? 'is-on' : ''].filter(Boolean).join(' ')}
            onClick={onToggleNegative}
          >
            <Hourglass size={13} />
            <span><b>Негатив</b><i>медленное опускание</i></span>
            {!!set.negativeSec && <Check size={13} strokeWidth={3} />}
          </button>
          {/* Техника со ступенями — одна на подход: пока ступени
              записаны, менять её значило бы переписать смысл. */}
          {(['drop', 'restPause', 'cluster'] as SetTechnique[]).map(k => {
            const active = steps.length > 0 && tech === k;
            const locked = steps.length > 0 && tech !== k;
            return (
              <button
                key={k}
                type="button"
                className={['tx-techitem', active ? 'is-on' : '', locked ? 'is-off' : ''].filter(Boolean).join(' ')}
                disabled={locked}
                onClick={() => { onAddStep(k); setMore(false); }}
              >
                <ChevronsDown size={13} />
                <span>
                  <b>{TECH_META[k].label[0].toUpperCase() + TECH_META[k].label.slice(1)}</b>
                  <i>{TECH_META[k].hint}</i>
                </span>
                {active && <Check size={13} strokeWidth={3} />}
              </button>
            );
          })}
        </div>
      )}

      {/* Негативы: свойство подхода, а не ступень — отдельной строкой. */}
      {!!set.negativeSec && (
        <div className="tx-negrow">
          <Hourglass size={11} />
          <span>опускание</span>
          <input
            type="number"
            inputMode="numeric"
            value={set.negativeSec}
            onChange={(e) => onSetNegative(Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 1)))}
            aria-label="секунд на опускание"
          />
          <span>сек</span>
        </div>
      )}

      {steps.length > 0 && (
        <div className="tx-steps">
          <div className="tx-steprow is-base">
            <span className="tx-stepname">основной</span>
            <span className="tx-stepval">{set.reps || 0} × {set.weight || 0}</span>
            <span />
          </div>
          {steps.map((d, di) => (
            <div className="tx-steprow" key={di}>
              <span className="tx-stepname">
                <ChevronsDown size={10} /> {meta.step} {di + 1}
              </span>
              <span className="tx-stepinputs">
                <input
                  type="number"
                  inputMode="numeric"
                  value={d.reps || ''}
                  placeholder="повт"
                  onChange={(e) => onUpdateStep(di, { reps: parseInt(e.target.value, 10) || 0 })}
                  aria-label={`повторы, ${meta.step} ${di + 1}`}
                />
                <b>×</b>
                <input
                  type="number"
                  inputMode="numeric"
                  value={d.weight || ''}
                  placeholder="вес"
                  onChange={(e) => onUpdateStep(di, { weight: parseInt(e.target.value, 10) || 0 })}
                  aria-label={`вес, ${meta.step} ${di + 1}`}
                />
              </span>
              <button
                type="button"
                className="tx-stepdel"
                onClick={() => onRemoveStep(di)}
                aria-label={`убрать ${meta.step} ${di + 1}`}
              >×</button>
            </div>
          ))}
          <div className="tx-steprow is-foot">
            <button type="button" className="tx-stepadd" onClick={() => onAddStep(tech)}>
              + ещё {meta.step}
            </button>
            <span className="tx-steptotal">итого {totalReps} повт</span>
            <span />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Суперсет кругами: как его реально делают.
 *
 * A1 → сразу A2 → отдых → следующий круг. Раньше связка была только
 * визуальной рамкой вокруг двух обычных карточек: отмечать приходилось
 * в каждой отдельно, и порядок работы из интерфейса не читался.
 *
 * Здесь один круг — одна строка со всеми упражнениями связки, отдых
 * один на круг, а не на каждое упражнение.
 */
function SupersetRounds({ group, rounds, onUpdateSet, restTime, restSignal, onRest }: {
  group: Exercise[];
  rounds: number;
  onUpdateSet: (exId: string, setIdx: number, patch: Partial<ExerciseSet>) => void;
  restTime: string;
  restSignal: number;
  onRest: () => void;
}) {
  const setsOf = (e: Exercise) => e.sets ?? makeInitialSets(e.plannedSets);
  // Круг пройден, когда отмечены подходы этого круга во ВСЕХ упражнениях.
  const roundDone = (r: number) => group.every(e => setsOf(e)[r]?.completed);
  const currentRound = Array.from({ length: rounds }, (_, r) => r).find(r => !roundDone(r));

  return (
    <div className="tx-rounds">
      {Array.from({ length: rounds }, (_, r) => {
        const done = roundDone(r);
        const isCurrent = r === currentRound;
        return (
          <div
            key={r}
            className={['tx-round', done ? 'is-done' : '', isCurrent ? 'is-current' : ''].filter(Boolean).join(' ')}
          >
            <div className="tx-roundhead">
              <span>круг {r + 1}</span>
              {done && <Check size={11} strokeWidth={3} />}
            </div>
            {group.map((e, gi) => {
              const sets = setsOf(e);
              const s = sets[r];
              if (!s) return null;
              return (
                <div className="tx-roundex" key={e.id}>
                  <span className="tx-roundname">
                    <b>{e.supersetId}{gi + 1}</b> {e.name}
                  </span>
                  <span className="tx-roundinputs">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={s.reps || ''}
                      placeholder="повт"
                      onChange={(ev) => onUpdateSet(e.id, r, { reps: parseInt(ev.target.value, 10) || 0 })}
                      aria-label={`повторы, ${e.name}, круг ${r + 1}`}
                    />
                    <b>×</b>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={s.weight || ''}
                      placeholder="вес"
                      onChange={(ev) => onUpdateSet(e.id, r, { weight: parseInt(ev.target.value, 10) || 0 })}
                      aria-label={`вес, ${e.name}, круг ${r + 1}`}
                    />
                    <button
                      type="button"
                      className={['tx-check', s.completed ? 'is-on' : ''].filter(Boolean).join(' ')}
                      onClick={() => {
                        const next = !s.completed;
                        onUpdateSet(e.id, r, { completed: next });
                        // Отметили ПОСЛЕДНЕЕ упражнение круга — круг
                        // закрыт, запускаем отдых сами: в зале руки
                        // заняты, лишнее нажатие ни к чему.
                        if (next && gi === group.length - 1
                          && group.slice(0, -1).every(o => setsOf(o)[r]?.completed)) {
                          onRest();
                        }
                      }}
                      aria-label={`отметить ${e.name}, круг ${r + 1}`}
                    >
                      <Check size={15} strokeWidth={s.completed ? 3 : 2} />
                    </button>
                  </span>
                  {/* Между упражнениями связки отдыха нет — говорим об
                      этом там, где человек смотрит: между строками. */}
                  {gi < group.length - 1 && (
                    <span className="tx-roundgap">↓ без отдыха</span>
                  )}
                </div>
              );
            })}
            {/* Отдых один на круг, а не после каждого упражнения —
                в этом и смысл связки. Таймер показываем только у
                текущего круга, чтобы не было трёх таймеров подряд. */}
            {isCurrent ? (
              <div className="tx-roundrestwrap">
                <RestTimer restTime={restTime} startSignal={restSignal} idleLabel="Отдых после круга" />
              </div>
            ) : (
              <div className="tx-roundfoot">
                <Timer size={10} />
                <span>отдых после круга</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Beautiful Exercise Card Component
function ExerciseCard({ ex, idx, onToggle, onUpdate, progressHistory, weightHistory, lastSets, exerciseLibrary, onImageSaved, dayClosed, onShowImage, expanded: expandedProp, onToggleExpand, muscleLabel, lastLabel, supersetPos, supersetGroup, onRestDone, isLastPending }: {
  ex: Exercise;
  idx: number;
  /** Отдых после закрытого упражнения истёк — родитель откроет следующее. */
  onRestDone?: () => void;
  /**
   * Не осталось невыполненных упражнений в тренировке.
   *
   * Тогда отдых не запускаем: отдыхать не от чего, а таймер после
   * последнего упражнения продолжал тикать и выглядел как «приложение
   * чего-то ждёт».
   */
  isLastPending?: boolean;
  onToggle: () => void;
  onUpdate: (updates: Partial<Exercise>) => void;
  progressHistory: ExerciseProgress[];
  // Динамика рабочего веса этого упражнения по датам (макс. вес за тренировку).
  // Строится из реальных подходов во всех днях — для мини-графика в карточке.
  weightHistory?: { date: string; weight: number }[];
  // Per-set values from the most recent prior session of this same workout —
  // shown in a "Last" column so the user can target/beat the previous lift.
  lastSets?: ExerciseSet[];
  exerciseLibrary?: Record<string, string>;
  onImageSaved?: (name: string, imageUrl: string) => void;
  dayClosed?: boolean;
  onShowImage?: (imageUrl: string, name: string) => void;
  // Controlled expand state — when the parent passes these, only one card
  // can be open at a time across the list.
  expanded?: boolean;
  onToggleExpand?: () => void;
  // ИИ-определённая группа мышц (показывается под названием упражнения)
  muscleLabel?: string;
  // Подпись колонки истории («В прошлый раз») — приходит из переводов
  // родителя: внутри карточки функции t() нет.
  lastLabel?: string;
  /**
   * Место упражнения в суперсете. 'inner' — за ним сразу идёт парное,
   * поэтому отдых после подхода НЕ запускаем; 'last' — связка закончена,
   * отдых обычный. Обычное упражнение — undefined.
   */
  supersetPos?: 'inner' | 'last';
  /** Названия всех упражнений связки по порядку — для подсказки. */
  supersetGroup?: string[];
}) {
  const [expandedLocal, setExpandedLocal] = useState(false);
  const controlled = typeof expandedProp === 'boolean' && !!onToggleExpand;
  const expanded = controlled ? !!expandedProp : expandedLocal;
  const setExpanded = (next: boolean | ((prev: boolean) => boolean)) => {
    if (controlled) {
      // In controlled mode the parent owns state — a toggle call collapses
      // whatever is open and opens this one. We ignore the `next` value.
      onToggleExpand!();
    } else {
      setExpandedLocal(next as boolean);
    }
  };
  // Сигналы таймеру отдыха: галочка подхода запускает, последний подход
  // и «Отметить все» останавливают. Счётчики, а не булевы — два подряд
  // отмеченных подхода должны перезапускать отдых заново.
  const [restStart, setRestStart] = useState(0);
  const [restStop, setRestStop] = useState(0);
  // Сводка по подходам: счётчик «2/3» в шапке и строка результата,
  // которую макет показывает у свёрнутой карточки.
  const summarySets: ExerciseSet[] = ex.sets ?? makeInitialSets(ex.plannedSets);
  const setsTotal = summarySets.length;
  const setsDone = summarySets.filter(st => st.completed).length;
  const bestSet = summarySets
    .filter(st => st.completed && (st.reps > 0 || st.weight > 0))
    .reduce<ExerciseSet | null>((best, st) => (
      !best || st.weight > best.weight || (st.weight === best.weight && st.reps > best.reps) ? st : best
    ), null);
  const [showHistory, setShowHistory] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [videoUrlInput, setVideoUrlInput] = useState(ex.videoUrl || '');
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Auto-collapse when day closes
  useEffect(() => {
    if (dayClosed && !controlled) setExpandedLocal(false);
  }, [dayClosed, controlled]);

  // Auto-collapse the moment the exercise is fully done. The user just
  // ticked the last set — keeping the expanded flyout open is just noise,
  // and a freshly-completed card should visually compact straight away.
  //
  // В управляемом режиме этим занимается родитель: он же сразу раскрывает
  // следующее невыполненное упражнение. Дёргать onToggleExpand отсюда нельзя —
  // это закрыло бы только что открытую родителем следующую карточку.
  const prevCompletedRef = useRef(ex.completed);
  useEffect(() => {
    if (ex.completed && !prevCompletedRef.current && !controlled) {
      setExpandedLocal(false);
    }
    prevCompletedRef.current = ex.completed;
  }, [ex.completed, controlled]);


  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Compress to base64
    const canvas = document.createElement('canvas');
    const img = new Image();
    img.onload = () => {
      const maxSize = 1200;
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = (h / w) * maxSize; w = maxSize; }
        else { w = (w / h) * maxSize; h = maxSize; }
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      onUpdate({ imageUrl: dataUrl });
      // Save to exercise library
      if (onImageSaved) onImageSaved(ex.name.toLowerCase().trim(), dataUrl);
    };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  };

  return (
    <div
      className={`card-hover exercise-card tx-ex ${expanded ? 'is-open' : ''} ${ex.completed ? 'completed' : ''}`}
    >
      {/* Main row */}
      <div
        className="tx-exrow"
        style={{ cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Название + группа мышц (раскрытая) либо итог по подходам
            (свёрнутая) — как в макете. Порядкового номера нет. */}
        <div className="tx-exname" style={{ color: ex.completed ? 'var(--text-muted)' : 'var(--text-primary)' }}>
          {ex.name}
          {/* Внутри блока связки метку «Суперсет A» уже показывает рамка,
              поэтому здесь — только позиция в связке (A1, A2): по ней
              видно, с чего круг начинается и чем заканчивается. */}
          {ex.supersetId && supersetGroup && supersetGroup.length > 1 && (
            <span className="tx-superset" title="Порядок в связке">
              <Link2 size={9} />{ex.supersetId}{supersetGroup.indexOf(ex.name) + 1}
            </span>
          )}
          {/* Подпись под названием есть ВСЕГДА и одной высоты: раскрытая —
              группа мышц, свёрнутая — итог по подходам. Если её убирать,
              название прыгает по вертикали при раскрытии карточки. */}
          {expanded ? (
            <span className="muscle">{muscleLabel || '\u00A0'}</span>
          ) : (
            <span className={['tx-collapsed', setsTotal > 0 && setsDone === setsTotal ? 'is-complete' : ''].filter(Boolean).join(' ')}>
              {/* Вес показываем, только если он есть: у упражнений с весом
                  тела (планка, подъём ног, скручивания) ноль — это не
                  «забыл записать», а норма, и «0 lb × 22» читается как
                  ошибка. */}
              {setsDone}/{setsTotal} подхода{bestSet
                ? (bestSet.weight > 0 ? ` · ${bestSet.weight} lb × ${bestSet.reps}` : ` · ${bestSet.reps} повт`)
                : ' · ещё не начато'}
            </span>
          )}
        </div>

        {/* Фото упражнения — в шапке карточки между названием и счётчиком,
            как в макете. В свёрнутой карточке скрыто (CSS .tx-ex:not(.is-open)). */}
        <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
        {ex.imageUrl ? (
          <button
            type="button"
            className="tx-photo"
            onClick={(e) => { e.stopPropagation(); onShowImage?.(ex.imageUrl!, ex.name); }}
            /* Долгое нажатие больше не удаляет втихую: удалить и
               заменить можно в просмотрщике, где это подписано. */
            title={'Фото: ' + ex.name + ' — открыть, увеличить, заменить'}
            aria-label={'Фото: ' + ex.name + ' — открыть'}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ex.imageUrl} alt={ex.name} />
          </button>
        ) : (
          <button
            type="button"
            className="tx-photo is-empty"
            onClick={(e) => { e.stopPropagation(); imageInputRef.current?.click(); }}
            aria-label="Добавить фото"
          >
            <ImageIcon size={20} />
          </button>
        )}

        {/* Счётчик подходов */}
        <span className={['tx-excount', setsTotal > 0 && setsDone === setsTotal ? 'is-done' : ''].filter(Boolean).join(' ')}>
          {setsDone}/{setsTotal}
        </span>

        {/* Круглая галочка выполнения — справа */}
        <div
          className={['checkbox-animated', 'status-transition', 'tx-excheck', ex.completed ? 'is-on' : ''].filter(Boolean).join(' ')}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        >
          {ex.completed && <Check size={14} strokeWidth={3} />}
        </div>
      </div>

      {/* Таймер отдыха живёт ВЫШЕ ветвления «выполнено / не выполнено».
          Иначе на последнем подходе он размонтировался вместе с блоком
          подходов и монтировался заново уже в сводке — новый экземпляр
          не видел сигнала запуска и показывал «1:00», как будто отметка
          ничего не сделала. */}
      {expanded && supersetPos !== 'inner' && (
        <div style={{ padding: '0 12px', marginTop: '8px' }}>
          <RestTimer
            restTime={ex.restTime}
            startSignal={restStart}
            stopSignal={restStop}
            /* Отдых закончился на ЗАКРЫТОМ упражнении — пора к
               следующему. Пока упражнение не закрыто, остаёмся: впереди
               ещё подходы. */
            onFinish={ex.completed ? onRestDone : undefined}
          />
        </div>
      )}

      {/* Expanded flyout for COMPLETED exercises */}
      {expanded && ex.completed && (
        <div style={{
          padding: '10px 12px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-card)',
          fontSize: '12px'
        }}>
          {/* Info section */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontWeight: 600, color: 'var(--green)', marginBottom: '6px', fontSize: '11px' }}>
              Информация
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span style={{ color: 'var(--text-muted)' }}>План:</span>
              <span style={{ color: 'var(--text-secondary)' }}>{ex.plannedSets}</span>
            </div>
            {ex.actualSets && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Вес:</span>
                <span style={{ color: 'var(--green)', fontWeight: 600 }}>{ex.actualSets}</span>
              </div>
            )}
            {ex.newWeight && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Новый вес:</span>
                <span style={{ color: 'var(--green)', fontWeight: 600 }}>{ex.newWeight}</span>
              </div>
            )}
            {ex.feedback && (
              <div style={{ marginTop: '6px', color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '11px' }}>
                "{ex.feedback}"
              </div>
            )}
          </div>

          {/* Image link for completed */}
          {ex.imageUrl && (
            <div style={{ marginBottom: '8px' }}>
              <button onClick={() => onShowImage?.(ex.imageUrl!, ex.name)}
                style={{ background: 'none', border: 'none', fontSize: '11px', color: '#a855f7', display: 'flex', alignItems: 'center', gap: '4px', padding: 0, cursor: 'pointer' }}>
                <Camera size={12} /> Фото упражнения
              </button>
            </div>
          )}



        </div>
      )}

      {/* Expanded content - only for incomplete exercises */}
      {expanded && !ex.completed && (
        <div style={{
          padding: '0 12px 12px',
          borderTop: '1px solid var(--border)',
          animation: 'expandOpen 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden'
        }}>
          {/* Per-set table — Set / Reps / lbs / Status. Auto-marks the
              exercise completed when every set is checked. */}
          {(() => {
            const sets: ExerciseSet[] = ex.sets ?? makeInitialSets(ex.plannedSets);
            // Рабочий вес прошлой тренировки: с ним сверяем первый подход,
            // когда внутри упражнения сравнивать ещё не с чем.
            const prevMaxWeight = Math.max(0, ...(lastSets ?? []).map(x => x.weight || 0));
            const updateSet = (i: number, patch: Partial<ExerciseSet>) => {
              const next = sets.map((s, j) => j === i ? { ...s, ...patch } : s);
              const allDone = next.length > 0 && next.every(s => s.completed);
              // Отдых ведём только по отметке подхода (не по правке цифр):
              // отметили — пошёл отсчёт, закрыли последний — гасим.
              //
              // В суперсете отдыха между подходами нет: после упражнения
              // сразу идёт парное, отдых — только после всей связки. Её
              // последнее упражнение отдых запускает, остальные — нет.
              //
              // Раньше здесь стояло «упражнение закрыто целиком — гасим
              // отдых». Но закрывает его как раз ПОСЛЕДНЯЯ отметка, то
              // есть на самый частый случай («отметил подход — хочу
              // отдыхать») таймер не стартовал вовсе. Отдыхать после
              // последнего подхода нужно так же: впереди либо следующее
              // упражнение, либо конец тренировки, и пауза всё равно
              // нужна. Гасим только когда отметку СНИМАЮТ.
              if (patch.completed === true) {
                // Последнее упражнение тренировки и это его последний
                // подход — отдыхать не от чего, впереди ничего нет.
                const closesWorkout = isLastPending && next.every(s => s.completed);
                if (supersetPos === 'inner' || closesWorkout) setRestStop(v => v + 1);
                else setRestStart(v => v + 1);
              } else if (patch.completed === false) {
                setRestStop(v => v + 1);
              }
              onUpdate({ sets: next, completed: allDone });
            };
            const addSet = () => {
              const last = sets[sets.length - 1];
              const next = [...sets, { reps: last?.reps || 0, weight: last?.weight || 0, completed: false }];
              onUpdate({ sets: next });
            };
            const removeSet = (i: number) => {
              if (sets.length <= 1) return;
              const next = sets.filter((_, j) => j !== i);
              const allDone = next.length > 0 && next.every(s => s.completed);
              onUpdate({ sets: next, completed: allDone });
            };
            /**
             * Сбросы внутри подхода. Дропсет — это ОДИН подход, в котором
             * вес сбрасывают без отдыха, поэтому ступени живут внутри
             * подхода, а не отдельными строками: иначе тренд увидит
             * падение рабочего веса, которого не было.
             */
            const addDrop = (i: number, tech: SetTechnique = 'drop') => {
              const cur = sets[i];
              const last = cur.drops?.[cur.drops.length - 1];
              const base = last ?? { weight: cur.weight || 0, reps: cur.reps || 0 };
              // У дропсета вес падает примерно на четверть, у rest-pause и
              // кластера он тот же — меняется только отдых между ступенями.
              const weight = tech === 'drop'
                ? Math.max(0, Math.round((base.weight * 0.75) / 2.5) * 2.5)
                : base.weight;
              updateSet(i, {
                drops: [...(cur.drops ?? []), { weight, reps: 0 }],
                tech: cur.tech ?? tech,
              });
            };
            const updateDrop = (i: number, di: number, patch: Partial<DropStep>) => {
              const drops = (sets[i].drops ?? []).map((d, j) => j === di ? { ...d, ...patch } : d);
              updateSet(i, { drops });
            };
            const removeDrop = (i: number, di: number) => {
              const drops = (sets[i].drops ?? []).filter((_, j) => j !== di);
              // Убрали последнюю ступень — снимаем и метку техники,
              // иначе подход остаётся «дропсетом» без сбросов.
              updateSet(i, drops.length
                ? { drops }
                : { drops: undefined, tech: undefined });
            };
            const allSetsDone = sets.length > 0 && sets.every(s => s.completed);
            const markAllSets = () => {
              const next = sets.map(s => ({ ...s, completed: !allSetsDone }));
              const allDone = next.length > 0 && next.every(s => s.completed);
              setRestStop(v => v + 1); // «Выполнено»/«Снять все» — отдыхать не от чего
              onUpdate({ sets: next, completed: allDone });
            };
            // Первый неотмеченный подход — подсвечивается как текущий (по макету).
            const currentIdx = sets.findIndex(s => !s.completed);
            return (
              <div style={{ marginTop: '8px', marginBottom: '10px' }}>
                {/* Суперсет: объясняем, что делать. Одной плашки с меткой
                    мало — рядом стоит «отдых 2:00», и непонятно, отдыхать
                    или сразу идти к парному упражнению. */}
                {supersetGroup && supersetGroup.length > 1 && (
                  <div
                    className="tx-supnote"
                    /* Стиль дублируем инлайново: класс из globals.css
                       однажды не попал в прод-сборку, а подсказка должна
                       быть видна наверняка. */
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 6,
                      margin: '0 0 9px', padding: '9px 11px', borderRadius: 10,
                      background: '#eef3fb', border: '1px solid #d6e2f3',
                      fontSize: 11, lineHeight: 1.4, color: '#3f6292',
                    }}
                  >
                    <Link2 size={12} style={{ flex: 'none', marginTop: 1 }} />
                    <span>
                      {supersetPos === 'inner'
                        ? <>Без отдыха переходи к следующему: <b>{supersetGroup[supersetGroup.indexOf(ex.name) + 1] ?? supersetGroup[1]}</b></>
                        : <>Это конец связки — после подхода отдыхай, потом снова <b>{supersetGroup[0]}</b></>}
                    </span>
                  </div>
                )}
                {/* Дропсет из программы: раньше план был виден только
                    строчкой в заметке, и было непонятно, на каком
                    подходе и что именно делать. Плашка как у суперсета. */}
                {(ex.planDropSet || ex.planToFailure || ex.planTech || ex.planPyramid) && (
                  <div
                    /* Инлайновый стиль по той же причине, что у суперсета:
                       класс из globals.css однажды не доехал до прода. */
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 6,
                      margin: '0 0 9px', padding: '9px 11px', borderRadius: 10,
                      background: '#fdf0e8', border: '1px solid #f4d9c6',
                      fontSize: 11, lineHeight: 1.45, color: '#8a5327',
                    }}
                  >
                    {ex.planPyramid
                      ? <TrendingUp size={12} style={{ flex: 'none', marginTop: 1 }} />
                      : (ex.planDropSet || ex.planTech)
                        ? <ChevronsDown size={12} style={{ flex: 'none', marginTop: 1 }} />
                        : <Flame size={12} style={{ flex: 'none', marginTop: 1 }} />}
                    <span>
                      {ex.planPyramid ? (
                        <>Пирамида: вес {ex.planPyramid === 'up' ? 'растёт' : 'падает'} от
                        подхода к подходу, повторы — наоборот. Это схема, а не
                        провал в весах: записывай как есть.</>
                      ) : ex.planDropSet ? (
                        <>
                          <b>Подход {sets.length}</b> — дропсет: доведи до отказа,
                          сбрось вес на 20-25% <i>без отдыха</i> и сделай ещё
                          столько повторов, сколько получится. Запиши ступени
                          через <b>+ техника подхода</b> под таблицей → <b>Дропсет</b>.
                          {ex.planToFailure ? ' Он же — до отказа.' : ''}
                        </>
                      ) : ex.planTech === 'restPause' ? (
                        <>
                          <b>Подход {sets.length}</b> — rest-pause: доведи до отказа,
                          пауза 10-20 сек <i>не меняя вес</i>, и ещё блок повторов.
                          Обычно 2-3 блока. Записывай через <b>+ техника подхода</b> → <b>Rest-pause</b>.
                        </>
                      ) : ex.planTech === 'cluster' ? (
                        <>
                          <b>Подход {sets.length}</b> — кластер: разбей подход на
                          блоки с паузами 10-15 сек (например 3+3+3 вместо 9).
                          Записывай через <b>+ техника подхода</b> → <b>Кластер</b>.
                        </>
                      ) : (
                        <><b>Подход {sets.length}</b> — до отказа: работай, пока
                        повтор не перестанет получаться. Отметь через <b>+ техника подхода</b> → <b>До отказа</b>.</>
                      )}
                    </span>
                  </div>
                )}
                <div className="tx-restset">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Timer size={11} />
                {supersetPos === 'inner' ? 'Отдых после связки' : 'Отдых между подходами'}
                </span>
                <span className="tx-stepper">
                <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onUpdate({ restTime: formatTime(Math.max(15, parseRestTime(ex.restTime) - 15)) }); }}
                aria-label="Уменьшить время отдыха"
                >−</button>
                <b>{formatTime(parseRestTime(ex.restTime))}</b>
                <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onUpdate({ restTime: formatTime(Math.min(600, parseRestTime(ex.restTime) + 15)) }); }}
                aria-label="Увеличить время отдыха"
                >+</button>
                </span>
                </div>
                {/* Таймер отсюда поднят выше ветвления «выполнено / не
                    выполнено» — см. комментарий там. Внутри связки его
                    по-прежнему нет: отдыха там не бывает. */}
                <div className="tx-grid tx-head">
                  <span>№</span>
                  <span>{lastLabel ?? 'Last'}</span>
                  <span>ПОВТОРЫ</span>
                  <span>LB</span>
                  <span />
                </div>
                {sets.map((s, i) => {
                  const last = lastSets?.[i];
                  // Похоже на опечатку в цифрах — подсказываем, но не мешаем.
                  const warn = checkSetSanity(s, i, sets, prevMaxWeight);
                  return (
                  <React.Fragment key={i}>
                  <div
                    className={['tx-grid', 'tx-row', i === currentIdx ? 'is-current' : '', s.completed ? 'is-filled' : '', warn ? 'has-warn' : ''].filter(Boolean).join(' ')}
                  >
                    <span
                      className={['tx-setn', s.completed ? 'is-on' : ''].filter(Boolean).join(' ')}
                      /* Запланированный подход помечаем цветом и точкой,
                         а НЕ рамкой: рамка вокруг голой цифры читалась
                         как пустое поле ввода (видно на скриншоте). */
                      style={(ex.planDropSet || ex.planToFailure || ex.planTech) && i === sets.length - 1
                        ? { color: '#c47a35', fontWeight: 700 }
                        : undefined}
                      title={(ex.planDropSet || ex.planToFailure || ex.planTech) && i === sets.length - 1
                        ? (ex.planDropSet ? 'По программе: дропсет' : ex.planTech ? 'По программе: ' + TECH_META[ex.planTech].label : 'По программе: до отказа')
                        : undefined}
                    >{i + 1}{(ex.planDropSet || ex.planToFailure || ex.planTech) && i === sets.length - 1 ? '•' : ''}</span>
                    <span className="tx-last">
                      {last && (last.reps > 0 || last.weight > 0) ? `${last.reps}×${last.weight}` : '—'}
                    </span>
                    <input
                      className={['tx-input', warn?.field === 'reps' ? 'is-warn' : ''].filter(Boolean).join(' ')}
                      type="number"
                      inputMode="numeric"
                      value={s.reps || ''}
                      onChange={(e) => updateSet(i, { reps: parseInt(e.target.value, 10) || 0 })}
                      placeholder="0"
                    />
                    <input
                      className={['tx-input', warn?.field === 'weight' ? 'is-warn' : ''].filter(Boolean).join(' ')}
                      type="number"
                      inputMode="numeric"
                      value={s.weight || ''}
                      onChange={(e) => updateSet(i, { weight: parseInt(e.target.value, 10) || 0 })}
                      placeholder="0"
                    />
                    <button
                      className={['tx-check', s.completed ? 'is-on' : ''].filter(Boolean).join(' ')}
                      onClick={() => updateSet(i, { completed: !s.completed })}
                      onContextMenu={(e) => { e.preventDefault(); removeSet(i); }}
                      title="Right-click / long-press to remove this set"
                    >
                      {s.completed ? <Check size={16} strokeWidth={3} /> : <Check size={16} strokeWidth={2} />}
                    </button>
                  </div>
                  {/* Отметки техники: «до отказа» и дропсет. Висят под
                      подходом, чтобы не ломать сетку из пяти колонок.
                      На запланированном программой подходе показываем
                      сразу, не дожидаясь отметки: иначе кнопки «дроп»
                      не видно именно тогда, когда она нужна. */}
                  {/* Техники — только на ПОСЛЕДНЕМ подходе (и там, где
                      уже что-то записано). Раньше условие начиналось с
                      s.completed, и кнопки вылезали под каждым отмеченным
                      подходом: дропсет делают в последнем, а не во всех. */}
                  {((s.drops?.length ?? 0) > 0 || s.toFailure || s.negativeSec
                    || i === sets.length - 1) && (
                    <SetTechPanel
                      set={s}
                      setNo={i + 1}
                      planned={i === sets.length - 1
                        ? (ex.planDropSet ? 'drop' : ex.planTech)
                        : undefined}
                      onToggleFailure={() => updateSet(i, { toFailure: !s.toFailure })}
                      onToggleNegative={() => updateSet(i, { negativeSec: s.negativeSec ? undefined : 3 })}
                      onSetNegative={(sec) => updateSet(i, { negativeSec: sec })}
                      onAddStep={(tech) => addDrop(i, tech)}
                      onUpdateStep={(di, patch) => updateDrop(i, di, patch)}
                      onRemoveStep={(di) => removeDrop(i, di)}
                    />
                  )}
                  {warn && (
                    <div className="tx-warn" role="status">
                      <AlertTriangle size={11} />
                      <span>{warn.text}</span>
                    </div>
                  )}
                  </React.Fragment>
                  );
                })}
                {/* Ряд действий по макету: тренд и «+ Подход» в одну строку,
                    «Выполнено» — широкой кнопкой во всю ширину карточки. */}
                <div className="tx-grid tx-actions">
                  <button
                    className="tx-trend"
                    onClick={() => setShowChart(!showChart)}
                    title='Динамика веса'
                    disabled={!weightHistory || weightHistory.length === 0}
                    style={{ opacity: (!weightHistory || weightHistory.length === 0) ? 0.35 : 1 }}
                  >
                    <TrendingUp size={14} />
                    <span>Тренд</span>
                  </button>
                  <button className="tx-addset" onClick={addSet}>
                    <Plus size={13} />
                    Подход
                  </button>
                  <button
                    type="button"
                    className="tx-markall"
                    onClick={(e) => { e.stopPropagation(); markAllSets(); }}
                    title={allSetsDone ? 'Снять отметки со всех подходов' : 'Отметить все подходы'}
                  >
                    <CheckCheck size={14} strokeWidth={2.5} />
                    {allSetsDone ? 'Отменить выполнение' : 'Выполнено'}
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Динамика рабочего веса — открывается иконкой справа от заметок */}
          {weightHistory && weightHistory.length > 0 && showChart && (
            <div style={{
              marginTop: '14px', padding: '14px',
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '12px', fontWeight: 700, color: 'var(--yellow)' }}>
                <TrendingUp size={14} /> Динамика веса ({weightHistory.length})
              </div>
              <WeightChart
                data={weightHistory.map(h => h.weight)}
                labels={weightHistory.map(h => new Date(h.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }))}
              />
            </div>
          )}

          {/* History button */}
          {progressHistory.length > 0 && (
            <div style={{ marginTop: '14px' }}>
              <button
                onClick={() => setShowHistory(!showHistory)}
                style={{
                  padding: '12px 16px',
                  background: 'var(--blue-dim)',
                  border: '1px solid rgba(0, 180, 216, 0.3)',
                  borderRadius: '10px',
                  color: 'var(--blue)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <History size={16} /> История ({progressHistory.length})
              </button>
            </div>
          )}

          {/* Progress History */}
          {showHistory && progressHistory.length > 0 && (
            <div style={{
              marginTop: '14px',
              padding: '14px',
              background: 'var(--blue-dim)',
              borderRadius: '12px',
              border: '1px solid rgba(59, 130, 246, 0.2)'
            }}>
              <div style={{
                fontSize: '12px',
                color: 'var(--blue)',
                fontWeight: 600,
                marginBottom: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <TrendingUp size={14} />
                История прогресса
              </div>
              <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
                {progressHistory.slice().reverse().map((entry, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 0',
                      borderBottom: i < progressHistory.length - 1 ? '1px solid var(--border)' : 'none'
                    }}
                  >
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      {new Date(entry.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--green)' }}>
                      {entry.weight}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Заметка к упражнению — самая последняя строка (динамика веса
              переехала в строку Add set / Отметить все) */}
          {/* Заметка к упражнению — оформление в .tx-note (по макету) */}
          <div className="tx-note" style={{ marginTop: '8px' }}>
            <input
              type="text"
              value={ex.feedback}
              onChange={(e) => onUpdate({ feedback: e.target.value })}
              placeholder="Заметка к упражнению…"
            />
          </div>
        </div>
      )}

      {/* Video Modal */}
      {/* Compact image popup */}
      {showVideoModal && (
        <div
          onClick={() => setShowVideoModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 1000
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '400px',
              background: 'var(--bg-card)',
              borderRadius: '20px',
              border: '1px solid var(--border)',
              padding: '24px'
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '20px'
            }}>
              <Video size={20} style={{ color: 'var(--blue)' }} />
              <h3 style={{
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                margin: 0
              }}>
                Видео-инструкция
              </h3>
            </div>

            <input
              type="text"
              value={videoUrlInput}
              onChange={(e) => setVideoUrlInput(e.target.value)}
              placeholder="Ссылка на YouTube или другой ресурс..."
              style={{
                width: '100%',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '14px 16px',
                color: 'var(--text-primary)',
                fontSize: '14px',
                boxSizing: 'border-box',
                marginBottom: '16px'
              }}
            />

            <div style={{ display: 'flex', gap: '10px' }}>
              {ex.videoUrl && (
                <a
                  href={ex.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'var(--blue-dim)',
                    border: '1px solid rgba(0, 180, 216, 0.3)',
                    borderRadius: '12px',
                    color: 'var(--blue)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    textDecoration: 'none',
                    fontSize: '14px',
                    fontWeight: 600
                  }}
                >
                  <ExternalLink size={16} />
                  Открыть
                </a>
              )}
              <button
                onClick={() => {
                  onUpdate({ videoUrl: videoUrlInput || undefined });
                  setShowVideoModal(false);
                }}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: 'var(--green)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#000',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 600
                }}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Beautiful Calendar Component
/**
 * Название тренировки по двум главным группам мышц («Спина и бицепс»).
 * Группы упражнений определяет ИИ (muscleGroups); если их ещё нет — null.
 */
function muscleHeading(exercises: Exercise[], muscleGroups: Record<string, string>, lang: 'ru' | 'en'): string | null {
  const counts = new Map<string, number>();
  for (const ex of exercises) {
    const raw = muscleGroups[ex.name.trim().toLowerCase()];
    if (!raw) continue;
    for (const part of String(raw).split(/[·,/]+/)) {
      const g = part.trim().toLowerCase();
      if (g) counts.set(g, (counts.get(g) || 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]);
  if (top.length === 0) return null;
  const joined = top.join(lang === 'ru' ? ' и ' : ' & ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/**
 * Статистика по макету редизайна: неделя или месяц, три итога, активность
 * по дням (выполненные подходы), питание и последние тренировки. Считается
 * из тех же dayLogs, что календарь; «выполнено» — общий getDayStatus.
 * Стрелки листают прошлые недели и месяцы, тап по дню или тренировке
 * открывает этот день на главной.
 */
function StatsView({ dayLogs, workouts, muscleGroups, todayStr, onSelectDate }: {
  dayLogs: Record<string, DayLog>;
  workouts: Workout[];
  muscleGroups: Record<string, string>;
  todayStr: string;
  onSelectDate: (date: Date) => void;
}) {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [offset, setOffset] = useState(0);

  const ymd = (d: Date) => formatDate(d);
  const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = parse(todayStr);

  // Дни периода: неделя пн–вс или календарный месяц, со сдвигом назад
  const days: string[] = [];
  if (period === 'week') {
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) - offset * 7);
    for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(monday.getDate() + i); days.push(ymd(d)); }
  } else {
    const first = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    for (let i = 1; i <= last; i++) days.push(ymd(new Date(first.getFullYear(), first.getMonth(), i)));
  }
  const elapsed = days.filter(d => d <= todayStr);

  // Выполненные подходы за день: по отмеченным подходам, а у старых
  // записей без подходов — по отмеченному упражнению и плану «4x10».
  const setsDone = (log: DayLog | undefined) => {
    const exercises = log?.workoutSnapshot?.exercises ?? log?.workoutDraft?.exercises ?? [];
    return exercises.reduce((sum, ex) => {
      const list = Array.isArray(ex.sets) ? ex.sets : Array.isArray(ex.actualSets) ? (ex.actualSets as unknown as ExerciseSet[]) : null;
      if (list) return sum + list.filter(s => s?.completed).length;
      return sum + (ex.completed ? parsePlannedSetCount(ex.plannedSets) : 0);
    }, 0);
  };

  const statusOf = (d: string) => getDayStatus(dayLogs[d], d, todayStr);
  const trained = elapsed.filter(d => { const s = statusOf(d).status; return s === 'done' || s === 'active'; }).length;
  const perWeek = Math.min(Math.max(workouts.length, 1), 7);
  const target = period === 'week' ? perWeek : Math.round(perWeek * days.length / 7);
  const stepDays = elapsed.map(d => dayLogs[d]?.steps ?? 0).filter(s => s > 0);
  const totalSets = elapsed.reduce((s, d) => s + setsDone(dayLogs[d]), 0);
  const mealDays = elapsed.filter(d => (dayLogs[d]?.meals?.length ?? 0) > 0);
  const avg = (f: (m: Meal) => number) => mealDays.length
    ? Math.round(mealDays.reduce((s, d) => s + dayLogs[d].meals.reduce((a, m) => a + (Number(f(m)) || 0), 0), 0) / mealDays.length)
    : null;
  const kcal = avg(m => m.calories);
  const protein = avg(m => m.protein);

  // Столбики: дни недели или отрезки месяца по 7 дней
  const bars: { label: string; value: number; future: boolean; date?: string }[] = period === 'week'
    ? days.map((d, i) => ({ label: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][i], value: setsDone(dayLogs[d]), future: d > todayStr, date: d }))
    : Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => {
      const chunk = days.slice(i * 7, i * 7 + 7);
      return {
        label: `${i * 7 + 1}–${i * 7 + chunk.length}`,
        value: chunk.reduce((s, d) => s + setsDone(dayLogs[d]), 0),
        future: chunk[0] > todayStr,
      };
    });
  const maxBar = Math.max(1, ...bars.map(b => b.value));

  const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions) => parse(d).toLocaleDateString('ru-RU', opts);
  const rangeLabel = period === 'week'
    ? `${parse(days[0]).getDate()}${days[0].slice(5, 7) === days[6].slice(5, 7) ? '' : ' ' + fmtDay(days[0], { month: 'short' })}–${fmtDay(days[6], { day: 'numeric', month: 'long' })}`
    : fmtDay(days[0], { month: 'long', year: offset > 0 && days[0].slice(0, 4) !== todayStr.slice(0, 4) ? 'numeric' : undefined });

  // Последние тренировки — независимо от периода, свежие сверху
  const recent = Object.keys(dayLogs)
    .filter(d => d <= todayStr)
    .sort((a, b) => b.localeCompare(a))
    .map(d => ({ d, ...statusOf(d) }))
    .filter(x => x.status === 'done' || x.status === 'active')
    .slice(0, 3);
  // Как на главной: «T4 · Ноги и трицепс», без групп — имя тренировки
  const workoutName = (d: string) => {
    const log = dayLogs[d];
    const snap = log?.workoutSnapshot ?? log?.workoutDraft;
    const id = snap?.workoutId ?? log?.workoutCompleted ?? log?.selectedWorkout;
    const name = snap?.workoutName || workouts.find(w => w.id === id)?.name || 'Тренировка';
    const heading = muscleHeading(snap?.exercises ?? [], muscleGroups, 'ru');
    return heading ? `${name.replace('Тренировка ', 'T')} · ${heading}` : name;
  };

  // Любимые блюда остаются здесь: в «Питании» их можно отметить, но не увидеть списком
  const favorites: Meal[] = [];
  Object.values(dayLogs).forEach(log => log.meals?.forEach(m => {
    if (m.isFavorite && !favorites.some(f => f.name === m.name)) favorites.push(m);
  }));

  const leadDays = period === 'month' ? (parse(days[0]).getDay() + 6) % 7 : 0;

  return (
    <div className="tx stats-view">
      <div className="page-title">
        <div>
          <h1>Статистика</h1>
          <p>Твой прогресс в одном месте</p>
        </div>
      </div>

      <div className="pills">
        {(['week', 'month'] as const).map(p => (
          <button key={p} type="button" className={'pill' + (period === p ? ' active' : '')}
            onClick={() => { setPeriod(p); setOffset(0); }}>{p === 'week' ? 'Неделя' : 'Месяц'}</button>
        ))}
      </div>

      <div className="three-col stat-cards">
        <div className="metric"><strong>{trained} / {target}</strong><small>Тренировок</small></div>
        {stepDays.length > 0 ? (
          <div className="metric"><strong>{Math.round(stepDays.reduce((a, b) => a + b, 0) / stepDays.length).toLocaleString('ru-RU')}</strong><small>Шагов / день</small></div>
        ) : (
          <div className="metric"><strong>{totalSets}</strong><small>Подходов</small></div>
        )}
        <div className="metric"><strong>{mealDays.length} / {elapsed.length}</strong><small>Дней питания</small></div>
      </div>

      <section className="card">
        <div className="section-title">
          <h2>Активность · {rangeLabel}</h2>
          <div className="stats-nav">
            <button type="button" className="round" aria-label="Раньше" onClick={() => setOffset(o => o + 1)}><ChevronLeft /></button>
            <button type="button" className="round" aria-label="Позже" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - 1))}><ChevronRight /></button>
          </div>
        </div>
        <div className="demo-bars">
          {bars.map((b, i) => (
            <div key={i}>
              <em>{b.value > 0 ? b.value : ''}</em>
              <span className={b.future ? 'is-future' : b.date === todayStr ? 'is-today' : undefined}
                style={{ height: `${Math.max(3, Math.round((b.value / maxBar) * 88))}px` }} />
              <small>{b.label}</small>
            </div>
          ))}
        </div>
        <p className="muted">Выполненные подходы {period === 'week' ? 'по дням' : 'по неделям месяца'}</p>
      </section>

      {period === 'month' && (
        <section className="card">
          <div className="section-title"><h2>Дни тренировок</h2></div>
          <div className="activity-grid">
            {Array.from({ length: leadDays }, (_, i) => <span key={'e' + i} className="is-empty" />)}
            {days.map(d => {
              const s = statusOf(d).status;
              return (
                <button key={d} type="button" disabled={d > todayStr}
                  className={[s === 'done' ? 'logged' : s === 'active' ? 'partial' : '', d === todayStr ? 'is-today' : ''].filter(Boolean).join(' ') || undefined}
                  onClick={() => onSelectDate(parse(d))}
                  aria-label={fmtDay(d, { day: 'numeric', month: 'long' }) + (s === 'done' ? ', выполнено' : s === 'active' ? ', частично' : '')}>
                  {parse(d).getDate()}
                </button>
              );
            })}
          </div>
          <p className="muted"><i className="legend logged" /> выполнено <i className="legend partial" /> частично · тап открывает день</p>
        </section>
      )}

      <section className="card">
        <div className="section-title"><h2>Питание</h2></div>
        <div className="two-col">
          <div className="metric"><strong>{kcal != null ? kcal.toLocaleString('ru-RU') : '—'}</strong><small>Среднее, ккал / день</small></div>
          <div className="metric"><strong>{protein != null ? `${protein} г` : '—'}</strong><small>Средний белок / день</small></div>
        </div>
      </section>

      <section className="card">
        <div className="section-title"><h2>Последние тренировки</h2></div>
        {recent.length === 0 ? (
          <p className="muted">Пока нет отмеченных тренировок.</p>
        ) : recent.map(r => (
          <button key={r.d} type="button" className="row stats-workout" onClick={() => onSelectDate(parse(r.d))}>
            <div className="row-copy">
              <strong>{fmtDay(r.d, { day: 'numeric', month: 'long' })}</strong>
              <small>{workoutName(r.d)} · {r.exDone} из {r.exTotal} упр.</small>
            </div>
            <span className={'badge' + (r.status === 'done' ? ' green' : '')}>{r.status === 'done' ? 'Готово' : 'Частично'}</span>
          </button>
        ))}
      </section>

      {favorites.length > 0 && (
        <section className="card">
          <div className="section-title"><h2>Любимые блюда</h2></div>
          {favorites.map(m => (
            <div key={m.name} className="row">
              <div className="row-copy">
                <strong>{m.name}</strong>
                <small>Б {m.protein} · Ж {m.fat} · У {m.carbs} г · {m.calories} ккал</small>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function FitnessCalendar({
  dayLogs,
  selectedDate,
  onSelectDate,
  workouts,
  timezone = 'Europe/Moscow'
}: {
  dayLogs: Record<string, DayLog>;
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  workouts: Workout[];
  timezone?: string;
}) {
  const [currentMonth, setCurrentMonth] = useState<Date | null>(null);

  // Initialize currentMonth on client to avoid hydration mismatch
  useEffect(() => {
    if (!currentMonth) {
      setCurrentMonth(getTodayInTimezone(timezone));
    }
  }, [timezone]);

  const monthDays = useMemo(() => {
    if (!currentMonth) return [];
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();

    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6;

    const days: (null | { day: number; dateStr: string })[] = [];

    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({ day, dateStr });
    }

    return days;
  }, [currentMonth]);

  const [today, setToday] = useState('');
  const selectedDateStr = formatDate(selectedDate);

  useEffect(() => {
    setToday(formatDate(getTodayInTimezone(timezone)));
  }, [timezone]);

  // Stats for the month
  const monthStats = useMemo(() => {
    let workoutDays = 0;
    let totalSteps = 0;
    let stepDays = 0;

    monthDays.forEach(d => {
      if (d) {
        const log = dayLogs[d.dateStr];
        if (log?.dayClosed) workoutDays++;
        if (log?.steps && log.steps > 0) {
          totalSteps += log.steps;
          stepDays++;
        }
      }
    });

    return { workoutDays, totalSteps, stepDays };
  }, [monthDays, dayLogs]);

  // Don't render until currentMonth is initialized on client
  if (!currentMonth) {
    return (
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: '20px',
        border: '1px solid var(--border)',
        padding: '40px',
        textAlign: 'center',
        color: 'var(--text-muted)'
      }}>
        Загрузка...
      </div>
    );
  }

  return (
    <div className="card-soft" style={{ overflow: 'hidden' }}>
      {/* Month header */}
      <div style={{
        padding: '20px',
        background: 'linear-gradient(135deg, var(--bg-elevated) 0%, var(--bg-card) 100%)',
        borderBottom: '1px solid var(--border)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px'
        }}>
          <button
            onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: '12px',
              padding: '12px 18px',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <ChevronLeft size={24} />
          </button>

          <div>
            <span className="tx-eyebrow">История тренировок</span>
            <h4 className="tx-monthtitle" style={{ margin: 0, fontWeight: 700, fontSize: '17px', letterSpacing: '-0.5px', textTransform: 'capitalize' }}>
              {currentMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
            </h4>
          </div>

          <button
            onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: '12px',
              padding: '12px 18px',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <ChevronRight size={24} />
          </button>
        </div>

        {/* Статистика месяца — плоская строка, как в макете */}
        <div className="tx-monthstats">
          <span><b>{monthStats.workoutDays}</b>тренировок</span>
          <span><b>{Math.round(monthStats.totalSteps / 1000)}K</b>шагов</span>
          <span><b>{monthStats.stepDays > 0 ? Math.round(monthStats.totalSteps / monthStats.stepDays) : 0}</b>ср. шагов</span>
        </div>
      </div>

      {/* Дни недели */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '4px 16px 2px' }}>
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => (
          <div key={day} className="tx-monthdow">{day}</div>
        ))}
      </div>

      {/* Сетка месяца */}
      <div className="tx-monthgrid" style={{ padding: '4px 16px 16px' }}>
        {monthDays.map((d, i) => {
          if (!d) return <div key={`empty-${i}`} />;

          const log = dayLogs[d.dateStr];
          const isToday = d.dateStr === today;
          const isSelected = d.dateStr === selectedDateStr;
          const isFuture = d.dateStr > today;
          const isOffDay = log?.isOffDay;

          // Статус берём из общей getDayStatus — тот же словарь, что и в
          // верхней ленте дат: выполнено / в процессе / запланировано / нет.
          const { status, exDone, exTotal, pct: workoutPct } = getDayStatus(log, d.dateStr, today);
          const hasWorkout = status === 'done' || status === 'active';
          const fullyDone = status === 'done';
          const isPlanned = status === 'planned';
          const hasSteps = log?.steps && log.steps > 0 && !hasWorkout;

          // Прошлый день без тренировки = день отдыха (автоматически).
          const isRestDay = !isFuture && !isToday && !hasWorkout && !hasSteps;

          // Метка тренировки: id из snapshot/draft, иначе выбранная
          const completedWorkoutId = log?.workoutSnapshot?.workoutId
            ?? log?.workoutCompleted
            ?? log?.selectedWorkout;
          const completedWorkout = completedWorkoutId
            ? workouts.find(w => w.id === completedWorkoutId)
            : null;
          const workoutLabel = completedWorkout
            ? completedWorkout.name.replace('Тренировка ', 'T')
            : null;

          // Parse date correctly to avoid timezone issues
          const [year, month, dayNum] = d.dateStr.split('-').map(Number);
          const clickDate = new Date(year, month - 1, dayNum);

          return (
            <button
              key={d.day}
              onClick={() => onSelectDate(clickDate)}
              // Оформление по макету: день с записью — мягкая заливка,
              // выбранный — тёмная клетка, под числом метка тренировки.
              className={[
                'tx-monthday',
                isSelected ? 'is-sel' : '',
                !isSelected && isToday ? 'is-today' : '',
                !isSelected && (hasWorkout || isPlanned || hasSteps) ? 'has-rec' : '',
              ].filter(Boolean).join(' ')}
              style={{ cursor: isFuture ? 'default' : 'pointer', opacity: isFuture && !isPlanned ? 0.45 : 1 }}
            >
              <span>{d.day}</span>
              <small>
                {(hasWorkout || isPlanned) && (
                  <i className={['tx-dot', fullyDone ? 'd-done' : hasWorkout ? 'd-active' : 'd-planned'].join(' ')} />
                )}
                {hasWorkout || isPlanned
                  ? (workoutLabel || (exTotal > 0 ? exDone + '/' + exTotal : ''))
                  : hasSteps ? 'шаги' : '—'}
              </small>
            </button>
          );
        })}
      </div>

      {/* Легенда: один словарь статусов с верхней лентой дат */}
      <div className="tx-legend" style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--border)', justifyContent: 'center', margin: 0 }}>
        <span><i className="tx-dot d-done" />Выполнено</span>
        <span><i className="tx-dot d-active" />В процессе</span>
        <span><i className="tx-dot d-planned" />Запланировано</span>
        <span><i className="tx-dot d-none" />Нет записи</span>
      </div>
    </div>
  );
}

// Default workout selection - user picks manually, default to T1
// Единый статус дня для ОБОИХ календарей — ленты дат сверху и месячной
// сетки. Раньше каждый считал по-своему: лента знала только «есть/нет
// тренировки», месяц различал ещё и частичное выполнение. Теперь словарь
// один: выполнено / в процессе / запланировано / нет записи.
type DayStatus = 'done' | 'active' | 'planned' | 'none';

// ---------------------------------------------------------------------------
// Огонёк питания: день засчитывается, когда набрано НЕ МЕНЕЕ 90% дневной цели
// по калориям. Сравниваем без округления вверх (kcal*100 >= goal*90), поэтому
// при цели 2410 огонёк загорается с 2169 ккал, а на 2168 его ещё нет.
// Белки/жиры/углеводы в это условие не входят и не усредняются.
export const NUTRITION_FLAME_PERCENT = 90;

export function nutritionFlameStatus(
  meals: { calories?: number }[] | undefined,
  goalCalories: number | undefined | null,
): { lit: boolean; kcal: number; ratio: number; has: boolean; over: number } {
  const list = Array.isArray(meals) ? meals : [];
  const kcal = list.reduce((sum, m) => sum + (Number(m?.calories) || 0), 0);
  const goal = Number(goalCalories);
  const valid = Number.isFinite(goal) && goal > 0 && Number.isFinite(kcal);
  return {
    has: list.length > 0,
    kcal,
    ratio: valid ? kcal / goal : 0,
    // Пустой день и отсутствующая/нулевая цель огонька не получают.
    lit: valid && list.length > 0 && kcal * 100 >= goal * NUTRITION_FLAME_PERCENT,
    over: valid && kcal > goal ? kcal - goal : 0,
  };
}

// Подписи статусов дня — один словарь для ленты, календаря и подписи дня.
const DAY_STATUS_TEXT: Record<DayStatus, string> = {
  done: 'Выполнено',
  active: 'В процессе',
  planned: 'Запланировано',
  none: 'Нет записи',
};

function getDayStatus(
  log: DayLog | undefined,
  dateStr: string,
  todayStr: string,
): { status: DayStatus; exDone: number; exTotal: number; pct: number } {
  const exercises = log?.workoutSnapshot?.exercises ?? log?.workoutDraft?.exercises ?? [];
  const exTotal = exercises.length;
  const exDone = exercises.filter(e => e.completed).length;
  const pct = exTotal > 0 ? exDone / exTotal : 0;

  let status: DayStatus;
  if (exTotal > 0 && exDone === exTotal) status = 'done';
  else if (exDone > 0) status = 'active';
  // Запланировано: тренировка на день выбрана, но ещё ничего не отмечено.
  // Только для сегодня и будущего — в прошлом это уже пропуск, не план.
  else if (dateStr >= todayStr && !log?.isOffDay &&
           (log?.selectedWorkout || log?.workoutDraft?.workoutId || exTotal > 0)) status = 'planned';
  else status = 'none';

  return { status, exDone, exTotal, pct };
}

function getDefaultWorkout(): string {
  return 't1';
}

// True when the exercise has any user-entered progress on it. Used to decide
// whether the local copy of an exercise is "richer" than the server's copy
// when we merge a refreshed GET on top of unsynced local edits.
function exerciseHasProgress(ex: Exercise | undefined): boolean {
  if (!ex) return false;
  if (ex.completed) return true;
  if (ex.notes && ex.notes.trim().length > 0) return true;
  // actualSets — легаси-строка, но в неё же упаковывается массив подходов
  // (см. upsertWorkoutLog), поэтому с сервера может прийти массив. Без этой
  // проверки .trim() падал и ронял весь экран тренировки.
  if (Array.isArray(ex.actualSets)) {
    if ((ex.actualSets as ExerciseSet[]).some(s => s?.completed || (s?.reps ?? 0) > 0 || (s?.weight ?? 0) > 0)) return true;
  } else if (typeof ex.actualSets === 'string' && ex.actualSets.trim().length > 0) return true;
  if (Array.isArray(ex.sets) && ex.sets.some(s => s.completed || (s.reps ?? 0) > 0 || (s.weight ?? 0) > 0)) return true;
  return false;
}

// Merge a fresh server-side dayLogs blob with the in-memory state we already
// have, preserving unsynced workoutDraft edits on still-open days.
//
// The race we're protecting against: the offline-first per-row store (Dexie)
// writes go local first and queue an outbox op. If a refresh / poll / online
// transition fires its GET before the outbox flushed, the server's merged
// dayLogs misses those rows, and a blind setDayLogs(server) wipes the in-UI
// progress for several seconds until the Dexie hydration tick refills it.
//
// Strategy: trust server fields wholesale for CLOSED days (snapshot wins).
// For OPEN days with a local workoutDraft, copy server fields onto the local
// log but rebuild the draft.exercises array per-exercise: take whichever
// version actually has user progress on it (completed flag, sets, notes).
// Фото упражнения из библиотеки. Сначала точное имя; если ИИ-программа
// переименовала упражнение («пуловер в блоке стоя» vs «пуловер в блоке») —
// берём самый длинный ключ, совпадающий с названием по началу строки.
function findLibImage(lib: Record<string, string>, rawName: string): string | undefined {
  const name = rawName.toLowerCase().trim();
  if (lib[name]) return lib[name];
  let best: string | undefined;
  let bestLen = 0;
  for (const key of Object.keys(lib)) {
    if (key.length < 8) continue; // короткий ключ — риск ложного совпадения
    if ((name.startsWith(key) || key.startsWith(name)) && key.length > bestLen) {
      best = lib[key];
      bestLen = key.length;
    }
  }
  return best;
}

/**
 * Достаём план техник из текста для программ, собранных ДО того, как
 * флаги стали сохраняться.
 *
 * Раньше ассистент писал «последний подход — дропсет» в plannedSets и
 * notes, а сами флаги терялись — интерфейс не мог ничего показать.
 * Чтобы уже существующие программы не пришлось пересобирать, читаем
 * тот же текст и восстанавливаем метку.
 *
 * Флаг, пришедший с сервера, важнее текста: его мог поставить
 * пользователь или новая версия ассистента.
 */
const PLAN_DROP_RE = /дроп[\s-]?сет|дропс|сброс(?:ь|ить)?\s*\d+\s*%/i;
const PLAN_FAIL_RE = /до\s+отказа/i;
const PLAN_RP_RE = /rest[\s-]?pause|рест[\s-]?пауз/i;
const PLAN_CLUSTER_RE = /кластер|миниподход/i;
// «Пирамида» — только когда сказано про веса между подходами.
// Класс [а-яё], а не \w: \w в JS не включает кириллицу, и «обратная
// пирамида» с ним не находилась (поймал юнит-тест).
const PLAN_PYR_UP_RE = /пирамид/i;
const PLAN_PYR_DOWN_RE = /обратн[а-яё]*\s+пирамид|пирамид[а-яё]*\s+вниз/i;

function withPlannedTechniques(workouts: Workout[]): Workout[] {
  return workouts.map(w => ({
    ...w,
    exercises: (w.exercises || []).map(e => {
      if (e.planDropSet !== undefined || e.planToFailure !== undefined
        || e.planTech !== undefined || e.planPyramid !== undefined) return e;
      const text = [e.plannedSets, e.notes].filter(Boolean).join(' ');
      if (!text) return e;
      const drop = PLAN_DROP_RE.test(text);
      const fail = PLAN_FAIL_RE.test(text);
      // Дропсет важнее: если в тексте и сброс веса, и пауза — это дропсет
      // со сбросами, а не rest-pause (там вес не меняется).
      const tech: SetTechnique | undefined = drop
        ? undefined
        : PLAN_RP_RE.test(text) ? 'restPause'
        : PLAN_CLUSTER_RE.test(text) ? 'cluster'
        : undefined;
      const pyr: 'up' | 'down' | undefined = PLAN_PYR_DOWN_RE.test(text) ? 'down'
        : PLAN_PYR_UP_RE.test(text) ? 'up'
        : undefined;
      if (!drop && !fail && !tech && !pyr) return e;
      return {
        ...e,
        ...(drop ? { planDropSet: true } : {}),
        ...(fail ? { planToFailure: true } : {}),
        ...(tech ? { planTech: tech } : {}),
        ...(pyr ? { planPyramid: pyr } : {}),
      };
    }),
  }));
}

function mergeServerDayLogs(
  prev: Record<string, DayLog>,
  server: Record<string, DayLog>
): Record<string, DayLog> {
  const next: Record<string, DayLog> = { ...server };
  for (const [date, local] of Object.entries(prev)) {
    const sv = server[date];
    if (!sv) {
      // Server lost this day — possible if it's a brand new day still in
      // pendingOps. Keep our local copy so the UI doesn't blink it away.
      if (local && (local.workoutDraft || local.selectedWorkout || local.meals?.length)) {
        next[date] = local;
      }
      continue;
    }
    // Closed days: server snapshot is authoritative. Don't second-guess it.
    if (sv.dayClosed) {
      next[date] = sv;
      continue;
    }
    // Open day. If there's no local draft, server wins; nothing to preserve.
    const localDraft = local.workoutDraft;
    const serverDraft = sv.workoutDraft;
    if (!localDraft?.exercises?.length) {
      next[date] = sv;
      continue;
    }
    // Same workoutId, merge per-exercise. Prefer local exercise if it has
    // progress and the server's copy does not; otherwise prefer server.
    const sameWorkout = !!serverDraft && serverDraft.workoutId === localDraft.workoutId;
    const baseExercises = sameWorkout && serverDraft ? serverDraft.exercises : localDraft.exercises;
    const localById = new Map(localDraft.exercises.map(e => [e.id, e]));
    const serverById = new Map((serverDraft?.exercises ?? []).map(e => [e.id, e]));
    const mergedExercises: Exercise[] = baseExercises.map(baseEx => {
      const lEx = localById.get(baseEx.id);
      const sEx = serverById.get(baseEx.id);
      if (!lEx) return sEx ?? baseEx;
      if (!sEx) return lEx;
      // Both sides have this exercise. Keep whichever has progress; if both
      // do, prefer local (the user just touched it on this device).
      const lHas = exerciseHasProgress(lEx);
      const sHas = exerciseHasProgress(sEx);
      if (lHas) return lEx;
      if (sHas) return sEx;
      return lEx;
    });
    next[date] = {
      ...sv,
      workoutDraft: {
        workoutId: localDraft.workoutId,
        workoutName: localDraft.workoutName || serverDraft?.workoutName || '',
        exercises: mergedExercises,
      },
    };
  }
  return next;
}

export default function FitnessPage() {
  const [view, setView] = useState<'workout' | 'nutrition' | 'analytics' | 'gains' | 'profile' | 'planner' | 'chat' | 'labs'>('workout');
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [todayStr, setTodayStr] = useState(''); // Initialize on client to avoid hydration mismatch
  const [isNightMode, setIsNightMode] = useState(false);

  // Load saved view from localStorage on client
  useEffect(() => {
    const saved = localStorage.getItem('fitness_view');
    if (saved === 'workout' || saved === 'nutrition' || saved === 'analytics' || saved === 'gains' || saved === 'profile' || saved === 'planner') {
      setView(saved);
    }
  }, []);

  /**
   * Состояние кольца Oura. Грузим один раз при старте, чтобы раздел в
   * настройках был готов к моменту открытия.
   *
   * Возврат из Oura приходит с ?oura=connected — тогда сразу открываем
   * настройки, чтобы пользователь увидел результат, и чистим адрес.
   */
  useEffect(() => {
    fetch('/api/oura')
      .then(r => (r.ok ? r.json() : null))
      .then(d => d && setOura(d))
      .catch(() => {});

    const status = new URLSearchParams(window.location.search).get('oura');
    if (status) {
      if (status === 'connected') {
        setView('profile');
        localStorage.setItem('fitness_view', 'profile');
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const [workouts, setWorkouts] = useState<Workout[]>(DEFAULT_WORKOUTS);
  const [selectedWorkout, setSelectedWorkout] = useState<string>(() => getDefaultWorkout());
  const [dayLogs, setDayLogs] = useState<Record<string, DayLog>>({});
  const [showMealModal, setShowMealModal] = useState(false);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [mealForm, setMealForm] = useState({ time: '', name: '', protein: '', fat: '', carbs: '', calories: '', sugar: '' });
  const [showMealSuggestions, setShowMealSuggestions] = useState(false);
  const [isAnalyzingFood, setIsAnalyzingFood] = useState(false);
  const [foodAnalysisError, setFoodAnalysisError] = useState<string | null>(null);
  const [showScanOptions, setShowScanOptions] = useState(false);
  const [foodHint, setFoodHint] = useState('');
  const [streakDetailDate, setStreakDetailDate] = useState<string | null>(null);
  // Недели в еде — нативная горизонтальная прокрутка со снапом по неделе:
  // соседние недели выглядывают по краям, так видно, что ряд листается.
  const streakScrollRef = useRef<HTMLDivElement | null>(null);
  const streakScrollInitRef = useRef(false);
  const streakSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [streakActiveIdx, setStreakActiveIdx] = useState(-1);
  const STREAK_PEEK = 22; // сколько px соседней недели видно с каждого края
  const STREAK_GAP = 8;
  const streakStep = (el: HTMLDivElement) => (el.clientWidth - STREAK_PEEK * 2) + STREAK_GAP;
  // Тап по строке блюда: название «дочитывается», стирая правую часть на пару
  // секунд, затем всё возвращается как было.
  // Анкета питания/здоровья + опрос-ассистент
  const [nutritionProfile, setNutritionProfile] = useState<NutritionProfile | null>(null);
  const [showNutritionSurvey, setShowNutritionSurvey] = useState(false);
  // Опрос — живой диалог с ИИ: он задаёт вопросы по одному, с быстрыми ответами
  const [surveyChat, setSurveyChat] = useState<{ role: 'user' | 'assistant'; content: string; error?: boolean }[]>([]);
  const surveyRetryRef = useRef<{ role: 'user' | 'assistant'; content: string }[] | null>(null);
  const [surveyOptions, setSurveyOptions] = useState<string[]>([]);
  const [surveyBusy, setSurveyBusy] = useState(false);
  const [surveyInput, setSurveyInput] = useState('');
  const [surveyResult, setSurveyResult] = useState<NutritionProfile | null>(null);

  const surveyTurn = async (nextMessages: { role: 'user' | 'assistant'; content: string }[]) => {
    setSurveyBusy(true);
    setSurveyOptions([]);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 50000);
      const res = await fetch('/api/food/survey-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (data?.success) {
        surveyRetryRef.current = null;
        setSurveyChat([...nextMessages, { role: 'assistant', content: data.message }]);
        setSurveyOptions(Array.isArray(data.options) ? data.options : []);
        if (data.done && data.profile) {
          setSurveyResult({ ...data.profile, completedAt: '' });
        }
      } else {
        surveyRetryRef.current = nextMessages;
        setSurveyChat([...nextMessages, { role: 'assistant', content: 'Не получилось получить ответ. Нажми «Повторить».', error: true }]);
      }
    } catch {
      surveyRetryRef.current = nextMessages;
      setSurveyChat([...nextMessages, { role: 'assistant', content: 'Не получилось связаться с сервером. Нажми «Повторить».', error: true }]);
    } finally {
      setSurveyBusy(false);
    }
  };
  const openSurvey = () => {
    setSurveyChat([]);
    setSurveyOptions([]);
    setSurveyResult(null);
    setSurveyInput('');
    setShowNutritionSurvey(true);
    surveyTurn([]);
  };
  // iOS замораживает вебвью в фоне и рвёт запрос — при возврате на экран
  // автоматически повторяем недоставленный ход, пользователю ничего жать не надо.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && showNutritionSurvey && surveyRetryRef.current && !surveyBusy) {
        surveyTurn(surveyRetryRef.current);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNutritionSurvey, surveyBusy]);

  const answerSurvey = (text: string) => {
    const t = text.trim();
    if (!t || surveyBusy || surveyResult) return;
    setSurveyInput('');
    const next = [...surveyChat.filter(m => !m.error).map(m => ({ role: m.role, content: m.content })), { role: 'user' as const, content: t }];
    setSurveyChat(next);
    surveyTurn(next);
  };

    // Показатели здоровья: давление + пульсоксиметр
  // «О себе» для ИИ: год рождения, рост, пол — хранится в User (/api/settings)
  const [aboutMe, setAboutMe] = useState<{ birthYear: string; heightCm: string; sex: string }>({ birthYear: '', heightCm: '', sex: '' });
  useEffect(() => {
    fetch('/api/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return;
        setAboutMe({
          birthYear: d.birthYear ? String(d.birthYear) : '',
          heightCm: d.heightCm ? String(d.heightCm) : '',
          sex: d.sex || '',
        });
      })
      .catch(() => { /* офлайн */ });
  }, []);
  const saveAboutMe = async (patch: Record<string, unknown>) => {
    try {
      await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    } catch { /* офлайн */ }
  };

  const [vitals, setVitals] = useState<VitalEntry[]>([]);
  // Самонаблюдение: свои поля и значения по дням
  const [checkinFields, setCheckinFields] = useState<CheckinField[]>([]);
  const [checkinEntries, setCheckinEntries] = useState<CheckinEntry[]>([]);
  // Курсы препаратов и отметки приёма
  const [medCourses, setMedCourses] = useState<MedCourse[]>([]);
  const [medLogs, setMedLogs] = useState<MedLog[]>([]);

    // Рецепты: свои и распарсенные ИИ с фото
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [openRecipeId, setOpenRecipeId] = useState<string | null>(null);
  const [showRecipeForm, setShowRecipeForm] = useState(false);
  const [recipeParsing, setRecipeParsing] = useState(false);
  const [recipeParseError, setRecipeParseError] = useState<string | null>(null);
  const [recipeForm, setRecipeForm] = useState({ name: '', servings: '1', ingredients: '', steps: '', calories: '', protein: '', fat: '', carbs: '', sugar: '', category: 'другое' });
  const [recipeFilter, setRecipeFilter] = useState<string>('all');
  const recipePhotoRef = useRef<HTMLInputElement | null>(null);

    // «Программа»: ИИ-генерация новой программы тренировок + архив старых
  const [programArchive, setProgramArchive] = useState<ArchivedProgram[]>([]);
  const [showProgramModal, setShowProgramModal] = useState(false);
  const [programWishes, setProgramWishes] = useState('');
  const [programDays, setProgramDays] = useState(4);
  /**
   * Продвинутый режим: суперсеты, дропсеты, работа до отказа.
   *
   * Выбор делается перед каждой генерацией и намеренно НЕ запоминается:
   * готовность к такой нагрузке зависит от того, как идёт восстановление
   * прямо сейчас, а не от прошлого решения.
   */
  const [programAdvanced, setProgramAdvanced] = useState(false);
  /**
   * Правка одной тренировки, предложенная ассистентом. Применяется
   * только по кнопке: подменять тренировку молча нельзя.
   */
  const [workoutEdit, setWorkoutEdit] = useState<WorkoutEdit | null>(null);
  /** Вопрос, который другой раздел подставляет в чат ИИ («Обсудить цель с ИИ»). */
  const [chatDraft, setChatDraft] = useState<string | null>(null);
  const clearChatDraft = useCallback(() => setChatDraft(null), []);
  /** Состояние кольца Oura: подключено ли и последние дни показателей. */
  const [oura, setOura] = useState<{
    configured: boolean;
    connected: boolean;
    lastSyncAt: string | null;
    days: { date: string; totalSleepMin: number | null; readinessScore: number | null; restingHr: number | null; hrvMs: number | null }[];
  } | null>(null);
  const [ouraBusy, setOuraBusy] = useState(false);
  const [applyingEdit, setApplyingEdit] = useState(false);
  const [programLoading, setProgramLoading] = useState(false);
  const [programError, setProgramError] = useState<string | null>(null);
  const [programProposal, setProgramProposal] = useState<{
    rationale: string;
    workouts: { focus: string; exercises: { name: string; plannedSets: string; restTime: string; notes: string; supersetId?: string; toFailure?: boolean; dropSet?: boolean }[] }[];
  } | null>(null);
  const [expandedArchiveId, setExpandedArchiveId] = useState<string | null>(null);

    const [peekMealId, setPeekMealId] = useState<string | null>(null);
  // Вторая фаза: разрешаем перенос строк только после того, как правая часть
  // доехала (иначе название на миг прыгало в две строки).
  const [peekWrapId, setPeekWrapId] = useState<string | null>(null);
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peekWrapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peekMeal = (id: string) => {
    if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    if (peekWrapTimerRef.current) clearTimeout(peekWrapTimerRef.current);
    if (peekMealId === id) {
      setPeekMealId(null);
      setPeekWrapId(null);
      return;
    }
    setPeekMealId(id);
    setPeekWrapId(null);
    peekWrapTimerRef.current = setTimeout(() => setPeekWrapId(id), 370);
    peekTimerRef.current = setTimeout(() => { setPeekMealId(null); setPeekWrapId(null); }, 2600);
  };
  // Ровный ряд кнопок T1..T7: ширину колонки считаем целыми пикселями.
  // Через grid/flex с долями 1fr браузер раздаёт остаток (39.70 / 39.71 /
  // 39.72), и квадратики выглядят разной ширины.
  const TX_WCOL_GAP = 8;   // промежуток между кнопками ряда
  const TX_WCOL_MIN = 44;  // кнопка не уже своей высоты — иначе не квадрат
  const wselRef = useRef<HTMLDivElement | null>(null);
  const wselWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wselRef.current;
    const wrap = wselWrapRef.current;
    if (!el || !wrap) return;
    const fit = () => {
      const n = el.children.length;
      if (!n) return;
      // Считаем от РЯДА, а не от самой ленты: лента тянется flex, и её
      // ширина зависит от результата — из-за этого кнопки вылезали за край.
      const row = wrap.parentElement;
      if (!row) return;
      const rowStyle = getComputedStyle(row);
      const rowGap = parseFloat(rowStyle.columnGap || rowStyle.gap || '8') || 8;
      let free = row.clientWidth - parseFloat(rowStyle.paddingLeft || '0') - parseFloat(rowStyle.paddingRight || '0');
      for (const sib of Array.from(row.children)) {
        if (sib === wrap) continue;
        free -= sib.getBoundingClientRect().width + rowGap;
      }
      // Ниже TX_WCOL_MIN кнопки не сжимаем: вместо этого список
      // тренировок прокручивается по горизонтали, а настройки и ИИ
      // остаются на своих местах и доступны без прокрутки.
      const w = Math.max(TX_WCOL_MIN, Math.floor((free - TX_WCOL_GAP * (n - 1)) / n));
      el.style.setProperty('--tx-wcol', w + 'px');
      // Затухание у правого края показываем только когда лента длиннее
      // видимой части — иначе оно висело бы поверх последней кнопки.
      wrap.classList.toggle('is-scrollable', el.scrollWidth > el.clientWidth + 1);
    };
    fit();
    // Долистали до конца — затухание убираем: справа больше ничего нет.
    const onScroll = () => {
      const more = el.scrollWidth - el.clientWidth - el.scrollLeft > 1;
      wrap.classList.toggle('is-scrollable', more);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    ro.observe(wrap);
    return () => { ro.disconnect(); el.removeEventListener('scroll', onScroll); };
  });

  const workoutStripRef = useRef<HTMLDivElement | null>(null);
  // Ленту позиционируем ОДИН раз при входе в раздел: показываем неделю,
  // заканчивающуюся сегодняшним днём. По нажатию на дату лента больше не
  // прокручивается — выбранный день просто подсвечивается и открываются его
  // данные, а строка дат остаётся на месте под пальцем.
  const stripPlacedRef = useRef(false);
  useEffect(() => {
    if (view !== 'workout') { stripPlacedRef.current = false; return; }
    if (!todayStr || stripPlacedRef.current) return;
    const el = workoutStripRef.current;
    if (!el) return;
    const apply = () => {
      const sel = el.querySelector('[data-selchip="1"]') as HTMLElement | null;
      if (sel) el.scrollLeft = Math.max(0, sel.offsetLeft + sel.offsetWidth - el.clientWidth);
      else el.scrollLeft = el.scrollWidth;
      stripPlacedRef.current = true;
    };
    apply();
    const raf = requestAnimationFrame(apply);
    const t = setTimeout(apply, 120);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [view, todayStr]);
  const [showFoodAssistant, setShowFoodAssistant] = useState(false);
  const [foodRecommendations, setFoodRecommendations] = useState<{
    analysis: string;
    suggestions: Array<{
      name: string;
      description: string;
      protein: number;
      fat: number;
      carbs: number;
      calories: number;
      isFavorite: boolean;
      reason?: string;
    }>;
    tip: string;
    warning?: string | null;
  } | null>(null);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const foodImageInputRef = useRef<HTMLInputElement>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [isLoaded, setIsLoaded] = useState(false);
  const [progressHistory, setProgressHistory] = useState<ProgressHistory>({});
  const [showWorkoutEditor, setShowWorkoutEditor] = useState(false);
  const [editingWorkoutId, setEditingWorkoutId] = useState<string | null>(null);
  const [exerciseForm, setExerciseForm] = useState({ name: '', plannedSets: '', restTime: '2-3 мин', notes: '' });
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [stepsAlertPulse, setStepsAlertPulse] = useState(false);
  const [bodyMeasurements, setBodyMeasurements] = useState<BodyMeasurement[]>([]);
  const [plannerEvents, setPlannerEventsRaw] = useState<PlannerEvent[]>([]);
  const [exerciseLibrary, setExerciseLibrary] = useState<Record<string, string>>({});

  /**
   * Библиотека картинок — отдельным запросом, не в общем GET /api/fitness.
   *
   * У активного пользователя это больше мегабайта base64, а меняется она
   * раз в месяц: пока она ехала вместе с тренировками, каждый запуск
   * приложения ждал мегабайты, чтобы показать сегодняшний день.
   *
   * ETag держим в localStorage вместе с самой библиотекой: сервер на
   * повторный заход отвечает 304 без тела, и картинки берутся локально.
   */
  const loadExerciseLibrary = useCallback(async () => {
    const LIB_KEY = 'fitness_exlib';
    const TAG_KEY = 'fitness_exlib_etag';

    /** Подставить картинки в уже показанные упражнения. */
    const applyToWorkouts = (lib: Record<string, string>) => {
      if (!lib || Object.keys(lib).length === 0) return;
      setWorkouts(prev => {
        let changed = false;
        const next = prev.map(w => ({
          ...w,
          exercises: w.exercises.map(ex => {
            if (ex.imageUrl) return ex;
            const img = findLibImage(lib, ex.name);
            if (!img) return ex;
            changed = true;
            return { ...ex, imageUrl: img };
          }),
        }));
        // Без этой проверки новый массив на каждый вызов дёргал бы
        // автосейв и перерисовку всех карточек впустую.
        return changed ? next : prev;
      });
    };

    let cached: Record<string, string> = {};
    let etag = '';
    try {
      cached = JSON.parse(localStorage.getItem(LIB_KEY) || '{}');
      etag = localStorage.getItem(TAG_KEY) || '';
    } catch { /* повреждённый кэш — считаем, что его нет */ }
    // Показываем кэш сразу, не дожидаясь сети.
    if (Object.keys(cached).length > 0) {
      setExerciseLibrary(cached);
      applyToWorkouts(cached);
    }

    try {
      const r = await fetch('/api/fitness/exercise-library', {
        headers: etag ? { 'If-None-Match': etag } : {},
      });
      // 304 — кэш актуален. Картинки уже подставлены выше; повторно
      // ничего не пишем, иначе мегабайтный setItem тормозил бы запуск.
      if (r.status === 304) return;
      if (!r.ok) return;
      const lib = (await r.json()).exerciseLibrary as Record<string, string>;
      setExerciseLibrary(lib || {});
      applyToWorkouts(lib);
      try {
        localStorage.setItem(LIB_KEY, JSON.stringify(lib || {}));
        const tag = r.headers.get('etag');
        if (tag) localStorage.setItem(TAG_KEY, tag);
      } catch {
        // Квота переполнена: кэшировать не удалось. Чтобы в следующий раз
        // не прийти со старым ETag к несохранённой библиотеке, забываем и его.
        try { localStorage.removeItem(TAG_KEY); } catch { /* и это не вышло */ }
      }
    } catch { /* офлайн — остаёмся на кэше */ }
  }, []);

  /**
   * Отправить одну новую картинку. Шлём только её, а не всю библиотеку:
   * сервер сам смёржит с уже сохранёнными.
   */
  const saveExerciseImage = useCallback(async (name: string, dataUrl: string) => {
    try {
      const r = await fetch('/api/fitness/exercise-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: { [name]: dataUrl } }),
      });
      // Библиотека изменилась — прошлый ETag больше не годится.
      if (r.ok) { try { localStorage.removeItem('fitness_exlib_etag'); } catch { /* quota */ } }
    } catch { /* офлайн — картинка осталась в состоянии, уедет при следующем добавлении */ }
  }, []);

  /**
   * Архив программ — нужен только на экране «История программ».
   *
   * В localStorage его НЕ кладём, хотя ETag на сервере для него есть.
   * Замер на реальных данных: библиотека 1034 КБ + архив 841 КБ + бэкап
   * дня 2736 КБ = 4611 КБ при квоте ~5120 КБ. Архив вытеснил бы бэкап
   * журнала тренировки, а он важнее: архив всегда можно забрать с
   * сервера, записанные офлайн подходы — нельзя.
   *
   * Грузим лениво: только когда пользователь открыл экран профиля.
   */
  const archiveLoadedRef = useRef(false);
  // Актуальный архив для записи: setState асинхронный, а сразу после
  // дозагрузки нужно построить полный массив на отправку.
  const programArchiveRef = useRef<ArchivedProgram[]>([]);
  programArchiveRef.current = programArchive;
  const loadProgramArchive = useCallback(async () => {
    if (archiveLoadedRef.current) return;
    archiveLoadedRef.current = true;
    try {
      const r = await fetch('/api/fitness/program-archive');
      if (!r.ok) { archiveLoadedRef.current = false; return; }
      const arch = (await r.json()).programArchive;
      if (Array.isArray(arch)) {
        setProgramArchive(arch);
        programArchiveRef.current = arch;
      }
    } catch {
      // Офлайн — архив не критичен для тренировки, попробуем ещё раз позже.
      archiveLoadedRef.current = false;
    }
  }, []);

  // Архив грузим при первом открытии профиля — там единственный экран,
  // где он показывается («История программ»).
  useEffect(() => {
    if (view === 'profile') void loadProgramArchive();
  }, [view, loadProgramArchive]);

  // ИИ-группы мышц по названиям упражнений (ключ — имя в нижнем регистре).
  // Кэш в localStorage; недостающие имена классифицируются одним batch-запросом.
  const [muscleGroups, setMuscleGroups] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem('fitness_muscle_groups') || '{}'); } catch { return {}; }
  });
  const muscleFetchAttempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    const allNames = [...new Set(workouts.flatMap(w => w.exercises.map(e => e.name.trim())))].filter(Boolean);
    const unknown = allNames.filter(n => !muscleGroups[n.toLowerCase()] && !muscleFetchAttempted.current.has(n.toLowerCase()));
    if (unknown.length === 0) return;
    const timer = setTimeout(async () => {
      unknown.forEach(n => muscleFetchAttempted.current.add(n.toLowerCase()));
      try {
        const res = await fetch('/api/fitness/muscle-groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names: unknown }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.groups || Object.keys(data.groups).length === 0) return;
        setMuscleGroups(prev => {
          const next = { ...prev, ...data.groups };
          try { localStorage.setItem('fitness_muscle_groups', JSON.stringify(next)); } catch { /* нет места — не критично */ }
          return next;
        });
      } catch { /* офлайн — попробуем при следующем изменении тренировок */ }
    }, 1500);
    return () => clearTimeout(timer);
  }, [workouts, muscleGroups]);
  const [imageModal, setImageModal] = useState<{ url: string; name: string } | null>(null);
  /** Выбор нового фото из просмотрщика — input лежит вне модалки. */
  const imageReplaceRef = useRef<HTMLInputElement | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const plannerLoadedFromServer = useRef(false);
  const plannerUserChanged = useRef(false);
  const setPlannerEvents = useCallback((events: PlannerEvent[]) => {
    if (plannerLoadedFromServer.current) {
      plannerUserChanged.current = true;
      userMadeChangeRef.current = true;
    }
    setPlannerEventsRaw(events);
  }, []);
  const [showMeasurementModal, setShowMeasurementModal] = useState(false);
  const [editingMeasurement, setEditingMeasurement] = useState<BodyMeasurement | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings>({ language: 'ru', timezone: 'Europe/Moscow' });

  // Per-user daily goal — falls back to app-wide defaults until the user
  // saves their own in Profile. Shadowing the module-level fallback name
  // means every existing reference to MACRO_TARGETS below picks up the
  // user's numbers without touching every call site.
  const MACRO_TARGETS: MacroGoal = userSettings.goal ?? MACRO_TARGETS_FALLBACK;
  // Настройки профиля: сразу в состояние, затем на сервер. Офлайн не страшен —
  // локальное значение уже применено, при следующем изменении уйдёт снова.
  const updateSettings = (patch: Partial<Pick<UserSettings, 'language' | 'theme' | 'timezone' | 'goalType' | 'goal' | 'name'>>) => {
    setUserSettings(s => ({ ...s, ...patch }));
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => { /* офлайн */ });
  };
  // Последний записанный вес — для блока «На чём основана цель» в профиле.
  const latestWeight = useMemo(() => {
    const last = bodyMeasurements
      .filter(m => typeof m.weight === 'number' && m.weight > 0)
      .reduce<BodyMeasurement | null>((best, m) => (!best || m.date > best.date ? m : best), null);
    if (!last?.weight) return null;
    const date = new Date(last.date)
      .toLocaleDateString(userSettings.language === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' });
    return { kg: last.weight, date };
  }, [bodyMeasurements, userSettings.language]);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);

  // Theme — applied via .night-mode on <body>. 'auto' tracks the clock
  // (dark 22:00–06:00). 'light'/'dark' force the theme regardless of time.
  const themePref: 'light' | 'dark' | 'auto' = userSettings.theme ?? 'auto';
  useEffect(() => {
    const apply = () => {
      let dark: boolean;
      if (themePref === 'dark') dark = true;
      else if (themePref === 'light') dark = false;
      else { const hour = new Date().getHours(); dark = hour >= 22 || hour < 6; }
      setIsNightMode(dark);
      document.body.classList.toggle('night-mode', dark);
    };
    apply();
    if (themePref !== 'auto') return;
    const interval = setInterval(apply, 60000);
    return () => clearInterval(interval);
  }, [themePref]);
  // Accordion: only one exercise expanded at a time. Clicking the same one
  // collapses it. Reset when the day or workout changes.
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(null);
  /**
   * Режим показа связки: кругами (по умолчанию) или обычными карточками.
   *
   * Кругами — как суперсет делают: A1 → сразу A2 → отдых → следующий
   * круг. Отдельные карточки оставлены на случай, когда нужно поправить
   * заметку, картинку или посмотреть тренд по одному упражнению.
   */
  const [supersetByRounds, setSupersetByRounds] = useState<Record<string, boolean>>({});
  /** Сигнал запуска отдыха после круга: ключ связки → счётчик нажатий. */
  const [supersetRest, setSupersetRest] = useState<Record<string, number>>({});
  // Выбранный показатель в карточке «Мой прогресс» (по макету).
  const [bodyMetric, setBodyMetric] = useState<'weight' | 'waist' | 'chest'>('weight');
  const serverDataLoadedRef = useRef(false);
  const userMadeChangeRef = useRef(false); // Only sync after user actually changes something on THIS device
  const [nutritionRecommendations, setNutritionRecommendations] = useState<NutritionRecommendation[] | null>(null);
  // План «когда и что есть»: приёмы пищи от ИИ под цель и анкету.
  // Кэш на день в localStorage, правки пользователя (блюдо/порции)
  // сохраняются туда же — план живёт отдельно от дневника.
  const [aiNutritionPlan, setAiNutritionPlan] = useState<PlanMeal[] | null>(null);
  // Раскрытые карточки рецептов в разделе «Рецепты».
  const [openRecipeCards, setOpenRecipeCards] = useState<string[]>([]);
  // Последняя добавленная из рецепта порция — для «Отменить».
  const [recipeUndo, setRecipeUndo] = useState<{ meal: NutritionMeal; date: string; name: string } | null>(null);
  // ИИ-список рекомендуемых продуктов под цель (заменяет статичный DEFAULT_FOOD_PRODUCTS)
  const [aiFoodProducts, setAiFoodProducts] = useState<FoodProduct[] | null>(null);
  const aiPlanFetchingRef = useRef(false);
  const [showNightMealPrompt, setShowNightMealPrompt] = useState(false);
  const [pendingMealData, setPendingMealData] = useState<Meal | null>(null);

  // Translation helper
  const t = (key: keyof typeof translations.ru) => translations[userSettings.language][key];
  const stepsAlertRef = useRef<HTMLDivElement | null>(null);
  const profileDropdownRef = useRef<HTMLDivElement | null>(null);

  const dateKey = formatDate(selectedDate);

  // Hydrate dayLogs from the per-row store. This is the bridge between the
  // new per-row data and the old UI: we merge per-row truths on top of
  // dayLogs JSON so the UI always sees the latest state, even when the
  // legacy JSON hasn't caught up. Defined here (above loadData) so we can
  // also call it right after a server GET — that closes the race window
  // where setDayLogs(serverData) would otherwise wipe an in-progress
  // workoutDraft for the few seconds before the next interval tick.
  const hydrateFromLocalDB = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      const { getLocalDB } = await import('@/lib/local-db');
      const db = getLocalDB();
      const [wRows, dRows] = await Promise.all([
        db.workoutLogs.toArray(),
        db.dayLogs.toArray(),
      ]);
      if (wRows.length === 0 && dRows.length === 0) return;

      setDayLogs(prev => {
        const next: Record<string, DayLog> = { ...prev };
        let changed = false;
        // Присваиваем только если день реально отличается — иначе identity
        // остаётся прежней и React не перерисовывает поддеревья зря.
        const assign = (date: string, candidate: DayLog) => {
          if (JSON.stringify(prev[date]) !== JSON.stringify(candidate)) {
            next[date] = candidate;
            changed = true;
          }
        };
        // Merge workoutLogs → reconstruct workoutDraft.exercises per date.
        const byDate = new Map<string, typeof wRows>();
        for (const r of wRows) {
          const arr = byDate.get(r.date) ?? [];
          arr.push(r);
          byDate.set(r.date, arr);
        }
        for (const [date, rows] of byDate) {
          const base: DayLog = next[date] ?? prev[date] ?? { date, selectedWorkout: null, workoutCompleted: null, workoutRating: null, workoutSnapshot: null, workoutDraft: null, meals: [], notes: '', steps: null, dayClosed: false, isOffDay: false };
          // workoutId может быть неизвестен у старых записей — НЕ пропускаем
          // день из-за этого, иначе подходы «теряются» для LAST/графика.
          const workoutId = rows.find(r => r.workoutId)?.workoutId ?? base.workoutDraft?.workoutId ?? base.selectedWorkout ?? '';
          const existingExercises = base.workoutDraft?.exercises ?? base.workoutSnapshot?.exercises ?? [];
          const exMap = new Map(existingExercises.map(e => [e.id, { ...e }]));
          // Шаблон тренировки — чтобы восстановить упражнение, если его нет в
          // блобе (иначе сохранённые в WorkoutLogEntry подходы «терялись» и
          // «прошлый раз» не показывался).
          const templateExercises = workouts.find(w => w.id === workoutId)?.exercises ?? [];
          const templateById = new Map(templateExercises.map(e => [e.id, e]));
          for (const r of rows) {
            let prevEx = exMap.get(r.exerciseId);
            if (!prevEx) {
              // создаём упражнение из шаблона (или минимальную заглушку)
              const tpl = templateById.get(r.exerciseId);
              prevEx = tpl
                ? { ...tpl }
                : ({ id: r.exerciseId, name: '', plannedSets: '', actualSets: '', newWeight: '', restTime: '', notes: '', feedback: '', completed: false } as Exercise);
              exMap.set(r.exerciseId, prevEx);
            }
            prevEx.completed = r.completed;
            if (r.actualSets !== null && r.actualSets !== undefined) {
              if (Array.isArray(r.actualSets)) prevEx.sets = r.actualSets as ExerciseSet[];
              else prevEx.actualSets = r.actualSets as string;
            }
            if (r.notes !== null && r.notes !== undefined) prevEx.notes = r.notes;
          }
          if (!base.dayClosed) {
            assign(date, {
              ...base,
              workoutDraft: {
                workoutId,
                workoutName: base.workoutDraft?.workoutName ?? base.workoutSnapshot?.workoutName ?? '',
                exercises: Array.from(exMap.values()),
              },
            });
          }
        }
        // Merge dayLog kinds (dayClosed, workoutCompleted, workoutSnapshot, steps, etc).
        for (const r of dRows) {
          const base: DayLog = next[r.date] ?? prev[r.date] ?? { date: r.date, selectedWorkout: null, workoutCompleted: null, workoutRating: null, workoutSnapshot: null, workoutDraft: null, meals: [], notes: '', steps: null, dayClosed: false, isOffDay: false };
          const patch: Partial<DayLog> = {};
          if (r.kind === 'dayClosed') patch.dayClosed = !!r.payload;
          else if (r.kind === 'workoutCompleted') patch.workoutCompleted = r.payload as string | null;
          else if (r.kind === 'workoutSnapshot') patch.workoutSnapshot = r.payload as WorkoutSnapshot | null;
          else if (r.kind === 'isOffDay') patch.isOffDay = !!r.payload;
          else if (r.kind === 'steps') patch.steps = r.payload as number | null;
          else if (r.kind === 'workoutRating') patch.workoutRating = r.payload as DayLog['workoutRating'];
          else if (r.kind === 'selectedWorkout') patch.selectedWorkout = r.payload as DayLog['selectedWorkout'];
          else if (r.kind === 'notes' && typeof r.payload === 'string') patch.notes = r.payload;
          else if (r.kind === 'meals' && Array.isArray(r.payload)) patch.meals = r.payload as DayLog['meals'];
          assign(r.date, { ...base, ...patch });
        }
        return changed ? next : prev;
      });
    } catch { /* ignore */ }
  }, []);

  // Load data from server or localStorage
  useEffect(() => {
    const loadData = async () => {
      // МГНОВЕННО показываем локальную копию (Dexie), не дожидаясь сервера.
      // GET /api/fitness тяжёлый и на мобильной сети идёт секунды — без этого
      // календарь и отметки тренировок выглядят «пустыми», пока грузится ответ.
      hydrateFromLocalDB();
      try {
        // Flush any queued local writes BEFORE asking the server for its
        // merged view. Otherwise the GET may return a snapshot that's missing
        // the most recent offline edits, and the wholesale setDayLogs below
        // would wipe an in-progress day for a few seconds until Dexie
        // hydration catches up.
        try { await flushNow(); } catch { /* offline / transient — keep going */ }
        const response = await fetch('/api/fitness');
        if (response.ok) {
          const data = await response.json();
          if (data.habits) setHabits(data.habits);
          if (data.nutritionProfile) setNutritionProfile(data.nutritionProfile);
          if (Array.isArray(data.recipes)) setRecipes(data.recipes);
          if (Array.isArray(data.vitals)) setVitals(data.vitals);
          if (Array.isArray(data.checkinFields)) setCheckinFields(data.checkinFields);
          if (Array.isArray(data.checkinEntries)) setCheckinEntries(data.checkinEntries);
          if (Array.isArray(data.medCourses)) setMedCourses(data.medCourses);
          if (Array.isArray(data.medLogs)) setMedLogs(data.medLogs);
          if (data.workouts) setWorkouts(withPlannedTechniques(data.workouts));
          // Библиотека картинок и архив программ приезжают отдельными
          // запросами: это мегабайты, которые не нужны, чтобы показать
          // сегодняшнюю тренировку. Картинки подставляем по приходу.
          if (data.hasExerciseLibrary) void loadExerciseLibrary();
          if (data.dayLogs) setDayLogs(prev => mergeServerDayLogs(prev, data.dayLogs));
          if (data.progressHistory) setProgressHistory(data.progressHistory);
          if (data.bodyMeasurements) setBodyMeasurements(data.bodyMeasurements);
          if (data.plannerEvents) {
            setPlannerEventsRaw(data.plannerEvents);
            plannerLoadedFromServer.current = true;
          }
          if (data.settings) setUserSettings(data.settings);
          if (data.nutritionRecommendations) setNutritionRecommendations(data.nutritionRecommendations);
          serverDataLoadedRef.current = true;
          setIsLoaded(true);
          setSyncStatus('synced');
          // Belt-and-suspenders: even after the pre-GET flush there can be
          // rows in Dexie that hadn't queued an op yet (e.g. just-typed value
          // not yet committed to pendingOps). Run hydrate now so the UI shows
          // the full state instantly instead of waiting up to 5s.
          hydrateFromLocalDB();
          return;
        }
      } catch (e) {
        console.error('Failed to load from server:', e);
      }

      // ОФЛАЙН-ФОЛБЭК: сервер недоступен — поднимаем последнюю локальную
      // копию (пишется при каждом изменении). Программа тренировок, упражнения
      // и их картинки работают без интернета; свежие отметки доклеит Dexie.
      try {
        const raw = localStorage.getItem('fitness_backup');
        if (raw) {
          const b = JSON.parse(raw);
          // Офлайн-старт: шаблоны берём из бэкапа, только если сервер ещё
          // ни разу не отвечал в этой сессии (иначе перетрём свежую программу).
          // Библиотека картинок лежит отдельным ключом (fitness_exlib) —
          // в самом бэкапе её больше нет, чтобы не упираться в квоту.
          // Старый бэкап мог ещё содержать её внутри: читаем оба варианта.
          let lib: Record<string, string> = {};
          try {
            lib = JSON.parse(localStorage.getItem('fitness_exlib') || '{}');
          } catch { /* битый кэш */ }
          if (Object.keys(lib).length === 0 && b.exerciseLibrary && typeof b.exerciseLibrary === 'object') {
            lib = b.exerciseLibrary as Record<string, string>;
          }
          if (Array.isArray(b.workouts) && b.workouts.length && !serverDataLoadedRef.current) {
            // подставляем картинки из сохранённой библиотеки, как при обычной загрузке
            for (const w of b.workouts as Workout[]) {
              for (const ex of w.exercises) {
                if (!ex.imageUrl) {
                  const img = findLibImage(lib, ex.name);
                  if (img) ex.imageUrl = img;
                }
              }
            }
            setWorkouts(withPlannedTechniques(b.workouts));
          }
          if (Object.keys(lib).length > 0) setExerciseLibrary(lib);
          if (b.dayLogs && typeof b.dayLogs === 'object') setDayLogs(prev => mergeServerDayLogs(prev, b.dayLogs));
          if (b.progressHistory) setProgressHistory(b.progressHistory);
          if (Array.isArray(b.bodyMeasurements) && b.bodyMeasurements.length) setBodyMeasurements(b.bodyMeasurements);
        }
      } catch { /* битый бэкап — работаем с тем, что есть */ }
      setIsLoaded(true);
      hydrateFromLocalDB();
    };
    loadData();
  }, [hydrateFromLocalDB]);

  // Real-time sync: poll server every 5s, update ALL data if user isn't editing.
  // SAFETY: also skips when a save is in flight or there's a pending debounce —
  // overwriting unsaved local edits with stale server state was wiping out
  // gym sessions.
  useEffect(() => {
    if (!isLoaded) return;
    const interval = setInterval(async () => {
      if (userMadeChangeRef.current) return; // user actively editing on this device
      if (syncInFlightRef.current) return;   // wait for in-progress save to complete
      if (syncTimeoutRef.current) return;    // pending debounced save not flushed yet
      try {
        // Same flush-before-GET guard as the initial load — otherwise an
        // offline window could come back online and the poll would race the
        // outbox flush, wiping the in-progress draft.
        try { await flushNow(); } catch { /* keep going */ }
        const response = await fetch('/api/fitness');
        if (response.ok) {
          const data = await response.json();
          // Re-check the guards AFTER the network round-trip — the user may have
          // started editing while we were waiting for the response. Without this
          // check we'd still overwrite their fresh edits.
          if (userMadeChangeRef.current || syncInFlightRef.current || syncTimeoutRef.current) return;
          serverDataLoadedRef.current = true; // после офлайн-старта связь вернулась — автосейв снова разрешён
          if (data.workouts) {
            // Подставляем фото из библиотеки, как при первичной загрузке.
            // GET срезает вшитые картинки, и без этой подстановки поллинг
            // затирал тренировки «голыми» шаблонами — только что добавленное
            // фото «исчезало» с экрана через минуту (в базе оставаясь целым).
            // Библиотека больше не приходит в этом ответе — берём ту, что
            // уже в состоянии (её грузит loadExerciseLibrary с ETag).
            const pollLib = exerciseLibraryRef.current;
            for (const w of data.workouts as Workout[]) {
              for (const ex of w.exercises) {
                if (!ex.imageUrl) {
                  const libImg = findLibImage(pollLib, ex.name);
                  if (libImg) ex.imageUrl = libImg;
                }
              }
            }
            setWorkouts(withPlannedTechniques(data.workouts));
          }
          if (data.dayLogs) setDayLogs(prev => mergeServerDayLogs(prev, data.dayLogs));
          if (data.progressHistory) setProgressHistory(data.progressHistory);
          if (data.bodyMeasurements) setBodyMeasurements(data.bodyMeasurements);
          if (data.plannerEvents) setPlannerEventsRaw(data.plannerEvents);
          if (data.habits) setHabits(data.habits);
          // Re-hydrate from Dexie immediately so any per-row writes that the
          // server didn't acknowledge yet survive the merge above.
          hydrateFromLocalDB();
        }
      } catch { /* silent */ }
    // Полный GET тяжёлый (мегабайты) — опрашиваем раз в минуту. Лёгкий
    // построчный diff-синк (pullDiff в startSyncLoop) остаётся каждые 5с и
    // приносит свежие отметки тренировок почти мгновенно.
    }, 60000);
    return () => clearInterval(interval);
  }, [isLoaded, hydrateFromLocalDB]);

  // Offline-first sync loop (new per-row system, running in parallel with the
  // legacy dayLogs JSON sync). Writes go local first via upsertWorkoutLog/
  // upsertDayLog, queue up, and flush in the background. The poller pulls
  // diffs from the server and merges. When this is fully wired through the UI
  // the legacy POST/polling path can be retired.
  const [pendingOpsCount, setPendingOpsCount] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    startSyncLoop(5000);
    // Light UI indicator: re-check pending count every 2s so the user sees
    // when their edits are in the queue vs fully synced.
    const tick = setInterval(async () => {
      try { setPendingOpsCount(await getPendingOpsCount()); } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(tick);
  }, []);

  // Periodic re-hydrate from the per-row store to catch newly-pulled diffs.
  // The hydrate function itself is defined above (next to loadData) so both
  // can call it without forward-reference issues.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isLoaded) return;
    hydrateFromLocalDB();
    const id = setInterval(hydrateFromLocalDB, 5000);
    return () => clearInterval(id);
  }, [isLoaded, hydrateFromLocalDB]);

  // Update selectedDate and todayStr when timezone changes or on initial load
  useEffect(() => {
    const todayInTz = getTodayInTimezone(userSettings.timezone);
    const todayKey = formatDate(todayInTz);
    setTodayStr(todayKey);

    if (isLoaded) {
      const currentDateKey = formatDate(selectedDate);
      // Only update if we're on "today" in a different timezone
      if (currentDateKey !== todayKey) {
        // Check if we should auto-update (only on initial load or if date was "today")
        const now = new Date();
        const localToday = formatDate(now);
        if (currentDateKey === localToday) {
          setSelectedDate(todayInTz);
        }
      }
    }
  }, [userSettings.timezone, isLoaded]);


  // Автообновление WebView: iOS держит приложение в фоне днями и страницу не
  // перезагружает — свежие деплои не доезжают до пользователя. При возврате
  // после ≥5 минут в фоне сверяем сборку с сервером; вышла новая — reload.
  // Данные не теряются: состояние уже улетело beacon-ом при уходе в фон,
  // черновики лежат в Dexie/outbox.
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (!hiddenAt || Date.now() - hiddenAt < 5 * 60 * 1000) return;
      hiddenAt = 0;
      fetch('/api/version', { cache: 'no-store' })
        .then(r => r.json())
        .then((v: { sha?: string }) => {
          const mine = process.env.NEXT_PUBLIC_BUILD_SHA;
          if (v?.sha && mine && v.sha !== 'dev' && mine !== 'dev' && v.sha !== mine) {
            window.location.reload();
          }
        })
        .catch(() => { /* офлайн — проверим в следующий раз */ });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // «Сегодня» устаревает, если приложение висело в фоне до следующего дня или
  // прошла полночь: без обновления «Сегодня» в ленте дат и выбранный день
  // остаются вчерашними, и тренировка/еда пишутся на вчерашнюю дату.
  // Проверяем при возврате в приложение и раз в минуту.
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const todayStrRef = useRef(todayStr);
  todayStrRef.current = todayStr;
  const lastInteractionRef = useRef(0);
  useEffect(() => {
    const refreshToday = () => {
      const prev = todayStrRef.current;
      if (!prev) return;
      const nowInTz = getTodayInTimezone(userSettings.timezone);
      const nowKey = formatDate(nowInTz);
      if (nowKey === prev) return;
      // Тренировка «через полночь»: пока пользователь активен (последние 20 минут),
      // не перекидываем его на новый день посреди сессии — сдвинем, когда затихнет.
      if (Date.now() - lastInteractionRef.current < 20 * 60 * 1000) return;
      setTodayStr(nowKey);
      if (formatDate(selectedDateRef.current) === prev) {
        setSelectedDate(nowInTz);
      }
    };
    const onVis = () => { if (document.visibilityState === 'visible') refreshToday(); };
    const onInteract = () => { lastInteractionRef.current = Date.now(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', refreshToday);
    window.addEventListener('pageshow', refreshToday);
    document.addEventListener('touchstart', onInteract, { passive: true, capture: true });
    document.addEventListener('mousedown', onInteract, { capture: true });
    const id = setInterval(refreshToday, 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', refreshToday);
      window.removeEventListener('pageshow', refreshToday);
      document.removeEventListener('touchstart', onInteract, { capture: true });
      document.removeEventListener('mousedown', onInteract, { capture: true });
      clearInterval(id);
    };
  }, [userSettings.timezone]);

  // Sync to server with debounce
  const exerciseLibraryRef = useRef(exerciseLibrary);
  exerciseLibraryRef.current = exerciseLibrary;
  const habitsRef = useRef(habits);
  habitsRef.current = habits;

  const syncToServer = useCallback(async (workoutsData: Workout[], dayLogsData: Record<string, DayLog>, progressData: ProgressHistory, measurementsData: BodyMeasurement[], plannerData?: PlannerEvent[]) => {
    setSyncStatus('syncing');
    try {
      const payload: Record<string, unknown> = { workouts: workoutsData, dayLogs: dayLogsData, progressHistory: progressData, bodyMeasurements: measurementsData };
      if (plannerData !== undefined && plannerUserChanged.current) {
        payload.plannerEvents = plannerData;
        plannerUserChanged.current = false;
      }
      // Библиотеку картинок здесь НЕ отправляем: она уходит сразу при
      // добавлении картинки через /api/fitness/exercise-library. Раньше она
      // ехала с каждым автосейвом — отметка одного подхода в зале гнала на
      // сервер мегабайт и перезаписывала всю строку в БД.
      if (habitsRef.current.length > 0) {
        payload.habits = habitsRef.current;
      }
      const response = await fetch('/api/fitness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        setSyncStatus('synced');
        // Reset flag so polling can resume after 3 seconds of inactivity
        setTimeout(() => { userMadeChangeRef.current = false; }, 3000);
      } else {
        setSyncStatus('error');
      }
    } catch (e) {
      console.error('Failed to sync to server:', e);
      setSyncStatus('error');
    }
  }, []);

  // Sync with debounce — saves to localStorage immediately, syncs to server after 1.5s pause
  const syncTimeoutRef = useRef<NodeJS.Timeout>(null);
  const syncInFlightRef = useRef(false);

  useEffect(() => {
    if (!isLoaded || !serverDataLoadedRef.current || !userMadeChangeRef.current) return;

    // Save to localStorage IMMEDIATELY (offline-safe)
    try {
      // Без библиотеки картинок: она лежит отдельным ключом (fitness_exlib),
      // а мегабайт base64 здесь съедал квоту localStorage (~5 МБ) и ронял
      // запись бэкапа целиком — вместе с журналом тренировки, ради которого
      // этот бэкап и нужен.
      localStorage.setItem('fitness_backup', JSON.stringify({ workouts, dayLogs, progressHistory, bodyMeasurements, ts: Date.now() }));
    } catch { /* quota */ }

    // Debounce server sync — 1.5s after last change
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(async () => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      try {
        // 5 second timeout — don't block if offline
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const payload: Record<string, unknown> = { workouts, dayLogs, progressHistory, bodyMeasurements };
        if (plannerUserChanged.current) { payload.plannerEvents = plannerEvents; plannerUserChanged.current = false; }
        // Библиотека картинок идёт своим роутом при добавлении — см. syncToServer.
        if (habitsRef.current.length > 0) payload.habits = habitsRef.current;
        const response = await fetch('/api/fitness', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (response.ok) {
          setSyncStatus('synced');
          setTimeout(() => { userMadeChangeRef.current = false; }, 3000);
        } else {
          setSyncStatus('error');
        }
      } catch {
        setSyncStatus('error');
        // Offline — data safe in localStorage, will sync on next successful attempt
      }
      syncInFlightRef.current = false;
    }, 1500);

    return () => { if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current); };
  }, [workouts, dayLogs, progressHistory, bodyMeasurements, plannerEvents, habits, isLoaded]);

  // Force sync when page is closing
  useEffect(() => {
    // sendBeacon не отправляет большие тела: браузеры ограничивают их 64 КБ
    // и молча отбрасывают всё, что крупнее. Пока сюда попадала библиотека
    // картинок, закрытие приложения с мегабайтом в payload могло потерять
    // записанные подходы. Теперь отправляем только журнал тренировки.
    const handleBeforeUnload = () => {
      if (!isLoaded || !serverDataLoadedRef.current || !userMadeChangeRef.current) return;
      const payload: Record<string, unknown> = { workouts, dayLogs, progressHistory, bodyMeasurements };
      navigator.sendBeacon('/api/fitness', JSON.stringify(payload));
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isLoaded && serverDataLoadedRef.current && userMadeChangeRef.current) {
        const payload: Record<string, unknown> = { workouts, dayLogs, progressHistory, bodyMeasurements };
        navigator.sendBeacon('/api/fitness', JSON.stringify(payload));
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [workouts, dayLogs, progressHistory, bodyMeasurements, isLoaded]);

  // On load: restore from localStorage if server data is behind
  useEffect(() => {
    if (!isLoaded) return;
    try {
      const backup = localStorage.getItem('fitness_backup');
      if (backup) {
        const parsed = JSON.parse(backup);
        if (parsed.ts && Date.now() - parsed.ts < 86400000) {
          const today = formatDate(new Date());
          const backupToday = parsed.dayLogs?.[today];
          const serverToday = dayLogs[today];
          if (backupToday && serverToday) {
            const backupDraft = backupToday.workoutDraft;
            const serverDraft = serverToday.workoutDraft;
            if (backupDraft?.exercises?.some((e: Exercise) => e.completed || e.actualSets) &&
                !serverDraft?.exercises?.some((e: Exercise) => e.completed || e.actualSets)) {
              setDayLogs(prev => ({ ...prev, [today]: backupToday }));
              // Программу из бэкапа НЕ восстанавливаем: сервер — источник
              // истины для шаблонов. Иначе старая (доИИшная) программа
              // воскресала на телефоне, и веса дня писались под чужими
              // названиями упражнений («100 кг отведения гантелей»).
            }
          }
        }
        localStorage.removeItem('fitness_backup');
      }
    } catch { /* ignore */ }
  }, [isLoaded]);

  const currentDayLog = useMemo(() => {
    return dayLogs[dateKey] || { date: dateKey, selectedWorkout: null, workoutCompleted: null, workoutRating: null, workoutSnapshot: null, workoutDraft: null, meals: [], notes: '', steps: null, dayClosed: false, isOffDay: false };
  }, [dayLogs, dateKey]);

  const macroTotals = useMemo(() => {
    const totals = { protein: 0, fat: 0, carbs: 0, calories: 0, sugar: 0 };
    for (const meal of currentDayLog.meals) {
      totals.protein += meal.protein;
      totals.fat += meal.fat;
      totals.carbs += meal.carbs;
      totals.calories += meal.calories;
      totals.sugar += meal.sugar || 0;
    }
    return totals;
  }, [currentDayLog.meals]);

  const macroProgress = useMemo(() => ({
    protein: Math.min(100, (macroTotals.protein / MACRO_TARGETS.protein) * 100),
    fat: Math.min(100, (macroTotals.fat / MACRO_TARGETS.fat) * 100),
    carbs: Math.min(100, (macroTotals.carbs / MACRO_TARGETS.carbs) * 100),
    calories: Math.min(100, (macroTotals.calories / MACRO_TARGETS.calories) * 100),
  }), [macroTotals]);

  // Calculate current week nutrition status and streak
  const { last7Days, streakWeeks, selectedWeekIdx, nutritionStreak } = useMemo(() => {
    if (!todayStr) {
      return { last7Days: [], streakWeeks: [], selectedWeekIdx: 0, nutritionStreak: 0 };
    }

    // Средний процент выполнения макро-цели за день
    const dayCompletionPct = (dateStr: string): number => {
      const log = dayLogs[dateStr];
      if (!log?.meals || log.meals.length === 0) return 0;
      const totals = { protein: 0, fat: 0, carbs: 0, calories: 0 };
      for (const meal of log.meals) {
        totals.protein += meal.protein;
        totals.fat += meal.fat;
        totals.carbs += meal.carbs;
        totals.calories += meal.calories;
      }
      const avg = (
        totals.protein / MACRO_TARGETS.protein +
        totals.fat / MACRO_TARGETS.fat +
        totals.carbs / MACRO_TARGETS.carbs +
        totals.calories / MACRO_TARGETS.calories
      ) / 4;
      return Math.round(avg * 100);
    };
    const isDayCompleted = (dateStr: string): boolean => dayCompletionPct(dateStr) >= 70;

    // Табличка с огоньками и есть календарь еды: недели листаются прокруткой,
    // тап по дню открывает его еду. Строим список недель от 26 недель назад
    // (или раньше, если выбран более старый день) до текущей недели.
    type StreakDay = { date: string; dayName: string; completed: boolean; isToday: boolean; isFuture: boolean; pct: number };
    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const mondayOf = (dateStr: string) => {
      const [y, m, d] = dateStr.split('-').map(Number);
      const a = new Date(y, m - 1, d);
      const dow = a.getDay();
      a.setDate(a.getDate() + (dow === 0 ? -6 : 1 - dow));
      return a;
    };
    const buildWeek = (monday: Date): StreakDay[] => {
      const out: StreakDay[] = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + i);
        const dateStr = formatDate(date);
        const isToday = dateStr === todayStr;
        const isFuture = dateStr > todayStr;
        out.push({
          date: dateStr,
          dayName: dayNames[i],
          completed: isFuture ? false : isDayCompleted(dateStr),
          isToday,
          isFuture,
          pct: isFuture ? 0 : dayCompletionPct(dateStr)
        });
      }
      return out;
    };
    const curMonday = mondayOf(todayStr);
    const selMonday = mondayOf(dateKey);
    const selMondayStr = formatDate(selMonday);
    const first = new Date(curMonday);
    first.setDate(first.getDate() - 7 * 26);
    if (selMonday < first) first.setTime(selMonday.getTime());
    const last = selMonday > curMonday ? selMonday : curMonday;
    const weeks: { monday: string; days: StreakDay[] }[] = [];
    for (const m = new Date(first); m <= last; m.setDate(m.getDate() + 7)) {
      weeks.push({ monday: formatDate(m), days: buildWeek(new Date(m)) });
      if (weeks.length > 300) break;
    }
    const selIdx = Math.max(0, weeks.findIndex(w => w.monday === selMondayStr));
    const days = weeks[selIdx].days;

    // Стрик — независимо от показанной недели: идём от сегодня (или вчера) назад.
    let streak = 0;
    const [ty, tm, td] = todayStr.split('-').map(Number);
    const cur = new Date(ty, tm - 1, td);
    if (!isDayCompleted(todayStr)) cur.setDate(cur.getDate() - 1);
    while (isDayCompleted(formatDate(cur))) {
      streak++;
      cur.setDate(cur.getDate() - 1);
      if (streak > 365) break;
    }

    return { last7Days: days, streakWeeks: weeks, selectedWeekIdx: selIdx, nutritionStreak: streak };
  }, [dayLogs, todayStr, dateKey]);

  // Какая неделя сейчас «в кадре»: пока крутят — та, что под пальцем, иначе выбранная
  const streakShownIdx = streakActiveIdx >= 0 && streakActiveIdx < streakWeeks.length ? streakActiveIdx : selectedWeekIdx;

  // При открытии еды/смене выбранной недели ставим скроллер на нужную неделю
  // (первый раз — мгновенно, дальше — плавно).
  useLayoutEffect(() => {
    if (view !== 'nutrition') { streakScrollInitRef.current = false; return; }
    const el = streakScrollRef.current;
    if (!el || !streakWeeks.length) return;
    const target = selectedWeekIdx * streakStep(el);
    setStreakActiveIdx(selectedWeekIdx);
    if (Math.abs(el.scrollLeft - target) < 4) { streakScrollInitRef.current = true; return; }
    el.scrollTo({ left: target, behavior: streakScrollInitRef.current ? 'smooth' : 'auto' });
    streakScrollInitRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedWeekIdx, streakWeeks.length]);

  const handleStreakScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const idx = Math.max(0, Math.min(streakWeeks.length - 1, Math.round(el.scrollLeft / streakStep(el))));
    setStreakActiveIdx(prev => (prev === idx ? prev : idx));
    if (streakSettleTimer.current) clearTimeout(streakSettleTimer.current);
    streakSettleTimer.current = setTimeout(() => {
      if (idx === selectedWeekIdx) return;
      // Долистали до другой недели — выбранный день сдвигаем на столько же недель
      // (тот же день недели), но не дальше сегодня.
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + 7 * (idx - selectedWeekIdx));
      if (formatDate(d) > todayStr) {
        const [ty, tm, td] = todayStr.split('-').map(Number);
        setSelectedDate(new Date(ty, tm - 1, td));
      } else {
        setSelectedDate(d);
      }
    }, 160);
  };

  // Check if today is close to completing nutrition targets (>= 60%) — always uses today's data, not selected date
  const isTodayCloseToGoal = useMemo(() => {
    if (!todayStr) return false;
    const todayLog = dayLogs[todayStr];
    if (!todayLog?.meals || todayLog.meals.length === 0) return false;
    const totals = { protein: 0, fat: 0, carbs: 0, calories: 0 };
    for (const meal of todayLog.meals) {
      totals.protein += meal.protein;
      totals.fat += meal.fat;
      totals.carbs += meal.carbs;
      totals.calories += meal.calories;
    }
    const avgProgress = (
      Math.min(100, (totals.protein / MACRO_TARGETS.protein) * 100) +
      Math.min(100, (totals.fat / MACRO_TARGETS.fat) * 100) +
      Math.min(100, (totals.carbs / MACRO_TARGETS.carbs) * 100) +
      Math.min(100, (totals.calories / MACRO_TARGETS.calories) * 100)
    ) / 4;
    return avgProgress >= 60;
  }, [dayLogs, todayStr]);

  // Calculate weekly steps (Monday to Sunday)
  const weeklySteps = useMemo(() => {
    const today = selectedDate;
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ...
    // Calculate Monday of current week
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);

    let total = 0;
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const dateStr = formatDate(date);
      const log = dayLogs[dateStr];
      if (log?.steps && log.steps > 0) {
        total += log.steps;
      }
    }
    return total;
  }, [selectedDate, dayLogs]);

  // Fields that have a matching DayLogEntry kind in the per-row store. Mirroring
  // them means a refresh right after a change can't lose the edit — it's in
  // IndexedDB + pending ops + on the server, all three.
  // workoutDraft is deliberately NOT mirrored here because individual exercise
  // edits already go through upsertWorkoutLog (stage 3d) — one row per exercise
  // is much finer-grained than one payload per draft.
  const DAY_LOG_MIRRORED_FIELDS: Array<keyof DayLog> = [
    'dayClosed', 'workoutCompleted', 'workoutSnapshot', 'workoutRating',
    'selectedWorkout', 'isOffDay', 'steps', 'notes', 'meals',
  ];

  const updateDayLog = (updates: Partial<DayLog>) => {
    userMadeChangeRef.current = true;
    setDayLogs(prev => {
      const existingLog = prev[dateKey] || { date: dateKey, selectedWorkout: null, workoutCompleted: null, workoutRating: null, workoutSnapshot: null, workoutDraft: null, meals: [], notes: '', steps: null, dayClosed: false, isOffDay: false };
      return {
        ...prev,
        [dateKey]: { ...existingLog, ...updates }
      };
    });
    // Mirror into the per-row outbox (fire-and-forget).
    for (const field of DAY_LOG_MIRRORED_FIELDS) {
      if (field in updates) {
        upsertDayLog({ date: dateKey, kind: field as string, payload: updates[field] as unknown }).catch(() => {});
      }
    }
  };

  // Select workout and save to dayLog
  // Снимок текущей программы для архива (прогресс дня вычищаем)
  const snapshotCurrentProgram = (): ArchivedProgram => ({
    id: Date.now().toString(),
    archivedAt: new Date().toISOString(),
    label: 'Программа до ' + new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
    workouts: workouts.map(w => ({
      ...w,
      exercises: w.exercises.map(e => ({ ...e, completed: false, actualSets: '', feedback: '', sets: undefined })),
    })),
  });

  const saveProgramChange = async (newWorkouts: Workout[], newArchive: ArchivedProgram[]) => {
    userMadeChangeRef.current = true;
    setWorkouts(newWorkouts);
    setProgramArchive(newArchive);
    setSelectedWorkout(newWorkouts[0]?.id || 't1');
    try {
      await fetch('/api/fitness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workouts: newWorkouts, programArchive: newArchive }),
      });
    } catch { /* доедет обычным автосейвом */ }
  };

  const saveNutritionProfile = async () => {
    if (!surveyResult) return;
    const profile: NutritionProfile = { ...surveyResult, completedAt: new Date().toISOString() };
    setNutritionProfile(profile);
    setShowNutritionSurvey(false);
    // Кэш плана сбрасываем — он пересоберётся под новую анкету. Но блюда,
    // которые пользователь уже выбрал сам, запоминаем: смена времени не
    // должна стирать его выбор. Сопоставляем по названию приёма.
    try {
      const chosen = (aiNutritionPlan || [])
        .filter(item => item.recipeId)
        .map(item => ({
          label: item.label,
          dish: item.dish,
          portions: item.portions,
          recipeId: item.recipeId,
          protein: item.protein,
          fat: item.fat,
          carbs: item.carbs,
          calories: item.calories,
        }));
      if (chosen.length) sessionStorage.setItem('fitness_plan_choices', JSON.stringify(chosen));
      else sessionStorage.removeItem('fitness_plan_choices');
    } catch { /* без переноса выбора — не критично */ }
    try { localStorage.removeItem('fitness_ai_food_plan'); } catch { /* ignore */ }
    setAiNutritionPlan(null);
    setAiFoodProducts(null);
    try {
      await fetch('/api/fitness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nutritionProfile: profile }),
      });
    } catch { /* офлайн — доедет позже, анкета уже в состоянии */ }
  };

    const saveVitals = async (next: VitalEntry[]) => {
    setVitals(next);
    try {
      await fetch('/api/fitness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vitals: next }),
      });
    } catch { /* офлайн — доедет позже */ }
  };

  /**
   * Самонаблюдение и препараты — тем же путём, что vitals: кладём в
   * состояние сразу, отправляем следом. Офлайн не теряется: данные уже
   * на экране, запрос уйдёт при следующем сохранении.
   */
  const saveCheckins = async (fields: CheckinField[], entries: CheckinEntry[]) => {
    setCheckinFields(fields);
    setCheckinEntries(entries);
    try {
      await fetch('/api/fitness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkinFields: fields, checkinEntries: entries }),
      });
    } catch { /* офлайн — доедет позже */ }
  };

  const saveMeds = async (courses: MedCourse[], logs: MedLog[]) => {
    setMedCourses(courses);
    setMedLogs(logs);
    try {
      await fetch('/api/fitness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medCourses: courses, medLogs: logs }),
      });
    } catch { /* офлайн — доедет позже */ }
  };

  // Замеры тела уходят на сервер общим синком (как и раньше из окна замера).
  const saveMeasurement = (m: BodyMeasurement) => {
    userMadeChangeRef.current = true;
    setBodyMeasurements(prev => prev.some(x => x.id === m.id) ? prev.map(x => x.id === m.id ? m : x) : [...prev, m]);
  };
  const deleteMeasurement = (id: string) => {
    userMadeChangeRef.current = true;
    setBodyMeasurements(prev => prev.filter(x => x.id !== id));
  };
  const editMeasurement = (m: BodyMeasurement) => {
    setEditingMeasurement(m);
    setShowMeasurementModal(true);
  };

    const saveRecipes = async (next: Recipe[]) => {
    setRecipes(next);
    try {
      await fetch('/api/fitness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipes: next }),
      });
    } catch { /* офлайн — доедет позже */ }
  };

  const handleRecipePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRecipeParsing(true);
    setRecipeParseError(null);
    try {
      const base64 = await compressImage(file, 1400);
      const res = await fetch('/api/food/recipe-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 }),
      });
      const data = await res.json().catch(() => null);
      if (data?.success && data.recipe) {
        const r: Recipe = {
          id: Date.now().toString(),
          source: 'photo',
          createdAt: new Date().toISOString(),
          ...data.recipe,
        };
        await saveRecipes([r, ...recipes]);
        setOpenRecipeId(r.id);
      } else {
        setRecipeParseError(res.status === 422
          ? 'Не смог разобрать рецепт на этом фото — попробуй снять ровнее и ближе.'
          : 'Не получилось обработать фото, попробуй ещё раз.');
      }
    } catch {
      setRecipeParseError('Сеть недоступна — попробуй ещё раз.');
    } finally {
      setRecipeParsing(false);
    }
  };

  const addManualRecipe = async () => {
    if (!recipeForm.name.trim()) return;
    const r: Recipe = {
      id: Date.now().toString(),
      name: recipeForm.name.trim(),
      servings: Math.max(1, parseInt(recipeForm.servings, 10) || 1),
      ingredients: recipeForm.ingredients.split('\n').map(x => x.trim()).filter(Boolean),
      steps: recipeForm.steps.split('\n').map(x => x.trim()).filter(Boolean),
      perServing: {
        calories: parseFloat(recipeForm.calories) || 0,
        protein: parseFloat(recipeForm.protein) || 0,
        fat: parseFloat(recipeForm.fat) || 0,
        carbs: parseFloat(recipeForm.carbs) || 0,
        sugar: parseFloat(recipeForm.sugar) || 0,
      },
      category: recipeForm.category,
      source: 'manual',
      createdAt: new Date().toISOString(),
    };
    await saveRecipes([r, ...recipes]);
    setShowRecipeForm(false);
    setRecipeForm({ name: '', servings: '1', ingredients: '', steps: '', calories: '', protein: '', fat: '', carbs: '', sugar: '', category: 'другое' });
  };

  const eatRecipe = (r: Recipe) => {
    userMadeChangeRef.current = true;
    const newMeal: Meal = {
      id: Date.now().toString(),
      time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      name: r.name,
      protein: r.perServing.protein,
      fat: r.perServing.fat,
      carbs: r.perServing.carbs,
      calories: r.perServing.calories,
      sugar: r.perServing.sugar,
    };
    updateDayLog({ meals: [...currentDayLog.meals, newMeal] });
    setOpenRecipeId(null);
  };

    const requestProgram = async () => {
    setProgramLoading(true);
    setProgramError(null);
    setProgramProposal(null);
    try {
      const active = workouts.filter(w => w.exercises.length > 0);
      // Статистика для ИИ: последние рабочие подходы по упражнениям + частота
      const cutoffD = new Date(); cutoffD.setDate(cutoffD.getDate() - 60);
      const cutoff = formatDate(cutoffD);
      const latestByName = new Map<string, string>();
      Object.keys(dayLogs).filter(d => d >= cutoff).sort().forEach(d => {
        const log = dayLogs[d];
        for (const src of [log.workoutDraft, log.workoutSnapshot]) {
          src?.exercises?.forEach(e => {
            const sets = (e as { sets?: ExerciseSet[] }).sets;
            if (Array.isArray(sets) && sets.some(st => (st.weight || 0) > 0 || (st.reps || 0) > 0)) {
              latestByName.set(e.name, e.name + ': ' + sets.map(st => (st.reps || 0) + 'x' + (st.weight || 0)).join(', ') + ' (' + d + ')');
            }
          });
        }
      });
      const stats: string[] = Array.from(latestByName.values());
      const wk8 = new Date(); wk8.setDate(wk8.getDate() - 56);
      const wk8s = formatDate(wk8);
      const trainedDays = Object.keys(dayLogs).filter(d => {
        if (d < wk8s) return false;
        const log = dayLogs[d];
        const exs = log?.workoutSnapshot?.exercises ?? log?.workoutDraft?.exercises ?? [];
        return exs.some(e => e.completed);
      }).length;
      stats.push('Тренировочных дней за последние 8 недель: ' + trainedDays + ' (~' + (trainedDays / 8).toFixed(1) + ' в неделю)');

      const res = await fetch('/api/fitness/program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: userSettings.goalType ?? 'maintain',
          wishes: programWishes,
          daysPerWeek: programDays,
          advanced: programAdvanced,
          currentProgram: active.map(w => ({
            name: w.name,
            exercises: w.exercises.map(e => ({ name: e.name, plannedSets: e.plannedSets })),
          })),
          stats: stats.slice(0, 60),
        }),
      });
      const data = await res.json();
      if (data?.success && Array.isArray(data.workouts) && data.workouts.length) {
        setProgramProposal({ rationale: data.rationale || '', workouts: data.workouts });
      } else {
        setProgramError('Не получилось сгенерировать программу. Попробуй ещё раз.');
      }
    } catch {
      setProgramError('Сеть недоступна — попробуй ещё раз.');
    } finally {
      setProgramLoading(false);
    }
  };

  /**
   * Заменить программу предложенной: старая уходит в архив, новая встаёт
   * на её место. Общая дорога для кнопки на экране «Программа» и для
   * предложения из чата — чтобы архив наполнялся одинаково.
   */
  /**
   * Применить правку одной тренировки. В архив НЕ пишем: это не смена
   * программы, а точечное изменение — иначе история заполнилась бы
   * почти одинаковыми копиями после каждой мелкой правки.
   */
  const applyWorkoutEdit = async (edit: WorkoutEdit) => {
    const target = workouts.find(w => w.id === edit.workoutId);
    if (!target) return;
    const updated = workouts.map(w => w.id !== edit.workoutId ? w : {
      ...w,
      exercises: edit.exercises.map((e, j) => {
        // Сохраняем id и картинку упражнения, если оно осталось: по id
        // привязаны записи подходов, а картинку незачем терять.
        const prev = w.exercises.find(x => x.name.trim().toLowerCase() === e.name.trim().toLowerCase());
        return {
          id: prev?.id ?? String(j + 1),
          name: e.name,
          plannedSets: e.plannedSets,
          actualSets: '',
          restTime: e.restTime,
          notes: e.notes ?? '',
          newWeight: '',
          feedback: '',
          completed: false,
          ...(prev?.imageUrl ? { imageUrl: prev.imageUrl } : {}),
          ...(e.supersetId ? { supersetId: e.supersetId } : {}),
        };
      }),
    });
    userMadeChangeRef.current = true;
    setWorkouts(updated);
    try {
      await fetch('/api/fitness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workouts: updated }),
      });
    } catch { /* доедет обычным автосейвом */ }
    // Отмечаем в переписке, иначе ассистент не узнает о решении.
    fetch('/api/chat', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accepted: true, edit: edit.summary }),
    }).catch(() => { /* отметка не критична */ });
  };

  const applyProposedProgram = async (proposal: {
    workouts: { exercises: { name: string; plannedSets: string; restTime: string; notes: string; supersetId?: string; toFailure?: boolean; dropSet?: boolean }[] }[];
  }) => {
    const entry = snapshotCurrentProgram();
    // Архив грузится лениво (только на экране профиля), поэтому здесь его
    // может не быть в состоянии — а строим мы полный массив на запись.
    // Без этой дозагрузки смена программы из чата затёрла бы всю историю.
    await loadProgramArchive();
    const newArchive = [entry, ...programArchiveRef.current].slice(0, 20);
    const newWorkouts: Workout[] = proposal.workouts.map((w, i) => ({
      id: 't' + (i + 1),
      name: 'Тренировка ' + (i + 1),
      exercises: w.exercises.map((e, j) => ({
        id: String(j + 1),
        name: e.name,
        plannedSets: e.plannedSets,
        actualSets: '',
        restTime: e.restTime,
        notes: String(e.notes || '').slice(0, 120),
        newWeight: '',
        feedback: '',
        completed: false,
        // Метки техник живут в самом упражнении, а не только текстом в
        // заметке. Раньше dropSet и toFailure дописывались в notes и
        // терялись как флаги — интерфейс не мог их показать, и дропсет
        // был виден только как строчка мелким шрифтом среди прочего
        // текста. Суперсет отображался именно потому, что его метка
        // сохранялась здесь.
        ...(e.supersetId ? { supersetId: e.supersetId } : {}),
        ...(e.dropSet ? { planDropSet: true } : {}),
        ...(e.toFailure ? { planToFailure: true } : {}),
      })),
    }));
    await saveProgramChange(newWorkouts, newArchive);
  };

  const acceptProgram = async () => {
    if (!programProposal) return;
    const proposal = programProposal;
    setProgramProposal(null);
    setShowProgramModal(false);
    await applyProposedProgram(proposal);
    // Отмечаем решение в переписке: иначе ассистент видит только «собрал
    // программу, пользователь решает» и при следующем вопросе предлагает
    // составить её заново, хотя она уже принята.
    fetch('/api/chat', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accepted: true, days: proposal.workouts.length }),
    }).catch(() => { /* отметка не критична — программа уже заменена */ });
    // Предложение могло прийти из чата, а там нижнее меню скрыто —
    // после замены показываем главную, где и лежит новая программа.
    if (view === 'chat') {
      setView('workout');
      localStorage.setItem('fitness_view', 'workout');
    }
  };

  const restoreProgram = async (entry: ArchivedProgram) => {
    const current = snapshotCurrentProgram();
    // Вызывается с экрана профиля, где архив уже загружен, но полагаться на
    // это нельзя: пустой архив здесь означал бы потерю истории.
    await loadProgramArchive();
    const newArchive = [current, ...programArchiveRef.current.filter(p => p.id !== entry.id)].slice(0, 20);
    const restored: Workout[] = entry.workouts.map(w => ({
      ...w,
      exercises: w.exercises.map(e => ({ ...e, completed: false, actualSets: '', feedback: '', sets: undefined })),
    }));
    setShowProgramModal(false);
    await saveProgramChange(restored, newArchive);
  };

  const selectWorkout = (workoutId: string) => {
    setSelectedWorkout(workoutId);
    updateDayLog({ selectedWorkout: workoutId });
  };

  // NOTE: Auto-mark-as-rest used to live here. It was too aggressive — just
  // clicking through past dates in the picker would create empty day logs
  // (selectWorkout / date navigation effects below both write into dayLogs),
  // and then the next render pass would see "past day with no progress" and
  // silently close it as a rest day. That nuked workoutDraft on touched days.
  // Re-introducing auto-rest needs a different signal source than the live
  // dayLogs map — e.g. an explicit "last opened" timestamp per day. Leaving
  // the manual Off Day chip as the only way to convert a day to rest until
  // that lands.

  // Get completed workouts in current cycle (last N unique workouts where N = active workout count)
  const completedWorkoutsInCycle = useMemo(() => {
    const completed = new Set<string>();
    const sortedDates = Object.keys(dayLogs).sort((a, b) =>
      new Date(b).getTime() - new Date(a).getTime()
    );
    const activeWorkouts = workouts.filter(w => w.exercises.length > 0);
    const activeWorkoutCount = activeWorkouts.length;

    for (const dateStr of sortedDates) {
      const log = dayLogs[dateStr];
      if (log?.workoutCompleted) {
        completed.add(log.workoutCompleted);
        // Stop when we have all unique workouts
        if (completed.size >= activeWorkoutCount) break;
      }
    }
    return completed;
  }, [dayLogs, workouts]);

  // Get next available workout (not completed in current cycle)
  const getNextAvailableWorkout = useCallback(() => {
    // Find first workout not completed in current cycle
    for (const workout of workouts) {
      if (!completedWorkoutsInCycle.has(workout.id) && workout.exercises.length > 0) {
        return workout.id;
      }
    }
    // If all completed, return first workout
    return workouts[0]?.id || 't1';
  }, [completedWorkoutsInCycle, workouts]);
  // Какую тренировку предложить на дату, которую пользователь ещё не выбирал:
  // следующую по порядку после последней, что он реально делал ДО этого дня.
  // Раньше любая дата кроме сегодняшней молча открывала T1 — и после вчерашней
  // T2 новый день снова показывал T1.
  const getWorkoutForDate = useCallback((targetDate: string) => {
    const active = workouts.filter(w => w.exercises.length > 0);
    if (active.length === 0) return workouts[0]?.id || 't1';

    const prevDates = Object.keys(dayLogs).filter(d => d < targetDate).sort().reverse();
    for (const d of prevDates) {
      const log = dayLogs[d];
      const exercises = log?.workoutSnapshot?.exercises ?? log?.workoutDraft?.exercises ?? [];
      // «Сделанной» считаем тренировку, где отмечено хоть одно упражнение:
      // закрывать день для этого не обязательно.
      if (!exercises.some(e => e.completed)) continue;
      const lastId = log?.workoutSnapshot?.workoutId
        ?? log?.workoutDraft?.workoutId
        ?? log?.workoutCompleted
        ?? log?.selectedWorkout;
      const idx = active.findIndex(w => w.id === lastId);
      if (idx >= 0) return active[(idx + 1) % active.length].id;
      break;
    }
    // Истории нет — обычный цикловой подбор.
    return getNextAvailableWorkout();
  }, [dayLogs, workouts, getNextAvailableWorkout]);

  // Restore selected workout when date changes.
  //
  // CRITICAL: never mutate `workouts` state from this effect.
  //
  // `workouts` is the GLOBAL TEMPLATE (the catalogue of T1..T7 with their
  // planned exercises). It's the same across every day. The auto-sync POST
  // pushes whatever's in `workouts` to the server as the new template, so
  // writing a day's snapshot/draft into `workouts` here would poison the
  // template — every subsequent date would inherit one specific day's
  // exercises, and other days' tabs would mysteriously empty out.
  //
  // Per-day exercise state (which sets were ticked, weights, notes) lives in
  // `currentDayLog.workoutDraft` / `workoutSnapshot`. The render path
  // (displayExercises in the JSX below) already reads from the snapshot for
  // closed days. For open days the workouts template is the right source
  // — completion flags survive via the draft, restored by the draft branch
  // below.
  // Стабильная подпись прогресса драфта дня: эффект ниже перезапускается,
  // когда реально изменился прогресс (или данные дня доехали с сервера),
  // а не когда объект просто пересоздался при очередном мердже.
  const draftSignature = currentDayLog.workoutDraft
    ? currentDayLog.workoutDraft.workoutId + ':' + currentDayLog.workoutDraft.exercises.map(e =>
        e.id + (e.completed ? '1' : '0') +
        (Array.isArray(e.sets) ? e.sets.map(st => (st.completed ? '1' : '0') + (st.reps || 0) + 'x' + (st.weight || 0)).join(',') : '')
      ).join('|')
    : 'none';

  useEffect(() => {
    if (currentDayLog.dayClosed && currentDayLog.workoutCompleted) {
      // Closed day — render reads exercises from the snapshot directly.
      // Don't touch `workouts`.
      setSelectedWorkout(currentDayLog.workoutCompleted);
    } else if (currentDayLog.workoutDraft) {
      // Open day with a saved draft — keep template intact, push only the
      // per-exercise progress (completed/sets/notes) back onto the selected
      // workout's exercises so the UI shows the saved progress.
      setWorkouts(prev => prev.map(w => {
        if (w.id !== currentDayLog.workoutDraft!.workoutId) {
          // Other workouts: keep template, just clear completion flags so
          // checks from another day don't bleed in.
          return { ...w, exercises: w.exercises.map(e => ({ ...e, completed: false, actualSets: '', feedback: '', sets: undefined })) };
        }
        // Selected workout: merge draft progress onto the live template
        // exercises by id. Exercises that exist in template but not in the
        // draft stay as fresh template entries; the draft is the source of
        // truth for progress only.
        const draftById = new Map(currentDayLog.workoutDraft!.exercises.map(e => [e.id, e]));
        return {
          ...w,
          exercises: w.exercises.map(e => {
            const d = draftById.get(e.id);
            if (!d) return { ...e, completed: false, actualSets: '', feedback: '', sets: undefined };
            return { ...e, completed: d.completed, actualSets: d.actualSets, sets: d.sets, notes: d.notes, feedback: d.feedback };
          }),
        };
      }));
      setSelectedWorkout(currentDayLog.workoutDraft.workoutId);
    } else {
      // Day is NOT closed, no draft — clear any completion flags left over
      // from the previously visible day. Do NOT replace exercises, only
      // wipe their progress fields.
      setWorkouts(prev => {
        const dirty = prev.some(w => w.exercises.some(e => e.completed || e.actualSets || e.feedback || e.sets));
        if (!dirty) return prev; // чистить нечего — не пересоздаём объекты (иначе визуальный «рефреш»)
        return prev.map(w => ({
          ...w,
          exercises: w.exercises.map(e => ({ ...e, completed: false, actualSets: '', feedback: '', sets: undefined })),
        }));
      });

      if (currentDayLog.selectedWorkout) {
        setSelectedWorkout(currentDayLog.selectedWorkout);
      } else if (!currentDayLog.isOffDay) {
        // Picker UI only — don't write into the dayLog. Otherwise clicking
        // a past date creates a phantom log entry and the user sees a
        // workout they never picked.
        // Любая дата, а не только сегодня: следующая по порядку после
        // последней выполненной. Новый день больше не открывает всегда T1.
        const fallback = getWorkoutForDate(dateKey);
        setSelectedWorkout(fallback);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, currentDayLog.dayClosed, currentDayLog.workoutCompleted, draftSignature]);

  // Лёгкое восстановление ВЫБОРА тренировки при загрузке данных дня — без
  // перезаписи каталога. setSelectedWorkout с тем же значением React
  // проигнорирует, так что тапы по Т-кнопкам ничего не перерисовывают.
  useEffect(() => {
    if (!currentDayLog.dayClosed && !currentDayLog.workoutDraft && currentDayLog.selectedWorkout) {
      setSelectedWorkout(currentDayLog.selectedWorkout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDayLog.selectedWorkout]);

  // Get unique meals from all days for autocomplete
  const uniqueMeals = useMemo(() => {
    const mealsMap = new Map<string, Meal>();
    Object.values(dayLogs).forEach(log => {
      log.meals?.forEach(meal => {
        const key = meal.name.toLowerCase();
        if (!mealsMap.has(key)) {
          mealsMap.set(key, meal);
        }
      });
    });
    return Array.from(mealsMap.values());
  }, [dayLogs]);

  // Filter meal suggestions based on input
  const mealSuggestions = useMemo(() => {
    if (!mealForm.name || mealForm.name.length < 2) return [];
    const search = mealForm.name.toLowerCase();
    return uniqueMeals
      .filter(m => m.name.toLowerCase().includes(search) && m.name.toLowerCase() !== search)
      .slice(0, 5);
  }, [mealForm.name, uniqueMeals]);

  // Get all unique meals from history sorted by frequency
  const mealHistory = useMemo(() => {
    const history: Record<string, { meal: Meal; count: number; lastDate: string }> = {};

    // Collect meals from all days except today
    Object.entries(dayLogs).forEach(([date, log]) => {
      if (date === dateKey) return; // Skip today
      log.meals?.forEach(meal => {
        const key = meal.name.toLowerCase();
        if (!history[key]) {
          history[key] = { meal, count: 0, lastDate: date };
        }
        history[key].count++;
        // Update lastDate if this date is more recent
        if (date > history[key].lastDate) {
          history[key].lastDate = date;
        }
      });
    });

    // Convert to array and sort by frequency
    return Object.values(history)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [dayLogs, dateKey]);

  // Генерация/загрузка ИИ-плана питания: раз в день или при смене цели/макро-целей.
  useEffect(() => {
    if (!isLoaded || !todayStr) return;
    if (nutritionRecommendations) return; // рекомендации тренера важнее ИИ-плана
    if (!nutritionProfile) return; // без анкеты персональный план не строим — сначала опрос
    const goalKey = userSettings.goalType ?? 'maintain';
    const profileKey = nutritionProfile?.completedAt ?? 'none';
    const targetsKey = [MACRO_TARGETS.protein, MACRO_TARGETS.fat, MACRO_TARGETS.carbs, MACRO_TARGETS.calories].join('-') + ':' + profileKey;
    try {
      const cached = JSON.parse(localStorage.getItem('fitness_ai_food_plan') || 'null');
      if (cached && cached.date === todayStr && cached.goal === goalKey && cached.targets === targetsKey && Array.isArray(cached.items) && cached.items.length) {
        setAiNutritionPlan(cached.items);
        if (Array.isArray(cached.products) && cached.products.length) setAiFoodProducts(cached.products);
        return;
      }
    } catch { /* битый кэш игнорируем */ }
    if (aiPlanFetchingRef.current) return;
    aiPlanFetchingRef.current = true;
    (async () => {
      try {
        const res = await fetch('/api/food/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal: goalKey,
            language: userSettings.language,
            targetMacros: MACRO_TARGETS,
            profile: nutritionProfile,
            foodHistory: mealHistory.map(h => h.meal.name),
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.success && Array.isArray(data.items) && data.items.length) {
          // Блюда, выбранные пользователем до смены расписания, возвращаем
          // на сопоставимые приёмы: менялось время, а не его выбор.
          let items = data.items as PlanMeal[];
          try {
            const saved = JSON.parse(sessionStorage.getItem('fitness_plan_choices') || 'null');
            if (Array.isArray(saved) && saved.length) {
              const byLabel = new Map(saved.map((c: PlanMeal) => [c.label, c]));
              items = items.map(item => {
                const choice = byLabel.get(item.label);
                if (!choice) return item;
                byLabel.delete(item.label);
                return {
                  ...item,
                  dish: choice.dish,
                  recipeId: choice.recipeId,
                  portions: choice.portions,
                  protein: choice.protein,
                  fat: choice.fat,
                  carbs: choice.carbs,
                  calories: choice.calories,
                };
              });
              sessionStorage.removeItem('fitness_plan_choices');
            }
          } catch { /* без переноса — план просто будет новым */ }
          setAiNutritionPlan(items);
          if (Array.isArray(data.products) && data.products.length) setAiFoodProducts(data.products);
          try { localStorage.setItem('fitness_ai_food_plan', JSON.stringify({ date: todayStr, goal: goalKey, targets: targetsKey, items, products: data.products || [] })); } catch { /* quota */ }
        }
      } catch { /* офлайн — покажем статичный план */ }
      finally { aiPlanFetchingRef.current = false; }
    })();
  }, [isLoaded, todayStr, userSettings.goalType, userSettings.language, nutritionRecommendations, MACRO_TARGETS.protein, MACRO_TARGETS.fat, MACRO_TARGETS.carbs, MACRO_TARGETS.calories, mealHistory, nutritionProfile]);

  /** Строки плана для секции «Когда и что есть». */
  const planSlots: PlanSlot[] | null = useMemo(() => {
    if (!aiNutritionPlan) return null;
    return aiNutritionPlan.map(item => ({
      time: item.time,
      label: item.label,
      // Блюдо у пункта плана всегда своё: id пункта и есть id блюда.
      dishId: item.dish ? item.id : null,
      portions: item.portions,
    }));
  }, [aiNutritionPlan]);

  /**
   * Что можно выбрать в плане: предложения ИИ для этих приёмов плюс
   * сохранённые рецепты пользователя. Рецепт даёт кнопку «Рецепт» в строке.
   */
  const planDishes: PlanDish[] = useMemo(() => {
    const fromPlan = (aiNutritionPlan || []).map(item => ({
      id: item.id,
      name: item.dish,
      protein: item.protein,
      fat: item.fat,
      carbs: item.carbs,
      calories: item.calories,
      recipeId: item.recipeId || undefined,
    }));
    const fromRecipes = recipes.map(r => ({
      id: r.id,
      name: r.name,
      protein: r.perServing.protein,
      fat: r.perServing.fat,
      carbs: r.perServing.carbs,
      calories: r.perServing.calories,
      recipeId: r.id,
    }));
    // Рецепт, уже подставленный в план, не дублируем в списке выбора.
    const seen = new Set(fromPlan.map(d => d.recipeId).filter(Boolean));
    return [...fromPlan, ...fromRecipes.filter(d => !seen.has(d.id))];
  }, [aiNutritionPlan, recipes]);

  /** Короткая выжимка из анкеты — блок «Твои предпочтения». */
  const preferencesSummary = useMemo(() => {
    const p = nutritionProfile;
    if (!p) return '';
    const parts: string[] = [];
    if (p.mealsPerDay) parts.push(`${p.mealsPerDay} приёма в день`);
    if (p.conditions?.length) parts.push(p.conditions.join(', '));
    if (p.intolerances?.length) parts.push(`не подходит: ${p.intolerances.join(', ')}`);
    if (p.dietStyle) parts.push(p.dietStyle);
    if (p.trainingTime) parts.push(`тренировки ${p.trainingTime}`);
    if (p.dislikes) parts.push(`не ест: ${p.dislikes}`);
    if (p.notes) parts.push(p.notes);
    return parts.join(' · ');
  }, [nutritionProfile]);

  /** Рецепты для новой секции: в списке — КБЖУ на одну порцию. */
  const recipeCards: RecipeCard[] = useMemo(() => recipes.map(r => ({
    id: r.id,
    name: r.name,
    servings: r.servings,
    // Время приготовления необязательное — если его нет, не выдумываем.
    durationMinutes: (r as Recipe & { durationMinutes?: number }).durationMinutes ?? null,
    ingredients: r.ingredients,
    steps: r.steps,
    perServing: r.perServing,
  })), [recipes]);

  /** Подпись под «Добавить 1 порцию»: в какой день уйдёт запись. */
  const selectedDateText = useMemo(
    () => selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
    [selectedDate],
  );
  /**
   * Правка плана: выбор другого блюда или числа порций. План — это
   * намерение, а не факт: записи в дневник не добавляются, дневные итоги и
   * огонёк не меняются. Сохраняем в тот же кэш, откуда план читается при
   * загрузке, чтобы правки пережили перезагрузку.
   */
  const updatePlanSlot = (index: number, patch: { dishId?: string; portions?: number }) => {
    setAiNutritionPlan(prev => {
      if (!prev) return prev;
      const next = prev.map((item, i) => {
        if (i !== index) return item;
        const updated: PlanMeal = { ...item };
        if (patch.portions !== undefined) updated.portions = patch.portions;
        if (patch.dishId !== undefined && patch.dishId !== item.id) {
          // Блюдо заменили на сохранённый рецепт: берём его название и
          // КБЖУ одной порции, связь с рецептом даёт кнопку «Рецепт».
          const recipe = recipes.find(r => r.id === patch.dishId);
          if (recipe) {
            updated.dish = recipe.name;
            updated.recipeId = recipe.id;
            updated.protein = recipe.perServing.protein;
            updated.fat = recipe.perServing.fat;
            updated.carbs = recipe.perServing.carbs;
            updated.calories = recipe.perServing.calories;
          } else {
            // Вернули исходное предложение ИИ для этого приёма.
            const original = prev.find(p => p.id === patch.dishId);
            if (original) {
              updated.dish = original.dish;
              updated.recipeId = null;
              updated.protein = original.protein;
              updated.fat = original.fat;
              updated.carbs = original.carbs;
              updated.calories = original.calories;
            }
          }
        }
        return updated;
      });
      try {
        const raw = JSON.parse(localStorage.getItem('fitness_ai_food_plan') || 'null');
        if (raw && typeof raw === 'object') {
          localStorage.setItem('fitness_ai_food_plan', JSON.stringify({ ...raw, items: next }));
        }
      } catch { /* quota или битый кэш — план останется на этот сеанс */ }
      return next;
    });
  };

  // Тост «порция добавлена» живёт недолго и исчезает при смене дня:
  // отменять добавление в другой день уже не имеет смысла.
  useEffect(() => {
    if (!recipeUndo) return;
    if (recipeUndo.date !== dateKey) { setRecipeUndo(null); return; }
    const t = setTimeout(() => setRecipeUndo(null), 7000);
    return () => clearTimeout(t);
  }, [recipeUndo, dateKey]);

  /** Раскрыть/свернуть карточку рецепта в разделе «Рецепты». */
  const toggleRecipeCard = (id: string) => {
    setOpenRecipeCards(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  /**
   * «Добавить 1 порцию»: ровно одна порция рецепта в дневник ВЫБРАННОГО дня.
   * Пересчёт итогов и огонька делает сам дневник, карточка остаётся
   * раскрытой, добавление можно отменить.
   */
  const addRecipePortion = (recipe: RecipeCard) => {
    const operationId = `recipe-${recipe.id}-${Date.now()}`;
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const meal: NutritionMeal = {
      id: operationId,
      time,
      name: recipe.name,
      protein: recipe.perServing.protein,
      fat: recipe.perServing.fat,
      carbs: recipe.perServing.carbs,
      calories: recipe.perServing.calories,
      sugar: recipe.perServing.sugar ?? null,
      photoStamp: null,
      portionGrams: null,
      basePortion: null,
    };
    nutSaveMeal(meal, { date: dateKey, operationId });
    setRecipeUndo({ meal, date: dateKey, name: recipe.name });
  };

  /** Отмена только что добавленной из рецепта порции. */
  const undoRecipePortion = () => {
    if (!recipeUndo) return;
    nutDeleteMeal(recipeUndo.meal);
    setRecipeUndo(null);
  };
  const updateExercise = (workoutId: string, exerciseId: string, updates: Partial<Exercise>) => {
    userMadeChangeRef.current = true;
    // Связку закрываем, только когда она пройдена целиком — иначе
    // карточка схлопывалась бы посреди кругов, после первого же
    // упражнения.
    //
    // Обычное упражнение НЕ схлопываем прямо здесь: в этот момент как
    // раз запускается отдых, и вместе с карточкой исчезал бы таймер —
    // выглядело как «отметил, а время не пошло». Переход к следующему
    // делает goToNextExercise, когда отдых закончится.
    if (updates.completed === true) {
      setExpandedExerciseId(prevId => {
        const list = workouts.find(w => w.id === workoutId)?.exercises ?? [];
        const done = list.find(e => e.id === exerciseId);
        if (done?.supersetId && prevId === `${workoutId}-${done.supersetId}`) {
          const inGroup = list.filter(e => e.supersetId === done.supersetId);
          const allDone = inGroup.every(e => e.id === exerciseId || e.completed);
          return allDone ? null : prevId;
        }
        return prevId;
      });
    }
    setWorkouts(prev => {
      const updated = prev.map(w =>
        w.id === workoutId
          ? { ...w, exercises: w.exercises.map(e => e.id === exerciseId ? { ...e, ...updates } : e) }
          : w
      );
      // Save draft to dayLog so exercise state survives date navigation
      if (!currentDayLog.dayClosed) {
        const workout = updated.find(w => w.id === workoutId);
        if (workout) {
          const draft: WorkoutSnapshot = {
            workoutId: workout.id,
            workoutName: workout.name,
            exercises: JSON.parse(JSON.stringify(workout.exercises)),
          };
          updateDayLog({ workoutDraft: draft });
          // Parallel write into the new per-row system — the row carries
          // only this single exercise's latest state so polling can't wipe
          // it, and the outbox keeps it safe across offline periods.
          const ex = workout.exercises.find(e => e.id === exerciseId);
          if (ex) {
            // Per-set table replaces the free-text actualSets for new edits.
            // We pack the structured sets array into the same JSON column
            // (actualSets) so existing diff-sync infrastructure keeps working.
            // When the new array is present we ignore the legacy string.
            const payload: unknown = ex.sets && ex.sets.length > 0 ? ex.sets : (ex.actualSets ?? null);
            upsertWorkoutLog({
              date: dateKey,
              exerciseId,
              workoutId,
              completed: !!ex.completed,
              actualSets: payload as never,
              notes: ex.notes ?? null,
            }).catch(() => { /* stays in queue */ });
          }
        }
      }
      return updated;
    });
  };

  // Check if it's late night (00:00 - 05:00) for meal prompt
  const isLateNight = () => {
    const hour = new Date().getHours();
    return hour >= 0 && hour < 5;
  };

  // Add meal to specific date
  const addMealToDate = (meal: Meal, targetDateKey: string) => {
    userMadeChangeRef.current = true;
    setDayLogs(prev => {
      const targetLog = prev[targetDateKey] || { date: targetDateKey, selectedWorkout: null, workoutCompleted: null, workoutRating: null, workoutSnapshot: null, workoutDraft: null, meals: [], notes: '', steps: null, dayClosed: false, isOffDay: false };
      const updatedMeals = [...(targetLog.meals || []), meal];
      // Mirror the new meals array into the per-row store (cross-date add,
      // so we can't go through updateDayLog which targets dateKey only).
      upsertDayLog({ date: targetDateKey, kind: 'meals', payload: updatedMeals }).catch(() => {});
      return {
        ...prev,
        [targetDateKey]: { ...targetLog, meals: updatedMeals }
      };
    });
  };

  const addMeal = () => {
    userMadeChangeRef.current = true;
    const newMeal: Meal = {
      id: Date.now().toString(),
      time: mealForm.time || new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      name: mealForm.name,
      protein: parseFloat(mealForm.protein) || 0,
      fat: parseFloat(mealForm.fat) || 0,
      carbs: parseFloat(mealForm.carbs) || 0,
      calories: parseFloat(mealForm.calories) || 0,
      sugar: parseFloat(mealForm.sugar) || 0,
    };

    if (editingMeal) {
      updateDayLog({ meals: currentDayLog.meals.map(m => m.id === editingMeal.id ? { ...newMeal, id: editingMeal.id } : m) });
      setShowMealModal(false);
      setEditingMeal(null);
      setMealForm({ time: '', name: '', protein: '', fat: '', carbs: '', calories: '', sugar: '' });
    } else if (isLateNight() && !editingMeal) {
      // Late night - ask which day to log
      setPendingMealData(newMeal);
      setShowMealModal(false);
      setShowNightMealPrompt(true);
      setMealForm({ time: '', name: '', protein: '', fat: '', carbs: '', calories: '', sugar: '' });
    } else {
      updateDayLog({ meals: [...currentDayLog.meals, newMeal] });
      setShowMealModal(false);
      setEditingMeal(null);
      setMealForm({ time: '', name: '', protein: '', fat: '', carbs: '', calories: '', sugar: '' });
    }
  };

  // Handle night meal day selection
  const handleNightMealDaySelect = (useYesterday: boolean) => {
    if (!pendingMealData) return;

    if (useYesterday) {
      // Get yesterday's date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayKey = formatDate(yesterday);
      addMealToDate(pendingMealData, yesterdayKey);
    } else {
      // Add to current day (today)
      updateDayLog({ meals: [...currentDayLog.meals, pendingMealData] });
    }

    setPendingMealData(null);
    setShowNightMealPrompt(false);
  };

  // --- Экран «Питание» по макету: состояние и мосты к сервисам приложения ---
  const [nutDialogOpen, setNutDialogOpen] = useState(false);
  const [nutEditing, setNutEditing] = useState<NutritionMeal | null>(null);
  const [nutUndo, setNutUndo] = useState<{ meal: Meal; date: string } | null>(null);

  // Приёмы пищи по датам в формате нового экрана.
  const nutMealsByDate = useMemo(() => {
    const out: Record<string, NutritionMeal[]> = {};
    for (const [key, log] of Object.entries(dayLogs)) {
      const list = (log?.meals || []) as Meal[];
      if (!list.length) continue;
      out[key] = list.map(m => ({
        id: m.id, time: m.time, name: m.name,
        protein: m.protein, fat: m.fat, carbs: m.carbs, calories: m.calories,
        sugar: m.sugar ?? null,
        isFavorite: !!m.isFavorite,
        photoStamp: (m as unknown as { photoStamp?: NutritionMeal['photoStamp'] }).photoStamp ?? null,
        captureKind: (m as unknown as { captureKind?: NutritionMeal['captureKind'] }).captureKind,
        portionGrams: (m as unknown as { portionGrams?: number | null }).portionGrams ?? null,
        basePortion: (m as unknown as { basePortion?: NutritionMeal['basePortion'] }).basePortion ?? null,
      }));
    }
    return out;
  }, [dayLogs]);

  // Частые продукты: самые повторяемые записи за историю.
  const nutQuickFrequent = useMemo(() => {
    const counts = new Map<string, { meal: NutritionMeal; n: number }>();
    for (const list of Object.values(nutMealsByDate)) {
      for (const m of list) {
        const key = m.name.trim().toLowerCase();
        if (!key) continue;
        const hit = counts.get(key);
        if (hit) hit.n++; else counts.set(key, { meal: m, n: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 8).map(x => x.meal);
  }, [nutMealsByDate]);

  const nutQuickFavorites = useMemo(
    () => Object.values(nutMealsByDate).flat().filter(m => m.isFavorite)
      .filter((m, i, all) => all.findIndex(x => x.name === m.name) === i).slice(0, 8),
    [nutMealsByDate]);

  // Сохранение записи: один operationId — одна запись. Повтор сохранения
  // и повторный ответ ИИ обновляют ту же запись, а не создают вторую.
  const nutSaveMeal = useCallback(async (meal: NutritionMeal, ctx: { date: string; operationId: string }) => {
    userMadeChangeRef.current = true;
    const record: Meal = {
      id: meal.id,
      time: meal.time,
      name: meal.name,
      protein: meal.protein, fat: meal.fat, carbs: meal.carbs, calories: meal.calories,
      sugar: meal.sugar ?? undefined,
    };
    const extra = {
      photoStamp: meal.photoStamp ?? undefined,
      captureKind: meal.captureKind,
      portionGrams: meal.portionGrams ?? undefined,
      basePortion: meal.basePortion ?? undefined,
    };
    const full = { ...record, ...extra } as Meal;
    await new Promise<void>((resolve, reject) => {
      try {
        setDayLogs(prev => {
          const base = prev[ctx.date] || { date: ctx.date, selectedWorkout: null, workoutCompleted: null, workoutRating: null, workoutSnapshot: null, workoutDraft: null, meals: [], notes: '', steps: null, dayClosed: false, isOffDay: false };
          const list = (base.meals || []) as Meal[];
          const at = list.findIndex(x => x.id === meal.id);
          const meals = at >= 0 ? list.map(x => x.id === meal.id ? full : x) : [...list, full];
          upsertDayLog({ date: ctx.date, kind: 'meals', payload: meals }).catch(() => {});
          return { ...prev, [ctx.date]: { ...base, meals } };
        });
        resolve();
      } catch (e) { reject(e as Error); }
    });
    if (ctx.date !== dateKey) setSelectedDate(new Date(`${ctx.date}T12:00:00`));
  }, [dateKey]);

  // Анализ фото/этикетки существующим сервисом приложения.
  const nutAnalyze = useCallback(async (args: { file: File; mode: 'food' | 'label'; hint: string; signal: AbortSignal }) => {
    // Декодирование не должно подвешивать окно: если браузер не осилил файл
    // за 10 секунд, показываем понятную ошибку вместо вечного спиннера.
    const base64Image = await Promise.race([
      compressImage(args.file, args.mode === 'label' ? 1200 : 800),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('decode timeout')), 10000)),
    ]);
    const response = await fetch('/api/food/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image, type: args.mode === 'label' ? 'nutrition_label' : 'food_photo', hint: args.hint || undefined }),
      signal: args.signal,
    });
    const result = await response.json();
    if (!response.ok) {
      // Ошибка СЕРВЕРА (нет ключа ИИ, лимит, сбой модели) — это не обрыв
      // сети: показываем пользователю настоящую причину, а не «нет связи».
      const err = new Error(result?.error || `Сервис анализа недоступен (${response.status})`);
      err.name = 'ServiceError';
      throw err;
    }
    if (!result?.success || !result?.data) {
      // Еду определить нельзя — запись не создаётся, показываем причину.
      const err = new Error(result?.error || 'unrecognized');
      err.name = 'UnrecognizedFood';
      throw err;
    }
    const d = result.data;
    return {
      name: String(d.name || ''),
      protein: Number(d.protein), fat: Number(d.fat), carbs: Number(d.carbs),
      calories: Number(d.calories),
      // Неизвестные показатели не подменяем нулями.
      sugar: d.sugar === null || d.sugar === undefined ? null : Number(d.sugar),
      weight: d.weight === null || d.weight === undefined ? null : Number(d.weight),
    };
  }, []);

  // Удаление с отменой: запись возвращается на ту же дату.
  const nutDeleteMeal = useCallback((meal: NutritionMeal) => {
    userMadeChangeRef.current = true;
    const date = dateKey;
    const existing = ((dayLogs[date]?.meals || []) as Meal[]).find(m => m.id === meal.id);
    if (!existing) return;
    setNutUndo({ meal: existing, date });
    setDayLogs(prev => {
      const base = prev[date];
      if (!base) return prev;
      const meals = (base.meals || []).filter(m => m.id !== meal.id);
      upsertDayLog({ date, kind: 'meals', payload: meals }).catch(() => {});
      return { ...prev, [date]: { ...base, meals } };
    });
  }, [dateKey, dayLogs]);

  // Избранное — флаг на самой записи (как в остальном приложении).
  const nutToggleFavorite = useCallback((meal: NutritionMeal) => {
    userMadeChangeRef.current = true;
    const date = dateKey;
    setDayLogs(prev => {
      const base = prev[date];
      if (!base) return prev;
      const meals = (base.meals || []).map(m => m.id === meal.id ? { ...m, isFavorite: !m.isFavorite } : m);
      upsertDayLog({ date, kind: 'meals', payload: meals }).catch(() => {});
      return { ...prev, [date]: { ...base, meals } };
    });
  }, [dateKey]);

  const nutRestoreMeal = useCallback(() => {
    if (!nutUndo) return;
    const { meal, date } = nutUndo;
    setNutUndo(null);
    userMadeChangeRef.current = true;
    setDayLogs(prev => {
      const base = prev[date] || { date, selectedWorkout: null, workoutCompleted: null, workoutRating: null, workoutSnapshot: null, workoutDraft: null, meals: [], notes: '', steps: null, dayClosed: false, isOffDay: false };
      const meals = [...(base.meals || []), meal];
      upsertDayLog({ date, kind: 'meals', payload: meals }).catch(() => {});
      return { ...prev, [date]: { ...base, meals } };
    });
  }, [nutUndo]);

  const deleteMeal = (mealId: string) => {
    userMadeChangeRef.current = true;
    updateDayLog({ meals: currentDayLog.meals.filter(m => m.id !== mealId) });
  };

  const openEditMeal = (meal: Meal) => {
    setEditingMeal(meal);
    setMealForm({
      time: meal.time,
      name: meal.name,
      protein: meal.protein.toString(),
      fat: meal.fat.toString(),
      carbs: meal.carbs.toString(),
      sugar: (meal.sugar ?? 0).toString(),
      calories: meal.calories.toString(),
    });
    setShowMealModal(true);
  };

  // Food AI Analysis
  const compressImage = (file: File, maxSize = 800): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('No canvas context')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = reject;
      img.src = url;
    });
  };

  const analyzeFood = async (file: File, type: 'nutrition_label' | 'food_photo', hint?: string) => {
    setIsAnalyzingFood(true);
    setFoodAnalysisError(null);
    setShowScanOptions(false);

    try {
      // Compress image to max 800px, JPEG 70% quality — much faster upload
      const base64Image = await compressImage(file, type === 'nutrition_label' ? 1200 : 800);

      const response = await fetch('/api/food/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image, type, hint: hint || undefined }),
      });

      const result = await response.json();

      if (result.success && result.data) {
        setMealForm({
          time: mealForm.time || new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
          name: result.data.name,
          protein: result.data.protein.toString(),
          fat: result.data.fat.toString(),
          carbs: result.data.carbs.toString(),
          calories: result.data.calories.toString(),
          sugar: (result.data.sugar ?? 0).toString(),
        });
      } else {
        setFoodAnalysisError(result.error || 'Не удалось распознать');
      }
    } catch (error) {
      console.error('Food analysis error:', error);
      setFoodAnalysisError('Ошибка при анализе фото');
    } finally {
      setIsAnalyzingFood(false);
    }
  };

  const handleFoodImageSelect = (e: React.ChangeEvent<HTMLInputElement>, type: 'nutrition_label' | 'food_photo') => {
    const file = e.target.files?.[0];
    if (file) {
      analyzeFood(file, type, foodHint);
      setFoodHint(''); // Clear hint after use
    }
    // Reset input
    if (foodImageInputRef.current) {
      foodImageInputRef.current.value = '';
    }
  };

  // Determine current meal time based on hour
  const getMealTime = (): 'morning' | 'day' | 'evening' | 'night' => {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'day';
    if (hour >= 18 && hour < 22) return 'evening';
    return 'night';
  };

  // Get AI food recommendations
  const getFoodRecommendations = async () => {
    setIsLoadingRecommendations(true);
    setFoodRecommendations(null);
    setShowFoodAssistant(true);

    try {
      const remainingMacros = {
        protein: Math.max(0, MACRO_TARGETS.protein - macroTotals.protein),
        fat: Math.max(0, MACRO_TARGETS.fat - macroTotals.fat),
        carbs: Math.max(0, MACRO_TARGETS.carbs - macroTotals.carbs),
        calories: Math.max(0, MACRO_TARGETS.calories - macroTotals.calories)
      };

      const currentMacros = {
        protein: macroTotals.protein,
        fat: macroTotals.fat,
        carbs: macroTotals.carbs,
        calories: macroTotals.calories
      };

      const targetMacros = {
        protein: MACRO_TARGETS.protein,
        fat: MACRO_TARGETS.fat,
        carbs: MACRO_TARGETS.carbs,
        calories: MACRO_TARGETS.calories
      };

      // Collect ALL unique meals from history (for AI to use user's naming)
      const allMeals: Record<string, { name: string; protein: number; fat: number; carbs: number; calories: number; count: number; isFavorite: boolean }> = {};
      Object.values(dayLogs).forEach(log => {
        log.meals?.forEach(meal => {
          const key = meal.name.toLowerCase();
          if (!allMeals[key]) {
            allMeals[key] = {
              name: meal.name,
              protein: meal.protein,
              fat: meal.fat,
              carbs: meal.carbs,
              calories: meal.calories,
              count: 1,
              isFavorite: meal.isFavorite || false
            };
          } else {
            allMeals[key].count++;
            if (meal.isFavorite) allMeals[key].isFavorite = true;
          }
        });
      });

      // Sort by frequency and take top 30 for context
      const userFoodHistory = Object.values(allMeals)
        .sort((a, b) => b.count - a.count)
        .slice(0, 30)
        .map(m => ({
          name: m.name,
          protein: m.protein,
          fat: m.fat,
          carbs: m.carbs,
          calories: m.calories,
          isFavorite: m.isFavorite
        }));

      const response = await fetch('/api/food/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remainingMacros,
          currentMacros,
          targetMacros,
          userFoodHistory, // All user's foods with their naming
          language: userSettings.language,
          mealTime: getMealTime(),
          nutritionRecommendations: nutritionRecommendations?.map(r => ({
            title: r.title,
            description: r.description
          })) || null,
          goal: userSettings.goalType ?? 'maintain'
        })
      });

      const result = await response.json();

      if (result.success && result.data) {
        setFoodRecommendations(result.data);
      }
    } catch (error) {
      console.error('Error getting food recommendations:', error);
    } finally {
      setIsLoadingRecommendations(false);
    }
  };

  // Workout Editor Functions
  /**
   * Отдых после закрытого упражнения истёк — сворачиваем его и
   * раскрываем следующее невыполненное.
   *
   * Почему не сразу после последнего подхода: в тот момент отдых только
   * запускается, и карточка унесла бы таймер с собой. Ждём, пока он
   * отработает, — тогда переход и уместен.
   *
   * Ищем по кругу: после последнего упражнения возвращаемся к
   * пропущенным в начале списка.
   */
  const goToNextExercise = useCallback((workoutId: string, fromExerciseId: string) => {
    setExpandedExerciseId(prevId => {
      if (prevId !== fromExerciseId) return prevId; // пользователь уже ушёл сам
      const list = workouts.find(w => w.id === workoutId)?.exercises ?? [];
      const from = list.findIndex(e => e.id === fromExerciseId);
      if (from < 0) return null;
      const ordered = [...list.slice(from + 1), ...list.slice(0, from)];
      const next = ordered.find(e => !e.completed);
      return next ? next.id : null;
    });
  }, [workouts]);

  const openWorkoutEditor = (workoutId: string) => {
    setEditingWorkoutId(workoutId);
    setShowWorkoutEditor(true);
    setEditingExerciseId(null);
    setExerciseForm({ name: '', plannedSets: '', restTime: '2-3 мин', notes: '' });
  };

  const addExerciseToWorkout = () => {
    userMadeChangeRef.current = true;
    if (!editingWorkoutId || !exerciseForm.name) return;

    const newExercise: Exercise = {
      id: Date.now().toString(),
      name: exerciseForm.name,
      plannedSets: exerciseForm.plannedSets,
      actualSets: '',
      restTime: exerciseForm.restTime || '2-3 мин',
      notes: exerciseForm.notes,
      newWeight: '',
      feedback: '',
      completed: false
    };

    setWorkouts(prev => prev.map(w =>
      w.id === editingWorkoutId
        ? { ...w, exercises: [...w.exercises, newExercise] }
        : w
    ));
    setExerciseForm({ name: '', plannedSets: '', restTime: '2-3 мин', notes: '' });
  };

  const updateExerciseInWorkout = () => {
    userMadeChangeRef.current = true;
    if (!editingWorkoutId || !editingExerciseId || !exerciseForm.name) return;

    setWorkouts(prev => prev.map(w =>
      w.id === editingWorkoutId
        ? {
            ...w,
            exercises: w.exercises.map(ex =>
              ex.id === editingExerciseId
                ? { ...ex, name: exerciseForm.name, plannedSets: exerciseForm.plannedSets, restTime: exerciseForm.restTime, notes: exerciseForm.notes }
                : ex
            )
          }
        : w
    ));
    setEditingExerciseId(null);
    setExerciseForm({ name: '', plannedSets: '', restTime: '2-3 мин', notes: '' });
  };

  const deleteExerciseFromWorkout = (exerciseId: string) => {
    userMadeChangeRef.current = true;
    if (!editingWorkoutId) return;
    setWorkouts(prev => prev.map(w =>
      w.id === editingWorkoutId
        ? { ...w, exercises: w.exercises.filter(ex => ex.id !== exerciseId) }
        : w
    ));
  };

  const startEditExercise = (exercise: Exercise) => {
    setEditingExerciseId(exercise.id);
    setExerciseForm({
      name: exercise.name,
      plannedSets: exercise.plannedSets,
      restTime: exercise.restTime,
      notes: exercise.notes
    });
  };

  const moveExercise = (exerciseId: string, direction: 'up' | 'down') => {
    userMadeChangeRef.current = true;
    if (!editingWorkoutId) return;
    setWorkouts(prev => prev.map(w => {
      if (w.id !== editingWorkoutId) return w;
      const idx = w.exercises.findIndex(ex => ex.id === exerciseId);
      if (idx === -1) return w;
      if (direction === 'up' && idx === 0) return w;
      if (direction === 'down' && idx === w.exercises.length - 1) return w;

      const newExercises = [...w.exercises];
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      [newExercises[idx], newExercises[swapIdx]] = [newExercises[swapIdx], newExercises[idx]];
      return { ...w, exercises: newExercises };
    }));
  };

  // Add new workout
  const addNewWorkout = () => {
    userMadeChangeRef.current = true;
    if (workouts.length >= MAX_WORKOUTS) return;
    const newWorkoutNum = workouts.length + 1;
    const newWorkout: Workout = {
      id: `t${newWorkoutNum}`,
      name: `Тренировка ${newWorkoutNum}`,
      exercises: []
    };
    setWorkouts(prev => [...prev, newWorkout]);
    selectWorkout(newWorkout.id);
    openWorkoutEditor(newWorkout.id);
  };

  // Delete workout
  const deleteWorkout = (workoutId: string) => {
    userMadeChangeRef.current = true;
    if (workouts.length <= 1) return; // Keep at least one workout
    setWorkouts(prev => {
      const filtered = prev.filter(w => w.id !== workoutId);
      // Renumber remaining workouts
      return filtered.map((w, i) => ({
        ...w,
        id: `t${i + 1}`,
        name: `Тренировка ${i + 1}`
      }));
    });
    setShowWorkoutEditor(false);
    selectWorkout('t1');
  };

  /**
   * Текущая тренировка. Подстраховка на случай пустого списка: у нового
   * аккаунта (и пока грузятся данные) workouts пуст, а без неё всё
   * приложение падало с «Cannot read properties of undefined (reading
   * exercises)» — белый экран вместо интерфейса.
   */
  const currentWorkout: Workout = workouts.find(w => w.id === selectedWorkout)
    || workouts[0]
    || { id: 't1', name: 'Тренировка 1', exercises: [] };
  const completedExercises = currentWorkout.exercises.filter(e => e.completed).length;
  const totalExercises = currentWorkout.exercises.length;
  // Без упражнений делить не на что — иначе NaN в ширине прогресс-бара.
  const progressPercent = totalExercises > 0 ? (completedExercises / totalExercises) * 100 : 0;

  // Close day with workout snapshot
  // Функция «закрыть/переоткрыть день» убрана — прогресс дня теперь
  // определяется фактически выполненными упражнениями, без явного закрытия.

  // Mark day as off day (rest day - no workout required, but steps still needed)
  // Ручная отметка «день отдыха» убрана — день без тренировки считается
  // днём отдыха автоматически (в календаре отрисовывается нейтрально).

  // Check if viewing a past day with saved workout
  const viewingPastWorkout = currentDayLog.dayClosed && currentDayLog.workoutSnapshot;
  const displayWorkout = viewingPastWorkout ? {
    ...currentDayLog.workoutSnapshot!,
    id: currentDayLog.workoutSnapshot!.workoutId,
    name: currentDayLog.workoutSnapshot!.workoutName
  } : currentWorkout;
  const displayExercises = viewingPastWorkout
    ? currentDayLog.workoutSnapshot!.exercises
    : currentWorkout.exercises;

  // Look up the most recent prior day where this same workout was performed,
  // so each exercise's per-set table can show a "Last" column with the
  // previous reps×weight per set. We walk dayLogs date keys in reverse.
  // Заголовок тренировки по макету: не «Тренировка 1», а какие мышцы
  // сегодня работают. Берём ИИ-группы упражнений дня, самые частые —
  // вперёд. Групп нет (ИИ ещё не разметил) — показываем имя тренировки.
  const workoutHeading = useMemo(() =>
    muscleHeading(displayExercises, muscleGroups, userSettings.language)
      ?? (currentWorkout?.name || String(t('workout'))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  [displayExercises, muscleGroups, currentWorkout, userSettings.language]);

  const lastSetsByExerciseId = useMemo(() => {
    const map: Record<string, ExerciseSet[]> = {};
    const norm = (n: string) => n.toLowerCase().trim();
    const hasReal = (sets?: ExerciseSet[]) =>
      Array.isArray(sets) && sets.some(st => (st.weight || 0) > 0 || (st.reps || 0) > 0);

    const dates = Object.keys(dayLogs).filter(d => d < dateKey).sort().reverse();
    const needed = new Set(displayExercises.map(e => e.id));

    // ШАГ 1 — ГЛАВНЫЙ: последний раз, когда пользователь делал ЭТУ ЖЕ
    // тренировку (ту же ячейку T1–T7). Нажал T2 — видишь свою прошлую T2,
    // подход к подходу, по позиции упражнения. Именно этого ждёт пользователь:
    // ячейка для него и есть «тренировка», даже если состав в ней менялся.
    for (const d of dates) {
      if (needed.size === 0) break;
      for (const candidate of [dayLogs[d]?.workoutDraft, dayLogs[d]?.workoutSnapshot]) {
        if (!candidate?.exercises || candidate.workoutId !== selectedWorkout) continue;
        // День считается «той самой прошлой тренировкой», только если в нём
        // реально есть введённые веса — пустые заходы пропускаем.
        if (!candidate.exercises.some(e => hasReal((e as { sets?: ExerciseSet[] }).sets))) continue;
        for (const e of candidate.exercises) {
          const sets = (e as { sets?: ExerciseSet[] }).sets;
          if (!hasReal(sets) || !needed.has(e.id) || map[e.id]) continue;
          map[e.id] = sets!;
          needed.delete(e.id);
        }
        break; // берём только ОДИН (ближайший) день этой тренировки
      }
      if (Object.keys(map).length > 0) break;
    }

    // ШАГ 2 — добор по НАЗВАНИЮ для позиций, которых не было в прошлой
    // тренировке (например упражнение добавлено позже): ищем то же движение
    // в любых других днях, чтобы не терять историю при перестановках.
    if (needed.size > 0) {
      const idsByName = new Map<string, string[]>();
      for (const e of displayExercises) {
        if (!needed.has(e.id)) continue;
        const k = norm(e.name);
        if (!k) continue;
        if (!idsByName.has(k)) idsByName.set(k, []);
        idsByName.get(k)!.push(e.id);
      }
      const remaining = new Set(idsByName.keys());
      for (const d of dates) {
        if (remaining.size === 0) break;
        for (const candidate of [dayLogs[d]?.workoutDraft, dayLogs[d]?.workoutSnapshot]) {
          if (!candidate?.exercises) continue;
          for (const e of candidate.exercises) {
            const k = norm(e.name || '');
            if (!k || !remaining.has(k)) continue;
            const sets = (e as { sets?: ExerciseSet[] }).sets;
            if (!hasReal(sets)) continue;
            for (const id of idsByName.get(k)!) { map[id] = sets!; needed.delete(id); }
            remaining.delete(k);
          }
        }
      }
    }
    return map;
  }, [dayLogs, dateKey, displayExercises, selectedWorkout]);

  // Динамика рабочего веса по каждому упражнению С САМОГО НАЧАЛА: для каждой
  // даты, где упражнение делалось (в ЛЮБОЙ тренировке), берём МАКСИМАЛЬНЫЙ вес
  // среди подходов. Не привязываемся к workoutId — история строится с первого
  // дня, когда появился вес. Один день = одна точка (макс. по draft/snapshot).
  /**
   * История рабочего веса по НАЗВАНИЮ упражнения.
   *
   * Раскладывать её по ex.id нельзя: id вида "1".."7" переиспользуются во
   * всех тренировках программы, поэтому "1" — это одновременно «Жим
   * гантелей» в T1, «Тяга штанги» в T2 и «Жим ногами» в T3. График одного
   * упражнения показывался у всех остальных с тем же номером.
   */
  const weightHistoryByName = useMemo(() => {
    // Группируем по основе движения, а уточнения храним рядом: на чтении
    // отберём только записи, совместимые с текущим названием.
    const map: Record<string, { date: string; weight: number; parsed: ParsedName }[]> = {};
    const dates = Object.keys(dayLogs).sort(); // старые сверху
    for (const d of dates) {
      // название из журнала → макс вес за день
      const perDay: Record<string, { weight: number; parsed: ParsedName }> = {};
      for (const candidate of [dayLogs[d]?.workoutDraft, dayLogs[d]?.workoutSnapshot]) {
        if (!candidate?.exercises) continue;
        for (const e of candidate.exercises) {
          const sets = (e as { sets?: ExerciseSet[] }).sets;
          if (!Array.isArray(sets) || sets.length === 0) continue;
          const maxW = Math.max(0, ...sets.map(st => st.weight || 0));
          if (maxW <= 0) continue;
          const parsed = parseExerciseName(e.name || '');
          if (!parsed.base) continue;
          const id = parsed.base + '|' + JSON.stringify(parsed.specs);
          const prev = perDay[id];
          if (!prev || maxW > prev.weight) perDay[id] = { weight: maxW, parsed };
        }
      }
      for (const { weight, parsed } of Object.values(perDay)) {
        (map[parsed.base] ??= []).push({ date: d, weight, parsed });
      }
    }
    return map;
  }, [dayLogs]);

  /**
   * Сколько упражнений программы претендуют на одну основу.
   *
   * «Вертикальная тяга к груди широким хватом» и «Вертикальная тяга
   * обратным хватом» — одна основа, разный хват. В журнале же есть старая
   * запись без хвата, «Вертикальная тяга к груди». Она подходит обоим, и
   * отдать её обоим значит показать двум упражнениям один и тот же чужой
   * график. Такие споры решает weightHistoryFor.
   */
  const rivalsByBase = useMemo(() => {
    const map: Record<string, ParsedName[]> = {};
    const seen = new Set<string>();
    for (const w of workouts) {
      for (const e of w.exercises || []) {
        const nm = (e.name || '').trim();
        if (!nm || seen.has(nm)) continue;
        seen.add(nm);
        const p = parseExerciseName(nm);
        if (p.base) (map[p.base] ??= []).push(p);
      }
    }
    return map;
  }, [workouts]);

  /**
   * История для конкретного названия: берём группу по основе и оставляем
   * записи, чьи уточнения не противоречат. Запись, подходящую сразу
   * нескольким упражнениям программы, пропускаем — лучше не показать
   * тренд, чем показать чужой. Если за день осталось несколько записей,
   * берём максимальный вес.
   */
  const weightHistoryFor = useCallback((name: string) => {
    const want = parseExerciseName(name);
    const group = weightHistoryByName[want.base];
    if (!group) return undefined;
    const rivals = rivalsByBase[want.base] || [];
    const perDate: Record<string, number> = {};
    for (const row of group) {
      if (!sameExercise(want, row.parsed)) continue;
      // Запись подошла и другому упражнению программы. Отдаём её тому, у
      // кого больше совпавших осей уточнений; при равном счёте — никому,
      // лучше не показать тренд, чем показать чужой.
      const mine = specOverlap(want, row.parsed);
      const contested = rivals.some(r =>
        JSON.stringify(r) !== JSON.stringify(want) &&
        sameExercise(r, row.parsed) &&
        specOverlap(r, row.parsed) >= mine);
      if (contested) continue;
      perDate[row.date] = Math.max(perDate[row.date] || 0, row.weight);
    }
    const dates = Object.keys(perDate).sort();
    if (dates.length === 0) return undefined;
    return dates.map(d => ({ date: d, weight: perDate[d] }));
  }, [weightHistoryByName, rivalsByBase]);

  const navigateDate = (direction: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + direction);
    setSelectedDate(newDate);
  };

  return (
    <main
      suppressHydrationWarning
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)'
      }}
    >
      {/* Header — на экране питания шапка своя (в макете она часть страницы) */}
      {view !== 'nutrition' && (
      <header style={{
        // Отступы как на экране питания (эталон), иначе при переходе
        // страница сдвигается и нижнее меню визуально «прыгает».
        padding: '18px 20px 18px',
        paddingTop: 'calc(18px + env(safe-area-inset-top, 0px))',
        background: 'var(--bg-primary)'
      }}>
        <div style={{
          maxWidth: '600px',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px'
        }}>
          <div className="tx-welcome" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Welcome to <b>Train<span>X</span></b>, {userSettings.name || 'Атлет'}{isNightMode ? ' 🌙' : ''}
                    </div>
                    {/* Кружок юзера — открывает раздел «Я» */}
                    <button
                      onClick={() => { setView('profile'); localStorage.setItem('fitness_view', 'profile'); setShowProfileDropdown(false); }}
                      aria-label={userSettings.language === 'ru' ? 'Профиль' : 'Profile'}
                      className="btn-press tx-profile"
                      style={(view === 'profile' || view === 'gains' || view === 'analytics') ? { borderColor: 'var(--text-primary)' } : undefined}
                    >
                      {(userSettings.name || 'A')[0].toUpperCase()}
                      <i />
                    </button>
        </div>
      </header>
      )}

      {/* Navigation tabs */}
      {/* Верхняя навигация убрана — всё переехало в нижний таб-бар (как в Superpower) */}
      <nav style={{ display: 'none' }}>
        <div style={{
          display: 'flex',
          gap: '8px',
          maxWidth: '600px',
          margin: '0 auto'
        }}>
          {/* Workout tab */}
          <button
            className="tab-button btn-press"
            onClick={() => {
              setView('workout');
              localStorage.setItem('fitness_view', 'workout');
              setShowProfileDropdown(false);
            }}
            style={{
              flex: 1,
              padding: '12px',
              background: view === 'workout' ? 'var(--yellow)' : 'var(--bg-elevated)',
              border: view === 'workout' ? 'none' : '1px solid var(--border)',
              borderRadius: '12px',
              color: view === 'workout' ? '#fff' : 'var(--text-secondary)',
              fontWeight: view === 'workout' ? 700 : 500,
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: view === 'workout' ? '0 4px 20px var(--yellow-glow)' : 'none',
              transform: view === 'workout' ? 'scale(1.02)' : 'scale(1)'
            }}
          >
            <Dumbbell size={16} />
            {t('workout')}
          </button>

          {/* Nutrition tab */}
          <button
            className="tab-button btn-press"
            onClick={() => {
              setView('nutrition');
              localStorage.setItem('fitness_view', 'nutrition');
              setShowProfileDropdown(false);
            }}
            style={{
              flex: 1,
              padding: '12px',
              background: view === 'nutrition' ? 'var(--yellow)' : 'var(--bg-elevated)',
              border: view === 'nutrition' ? 'none' : '1px solid var(--border)',
              borderRadius: '12px',
              color: view === 'nutrition' ? '#fff' : 'var(--text-secondary)',
              fontWeight: view === 'nutrition' ? 700 : 500,
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: view === 'nutrition' ? '0 4px 20px var(--yellow-glow)' : 'none',
              transform: view === 'nutrition' ? 'scale(1.02)' : 'scale(1)'
            }}
          >
            <Apple size={16} />
            {t('food')}
          </button>

          {/* Planner tab — hidden for the friend account (Dmitri) per request.
              Compared on email so it survives a name change. */}
          {userSettings.email !== 'dmitriheadshot@friend.local' && (
            <button
              className="tab-button btn-press"
              onClick={() => {
                setView('planner');
                localStorage.setItem('fitness_view', 'planner');
                setShowProfileDropdown(false);
              }}
              style={{
                flex: 1,
                padding: '12px',
                background: view === 'planner' ? 'var(--yellow)' : 'var(--bg-elevated)',
                border: view === 'planner' ? 'none' : '1px solid var(--border)',
                borderRadius: '12px',
                color: view === 'planner' ? '#fff' : 'var(--text-secondary)',
                fontWeight: view === 'planner' ? 700 : 500,
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: view === 'planner' ? '0 4px 20px var(--yellow-glow)' : 'none',
                transform: view === 'planner' ? 'scale(1.02)' : 'scale(1)'
              }}
            >
              <CalendarDays size={16} />
              {userSettings.language === 'ru' ? 'Дела' : 'Plan'}
            </button>
          )}

          {/* Profile tab with dropdown */}
          <div style={{ flex: 1, position: 'relative' }} ref={profileDropdownRef}>
            <button
              className="tab-button btn-press"
              onClick={() => setShowProfileDropdown(!showProfileDropdown)}
              style={{
                width: '100%',
                padding: '12px',
                background: (view === 'gains' || view === 'analytics' || view === 'profile')
                  ? 'var(--yellow)'
                  : 'var(--bg-elevated)',
                border: (view === 'gains' || view === 'analytics' || view === 'profile') ? 'none' : '1px solid var(--border)',
                borderRadius: '12px',
                color: (view === 'gains' || view === 'analytics' || view === 'profile') ? '#fff' : 'var(--text-secondary)',
                fontWeight: (view === 'gains' || view === 'analytics' || view === 'profile') ? 700 : 500,
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: (view === 'gains' || view === 'analytics' || view === 'profile') ? '0 4px 20px var(--yellow-glow)' : 'none',
                transform: (view === 'gains' || view === 'analytics' || view === 'profile') ? 'scale(1.02)' : 'scale(1)'
              }}
            >
              <User size={16} />
              Я
              <ChevronDown size={14} style={{
                transform: showProfileDropdown ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease'
              }} />
            </button>

            {/* Dropdown menu */}
            {showProfileDropdown && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                left: 0,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                overflow: 'hidden',
                zIndex: 100,
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
              }}>
                <button
                  onClick={() => {
                    setView('gains');
                    localStorage.setItem('fitness_view', 'gains');
                    setShowProfileDropdown(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    background: view === 'gains' ? 'var(--yellow-dim)' : 'transparent',
                    border: 'none',
                    color: view === 'gains' ? 'var(--yellow)' : 'var(--text-primary)',
                    fontSize: '14px',
                    fontWeight: view === 'gains' ? 600 : 500,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    gap: '12px',
                    cursor: 'pointer'
                  }}
                >
                  <Scale size={18} style={{ flexShrink: 0 }} />
                  <span>{t('gains')}</span>
                </button>
                <button
                  onClick={() => {
                    setView('analytics');
                    localStorage.setItem('fitness_view', 'analytics');
                    setShowProfileDropdown(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    background: view === 'analytics' ? 'var(--yellow-dim)' : 'transparent',
                    border: 'none',
                    borderTop: '1px solid var(--border)',
                    color: view === 'analytics' ? 'var(--yellow)' : 'var(--text-primary)',
                    fontSize: '14px',
                    fontWeight: view === 'analytics' ? 600 : 500,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    gap: '12px',
                    cursor: 'pointer'
                  }}
                >
                  <BarChart3 size={18} style={{ flexShrink: 0 }} />
                  <span>{t('statistics')}</span>
                </button>
                <button
                  onClick={() => {
                    setView('profile');
                    localStorage.setItem('fitness_view', 'profile');
                    setShowProfileDropdown(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    background: view === 'profile' ? 'var(--yellow-dim)' : 'transparent',
                    border: 'none',
                    borderTop: '1px solid var(--border)',
                    color: view === 'profile' ? 'var(--yellow)' : 'var(--text-primary)',
                    fontSize: '14px',
                    fontWeight: view === 'profile' ? 600 : 500,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    gap: '12px',
                    cursor: 'pointer'
                  }}
                >
                  <Settings size={18} style={{ flexShrink: 0 }} />
                  <span>{t('settings')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Click outside to close dropdown */}
      {showProfileDropdown && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99
          }}
          onClick={() => setShowProfileDropdown(false)}
        />
      )}

      {/* Content. Нижний отступ 92px — под меню; оно теперь видно на всех
          вкладках, включая ИИ. */}
      <div className={view === 'nutrition' ? 'content-flush' : undefined} style={{
        flex: 1,
        overflow: 'auto',
        padding: '4px 20px 16px',
        paddingBottom: 'calc(92px + env(safe-area-inset-bottom, 0px))',
        maxWidth: '600px',
        margin: '0 auto',
        width: '100%',
        minHeight: 0,
      }}>
        {/* WORKOUT VIEW */}
        {view === 'workout' && (
          <div className="view-content">
            {/* Show history badge if viewing closed day */}
            {viewingPastWorkout && (
              <div style={{
                background: 'var(--green-dim)',
                border: '1px solid rgba(0, 200, 83, 0.2)',
                borderRadius: '12px',
                padding: '10px 16px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <Check size={18} style={{ color: 'var(--green)' }} />
                <span style={{ fontWeight: 600, color: 'var(--green)', fontSize: '13px' }}>
                  {t('dayCompleted')}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  • {currentDayLog.workoutSnapshot?.workoutName}
                </span>
              </div>
            )}

            {/* Переключатель разделов по макету: сегментированная капсула.
                Ведёт в те же вкладки, что и нижнее меню. */}
            <div className="tx-modeswitch">
              <button
                className="tx-mode is-active"
                onClick={() => { setView('workout'); localStorage.setItem('fitness_view', 'workout'); }}
              >
                {userSettings.language === 'ru' ? 'Тренировки' : 'Workouts'}
              </button>
              <button
                className="tx-mode"
                onClick={() => { setView('nutrition'); localStorage.setItem('fitness_view', 'nutrition'); }}
              >
                {userSettings.language === 'ru' ? 'Питание' : 'Nutrition'} <span>↗</span>
              </button>
            </div>
            
                        {/* Заголовок тренировки по макету: кикер, крупное название, календарь */}
            {!viewingPastWorkout && (
              <div>
                <div className="tx-kicker">
                  {(currentWorkout?.name || '').replace('Тренировка ', 'T')} · {userSettings.language === 'ru' ? 'Мышцы' : 'Muscles'}
                </div>
                <div className="tx-titleline">                  <h2>{workoutHeading}</h2>
                  <button
                    className="tx-calbtn btn-press"
                    onClick={() => { setView('planner'); localStorage.setItem('fitness_view', 'planner'); }}
                    aria-label={userSettings.language === 'ru' ? 'Календарь' : 'Calendar'}
                  >
                    <CalendarDays size={20} />
                  </button>
                </div>
              </div>
            )}
                        {/* Лента дат: старые слева, «Сегодня» справа; при открытии
                прокручена к сегодняшнему дню. Внизу чипа — T1/счётчик или месяц. */}
            <div
              ref={workoutStripRef}
              className="tx-strip no-scrollbar"
              style={{ scrollSnapType: 'x proximity' }}>
              {(() => {
                if (!todayStr) return null;
                const [ty, tm, td] = todayStr.split('-').map(Number);
                const chips = [];
                // Хронологический порядок: старые даты слева, «Сегодня» — справа.
                for (let i = 89; i >= 0; i--) {
                  const d = new Date(ty, tm - 1, td);
                  d.setDate(d.getDate() - i);
                  const ds = formatDate(d);
                  const isSel = ds === dateKey;
                  const log = dayLogs[ds];
                  // Статус считает общая getDayStatus — лента и месячная сетка
                  // обязаны показывать одно и то же.
                  const { status, exDone, exTotal } = getDayStatus(log, ds, todayStr);
                  const hasWorkout = status === 'done' || status === 'active';
                  const fullyDone = status === 'done';
                  const isPlanned = status === 'planned';
                  // workoutDraft — главный носитель: снапшота нет, пока день не
                  // закрыт, а selectedWorkout пишется не каждый день. Без драфта
                  // чип показывал «5/7» вместо «T1».
                  const wId = log?.workoutSnapshot?.workoutId ?? log?.workoutDraft?.workoutId ?? log?.workoutCompleted ?? log?.selectedWorkout;
                  // Метку тренировки показываем и для запланированного дня —
                  // иначе «запланировано» выглядело бы как пустой день.
                  const cw = (hasWorkout || isPlanned) && wId ? workouts.find(w => w.id === wId) : null;
                  const wLabel = cw ? cw.name.replace('Тренировка ', 'T') : '';
                  const label = d.toLocaleDateString(userSettings.language === 'ru' ? 'ru-RU' : 'en-US', { weekday: 'short' });
                  const isToday = i === 0;
                  chips.push(
                    <button
                      key={ds}
                      data-selchip={isSel ? '1' : undefined}
                      onClick={() => setSelectedDate(d)}
                      // Классы по макету: без плашек, кружок на выбранном дне,
                      // статус передаётся цветом точки и подписи.
                      className={[
                        'btn-press', 'tx-day',
                        isSel ? 'is-sel' : '',
                        isToday ? 'is-today' : '',
                        fullyDone ? 'is-done' : hasWorkout ? 'is-active' : isPlanned ? 'is-planned' : '',
                      ].filter(Boolean).join(' ')}
                      style={{ scrollSnapAlign: 'center' }}
                    >
                      <span className="dow">{label}</span>
                      <span className="num">{d.getDate()}</span>
                      <span className="tag">
                        {(fullyDone || hasWorkout || isPlanned) && (
                          <i className={['tx-dot', fullyDone ? 'd-done' : hasWorkout ? 'd-active' : 'd-planned'].join(' ')} />
                        )}
                        {fullyDone
                          ? (wLabel || exDone + '/' + exTotal)
                          : hasWorkout
                            ? (wLabel ? wLabel + ' · ' + exDone + '/' + exTotal : exDone + '/' + exTotal)
                            : isPlanned && wLabel
                              ? wLabel
                              : '—'}
                      </span>
                    </button>
                  );
                }
                return chips;
              })()}
            </div>

            {/* Легенда статусов дня — те же четыре состояния, что и в календаре */}
            <div className="tx-legend">
              <span><i className="tx-dot d-done" />{userSettings.language === 'ru' ? 'Выполнено' : 'Done'}</span>
              <span><i className="tx-dot d-active" />{userSettings.language === 'ru' ? 'В процессе' : 'In progress'}</span>
              <span><i className="tx-dot d-planned" />{userSettings.language === 'ru' ? 'Запланировано' : 'Planned'}</span>
              <span><i className="tx-dot d-none" />{userSettings.language === 'ru' ? 'Нет записи' : 'No record'}</span>
            </div>
            
                        {/* Функция ручной отметки «день отдыха» убрана: день без тренировки
                считается днём отдыха автоматически. */}

            {/* Workout selector - compact grid, hidden when viewing history */}
            {!viewingPastWorkout && (
              <>
              <div className="tx-utility">
                <span>{userSettings.language === 'ru' ? 'Моя программа' : 'My program'}</span>
                <span>{(currentWorkout?.name || '').replace('Тренировка ', 'T')} / {workouts.filter(w => w.exercises.length > 0).length}</span>
              </div>
              <div className="tx-wsel">
                {/* Обёртка нужна для затухания у правого края: оно должно
                    лежать поверх кнопок, а не под ними. */}
                <div ref={wselWrapRef} className="tx-wselwrap">
                <div
                  ref={wselRef}
                  className="tx-wsel-grid"
                >
                  {workouts.map(w => {
                    const isEmpty = w.exercises.length === 0;
                    const isActive = selectedWorkout === w.id;
                    return (
                      <button
                        key={w.id}
                        className={['tab-button', 'btn-press', 'tx-wtab', isActive ? 'is-active' : '', isEmpty ? 'is-empty' : ''].filter(Boolean).join(' ')}
                        onClick={() => selectWorkout(w.id)}
                      >
                        {w.name.replace('Тренировка ', 'T')}
                      </button>
                    );
                  })}
                  {workouts.length < MAX_WORKOUTS && (
                    <button
                      className="btn-press tx-wtab is-empty"
                      onClick={addNewWorkout}
                      title="Добавить тренировку"
                    >
                      <Plus size={20} />
                    </button>
                  )}
                </div>
                </div>
                {/* Ручная отметка отдыха убрана — день без тренировки
                    автоматически считается днём отдыха. */}
                <button
                  onClick={() => openWorkoutEditor(selectedWorkout)}
                  className="tx-iconbtn"
                  title="Редактировать тренировку"
                >
                  <Settings size={20} />
                </button>
                <button
                  onClick={() => { setShowProgramModal(true); setProgramDays(Math.max(2, workouts.filter(w => w.exercises.length > 0).length) || 4); }}
                  className="tx-iconbtn is-ai"
                  title="Программа: ИИ-предложение и история"
                >
                  <Sparkles size={20} />
                </button>
              </div>
              {/* Подпись выбранного дня: дата, статус и тренировка — по макету. */}
              <div className="tx-daylabel">
                {selectedDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                {' · '}
                {DAY_STATUS_TEXT[getDayStatus(currentDayLog, dateKey, todayStr).status]}
                {' · '}
                {(currentWorkout?.name || '').replace('Тренировка ', 'T')}
              </div>
              </>
            )}

            {/* Closed day dimming wrapper for exercises + steps */}
            <div style={{
              opacity: currentDayLog.dayClosed ? 0.5 : 1,
              pointerEvents: currentDayLog.dayClosed ? 'none' : 'auto',
              transition: 'opacity 0.3s ease'
            }}>


            {/* Exercise list - hidden for Off Days */}
            {!currentDayLog.isOffDay && (
              displayExercises.length > 0 ? (
                displayExercises.map((ex, idx) => {
                  const workoutId = viewingPastWorkout ? currentDayLog.workoutSnapshot!.workoutId : currentWorkout.id;
                  const exerciseKey = `${workoutId}-${ex.id}`;
                  // Где упражнение стоит в связке: если следующее с той же
                  // меткой — отдых после подхода не нужен, сразу идёт пара.
                  const supersetPos = ex.supersetId
                    ? (displayExercises[idx + 1]?.supersetId === ex.supersetId ? 'inner' as const : 'last' as const)
                    : undefined;
                  // Связку рисуем ОДНИМ блоком: открывает его первое
                  // упражнение метки, закрывает последнее. Иначе две
                  // отдельные карточки не читаются как одна единица
                  // работы — а это именно она, с общим отдыхом.
                  const supIsFirst = !!ex.supersetId && displayExercises[idx - 1]?.supersetId !== ex.supersetId;
                  const supIsLast = !!ex.supersetId && displayExercises[idx + 1]?.supersetId !== ex.supersetId;
                  // Круги: сколько подходов уже отмечено в самом коротком
                  // из упражнений связки — столько кругов и пройдено.
                  const supRounds = ex.supersetId ? (() => {
                    const inGroup = displayExercises.filter(e => e.supersetId === ex.supersetId);
                    const plan = Math.max(...inGroup.map(e => (e.sets ?? makeInitialSets(e.plannedSets)).length));
                    const done = Math.min(...inGroup.map(e => (e.sets ?? []).filter(s => s.completed).length));
                    return { done, plan };
                  })() : null;
                  // Вся связка целиком: нужна карточке, чтобы объяснить,
                  // с чем чередовать и когда отдыхать. Без этого плашка
                  // «Суперсет A» ничего не говорит о том, как тренить.
                  const supersetGroup = ex.supersetId
                    ? displayExercises.filter(e => e.supersetId === ex.supersetId).map(e => e.name)
                    : undefined;
                  const card = (
                    <ExerciseCard
                      key={ex.id}
                      ex={ex}
                      idx={idx}
                      onToggle={() => !viewingPastWorkout && updateExercise(currentWorkout.id, ex.id, { completed: !ex.completed })}
                      onUpdate={(updates) => !viewingPastWorkout && updateExercise(currentWorkout.id, ex.id, updates)}
                      progressHistory={progressHistory[exerciseKey] || []}
                      weightHistory={weightHistoryFor(ex.name)}
                      supersetPos={supersetPos}
                      supersetGroup={supersetGroup}
                      lastSets={lastSetsByExerciseId[ex.id]}
                      exerciseLibrary={exerciseLibrary}
                      onImageSaved={(name, url) => { setExerciseLibrary(prev => ({ ...prev, [name]: url })); void saveExerciseImage(name, url); }}
                      dayClosed={currentDayLog.dayClosed}
                      onShowImage={(url, name) => { setImageModal({ url, name }); document.body.style.overflow = 'hidden'; }}
                      expanded={expandedExerciseId === ex.id}
                      onToggleExpand={() => setExpandedExerciseId(prev => prev === ex.id ? null : ex.id)}
                      onRestDone={() => goToNextExercise(currentWorkout.id, ex.id)}
                      /* Кроме этого упражнения незакрытых не осталось —
                         значит, оно закрывает тренировку. */
                      isLastPending={displayExercises.every(o => o.id === ex.id || o.completed)}
                      muscleLabel={muscleGroups[ex.name.trim().toLowerCase()]}
                      lastLabel={t('lastTimeCol') as string}
                    />
                  );
                  return { ex, card, supIsFirst, supIsLast, supRounds };
                })
                // Собираем связки в один блок: подряд идущие упражнения с
                // одной меткой заворачиваются в общую рамку с счётчиком
                // кругов, остальные остаются как были.
                .reduce<React.ReactNode[]>((out, row, i, all) => {
                  if (!row.ex.supersetId) { out.push(row.card); return out; }
                  if (!row.supIsFirst) return out; // уже внутри блока
                  const group: typeof all = [row];
                  for (let j = i + 1; j < all.length; j++) {
                    if (all[j].ex.supersetId !== row.ex.supersetId) break;
                    group.push(all[j]);
                  }
                  const supKey = `${currentWorkout.id}-${row.ex.supersetId}`;
                  const byRounds = supersetByRounds[supKey] !== false; // по умолчанию кругами
                  const groupExercises = group.map(g => g.ex);
                  // Связка сворачивается так же, как обычное упражнение:
                  // раскрыта одна за раз. Иначе суперсет занимал экран
                  // целиком, а соседние упражнения были свёрнуты.
                  const supOpen = expandedExerciseId === supKey;
                  const supDone = row.supRounds ? row.supRounds.done : 0;
                  const supPlan = row.supRounds ? row.supRounds.plan : 0;
                  out.push(
                    <div
                      className={['tx-supwrap', supOpen ? 'is-open' : ''].filter(Boolean).join(' ')}
                      key={'sup-' + row.ex.supersetId + '-' + row.ex.id}
                    >
                      <div
                        className="tx-suphead"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setExpandedExerciseId(prev => prev === supKey ? null : supKey)}
                      >
                        <span className="tx-suptitle">
                          <Link2 size={11} /> Суперсет {row.ex.supersetId}
                        </span>
                        {supPlan > 0 && (
                          <span className="tx-suprounds">
                            {supOpen
                              ? `круг ${Math.min(supDone + 1, supPlan)} из ${supPlan}`
                              : `${supDone}/${supPlan} кругов`}
                          </span>
                        )}
                      </div>
                      {/* Свёрнутая связка: названия упражнений одной
                          строкой — видно, что внутри, без раскрытия. */}
                      {!supOpen && (
                        <div
                          className="tx-supsummary"
                          style={{ cursor: 'pointer' }}
                          onClick={() => setExpandedExerciseId(supKey)}
                        >
                          {groupExercises.map((e, gi) => (
                            <span key={e.id}>
                              <b>{e.supersetId}{gi + 1}</b> {e.name}
                              {gi < groupExercises.length - 1 ? ' + ' : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      {supOpen && (byRounds ? (
                        <SupersetRounds
                          group={groupExercises}
                          rounds={row.supRounds?.plan ?? 3}
                          /* Отдых берём у ПОСЛЕДНЕГО упражнения связки:
                             он относится ко всему кругу. У первого там
                             стоит переход к паре («30 сек до A2»), и
                             показывать его как отдых после круга — ложь. */
                          restTime={groupExercises[groupExercises.length - 1]?.restTime || row.ex.restTime}
                          restSignal={supersetRest[supKey] ?? 0}
                          onRest={() => setSupersetRest(prev => ({ ...prev, [supKey]: (prev[supKey] ?? 0) + 1 }))}
                          onUpdateSet={(exId, setIdx, patch) => {
                            if (viewingPastWorkout) return;
                            const target = groupExercises.find(e => e.id === exId);
                            if (!target) return;
                            const sets = (target.sets ?? makeInitialSets(target.plannedSets)).map((s, j) =>
                              j === setIdx ? { ...s, ...patch } : s);
                            updateExercise(currentWorkout.id, exId, {
                              sets,
                              completed: sets.length > 0 && sets.every(s => s.completed),
                            });
                          }}
                        />
                      ) : (
                        group.map(g => g.card)
                      ))}
                      {supOpen && (
                        <button
                          type="button"
                          className="tx-supmode"
                          onClick={() => setSupersetByRounds(prev => ({ ...prev, [supKey]: !byRounds }))}
                        >
                          {byRounds ? 'показать упражнения по отдельности' : 'вернуться к кругам'}
                        </button>
                      )}
                    </div>
                  );
                  return out;
                }, [])
              ) : (
                <div style={{
                  background: 'var(--bg-card)',
                  borderRadius: '16px',
                  border: '1px solid var(--border)',
                  padding: '40px 20px',
                  textAlign: 'center'
                }}>
                  <div style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '16px',
                    background: 'var(--bg-elevated)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px'
                  }}>
                    <Dumbbell size={28} style={{ color: 'var(--text-muted)' }} />
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
                    Нет упражнений
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
                    Добавьте упражнения в тренировку
                  </div>
                  <button
                    onClick={() => openWorkoutEditor(currentWorkout.id)}
                    style={{
                      padding: '12px 24px',
                      background: 'var(--yellow)',
                      border: 'none',
                      borderRadius: '12px',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: '14px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <Plus size={18} />
                    Добавить упражнения
                  </button>
                </div>
              )
            )}


            </div>{/* end closed day dimming wrapper */}

            {/* Сводка прогресса дня убрана по запросу. */}

            {/* Steps input — moved under the Close Day button per request.
                Always editable, even for a closed day. */}
            <div style={{
              marginTop: '16px',
              padding: '12px 14px',
              background: 'var(--bg-card)',
              borderRadius: '12px',
              border: '1px solid var(--border)'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <span style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  flexShrink: 0
                }}>
                  {userSettings.language === 'ru' ? 'Шаги' : 'Steps'}
                </span>
                <input
                  type="number"
                  value={currentDayLog.steps || ''}
                  onChange={(e) => updateDayLog({ steps: e.target.value ? parseInt(e.target.value) : null })}
                  placeholder={userSettings.language === 'ru' ? 'Добавьте шаги' : 'Add steps'}
                  style={{
                    flex: 1,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: 'var(--text-primary)',
                    fontSize: '15px',
                    fontWeight: 500
                  }}
                />
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '8px 14px',
                  background: 'var(--bg-elevated)',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  minWidth: '70px'
                }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1 }}>
                    {userSettings.language === 'ru' ? 'неделя' : 'week'}
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: weeklySteps > 0 ? 'var(--blue)' : 'var(--text-muted)', lineHeight: 1.3 }}>
                    {weeklySteps.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Mini calendar */}
            <div style={{ marginTop: '28px' }}>
              <FitnessCalendar
                dayLogs={dayLogs}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                workouts={workouts}
                timezone={userSettings.timezone}
              />
            </div>

            {/* «Мой прогресс» по макету: карточка с кикером, сегментом
                показателей и графиком. Показываем всегда — при пустых
                замерах вместо графика объясняющая строка. */}
            {(() => {
              const metricOf = (m: BodyMeasurement) => bodyMetric === 'weight' ? m.weight : bodyMetric === 'waist' ? m.waist : m.chest;
              const series = bodyMeasurements
                .filter(m => typeof metricOf(m) === 'number' && (metricOf(m) as number) > 0)
                .slice()
                .sort((a2, b2) => (a2.date < b2.date ? -1 : 1));
              const unit = bodyMetric === 'weight' ? 'кг' : 'см';
              const last = series.length ? (metricOf(series[series.length - 1]) as number) : null;
              const delta = series.length > 1
                ? Math.round(((metricOf(series[series.length - 1]) as number) - (metricOf(series[0]) as number)) * 10) / 10
                : null;
              return (
                <section className="tx-card">
                  <div className="tx-card-head">
                    <div>
                      <span className="tx-eyebrow">{userSettings.language === 'ru' ? 'Вес тела и замеры' : 'Body & measurements'}</span>
                      <h4>{userSettings.language === 'ru' ? 'Мой прогресс' : 'My progress'}</h4>
                    </div>
                    <span className="tx-badge">{new Date().toLocaleDateString('ru-RU', { month: 'long' })}</span>
                  </div>
                  <div className="tx-modes" role="group">
                    {([
                      ['weight', userSettings.language === 'ru' ? 'Вес тела' : 'Weight'],
                      ['waist', userSettings.language === 'ru' ? 'Талия' : 'Waist'],
                      ['chest', userSettings.language === 'ru' ? 'Грудь' : 'Chest'],
                    ] as [typeof bodyMetric, string][]).map(([key, label]) => (
                      <button
                        key={key}
                        className={bodyMetric === key ? 'is-active' : ''}
                        onClick={() => setBodyMetric(key)}
                      >{label}</button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '12px 0 4px' }}>
                    <strong style={{ fontSize: '28px', fontWeight: 650, letterSpacing: '-0.8px', fontVariantNumeric: 'tabular-nums' }}>
                      {last !== null ? `${last.toLocaleString('ru')} ${unit}` : '—'}
                    </strong>
                    {delta !== null && (
                      <span style={{ fontSize: '11px', color: '#857565', background: '#f3eee7', padding: '4px 7px', borderRadius: '5px' }}>
                        {(delta > 0 ? '+' : '') + delta.toLocaleString('ru')} {unit}
                      </span>
                    )}
                  </div>
                  {series.length > 1 ? (
                    <WeightChart
                      data={series.map(m => metricOf(m) as number)}
                      labels={series.map(m => new Date(m.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }))}
                    />
                  ) : (
                    <p className="tx-empty">
                      {userSettings.language === 'ru'
                        ? 'Замеры появляются здесь по мере их добавления.'
                        : 'Measurements will appear here as you add them.'}
                    </p>
                  )}
                </section>
              );
            })()}
          </div>
        )}

        {/* NUTRITION VIEW — оформление по макету, данные и сервисы приложения */}
        {view === 'nutrition' && (
          <>
          <NutritionPage
            userName={userSettings.name || 'Атлет'}
            selectedDate={dateKey}
            todayStr={todayStr}
            goals={{ protein: MACRO_TARGETS.protein, fat: MACRO_TARGETS.fat, carbs: MACRO_TARGETS.carbs, calories: MACRO_TARGETS.calories }}
            mealsByDate={nutMealsByDate}
            quickFrequent={nutQuickFrequent}
            quickFavorites={nutQuickFavorites}
            onSelectDate={key => setSelectedDate(new Date(`${key}T12:00:00`))}
            onOpenAdd={() => { setNutEditing(null); setNutDialogOpen(true); }}
            onQuickAdd={m => {
              const now = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
              nutSaveMeal({ ...m, id: `${Date.now()}`, time: now, photoStamp: null, captureKind: undefined, portionGrams: null, basePortion: null },
                { date: dateKey, operationId: `${Date.now()}` });
            }}
            onEditMeal={m => { setNutEditing(m); setNutDialogOpen(true); }}
            onDeleteMeal={nutDeleteMeal}
            onToggleFavorite={nutToggleFavorite}
            onSaveGoals={g => setUserSettings(prev => ({ ...prev, goal: { protein: g.protein, fat: g.fat, carbs: g.carbs, calories: g.calories } }))}
            onOpenProfile={() => { setView('profile'); localStorage.setItem('fitness_view', 'profile'); }}
            onNavigateWorkout={() => { setView('workout'); localStorage.setItem('fitness_view', 'workout'); }}
            rhythmSlot={(
              <NutritionPlanSection
                slots={planSlots}
                dishes={planDishes}
                preferencesText={preferencesSummary}
                loading={!aiNutritionPlan && !!nutritionProfile}
                onChangeSlot={updatePlanSlot}
                onOpenSurvey={openSurvey}
                onOpenRecipe={id => {
                  // «Рецепт» в плане раскрывает карточку в разделе ниже и
                  // подводит к ней — как в эталоне, без отдельного экрана.
                  setOpenRecipeCards(prev => prev.includes(id) ? prev : [...prev, id]);
                  requestAnimationFrame(() => {
                    document.querySelector(`[data-recipe="${id}"]`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  });
                }}
              />
            )}
            recipesSlot={(
              <>
                {/* Скрытый input «Скан»: фото страницы рецепта → разбор ИИ. */}
                <input
                  ref={recipePhotoRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleRecipePhoto}
                />
                <NutritionRecipesSection
                  recipes={recipeCards}
                  selectedDateText={selectedDateText}
                  openIds={openRecipeCards}
                  onToggle={toggleRecipeCard}
                  onAddPortion={addRecipePortion}
                  onScan={() => recipePhotoRef.current?.click()}
                  onCreate={() => setShowRecipeForm(true)}
                />
              </>
            )}
          />

          {/* Отмена удаления — тост приложения */}
          {nutUndo && (
            <div className="nutv2-toast is-visible" role="status">
              <span>Приём пищи удалён</span>
              <button type="button" onClick={nutRestoreMeal}>Отменить</button>
            </div>
          )}

          {/* Порция добавлена из рецепта — можно сразу отменить.
              Показываем, только пока нет тоста удаления: два тоста
              наложились бы друг на друга. */}
          {recipeUndo && !nutUndo && (
            <div className="nutv2-toast is-visible" role="status">
              <span>{recipeUndo.name}: 1 порция в дневнике</span>
              <button type="button" onClick={undoRecipePortion}>Отменить</button>
            </div>
          )}

          <AddMealDialog
            open={nutDialogOpen}
            selectedDate={dateKey}
            quickItems={nutQuickFrequent}
            editing={nutEditing}
            onClose={() => { setNutDialogOpen(false); setNutEditing(null); }}
            onAnalyze={nutAnalyze}
            onSave={nutSaveMeal}
            onQuickAdd={m => {
              const now = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
              nutSaveMeal({ ...m, id: `${Date.now()}`, time: now, photoStamp: null, captureKind: undefined, portionGrams: null, basePortion: null },
                { date: dateKey, operationId: `${Date.now()}` });
            }}
            onViewInDiary={(id) => {
              requestAnimationFrame(() => document.querySelector(`[data-meal-card="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
            }}
          />
          </>
        )}


        {/* Под-навигация раздела «Я»: Профиль · Здоровье · Статистика.
            Стоит над всеми тремя экранами (раньше на «Здоровье» и
            «Статистике» оказывалась внизу — блок шёл после них). */}
        {(view === 'profile' || view === 'gains' || view === 'analytics') && (
          <div className="tx">
            <div className="segmented" role="tablist">
              {([
                { key: 'profile', ru: 'Профиль', en: 'Profile' },
                { key: 'gains', ru: 'Здоровье', en: 'Health' },
                { key: 'analytics', ru: 'Статистика', en: 'Stats' },
              ] as { key: typeof view; ru: string; en: string }[]).map((sub) => (
                <button
                  key={sub.key}
                  type="button"
                  role="tab"
                  aria-selected={view === sub.key}
                  className={view === sub.key ? 'active' : undefined}
                  onClick={() => { setView(sub.key); localStorage.setItem('fitness_view', sub.key); }}
                >
                  {userSettings.language === 'ru' ? sub.ru : sub.en}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* СТАТИСТИКА — по макету редизайна (StatsView) */}
        {view === 'analytics' && (
          <div className="view-content">
            <StatsView
              dayLogs={dayLogs}
              workouts={workouts}
              muscleGroups={muscleGroups}
              todayStr={todayStr}
              onSelectDate={(date) => {
                setSelectedDate(date);
                setView('workout');
                localStorage.setItem('fitness_view', 'workout');
              }}
            />
          </div>
        )}

        {/* ЗДОРОВЬЕ (бывшие «Замеры») — по макету редизайна: обзор,
            препараты и общий журнал. Данные и сохранение прежние. */}
        {view === 'gains' && (
          <div className="view-content">
            <HealthView
              today={todayStr}
              measurements={bodyMeasurements}
              vitals={vitals}
              checkinFields={checkinFields}
              checkinEntries={checkinEntries}
              medCourses={medCourses}
              medLogs={medLogs}
              onSaveMeasurement={saveMeasurement}
              onDeleteMeasurement={deleteMeasurement}
              onEditMeasurement={editMeasurement}
              onSaveVitals={saveVitals}
              onSaveCheckins={saveCheckins}
              onSaveMeds={saveMeds}
            />
          </div>
        )}

        {/* PLANNER VIEW */}
        {view === 'planner' && (
          <div className="view-content">
            <PlannerView
              events={plannerEvents}
              onEventsChange={setPlannerEvents}
              todayStr={todayStr}
              lang={userSettings.language === 'ru' ? 'ru' : 'en'}
              timezone={userSettings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
              medCourses={medCourses}
            />
          </div>
        )}


        {/* PROFILE VIEW — по макету редизайна: цель, питание, свёрнутые настройки */}
        {view === 'profile' && (
          <div className="view-content">
            <ProfileView
              lang={userSettings.language === 'ru' ? 'ru' : 'en'}
              name={userSettings.name}
              email={userSettings.email}
              goalType={userSettings.goalType ?? 'maintain'}
              goal={MACRO_TARGETS}
              theme={themePref}
              timezone={userSettings.timezone}
              about={aboutMe}
              latestWeight={latestWeight}
              onSettings={updateSettings}
              onAbout={(next) => {
                setAboutMe(next);
                const year = parseInt(next.birthYear, 10);
                const height = parseInt(next.heightCm, 10);
                saveAboutMe({
                  birthYear: Number.isFinite(year) ? year : null,
                  heightCm: Number.isFinite(height) ? height : null,
                  sex: next.sex || null,
                });
              }}
              onDiscussGoal={(prompt) => {
                setChatDraft(prompt);
                setView('chat');
              }}
              onSignOut={() => {
                if (confirm(t('signOutConfirm') as string)) {
                  localStorage.clear();
                  signOut({ callbackUrl: '/login' });
                }
              }}
              extraSettings={oura && (oura.configured || oura.days.length > 0) ? (
                // Кольцо Oura: сон, готовность, пульс покоя и ВСР. Блок есть,
                // только если ключи заданы на сервере или остались выгрузки.
                <div className="setting-block">
                  <b>Кольцо Oura</b>
                  <p className="muted">
                    {oura.connected
                      ? 'Сон, готовность, пульс покоя и ВСР подтягиваются автоматически. ИИ учитывает их, когда советует нагрузку.'
                      : 'Подключи, чтобы ИИ видел сон и восстановление: застой в весах часто идёт от недосыпа, а не от программы.'}
                  </p>
                  {oura.days.length > 0 && (() => {
                    const last = oura.days[0];
                    const hhmm = (m: number | null) => m == null ? '—' : `${Math.floor(m / 60)}ч ${String(m % 60).padStart(2, '0')}м`;
                    return (
                      <div className="oura-metrics">
                        {[
                          ['Сон', hhmm(last.totalSleepMin)],
                          ['Готовность', last.readinessScore ?? '—'],
                          ['Пульс покоя', last.restingHr ?? '—'],
                          ['ВСР', last.hrvMs != null ? `${last.hrvMs} мс` : '—'],
                        ].map(([k, v]) => (
                          <div key={String(k)}><small>{k}</small><b>{v}</b></div>
                        ))}
                        <small className="oura-date">за {last.date}</small>
                      </div>
                    );
                  })()}
                  {oura.connected ? (
                    <div className="setting-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={ouraBusy}
                        onClick={async () => {
                          setOuraBusy(true);
                          try {
                            await fetch('/api/oura', { method: 'POST' });
                            const r = await fetch('/api/oura');
                            if (r.ok) setOura(await r.json());
                          } finally { setOuraBusy(false); }
                        }}
                      >{ouraBusy ? 'Обновляю…' : 'Обновить данные'}</button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={async () => {
                          await fetch('/api/oura', { method: 'DELETE' });
                          const r = await fetch('/api/oura');
                          if (r.ok) setOura(await r.json());
                        }}
                      >Отключить</button>
                    </div>
                  ) : oura.configured ? (
                    <a href="/api/oura/connect" className="dark-action oura-connect">Подключить Oura</a>
                  ) : (
                    // Ключей приложения нет — кнопка вела бы в никуда,
                    // но показанные выше данные остаются доступными.
                    <p className="muted">Подключение пока не настроено. Показатели выше — из прошлых выгрузок.</p>
                  )}
                </div>
              ) : null}
            />
          </div>
        )}

        {/* CHAT VIEW — вкладка «ИИ» по макету: обычная страница с нижним
            меню; длинную переписку панель диалога разворачивает поверх. */}
        {view === 'chat' && (
          <div className="view-content">
            <AssistantChat
              muscleGroups={muscleGroups}
              onProgramReady={(p) => {
                // Ассистент собрал программу — показываем её на экране
                // «Программа», где уже есть просмотр и кнопки «Принять»
                // и «Отклонить». Подтверждение не должно жить в ленте.
                setProgramProposal(p);
                setShowProgramModal(true);
              }}
              onWorkoutEdit={(e) => setWorkoutEdit(e)}
              /* Предложение ждёт решения — даём путь обратно к нему,
                 иначе после «Обсудить» к программе не вернуться. */
              pendingProgram={programProposal ? {
                days: programProposal.workouts.length,
                open: () => setShowProgramModal(true),
              } : undefined}
              initialInput={chatDraft ?? undefined}
              onInitialInputUsed={clearChatDraft}
            />
          </div>
        )}

        {/* LABS VIEW — анализы: загрузка, парсинг, динамика */}
        {view === 'labs' && <LabsView />}

      </div>

      {/* Add/Edit Measurement Modal */}
      {showMeasurementModal && (
        <div className="modal-overlay" onClick={() => { setShowMeasurementModal(false); setEditingMeasurement(null); }}>
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{ padding: '24px' }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px'
            }}>
              <h3 style={{ fontSize: '18px', fontWeight: 700 }}>
                {editingMeasurement ? t('editMeasurements') : t('newMeasurements')}
              </h3>
              <button
                onClick={() => { setShowMeasurementModal(false); setEditingMeasurement(null); }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px'
                }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              const form = e.target as HTMLFormElement;
              const formData = new FormData(form);
              const dateValue = formData.get('date') as string;
              const measurement: BodyMeasurement = {
                id: editingMeasurement?.id || Date.now().toString(),
                // Местный полдень выбранного дня: полночь UTC в западных
                // поясах показывалась предыдущим днём.
                date: dateValue ? new Date(`${dateValue}T12:00:00`).toISOString() : new Date().toISOString(),
                weight: formData.get('weight') ? Number(formData.get('weight')) : undefined,
                waist: formData.get('waist') ? Number(formData.get('waist')) : undefined,
                chest: formData.get('chest') ? Number(formData.get('chest')) : undefined,
                bicepsLeft: formData.get('bicepsLeft') ? Number(formData.get('bicepsLeft')) : undefined,
                bicepsRight: formData.get('bicepsRight') ? Number(formData.get('bicepsRight')) : undefined,
                thighs: formData.get('thighs') ? Number(formData.get('thighs')) : undefined,
                hips: formData.get('hips') ? Number(formData.get('hips')) : undefined,
                notes: formData.get('notes') as string || undefined
              };
              userMadeChangeRef.current = true;
              if (editingMeasurement) {
                setBodyMeasurements(prev => prev.map(m => m.id === editingMeasurement.id ? measurement : m));
              } else {
                setBodyMeasurements(prev => [...prev, measurement]);
              }
              setShowMeasurementModal(false);
              setEditingMeasurement(null);
            }}>
              {/* Date picker */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                  {t('date')}
                </label>
                <input
                  type="date"
                  name="date"
                  defaultValue={editingMeasurement ? formatDate(new Date(editingMeasurement.date)) : todayStr}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    color: 'var(--text-primary)',
                    fontSize: '15px'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                    {t('weight')}
                  </label>
                  <input
                    type="number"
                    name="weight"
                    step="0.1"
                    placeholder="75.5"
                    defaultValue={editingMeasurement?.weight || ''}
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      fontSize: '15px'
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                    {t('waistCm')}
                  </label>
                  <input
                    type="number"
                    name="waist"
                    step="0.1"
                    placeholder="80"
                    defaultValue={editingMeasurement?.waist || ''}
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      fontSize: '15px'
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                    {t('chestCm')}
                  </label>
                  <input
                    type="number"
                    name="chest"
                    step="0.1"
                    placeholder="100"
                    defaultValue={editingMeasurement?.chest || ''}
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      fontSize: '15px'
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                    {t('bicepsLeftCm')}
                  </label>
                  <input
                    type="number"
                    name="bicepsLeft"
                    step="0.1"
                    placeholder="35"
                    defaultValue={editingMeasurement?.bicepsLeft || ''}
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      fontSize: '15px'
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                    {t('bicepsRightCm')}
                  </label>
                  <input
                    type="number"
                    name="bicepsRight"
                    step="0.1"
                    placeholder="35"
                    defaultValue={editingMeasurement?.bicepsRight || ''}
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      fontSize: '15px'
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                    {t('thighsCm')}
                  </label>
                  <input
                    type="number"
                    name="thighs"
                    step="0.1"
                    placeholder="55"
                    defaultValue={editingMeasurement?.thighs || ''}
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      fontSize: '15px'
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                    {t('hipsCm')}
                  </label>
                  <input
                    type="number"
                    name="hips"
                    step="0.1"
                    placeholder="95"
                    defaultValue={editingMeasurement?.hips || ''}
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      fontSize: '15px'
                    }}
                  />
                </div>
              </div>
              <div style={{ marginTop: '12px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                  {t('measurementNotes')}
                </label>
                <input
                  type="text"
                  name="notes"
                  placeholder={t('measurementNotesPlaceholder') as string}
                  defaultValue={editingMeasurement?.notes || ''}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    color: 'var(--text-primary)',
                    fontSize: '15px'
                  }}
                />
              </div>
              <button
                type="submit"
                style={{
                  width: '100%',
                  marginTop: '20px',
                  padding: '14px',
                  background: 'var(--yellow)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '15px',
                  cursor: 'pointer'
                }}
              >
                {t('save')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Night Meal Day Selection Modal */}
      {showNightMealPrompt && pendingMealData && (
        <div className="modal-overlay" onClick={() => {
          setShowNightMealPrompt(false);
          setPendingMealData(null);
        }}>
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{
              padding: '24px',
              maxWidth: '320px',
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🌙</div>
            <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>
              Поздний перекус
            </div>
            <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px' }}>
              На какой день записать «{pendingMealData.name}»?
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                onClick={() => handleNightMealDaySelect(true)}
                style={{
                  padding: '14px 20px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  color: 'var(--text-primary)',
                  fontSize: '15px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <span>⬅️</span> Вчера (ещё не спал)
              </button>
              <button
                onClick={() => handleNightMealDaySelect(false)}
                style={{
                  padding: '14px 20px',
                  background: 'var(--yellow)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '15px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <span>➡️</span> Сегодня (новый день)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Meal Modal */}
      {/* Карточка рецепта */}
      {openRecipeId && (() => {
        const r = recipes.find(x => x.id === openRecipeId);
        if (!r) return null;
        return (
        <div className="modal-overlay" onClick={() => setOpenRecipeId(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ padding: '20px', maxHeight: '88vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, lineHeight: 1.3 }}>{r.name}</div>
              <button onClick={() => setOpenRecipeId(null)} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '8px', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              На порцию: <b>{r.perServing.calories} ккал</b> · Б {r.perServing.protein} · Ж {r.perServing.fat} · У {r.perServing.carbs} · сахар {r.perServing.sugar} г
              {r.servings > 1 ? ` · рецепт на ${r.servings} порц.` : ''}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
              {RECIPE_CATEGORIES.map(c => (
                <button key={c}
                  onClick={() => saveRecipes(recipes.map(x => x.id === r.id ? { ...x, category: c } : x))}
                  style={{
                    padding: '6px 10px', borderRadius: '14px', cursor: 'pointer', fontSize: '11px',
                    background: (r.category || 'другое') === c ? 'var(--yellow)' : 'var(--bg-elevated)',
                    border: '1px solid ' + ((r.category || 'другое') === c ? 'var(--yellow)' : 'var(--border)'),
                    color: (r.category || 'другое') === c ? '#fff' : 'var(--text-muted)',
                    fontWeight: (r.category || 'другое') === c ? 700 : 500,
                  }}>{c}</button>
              ))}
            </div>
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>Ингредиенты</div>
            <div style={{ marginBottom: '14px' }}>
              {r.ingredients.map((ing, i) => (
                <div key={i} style={{ fontSize: '13px', color: 'var(--text-primary)', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>• {ing}</div>
              ))}
            </div>
            {r.steps.length > 0 && (
              <>
                <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>Приготовление</div>
                <div style={{ marginBottom: '16px' }}>
                  {r.steps.map((st, i) => (
                    <div key={i} style={{ fontSize: '13px', color: 'var(--text-secondary)', padding: '4px 0', lineHeight: 1.5 }}>
                      <b style={{ color: 'var(--yellow)' }}>{i + 1}.</b> {st}
                    </div>
                  ))}
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => { if (confirm('Удалить рецепт?')) { saveRecipes(recipes.filter(x => x.id !== r.id)); setOpenRecipeId(null); } }}
                style={{ padding: '13px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '12px', color: 'var(--red)', cursor: 'pointer' }}
              >
                <Trash2 size={16} />
              </button>
              <button
                onClick={() => eatRecipe(r)}
                style={{ flex: 1, padding: '13px', background: 'var(--yellow)', border: 'none', borderRadius: '12px', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}
              >
                Съел — добавить в приёмы пищи
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Ручное добавление рецепта */}
      {showRecipeForm && (
        <div className="modal-overlay" onClick={() => setShowRecipeForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ padding: '20px', maxHeight: '88vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '17px', fontWeight: 700 }}>Новый рецепт</div>
              <button onClick={() => setShowRecipeForm(false)} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '8px', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            <input type="text" placeholder="Название" value={recipeForm.name}
              onChange={e => setRecipeForm(f => ({ ...f, name: e.target.value }))}
              style={{ width: '100%', marginBottom: '10px' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
              {RECIPE_CATEGORIES.map(c => (
                <button key={c} onClick={() => setRecipeForm(f => ({ ...f, category: c }))} style={{
                  padding: '7px 11px', borderRadius: '16px', cursor: 'pointer', fontSize: '12px',
                  background: recipeForm.category === c ? 'var(--yellow)' : 'var(--bg-elevated)',
                  border: '1px solid ' + (recipeForm.category === c ? 'var(--yellow)' : 'var(--border)'),
                  color: recipeForm.category === c ? '#fff' : 'var(--text-primary)',
                  fontWeight: recipeForm.category === c ? 700 : 500,
                }}>{c}</button>
              ))}
            </div>
            <textarea rows={4} placeholder={'Ингредиенты — по одному на строку:\nКуриная грудка — 400 г\nРис — 150 г'} value={recipeForm.ingredients}
              onChange={e => setRecipeForm(f => ({ ...f, ingredients: e.target.value }))}
              style={{ width: '100%', marginBottom: '10px', fontSize: '14px' }} />
            <textarea rows={4} placeholder={'Шаги приготовления — по одному на строку'} value={recipeForm.steps}
              onChange={e => setRecipeForm(f => ({ ...f, steps: e.target.value }))}
              style={{ width: '100%', marginBottom: '10px', fontSize: '14px' }} />
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>На одну порцию:</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', marginBottom: '10px' }}>
              {([['calories', 'Ккал'], ['protein', 'Белок'], ['fat', 'Жиры'], ['carbs', 'Углев'], ['sugar', 'Сахар']] as const).map(([k, label]) => (
                <div key={k}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px', textAlign: 'center' }}>{label}</div>
                  <input type="number" placeholder="0" value={recipeForm[k]}
                    onChange={e => setRecipeForm(f => ({ ...f, [k]: e.target.value }))}
                    style={{ width: '100%', textAlign: 'center', padding: '10px 4px' }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Порций в рецепте:</span>
              <input type="number" value={recipeForm.servings}
                onChange={e => setRecipeForm(f => ({ ...f, servings: e.target.value }))}
                style={{ width: '70px', textAlign: 'center' }} />
            </div>
            <button
              onClick={addManualRecipe}
              disabled={!recipeForm.name.trim()}
              style={{ width: '100%', padding: '14px', background: 'var(--yellow)', border: 'none', borderRadius: '12px', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer', opacity: recipeForm.name.trim() ? 1 : 0.5 }}
            >
              Сохранить рецепт
            </button>
          </div>
        </div>
      )}

      {/* Опрос-диалог: ИИ сам ведёт интервью о питании */}
      {showNutritionSurvey && (
        <div className="modal-overlay" onClick={() => setShowNutritionSurvey(false)}>
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{ padding: '0', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Brain size={17} style={{ color: 'var(--yellow)' }} />
                Опрос о питании
              </div>
              <button onClick={() => setShowNutritionSurvey(false)} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '8px', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>

            {/* Лента диалога */}
            <div
              ref={el => { if (el) el.scrollTop = el.scrollHeight; }}
              style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px', minHeight: '200px' }}
            >
              {surveyChat.map((m, i) => (
                m.role === 'user' ? (
                  /* Ответ пользователя — капсула с белым фоном */
                  <div key={i} style={{
                    alignSelf: 'flex-end',
                    maxWidth: '85%',
                    padding: '10px 14px',
                    borderRadius: '14px 14px 4px 14px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-strong)',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                    lineHeight: 1.45,
                  }}>
                    {m.content}
                  </div>
                ) : (
                  /* Текст ИИ — без капсулы, обычный текст на фоне (капсулы
                     остаются только у данных: варианты ответов и т.п.) */
                  <div key={i} style={{
                    alignSelf: 'stretch',
                    color: m.error ? 'var(--red)' : 'var(--text-primary)',
                    fontSize: '14px',
                    lineHeight: 1.55,
                  }}>
                    {m.content}
                  </div>
                )
              ))}
              {surveyBusy && (
                <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px', padding: '6px 4px' }}>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  печатает…
                </div>
              )}
              {surveyResult && !surveyBusy && (
                <button
                  onClick={saveNutritionProfile}
                  style={{
                    alignSelf: 'stretch', marginTop: '6px', padding: '14px',
                    background: 'var(--green)', border: 'none', borderRadius: '12px',
                    color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer'
                  }}
                >
                  Построить рекомендации
                </button>
              )}
            </div>

            {/* Быстрые ответы + ввод */}
            {!surveyResult && (
              <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--border)' }}>
                {surveyRetryRef.current && !surveyBusy && (
                  <button
                    onClick={() => { const p = surveyRetryRef.current!; surveyTurn(p); }}
                    style={{
                      width: '100%', marginBottom: '10px', padding: '11px',
                      background: 'var(--yellow)', border: 'none', borderRadius: '10px',
                      color: '#fff', fontWeight: 700, fontSize: '13px', cursor: 'pointer'
                    }}
                  >Повторить</button>
                )}
                {surveyOptions.length > 0 && !surveyBusy && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                    {surveyOptions.map((o, i) => (
                      <button
                        key={i}
                        onClick={() => answerSurvey(o)}
                        style={{
                          padding: '9px 13px', borderRadius: '18px',
                          background: 'var(--yellow-dim)', border: '1px solid var(--yellow-glow)',
                          color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer'
                        }}
                      >{o}</button>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={surveyInput}
                    onChange={e => setSurveyInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') answerSurvey(surveyInput); }}
                    placeholder={surveyBusy ? 'Секунду…' : 'Или напиши свой ответ…'}
                    disabled={surveyBusy}
                    style={{ flex: 1, fontSize: '14px' }}
                  />
                  <button
                    onClick={() => answerSurvey(surveyInput)}
                    disabled={surveyBusy || !surveyInput.trim()}
                    style={{
                      padding: '0 18px', background: 'var(--yellow)', border: 'none',
                      borderRadius: '12px', color: '#fff', fontWeight: 700, cursor: 'pointer',
                      opacity: surveyBusy || !surveyInput.trim() ? 0.5 : 1
                    }}
                  >➤</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Программа: ИИ-предложение новой + история старых */}
      {/* Правка одной тренировки от ассистента: показываем, что станет,
          и применяем только по кнопке. */}
      {workoutEdit && (() => {
        const target = workouts.find(w => w.id === workoutEdit.workoutId);
        const before = target?.exercises ?? [];
        const beforeNames = new Set(before.map(e => e.name.trim().toLowerCase()));
        const afterNames = new Set(workoutEdit.exercises.map(e => e.name.trim().toLowerCase()));
        return (
          <div className="modal-overlay" onClick={() => setWorkoutEdit(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ padding: '22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '6px' }}>
                <Dumbbell size={18} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
                <span style={{ fontSize: '17px', fontWeight: 800 }}>
                  Правка: {target?.name ?? workoutEdit.workoutId}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '14px' }}>
                {workoutEdit.summary}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
                {workoutEdit.exercises.map((e, i) => {
                  const isNew = !beforeNames.has(e.name.trim().toLowerCase());
                  return (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', gap: '8px',
                      padding: '7px 10px', borderRadius: '9px', fontSize: '12px',
                      background: isNew ? 'var(--yellow-dim)' : 'var(--bg-elevated)',
                      border: `1px solid ${isNew ? 'var(--yellow)' : 'var(--border)'}`,
                    }}>
                      <span style={{ color: 'var(--text-primary)' }}>
                        {isNew && <b style={{ color: 'var(--yellow)' }}>+ </b>}
                        {e.name}
                        {e.supersetId ? ` · суперсет ${e.supersetId}` : ''}
                      </span>
                      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{e.plannedSets}</span>
                    </div>
                  );
                })}
                {/* Что убрали — показываем отдельно, иначе пропажа
                    упражнения останется незамеченной. */}
                {before.filter(e => !afterNames.has(e.name.trim().toLowerCase())).map((e, i) => (
                  <div key={`rm-${i}`} style={{
                    display: 'flex', justifyContent: 'space-between', gap: '8px',
                    padding: '7px 10px', borderRadius: '9px', fontSize: '12px',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    color: 'var(--text-muted)', textDecoration: 'line-through',
                  }}>
                    <span>− {e.name}</span>
                    <span style={{ flexShrink: 0 }}>{e.plannedSets}</span>
                  </div>
                ))}
              </div>

              {/* Главная кнопка отдельной строкой, остальные под ней:
                  три в ряд на узком экране ужимаются до нечитаемых. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  onClick={async () => {
                    if (applyingEdit) return;
                    setApplyingEdit(true);
                    try {
                      await applyWorkoutEdit(workoutEdit);
                      setWorkoutEdit(null);
                      if (view === 'chat') {
                        setView('workout');
                        localStorage.setItem('fitness_view', 'workout');
                      }
                    } finally {
                      setApplyingEdit(false);
                    }
                  }}
                  disabled={applyingEdit}
                  style={{
                    padding: '14px', background: 'var(--green)',
                    border: 'none', borderRadius: '12px',
                    color: '#fff', fontWeight: 700, fontSize: '14px',
                    cursor: applyingEdit ? 'not-allowed' : 'pointer',
                  }}
                >{applyingEdit ? 'Применяю…' : 'Применить'}</button>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => {
                      // Окно закрываем, но правку не отменяем: её хотят
                      // обсудить в чате и, возможно, поправить.
                      setWorkoutEdit(null);
                      setView('chat');
                      localStorage.setItem('fitness_view', 'chat');
                    }}
                    disabled={applyingEdit}
                    style={{
                      flex: 1, padding: '12px', background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)', borderRadius: '11px',
                      color: 'var(--text-primary)', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                    }}
                  >Обсудить</button>
                  <button
                    onClick={() => {
                      const summary = workoutEdit.summary;
                      setWorkoutEdit(null);
                      fetch('/api/chat', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ accepted: false, edit: summary }),
                      }).catch(() => { /* отметка не критична */ });
                    }}
                    disabled={applyingEdit}
                    style={{
                      flex: 1, padding: '12px', background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)', borderRadius: '11px',
                      color: 'var(--text-secondary)', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                    }}
                  >Отклонить</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {showProgramModal && (
        <div className="modal-overlay" onClick={() => setShowProgramModal(false)}>
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{ padding: '20px', maxHeight: '88vh', overflow: 'auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={18} style={{ color: 'var(--yellow)' }} />
                Программа
              </div>
              <button
                onClick={() => setShowProgramModal(false)}
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '8px', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Текущая программа кратко */}
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              Сейчас: {workouts.filter(w => w.exercises.length > 0).length} тренировок,{' '}
              {workouts.reduce((n, w) => n + w.exercises.length, 0)} упражнений.
              ИИ посмотрит на неё, твои рабочие веса, частоту и цель — и предложит замену.
              Старая программа уйдёт в историю ниже, её всегда можно вернуть.
            </div>

            {!programProposal && (
              <>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                  Пожелания (необязательно)
                </label>
                <textarea
                  value={programWishes}
                  onChange={e => setProgramWishes(e.target.value)}
                  placeholder="Например: больше упор на плечи и спину, без становой тяги, есть гантели до 40 кг…"
                  rows={3}
                  style={{ width: '100%', marginBottom: '12px', fontSize: '14px' }}
                />
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Тренировок в неделю
                </div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
                  {[2, 3, 4, 5, 6].map(n => (
                    <button
                      key={n}
                      onClick={() => setProgramDays(n)}
                      style={{
                        flex: 1, padding: '10px 0',
                        background: programDays === n ? 'var(--yellow)' : 'var(--bg-elevated)',
                        border: '1px solid var(--border)', borderRadius: '10px',
                        color: programDays === n ? '#fff' : 'var(--text-secondary)',
                        fontWeight: 700, cursor: 'pointer'
                      }}
                    >{n}</button>
                  ))}
                </div>
                {/* Режим спрашиваем перед КАЖДОЙ генерацией: готовность к
                    интенсивным техникам зависит от текущего состояния, а
                    не от выбора, сделанного месяц назад. */}
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Режим программы
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                  {([
                    { on: false, title: 'Стандартный', sub: 'Обычные подходы с отдыхом между ними' },
                    { on: true, title: 'Продвинутый', sub: 'Суперсеты, дропсеты, работа до отказа' },
                  ]).map(m => (
                    <button
                      key={String(m.on)}
                      onClick={() => setProgramAdvanced(m.on)}
                      style={{
                        textAlign: 'left', padding: '11px 13px',
                        background: programAdvanced === m.on ? 'var(--yellow-dim)' : 'var(--bg-elevated)',
                        border: `1px solid ${programAdvanced === m.on ? 'var(--yellow)' : 'var(--border)'}`,
                        borderRadius: '10px', cursor: 'pointer',
                      }}
                    >
                      <div style={{
                        fontSize: '13px', fontWeight: 700,
                        color: programAdvanced === m.on ? 'var(--yellow)' : 'var(--text-primary)',
                      }}>{m.title}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{m.sub}</div>
                    </button>
                  ))}
                </div>
                <button
                  onClick={requestProgram}
                  disabled={programLoading}
                  style={{
                    width: '100%', padding: '14px',
                    background: 'var(--yellow)', border: 'none', borderRadius: '12px',
                    color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    opacity: programLoading ? 0.7 : 1
                  }}
                >
                  {programLoading
                    ? (<><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Составляю программу…</>)
                    : (<><Sparkles size={16} /> Предложить новую программу</>)}
                </button>
                {programError && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--red)' }}>{programError}</div>
                )}
              </>
            )}

            {/* Предложение ИИ */}
            {programProposal && (
              <div>
                <div style={{
                  padding: '12px 14px', background: 'var(--yellow-dim)',
                  border: '1px solid var(--yellow-glow)', borderRadius: '12px',
                  fontSize: '12px', color: 'var(--text-primary)', marginBottom: '12px', lineHeight: 1.5
                }}>
                  {programProposal.rationale}
                </div>
                {programProposal.workouts.map((w, i) => (
                  <div key={i} style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: '12px', padding: '12px 14px', marginBottom: '8px'
                  }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>
                      T{i + 1} — {w.focus}
                    </div>
                    {w.exercises.map((e, j) => (
                      <div key={j} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '12px', padding: '3px 0' }}>
                        <span style={{ color: 'var(--text-primary)' }}>{j + 1}. {e.name}</span>
                        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{e.plannedSets}</span>
                      </div>
                    ))}
                  </div>
                ))}
                {/* Три исхода, а не два: кроме «да» и «нет» нужен
                    разговор — что-то поменять, о чём-то спросить.
                    Предложение при этом НЕ теряется: вернёшься к нему
                    из чата, когда договоритесь. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                  <button
                    onClick={acceptProgram}
                    style={{
                      padding: '14px', background: 'var(--green)',
                      border: 'none', borderRadius: '12px',
                      color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer'
                    }}
                  >Принять программу</button>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => {
                        // Уходим в чат, предложение оставляем: ассистент
                        // поправит его и пришлёт заново, либо вернёшься
                        // к этому же экрану кнопкой «К программе».
                        setShowProgramModal(false);
                        setView('chat');
                        localStorage.setItem('fitness_view', 'chat');
                      }}
                      style={{
                        flex: 1, padding: '12px', background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)', borderRadius: '11px',
                        color: 'var(--text-primary)', fontWeight: 600, fontSize: '13px', cursor: 'pointer'
                      }}
                    >Обсудить и поправить</button>
                    <button
                      onClick={() => {
                        setProgramProposal(null);
                        // Отклонение тоже отмечаем: иначе ассистент решит,
                        // что предложение всё ещё ждёт ответа.
                        fetch('/api/chat', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ accepted: false }),
                        }).catch(() => { /* отметка не критична */ });
                      }}
                      style={{
                        flex: 1, padding: '12px', background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)', borderRadius: '11px',
                        color: 'var(--text-secondary)', fontWeight: 600, fontSize: '13px', cursor: 'pointer'
                      }}
                    >Отклонить</button>
                  </div>
                </div>
              </div>
            )}

            {/* История программ */}
            {programArchive.length > 0 && (
              <div style={{ marginTop: '18px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '8px' }}>
                  История программ
                </div>
                {programArchive.map(p => {
                  // Период и регулярность считаем из журнала: archivedAt —
                  // это дата замены в базе, а тренироваться по программе
                  // могли ещё долго после неё.
                  const span = programSpan(
                    p.workouts,
                    [workouts, ...programArchive.filter(o => o.id !== p.id).map(o => o.workouts)],
                    dayLogs,
                  );
                  return (
                  <div key={p.id} style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: '12px', padding: '12px 14px', marginBottom: '8px'
                  }}>
                    <div
                      onClick={() => setExpandedArchiveId(prev => prev === p.id ? null : p.id)}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', gap: '8px' }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>
                          {span
                            ? `${fmtSpanDate(span.from)} — ${fmtSpanDate(span.to)}`
                            : p.label}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {span
                            ? `${span.count} ${span.count === 1 ? 'тренировка' : span.count < 5 ? 'тренировки' : 'тренировок'} · ${p.workouts.filter(w => w.exercises.length > 0).length} в программе`
                            : `${p.workouts.filter(w => w.exercises.length > 0).length} тренировок · в архиве с ${fmtSpanDate(p.archivedAt.slice(0, 10))}`}
                        </div>
                        {span?.perWeek != null && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {span.perWeek} в неделю{span.maxGap >= 7 ? ` · перерыв до ${span.maxGap} дн.` : ''}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); restoreProgram(p); }}
                        style={{
                          padding: '8px 12px', background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)', borderRadius: '10px',
                          color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', flexShrink: 0
                        }}
                      >Вернуть</button>
                    </div>
                    {expandedArchiveId === p.id && (
                      <div style={{ marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                        {p.workouts.filter(w => w.exercises.length > 0).map(w => (
                          <div key={w.id} style={{ marginBottom: '8px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '3px' }}>
                              {w.name.replace('Тренировка ', 'T')}
                            </div>
                            {w.exercises.map(e => (
                              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px', color: 'var(--text-secondary)', padding: '2px 0' }}>
                                <span>{e.name}</span>
                                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{e.plannedSets}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {showMealModal && (
        <div className="modal-overlay" onClick={() => setShowMealModal(false)}>
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{ padding: '24px' }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px'
            }}>
              <div style={{ fontSize: '20px', fontWeight: 700 }}>
                {editingMeal ? t('editMealTitle') : t('addMealTitle')}
              </div>
              <button
                onClick={() => setShowMealModal(false)}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '10px',
                  color: 'var(--text-muted)'
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Quick add from history - only when adding new meal */}
            {!editingMeal && mealHistory.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <History size={14} />
                  {userSettings.language === 'ru' ? 'Быстрое добавление' : 'Quick add'}
                </div>
                <div style={{
                  display: 'flex',
                  gap: '8px',
                  overflowX: 'auto',
                  paddingBottom: '8px'
                }}>
                  {mealHistory.slice(0, 6).map((item, idx) => (
                    <button
                      key={`history-${idx}`}
                      type="button"
                      onClick={() => {
                        const newMeal: Meal = {
                          id: Date.now().toString(),
                          time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                          name: item.meal.name,
                          protein: item.meal.protein,
                          fat: item.meal.fat,
                          carbs: item.meal.carbs,
                          calories: item.meal.calories,
                          sugar: item.meal.sugar
                        };
                        updateDayLog({ meals: [...currentDayLog.meals, newMeal] });
                        setShowMealModal(false);
                      }}
                      style={{
                        flexShrink: 0,
                        padding: '10px 14px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        minWidth: '120px',
                        maxWidth: '160px'
                      }}
                    >
                      <div style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {item.meal.name}
                      </div>
                      <div style={{
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        marginTop: '4px'
                      }}>
                        {item.meal.protein}Б {item.meal.fat}Ж {item.meal.carbs}У
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* AI Scan Section */}
            {!editingMeal && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ position: 'relative' }}>
                  <input
                    ref={foodImageInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const scanType = foodImageInputRef.current?.dataset.scanType as 'nutrition_label' | 'food_photo';
                      handleFoodImageSelect(e, scanType || 'food_photo');
                    }}
                  />

                  {/* Hint input for AI */}
                  <div style={{ marginBottom: '10px' }}>
                    <input
                      type="text"
                      value={foodHint}
                      onChange={(e) => setFoodHint(e.target.value)}
                      placeholder={userSettings.language === 'ru'
                        ? 'Подсказка для AI (напр: жареная курица, без масла)'
                        : 'Hint for AI (e.g.: fried chicken, no oil)'}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        fontSize: '13px'
                      }}
                    />
                  </div>

                  {isAnalyzingFood ? (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '16px',
                      padding: '30px 20px',
                      background: 'linear-gradient(135deg, var(--bg-elevated) 0%, var(--bg-card) 100%)',
                      borderRadius: '16px',
                      border: '1px solid var(--border)',
                      animation: 'pulse 2s ease-in-out infinite'
                    }}>
                      <div style={{
                        position: 'relative',
                        width: '60px',
                        height: '60px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        {/* Spinning ring */}
                        <div style={{
                          position: 'absolute',
                          width: '60px',
                          height: '60px',
                          borderRadius: '50%',
                          border: '3px solid var(--border)',
                          borderTopColor: 'var(--yellow)',
                          animation: 'spin 1s linear infinite'
                        }} />
                        {/* Food emoji in center */}
                        <span style={{ fontSize: '24px', animation: 'bounce 1s ease-in-out infinite' }}>
                          🍽️
                        </span>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '14px' }}>
                          {userSettings.language === 'ru' ? 'Анализируем фото...' : 'Analyzing photo...'}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>
                          {userSettings.language === 'ru' ? 'AI распознаёт еду и считает КБЖУ' : 'AI recognizing food & calculating macros'}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (foodImageInputRef.current) {
                            foodImageInputRef.current.dataset.scanType = 'food_photo';
                            foodImageInputRef.current.click();
                          }
                        }}
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          padding: '14px',
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          borderRadius: '12px',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        <Camera size={18} style={{ color: 'var(--yellow)' }} />
                        {userSettings.language === 'ru' ? 'Фото еды' : 'Food photo'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (foodImageInputRef.current) {
                            foodImageInputRef.current.dataset.scanType = 'nutrition_label';
                            foodImageInputRef.current.click();
                          }
                        }}
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          padding: '14px',
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          borderRadius: '12px',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        <ScanLine size={18} style={{ color: 'var(--blue)' }} />
                        {userSettings.language === 'ru' ? 'Этикетка' : 'Label'}
                      </button>
                    </div>
                  )}

                  {foodAnalysisError && (
                    <div style={{
                      marginTop: '8px',
                      padding: '10px 12px',
                      background: 'var(--red-dim)',
                      border: '1px solid rgba(255, 107, 107, 0.3)',
                      borderRadius: '8px',
                      color: 'var(--red)',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <X size={14} />
                      {foodAnalysisError}
                    </div>
                  )}

                  {/* Tip about accuracy */}
                  <div style={{
                    marginTop: '10px',
                    padding: '10px 12px',
                    background: 'rgba(255, 204, 0, 0.08)',
                    border: '1px solid rgba(255, 204, 0, 0.15)',
                    borderRadius: '8px',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    lineHeight: 1.4
                  }}>
                    {userSettings.language === 'ru'
                      ? '💡 Порция оценивается визуально. Для точности рекомендуем фотографировать еду на весах и каждый ингредиент отдельно.'
                      : '💡 Portion is estimated visually. For accuracy, we recommend photographing food on a scale and each ingredient separately.'}
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  margin: '16px 0'
                }}>
                  <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>
                    {userSettings.language === 'ru' ? 'или введите вручную' : 'or enter manually'}
                  </span>
                  <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ width: '110px', flexShrink: 0 }}>
                    <label style={{
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      marginBottom: '8px',
                      display: 'block',
                      fontWeight: 500
                    }}>
                      {t('time')}
                    </label>
                    <input
                      type="time"
                      value={mealForm.time}
                      onChange={e => setMealForm({ ...mealForm, time: e.target.value })}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                    <label style={{
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      marginBottom: '8px',
                      display: 'block',
                      fontWeight: 500
                    }}>
                      {t('mealName')}
                    </label>
                    <input
                      type="text"
                      placeholder={t('mealPlaceholder') as string}
                      value={mealForm.name}
                      onChange={e => {
                        setMealForm({ ...mealForm, name: e.target.value });
                        setShowMealSuggestions(true);
                      }}
                      onFocus={() => setShowMealSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowMealSuggestions(false), 200)}
                      style={{ width: '100%' }}
                    />
                    {/* Meal suggestions dropdown */}
                    {showMealSuggestions && mealSuggestions.length > 0 && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: '10px',
                        marginTop: '4px',
                        overflow: 'hidden',
                        zIndex: 100,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
                      }}>
                        {mealSuggestions.map((meal, idx) => (
                          <button
                            key={meal.id}
                            type="button"
                            onClick={() => {
                              setMealForm({
                                ...mealForm,
                                name: meal.name,
                                protein: meal.protein.toString(),
                                fat: meal.fat.toString(),
                                carbs: meal.carbs.toString(),
                                calories: meal.calories.toString()
                              });
                              setShowMealSuggestions(false);
                            }}
                            style={{
                              width: '100%',
                              padding: '12px 14px',
                              background: 'transparent',
                              border: 'none',
                              borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                              color: 'var(--text-primary)',
                              fontSize: '14px',
                              textAlign: 'left',
                              cursor: 'pointer',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}
                          >
                            <span>{meal.name}</span>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {meal.protein}{t('protein')} {meal.fat}{t('fat')} {meal.carbs}{t('carbs')}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                <div>
                  <label style={{
                    fontSize: '11px',
                    color: 'var(--blue)',
                    marginBottom: '8px',
                    display: 'block',
                    fontWeight: 600
                  }}>
                    {t('protein')}
                  </label>
                  <input
                    type="number"
                    placeholder="0"
                    value={mealForm.protein}
                    onChange={e => setMealForm({ ...mealForm, protein: e.target.value })}
                    style={{ width: '100%', textAlign: 'center' }}
                  />
                </div>
                <div>
                  <label style={{
                    fontSize: '11px',
                    color: 'var(--yellow)',
                    marginBottom: '8px',
                    display: 'block',
                    fontWeight: 600
                  }}>
                    {t('fat')}
                  </label>
                  <input
                    type="number"
                    placeholder="0"
                    value={mealForm.fat}
                    onChange={e => setMealForm({ ...mealForm, fat: e.target.value })}
                    style={{ width: '100%', textAlign: 'center' }}
                  />
                </div>
                <div>
                  <label style={{
                    fontSize: '11px',
                    color: 'var(--green)',
                    marginBottom: '8px',
                    display: 'block',
                    fontWeight: 600
                  }}>
                    {t('carbs')}
                  </label>
                  <input
                    type="number"
                    placeholder="0"
                    value={mealForm.carbs}
                    onChange={e => setMealForm({ ...mealForm, carbs: e.target.value })}
                    style={{ width: '100%', textAlign: 'center' }}
                  />
                </div>
                <div>
                  <label style={{
                    fontSize: '11px',
                    color: 'var(--red)',
                    marginBottom: '8px',
                    display: 'block',
                    fontWeight: 600
                  }}>
                    {t('kcal')}
                  </label>
                  <input
                    type="number"
                    placeholder="0"
                    value={mealForm.calories}
                    onChange={e => setMealForm({ ...mealForm, calories: e.target.value })}
                    style={{ width: '100%', textAlign: 'center' }}
                  />
                </div>
                <div>
                  <label style={{
                    fontSize: '11px',
                    color: 'var(--purple)',
                    marginBottom: '8px',
                    display: 'block',
                    fontWeight: 600
                  }}>
                    {userSettings.language === 'ru' ? 'Сахар' : 'Sugar'}
                  </label>
                  <input
                    type="number"
                    placeholder="0"
                    value={mealForm.sugar}
                    onChange={e => setMealForm({ ...mealForm, sugar: e.target.value })}
                    style={{ width: '100%', textAlign: 'center' }}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button
                onClick={() => setShowMealModal(false)}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  color: 'var(--text-primary)',
                  fontSize: '15px',
                  fontWeight: 500
                }}
              >
                {t('cancel')}
              </button>
              <button
                onClick={addMeal}
                disabled={!mealForm.name}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: 'var(--yellow)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '15px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 20px var(--yellow-glow)'
                }}
              >
                <Save size={18} />
                {editingMeal ? t('save') : t('add')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Food Assistant Modal */}
      {showFoodAssistant && (
        <div className="modal-overlay" onClick={() => setShowFoodAssistant(false)}>
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '420px', maxHeight: '85vh' }}
          >
            <div style={{
              padding: '20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, var(--purple) 0%, var(--blue) 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Sparkles size={18} style={{ color: '#fff' }} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                    {userSettings.language === 'ru' ? 'AI Ассистент' : 'AI Assistant'}
                  </h3>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {userSettings.language === 'ru' ? 'Рекомендации по питанию' : 'Food recommendations'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowFoodAssistant(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '8px'
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '20px', overflowY: 'auto', maxHeight: 'calc(85vh - 80px)' }}>
              {isLoadingRecommendations ? (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <div style={{
                    width: '60px',
                    height: '60px',
                    margin: '0 auto 16px',
                    borderRadius: '50%',
                    border: '3px solid var(--border)',
                    borderTopColor: 'var(--purple)',
                    animation: 'spin 1s linear infinite'
                  }} />
                  <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
                    {userSettings.language === 'ru' ? 'Анализирую ваш рацион...' : 'Analyzing your diet...'}
                  </div>
                </div>
              ) : foodRecommendations ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Warning */}
                  {foodRecommendations.warning && (
                    <div style={{
                      background: 'var(--red-dim)',
                      padding: '14px',
                      borderRadius: '12px',
                      border: '1px solid var(--red)',
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'flex-start'
                    }}>
                      <span style={{ fontSize: '16px' }}>⚠️</span>
                      <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                        {foodRecommendations.warning}
                      </div>
                    </div>
                  )}

                  {/* Analysis */}
                  <div style={{
                    background: 'var(--bg-elevated)',
                    padding: '14px',
                    borderRadius: '12px',
                    border: '1px solid var(--border)'
                  }}>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {foodRecommendations.analysis}
                    </div>
                  </div>

                  {/* Suggestions */}
                  <div>
                    <h4 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600 }}>
                      {userSettings.language === 'ru' ? 'Рекомендации' : 'Suggestions'}
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {foodRecommendations.suggestions?.map((suggestion: { name: string; description: string; protein: number; fat: number; carbs: number; calories: number; isFavorite?: boolean; reason?: string }, idx: number) => (
                        <div
                          key={idx}
                          className="card-hover"
                          style={{
                            background: 'var(--bg-card)',
                            padding: '14px',
                            borderRadius: '12px',
                            border: suggestion.isFavorite ? '1px solid var(--red)' : '1px solid var(--border)',
                            cursor: 'pointer'
                          }}
                          onClick={() => {
                            // Add this suggestion as a meal
                            const now = new Date();
                            const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                            const newMeal: Meal = {
                              id: Date.now().toString(),
                              time,
                              name: suggestion.name,
                              protein: suggestion.protein,
                              fat: suggestion.fat,
                              carbs: suggestion.carbs,
                              calories: suggestion.calories,
                              isFavorite: suggestion.isFavorite || false
                            };
                            setDayLogs(prev => {
                              const existingLog = prev[dateKey] || currentDayLog;
                              const newMeals = [...existingLog.meals, newMeal];
                              upsertDayLog({ date: dateKey, kind: 'meals', payload: newMeals }).catch(() => {});
                              return {
                                ...prev,
                                [dateKey]: { ...existingLog, meals: newMeals }
                              };
                            });
                            setShowFoodAssistant(false);
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                            <div style={{ fontWeight: 600, fontSize: '14px' }}>
                              {suggestion.isFavorite && <span style={{ marginRight: '6px' }}>❤️</span>}
                              {suggestion.name}
                            </div>
                            <Plus size={18} style={{ color: 'var(--green)', flexShrink: 0 }} />
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                            {suggestion.description}
                          </div>
                          {suggestion.reason && (
                            <div style={{ fontSize: '11px', color: 'var(--purple)', marginBottom: '8px', fontStyle: 'italic' }}>
                              {suggestion.reason}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: '12px', fontSize: '12px' }}>
                            <span style={{ color: 'var(--blue)' }}>Б: {suggestion.protein}г</span>
                            <span style={{ color: 'var(--yellow)' }}>Ж: {suggestion.fat}г</span>
                            <span style={{ color: 'var(--green)' }}>У: {suggestion.carbs}г</span>
                            <span style={{ color: 'var(--red)' }}>{suggestion.calories} ккал</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Tip */}
                  {foodRecommendations.tip && (
                    <div style={{
                      background: 'var(--yellow-dim)',
                      padding: '14px',
                      borderRadius: '12px',
                      border: '1px solid var(--yellow)',
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'flex-start'
                    }}>
                      <span style={{ fontSize: '16px' }}>💡</span>
                      <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                        {foodRecommendations.tip}
                      </div>
                    </div>
                  )}

                  {/* Hint */}
                  <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                    {userSettings.language === 'ru' ? 'Нажмите на блюдо чтобы добавить' : 'Tap a meal to add it'}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                  {userSettings.language === 'ru' ? 'Не удалось получить рекомендации' : 'Failed to get recommendations'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Workout Editor Modal */}
      {showWorkoutEditor && editingWorkoutId && (
        <div className="modal-overlay" onClick={() => setShowWorkoutEditor(false)}>
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '550px', maxHeight: '85vh' }}
          >
            <div style={{
              padding: '20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'var(--green-dim)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Settings size={18} style={{ color: 'var(--green)' }} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                    {workouts.find(w => w.id === editingWorkoutId)?.name || 'Тренировка'}
                  </h3>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Редактирование упражнений
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowWorkoutEditor(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '8px'
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '16px', overflowY: 'auto', maxHeight: 'calc(85vh - 180px)' }}>
              {/* Add/Edit Exercise Form */}
              <div style={{
                background: 'var(--bg-elevated)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '16px',
                border: '1px solid var(--border)'
              }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', fontWeight: 600 }}>
                  {editingExerciseId ? 'Редактировать упражнение' : 'Добавить упражнение'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <input
                    type="text"
                    placeholder="Название упражнения"
                    value={exerciseForm.name}
                    onChange={e => setExerciseForm({ ...exerciseForm, name: e.target.value })}
                    style={{ width: '100%' }}
                  />
                  <input
                    type="text"
                    placeholder="Подходы (3x12)"
                    value={exerciseForm.plannedSets}
                    onChange={e => setExerciseForm({ ...exerciseForm, plannedSets: e.target.value })}
                    style={{ width: '100%' }}
                  />
                  <input
                    type="text"
                    placeholder="Отдых (2-3 мин)"
                    value={exerciseForm.restTime}
                    onChange={e => setExerciseForm({ ...exerciseForm, restTime: e.target.value })}
                    style={{ width: '100%' }}
                  />
                  <input
                    type="text"
                    placeholder="Заметки (опционально)"
                    value={exerciseForm.notes}
                    onChange={e => setExerciseForm({ ...exerciseForm, notes: e.target.value })}
                  />
                  <div style={{ display: 'flex', gap: '10px' }}>
                    {editingExerciseId && (
                      <button
                        onClick={() => {
                          setEditingExerciseId(null);
                          setExerciseForm({ name: '', plannedSets: '', restTime: '2-3 мин', notes: '' });
                        }}
                        style={{
                          flex: 1,
                          padding: '12px',
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border)',
                          borderRadius: '10px',
                          color: 'var(--text-muted)',
                          fontSize: '14px',
                          fontWeight: 500,
                          cursor: 'pointer'
                        }}
                      >
                        Отмена
                      </button>
                    )}
                    <button
                      onClick={editingExerciseId ? updateExerciseInWorkout : addExerciseToWorkout}
                      disabled={!exerciseForm.name}
                      style={{
                        flex: 1,
                        padding: '12px',
                        background: exerciseForm.name ? 'var(--green)' : 'var(--bg-card)',
                        border: 'none',
                        borderRadius: '10px',
                        color: exerciseForm.name ? '#000' : 'var(--text-muted)',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: exerciseForm.name ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px'
                      }}
                    >
                      {editingExerciseId ? <Save size={16} /> : <Plus size={16} />}
                      {editingExerciseId ? 'Сохранить' : 'Добавить'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Exercise List */}
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px', fontWeight: 600 }}>
                Упражнения ({workouts.find(w => w.id === editingWorkoutId)?.exercises.length || 0})
              </div>
              {workouts.find(w => w.id === editingWorkoutId)?.exercises.map((ex, idx) => (
                <div
                  key={ex.id}
                  style={{
                    background: editingExerciseId === ex.id ? 'var(--green-dim)' : 'var(--bg-card)',
                    borderRadius: '12px',
                    padding: '14px',
                    marginBottom: '8px',
                    border: `1px solid ${editingExerciseId === ex.id ? 'var(--green)' : 'var(--border)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px'
                  }}>
                    <button
                      onClick={() => moveExercise(ex.id, 'up')}
                      disabled={idx === 0}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: idx === 0 ? 'var(--border)' : 'var(--text-muted)',
                        cursor: idx === 0 ? 'not-allowed' : 'pointer',
                        padding: '2px'
                      }}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      onClick={() => moveExercise(ex.id, 'down')}
                      disabled={idx === (workouts.find(w => w.id === editingWorkoutId)?.exercises.length || 0) - 1}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: idx === (workouts.find(w => w.id === editingWorkoutId)?.exercises.length || 0) - 1 ? 'var(--border)' : 'var(--text-muted)',
                        cursor: idx === (workouts.find(w => w.id === editingWorkoutId)?.exercises.length || 0) - 1 ? 'not-allowed' : 'pointer',
                        padding: '2px'
                      }}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: 600,
                      fontSize: '14px',
                      marginBottom: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{idx + 1}.</span>
                      {ex.name}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--blue)' }}>
                      {ex.plannedSets} • {ex.restTime}
                    </div>
                    {ex.notes && (
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {ex.notes}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => startEditExercise(ex)}
                      style={{
                        padding: '8px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        color: 'var(--text-muted)',
                        cursor: 'pointer'
                      }}
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => deleteExerciseFromWorkout(ex.id)}
                      style={{
                        padding: '8px',
                        background: 'var(--red-dim)',
                        border: '1px solid rgba(255, 107, 107, 0.3)',
                        borderRadius: '8px',
                        color: 'var(--red)',
                        cursor: 'pointer'
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}

              {(workouts.find(w => w.id === editingWorkoutId)?.exercises.length || 0) === 0 && (
                <div style={{
                  textAlign: 'center',
                  padding: '30px',
                  color: 'var(--text-muted)',
                  fontSize: '14px'
                }}>
                  Нет упражнений. Добавьте первое!
                </div>
              )}
            </div>

            <div style={{
              padding: '16px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              <button
                onClick={() => setShowWorkoutEditor(false)}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: 'var(--yellow)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '15px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 20px var(--yellow-glow)',
                  cursor: 'pointer'
                }}
              >
                <Check size={18} />
                Готово
              </button>
              {workouts.length > 1 && (
                <button
                  onClick={() => {
                    if (confirm(`Удалить "${workouts.find(w => w.id === editingWorkoutId)?.name}"?`)) {
                      deleteWorkout(editingWorkoutId);
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'transparent',
                    border: '1px solid var(--red)',
                    borderRadius: '12px',
                    color: 'var(--red)',
                    fontWeight: 600,
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer'
                  }}
                >
                  <Trash2 size={16} />
                  Удалить тренировку
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Футер со статусом синка скрыт по просьбе — offline/pending не показываем.
          Синхронизация работает в фоне, статус пользователю не нужен. */}

      {/* Exercise image modal — rendered at root level to avoid re-render issues */}
      {imageModal && (
        <ImageViewer
          url={imageModal.url}
          name={imageModal.name}
          onClose={() => { setImageModal(null); document.body.style.overflow = ''; }}
          onReplace={() => { imageReplaceRef.current?.click(); }}
          onDelete={() => {
            const target = imageModal;
            setImageModal(null);
            document.body.style.overflow = '';
            // Снимаем картинку и с упражнения, и из библиотеки: иначе
            // она подставится обратно при следующей загрузке.
            const key = target.name.toLowerCase().trim();
            setWorkouts(prev => prev.map(w => ({
              ...w,
              exercises: w.exercises.map(e =>
                e.name.toLowerCase().trim() === key ? { ...e, imageUrl: undefined } : e),
            })));
            userMadeChangeRef.current = true;
            setExerciseLibrary(prev => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
            void fetch(`/api/fitness/exercise-library?name=${encodeURIComponent(key)}`, { method: 'DELETE' })
              .then(() => { try { localStorage.removeItem('fitness_exlib_etag'); } catch { /* quota */ } })
              .catch(() => { /* офлайн — уйдёт при следующем изменении */ });
          }}
        />
      )}
      {/* Выбор нового фото из просмотрщика. Живёт здесь, а не в модалке:
          input не должен исчезать, пока браузер открывает галерею. */}
      <input
        ref={imageReplaceRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          const target = imageModal;
          e.target.value = '';
          if (!file || !target) return;
          const canvas = document.createElement('canvas');
          const img = new Image();
          img.onload = () => {
            const maxSize = 1200;
            let w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
              if (w > h) { h = (h / w) * maxSize; w = maxSize; }
              else { w = (w / h) * maxSize; h = maxSize; }
            }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            const key = target.name.toLowerCase().trim();
            setWorkouts(prev => prev.map(wk => ({
              ...wk,
              exercises: wk.exercises.map(ex =>
                ex.name.toLowerCase().trim() === key ? { ...ex, imageUrl: dataUrl } : ex),
            })));
            userMadeChangeRef.current = true;
            setExerciseLibrary(prev => ({ ...prev, [key]: dataUrl }));
            void saveExerciseImage(key, dataUrl);
            setImageModal({ url: dataUrl, name: target.name });
          };
          img.src = URL.createObjectURL(file);
        }}
      />

      {/* Нижняя навигация: основное меню-капсула + отдельная капсула AI-чата справа */}
      {/* Нижнее меню по макету: четыре равные вкладки в одной панели.
          ИИ раньше жила ОТДЕЛЬНОЙ кнопкой вне flex-контейнера и забирала
          всю свободную ширину — 205px против 50px у соседей.
          Видно на всех вкладках, включая ИИ (по макету редизайна). */}
      <nav className="tx-tabbar">
        {/* Капсула: скруглённая панель с тенью, как было раньше. */}
        <div className="tx-tabcap">
        {([
          { key: 'workout' as typeof view,   icon: <Home size={21} />,          label: userSettings.language === 'ru' ? 'Главная' : 'Home' },
          { key: 'planner' as typeof view,   icon: <CalendarDays size={21} />,  label: userSettings.language === 'ru' ? 'Планер' : 'Plan' },
          { key: 'chat' as typeof view,      icon: <Brain size={21} />,         label: userSettings.language === 'ru' ? 'ИИ' : 'AI' },
          { key: 'labs' as typeof view,      icon: <FlaskConical size={21} />,  label: userSettings.language === 'ru' ? 'Анализы' : 'Labs' },
        ] as { key: typeof view; icon: React.ReactNode; label: string }[]).map((tab) => {
          // «Главная» — это и тренировки, и питание: разделы переключаются
          // своим верхним переключателем, а вкладка меню должна оставаться
          // подсвеченной. Иначе при переходе подсветка гасла и меню «прыгало».
          const isActive = tab.key === 'workout'
            ? (view === 'workout' || view === 'nutrition')
            : view === tab.key;
          return (
            <button
              key={tab.key}
              className={['btn-press', 'tx-tab', isActive ? 'is-active' : ''].filter(Boolean).join(' ')}
              onClick={() => { setView(tab.key); localStorage.setItem('fitness_view', tab.key); setShowProfileDropdown(false); }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
        </div>
      </nav>
    </main>
  );
}

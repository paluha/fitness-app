'use client';

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { signOut } from 'next-auth/react';
import {
  Plus, X, Dumbbell, Apple, ChevronLeft, ChevronRight, Check,
  Target, TrendingUp, Edit2, Trash2, Save, ChevronDown,
  ChevronUp, Calendar, Cloud, CloudOff, Footprints, History,
  Zap, Timer, Play, Pause, RotateCcw, Settings, User, LogOut,
  Heart, BarChart3, Scale, Ruler, Globe, Languages, Pencil,
  Camera, ScanLine, Video, ExternalLink, Sparkles, CalendarDays,
  Home, Trophy, Sun, Moon, MonitorSmartphone, FlaskConical, Hourglass, Brain, Loader2
} from 'lucide-react';
import PlannerView, { PlannerEvent, Habit } from './PlannerView';
import { AssistantChat } from '@/components/AssistantChat';
import { LabsView } from '@/components/LabsView';
import { WeightChart } from '@/components/WeightChart';
import { upsertWorkoutLog, upsertDayLog, flushNow, startSyncLoop, getPendingOpsCount } from '@/lib/sync';

// Parse rest time string like "2-3 мин" or "3 мин" to seconds
function parseRestTime(restTime: string): number {
  const match = restTime.match(/(\d+)(?:-(\d+))?\s*мин/);
  if (match) {
    const min = parseInt(match[1]);
    const max = match[2] ? parseInt(match[2]) : min;
    // Use the middle value for range, or exact value
    return Math.round((min + max) / 2) * 60;
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
function RestTimer({ restTime }: { restTime: string }) {
  const totalSeconds = parseRestTime(restTime);
  const [timeLeft, setTimeLeft] = useState(totalSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

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

  useEffect(() => {
    if (isRunning && timeLeft > 0) {
      intervalRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            setIsRunning(false);
            setIsFinished(true);
            playBeep();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning, timeLeft, playBeep]);

  const toggleTimer = () => {
    if (isFinished) {
      // Reset
      setTimeLeft(totalSeconds);
      setIsFinished(false);
      setIsRunning(true);
    } else {
      setIsRunning(!isRunning);
    }
  };

  const resetTimer = () => {
    setTimeLeft(totalSeconds);
    setIsRunning(false);
    setIsFinished(false);
  };

  const progress = ((totalSeconds - timeLeft) / totalSeconds) * 100;

  return (
    <div style={{ marginTop: '8px' }}>
      {/* Крупный тайминг, пока отдых идёт */}
      {isRunning && (
        <div style={{
          textAlign: 'center',
          fontSize: '42px',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
          marginBottom: '6px',
          color: timeLeft <= 5 ? 'var(--blue)' : 'var(--text-primary)'
        }}>
          {formatTime(timeLeft)}
        </div>
      )}
      <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }}>
      <button
        onClick={toggleTimer}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          padding: '10px 14px',
          background: isFinished
            ? 'var(--blue)'
            : isRunning
              ? 'var(--red-dim)'
              : 'var(--blue-dim)',
          border: `1px solid ${isFinished ? 'var(--blue)' : isRunning ? 'rgba(255, 107, 107, 0.3)' : 'rgba(37, 99, 235, 0.3)'}`,
          borderRadius: '10px',
          color: isFinished ? '#fff' : isRunning ? 'var(--red)' : 'var(--blue)',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 700,
          minWidth: '100px',
          boxShadow: isFinished ? '0 4px 20px var(--blue-dim)' : 'none',
          animation: isFinished ? 'pulse 1s infinite' : 'none'
        }}
      >
        {isFinished ? (
          <>
            <RotateCcw size={16} />
            СТАРТ!
          </>
        ) : isRunning ? (
          <>
            <Pause size={16} />
            {formatTime(timeLeft)}
          </>
        ) : (
          <>
            <Play size={16} />
            {timeLeft === totalSeconds ? restTime : formatTime(timeLeft)}
          </>
        )}
      </button>

      {(isRunning || timeLeft < totalSeconds) && !isFinished && (
        <button
          onClick={resetTimer}
          style={{
            padding: '10px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <RotateCcw size={16} />
        </button>
      )}

      {isRunning && (
        <div style={{
          flex: 1,
          height: '6px',
          background: 'var(--bg-elevated)',
          borderRadius: '3px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${progress}%`,
            height: '100%',
            background: timeLeft < 10 ? 'var(--red)' : 'var(--blue)',
            borderRadius: '3px',
            transition: 'width 1s linear'
          }} />
        </div>
      )}
      </div>
    </div>
  );
}

// Types
// One row in the new per-set table view. `completed` is per-set so the
// outer `completed` flag below can be derived (all sets done → exercise done).
export interface ExerciseSet {
  reps: number;
  weight: number;   // pounds
  completed: boolean;
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
// Показатель здоровья: давление и/или пульсоксиметр, с тегами контекста
interface VitalEntry {
  id: string;
  at: string; // ISO
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  spo2?: number;
  fatPct?: number;      // % жира (анализатор состава тела)
  symptom?: string;     // симптом (головная боль, жидкий стул…) — фиксируется тапом, время автоматом
  customName?: string;  // произвольный показатель/процедура
  customValue?: number;
  customUnit?: string;
  tags: string[];
  note?: string;
}

const SYMPTOM_PRESETS = ['Головная боль', 'Жидкий стул', 'Запор', 'Тошнота', 'Изжога', 'Боль в животе', 'Головокружение', 'Слабость', 'Плохой сон', 'Судороги'];

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

interface BodyMeasurement {
  id: string;
  date: string;
  weight?: number;
  waist?: number;
  chest?: number;
  biceps?: number;        // legacy - kept for backwards compatibility
  bicepsLeft?: number;
  bicepsRight?: number;
  thighs?: number;
  hips?: number;
  notes?: string;
}

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

const DEFAULT_NUTRITION_RECOMMENDATIONS: NutritionRecommendation[] = [
  { id: '1', emoji: '🌅', title: 'Утро', description: 'Белок + углеводы. Творог, яйца, каша или рисовые хлебцы', color: 'yellow' },
  { id: '2', emoji: '💪', title: 'До тренировки (1-2 часа)', description: 'Углеводы + немного белка. Рис, картофель, курица', color: 'green' },
  { id: '3', emoji: '🏋️', title: 'После тренировки (до 1 часа)', description: 'Быстрые углеводы + белок. Whey + банан или рисовые хлебцы', color: 'blue' },
  { id: '4', emoji: '🌙', title: 'Вечер / перед сном', description: 'Белок + жиры, минимум углеводов. Творог, казеин, рыба', color: 'red' }
];

const RECOMMENDATION_COLORS: Record<string, { bg: string; }> = {
  yellow: { bg: 'var(--yellow-dim)' },
  green: { bg: 'var(--green-dim)' },
  blue: { bg: 'var(--blue-dim)' },
  red: { bg: 'var(--red-dim)' },
  purple: { bg: 'var(--purple-dim)' }
};

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

// Beautiful Exercise Card Component
function ExerciseCard({ ex, idx, onToggle, onUpdate, progressHistory, weightHistory, lastSets, exerciseLibrary, onImageSaved, dayClosed, onShowImage, expanded: expandedProp, onToggleExpand, muscleLabel }: {
  ex: Exercise;
  idx: number;
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
  const prevCompletedRef = useRef(ex.completed);
  useEffect(() => {
    if (ex.completed && !prevCompletedRef.current) {
      if (controlled && expandedProp) onToggleExpand?.();
      else if (!controlled) setExpandedLocal(false);
    }
    prevCompletedRef.current = ex.completed;
  }, [ex.completed, controlled, expandedProp, onToggleExpand]);


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
      className={`card-hover exercise-card ${ex.completed ? 'completed' : ''}`}
      style={{
        background: 'var(--bg-card)',
        borderRadius: ex.completed ? '10px' : '14px',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        marginBottom: ex.completed ? '6px' : '10px'
      }}
    >
      {/* Main row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: ex.completed ? '8px 12px' : '12px 14px',
          gap: ex.completed ? '10px' : '12px',
          cursor: 'pointer',
          transition: 'padding 0.3s ease'
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 600,
            fontSize: ex.completed ? '13px' : '14px',
            color: ex.completed ? 'var(--text-muted)' : 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span style={{
              color: 'var(--text-muted)',
              fontSize: '12px'
            }}>
              {idx + 1}.
            </span>
            <span style={{
              overflow: expanded ? 'visible' : 'hidden',
              textOverflow: expanded ? 'initial' : 'ellipsis',
              whiteSpace: expanded ? 'normal' : 'nowrap',
              wordBreak: expanded ? 'break-word' : 'normal'
            }}>
              {ex.name}
            </span>
            {/* Show weight badge if completed with weight */}
            {ex.completed && ex.actualSets && (
              <span style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                background: 'var(--bg-elevated)',
                padding: '2px 6px',
                borderRadius: '4px',
                marginLeft: 'auto',
                flexShrink: 0
              }}>
                {ex.actualSets}
              </span>
            )}
          </div>
          {/* Под упражнением — группа мышц, определённая ИИ (ручные приписки
              из notes на главной больше не показываем) */}
          {!ex.completed && muscleLabel && (
            <div style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              marginTop: '2px'
            }}>
              {muscleLabel}
            </div>
          )}
        </div>

        {/* Галочка выполнения — справа */}
        <div
          className="checkbox-animated status-transition"
          onClick={(e) => {
            e.stopPropagation();
            // Toggle mark/unmark
            onToggle();
          }}
          style={{
            width: ex.completed ? '24px' : '32px',
            height: ex.completed ? '24px' : '32px',
            borderRadius: ex.completed ? '6px' : '8px',
            border: ex.completed ? '1px solid var(--green)' : '2px solid var(--border-strong)',
            background: ex.completed
              ? 'var(--green-dim)'
              : 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--green)',
            flexShrink: 0,
            transition: 'all 0.2s ease'
          }}
        >
          {ex.completed && <Check size={14} strokeWidth={3} />}
        </div>

      </div>

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
            const updateSet = (i: number, patch: Partial<ExerciseSet>) => {
              const next = sets.map((s, j) => j === i ? { ...s, ...patch } : s);
              const allDone = next.length > 0 && next.every(s => s.completed);
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
            const cols = '24px 56px 1fr 1fr 36px';
            const allSetsDone = sets.length > 0 && sets.every(s => s.completed);
            const markAllSets = () => {
              const next = sets.map(s => ({ ...s, completed: !allSetsDone }));
              const allDone = next.length > 0 && next.every(s => s.completed);
              onUpdate({ sets: next, completed: allDone });
            };
            return (
              <div style={{ marginTop: '8px', marginBottom: '10px' }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: cols,
                  gap: '6px',
                  fontSize: '9px',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.4px',
                  marginBottom: '4px',
                  paddingLeft: '2px',
                }}>
                  <span>Set</span>
                  <span>Last</span>
                  <span style={{ textAlign: 'center' }}>Reps</span>
                  <span style={{ textAlign: 'center' }}>lbs</span>
                  <span />
                </div>
                {sets.map((s, i) => {
                  const last = lastSets?.[i];
                  return (
                  <div key={i} style={{
                    display: 'grid',
                    gridTemplateColumns: cols,
                    gap: '6px',
                    alignItems: 'center',
                    marginBottom: '4px',
                  }}>
                    <span style={{
                      fontSize: '12px', fontWeight: 700,
                      color: s.completed ? 'var(--green)' : 'var(--text-secondary)',
                      paddingLeft: '2px',
                    }}>{i + 1}</span>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                    }}>
                      {last && (last.reps > 0 || last.weight > 0) ? `${last.reps}×${last.weight}` : '—'}
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={s.reps || ''}
                      onChange={(e) => updateSet(i, { reps: parseInt(e.target.value, 10) || 0 })}
                      placeholder="0"
                      style={{
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        padding: '5px 8px',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        fontWeight: 600,
                        textAlign: 'center',
                        width: '100%',
                        minWidth: 0,
                      }}
                    />
                    <input
                      type="number"
                      inputMode="numeric"
                      value={s.weight || ''}
                      onChange={(e) => updateSet(i, { weight: parseInt(e.target.value, 10) || 0 })}
                      placeholder="0"
                      style={{
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        padding: '5px 8px',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        fontWeight: 600,
                        textAlign: 'center',
                        width: '100%',
                        minWidth: 0,
                      }}
                    />
                    <button
                      onClick={() => updateSet(i, { completed: !s.completed })}
                      onContextMenu={(e) => { e.preventDefault(); removeSet(i); }}
                      title="Right-click / long-press to remove this set"
                      style={{
                        width: '30px', height: '30px',
                        border: s.completed ? 'none' : '1.5px solid var(--border-strong)',
                        background: s.completed ? 'var(--green)' : 'transparent',
                        borderRadius: '8px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', justifySelf: 'center',
                        padding: 0,
                        transition: 'background 160ms ease, border 160ms ease',
                      }}>
                      {s.completed && <Check size={16} style={{ color: '#fff' }} strokeWidth={3} />}
                    </button>
                  </div>
                  );
                })}
                {/* Add set + Отметить все — в одну строку */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    onClick={addSet}
                    style={{
                      flex: 1,
                      minHeight: '44px',
                      padding: '10px',
                      background: 'var(--bg-primary)',
                      border: '1px dashed var(--border-strong)',
                      borderRadius: '12px',
                      color: 'var(--text-muted)',
                      fontSize: '12px', fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                      touchAction: 'manipulation',
                    }}>
                    <Plus size={14} />
                    Add set
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); markAllSets(); }}
                    style={{
                      flex: 1.4,
                      minHeight: '44px',
                      padding: '10px',
                      background: allSetsDone ? 'var(--green-dim)' : 'var(--bg-elevated)',
                      border: `1.5px solid ${allSetsDone ? 'var(--green)' : 'var(--border-strong)'}`,
                      borderRadius: '12px',
                      color: allSetsDone ? 'var(--green)' : 'var(--text-primary)',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      touchAction: 'manipulation',
                    }}>
                    <Check size={16} strokeWidth={3} />
                    {allSetsDone ? 'Снять отметки' : 'Отметить все'}
                  </button>
                </div>
              </div>
            );
          })()}
          {/* Таймер отдыха + фото — в одну строку */}
          <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '4px'
              }}>
                <Timer size={11} />
                Отдых: {ex.restTime}
              </label>
              <RestTimer restTime={ex.restTime} />
            </div>
            <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
            {ex.imageUrl ? (
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  onClick={() => onShowImage?.(ex.imageUrl!, ex.name)}
                  style={{
                    padding: 0, border: '1px solid var(--border)', borderRadius: '12px',
                    overflow: 'hidden', cursor: 'pointer', background: 'var(--bg-primary)',
                    width: '56px', height: '56px', display: 'block'
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ex.imageUrl}
                    alt={ex.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </button>
                <button
                  onClick={() => onUpdate({ imageUrl: undefined })}
                  aria-label='Убрать фото'
                  style={{
                    position: 'absolute', top: '-6px', right: '-6px',
                    width: '18px', height: '18px', borderRadius: '50%',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', padding: 0, cursor: 'pointer'
                  }}
                >
                  <X size={10} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => imageInputRef.current?.click()}
                aria-label='Добавить фото'
                style={{
                  width: '56px', height: '56px', borderRadius: '12px',
                  background: 'var(--bg-primary)', border: '1px dashed var(--border-strong)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', flexShrink: 0
                }}
              >
                <Camera size={18} style={{ color: 'var(--text-muted)' }} />
              </button>
            )}
          </div>

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

          {/* Заметка к упражнению — самая последняя строка */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '12px', alignItems: 'center' }}>
            <input
              type="text"
              value={ex.feedback}
              onChange={(e) => onUpdate({ feedback: e.target.value })}
              placeholder="Заметки..."
              style={{
                flex: 1,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '8px 10px',
                color: 'var(--text-primary)',
                fontSize: '12px'
              }}
            />
            <button
              onClick={() => setShowChart(!showChart)}
              title='Динамика веса'
              disabled={!weightHistory || weightHistory.length === 0}
              style={{
                width: '36px', height: '36px', borderRadius: '8px',
                background: showChart ? 'var(--yellow)' : 'var(--yellow-dim)',
                border: '1px solid var(--yellow-glow)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                cursor: 'pointer',
                opacity: (!weightHistory || weightHistory.length === 0) ? 0.35 : 1
              }}
            >
              <TrendingUp size={15} style={{ color: showChart ? '#fff' : 'var(--yellow)' }} />
            </button>
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

          <h3 style={{
            margin: 0,
            fontWeight: 700,
            fontSize: '18px',
            textTransform: 'capitalize'
          }}>
            {currentMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
          </h3>

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

        {/* Month stats — компактные нейтральные бейджи */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px'
        }}>
          {[
            { value: String(monthStats.workoutDays), label: 'тренировок' },
            { value: `${Math.round(monthStats.totalSteps / 1000)}K`, label: 'шагов' },
            { value: String(monthStats.stepDays > 0 ? Math.round(monthStats.totalSteps / monthStats.stepDays) : 0), label: 'ср. шагов' },
          ].map((s, i) => (
            <div key={i} style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              padding: '5px 4px',
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {s.value}
              </div>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '0px' }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Weekday headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        padding: '12px 16px 8px',
        borderBottom: '1px solid var(--border)'
      }}>
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day, i) => (
          <div
            key={day}
            style={{
              textAlign: 'center',
              fontSize: '12px',
              color: i >= 5 ? 'var(--red)' : 'var(--text-muted)',
              fontWeight: 600
            }}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '4px',
        padding: '12px 16px 16px'
      }}>
        {monthDays.map((d, i) => {
          if (!d) return <div key={`empty-${i}`} />;

          const log = dayLogs[d.dateStr];
          const isToday = d.dateStr === today;
          const isSelected = d.dateStr === selectedDateStr;
          const isFuture = d.dateStr > today;
          const isOffDay = log?.isOffDay;

          // Считаем выполненность тренировки за день по фактическим упражнениям.
          // Берём snapshot (если есть) либо живой draft — это работает без
          // «закрытия дня». pct = доля выполненных упражнений (0..1).
          const dayExercises = log?.workoutSnapshot?.exercises ?? log?.workoutDraft?.exercises ?? [];
          const exTotal = dayExercises.length;
          const exDone = dayExercises.filter(e => e.completed).length;
          const hasWorkout = exDone > 0;                        // были выполненные упражнения
          const fullyDone = exTotal > 0 && exDone === exTotal;  // все выполнены
          const workoutPct = exTotal > 0 ? exDone / exTotal : 0; // доля для частичной заливки
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

          // Определяем стиль фона
          const getBackground = () => {
            if (isSelected) return 'var(--yellow)';
            if (isToday) return 'linear-gradient(135deg, rgba(187, 242, 107, 0.25) 0%, rgba(34, 197, 94, 0.18) 100%)';
            if (hasWorkout) {
              // Все упражнения выполнены — полная зелёная заливка.
              if (fullyDone) return 'var(--green-dim)';
              // Были пропуски — заливаем фон зелёным снизу на % выполнения.
              const p = Math.round(workoutPct * 100);
              return `linear-gradient(to top, var(--green-dim) ${Math.max(0, p - 10)}%, transparent ${Math.min(100, p + 10)}%)`;
            }
            if (hasSteps) return 'var(--blue-dim)';
            if (isRestDay) return 'transparent'; // день без тренировки — незаметный
            if (isFuture) return 'transparent';
            return 'transparent';
          };

          // Определяем цвет текста
          const getColor = () => {
            if (isSelected) return '#fff';
            if (isToday) return '#22c55e';
            if (hasWorkout) return 'var(--green)';
            if (isRestDay) return 'rgba(139, 145, 160, 0.45)'; // бледный, почти невидимый
            if (isFuture) return 'var(--text-muted)';
            return 'var(--text-primary)';
          };

          // Parse date correctly to avoid timezone issues
          const [year, month, dayNum] = d.dateStr.split('-').map(Number);
          const clickDate = new Date(year, month - 1, dayNum);

          // Определяем border
          const getBorder = () => {
            if (isSelected) return 'none';
            if (isToday) return '2px solid var(--cyan, #0ea5e9)';
            if (hasWorkout) return '1px solid transparent'; // зелёные дни — без бордера
            if (isRestDay) return '1px solid transparent';
            return '1px solid transparent';
          };

          // Определяем boxShadow
          const getBoxShadow = () => {
            if (isSelected) return '0 6px 18px var(--yellow-glow)';
            if (isToday) return '0 2px 12px rgba(14, 165, 233, 0.3)';
            // зелёное свечение убрано — дни выглядели как «облачка»
            return 'none';
          };

          return (
            <button
              key={d.day}
              onClick={() => onSelectDate(clickDate)}
              style={{
                aspectRatio: '1',
                position: 'relative',
                background: getBackground(),
                border: getBorder(),
                borderRadius: '10px',
                cursor: isFuture ? 'default' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                color: getColor(),
                fontWeight: isRestDay ? 400 : (isToday || isSelected || hasWorkout ? 700 : 500),
                fontSize: '14px',
                transition: 'all 0.2s ease',
                boxShadow: getBoxShadow(),
                opacity: isFuture ? 0.4 : 1
              }}
            >
              {/* День с тренировкой: кружок с галочкой, серединой сидящий
                  на нижней границе клетки */}
              {hasWorkout && (
                <span style={{
                  position: 'absolute',
                  bottom: '-9px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '19px',
                  height: '19px',
                  borderRadius: '50%',
                  background: 'var(--green)',
                  border: '2px solid var(--bg-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  zIndex: 1
                }}>
                  <Check size={11} strokeWidth={3.5} />
                </span>
              )}
              <span>{d.day}</span>
              {isToday && !isSelected ? (
                <span style={{ fontSize: '8px', color: 'var(--cyan, #0ea5e9)' }}>сегодня</span>
              ) : hasSteps && !isSelected ? (
                <div style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: 'var(--blue)'
                }} />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{
        padding: '12px 16px 16px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        gap: '12px',
        justifyContent: 'center',
        flexWrap: 'wrap'
      }}>
        {/* Тренировка выполнена полностью */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div style={{
            width: '14px', height: '14px', borderRadius: '4px',
            background: 'var(--green-dim)', border: '1px solid rgba(0, 200, 83, 0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Check size={8} strokeWidth={3} style={{ color: 'var(--green)' }} />
          </div>
          Тренировка
        </div>
        {/* Частично — были пропуски */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div style={{
            width: '14px', height: '14px', borderRadius: '4px',
            border: '1px solid rgba(0, 200, 83, 0.3)', overflow: 'hidden',
            background: 'linear-gradient(to top, var(--green-dim) 50%, transparent 50%)'
          }} />
          Частично
        </div>
        {/* Шаги */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div style={{
            width: '14px', height: '14px', borderRadius: '4px',
            background: 'var(--blue-dim)', border: '1px solid rgba(0, 180, 216, 0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--blue)' }} />
          </div>
          Шаги
        </div>
        {/* Отдых */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div style={{
            width: '14px', height: '14px', borderRadius: '4px',
            background: 'rgba(100, 116, 139, 0.15)', border: '1px solid rgba(100, 116, 139, 0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <div style={{ width: '7px', height: '2px', borderRadius: '1px', background: 'rgb(148, 163, 184)' }} />
          </div>
          Отдых
        </div>
        {/* Сегодня */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div style={{
            width: '14px', height: '14px', borderRadius: '4px',
            border: '2px solid var(--cyan, #0ea5e9)', background: 'transparent'
          }} />
          Сегодня
        </div>
      </div>
    </div>
  );
}

// Default workout selection - user picks manually, default to T1
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
  if (ex.actualSets && ex.actualSets.trim().length > 0) return true;
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

// Goal editor card shown in the Profile view. Holds its own draft state so
// the user can type freely without each keystroke debouncing through the
// server PUT. Save flushes the draft up to the parent + /api/settings; the
// cleanup useEffect resyncs the draft when the server-side goal changes
// (e.g. another device updated it).
function GoalEditor({
  goal,
  language,
  onSave,
}: {
  goal: MacroGoal;
  language: 'ru' | 'en';
  onSave: (next: MacroGoal) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<{ protein: string; fat: string; carbs: string; calories: string }>({
    protein: String(goal.protein),
    fat: String(goal.fat),
    carbs: String(goal.carbs),
    calories: String(goal.calories),
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Re-seed the draft if the upstream goal changes from elsewhere (server
  // pull, another device). Don't clobber the user's in-progress typing —
  // only resync when they're not actively editing (saving===false and the
  // draft matches the previous remote value).
  const prevGoalRef = useRef(goal);
  useEffect(() => {
    const prev = prevGoalRef.current;
    if (prev.protein === goal.protein && prev.fat === goal.fat && prev.carbs === goal.carbs && prev.calories === goal.calories) return;
    prevGoalRef.current = goal;
    setDraft({
      protein: String(goal.protein),
      fat: String(goal.fat),
      carbs: String(goal.carbs),
      calories: String(goal.calories),
    });
  }, [goal]);

  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);

  const parsed: MacroGoal = {
    protein: Math.max(0, Math.round(Number(draft.protein) || 0)),
    fat: Math.max(0, Math.round(Number(draft.fat) || 0)),
    carbs: Math.max(0, Math.round(Number(draft.carbs) || 0)),
    calories: Math.max(0, Math.round(Number(draft.calories) || 0)),
  };
  const dirty = parsed.protein !== goal.protein
    || parsed.fat !== goal.fat
    || parsed.carbs !== goal.carbs
    || parsed.calories !== goal.calories;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(parsed);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  const fields: Array<{ key: 'protein' | 'fat' | 'carbs' | 'calories'; label: string; unit: string; color: string }> = [
    { key: 'protein',  label: t('Белок', 'Protein'),    unit: t('г', 'g'),     color: 'var(--red)' },
    { key: 'fat',      label: t('Жиры', 'Fat'),         unit: t('г', 'g'),     color: 'var(--yellow)' },
    { key: 'carbs',    label: t('Углеводы', 'Carbs'),   unit: t('г', 'g'),     color: 'var(--blue)' },
    { key: 'calories', label: t('Калории', 'Calories'), unit: t('ккал', 'kcal'), color: 'var(--green)' },
  ];

  return (
    <div style={{
      marginBottom: '20px',
      padding: '18px',
      background: 'var(--bg-card)',
      borderRadius: '16px',
      border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Target size={18} style={{ color: 'var(--green)' }} />
          <div style={{ fontSize: '14px', fontWeight: 700 }}>{t('Моя цель', 'My Goal')}</div>
        </div>
        {savedAt && Date.now() - savedAt < 2500 && (
          <span style={{ fontSize: '11px', color: 'var(--green)', fontWeight: 600 }}>
            ✓ {t('сохранено', 'saved')}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {fields.map(f => (
          <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
              {f.label} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({f.unit})</span>
            </span>
            <input
              type="number"
              inputMode="numeric"
              value={draft[f.key]}
              onChange={(e) => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
              style={{
                padding: '10px 12px',
                background: 'var(--bg-elevated)',
                border: `1px solid var(--border)`,
                borderRadius: '10px',
                color: f.color,
                fontSize: '16px',
                fontWeight: 700,
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </label>
        ))}
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={!dirty || saving}
        style={{
          marginTop: '14px',
          width: '100%',
          minHeight: '46px',
          padding: '12px 14px',
          background: dirty
            ? 'linear-gradient(135deg, #5eead4 0%, #14b8a6 100%)'
            : 'var(--bg-elevated)',
          border: dirty ? 'none' : '1px solid var(--border)',
          borderRadius: '12px',
          color: dirty ? '#053b3a' : 'var(--text-muted)',
          fontSize: '14px',
          fontWeight: 800,
          cursor: dirty && !saving ? 'pointer' : 'default',
          textTransform: 'uppercase',
          letterSpacing: '0.3px',
          touchAction: 'manipulation',
          boxShadow: dirty ? '0 6px 22px rgba(20, 184, 166, 0.35)' : 'none',
        }}
      >
        {saving ? t('Сохраняем…', 'Saving…') : t('Сохранить цель', 'Save goal')}
      </button>
    </div>
  );
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
  const [vitals, setVitals] = useState<VitalEntry[]>([]);
  // '' = форма скрыта; иначе тип устройства/процедуры
  const [vitalsKind, setVitalsKind] = useState<'' | 'bp' | 'oxi' | 'body' | 'sym' | 'custom'>('');
  const [vitalsForm, setVitalsForm] = useState({ systolic: '', diastolic: '', pulse: '', spo2: '', fatPct: '', customName: '', customValue: '', customUnit: '', tags: [] as string[], note: '' });

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
  const [programLoading, setProgramLoading] = useState(false);
  const [programError, setProgramError] = useState<string | null>(null);
  const [programProposal, setProgramProposal] = useState<{
    rationale: string;
    workouts: { focus: string; exercises: { name: string; plannedSets: string; restTime: string; notes: string }[] }[];
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
  // Лента дат тренировок: при заходе в раздел прокручиваем к выбранному дню (сегодня)
  const workoutStripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (view !== 'workout' || !todayStr) return;
    const el = workoutStripRef.current;
    if (!el) return;
    const sel = el.querySelector('[data-selchip="1"]') as HTMLElement | null;
    if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest' });
    else el.scrollLeft = el.scrollWidth;
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
  const serverDataLoadedRef = useRef(false);
  const userMadeChangeRef = useRef(false); // Only sync after user actually changes something on THIS device
  const [nutritionRecommendations, setNutritionRecommendations] = useState<NutritionRecommendation[] | null>(null);
  // ИИ-план «когда и что есть» под цель пользователя (кэш на день в localStorage)
  const [aiNutritionPlan, setAiNutritionPlan] = useState<NutritionRecommendation[] | null>(null);
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
          if (data.exerciseLibrary) setExerciseLibrary(data.exerciseLibrary);
          if (data.habits) setHabits(data.habits);
          if (Array.isArray(data.programArchive)) setProgramArchive(data.programArchive);
          if (data.nutritionProfile) setNutritionProfile(data.nutritionProfile);
          if (Array.isArray(data.recipes)) setRecipes(data.recipes);
          if (Array.isArray(data.vitals)) setVitals(data.vitals);
          // Apply library images to all workouts before setting state
          if (data.workouts && data.exerciseLibrary) {
            const lib = data.exerciseLibrary as Record<string, string>;
            let changed = false;
            for (const workout of data.workouts) {
              for (const ex of workout.exercises) {
                if (!ex.imageUrl) {
                  const libImg = lib[ex.name.toLowerCase().trim()];
                  if (libImg) { ex.imageUrl = libImg; changed = true; }
                }
              }
            }
            setWorkouts(data.workouts);
          } else if (data.workouts) {
            setWorkouts(data.workouts);
          }
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
          if (Array.isArray(b.workouts) && b.workouts.length) {
            // подставляем картинки из сохранённой библиотеки, как при обычной загрузке
            const lib = (b.exerciseLibrary ?? {}) as Record<string, string>;
            for (const w of b.workouts as Workout[]) {
              for (const ex of w.exercises) {
                if (!ex.imageUrl) {
                  const img = lib[ex.name.toLowerCase().trim()];
                  if (img) ex.imageUrl = img;
                }
              }
            }
            setWorkouts(b.workouts);
          }
          if (b.exerciseLibrary && typeof b.exerciseLibrary === 'object') setExerciseLibrary(b.exerciseLibrary);
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
          if (data.workouts) setWorkouts(data.workouts);
          if (data.dayLogs) setDayLogs(prev => mergeServerDayLogs(prev, data.dayLogs));
          if (data.progressHistory) setProgressHistory(data.progressHistory);
          if (data.bodyMeasurements) setBodyMeasurements(data.bodyMeasurements);
          if (data.plannerEvents) setPlannerEventsRaw(data.plannerEvents);
          if (data.habits) setHabits(data.habits);
          if (data.exerciseLibrary) setExerciseLibrary(data.exerciseLibrary);
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

  // Вкладка ИИ — страница целиком белая: чат без капсулы лежит прямо на ней
  useEffect(() => {
    const bg = view === 'chat' ? 'var(--bg-card)' : '';
    document.documentElement.style.background = bg;
    document.body.style.background = bg;
    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
    };
  }, [view]);

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
      // Always sync exercise library if it has data
      if (Object.keys(exerciseLibraryRef.current).length > 0) {
        payload.exerciseLibrary = exerciseLibraryRef.current;
      }
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
      localStorage.setItem('fitness_backup', JSON.stringify({ workouts, dayLogs, progressHistory, bodyMeasurements, exerciseLibrary: exerciseLibraryRef.current, ts: Date.now() }));
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
        if (Object.keys(exerciseLibraryRef.current).length > 0) payload.exerciseLibrary = exerciseLibraryRef.current;
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
    const handleBeforeUnload = () => {
      if (!isLoaded || !serverDataLoadedRef.current || !userMadeChangeRef.current) return;
      const payload: Record<string, unknown> = { workouts, dayLogs, progressHistory, bodyMeasurements };
      if (Object.keys(exerciseLibraryRef.current).length > 0) payload.exerciseLibrary = exerciseLibraryRef.current;
      navigator.sendBeacon('/api/fitness', JSON.stringify(payload));
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isLoaded && serverDataLoadedRef.current && userMadeChangeRef.current) {
        const payload: Record<string, unknown> = { workouts, dayLogs, progressHistory, bodyMeasurements };
        if (Object.keys(exerciseLibraryRef.current).length > 0) payload.exerciseLibrary = exerciseLibraryRef.current;
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
              if (parsed.workouts) setWorkouts(parsed.workouts);
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
    // сбрасываем кэш плана — он пересоберётся под новую анкету
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

  const addVitalEntry = async () => {
    const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : undefined; };
    const entry: VitalEntry = {
      id: Date.now().toString(),
      at: new Date().toISOString(),
      systolic: num(vitalsForm.systolic),
      diastolic: num(vitalsForm.diastolic),
      pulse: num(vitalsForm.pulse),
      spo2: num(vitalsForm.spo2),
      fatPct: num(vitalsForm.fatPct),
      customName: vitalsForm.customName.trim() || undefined,
      customValue: num(vitalsForm.customValue),
      customUnit: vitalsForm.customUnit.trim() || undefined,
      tags: vitalsForm.tags,
      note: vitalsForm.note.trim() || undefined,
    };
    if (!entry.systolic && !entry.diastolic && !entry.pulse && !entry.spo2 && !entry.fatPct && entry.customValue === undefined) return;
    await saveVitals([entry, ...vitals].slice(0, 500));
    setVitalsKind('');
    setVitalsForm({ systolic: '', diastolic: '', pulse: '', spo2: '', fatPct: '', customName: '', customValue: '', customUnit: '', tags: [], note: '' });
  };

  // Симптом фиксируется одним тапом — дата и время ставятся автоматически
  const addSymptomEntry = async (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    const entry: VitalEntry = {
      id: Date.now().toString(),
      at: new Date().toISOString(),
      symptom: clean.slice(0, 60),
      tags: [],
    };
    await saveVitals([entry, ...vitals].slice(0, 500));
    setVitalsKind('');
    setVitalsForm(f => ({ ...f, customName: '' }));
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

  const acceptProgram = async () => {
    if (!programProposal) return;
    const entry = snapshotCurrentProgram();
    const newArchive = [entry, ...programArchive].slice(0, 20);
    const newWorkouts: Workout[] = programProposal.workouts.map((w, i) => ({
      id: 't' + (i + 1),
      name: 'Тренировка ' + (i + 1),
      exercises: w.exercises.map((e, j) => ({
        id: String(j + 1),
        name: e.name,
        plannedSets: e.plannedSets,
        actualSets: '',
        restTime: e.restTime,
        notes: e.notes,
        newWeight: '',
        feedback: '',
        completed: false,
      })),
    }));
    setProgramProposal(null);
    setShowProgramModal(false);
    await saveProgramChange(newWorkouts, newArchive);
  };

  const restoreProgram = async (entry: ArchivedProgram) => {
    const current = snapshotCurrentProgram();
    const newArchive = [current, ...programArchive.filter(p => p.id !== entry.id)].slice(0, 20);
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
        const fallback = dateKey === todayStr ? getNextAvailableWorkout() : (workouts[0]?.id || 't1');
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
          setAiNutritionPlan(data.items);
          if (Array.isArray(data.products) && data.products.length) setAiFoodProducts(data.products);
          try { localStorage.setItem('fitness_ai_food_plan', JSON.stringify({ date: todayStr, goal: goalKey, targets: targetsKey, items: data.items, products: data.products || [] })); } catch { /* quota */ }
        }
      } catch { /* офлайн — покажем статичный план */ }
      finally { aiPlanFetchingRef.current = false; }
    })();
  }, [isLoaded, todayStr, userSettings.goalType, userSettings.language, nutritionRecommendations, MACRO_TARGETS.protein, MACRO_TARGETS.fat, MACRO_TARGETS.carbs, MACRO_TARGETS.calories, mealHistory, nutritionProfile]);

  const updateExercise = (workoutId: string, exerciseId: string, updates: Partial<Exercise>) => {
    userMadeChangeRef.current = true;
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

  const currentWorkout = workouts.find(w => w.id === selectedWorkout) || workouts[0];
  const completedExercises = currentWorkout.exercises.filter(e => e.completed).length;
  const totalExercises = currentWorkout.exercises.length;
  const progressPercent = (completedExercises / totalExercises) * 100;

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
  const lastSetsByExerciseId = useMemo(() => {
    const map: Record<string, ExerciseSet[]> = {};
    // Ищем LAST по НАЗВАНИЮ упражнения (не по id!): внутренние id 1..N
    // переиспользуются между программами, и после смены программы (например,
    // сгенерированной ИИ) история ЧУЖОГО упражнения подтягивалась в новое.
    // Название — стабильный идентификатор упражнения между программами.
    const norm = (n: string) => n.toLowerCase().trim();
    const idsByName = new Map<string, string[]>();
    for (const e of displayExercises) {
      const k = norm(e.name);
      if (!k) continue;
      if (!idsByName.has(k)) idsByName.set(k, []);
      idsByName.get(k)!.push(e.id);
    }
    const remaining = new Set(idsByName.keys());
    const dates = Object.keys(dayLogs).filter(d => d < dateKey).sort().reverse();
    const hasReal = (sets?: ExerciseSet[]) =>
      Array.isArray(sets) && sets.some(st => (st.weight || 0) > 0 || (st.reps || 0) > 0);
    for (const d of dates) {
      if (remaining.size === 0) break;
      for (const candidate of [dayLogs[d]?.workoutDraft, dayLogs[d]?.workoutSnapshot]) {
        if (!candidate?.exercises) continue;
        for (const e of candidate.exercises) {
          const k = norm(e.name || '');
          if (!k || !remaining.has(k)) continue;
          const sets = (e as { sets?: ExerciseSet[] }).sets;
          if (hasReal(sets)) {
            for (const id of idsByName.get(k)!) map[id] = sets!;
            remaining.delete(k);
          }
        }
      }
    }
    return map;
  }, [dayLogs, dateKey, displayExercises]);

  // Динамика рабочего веса по каждому упражнению С САМОГО НАЧАЛА: для каждой
  // даты, где упражнение делалось (в ЛЮБОЙ тренировке), берём МАКСИМАЛЬНЫЙ вес
  // среди подходов. Не привязываемся к workoutId — история строится с первого
  // дня, когда появился вес. Один день = одна точка (макс. по draft/snapshot).
  const weightHistoryByExerciseId = useMemo(() => {
    // Сопоставление по НАЗВАНИЮ (id переиспользуются между программами —
    // график чужого упражнения попадал в новое после смены программы).
    const norm = (n: string) => n.toLowerCase().trim();
    const idsByName = new Map<string, string[]>();
    for (const w of workouts) {
      for (const e of w.exercises) {
        const k = norm(e.name);
        if (!k) continue;
        if (!idsByName.has(k)) idsByName.set(k, []);
        idsByName.get(k)!.push(e.id);
      }
    }
    const map: Record<string, { date: string; weight: number }[]> = {};
    const dates = Object.keys(dayLogs).sort(); // старые сверху
    for (const d of dates) {
      const perDay: Record<string, number> = {}; // nameKey → макс вес за день
      for (const candidate of [dayLogs[d]?.workoutDraft, dayLogs[d]?.workoutSnapshot]) {
        if (!candidate?.exercises) continue;
        for (const e of candidate.exercises) {
          const sets = (e as { sets?: ExerciseSet[] }).sets;
          if (!Array.isArray(sets) || sets.length === 0) continue;
          const maxW = Math.max(0, ...sets.map(st => st.weight || 0));
          const k = norm(e.name || '');
          if (maxW > 0 && k) perDay[k] = Math.max(perDay[k] || 0, maxW);
        }
      }
      for (const [k, w] of Object.entries(perDay)) {
        for (const id of idsByName.get(k) ?? []) {
          (map[id] ??= []).push({ date: d, weight: w });
        }
      }
    }
    return map;
  }, [dayLogs, workouts]);

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
      {/* Header */}
      <header style={{
        padding: '14px 20px 10px',
        paddingTop: 'calc(14px + env(safe-area-inset-top, 0px))',
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
          <div style={{
            fontSize: '16px',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            Welcome to TrainX, {userSettings.name || 'Атлет'}{isNightMode ? ' 🌙' : ''}
          </div>
          {/* Кружок юзера — открывает раздел «Я» */}
          <button
            onClick={() => { setView('profile'); localStorage.setItem('fitness_view', 'profile'); setShowProfileDropdown(false); }}
            aria-label={userSettings.language === 'ru' ? 'Профиль' : 'Profile'}
            className='btn-press'
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              border: (view === 'profile' || view === 'gains' || view === 'analytics') ? '2px solid var(--text-primary)' : 'none',
              background: 'linear-gradient(135deg, var(--yellow), var(--orange, #ff9f43))',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 3px 12px var(--yellow-glow)',
              flexShrink: 0
            }}
          >
            {(userSettings.name || 'A')[0].toUpperCase()}
          </button>
        </div>
      </header>

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

      {/* Content */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '4px 20px 16px',
        paddingBottom: 'calc(92px + env(safe-area-inset-bottom, 0px))',
        maxWidth: '600px',
        margin: '0 auto',
        width: '100%'
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

            {/* Лента дат: старые слева, «Сегодня» справа; при открытии
                прокручена к сегодняшнему дню. Внизу чипа — T1/счётчик или месяц. */}
            <div
              ref={workoutStripRef}
              style={{
                display: 'flex', gap: '6px', overflowX: 'auto',
                marginBottom: '12px', paddingBottom: '6px',
                scrollSnapType: 'x proximity'
              }}>
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
                  const dayExercises = log?.workoutSnapshot?.exercises ?? log?.workoutDraft?.exercises ?? [];
                  const exTotal = dayExercises.length;
                  const exDone = dayExercises.filter(e => e.completed).length;
                  const hasWorkout = exDone > 0;
                  const fullyDone = exTotal > 0 && exDone === exTotal;
                  const wId = log?.workoutSnapshot?.workoutId ?? log?.workoutCompleted ?? log?.selectedWorkout;
                  const cw = hasWorkout && wId ? workouts.find(w => w.id === wId) : null;
                  const wLabel = cw ? cw.name.replace('Тренировка ', 'T') : '';
                  const label = d.toLocaleDateString(userSettings.language === 'ru' ? 'ru-RU' : 'en-US', { weekday: 'short' });
                  const isToday = i === 0;
                  chips.push(
                    <button
                      key={ds}
                      data-selchip={isSel ? '1' : undefined}
                      onClick={() => setSelectedDate(d)}
                      className='btn-press'
                      style={{
                        flex: '0 0 calc((100% - 36px) / 7)',
                        padding: '8px 4px',
                        scrollSnapAlign: 'center',
                        overflow: 'hidden',
                        background: isSel ? 'var(--yellow)' : hasWorkout ? 'var(--green-dim)' : 'var(--bg-card)',
                        border: isSel ? 'none' : isToday ? '2px solid var(--cyan, #0ea5e9)' : hasWorkout ? 'none' : '1px solid var(--border)',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px'
                      }}
                    >
                      <span style={{
                        fontSize: '10px', fontWeight: 600, textTransform: 'capitalize',
                        whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
                        color: isSel ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)'
                      }}>{label}</span>
                      <span style={{
                        fontSize: '15px', fontWeight: 800, lineHeight: 1,
                        color: isSel ? '#fff' : 'var(--text-primary)'
                      }}>{d.getDate()}</span>
                      <span style={{
                        fontSize: '9px', fontWeight: 700,
                        color: isSel ? 'rgba(255,255,255,0.85)' : hasWorkout ? 'var(--green)' : 'var(--text-muted)'
                      }}>
                        {hasWorkout
                          ? (wLabel || exDone + '/' + exTotal)
                          : d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}
                      </span>
                    </button>
                  );
                }
                return chips;
              })()}
            </div>

            {/* Функция ручной отметки «день отдыха» убрана: день без тренировки
                считается днём отдыха автоматически. */}

            {/* Workout selector - compact grid, hidden when viewing history */}
            {!viewingPastWorkout && (
              <div style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '16px',
                alignItems: 'center'
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${Math.min(workouts.length + (workouts.length < MAX_WORKOUTS ? 1 : 0), 8)}, 1fr)`,
                  gap: '6px',
                  flex: 1
                }}>
                  {workouts.map(w => {
                    const isEmpty = w.exercises.length === 0;
                    const isActive = selectedWorkout === w.id;
                    return (
                      <button
                        key={w.id}
                        className="tab-button btn-press"
                        onClick={() => selectWorkout(w.id)}
                        style={{
                          padding: '10px',
                          background: isActive
                            ? '#000'
                            : 'var(--bg-card)',
                          border: isActive ? '1px solid #000' : '1px solid var(--border)',
                          borderRadius: '10px',
                          color: isActive ? '#fff' : isEmpty ? 'var(--text-muted)' : 'var(--text-primary)',
                          fontWeight: isActive ? 800 : 600,
                          fontSize: '14px',
                          boxShadow: isActive ? '0 4px 18px rgba(0,0,0,0.45)' : 'none',
                          opacity: isActive ? 1 : isEmpty ? 0.5 : 1,
                          transform: isActive ? 'scale(1.02)' : 'scale(1)',
                          minWidth: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          touchAction: 'manipulation'
                        }}
                      >
                        {w.name.replace('Тренировка ', 'T')}
                      </button>
                    );
                  })}
                  {workouts.length < MAX_WORKOUTS && (
                    <button
                      className="btn-press"
                      onClick={addNewWorkout}
                      style={{
                        padding: '10px',
                        background: 'var(--bg-elevated)',
                        border: '1px dashed var(--border-strong)',
                        borderRadius: '10px',
                        color: 'var(--text-muted)',
                        fontWeight: 600,
                        fontSize: '14px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 0,
                        touchAction: 'manipulation'
                      }}
                      title="Добавить тренировку"
                    >
                      <Plus size={18} />
                    </button>
                  )}
                </div>
                {/* Ручная отметка отдыха убрана — день без тренировки
                    автоматически считается днём отдыха. */}
                <button
                  onClick={() => openWorkoutEditor(selectedWorkout)}
                  style={{
                    padding: '10px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                  title="Редактировать тренировку"
                >
                  <Settings size={18} />
                </button>
                <button
                  onClick={() => { setShowProgramModal(true); setProgramDays(Math.max(2, workouts.filter(w => w.exercises.length > 0).length) || 4); }}
                  style={{
                    padding: '10px',
                    background: 'var(--yellow-dim)',
                    border: '1px solid var(--yellow-glow)',
                    borderRadius: '10px',
                    color: 'var(--yellow)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                  title="Программа: ИИ-предложение и история"
                >
                  <Sparkles size={18} />
                </button>
              </div>
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
                  return (
                    <ExerciseCard
                      key={ex.id}
                      ex={ex}
                      idx={idx}
                      onToggle={() => !viewingPastWorkout && updateExercise(currentWorkout.id, ex.id, { completed: !ex.completed })}
                      onUpdate={(updates) => !viewingPastWorkout && updateExercise(currentWorkout.id, ex.id, updates)}
                      progressHistory={progressHistory[exerciseKey] || []}
                      weightHistory={weightHistoryByExerciseId[ex.id]}
                      lastSets={lastSetsByExerciseId[ex.id]}
                      exerciseLibrary={exerciseLibrary}
                      onImageSaved={(name, url) => setExerciseLibrary(prev => ({ ...prev, [name]: url }))}
                      dayClosed={currentDayLog.dayClosed}
                      onShowImage={(url, name) => { setImageModal({ url, name }); document.body.style.overflow = 'hidden'; }}
                      expanded={expandedExerciseId === ex.id}
                      onToggleExpand={() => setExpandedExerciseId(prev => prev === ex.id ? null : ex.id)}
                      muscleLabel={muscleGroups[ex.name.trim().toLowerCase()]}
                    />
                  );
                })
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

            {/* Тренд прогресса — вес по замерам, под календарём */}
            {(() => {
              const withWeight = bodyMeasurements
                .filter(m => typeof m.weight === 'number' && m.weight! > 0)
                .slice()
                .sort((a, b) => (a.date < b.date ? -1 : 1));
              if (withWeight.length < 2) return null;
              return (
                <div style={{
                  marginTop: '12px',
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: '16px', padding: '16px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '14px', fontWeight: 700 }}>
                    <TrendingUp size={16} style={{ color: 'var(--yellow)' }} />
                    {userSettings.language === 'ru' ? 'Тренд прогресса' : 'Progress trend'}
                  </div>
                  <WeightChart
                    data={withWeight.map(m => m.weight!)}
                    labels={withWeight.map(m => new Date(m.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }))}
                  />
                </div>
              );
            })()}
          </div>
        )}

        {/* NUTRITION VIEW */}
        {view === 'nutrition' && (
          <div className="view-content">
            {/* Daily target header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              marginBottom: '12px',
              padding: '10px 16px',
              background: 'var(--bg-card)',
              borderRadius: '12px',
              border: '1px solid var(--border)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Target size={14} className="pulse-subtle" style={{ color: 'var(--red)' }} />
                <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500 }}>{t('goal')}</span>
              </div>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--blue)' }}>{MACRO_TARGETS.protein} {t('protein')}</span>
              <span style={{ color: 'var(--border-strong)' }}>|</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--yellow)' }}>{MACRO_TARGETS.fat} {t('fat')}</span>
              <span style={{ color: 'var(--border-strong)' }}>|</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--green)' }}>{MACRO_TARGETS.carbs} {t('carbs')}</span>
              <span style={{ color: 'var(--border-strong)' }}>|</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--red)' }}>{MACRO_TARGETS.calories} {t('kcal')}</span>
            </div>

            {/* Nutrition Streak - недели листаются прокруткой */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              marginBottom: '12px',
              padding: '14px 16px',
              background: 'var(--bg-card)',
              borderRadius: '12px',
              border: '1px solid var(--border)',
              overflow: 'hidden'
            }}>
              {/* Header with streak count */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    fontSize: '16px',
                    filter: nutritionStreak > 0 ? 'drop-shadow(0 0 6px rgba(255, 107, 0, 0.5))' : 'grayscale(0.5)'
                  }}>
                    🔥
                  </span>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: nutritionStreak > 0 ? '#ff6b00' : 'var(--text-muted)'
                  }}>
                    {nutritionStreak} {nutritionStreak === 1 ? 'день' : nutritionStreak >= 2 && nutritionStreak <= 4 ? 'дня' : 'дней'}
                  </span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {(() => {
                    const w = streakWeeks[streakShownIdx];
                    if (!w) return '';
                    if (w.days.some(d => d.isToday)) return 'текущая неделя';
                    const [y, m, d] = w.days[6].date.split('-').map(Number);
                    return `${Number(w.days[0].date.slice(8, 10))}–${Number(w.days[6].date.slice(8, 10))} ${new Date(y, m - 1, d).toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}`;
                  })()}
                </span>
              </div>

              {/* Недели: горизонтальная прокрутка со снапом, соседние недели
                  выглядывают по краям и приглушены */}
              <div
                ref={streakScrollRef}
                onScroll={handleStreakScroll}
                className="no-scrollbar"
                style={{
                  display: 'flex',
                  gap: `${STREAK_GAP}px`,
                  overflowX: 'auto',
                  scrollSnapType: 'x mandatory',
                  scrollPadding: `0 ${STREAK_PEEK}px`,
                  margin: '0 -16px',
                  WebkitOverflowScrolling: 'touch',
                  overscrollBehaviorX: 'contain'
                }}
              >
                {streakWeeks.map((week, wi) => (
                  <div
                    key={week.monday}
                    style={{
                      flex: `0 0 calc(100% - ${STREAK_PEEK * 2}px)`,
                      marginLeft: wi === 0 ? `${STREAK_PEEK}px` : 0,
                      marginRight: wi === streakWeeks.length - 1 ? `${STREAK_PEEK}px` : 0,
                      scrollSnapAlign: 'center',
                      display: 'flex',
                      gap: '6px',
                      justifyContent: 'space-between',
                      opacity: wi === streakShownIdx ? 1 : 0.35,
                      transition: 'opacity 0.2s ease'
                    }}
                  >
                {week.days.map((day) => {
                  const isSelected = day.date === dateKey;
                  return (
                  <div
                    key={day.date}
                    onClick={() => {
                      if (!day.isFuture) {
                        const [y, m, d] = day.date.split('-').map(Number);
                        setSelectedDate(new Date(y, m - 1, d));
                      }
                    }}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: day.isFuture ? 'default' : 'pointer'
                    }}
                  >
                    {/* Day name and number */}
                    <span style={{
                      fontSize: '10px',
                      color: day.isToday ? 'var(--yellow)' : isSelected ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontWeight: day.isToday || isSelected ? 600 : 400,
                      textAlign: 'center'
                    }}>
                      {day.isToday ? 'Сег' : day.dayName}
                      <br />
                      <span style={{ fontSize: '9px' }}>{day.date.split('-')[2]}</span>
                    </span>
                    {/* Cell */}
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: day.isToday
                        ? isTodayCloseToGoal
                          ? 'transparent'
                          : 'var(--bg-elevated)'
                        : day.isFuture
                          ? 'rgba(239, 68, 68, 0.05)'
                          : isSelected
                            ? 'rgba(17, 20, 24, 0.06)'
                            : 'transparent',
                      border: day.isToday
                        ? isTodayCloseToGoal
                          ? '1px solid rgba(255, 152, 0, 0.2)'
                          : 'none'
                        : isSelected && !day.isToday
                          ? '1px solid rgba(17, 20, 24, 0.14)'
                          : day.isFuture
                            ? '1px dashed rgba(239, 68, 68, 0.25)'
                            : 'none',
                      opacity: day.isFuture ? 0.5 : 1
                    }}>
                      {day.isToday ? (
                        isTodayCloseToGoal ? (
                          <span style={{
                            fontSize: '16px',
                            animation: 'fireBounce 0.5s ease-in-out infinite',
                            filter: 'drop-shadow(0 0 4px rgba(255, 107, 0, 0.8))'
                          }}>🔥</span>
                        ) : (
                          /* Анимированные песочные часы (в стиле animateicons.in) */
                          <Hourglass size={14} className="hourglass-animated" style={{ color: 'var(--text-muted)' }} />
                        )
                      ) : day.isFuture ? (
                        <span style={{
                          fontSize: '14px',
                          fontWeight: 600,
                          color: 'rgba(239, 68, 68, 0.4)'
                        }}>✕</span>
                      ) : day.completed ? (
                        <span style={{
                          fontSize: '18px',
                          animation: 'fireBurn 1.5s ease-in-out infinite',
                          filter: 'drop-shadow(0 0 4px rgba(255, 107, 0, 0.8)) drop-shadow(0 0 8px rgba(255, 193, 7, 0.5))'
                        }}>🔥</span>
                      ) : (
                        /* День без выполненной цели — показываем процент вместо смайлика */
                        <span style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: 'var(--text-muted)'
                        }}>{day.pct}%</span>
                      )}
                    </div>
                  </div>
                  );
                })}
                  </div>
                ))}
              </div>

            </div>

            {/* Streak Day Detail Modal */}
            {streakDetailDate && (() => {
              const log = dayLogs[streakDetailDate];
              const meals = log?.meals || [];
              const totals = meals.reduce((acc, m) => ({
                protein: acc.protein + m.protein,
                fat: acc.fat + m.fat,
                carbs: acc.carbs + m.carbs,
                calories: acc.calories + m.calories
              }), { protein: 0, fat: 0, carbs: 0, calories: 0 });
              const dayInfo = last7Days.find(d => d.date === streakDetailDate);
              // Parse date correctly to avoid timezone issues
              const [year, month, dayNum] = streakDetailDate.split('-').map(Number);
              const dateObj = new Date(year, month - 1, dayNum);
              const dateStr = dateObj.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });

              return (
                <div
                  onClick={() => setStreakDetailDate(null)}
                  style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.7)',
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '20px'
                  }}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      background: 'var(--bg-primary)',
                      borderRadius: '16px',
                      width: '100%',
                      maxWidth: '360px',
                      maxHeight: '80vh',
                      overflow: 'auto',
                      padding: '20px'
                    }}
                  >
                    {/* Header */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '16px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: dayInfo?.completed ? '24px' : '16px', fontWeight: 800, color: dayInfo?.completed ? undefined : 'var(--text-muted)' }}>
                          {dayInfo?.completed ? '🔥' : ((dayInfo?.pct ?? 0) + '%')}
                        </span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '15px', textTransform: 'capitalize' }}>
                            {dateStr}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            {dayInfo?.completed ? 'Цель выполнена' : 'Цель не выполнена'}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => setStreakDetailDate(null)}
                        style={{
                          background: 'var(--bg-elevated)',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '8px',
                          cursor: 'pointer',
                          color: 'var(--text-muted)'
                        }}
                      >
                        <X size={18} />
                      </button>
                    </div>

                    {/* Totals */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: '8px',
                      marginBottom: '16px'
                    }}>
                      <div style={{
                        background: 'var(--bg-card)',
                        padding: '10px 8px',
                        borderRadius: '10px',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--red)' }}>
                          {totals.protein}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Б</div>
                      </div>
                      <div style={{
                        background: 'var(--bg-card)',
                        padding: '10px 8px',
                        borderRadius: '10px',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--yellow)' }}>
                          {totals.fat}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Ж</div>
                      </div>
                      <div style={{
                        background: 'var(--bg-card)',
                        padding: '10px 8px',
                        borderRadius: '10px',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--blue)' }}>
                          {totals.carbs}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>У</div>
                      </div>
                      <div style={{
                        background: 'var(--bg-card)',
                        padding: '10px 8px',
                        borderRadius: '10px',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--green)' }}>
                          {totals.calories}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>ккал</div>
                      </div>
                    </div>

                    {/* Meals list */}
                    {meals.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {meals.map((meal, idx) => (
                          <div
                            key={idx}
                            style={{
                              background: 'var(--bg-card)',
                              padding: '12px',
                              borderRadius: '10px',
                              border: '1px solid var(--border)'
                            }}
                          >
                            <div style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              marginBottom: '6px'
                            }}>
                              <div style={{ fontWeight: 600, fontSize: '13px' }}>
                                {meal.name}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                {meal.time}
                              </div>
                            </div>
                            <div style={{
                              display: 'flex',
                              gap: '12px',
                              fontSize: '11px',
                              color: 'var(--text-secondary)'
                            }}>
                              <span>Б: {meal.protein}</span>
                              <span>Ж: {meal.fat}</span>
                              <span>У: {meal.carbs}</span>
                              <span style={{ color: 'var(--green)' }}>{meal.calories} ккал</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{
                        textAlign: 'center',
                        padding: '30px',
                        color: 'var(--text-muted)',
                        fontSize: '13px'
                      }}>
                        Нет записей о питании
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Compact Macro summary - 2x2 grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '6px',
              marginBottom: '12px'
            }}>
              {/* Protein */}
              <div className="macro-card" style={{
                background: 'var(--bg-card)',
                padding: '8px 10px',
                borderRadius: '10px',
                border: '1px solid var(--border)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '3px'
                }}>
                  <span style={{ fontSize: '10px', color: 'var(--blue)', fontWeight: 600 }}>{t('protein')}</span>
                  <span className="number-transition" style={{ fontSize: '14px', fontWeight: 700, color: 'var(--blue)' }}>{macroTotals.protein}<span style={{ fontSize: '10px', fontWeight: 500 }}>/{MACRO_TARGETS.protein}</span></span>
                </div>
                <div style={{ height: '2px', background: 'var(--bg-elevated)', borderRadius: '1px', overflow: 'hidden' }}>
                  <div className="progress-fill-animated" style={{ width: `${macroProgress.protein}%`, height: '100%', background: 'var(--blue)', borderRadius: '1px' }} />
                </div>
              </div>

              {/* Fat */}
              <div className="macro-card" style={{
                background: 'var(--bg-card)',
                padding: '8px 10px',
                borderRadius: '10px',
                border: '1px solid var(--border)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '3px'
                }}>
                  <span style={{ fontSize: '10px', color: 'var(--yellow)', fontWeight: 600 }}>{t('fat')}</span>
                  <span className="number-transition" style={{ fontSize: '14px', fontWeight: 700, color: 'var(--yellow)' }}>{macroTotals.fat}<span style={{ fontSize: '10px', fontWeight: 500 }}>/{MACRO_TARGETS.fat}</span></span>
                </div>
                <div style={{ height: '2px', background: 'var(--bg-elevated)', borderRadius: '1px', overflow: 'hidden' }}>
                  <div className="progress-fill-animated" style={{ width: `${macroProgress.fat}%`, height: '100%', background: 'var(--yellow)', borderRadius: '1px' }} />
                </div>
              </div>

              {/* Carbs */}
              <div className="macro-card" style={{
                background: 'var(--bg-card)',
                padding: '8px 10px',
                borderRadius: '10px',
                border: '1px solid var(--border)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '3px'
                }}>
                  <span style={{ fontSize: '10px', color: 'var(--green)', fontWeight: 600 }}>{t('carbs')}</span>
                  <span className="number-transition" style={{ fontSize: '14px', fontWeight: 700, color: 'var(--green)' }}>{macroTotals.carbs}<span style={{ fontSize: '10px', fontWeight: 500 }}>/{MACRO_TARGETS.carbs}</span></span>
                </div>
                <div style={{ height: '2px', background: 'var(--bg-elevated)', borderRadius: '1px', overflow: 'hidden' }}>
                  <div className="progress-fill-animated" style={{ width: `${macroProgress.carbs}%`, height: '100%', background: 'var(--green)', borderRadius: '1px' }} />
                </div>
              </div>

              {/* Calories */}
              <div className="macro-card" style={{
                background: 'var(--bg-card)',
                padding: '8px 10px',
                borderRadius: '10px',
                border: '1px solid var(--border)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '3px'
                }}>
                  <span style={{ fontSize: '10px', color: 'var(--red)', fontWeight: 600 }}>{t('kcal')}</span>
                  <span className="number-transition" style={{ fontSize: '14px', fontWeight: 700, color: 'var(--red)' }}>{macroTotals.calories}<span style={{ fontSize: '10px', fontWeight: 500 }}>/{MACRO_TARGETS.calories}</span></span>
                </div>
                <div style={{ height: '2px', background: 'var(--bg-elevated)', borderRadius: '1px', overflow: 'hidden' }}>
                  <div className="progress-fill-animated" style={{ width: `${macroProgress.calories}%`, height: '100%', background: 'var(--red)', borderRadius: '1px' }} />
                </div>
              </div>
            </div>

            {/* Сахар за день — общий (природный + добавленный одним числом) */}
            {macroTotals.sugar > 0 && (
              <div style={{
                marginTop: '-8px',
                marginBottom: '16px',
                padding: '10px 14px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '13px'
              }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {userSettings.language === 'ru' ? 'Сахар за день' : 'Sugar today'}
                </span>
                <span style={{
                  fontWeight: 700,
                  color: macroTotals.sugar > 50 ? 'var(--red)' : macroTotals.sugar > 25 ? 'var(--yellow)' : 'var(--green)'
                }}>
                  {Math.round(macroTotals.sugar)} г
                </span>
              </div>
            )}

            {/* Meals header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px'
            }}>
              <h3 style={{ margin: 0, fontWeight: 700, fontSize: '18px' }}>{t('meals')}</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                {/* AI-кнопка убрана — ассистент есть в нижнем меню */}
                <button
                  onClick={() => {
                    setEditingMeal(null);
                    setMealForm({ time: '', name: '', protein: '', fat: '', carbs: '', calories: '', sugar: '' });
                    setShowMealModal(true);
                  }}
                  className="btn-press fab"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px 18px',
                    background: 'var(--yellow)',
                    border: 'none',
                    borderRadius: '12px',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '14px',
                    boxShadow: '0 4px 20px var(--yellow-glow)'
                  }}
                >
                  <Plus size={18} /> {t('addMeal')}
                </button>
              </div>
            </div>

            {/* Частые продукты — добавление в один тап, без фото и форм */}
            {mealHistory.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{
                  fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)',
                  marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px'
                }}>
                  <History size={13} />
                  {userSettings.language === 'ru' ? 'Частые продукты — добавить в один тап' : 'Frequent foods — one-tap add'}
                </div>
                <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '6px' }}>
                  {mealHistory.slice(0, 8).map((item, idx) => (
                    <button
                      key={`freq-${idx}`}
                      type="button"
                      className="btn-press"
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
                        userMadeChangeRef.current = true;
                        updateDayLog({ meals: [...currentDayLog.meals, newMeal] });
                      }}
                      style={{
                        flexShrink: 0, padding: '8px 12px',
                        background: 'var(--bg-card)', border: '1px solid var(--border)',
                        borderRadius: '10px', cursor: 'pointer', textAlign: 'left', maxWidth: '150px'
                      }}
                    >
                      <div style={{
                        fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                      }}>
                        + {item.meal.name}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {item.meal.calories} ккал · {item.meal.protein}Б
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Meals list */}
            {currentDayLog.meals.length === 0 ? (
              <div className="view-content" style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: 'var(--text-muted)',
                background: 'var(--bg-card)',
                borderRadius: '12px',
                border: '1px solid var(--border)'
              }}>
                <Apple size={40} style={{ opacity: 0.3, marginBottom: '12px' }} />
                <div style={{ fontSize: '14px', fontWeight: 500 }}>{t('noMeals')}</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>{t('addFirstMeal')}</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[...currentDayLog.meals].sort((a, b) => {
                  // Sort by time (HH:MM format)
                  const timeA = a.time || '99:99';
                  const timeB = b.time || '99:99';
                  return timeA.localeCompare(timeB);
                }).map((meal, index) => (
                  <div
                    key={meal.id}
                    className="card-hover list-item-animated"
                    style={{
                      background: 'var(--bg-card)',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      border: '1px solid var(--border)',
                      animationDelay: `${index * 0.05}s`
                    }}
                  >
                    {(() => { const peeking = peekMealId === meal.id; return (
                    <div
                      onClick={() => peekMeal(meal.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: 'pointer'
                      }}>
                      {/* Time */}
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '36px' }}>
                        {meal.time}
                      </span>
                      {/* Name — при peek дочитывается на освободившееся место */}
                      <span style={{
                        fontWeight: 600, fontSize: '13px', flex: 1, minWidth: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: peeking && peekWrapId === meal.id ? 'normal' : 'nowrap',
                        wordBreak: peeking && peekWrapId === meal.id ? 'break-word' : 'normal',
                        transition: 'all 0.25s ease'
                      }}>
                        {meal.name}
                      </span>
                      {/* Правая часть (макросы + кнопки): при peek стирается вправо */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        maxWidth: peeking ? '0px' : '360px',
                        opacity: peeking ? 0 : 1,
                        transform: peeking ? 'translateX(18px)' : 'translateX(0)',
                        overflow: 'hidden',
                        pointerEvents: peeking ? 'none' : 'auto',
                        transition: 'max-width 0.35s ease, opacity 0.3s ease, transform 0.35s ease',
                        flexShrink: 0
                      }}>
                      {/* Compact macros */}
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11px' }}>
                        <span style={{ color: 'var(--blue)', fontWeight: 600 }}>{meal.protein}</span>
                        <span style={{ color: 'var(--border-strong)' }}>/</span>
                        <span style={{ color: 'var(--yellow)', fontWeight: 600 }}>{meal.fat}</span>
                        <span style={{ color: 'var(--border-strong)' }}>/</span>
                        <span style={{ color: 'var(--green)', fontWeight: 600 }}>{meal.carbs}</span>
                        <span style={{ color: 'var(--border-strong)' }}>/</span>
                        <span style={{ color: 'var(--red)', fontWeight: 600 }}>{meal.calories}</span>
                      </div>
                      {/* Actions */}
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDayLogs(prev => {
                              const existingLog = prev[dateKey] || currentDayLog;
                              const newMeals = existingLog.meals.map(m =>
                                m.id === meal.id ? { ...m, isFavorite: !m.isFavorite } : m
                              );
                              upsertDayLog({ date: dateKey, kind: 'meals', payload: newMeals }).catch(() => {});
                              return {
                                ...prev,
                                [dateKey]: { ...existingLog, meals: newMeals }
                              };
                            });
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: '6px',
                            color: meal.isFavorite ? 'var(--red)' : 'var(--text-muted)',
                            cursor: 'pointer'
                          }}
                        >
                          <Heart size={14} fill={meal.isFavorite ? 'var(--red)' : 'none'} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openEditMeal(meal); }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: '6px',
                            color: 'var(--text-muted)',
                            cursor: 'pointer'
                          }}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteMeal(meal.id); }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: '6px',
                            color: 'var(--red)',
                            cursor: 'pointer'
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      </div>
                    </div>
                    ); })()}
                  </div>
                ))}
              </div>
            )}

            {/* Meal Timing Recommendations */}
            <div style={{
              marginTop: '24px',
              background: 'var(--bg-card)',
              borderRadius: '16px',
              border: '1px solid var(--border)',
              overflow: 'hidden'
            }}>
              <div style={{
                padding: '16px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  background: 'var(--purple-dim)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Timer size={16} style={{ color: 'var(--purple)' }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: '15px', flex: 1 }}>
                  {nutritionRecommendations ? 'Рекомендации тренера' : aiNutritionPlan ? (userSettings.language === 'ru' ? 'Когда и что есть — план от ИИ' : 'AI meal plan') : 'Когда есть'}
                </span>
                {!nutritionRecommendations && nutritionProfile && (
                  <button
                    onClick={openSurvey}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: '4px' }}
                  >
                    Обновить опрос
                  </button>
                )}
              </div>
              <div style={{ padding: '16px' }}>
                {/* Без анкеты рекомендации — общие. Опрос делает их персональными
                    (например, при инсулинорезистентности ИИ уберёт перекусы). */}
                {!nutritionRecommendations && !nutritionProfile && (
                  <div style={{
                    padding: '14px', marginBottom: '12px',
                    background: 'var(--yellow-dim)', border: '1px solid var(--yellow-glow)',
                    borderRadius: '12px'
                  }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Brain size={15} style={{ color: 'var(--yellow)' }} />
                      Сделаем рекомендации твоими
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', lineHeight: 1.5 }}>
                      Короткий опрос (1 минута): здоровье, непереносимости, привычки.
                      ИИ построит план и продукты под тебя — например, при
                      инсулинорезистентности уберёт перекусы и быстрые углеводы.
                    </div>
                    <button
                      onClick={openSurvey}
                      style={{
                        padding: '11px 16px', background: 'var(--yellow)', border: 'none',
                        borderRadius: '10px', color: '#fff', fontWeight: 700, fontSize: '13px', cursor: 'pointer'
                      }}
                    >
                      Пройти опрос
                    </button>
                  </div>
                )}
                {/* План показываем только от тренера или по анкете; пока ИИ думает — заглушка */}
                {!nutritionRecommendations && nutritionProfile && !aiNutritionPlan && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px', padding: '6px 0' }}>
                    <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                    Составляю персональный план по твоей анкете…
                  </div>
                )}
                {(nutritionRecommendations || (nutritionProfile && aiNutritionPlan)) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {(nutritionRecommendations || aiNutritionPlan || []).map(rec => (
                    <div key={rec.id} style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '12px',
                      background: 'var(--bg-elevated)',
                      borderRadius: '12px'
                    }}>
                      <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        background: RECOMMENDATION_COLORS[rec.color]?.bg || 'var(--yellow-dim)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <span style={{ fontSize: '16px' }}>{rec.emoji}</span>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>{rec.title}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          {rec.description}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            </div>

            {/* Food Products List — показываем только после опроса: список
                логически следует из персонального плана */}
            {nutritionProfile && (
            <div style={{
              marginTop: '24px',
              background: 'var(--bg-card)',
              borderRadius: '16px',
              border: '1px solid var(--border)',
              overflow: 'hidden'
            }}>
              <div style={{
                padding: '16px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  background: 'var(--green-dim)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Apple size={16} style={{ color: 'var(--green)' }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: '15px' }}>{aiFoodProducts ? 'Разрешённые продукты — от ИИ под цель' : 'Разрешённые продукты'}</span>
              </div>
              <div style={{ padding: '16px' }}>
                {Object.entries(FOOD_CATEGORIES).map(([key, cat]) => {
                  const products = (aiFoodProducts ?? []).filter(p => p.category === key);
                  if (products.length === 0) return null;
                  return (
                    <div key={key} style={{ marginBottom: '16px' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '10px'
                      }}>
                        <div style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '2px',
                          background: cat.color
                        }} />
                        <span style={{
                          fontSize: '13px',
                          fontWeight: 700,
                          color: cat.color
                        }}>
                          {cat.name}
                        </span>
                      </div>
                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '6px'
                      }}>
                        {products.map(product => (
                          <span
                            key={product.id}
                            style={{
                              padding: '6px 10px',
                              background: cat.bg,
                              borderRadius: '8px',
                              fontSize: '12px',
                              color: 'var(--text-primary)',
                              fontWeight: 500
                            }}
                          >
                            {product.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {!aiFoodProducts && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    Подбираю продукты под твою анкету…
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Рецепты: свои + импорт с фото (ИИ разбирает страницу рецепта) */}
            <div style={{
              marginTop: '24px',
              background: 'var(--bg-card)',
              borderRadius: '16px',
              border: '1px solid var(--border)',
              overflow: 'hidden'
            }}>
              <div style={{
                padding: '16px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '8px',
                  background: 'var(--yellow-dim)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <span style={{ fontSize: '16px' }}>📖</span>
                </div>
                <span style={{ fontWeight: 700, fontSize: '15px', flex: 1 }}>Рецепты</span>
                <input ref={recipePhotoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleRecipePhoto} />
                <button
                  onClick={() => recipePhotoRef.current?.click()}
                  disabled={recipeParsing}
                  title="Сфотографировать рецепт — ИИ разберёт"
                  style={{
                    padding: '9px 12px', background: 'var(--yellow-dim)', border: '1px solid var(--yellow-glow)',
                    borderRadius: '10px', color: 'var(--yellow)', cursor: 'pointer', fontSize: '12px', fontWeight: 700,
                    display: 'flex', alignItems: 'center', gap: '6px', opacity: recipeParsing ? 0.6 : 1
                  }}
                >
                  {recipeParsing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Camera size={14} />}
                  {recipeParsing ? 'Разбираю…' : 'Скан'}
                </button>
                <button
                  onClick={() => setShowRecipeForm(true)}
                  title="Добавить свой рецепт"
                  style={{
                    padding: '9px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    borderRadius: '10px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px', fontWeight: 700,
                    display: 'flex', alignItems: 'center', gap: '4px'
                  }}
                >
                  <Plus size={14} /> Свой
                </button>
              </div>
              <div style={{ padding: recipes.length ? '10px 16px 16px' : '16px' }}>
                {recipeParseError && (
                  <div style={{ fontSize: '12px', color: 'var(--red)', marginBottom: '10px' }}>{recipeParseError}</div>
                )}
                {/* Навигация по категориям */}
                {recipes.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '6px', marginTop: '4px' }}>
                    {['all', ...RECIPE_CATEGORIES.filter(c => recipes.some(r => (r.category || 'другое') === c))].map(c => (
                      <button
                        key={c}
                        onClick={() => setRecipeFilter(c)}
                        style={{
                          flexShrink: 0, padding: '7px 12px', borderRadius: '16px', cursor: 'pointer',
                          fontSize: '12px', fontWeight: recipeFilter === c ? 700 : 500,
                          background: recipeFilter === c ? 'var(--yellow)' : 'var(--bg-elevated)',
                          border: '1px solid ' + (recipeFilter === c ? 'var(--yellow)' : 'var(--border)'),
                          color: recipeFilter === c ? '#fff' : 'var(--text-secondary)',
                          textTransform: 'capitalize'
                        }}
                      >
                        {c === 'all' ? 'Все' : c}
                      </button>
                    ))}
                  </div>
                )}
                {recipes.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Пока пусто. Сфотографируй страницу купленного рецепта («Скан») — ИИ вытащит
                    ингредиенты, шаги и посчитает КБЖУ. Или добавь свой вручную («Свой»).
                  </div>
                ) : recipes.filter(r => recipeFilter === 'all' || (r.category || 'другое') === recipeFilter).map(r => (
                  <button
                    key={r.id}
                    onClick={() => setOpenRecipeId(r.id)}
                    style={{
                      width: '100%', textAlign: 'left', cursor: 'pointer',
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                      borderRadius: '12px', padding: '12px 14px', marginTop: '8px',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px'
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {r.category && r.category !== 'другое' ? r.category + ' · ' : ''}{r.perServing.calories} ккал · Б{r.perServing.protein} Ж{r.perServing.fat} У{r.perServing.carbs} · {r.ingredients.length} ингр.
                      </div>
                    </div>
                    <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ANALYTICS VIEW */}
        {view === 'analytics' && (
          <div className="view-content">
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BarChart3 size={20} />
                {t('statistics')}
              </h2>

              {/* Calendar mini */}
              <FitnessCalendar
                dayLogs={dayLogs}
                selectedDate={selectedDate}
                onSelectDate={(date) => {
                  setSelectedDate(date);
                  setView('workout');
                  localStorage.setItem('fitness_view', 'workout');
                }}
                workouts={workouts}
                timezone={userSettings.timezone}
              />

              {/* Favorite Meals */}
              <div style={{ marginTop: '20px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--red)' }}>
                  <Heart size={16} />
                  {t('favoriteMeals')}
                </h3>
                {(() => {
                  const favMeals: Meal[] = [];
                  Object.values(dayLogs).forEach(log => {
                    log.meals?.forEach(meal => {
                      if (meal.isFavorite && !favMeals.find(m => m.name === meal.name)) {
                        favMeals.push(meal);
                      }
                    });
                  });
                  if (favMeals.length === 0) {
                    return (
                      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                        {t('favoriteMealsHint')}
                      </div>
                    );
                  }
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {favMeals.map((meal, i) => (
                        <div key={i} style={{
                          background: 'var(--bg-card)',
                          padding: '12px',
                          borderRadius: '10px',
                          border: '1px solid var(--border)'
                        }}>
                          <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>{meal.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '12px' }}>
                            <span style={{ color: 'var(--blue)' }}>Б: {meal.protein}г</span>
                            <span style={{ color: 'var(--yellow)' }}>Ж: {meal.fat}г</span>
                            <span style={{ color: 'var(--green)' }}>У: {meal.carbs}г</span>
                            <span style={{ color: 'var(--red)' }}>{meal.calories} ккал</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* GAINS VIEW - Body Measurements */}
        {view === 'gains' && (
          <div className="view-content">
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Scale size={20} />
                {t('gains')}
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                {t('trackProgress')}
              </p>

              {/* Add Measurement Button */}
              <button
                onClick={() => setShowMeasurementModal(true)}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: 'var(--yellow)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  marginBottom: '20px'
                }}
              >
                <Plus size={18} />
                {t('addMeasurements')}
              </button>

              {/* График веса по замерам (старые→новые) */}
              {(() => {
                const withWeight = bodyMeasurements
                  .filter(m => typeof m.weight === 'number' && m.weight! > 0)
                  .slice()
                  .sort((a, b) => (a.date < b.date ? -1 : 1));
                if (withWeight.length === 0) return null;
                return (
                  <div style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: '16px', padding: '16px', marginBottom: '20px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '14px', fontWeight: 700 }}>
                      <TrendingUp size={16} style={{ color: 'var(--yellow)' }} />
                      {userSettings.language === 'ru' ? 'Динамика веса' : 'Weight trend'}
                    </div>
                    <WeightChart
                      data={withWeight.map(m => m.weight!)}
                      labels={withWeight.map(m => new Date(m.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }))}
                    />
                  </div>
                );
              })()}

              {/* Показатели здоровья: любые приборы и процедуры */}
              <div style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: '16px', padding: '16px', marginBottom: '20px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <Heart size={16} style={{ color: 'var(--red)' }} />
                  <span style={{ fontSize: '14px', fontWeight: 700, flex: 1 }}>
                    {userSettings.language === 'ru' ? 'Показатели здоровья' : 'Health metrics'}
                  </span>
                </div>

                {/* Выбор прибора/процедуры — форма раскрывается прямо тут */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: vitalsKind ? '12px' : '4px' }}>
                  {([['bp', 'Тонометр'], ['oxi', 'Пульсоксиметр'], ['body', 'Состав тела'], ['sym', 'Симптом'], ['custom', 'Другое']] as const).map(([k, label]) => (
                    <button key={k}
                      onClick={() => setVitalsKind(prev => prev === k ? '' : k)}
                      style={{
                        padding: '9px 13px', borderRadius: '10px', cursor: 'pointer', fontSize: '12px',
                        background: vitalsKind === k ? 'var(--yellow)' : 'var(--bg-elevated)',
                        border: '1px solid ' + (vitalsKind === k ? 'var(--yellow)' : 'var(--border)'),
                        color: vitalsKind === k ? '#fff' : 'var(--text-primary)',
                        fontWeight: vitalsKind === k ? 700 : 500,
                      }}>{label}</button>
                  ))}
                </div>

                {vitalsKind && (
                  <div style={{ marginBottom: '14px', padding: '12px', background: 'var(--bg-elevated)', borderRadius: '12px' }}>
                    {vitalsKind === 'bp' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                        {([['systolic', 'Верхнее'], ['diastolic', 'Нижнее'], ['pulse', 'Пульс']] as const).map(([k, label]) => (
                          <div key={k}>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px', textAlign: 'center' }}>{label}</div>
                            <input type="number" inputMode="decimal" placeholder="—" value={vitalsForm[k]}
                              onChange={e => setVitalsForm(f => ({ ...f, [k]: e.target.value }))}
                              style={{ width: '100%', textAlign: 'center', background: 'var(--bg-primary)' }} />
                          </div>
                        ))}
                      </div>
                    )}
                    {vitalsKind === 'oxi' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                        {([['spo2', 'SpO2 %'], ['pulse', 'Пульс']] as const).map(([k, label]) => (
                          <div key={k}>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px', textAlign: 'center' }}>{label}</div>
                            <input type="number" inputMode="decimal" placeholder="—" value={vitalsForm[k]}
                              onChange={e => setVitalsForm(f => ({ ...f, [k]: e.target.value }))}
                              style={{ width: '100%', textAlign: 'center', background: 'var(--bg-primary)' }} />
                          </div>
                        ))}
                      </div>
                    )}
                    {vitalsKind === 'body' && (
                      <div style={{ marginBottom: '10px' }}>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>Жир, % (анализатор состава тела / InBody)</div>
                        <input type="number" inputMode="decimal" placeholder="—" value={vitalsForm.fatPct}
                          onChange={e => setVitalsForm(f => ({ ...f, fatPct: e.target.value }))}
                          style={{ width: '100%', textAlign: 'center', background: 'var(--bg-primary)' }} />
                      </div>
                    )}
                    {vitalsKind === 'custom' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                        <div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>Показатель</div>
                          <input type="text" placeholder="Глюкоза, ЧСС покоя…" value={vitalsForm.customName}
                            onChange={e => setVitalsForm(f => ({ ...f, customName: e.target.value }))}
                            style={{ width: '100%', background: 'var(--bg-primary)' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>Значение</div>
                          <input type="number" inputMode="decimal" placeholder="—" value={vitalsForm.customValue}
                            onChange={e => setVitalsForm(f => ({ ...f, customValue: e.target.value }))}
                            style={{ width: '100%', textAlign: 'center', background: 'var(--bg-primary)' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>Ед.</div>
                          <input type="text" placeholder="ммоль/л" value={vitalsForm.customUnit}
                            onChange={e => setVitalsForm(f => ({ ...f, customUnit: e.target.value }))}
                            style={{ width: '100%', textAlign: 'center', background: 'var(--bg-primary)' }} />
                        </div>
                      </div>
                    )}
                    {vitalsKind === 'sym' && (
                      <div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                          Тап по симптому — записывается сразу, дата и время ставятся автоматически
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                          {SYMPTOM_PRESETS.map(sym => (
                            <button key={sym}
                              onClick={() => addSymptomEntry(sym)}
                              style={{
                                padding: '8px 12px', borderRadius: '14px', cursor: 'pointer', fontSize: '12px',
                                background: 'var(--bg-primary)', border: '1px solid var(--border)',
                                color: 'var(--text-primary)', fontWeight: 500,
                              }}>{sym}</button>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input type="text" placeholder="Свой симптом…" value={vitalsForm.customName}
                            onChange={e => setVitalsForm(f => ({ ...f, customName: e.target.value }))}
                            style={{ flex: 1, background: 'var(--bg-primary)', fontSize: '13px' }} />
                          <button
                            onClick={() => addSymptomEntry(vitalsForm.customName)}
                            style={{ padding: '0 18px', background: 'var(--yellow)', border: 'none', borderRadius: '12px', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
                          >
                            <Check size={16} strokeWidth={3} />
                          </button>
                        </div>
                      </div>
                    )}
                    {vitalsKind !== 'sym' && (<>
                    {/* Теги контекста */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                      {['до тренировки', 'после тренировки', 'левая рука', 'правая рука', 'сидя', 'лёжа', 'утро', 'вечер'].map(t2 => (
                        <button key={t2}
                          onClick={() => setVitalsForm(f => ({ ...f, tags: f.tags.includes(t2) ? f.tags.filter(x => x !== t2) : [...f.tags, t2] }))}
                          style={{
                            padding: '6px 10px', borderRadius: '14px', cursor: 'pointer', fontSize: '11px',
                            background: vitalsForm.tags.includes(t2) ? 'var(--yellow)' : 'var(--bg-primary)',
                            border: '1px solid ' + (vitalsForm.tags.includes(t2) ? 'var(--yellow)' : 'var(--border)'),
                            color: vitalsForm.tags.includes(t2) ? '#fff' : 'var(--text-secondary)',
                            fontWeight: vitalsForm.tags.includes(t2) ? 700 : 500,
                          }}>{t2}</button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input type="text" placeholder="Заметка (необязательно)" value={vitalsForm.note}
                        onChange={e => setVitalsForm(f => ({ ...f, note: e.target.value }))}
                        style={{ flex: 1, background: 'var(--bg-primary)', fontSize: '13px' }} />
                      <button
                        onClick={addVitalEntry}
                        style={{ padding: '0 18px', background: 'var(--yellow)', border: 'none', borderRadius: '12px', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
                      >
                        <Check size={16} strokeWidth={3} />
                      </button>
                    </div>
                    </>)}
                  </div>
                )}

                {vitals.length === 0 && !vitalsKind ? (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Выбери прибор или симптом. Давление, кислород, состав тела — вбей значения;
                    симптом (головная боль, жидкий стул…) просто тапни — дата и время встанут сами.
                  </div>
                ) : vitals.slice(0, 30).map(v => {
                  const d = new Date(v.at);
                  return (
                    <div key={v.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px',
                      padding: '10px 0', borderBottom: '1px solid var(--border)'
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: 700, display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          {v.systolic !== undefined && v.diastolic !== undefined && (
                            <span style={{ color: (v.systolic >= 140 || v.diastolic >= 90) ? 'var(--red)' : (v.systolic >= 130 || v.diastolic >= 85) ? 'var(--yellow)' : 'var(--text-primary)' }}>
                              {v.systolic}/{v.diastolic}
                            </span>
                          )}
                          {v.pulse !== undefined && <span style={{ color: 'var(--blue)' }}>♥ {v.pulse}</span>}
                          {v.spo2 !== undefined && <span style={{ color: v.spo2 < 94 ? 'var(--red)' : 'var(--green)' }}>SpO2 {v.spo2}%</span>}
                          {v.fatPct !== undefined && <span style={{ color: 'var(--purple)' }}>жир {v.fatPct}%</span>}
                          {v.symptom && <span style={{ color: 'var(--orange)' }}>{v.symptom}</span>}
                          {v.customValue !== undefined && (
                            <span style={{ color: 'var(--text-primary)' }}>{v.customName || 'показатель'}: {v.customValue}{v.customUnit ? ' ' + v.customUnit : ''}</span>
                          )}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                          {d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, {d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                          {v.tags.length ? ' · ' + v.tags.join(', ') : ''}
                          {v.note ? ' · ' + v.note : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => saveVitals(vitals.filter(x => x.id !== v.id))}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', flexShrink: 0 }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Measurements List */}
              {bodyMeasurements.length === 0 ? (
                <div style={{
                  padding: '40px 20px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  background: 'var(--bg-card)',
                  borderRadius: '16px',
                  border: '1px solid var(--border)'
                }}>
                  <Ruler size={40} style={{ opacity: 0.3, marginBottom: '12px' }} />
                  <div style={{ fontSize: '14px', marginBottom: '4px' }}>
                    {t('noMeasurements')}
                  </div>
                  <div style={{ fontSize: '12px' }}>
                    {t('addFirst')}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {bodyMeasurements.slice().reverse().map((m) => (
                    <div key={m.id} style={{
                      background: 'var(--bg-card)',
                      borderRadius: '12px',
                      padding: '10px 14px',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px'
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'baseline', fontSize: '13px', fontWeight: 600 }}>
                          <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, minWidth: '58px' }}>
                            {new Date(m.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' })}
                          </span>
                          {m.weight ? <span style={{ color: 'var(--yellow)' }}>{m.weight} кг</span> : null}
                          {m.waist ? <span><span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px' }}>талия </span>{m.waist}</span> : null}
                          {m.chest ? <span><span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px' }}>грудь </span>{m.chest}</span> : null}
                          {m.biceps ? <span><span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px' }}>бицепс </span>{m.biceps}</span> : null}
                          {m.bicepsLeft ? <span><span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px' }}>биц. Л </span>{m.bicepsLeft}</span> : null}
                          {m.bicepsRight ? <span><span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px' }}>биц. П </span>{m.bicepsRight}</span> : null}
                          {m.thighs ? <span><span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px' }}>бедро </span>{m.thighs}</span> : null}
                          {m.hips ? <span><span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px' }}>таз </span>{m.hips}</span> : null}
                        </div>
                        {m.notes && (
                          <div style={{ marginTop: '2px', fontSize: '11px', color: 'var(--text-secondary)', fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {m.notes}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => { setEditingMeasurement(m); setShowMeasurementModal(true); }}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '6px', flexShrink: 0 }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(t('deleteMeasurementConfirm') as string)) {
                            userMadeChangeRef.current = true;
                            setBodyMeasurements(prev => prev.filter(item => item.id !== m.id));
                          }
                        }}
                        style={{ background: 'transparent', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: '6px', flexShrink: 0 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PLANNER VIEW */}
        {view === 'planner' && (
          <div className="view-content">
            <PlannerView
              events={plannerEvents}
              onEventsChange={setPlannerEvents}
              habits={habits}
              onHabitsChange={(h) => { userMadeChangeRef.current = true; setHabits(h); }}
              todayStr={todayStr}
              lang={userSettings.language === 'ru' ? 'ru' : 'en'}
            />
          </div>
        )}

        {/* Под-навигация раздела «Я»: Профиль · Прогресс · Статистика.
            Переехала сюда из старого верхнего дропдауна. Показывается на всех
            трёх вложенных экранах. */}
        {(view === 'profile' || view === 'gains' || view === 'analytics') && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {([
              { key: 'profile',   icon: <Settings size={15} />,  label: t('settings') },
              { key: 'gains',     icon: <Scale size={15} />,     label: t('gains') },
              { key: 'analytics', icon: <BarChart3 size={15} />, label: t('statistics') },
            ] as { key: typeof view; icon: React.ReactNode; label: string }[]).map((sub) => (
              <button
                key={sub.key}
                className="btn-press"
                onClick={() => { setView(sub.key); localStorage.setItem('fitness_view', sub.key); }}
                style={{
                  flex: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  padding: '10px',
                  background: view === sub.key ? 'var(--yellow)' : 'var(--bg-elevated)',
                  border: view === sub.key ? 'none' : '1px solid var(--border)',
                  borderRadius: '12px',
                  color: view === sub.key ? '#fff' : 'var(--text-secondary)',
                  fontWeight: view === sub.key ? 700 : 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                {sub.icon}
                {sub.label}
              </button>
            ))}
          </div>
        )}

        {/* PROFILE VIEW */}
        {view === 'profile' && (
          <div className="view-content">
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <User size={20} />
                {t('profile')}
              </h2>

              {/* Avatar */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                marginBottom: '24px',
                padding: '24px',
                background: 'var(--bg-card)',
                borderRadius: '16px',
                border: '1px solid var(--border)'
              }}>
                <div style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--yellow), var(--orange))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '32px',
                  fontWeight: 700,
                  color: '#fff',
                  marginBottom: '12px'
                }}>
                  {userSettings.name?.[0]?.toUpperCase() || '👤'}
                </div>
                <div style={{ fontSize: '18px', fontWeight: 600 }}>{userSettings.name || 'User'}</div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{userSettings.email || 'fitness@app.local'}</div>
              </div>

              {/* Замеры и прогресс — перенесено из хедера */}
              <button
                onClick={() => { setView('gains'); localStorage.setItem('fitness_view', 'gains'); }}
                style={{
                  width: '100%',
                  marginBottom: '24px',
                  padding: '16px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '16px',
                  color: 'var(--text-primary)',
                  fontSize: '15px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  cursor: 'pointer'
                }}
              >
                <Ruler size={18} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
                {t('gains')}
                <ChevronRight size={18} style={{ marginLeft: 'auto', color: 'var(--text-muted)' }} />
              </button>

              {/* Цель питания — похудение / поддержание / набор. На неё
                  опираются ИИ-рекомендации «что и когда есть». */}
              <div style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: '16px', padding: '16px', marginBottom: '24px'
              }}>
                <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '12px' }}>
                  {userSettings.language === 'ru' ? 'Моя цель' : 'My goal'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {([
                    { key: 'lose' as const, ru: 'Похудение', en: 'Lose fat' },
                    { key: 'maintain' as const, ru: 'Поддержание', en: 'Maintain' },
                    { key: 'gain' as const, ru: 'Набор массы', en: 'Gain' },
                    { key: 'recomp' as const, ru: 'Атлетика (мышцы + сушка)', en: 'Recomp' },
                  ]).map(g => {
                    const active = (userSettings.goalType ?? 'maintain') === g.key;
                    return (
                      <button
                        key={g.key}
                        onClick={async () => {
                          setUserSettings(s => ({ ...s, goalType: g.key }));
                          await fetch('/api/settings', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ goalType: g.key })
                          });
                        }}
                        style={{
                          padding: '10px 4px',
                          background: active ? 'var(--yellow)' : 'var(--bg-elevated)',
                          border: '1px solid var(--border)', borderRadius: '10px',
                          color: active ? '#fff' : 'var(--text-secondary)',
                          fontWeight: active ? 700 : 500, fontSize: '12px', cursor: 'pointer'
                        }}
                      >
                        {userSettings.language === 'ru' ? g.ru : g.en}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* My Goal — per-user daily macro targets */}
              <GoalEditor
                goal={MACRO_TARGETS}
                language={userSettings.language}
                onSave={async (next) => {
                  setUserSettings(s => ({ ...s, goal: next }));
                  await fetch('/api/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ goal: next }),
                  });
                }}
              />

              {/* Settings */}
              <div style={{
                background: 'var(--bg-card)',
                borderRadius: '16px',
                border: '1px solid var(--border)',
                overflow: 'hidden'
              }}>
                {/* Language */}
                <div style={{
                  padding: '16px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Languages size={20} style={{ color: 'var(--blue)' }} />
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 600 }}>
                        {t('language')}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {userSettings.language === 'ru' ? t('russian') : t('english')}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={async () => {
                        const newLang = 'ru';
                        setUserSettings(s => ({ ...s, language: newLang }));
                        await fetch('/api/settings', {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ language: newLang })
                        });
                      }}
                      style={{
                        padding: '8px 12px',
                        background: userSettings.language === 'ru' ? 'var(--yellow)' : 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        color: userSettings.language === 'ru' ? '#fff' : 'var(--text-secondary)',
                        fontWeight: userSettings.language === 'ru' ? 700 : 500,
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      RU
                    </button>
                    <button
                      onClick={async () => {
                        const newLang = 'en';
                        setUserSettings(s => ({ ...s, language: newLang }));
                        await fetch('/api/settings', {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ language: newLang })
                        });
                      }}
                      style={{
                        padding: '8px 12px',
                        background: userSettings.language === 'en' ? 'var(--yellow)' : 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        color: userSettings.language === 'en' ? '#fff' : 'var(--text-secondary)',
                        fontWeight: userSettings.language === 'en' ? 700 : 500,
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      EN
                    </button>
                  </div>
                </div>

                {/* Theme */}
                <div style={{
                  padding: '16px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    {themePref === 'dark' ? (
                      <Moon size={20} style={{ color: 'var(--purple)' }} />
                    ) : themePref === 'light' ? (
                      <Sun size={20} style={{ color: 'var(--yellow)' }} />
                    ) : (
                      <MonitorSmartphone size={20} style={{ color: 'var(--text-secondary)' }} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600 }}>
                        {userSettings.language === 'ru' ? 'Тема' : 'Theme'}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {themePref === 'dark'
                          ? (userSettings.language === 'ru' ? 'Тёмная' : 'Dark')
                          : themePref === 'light'
                          ? (userSettings.language === 'ru' ? 'Светлая' : 'Light')
                          : (userSettings.language === 'ru' ? 'Авто (по времени)' : 'Auto (by time)')}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    {(['light', 'dark', 'auto'] as const).map(opt => {
                      const active = themePref === opt;
                      const Icon = opt === 'light' ? Sun : opt === 'dark' ? Moon : MonitorSmartphone;
                      return (
                        <button
                          key={opt}
                          onClick={async () => {
                            setUserSettings(s => ({ ...s, theme: opt }));
                            try {
                              await fetch('/api/settings', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ theme: opt })
                              });
                            } catch { /* offline — local state still applies */ }
                          }}
                          title={opt}
                          style={{
                            width: '36px', height: '36px',
                            background: active ? 'var(--yellow)' : 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            color: active ? '#fff' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          <Icon size={16} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Timezone */}
                <div style={{
                  padding: '16px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Globe size={20} style={{ color: 'var(--green)' }} />
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 600 }}>
                        {t('timezone')}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {userSettings.timezone}
                      </div>
                    </div>
                  </div>
                  <select
                    value={userSettings.timezone}
                    onChange={async (e) => {
                      const newTz = e.target.value;
                      setUserSettings(s => ({ ...s, timezone: newTz }));
                      await fetch('/api/settings', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ timezone: newTz })
                      });
                    }}
                    style={{
                      padding: '8px 12px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="Europe/Moscow">Moscow (UTC+3)</option>
                    <option value="Europe/Kiev">Kyiv (UTC+2)</option>
                    <option value="Europe/London">London (UTC+0)</option>
                    <option value="America/New_York">New York (UTC-5)</option>
                    <option value="America/Los_Angeles">Los Angeles (UTC-8)</option>
                    <option value="Asia/Dubai">Dubai (UTC+4)</option>
                    <option value="Asia/Tokyo">Tokyo (UTC+9)</option>
                  </select>
                </div>

                {/* Logout */}
                <button
                  onClick={() => {
                    if (confirm(t('signOutConfirm') as string)) {
                      localStorage.clear();
                      signOut({ callbackUrl: '/login' });
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '16px',
                    background: 'none',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: 'pointer',
                    color: 'var(--red)'
                  }}
                >
                  <LogOut size={20} />
                  <span style={{ fontSize: '14px', fontWeight: 600 }}>
                    {t('signOut')}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CHAT VIEW — AI-ассистент как полноэкранная вкладка */}
        {view === 'chat' && (
          <div className="view-content" style={{ height: 'calc(100vh - 200px)' }}>
            <AssistantChat />
          </div>
        )}

        {/* LABS VIEW — анализы: загрузка, парсинг, динамика */}
        {view === 'labs' && <LabsView />}

        {/* Лого — красивый текст TRAINX внизу страницы */}
        <div style={{ textAlign: 'center', padding: '32px 0 4px', userSelect: 'none' }}>
          <span style={{
            fontSize: '30px',
            fontWeight: 900,
            letterSpacing: '8px',
            paddingLeft: '8px',
            background: 'linear-gradient(120deg, var(--accent) 0%, var(--accent-warm) 55%, #ffb46b 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            fontStyle: 'italic'
          }}>TRAINX</span>
        </div>
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
                date: dateValue ? new Date(dateValue).toISOString() : new Date().toISOString(),
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
                  defaultValue={editingMeasurement ? new Date(editingMeasurement.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}
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
                <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                  <button
                    onClick={() => setProgramProposal(null)}
                    style={{
                      flex: 1, padding: '13px', background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)', borderRadius: '12px',
                      color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer'
                    }}
                  >Отклонить</button>
                  <button
                    onClick={acceptProgram}
                    style={{
                      flex: 1.4, padding: '13px', background: 'var(--green)',
                      border: 'none', borderRadius: '12px',
                      color: '#fff', fontWeight: 700, cursor: 'pointer'
                    }}
                  >Принять программу</button>
                </div>
              </div>
            )}

            {/* История программ */}
            {programArchive.length > 0 && (
              <div style={{ marginTop: '18px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '8px' }}>
                  История программ
                </div>
                {programArchive.map(p => (
                  <div key={p.id} style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: '12px', padding: '12px 14px', marginBottom: '8px'
                  }}>
                    <div
                      onClick={() => setExpandedArchiveId(prev => prev === p.id ? null : p.id)}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', gap: '8px' }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>{p.label}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {p.workouts.filter(w => w.exercises.length > 0).length} тренировок ·{' '}
                          {new Date(p.archivedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
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
                ))}
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
                  <Sparkles size={20} style={{ color: '#fff' }} />
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
        <div
          onClick={() => { setImageModal(null); document.body.style.overflow = ''; }}
          onTouchMove={e => e.preventDefault()}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, padding: '40px', touchAction: 'none',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '400px', width: '100%' }}>
            <img src={imageModal.url} alt={imageModal.name} style={{ width: '100%', borderRadius: '12px', objectFit: 'contain', pointerEvents: 'none' }} />
            <div style={{ textAlign: 'center', marginTop: '8px', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 600 }}>{imageModal.name}</div>
            <button onClick={() => { setImageModal(null); document.body.style.overflow = ''; }} style={{
              position: 'absolute', top: '-12px', right: '-12px',
              width: '32px', height: '32px', borderRadius: '50%',
              background: '#fff', border: 'none', color: '#000',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
            }}><X size={16} /></button>
          </div>
        </div>
      )}

      {/* Нижняя навигация: основное меню-капсула + отдельная капсула AI-чата справа */}
      <nav style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 90,
        display: 'flex',
        alignItems: 'stretch',
        gap: '10px',
        maxWidth: '600px',
        margin: '0 auto',
        padding: '0 12px',
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
      }}>
        {/* Капсула с основными вкладками */}
        <div style={{
          flex: 1,
          display: 'flex',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: '27px',
          padding: '6px 8px',
          boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        }}>
          {([
            { key: 'workout',   icon: <Dumbbell size={22} />,     label: String(t('workout')) },
            { key: 'nutrition', icon: <Apple size={22} />,        label: String(t('food')) },
            ...(userSettings.email !== 'dmitriheadshot@friend.local'
              ? [{ key: 'planner' as typeof view, icon: <CalendarDays size={22} />, label: userSettings.language === 'ru' ? 'Дела' : 'Plan' }]
              : []),
            { key: 'labs' as typeof view, icon: <FlaskConical size={22} />, label: userSettings.language === 'ru' ? 'Анализы' : 'Labs' },
          ] as { key: typeof view; icon: React.ReactNode; label: string }[]).map((tab) => {
            // «Я» подсвечивается также на вложенных экранах (статистика, прогресс)
            const isActive = tab.key === 'profile'
              ? (view === 'profile' || view === 'gains' || view === 'analytics')
              : view === tab.key;
            return (
              <button
                key={tab.key}
                className="btn-press"
                onClick={() => { setView(tab.key); localStorage.setItem('fitness_view', tab.key); setShowProfileDropdown(false); }}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '3px', padding: '8px 4px', background: 'transparent', border: 'none', cursor: 'pointer',
                  color: isActive ? '#222222' : '#b3b3b3',
                  fontWeight: isActive ? 700 : 500, fontSize: '11px', transition: 'color 0.15s ease',
                }}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Отдельная капсула AI-чата справа — в одном стиле с капсулой меню,
            внутри мозг (Brain) в лёгком оранжевом */}
        <button
          className="btn-press"
          onClick={() => { setView('chat'); localStorage.setItem('fitness_view', 'chat'); setShowProfileDropdown(false); }}
          aria-label="AI-ассистент"
          style={{
            flexShrink: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '3px', padding: '6px 26px',
            borderRadius: '27px', cursor: 'pointer',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
            transition: 'transform 0.15s ease',
            transform: view === 'chat' ? 'scale(1.03)' : 'scale(1)',
          }}
        >
          <Brain size={22} style={{ color: view === 'chat' ? 'var(--yellow)' : 'var(--accent-warm, #ff7a52)' }} />
          <span style={{
            fontSize: '11px',
            fontWeight: view === 'chat' ? 700 : 500,
            color: view === 'chat' ? '#222222' : '#b3b3b3'
          }}>AI</span>
        </button>
      </nav>
    </main>
  );
}

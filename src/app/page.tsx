'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { signOut } from 'next-auth/react';
import {
  Plus, X, Dumbbell, Apple, ChevronLeft, ChevronRight, Check,
  Target, TrendingUp, Edit2, Trash2, Save, ChevronDown,
  ChevronUp, Calendar, Cloud, CloudOff, Footprints, History,
  Zap, Timer, Play, Pause, RotateCcw, Settings, User, LogOut,
  Heart, BarChart3, Scale, Ruler, Globe, Languages, Pencil,
  Camera, ScanLine, Video, ExternalLink, Sparkles, CalendarDays
} from 'lucide-react';
import PlannerView, { PlannerEvent } from './PlannerView';

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

  // Play beep sound
  const playBeep = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;

      // Play 3 beeps
      [0, 200, 400].forEach((delay) => {
        setTimeout(() => {
          const oscillator = ctx.createOscillator();
          const gainNode = ctx.createGain();
          oscillator.connect(gainNode);
          gainNode.connect(ctx.destination);
          oscillator.frequency.value = 880; // A5 note
          oscillator.type = 'sine';
          gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
          oscillator.start(ctx.currentTime);
          oscillator.stop(ctx.currentTime + 0.15);
        }, delay);
      });
    } catch (e) {
      console.log('Audio not supported');
    }
  }, []);

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
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '8px'
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
            ? 'var(--lime)'
            : isRunning
              ? 'var(--red-dim)'
              : 'var(--lime-dim)',
          border: `1px solid ${isFinished ? 'var(--lime)' : isRunning ? 'rgba(255, 107, 107, 0.3)' : 'rgba(255, 232, 4, 0.3)'}`,
          borderRadius: '10px',
          color: isFinished ? '#000' : isRunning ? 'var(--red)' : 'var(--lime)',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 700,
          minWidth: '100px',
          boxShadow: isFinished ? '0 4px 20px var(--yellow-glow)' : 'none',
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
            background: timeLeft < 10 ? 'var(--red)' : 'var(--lime)',
            borderRadius: '3px',
            transition: 'width 1s linear'
          }} />
        </div>
      )}
    </div>
  );
}

// Types
interface Exercise {
  id: string;
  name: string;
  plannedSets: string;
  actualSets: string;
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
  isFavorite?: boolean;
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

interface UserSettings {
  language: 'ru' | 'en';
  timezone: string;
  name?: string;
  email?: string;
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

const MACRO_TARGETS = {
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
function ExerciseCard({ ex, idx, onToggle, onUpdate, progressHistory, exerciseLibrary, onImageSaved, dayClosed }: {
  ex: Exercise;
  idx: number;
  onToggle: () => void;
  onUpdate: (updates: Partial<Exercise>) => void;
  progressHistory: ExerciseProgress[];
  exerciseLibrary?: Record<string, string>;
  onImageSaved?: (name: string, imageUrl: string) => void;
  dayClosed?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [videoUrlInput, setVideoUrlInput] = useState(ex.videoUrl || '');
  const [showImageFull, setShowImageFull] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Auto-collapse when day closes
  useEffect(() => {
    if (dayClosed) setExpanded(false);
  }, [dayClosed]);


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
        {/* Checkbox - left side */}
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
          {!ex.completed && (
            <div style={{
              fontSize: '12px',
              color: 'var(--blue)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginTop: '2px'
            }}>
              <Zap size={11} />
              {ex.plannedSets}
              {ex.notes && (
                <span style={{ color: 'var(--yellow)', marginLeft: '4px' }}>• {ex.notes}</span>
              )}
            </div>
          )}
        </div>

        {/* Chevron for all items */}
        <div style={{
          color: 'var(--text-muted)',
          transition: 'transform 0.2s ease',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0)'
        }}>
          <ChevronDown size={18} />
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
                <span style={{ color: 'var(--yellow)', fontWeight: 600 }}>{ex.newWeight}</span>
              </div>
            )}
            {ex.feedback && (
              <div style={{ marginTop: '6px', color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '11px' }}>
                "{ex.feedback}"
              </div>
            )}
          </div>

          {/* Image for completed */}
          {ex.imageUrl && (
            <div style={{ marginBottom: '8px' }}>
              <img src={ex.imageUrl} alt={ex.name} onClick={() => setShowImageFull(true)}
                style={{ width: '100%', borderRadius: '8px', cursor: 'pointer', maxHeight: '120px', objectFit: 'cover' }} />
            </div>
          )}

          {/* Video icon for completed */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '10px'
          }}>
            <div
              onClick={() => {
                setVideoUrlInput(ex.videoUrl || '');
                setShowVideoModal(true);
              }}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: ex.videoUrl ? 'var(--blue-dim)' : 'var(--bg-elevated)',
                border: ex.videoUrl ? '1px solid rgba(0, 180, 216, 0.3)' : '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <Video size={14} style={{ color: ex.videoUrl ? 'var(--blue)' : 'var(--text-muted)' }} />
            </div>
          </div>

        </div>
      )}

      {/* Expanded content - only for incomplete exercises */}
      {expanded && !ex.completed && (
        <div style={{
          padding: '0 12px 12px',
          borderTop: '1px solid var(--border)',
          animation: 'slideUp 0.2s ease'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '10px' }}>
            <div>
              <label style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Вес
                {progressHistory.length > 0 && (
                  <span style={{
                    fontSize: '10px',
                    color: 'var(--blue)',
                    fontWeight: 500,
                    textTransform: 'none',
                    letterSpacing: 'normal'
                  }}>
                    (пред: {progressHistory[progressHistory.length - 1].weight})
                  </span>
                )}
              </label>
              <input
                type="text"
                value={ex.actualSets}
                onChange={(e) => onUpdate({ actualSets: e.target.value })}
                placeholder={progressHistory.length > 0 ? progressHistory[progressHistory.length - 1].weight : "0 кг"}
                style={{
                  width: '100%',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '8px 10px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              />
            </div>
            <div>
              <label style={{
                fontSize: '10px',
                color: 'var(--yellow)',
                display: 'block',
                marginBottom: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Новый вес
              </label>
              <input
                type="text"
                value={ex.newWeight || ''}
                onChange={(e) => onUpdate({ newWeight: e.target.value })}
                placeholder="Повысить до..."
                style={{
                  width: '100%',
                  background: 'var(--yellow-dim)',
                  border: '1px solid rgba(251, 191, 36, 0.3)',
                  borderRadius: '8px',
                  padding: '8px 10px',
                  color: 'var(--yellow)',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              />
            </div>
          </div>

          <div style={{ marginTop: '8px' }}>
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
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={ex.feedback}
                onChange={(e) => onUpdate({ feedback: e.target.value })}
                placeholder="Заметки..."
                style={{
                  flex: 1,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '8px 10px',
                  color: 'var(--text-primary)',
                  fontSize: '12px'
                }}
              />
              {/* Video icon */}
              <div
                onClick={() => {
                  setVideoUrlInput(ex.videoUrl || '');
                  setShowVideoModal(true);
                }}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: ex.videoUrl ? 'var(--blue-dim)' : 'var(--bg-elevated)',
                  border: ex.videoUrl ? '1px solid rgba(0, 180, 216, 0.3)' : '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                <Video size={14} style={{ color: ex.videoUrl ? 'var(--blue)' : 'var(--text-muted)' }} />
              </div>
              {/* Photo icon */}
              <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
              <div
                onClick={() => imageInputRef.current?.click()}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: ex.imageUrl ? 'rgba(168, 85, 247, 0.1)' : 'var(--bg-elevated)',
                  border: ex.imageUrl ? '1px solid rgba(168, 85, 247, 0.3)' : '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                <Camera size={14} style={{ color: ex.imageUrl ? '#a855f7' : 'var(--text-muted)' }} />
              </div>
            </div>
          </div>

          {/* Exercise image preview */}
          {ex.imageUrl && (
            <div style={{ marginTop: '8px', position: 'relative' }}>
              <img
                src={ex.imageUrl}
                alt={ex.name}
                onClick={() => setShowImageFull(true)}
                style={{ width: '100%', borderRadius: '8px', cursor: 'pointer', maxHeight: '150px', objectFit: 'cover' }}
              />
              <button
                onClick={() => onUpdate({ imageUrl: undefined })}
                style={{
                  position: 'absolute', top: '6px', right: '6px',
                  width: '24px', height: '24px', borderRadius: '6px',
                  background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                }}
              >
                <X size={12} />
              </button>
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
        </div>
      )}

      {/* Video Modal */}
      {/* Fullscreen image modal */}
      {showImageFull && ex.imageUrl && (
        <div
          onClick={() => setShowImageFull(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '20px', cursor: 'pointer'
          }}
        >
          <img src={ex.imageUrl} alt={ex.name} style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: '12px', objectFit: 'contain' }} />
        </div>
      )}

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
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: '20px',
      border: '1px solid var(--border)',
      overflow: 'hidden'
    }}>
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
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '10px 14px',
              cursor: 'pointer',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <ChevronLeft size={18} />
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
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '10px 14px',
              cursor: 'pointer',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Month stats */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '12px'
        }}>
          <div style={{
            background: 'var(--green-dim)',
            padding: '12px',
            borderRadius: '12px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--green)' }}>
              {monthStats.workoutDays}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
              тренировок
            </div>
          </div>
          <div style={{
            background: 'var(--blue-dim)',
            padding: '12px',
            borderRadius: '12px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--blue)' }}>
              {Math.round(monthStats.totalSteps / 1000)}K
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
              шагов
            </div>
          </div>
          <div style={{
            background: 'rgba(59, 130, 246, 0.15)',
            padding: '12px',
            borderRadius: '12px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: 'rgb(59, 130, 246)' }}>
              {monthStats.stepDays > 0 ? Math.round(monthStats.totalSteps / monthStats.stepDays) : 0}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
              ср. шагов
            </div>
          </div>
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
          const hasWorkout = log?.dayClosed && !isOffDay;
          const hasSteps = log?.steps && log.steps > 0 && !hasWorkout && !isOffDay;

          // Незакрытый прошлый день (не сегодня, не будущий, не закрыт)
          const isUnclosedPastDay = !isFuture && !isToday && !log?.dayClosed && !isOffDay;

          // Get completed workout label
          const completedWorkoutId = log?.workoutCompleted;
          const completedWorkout = completedWorkoutId
            ? workouts.find(w => w.id === completedWorkoutId)
            : null;
          const workoutLabel = completedWorkout
            ? completedWorkout.name.replace('Тренировка ', 'T')
            : isOffDay ? '😴' : null;

          // Определяем стиль фона
          const getBackground = () => {
            if (isSelected && isToday) return 'linear-gradient(135deg, var(--yellow) 0%, var(--green) 100%)';
            if (isSelected) return 'var(--yellow)';
            if (isToday) return 'linear-gradient(135deg, rgba(255, 193, 7, 0.3) 0%, rgba(0, 200, 83, 0.2) 100%)';
            if (hasWorkout) return 'var(--green-dim)';
            if (isOffDay) return 'rgba(147, 112, 219, 0.15)';
            if (isUnclosedPastDay) return 'rgba(255, 255, 255, 0.03)'; // Grey dim for unclosed
            if (hasSteps) return 'var(--blue-dim)';
            if (isFuture) return 'transparent';
            return 'transparent';
          };

          // Определяем цвет текста
          const getColor = () => {
            if (isSelected && isToday) return '#000';
            if (isSelected) return '#000';
            if (isToday) return 'var(--yellow)';
            if (hasWorkout) return 'var(--green)';
            if (isOffDay) return 'rgb(147, 112, 219)';
            if (isUnclosedPastDay) return 'rgba(239, 68, 68, 0.25)';
            if (isFuture) return 'var(--text-muted)';
            return 'var(--text-primary)';
          };

          // Parse date correctly to avoid timezone issues
          const [year, month, dayNum] = d.dateStr.split('-').map(Number);
          const clickDate = new Date(year, month - 1, dayNum);

          // Определяем border
          const getBorder = () => {
            if (isToday && isSelected) return '2px solid var(--green)';
            if (isToday) return '2px solid var(--yellow)';
            if (isUnclosedPastDay && !isSelected) return '1px solid rgba(255, 255, 255, 0.05)';
            if (hasWorkout && !isSelected) return '1px solid rgba(0, 200, 83, 0.3)';
            if (isOffDay && !isSelected) return '1px solid rgba(147, 112, 219, 0.3)';
            return '1px solid transparent';
          };

          // Определяем boxShadow
          const getBoxShadow = () => {
            if (isSelected && isToday) return '0 4px 20px rgba(0, 200, 83, 0.4)';
            if (isSelected) return '0 4px 20px var(--yellow-glow)';
            if (isToday) return '0 2px 12px rgba(255, 193, 7, 0.3)';
            if (hasWorkout) return '0 2px 8px var(--green-glow)';
            if (isOffDay) return '0 2px 8px rgba(147, 112, 219, 0.2)';
            if (isUnclosedPastDay) return 'none';
            return 'none';
          };

          return (
            <button
              key={d.day}
              onClick={() => onSelectDate(clickDate)}
              style={{
                aspectRatio: '1',
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
                fontWeight: isUnclosedPastDay ? 400 : (isToday || isSelected || hasWorkout || isOffDay ? 700 : 500),
                fontSize: '14px',
                transition: 'all 0.2s ease',
                boxShadow: getBoxShadow(),
                opacity: isFuture ? 0.4 : 1
              }}
            >
              <span>{d.day}</span>
              {isToday && !isSelected ? (
                <span style={{ fontSize: '8px', color: 'var(--yellow)' }}>сегодня</span>
              ) : hasWorkout ? (
                <span style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  color: isSelected ? '#000' : 'var(--green)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1px'
                }}>
                  <Check size={8} strokeWidth={3} />
                  {workoutLabel}
                </span>
              ) : isOffDay ? (
                <span style={{ fontSize: '10px' }}>😴</span>
              ) : isUnclosedPastDay ? (
                <span style={{ fontSize: '9px', fontWeight: 700, color: 'rgba(239, 68, 68, 0.3)' }}>!</span>
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
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11px',
          color: 'var(--text-muted)'
        }}>
          <div style={{
            width: '14px',
            height: '14px',
            borderRadius: '4px',
            background: 'var(--green-dim)',
            border: '1px solid rgba(0, 200, 83, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Check size={8} strokeWidth={3} style={{ color: 'var(--green)' }} />
          </div>
          Закрыто
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11px',
          color: 'var(--text-muted)'
        }}>
          <div style={{
            width: '14px',
            height: '14px',
            borderRadius: '4px',
            background: 'var(--blue-dim)',
            border: '1px solid rgba(0, 180, 216, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--blue)' }} />
          </div>
          Шаги
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11px',
          color: 'var(--text-muted)'
        }}>
          <div style={{
            width: '14px',
            height: '14px',
            borderRadius: '4px',
            border: '2px solid var(--yellow)',
            background: 'linear-gradient(135deg, rgba(255, 193, 7, 0.3) 0%, rgba(0, 200, 83, 0.2) 100%)'
          }} />
          Сегодня
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11px',
          color: 'var(--text-muted)'
        }}>
          <div style={{
            width: '14px',
            height: '14px',
            borderRadius: '4px',
            border: '1px solid rgba(239, 68, 68, 0.5)',
            background: 'rgba(239, 68, 68, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '9px',
            color: 'var(--red)',
            fontWeight: 700
          }}>!</div>
          Не закрыто
        </div>
      </div>
    </div>
  );
}

// Default workout selection - user picks manually, default to T1
function getDefaultWorkout(): string {
  return 't1';
}

export default function FitnessPage() {
  const [view, setView] = useState<'workout' | 'nutrition' | 'analytics' | 'gains' | 'profile' | 'planner'>('workout');
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

  // Night mode - apply to body to avoid hydration issues
  useEffect(() => {
    const checkNightMode = () => {
      const hour = new Date().getHours();
      const isNight = hour >= 22 || hour < 6;
      setIsNightMode(isNight);

      if (isNight) {
        document.body.classList.add('night-mode');
      } else {
        document.body.classList.remove('night-mode');
      }
    };

    checkNightMode();
    const interval = setInterval(checkNightMode, 60000);
    return () => {
      clearInterval(interval);
      document.body.classList.remove('night-mode');
    };
  }, []);
  const [workouts, setWorkouts] = useState<Workout[]>(DEFAULT_WORKOUTS);
  const [selectedWorkout, setSelectedWorkout] = useState<string>(() => getDefaultWorkout());
  const [dayLogs, setDayLogs] = useState<Record<string, DayLog>>({});
  const [showMealModal, setShowMealModal] = useState(false);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [mealForm, setMealForm] = useState({ time: '', name: '', protein: '', fat: '', carbs: '', calories: '' });
  const [showMealSuggestions, setShowMealSuggestions] = useState(false);
  const [isAnalyzingFood, setIsAnalyzingFood] = useState(false);
  const [foodAnalysisError, setFoodAnalysisError] = useState<string | null>(null);
  const [showScanOptions, setShowScanOptions] = useState(false);
  const [foodHint, setFoodHint] = useState('');
  const [streakDetailDate, setStreakDetailDate] = useState<string | null>(null);
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
  const plannerLoadedFromServer = useRef(false);
  const plannerUserChanged = useRef(false);
  const setPlannerEvents = useCallback((events: PlannerEvent[]) => {
    if (plannerLoadedFromServer.current) {
      plannerUserChanged.current = true;
    }
    setPlannerEventsRaw(events);
  }, []);
  const [showMeasurementModal, setShowMeasurementModal] = useState(false);
  const [editingMeasurement, setEditingMeasurement] = useState<BodyMeasurement | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings>({ language: 'ru', timezone: 'Europe/Moscow' });
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [offDayHoldProgress, setOffDayHoldProgress] = useState(0);
  const offDayHoldRef = useRef<NodeJS.Timeout | null>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const serverDataLoadedRef = useRef(false);
  const [nutritionRecommendations, setNutritionRecommendations] = useState<NutritionRecommendation[] | null>(null);
  const [showNightMealPrompt, setShowNightMealPrompt] = useState(false);
  const [pendingMealData, setPendingMealData] = useState<Meal | null>(null);

  // Translation helper
  const t = (key: keyof typeof translations.ru) => translations[userSettings.language][key];
  const stepsAlertRef = useRef<HTMLDivElement | null>(null);
  const profileDropdownRef = useRef<HTMLDivElement | null>(null);

  const dateKey = formatDate(selectedDate);

  // Load data from server or localStorage
  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch('/api/fitness');
        if (response.ok) {
          const data = await response.json();
          if (data.exerciseLibrary) setExerciseLibrary(data.exerciseLibrary);
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
          if (data.dayLogs) setDayLogs(data.dayLogs);
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
          return;
        }
      } catch (e) {
        console.error('Failed to load from server:', e);
      }

      // No localStorage fallback - all data must come from server
      setIsLoaded(true);
    };
    loadData();
  }, []);

  // Poll for planner updates from Telegram bot (every 10s)
  useEffect(() => {
    if (!isLoaded) return;
    const interval = setInterval(async () => {
      if (plannerUserChanged.current) return; // skip if user is editing
      try {
        const response = await fetch('/api/fitness');
        if (response.ok) {
          const data = await response.json();
          if (data.plannerEvents) {
            setPlannerEventsRaw(data.plannerEvents);
          }
        }
      } catch { /* silent */ }
    }, 10000);
    return () => clearInterval(interval);
  }, [isLoaded]);

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

  // Sync to server with debounce
  const exerciseLibraryRef = useRef(exerciseLibrary);
  exerciseLibraryRef.current = exerciseLibrary;

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
      const response = await fetch('/api/fitness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        setSyncStatus('synced');
      } else {
        setSyncStatus('error');
      }
    } catch (e) {
      console.error('Failed to sync to server:', e);
      setSyncStatus('error');
    }
  }, []);

  // Sync directly to server (with small debounce to batch rapid changes)
  useEffect(() => {
    if (!isLoaded || !serverDataLoadedRef.current) return;

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    // Small debounce (500ms) to batch rapid changes, but sync quickly
    syncTimeoutRef.current = setTimeout(() => {
      syncToServer(workouts, dayLogs, progressHistory, bodyMeasurements, plannerEvents);
    }, 500);

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [workouts, dayLogs, progressHistory, bodyMeasurements, plannerEvents, isLoaded, syncToServer]);

  const currentDayLog = useMemo(() => {
    return dayLogs[dateKey] || { date: dateKey, selectedWorkout: null, workoutCompleted: null, workoutRating: null, workoutSnapshot: null, workoutDraft: null, meals: [], notes: '', steps: null, dayClosed: false, isOffDay: false };
  }, [dayLogs, dateKey]);

  const macroTotals = useMemo(() => {
    const totals = { protein: 0, fat: 0, carbs: 0, calories: 0 };
    for (const meal of currentDayLog.meals) {
      totals.protein += meal.protein;
      totals.fat += meal.fat;
      totals.carbs += meal.carbs;
      totals.calories += meal.calories;
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
  const { last7Days, nutritionStreak } = useMemo(() => {
    // Don't calculate until todayStr is initialized on client
    if (!todayStr) {
      return { last7Days: [], nutritionStreak: 0 };
    }

    // Check if day meets macro targets (>= 80% for all macros)
    const isDayCompleted = (dateStr: string): boolean => {
      const log = dayLogs[dateStr];
      if (!log?.meals || log.meals.length === 0) return false;

      const totals = { protein: 0, fat: 0, carbs: 0, calories: 0 };
      for (const meal of log.meals) {
        totals.protein += meal.protein;
        totals.fat += meal.fat;
        totals.carbs += meal.carbs;
        totals.calories += meal.calories;
      }

      // Day is "completed" if average macro completion >= 70%
      const proteinPct = totals.protein / MACRO_TARGETS.protein;
      const fatPct = totals.fat / MACRO_TARGETS.fat;
      const carbsPct = totals.carbs / MACRO_TARGETS.carbs;
      const caloriesPct = totals.calories / MACRO_TARGETS.calories;
      const avgCompletion = (proteinPct + fatPct + carbsPct + caloriesPct) / 4;

      return avgCompletion >= 0.7; // 70% average across all macros
    };

    // Build current week array (Monday -> Sunday)
    // Parse todayStr to get today's date
    const [year, month, day] = todayStr.split('-').map(Number);
    const today = new Date(year, month - 1, day);
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);

    const days: { date: string; dayName: string; completed: boolean; isToday: boolean; isFuture: boolean }[] = [];
    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const dateStr = formatDate(date);
      const isToday = dateStr === todayStr;
      const isFuture = dateStr > todayStr;
      days.push({
        date: dateStr,
        dayName: dayNames[i],
        completed: isFuture ? false : isDayCompleted(dateStr),
        isToday,
        isFuture
      });
    }

    // Count streak (consecutive completed days from today/yesterday backward)
    let streak = 0;
    const todayIndex = days.findIndex(d => d.isToday);
    // If today is complete, include it; otherwise start from yesterday
    const startIndex = todayIndex >= 0 && days[todayIndex].completed ? todayIndex : todayIndex - 1;
    for (let i = startIndex; i >= 0; i--) {
      if (days[i].completed) {
        streak++;
      } else {
        break;
      }
    }

    return { last7Days: days, nutritionStreak: streak };
  }, [dayLogs, todayStr]);

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

  const updateDayLog = (updates: Partial<DayLog>) => {
    setDayLogs(prev => {
      const existingLog = prev[dateKey] || { date: dateKey, selectedWorkout: null, workoutCompleted: null, workoutRating: null, workoutSnapshot: null, workoutDraft: null, meals: [], notes: '', steps: null, dayClosed: false, isOffDay: false };
      return {
        ...prev,
        [dateKey]: { ...existingLog, ...updates }
      };
    });
  };

  // Select workout and save to dayLog
  const selectWorkout = (workoutId: string) => {
    setSelectedWorkout(workoutId);
    updateDayLog({ selectedWorkout: workoutId });
  };

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

  // Restore selected workout when date changes
  useEffect(() => {
    if (currentDayLog.dayClosed && currentDayLog.workoutCompleted) {
      // If day is closed, show the completed workout (snapshot)
      setSelectedWorkout(currentDayLog.workoutCompleted);
    } else if (currentDayLog.workoutDraft) {
      // Day is open but has a saved draft — restore exercise state from draft
      setWorkouts(prev => prev.map(w =>
        w.id === currentDayLog.workoutDraft!.workoutId
          ? { ...w, exercises: currentDayLog.workoutDraft!.exercises }
          : { ...w, exercises: w.exercises.map(e => ({ ...e, completed: false, actualSets: '', feedback: '' })) }
      ));
      setSelectedWorkout(currentDayLog.workoutDraft.workoutId);
    } else {
      // Day is NOT closed, no draft — reset all exercise completion flags to fresh state
      setWorkouts(prev => prev.map(w => ({
        ...w,
        exercises: w.exercises.map(e => ({ ...e, completed: false, actualSets: '', feedback: '' }))
      })));

      if (currentDayLog.selectedWorkout) {
        setSelectedWorkout(currentDayLog.selectedWorkout);
      } else if (!currentDayLog.isOffDay) {
        const nextWorkout = getNextAvailableWorkout();
        setSelectedWorkout(nextWorkout);
        updateDayLog({ selectedWorkout: nextWorkout });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

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

  const updateExercise = (workoutId: string, exerciseId: string, updates: Partial<Exercise>) => {
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
    setDayLogs(prev => {
      const targetLog = prev[targetDateKey] || { date: targetDateKey, selectedWorkout: null, workoutCompleted: null, workoutRating: null, workoutSnapshot: null, workoutDraft: null, meals: [], notes: '', steps: null, dayClosed: false, isOffDay: false };
      const updatedMeals = [...(targetLog.meals || []), meal];
      return {
        ...prev,
        [targetDateKey]: { ...targetLog, meals: updatedMeals }
      };
    });
  };

  const addMeal = () => {
    const newMeal: Meal = {
      id: Date.now().toString(),
      time: mealForm.time || new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      name: mealForm.name,
      protein: parseFloat(mealForm.protein) || 0,
      fat: parseFloat(mealForm.fat) || 0,
      carbs: parseFloat(mealForm.carbs) || 0,
      calories: parseFloat(mealForm.calories) || 0,
    };

    if (editingMeal) {
      updateDayLog({ meals: currentDayLog.meals.map(m => m.id === editingMeal.id ? { ...newMeal, id: editingMeal.id } : m) });
      setShowMealModal(false);
      setEditingMeal(null);
      setMealForm({ time: '', name: '', protein: '', fat: '', carbs: '', calories: '' });
    } else if (isLateNight() && !editingMeal) {
      // Late night - ask which day to log
      setPendingMealData(newMeal);
      setShowMealModal(false);
      setShowNightMealPrompt(true);
      setMealForm({ time: '', name: '', protein: '', fat: '', carbs: '', calories: '' });
    } else {
      updateDayLog({ meals: [...currentDayLog.meals, newMeal] });
      setShowMealModal(false);
      setEditingMeal(null);
      setMealForm({ time: '', name: '', protein: '', fat: '', carbs: '', calories: '' });
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
          goal: null // TODO: add user goal setting
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
  const closeDay = (workoutId: string, shouldClose: boolean) => {
    if (shouldClose) {
      const workout = workouts.find(w => w.id === workoutId);
      if (workout) {
        const snapshot: WorkoutSnapshot = {
          workoutId: workout.id,
          workoutName: workout.name,
          exercises: JSON.parse(JSON.stringify(workout.exercises)) // Deep copy
        };
        updateDayLog({
          dayClosed: true,
          workoutCompleted: workoutId,
          workoutSnapshot: snapshot,
          workoutDraft: null
        });
      }
    } else {
      // Reopening a closed day — preserve snapshot as draft so exercises aren't lost
      const existingSnapshot = currentDayLog.workoutSnapshot;
      updateDayLog({
        dayClosed: false,
        workoutCompleted: null,
        workoutSnapshot: null,
        workoutDraft: existingSnapshot || currentDayLog.workoutDraft,
        isOffDay: false
      });
    }
  };

  // Mark day as off day (rest day - no workout required, but steps still needed)
  const toggleOffDay = () => {
    if (currentDayLog.isOffDay) {
      // Unmark as off day
      updateDayLog({ isOffDay: false, dayClosed: false });
    } else {
      // Mark as off day - if steps are entered, also close the day
      const hasSteps = !!(currentDayLog.steps && currentDayLog.steps > 0);
      updateDayLog({
        isOffDay: true,
        dayClosed: hasSteps,
        workoutCompleted: null,
        workoutSnapshot: null
      });
    }
  };

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
        padding: '16px 20px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          maxWidth: '600px',
          margin: '0 auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'var(--yellow)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 20px var(--yellow-glow)',
              position: 'relative',
              overflow: 'hidden'
            }}>
              {/* Trainx logo - T with dynamic X */}
              <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                {/* T letter */}
                <rect x="4" y="5" width="12" height="3.5" rx="1" fill="#000" />
                <rect x="8.25" y="5" width="3.5" height="16" rx="1" fill="#000" />
                {/* X accent */}
                <path d="M15 13L22 20" stroke="#000" strokeWidth="3" strokeLinecap="round" />
                <path d="M22 13L15 20" stroke="#000" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ marginTop: '-2px' }}>
              <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Trainx</h1>
              <div style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                letterSpacing: '0.5px'
              }}>
                <span style={{ color: 'var(--green)' }}>AI</span> Fitness
              </div>
            </div>
          </div>

          {/* Night Mode Indicator */}
          {isNightMode && <span style={{ fontSize: '18px' }}>🌙</span>}

          {/* Date Navigator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'var(--bg-elevated)',
            borderRadius: '12px',
            padding: '4px',
            border: '1px solid var(--border)'
          }}>
            <button
              onClick={() => navigateDate(-1)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                padding: '8px 10px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer'
              }}
            >
              <ChevronLeft size={18} />
            </button>
            <span
              suppressHydrationWarning
              style={{
                fontWeight: 600,
                minWidth: '90px',
                textAlign: 'center',
                fontSize: '13px'
              }}
            >
              {todayStr ? getDateLabel(selectedDate, todayStr) : selectedDate.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
            <button
              onClick={() => navigateDate(1)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                padding: '8px 10px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer'
              }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Navigation tabs */}
      <nav style={{
        padding: '12px 20px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)'
      }}>
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
              color: view === 'workout' ? '#000' : 'var(--text-secondary)',
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
              color: view === 'nutrition' ? '#000' : 'var(--text-secondary)',
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

          {/* Planner tab */}
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
              color: view === 'planner' ? '#000' : 'var(--text-secondary)',
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
                color: (view === 'gains' || view === 'analytics' || view === 'profile') ? '#000' : 'var(--text-secondary)',
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
        padding: '16px 20px',
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

            {/* Week View - 7 days with T1-T7 */}
            <div style={{
              background: 'var(--bg-card)',
              borderRadius: '12px',
              border: '1px solid var(--border)',
              padding: '10px',
              marginBottom: '12px'
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: '4px'
              }}>
                {(() => {
                  if (!todayStr) return null;
                  // Parse todayStr to get today's date
                  const [year, month, day] = todayStr.split('-').map(Number);
                  const today = new Date(year, month - 1, day);
                  // Get Monday of current week
                  const dayOfWeek = today.getDay();
                  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                  const monday = new Date(today);
                  monday.setDate(today.getDate() + mondayOffset);

                  const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

                  return weekDays.map((dayName, i) => {
                    const date = new Date(monday);
                    date.setDate(monday.getDate() + i);
                    const dateStr = formatDate(date);
                    const log = dayLogs[dateStr];
                    const isToday = dateStr === todayStr;
                    const isSelected = dateStr === dateKey;
                    const isFuture = dateStr > todayStr;
                    const isClosed = log?.dayClosed;
                    // Days beyond active workout count are rest days
                    const isRestDay = i >= workouts.length;
                    const isOffDay = log?.isOffDay;

                    // Show completed workout label (T1, T2, etc.) or dash for rest/off days
                    const completedWorkoutId = log?.workoutCompleted;
                    const completedWorkout = completedWorkoutId
                      ? workouts.find(w => w.id === completedWorkoutId)
                      : null;
                    const isSkippedDay = isClosed && !completedWorkout && !isOffDay;
                    const workoutLabel = isClosed && completedWorkout
                      ? completedWorkout.name.replace('Тренировка ', 'T')
                      : isOffDay ? '😴' : isSkippedDay ? '💤' : isRestDay ? '—' : '';

                    // Empty day = not closed and not rest day (no workout done yet)
                    const isEmptyDay = !isClosed && !isRestDay && !isFuture;

                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedDate(date)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '2px',
                          padding: '6px 2px',
                          background: isSelected
                            ? 'var(--yellow)'
                            : isOffDay
                              ? 'rgba(147, 112, 219, 0.15)'
                              : isSkippedDay
                                ? 'rgba(251, 191, 36, 0.08)'
                                : isClosed
                                  ? 'var(--green-dim)'
                                  : 'var(--bg-elevated)',
                          border: isToday
                            ? '2px solid var(--yellow)'
                            : isOffDay && !isSelected
                              ? '1px solid rgba(147, 112, 219, 0.3)'
                              : isSkippedDay && !isSelected
                                ? '1px solid rgba(251, 191, 36, 0.2)'
                                : isClosed && !isSelected
                                  ? '1px solid rgba(0, 200, 83, 0.3)'
                                  : '1px solid var(--border)',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          opacity: isSelected ? 1 : isFuture ? 0.4 : (isRestDay || isEmptyDay) ? 0.5 : 1,
                          boxShadow: isSelected
                            ? '0 2px 10px var(--yellow-glow)'
                            : isOffDay && !isSelected
                              ? '0 1px 4px rgba(147, 112, 219, 0.2)'
                              : isSkippedDay && !isSelected
                                ? 'none'
                                : isClosed && !isSelected
                                  ? '0 1px 4px var(--green-glow)'
                                  : 'none'
                        }}
                      >
                        <span style={{
                          fontSize: '9px',
                          color: isSelected ? '#000' : 'var(--text-muted)',
                          fontWeight: 600
                        }}>
                          {dayName}
                        </span>
                        <span style={{
                          fontSize: '12px',
                          fontWeight: 700,
                          color: isSelected ? '#000' : isOffDay ? 'rgb(147, 112, 219)' : isSkippedDay ? 'var(--yellow)' : isClosed ? 'var(--green)' : 'var(--text-primary)'
                        }}>
                          {date.getDate()}
                        </span>
                        {(isClosed || isRestDay || isOffDay) && (
                          <span style={{
                            fontSize: isOffDay ? '10px' : '9px',
                            fontWeight: 600,
                            color: isSelected ? '#000' : isOffDay ? 'rgb(147, 112, 219)' : isSkippedDay ? 'var(--yellow)' : isClosed ? 'var(--green)' : 'var(--text-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1px'
                          }}>
                            {isClosed && !isOffDay && !isSkippedDay && <Check size={8} strokeWidth={3} />}
                            {workoutLabel}
                          </span>
                        )}
                      </button>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Off Day indicator */}
            {currentDayLog.isOffDay && (
              <div style={{
                background: 'rgba(147, 112, 219, 0.15)',
                border: '1px solid rgba(147, 112, 219, 0.3)',
                borderRadius: '12px',
                padding: '14px 16px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>😴</span>
                  <span style={{ color: 'rgb(147, 112, 219)', fontWeight: 600, fontSize: '14px' }}>
                    {t('offDay')}
                  </span>
                </div>
                <button
                  onMouseDown={() => {
                    setOffDayHoldProgress(0);
                    let progress = 0;
                    offDayHoldRef.current = setInterval(() => {
                      progress += 5;
                      setOffDayHoldProgress(progress);
                      if (progress >= 100) {
                        if (offDayHoldRef.current) clearInterval(offDayHoldRef.current);
                        toggleOffDay();
                        setOffDayHoldProgress(0);
                      }
                    }, 50);
                  }}
                  onMouseUp={() => {
                    if (offDayHoldRef.current) clearInterval(offDayHoldRef.current);
                    setOffDayHoldProgress(0);
                  }}
                  onMouseLeave={() => {
                    if (offDayHoldRef.current) clearInterval(offDayHoldRef.current);
                    setOffDayHoldProgress(0);
                  }}
                  onTouchStart={() => {
                    setOffDayHoldProgress(0);
                    let progress = 0;
                    offDayHoldRef.current = setInterval(() => {
                      progress += 5;
                      setOffDayHoldProgress(progress);
                      if (progress >= 100) {
                        if (offDayHoldRef.current) clearInterval(offDayHoldRef.current);
                        toggleOffDay();
                        setOffDayHoldProgress(0);
                      }
                    }, 50);
                  }}
                  onTouchEnd={() => {
                    if (offDayHoldRef.current) clearInterval(offDayHoldRef.current);
                    setOffDayHoldProgress(0);
                  }}
                  style={{
                    padding: '8px 12px',
                    background: offDayHoldProgress > 0
                      ? `linear-gradient(90deg, rgba(147, 112, 219, 0.3) ${offDayHoldProgress}%, var(--bg-elevated) ${offDayHoldProgress}%)`
                      : 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    color: 'var(--text-muted)',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'none',
                    userSelect: 'none'
                  }}
                >
                  {offDayHoldProgress > 0 ? `${Math.round(offDayHoldProgress)}%` : t('cancelOffDay')}
                </button>
              </div>
            )}

            {/* Workout selector - compact grid, hidden when viewing history or off day */}
            {!viewingPastWorkout && !currentDayLog.isOffDay && (
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
                          padding: '10px 4px',
                          background: isActive
                            ? 'var(--yellow)'
                            : 'var(--bg-card)',
                          border: isActive ? 'none' : '1px solid var(--border)',
                          borderRadius: '10px',
                          color: isActive ? '#000' : isEmpty ? 'var(--text-muted)' : 'var(--text-primary)',
                          fontWeight: isActive ? 700 : 600,
                          fontSize: '13px',
                          boxShadow: isActive ? '0 4px 20px var(--yellow-glow)' : 'none',
                          opacity: isActive ? 1 : isEmpty ? 0.5 : 1,
                          transform: isActive ? 'scale(1.02)' : 'scale(1)',
                          minWidth: 0
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
                        padding: '10px 4px',
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
                        minWidth: 0
                      }}
                      title="Добавить тренировку"
                    >
                      <Plus size={16} />
                    </button>
                  )}
                </div>
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
              </div>
            )}

            {/* Closed day dimming wrapper for exercises + steps */}
            <div style={{
              opacity: currentDayLog.dayClosed ? 0.5 : 1,
              pointerEvents: currentDayLog.dayClosed ? 'none' : 'auto',
              transition: 'opacity 0.3s ease'
            }}>

            {/* Compact Progress bar - hidden for Off Days */}
            {!currentDayLog.isOffDay && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '16px',
              padding: '10px 14px',
              background: 'var(--bg-card)',
              borderRadius: '12px',
              border: '1px solid var(--border)'
            }}>
              <span style={{
                fontSize: '13px',
                fontWeight: 600,
                color: progressPercent === 100 ? 'var(--green)' : 'var(--text-secondary)',
                whiteSpace: 'nowrap'
              }}>
                {viewingPastWorkout
                  ? `${displayExercises.filter(e => e.completed).length}/${displayExercises.length}`
                  : `${completedExercises}/${totalExercises}`
                }
              </span>
              <div style={{
                flex: 1,
                height: '4px',
                background: 'var(--bg-elevated)',
                borderRadius: '2px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: viewingPastWorkout
                    ? `${(displayExercises.filter(e => e.completed).length / displayExercises.length) * 100}%`
                    : `${progressPercent}%`,
                  height: '100%',
                  background: progressPercent === 100 ? 'var(--green)' : 'var(--yellow)',
                  borderRadius: '2px',
                  transition: 'width 0.3s ease'
                }} />
              </div>
              {/* Off Day button - at end of progress bar */}
              {!viewingPastWorkout && !currentDayLog.isOffDay && (
                <button
                  className="btn-press"
                  onClick={toggleOffDay}
                  style={{
                    padding: '6px 10px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    flexShrink: 0
                  }}
                  title="День отдыха"
                >
                  <span style={{ fontSize: '14px' }}>😴</span>
                </button>
              )}
            </div>
            )}

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
                      exerciseLibrary={exerciseLibrary}
                      onImageSaved={(name, url) => setExerciseLibrary(prev => ({ ...prev, [name]: url }))}
                      dayClosed={currentDayLog.dayClosed}
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
                      color: '#000',
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

            {/* Steps input — always editable, even when day is closed */}
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
                <Footprints
                  className="steps-walking"
                  size={20}
                  style={{
                    color: currentDayLog.steps && currentDayLog.steps > 0
                      ? 'var(--blue)'
                      : 'var(--text-muted)',
                    flexShrink: 0
                  }}
                />
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
                    color: 'var(--blue)',
                    fontSize: '16px',
                    fontWeight: 600
                  }}
                />
                {/* Weekly steps total */}
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
                  <span style={{
                    fontSize: '10px',
                    color: 'var(--text-muted)',
                    lineHeight: 1
                  }}>
                    {userSettings.language === 'ru' ? 'неделя' : 'week'}
                  </span>
                  <span style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: weeklySteps > 0 ? 'var(--blue)' : 'var(--text-muted)',
                    lineHeight: 1.3
                  }}>
                    {weeklySteps.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Close/Open day button */}
            {(totalExercises > 0 || currentDayLog.dayClosed || currentDayLog.isOffDay) && (
            <div style={{ marginTop: '16px', marginBottom: '20px' }}>
              {(() => {
                const isDayClosed = currentDayLog.dayClosed;
                const isOffDay = currentDayLog.isOffDay;
                const hasSteps = currentDayLog.steps && currentDayLog.steps > 0;
                const allExercisesDone = completedExercises === totalExercises;
                const hasSkippedExercises = !isOffDay && !allExercisesDone && totalExercises > 0;
                // Allow closing always — steps are optional (user gets warned)
                const canCloseDay = true;
                const readyToClose = !isDayClosed;

                if (isDayClosed) {
                  // --- CLOSED DAY SUMMARY CARD ---
                  const snapshot = currentDayLog.workoutSnapshot;
                  const snapshotCompleted = snapshot ? snapshot.exercises.filter(e => e.completed).length : 0;
                  const snapshotTotal = snapshot ? snapshot.exercises.length : 0;
                  const closedSteps = currentDayLog.steps;
                  const rating = currentDayLog.workoutRating;
                  const ratingEmojis = ['', '😫', '😐', '😊', '💪', '🔥'];

                  return (
                    <div style={{
                      background: 'var(--green-dim)',
                      border: '2px solid rgba(0, 200, 83, 0.3)',
                      borderRadius: '16px',
                      overflow: 'hidden'
                    }}>
                      {/* Header */}
                      <div style={{
                        padding: '16px 18px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        borderBottom: '1px solid rgba(0, 200, 83, 0.15)'
                      }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          background: 'var(--green)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <Check size={18} style={{ color: '#000' }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--green)' }}>
                            {t('dayCompleted')}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {new Date(dateKey).toLocaleDateString(userSettings.language === 'ru' ? 'ru-RU' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
                          </div>
                        </div>
                        {rating && rating > 0 && (
                          <span style={{ fontSize: '24px' }}>{ratingEmojis[rating]}</span>
                        )}
                      </div>

                      {/* Training row */}
                      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Dumbbell size={18} style={{ color: snapshot ? 'var(--green)' : 'var(--text-muted)', flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          {isOffDay ? (
                            <div style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 500 }}>
                              {userSettings.language === 'ru' ? 'День отдыха' : 'Rest Day'}
                            </div>
                          ) : snapshot ? (
                            <>
                              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                {snapshot.workoutName}
                              </div>
                              <div style={{ fontSize: '12px', color: snapshotCompleted === snapshotTotal ? 'var(--green)' : 'var(--yellow, #ffcc55)', marginTop: '2px' }}>
                                {snapshotCompleted}/{snapshotTotal} {userSettings.language === 'ru' ? 'упражнений' : 'exercises'}
                                {snapshotCompleted === snapshotTotal && (
                                  <span style={{ marginLeft: '6px' }}>✓</span>
                                )}
                              </div>
                            </>
                          ) : (
                            <div style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 500 }}>
                              {userSettings.language === 'ru' ? 'Тренировка не записана' : 'No workout recorded'}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Steps row */}
                      <div style={{ padding: '0 18px 12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Footprints size={18} style={{ color: closedSteps && closedSteps > 0 ? 'var(--blue)' : 'var(--text-muted)', flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          {closedSteps && closedSteps > 0 ? (
                            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--blue)' }}>
                              {closedSteps.toLocaleString()} {userSettings.language === 'ru' ? 'шагов' : 'steps'}
                            </div>
                          ) : (
                            <div style={{ fontSize: '13px', color: 'var(--yellow, #ffcc55)', fontWeight: 500 }}>
                              {userSettings.language === 'ru' ? 'Шаги не добавлены' : 'No steps added'}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Reopen button */}
                      <button
                        onClick={() => {
                          if (isOffDay) {
                            updateDayLog({ dayClosed: false });
                          } else {
                            closeDay(currentDayLog.workoutCompleted!, false);
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '14px',
                          background: 'transparent',
                          border: 'none',
                          borderTop: '1px solid rgba(0, 200, 83, 0.15)',
                          borderRadius: '0 0 14px 14px',
                          color: 'var(--text-muted)',
                          fontWeight: 600,
                          fontSize: '13px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          cursor: 'pointer'
                        }}
                      >
                        <Edit2 size={14} />
                        {t('reopenDay')}
                      </button>
                    </div>
                  );
                }

                // --- OPEN DAY: Close button ---
                return (
                  <>
                    {readyToClose && (
                      <div style={{
                        textAlign: 'center',
                        marginBottom: '12px',
                        color: (hasSkippedExercises || !hasSteps) ? 'var(--yellow, #ffcc55)' : 'var(--green)',
                        fontSize: '14px',
                        fontWeight: 600
                      }}
                      className="animate-pulse"
                      >
                        {hasSkippedExercises
                          ? `⚠️ ${completedExercises}/${totalExercises} ${userSettings.language === 'ru' ? 'упражнений выполнено' : 'exercises done'}`
                          : !hasSteps
                            ? (userSettings.language === 'ru' ? '⚠️ Шаги не добавлены' : '⚠️ No steps added')
                            : '✨ Всё готово! Закройте день ✨'}
                      </div>
                    )}
                    <button
                      onMouseDown={(e) => {
                        const btn = e.currentTarget;
                        btn.dataset.pressing = 'true';
                        btn.dataset.progress = '0';
                        const interval = setInterval(() => {
                          if (btn.dataset.pressing !== 'true') {
                            clearInterval(interval);
                            btn.style.background = readyToClose ? 'var(--green-dim)' : 'var(--bg-card)';
                            return;
                          }
                          const progress = parseInt(btn.dataset.progress || '0') + 5;
                          btn.dataset.progress = progress.toString();
                          const endColor = readyToClose ? 'var(--green-dim)' : 'var(--bg-card)';
                          btn.style.background = `linear-gradient(90deg, var(--green) ${progress}%, ${endColor} ${progress}%)`;
                          if (progress >= 100) {
                            clearInterval(interval);
                            if (canCloseDay) {
                              if (isOffDay) {
                                updateDayLog({ dayClosed: true });
                              } else {
                                closeDay(currentWorkout.id, true);
                              }
                            }
                            btn.style.background = 'var(--green)';
                          }
                        }, 30);
                      }}
                      onMouseUp={(e) => { e.currentTarget.dataset.pressing = 'false'; }}
                      onMouseLeave={(e) => { e.currentTarget.dataset.pressing = 'false'; }}
                      onTouchStart={(e) => {
                        const btn = e.currentTarget;
                        btn.dataset.pressing = 'true';
                        btn.dataset.progress = '0';
                        const interval = setInterval(() => {
                          if (btn.dataset.pressing !== 'true') {
                            clearInterval(interval);
                            btn.style.background = readyToClose ? 'var(--green-dim)' : 'var(--bg-card)';
                            return;
                          }
                          const progress = parseInt(btn.dataset.progress || '0') + 5;
                          btn.dataset.progress = progress.toString();
                          const endColor = readyToClose ? 'var(--green-dim)' : 'var(--bg-card)';
                          btn.style.background = `linear-gradient(90deg, var(--green) ${progress}%, ${endColor} ${progress}%)`;
                          if (progress >= 100) {
                            clearInterval(interval);
                            if (canCloseDay) {
                              if (isOffDay) {
                                updateDayLog({ dayClosed: true });
                              } else {
                                closeDay(currentWorkout.id, true);
                              }
                            }
                            btn.style.background = 'var(--green)';
                          }
                        }, 30);
                      }}
                      onTouchEnd={(e) => { e.currentTarget.dataset.pressing = 'false'; }}
                      style={{
                        width: '100%',
                        padding: '20px',
                        background: readyToClose
                          ? ((hasSkippedExercises || !hasSteps) ? 'rgba(255,204,85,0.15)' : 'var(--green-dim)')
                          : 'var(--bg-card)',
                        border: `2px solid ${readyToClose ? ((hasSkippedExercises || !hasSteps) ? 'var(--yellow, #ffcc55)' : 'var(--green)') : 'var(--border)'}`,
                        borderRadius: '16px',
                        color: readyToClose ? ((hasSkippedExercises || !hasSteps) ? 'var(--yellow, #ffcc55)' : 'var(--green)') : 'var(--text-primary)',
                        fontWeight: 700,
                        fontSize: '15px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        boxShadow: readyToClose
                          ? ((hasSkippedExercises || !hasSteps) ? '0 4px 20px rgba(255,204,85,0.2)' : '0 4px 20px var(--green-glow)')
                          : 'none'
                      }}
                      className={readyToClose ? 'animate-glow' : ''}
                    >
                      {readyToClose && <Check size={20} />}
                      {t('closeDay')}
                    </button>
                  </>
                );
              })()}
            </div>
            )}

            {/* Mini calendar */}
            <div>
              <FitnessCalendar
                dayLogs={dayLogs}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                workouts={workouts}
                timezone={userSettings.timezone}
              />
            </div>
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

            {/* Nutrition Streak - 7 day visual */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              marginBottom: '12px',
              padding: '14px 16px',
              background: 'var(--bg-card)',
              borderRadius: '12px',
              border: '1px solid var(--border)'
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
                  текущая неделя
                </span>
              </div>

              {/* 7 day cells */}
              <div style={{
                display: 'flex',
                gap: '6px',
                justifyContent: 'space-between'
              }}>
                {last7Days.map((day) => {
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
                            ? 'rgba(255, 255, 255, 0.05)'
                            : 'transparent',
                      border: day.isToday
                        ? isTodayCloseToGoal
                          ? '1px solid rgba(255, 152, 0, 0.1)'
                          : '2px dashed var(--border-strong)'
                        : isSelected && !day.isToday
                          ? '1px solid rgba(255, 255, 255, 0.15)'
                          : day.isFuture
                            ? '1px dashed rgba(239, 68, 68, 0.25)'
                            : 'none',
                      opacity: day.isFuture ? 0.5 : 1
                    }}>
                      {day.isToday ? (
                        <span style={{
                          fontSize: isTodayCloseToGoal ? '16px' : '13px',
                          animation: isTodayCloseToGoal ? 'fireBounce 0.5s ease-in-out infinite' : 'none',
                          filter: isTodayCloseToGoal ? 'drop-shadow(0 0 4px rgba(255, 107, 0, 0.8))' : 'none'
                        }}>
                          {isTodayCloseToGoal ? '🔥' : '⏳'}
                        </span>
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
                        <span style={{
                          fontSize: '14px'
                        }}>💩</span>
                      )}
                    </div>
                  </div>
                  );
                })}
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
                        <span style={{ fontSize: '24px' }}>
                          {dayInfo?.completed ? '🔥' : '💩'}
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

            {/* Meals header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px'
            }}>
              <h3 style={{ margin: 0, fontWeight: 700, fontSize: '18px' }}>{t('meals')}</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={getFoodRecommendations}
                  className="btn-press"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '12px 14px',
                    background: 'linear-gradient(135deg, var(--purple) 0%, var(--blue) 100%)',
                    border: 'none',
                    borderRadius: '12px',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: '13px',
                    boxShadow: '0 4px 15px rgba(139, 92, 246, 0.3)'
                  }}
                  title={userSettings.language === 'ru' ? 'AI подскажет что съесть' : 'AI food suggestions'}
                >
                  <Sparkles size={16} />
                  AI
                </button>
                <button
                  onClick={() => {
                    setEditingMeal(null);
                    setMealForm({ time: '', name: '', protein: '', fat: '', carbs: '', calories: '' });
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
                    color: '#000',
                    fontWeight: 700,
                    fontSize: '14px',
                    boxShadow: '0 4px 20px var(--yellow-glow)'
                  }}
                >
                  <Plus size={18} /> {t('addMeal')}
                </button>
              </div>
            </div>

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
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px'
                    }}>
                      {/* Time */}
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '36px' }}>
                        {meal.time}
                      </span>
                      {/* Name */}
                      <span style={{ fontWeight: 600, fontSize: '13px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {meal.name}
                      </span>
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
                          onClick={() => {
                            setDayLogs(prev => {
                              const existingLog = prev[dateKey] || currentDayLog;
                              const newMeals = existingLog.meals.map(m =>
                                m.id === meal.id ? { ...m, isFavorite: !m.isFavorite } : m
                              );
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
                          onClick={() => openEditMeal(meal)}
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
                          onClick={() => deleteMeal(meal.id)}
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
                <span style={{ fontWeight: 700, fontSize: '15px' }}>
                  {nutritionRecommendations ? 'Рекомендации тренера' : 'Когда есть'}
                </span>
              </div>
              <div style={{ padding: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {(nutritionRecommendations || DEFAULT_NUTRITION_RECOMMENDATIONS).map(rec => (
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
              </div>
            </div>

            {/* Food Products List */}
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
                <span style={{ fontWeight: 700, fontSize: '15px' }}>Разрешённые продукты</span>
              </div>
              <div style={{ padding: '16px' }}>
                {Object.entries(FOOD_CATEGORIES).map(([key, cat]) => {
                  const products = DEFAULT_FOOD_PRODUCTS.filter(p => p.category === key);
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
                  color: '#000',
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {bodyMeasurements.slice().reverse().map((m) => (
                    <div key={m.id} style={{
                      background: 'var(--bg-card)',
                      borderRadius: '12px',
                      padding: '16px',
                      border: '1px solid var(--border)'
                    }}>
                      <div style={{
                        fontSize: '12px',
                        color: 'var(--text-muted)',
                        marginBottom: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <Calendar size={12} />
                        {new Date(m.date).toLocaleDateString(userSettings.language === 'ru' ? 'ru-RU' : 'en-US', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric'
                        })}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'flex-start' }}>
                        {m.weight && (
                          <div style={{ textAlign: 'center', minWidth: '50px' }}>
                            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--yellow)' }}>{m.weight}</div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>кг</div>
                          </div>
                        )}
                        {m.waist && (
                          <div style={{ textAlign: 'center', minWidth: '50px' }}>
                            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--blue)' }}>{m.waist}</div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{t('waist')}</div>
                          </div>
                        )}
                        {m.chest && (
                          <div style={{ textAlign: 'center', minWidth: '50px' }}>
                            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--green)' }}>{m.chest}</div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{t('chest')}</div>
                          </div>
                        )}
                        {m.biceps && (
                          <div style={{ textAlign: 'center', minWidth: '50px' }}>
                            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--purple)' }}>{m.biceps}</div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{t('biceps')}</div>
                          </div>
                        )}
                        {m.bicepsLeft && (
                          <div style={{ textAlign: 'center', minWidth: '50px' }}>
                            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--purple)' }}>{m.bicepsLeft}</div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{t('bicepsLeft')}</div>
                          </div>
                        )}
                        {m.bicepsRight && (
                          <div style={{ textAlign: 'center', minWidth: '50px' }}>
                            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--purple)' }}>{m.bicepsRight}</div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{t('bicepsRight')}</div>
                          </div>
                        )}
                        {m.thighs && (
                          <div style={{ textAlign: 'center', minWidth: '50px' }}>
                            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--orange)' }}>{m.thighs}</div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{t('thighs')}</div>
                          </div>
                        )}
                        {m.hips && (
                          <div style={{ textAlign: 'center', minWidth: '50px' }}>
                            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--cyan)' }}>{m.hips}</div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{t('hips')}</div>
                          </div>
                        )}
                      </div>
                      {m.notes && (
                        <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                          {m.notes}
                        </div>
                      )}
                      {/* Edit/Delete buttons */}
                      <div style={{
                        marginTop: '12px',
                        paddingTop: '12px',
                        borderTop: '1px solid var(--border)',
                        display: 'flex',
                        gap: '8px',
                        justifyContent: 'flex-end'
                      }}>
                        <button
                          onClick={() => {
                            setEditingMeasurement(m);
                            setShowMeasurementModal(true);
                          }}
                          style={{
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            padding: '8px 12px',
                            color: 'var(--text-secondary)',
                            fontSize: '12px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Pencil size={14} />
                          {t('edit') || 'Изменить'}
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(t('deleteMeasurementConfirm') as string)) {
                              setBodyMeasurements(prev => prev.filter(item => item.id !== m.id));
                            }
                          }}
                          style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.2)',
                            borderRadius: '8px',
                            padding: '8px 12px',
                            color: '#ef4444',
                            fontSize: '12px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Trash2 size={14} />
                          {t('delete') || 'Удалить'}
                        </button>
                      </div>
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
              todayStr={todayStr}
              lang={userSettings.language === 'ru' ? 'ru' : 'en'}
            />
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
                  color: '#000',
                  marginBottom: '12px'
                }}>
                  {userSettings.name?.[0]?.toUpperCase() || '👤'}
                </div>
                <div style={{ fontSize: '18px', fontWeight: 600 }}>{userSettings.name || 'User'}</div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{userSettings.email || 'fitness@app.local'}</div>
              </div>

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
                        color: userSettings.language === 'ru' ? '#000' : 'var(--text-secondary)',
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
                        color: userSettings.language === 'en' ? '#000' : 'var(--text-secondary)',
                        fontWeight: userSettings.language === 'en' ? 700 : 500,
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      EN
                    </button>
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
                  color: '#000',
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
                  color: '#000',
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
                          calories: item.meal.calories
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
                  color: '#000',
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
                              return {
                                ...prev,
                                [dateKey]: { ...existingLog, meals: [...existingLog.meals, newMeal] }
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
                      <div style={{ fontSize: '11px', color: 'var(--yellow)', marginTop: '2px' }}>
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
                  color: '#000',
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

      {/* Footer with sync status */}
      <footer style={{
        padding: '12px 20px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '8px',
        fontSize: '11px',
        color: 'var(--text-muted)',
        background: 'var(--bg-primary)'
      }}>
        {syncStatus === 'syncing' && (
          <>
            <Cloud size={12} style={{ color: 'var(--blue)', animation: 'pulse 1s ease-in-out infinite' }} />
            <span>{t('syncing')}</span>
          </>
        )}
        {syncStatus === 'synced' && (
          <>
            <Cloud size={12} style={{ color: 'var(--green)' }} />
            <span>{t('synced')}</span>
          </>
        )}
        {syncStatus === 'error' && (
          <>
            <CloudOff size={12} style={{ color: 'var(--red)' }} />
            <span>{t('offline')}</span>
          </>
        )}
        {syncStatus === 'idle' && (
          <span style={{ opacity: 0.5 }}>AI Fitness</span>
        )}
      </footer>
    </main>
  );
}

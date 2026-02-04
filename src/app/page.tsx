'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Plus, X, Dumbbell, Apple, ChevronLeft, ChevronRight, Check,
  Flame, Target, TrendingUp, Edit2, Trash2, Save, ChevronDown,
  ChevronUp, Calendar, Cloud, CloudOff, Footprints, History,
  Zap, Timer, Play, Pause, RotateCcw, Settings
} from 'lucide-react';

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
  meals: Meal[];
  notes: string;
  steps: number | null;
  dayClosed: boolean;
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
  return date.toISOString().split('T')[0];
}

function getDateLabel(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  if (diff === -1) return 'Завтра';
  return date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Beautiful Exercise Card Component
function ExerciseCard({ ex, idx, onToggle, onUpdate, workoutId, progressHistory, onSaveProgress }: {
  ex: Exercise;
  idx: number;
  onToggle: () => void;
  onUpdate: (updates: Partial<Exercise>) => void;
  workoutId: string;
  progressHistory: ExerciseProgress[];
  onSaveProgress: (weight: string, notes: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div
      className="card-hover"
      style={{
        background: 'var(--bg-card)',
        borderRadius: ex.completed ? '10px' : '14px',
        border: `1px solid ${ex.completed ? 'rgba(0, 200, 83, 0.2)' : 'var(--border)'}`,
        overflow: 'hidden',
        marginBottom: ex.completed ? '6px' : '10px',
        transition: 'all 0.3s ease'
      }}
    >
      {/* Main row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: ex.completed ? '8px 12px' : '12px 14px',
          gap: ex.completed ? '10px' : '12px',
          cursor: 'pointer'
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Checkbox - left side */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            // Toggle mark/unmark
            onToggle();
          }}
          style={{
            width: ex.completed ? '24px' : '32px',
            height: ex.completed ? '24px' : '32px',
            borderRadius: ex.completed ? '6px' : '8px',
            border: ex.completed ? 'none' : '2px solid var(--border-strong)',
            background: ex.completed
              ? 'var(--green)'
              : 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#000',
            flexShrink: 0,
            boxShadow: ex.completed ? '0 2px 6px var(--green-glow)' : 'none',
            transition: 'all 0.2s ease'
          }}
        >
          {ex.completed && <Check size={14} strokeWidth={3} />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 600,
            fontSize: ex.completed ? '13px' : '14px',
            color: ex.completed ? 'var(--green)' : 'var(--text-primary)',
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
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
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
          color: ex.completed ? 'var(--green)' : 'var(--text-muted)',
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
          borderTop: '1px solid rgba(0, 200, 83, 0.15)',
          background: 'var(--green-dim)',
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

          {/* Unmark button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
              setExpanded(false);
            }}
            style={{
              width: '100%',
              padding: '8px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <X size={14} />
            Снять отметку
          </button>
        </div>
      )}

      {/* Expanded content - only for incomplete exercises */}
      {expanded && !ex.completed && (
        <div style={{
          padding: '0 16px 16px',
          borderTop: '1px solid var(--border)',
          animation: 'slideUp 0.2s ease'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
            <div>
              <label style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                display: 'block',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Текущий вес
              </label>
              <input
                type="text"
                value={ex.actualSets}
                onChange={(e) => onUpdate({ actualSets: e.target.value })}
                placeholder="0 кг"
                style={{
                  width: '100%',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  color: 'var(--text-primary)',
                  fontSize: '15px',
                  fontWeight: 600
                }}
              />
            </div>
            <div>
              <label style={{
                fontSize: '11px',
                color: 'var(--yellow)',
                display: 'block',
                marginBottom: '6px',
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
                  borderRadius: '10px',
                  padding: '12px 14px',
                  color: 'var(--yellow)',
                  fontSize: '15px',
                  fontWeight: 600
                }}
              />
            </div>
          </div>

          <div style={{ marginTop: '12px' }}>
            <label style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '6px'
            }}>
              <Timer size={12} />
              Отдых: {ex.restTime}
            </label>
            <RestTimer restTime={ex.restTime} />
            <input
              type="text"
              value={ex.feedback}
              onChange={(e) => onUpdate({ feedback: e.target.value })}
              placeholder="Заметки к упражнению..."
              style={{
                width: '100%',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '12px 14px',
                color: 'var(--text-primary)',
                fontSize: '14px',
                marginTop: '12px'
              }}
            />
          </div>

          {/* Save progress & History buttons */}
          <div style={{ marginTop: '14px', display: 'flex', gap: '10px' }}>
            {ex.actualSets && (
              <button
                onClick={() => onSaveProgress(ex.actualSets, ex.feedback)}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: 'var(--yellow-dim)',
                  border: '1px solid rgba(255, 232, 4, 0.3)',
                  borderRadius: '10px',
                  color: 'var(--yellow)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <Save size={16} /> Сохранить прогресс
              </button>
            )}
            {progressHistory.length > 0 && (
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
                <History size={16} /> {progressHistory.length}
              </button>
            )}
          </div>

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
    </div>
  );
}

// Beautiful Calendar Component
function FitnessCalendar({
  dayLogs,
  selectedDate,
  onSelectDate,
  workouts
}: {
  dayLogs: Record<string, DayLog>;
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  workouts: Workout[];
}) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  const monthDays = useMemo(() => {
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

  const today = formatDate(new Date());
  const selectedDateStr = formatDate(selectedDate);

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
            background: 'var(--purple-dim)',
            padding: '12px',
            borderRadius: '12px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--purple)' }}>
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
          const hasWorkout = log?.dayClosed;
          const hasSteps = log?.steps && log.steps > 0 && !hasWorkout;

          // Get completed workout label
          const completedWorkoutId = log?.workoutCompleted;
          const completedWorkout = completedWorkoutId
            ? workouts.find(w => w.id === completedWorkoutId)
            : null;
          const workoutLabel = completedWorkout
            ? completedWorkout.name.replace('Тренировка ', 'T')
            : null;

          // Определяем стиль фона
          const getBackground = () => {
            if (isSelected) return 'var(--yellow)';
            if (hasWorkout) return 'var(--green-dim)';
            if (hasSteps) return 'var(--blue-dim)';
            if (isFuture) return 'transparent';
            return 'transparent';
          };

          // Определяем цвет текста
          const getColor = () => {
            if (isSelected) return '#000';
            if (hasWorkout) return 'var(--green)';
            if (isFuture) return 'var(--text-muted)';
            return 'var(--text-primary)';
          };

          return (
            <button
              key={d.day}
              onClick={() => onSelectDate(new Date(d.dateStr))}
              style={{
                aspectRatio: '1',
                background: getBackground(),
                border: isToday
                  ? '2px solid var(--yellow)'
                  : hasWorkout && !isSelected
                    ? '1px solid rgba(0, 200, 83, 0.3)'
                    : '1px solid transparent',
                borderRadius: '10px',
                cursor: isFuture ? 'default' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                color: getColor(),
                fontWeight: isToday || isSelected || hasWorkout ? 700 : 500,
                fontSize: '14px',
                transition: 'all 0.2s ease',
                boxShadow: isSelected
                  ? '0 4px 20px var(--yellow-glow)'
                  : hasWorkout && !isSelected
                    ? '0 2px 8px var(--green-glow)'
                    : 'none',
                opacity: isFuture ? 0.4 : 1
              }}
            >
              <span>{d.day}</span>
              {hasWorkout ? (
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
            border: '2px solid var(--green)',
            background: 'transparent'
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

export default function FitnessPage() {
  const [view, setView] = useState<'workout' | 'nutrition' | 'calendar'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('fitness_view');
      if (saved === 'workout' || saved === 'nutrition' || saved === 'calendar') {
        return saved;
      }
    }
    return 'workout';
  });
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [workouts, setWorkouts] = useState<Workout[]>(DEFAULT_WORKOUTS);
  const [selectedWorkout, setSelectedWorkout] = useState<string>(() => getDefaultWorkout());
  const [dayLogs, setDayLogs] = useState<Record<string, DayLog>>({});
  const [showMealModal, setShowMealModal] = useState(false);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [mealForm, setMealForm] = useState({ time: '', name: '', protein: '', fat: '', carbs: '', calories: '' });
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [isLoaded, setIsLoaded] = useState(false);
  const [progressHistory, setProgressHistory] = useState<ProgressHistory>({});
  const [showWorkoutEditor, setShowWorkoutEditor] = useState(false);
  const [editingWorkoutId, setEditingWorkoutId] = useState<string | null>(null);
  const [exerciseForm, setExerciseForm] = useState({ name: '', plannedSets: '', restTime: '2-3 мин', notes: '' });
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [stepsAlertPulse, setStepsAlertPulse] = useState(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const stepsAlertRef = useRef<HTMLDivElement | null>(null);

  const dateKey = formatDate(selectedDate);

  // Load data from server or localStorage
  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch('/api/fitness');
        if (response.ok) {
          const data = await response.json();
          if (data.workouts) setWorkouts(data.workouts);
          if (data.dayLogs) setDayLogs(data.dayLogs);
          if (data.progressHistory) setProgressHistory(data.progressHistory);
          setIsLoaded(true);
          setSyncStatus('synced');
          return;
        }
      } catch (e) {
        console.error('Failed to load from server:', e);
      }

      // Fallback to localStorage
      const saved = localStorage.getItem('fitness_data');
      if (saved) {
        try {
          const data = JSON.parse(saved);
          if (data.workouts) setWorkouts(data.workouts);
          if (data.dayLogs) setDayLogs(data.dayLogs);
          if (data.progressHistory) setProgressHistory(data.progressHistory);
        } catch (e) {
          console.error('Failed to load fitness data:', e);
        }
      }
      setIsLoaded(true);
    };
    loadData();
  }, []);

  // Sync to server with debounce
  const syncToServer = useCallback(async (workoutsData: Workout[], dayLogsData: Record<string, DayLog>, progressData: ProgressHistory) => {
    setSyncStatus('syncing');
    try {
      const response = await fetch('/api/fitness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workouts: workoutsData, dayLogs: dayLogsData, progressHistory: progressData })
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

  // Save to localStorage and queue server sync
  useEffect(() => {
    if (!isLoaded) return;

    localStorage.setItem('fitness_data', JSON.stringify({ workouts, dayLogs, progressHistory }));

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => {
      syncToServer(workouts, dayLogs, progressHistory);
    }, 2000);

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [workouts, dayLogs, progressHistory, isLoaded, syncToServer]);

  const currentDayLog = useMemo(() => {
    return dayLogs[dateKey] || { date: dateKey, selectedWorkout: null, workoutCompleted: null, workoutRating: null, workoutSnapshot: null, meals: [], notes: '', steps: null, dayClosed: false };
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

  const updateDayLog = (updates: Partial<DayLog>) => {
    setDayLogs(prev => ({
      ...prev,
      [dateKey]: { ...currentDayLog, ...updates }
    }));
  };

  // Select workout and save to dayLog
  const selectWorkout = (workoutId: string) => {
    setSelectedWorkout(workoutId);
    updateDayLog({ selectedWorkout: workoutId });
  };

  // Restore selected workout when date changes
  useEffect(() => {
    if (currentDayLog.dayClosed && currentDayLog.workoutCompleted) {
      // If day is closed, show the completed workout
      setSelectedWorkout(currentDayLog.workoutCompleted);
    } else if (currentDayLog.selectedWorkout) {
      // Restore previously selected workout for this day
      setSelectedWorkout(currentDayLog.selectedWorkout);
    }
  }, [dateKey, currentDayLog.dayClosed, currentDayLog.workoutCompleted, currentDayLog.selectedWorkout]);

  const updateExercise = (workoutId: string, exerciseId: string, updates: Partial<Exercise>) => {
    setWorkouts(prev => prev.map(w =>
      w.id === workoutId
        ? { ...w, exercises: w.exercises.map(e => e.id === exerciseId ? { ...e, ...updates } : e) }
        : w
    ));
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
    } else {
      updateDayLog({ meals: [...currentDayLog.meals, newMeal] });
    }

    setShowMealModal(false);
    setEditingMeal(null);
    setMealForm({ time: '', name: '', protein: '', fat: '', carbs: '', calories: '' });
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
          workoutSnapshot: snapshot
        });
      }
    } else {
      updateDayLog({
        dayClosed: false,
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
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-primary)'
    }}>
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
              boxShadow: '0 4px 20px var(--yellow-glow)'
            }}>
              <Dumbbell size={22} color="#000" />
            </div>
            <div>
              <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Fitness</h1>
              <div style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                {syncStatus === 'syncing' && (
                  <>
                    <Cloud size={12} className="animate-pulse" style={{ color: 'var(--blue)' }} />
                    Сохранение...
                  </>
                )}
                {syncStatus === 'synced' && (
                  <>
                    <Cloud size={12} style={{ color: 'var(--green)' }} />
                    Синхронизировано
                  </>
                )}
                {syncStatus === 'error' && (
                  <>
                    <CloudOff size={12} style={{ color: 'var(--red)' }} />
                    Оффлайн
                  </>
                )}
              </div>
            </div>
          </div>

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
                alignItems: 'center'
              }}
            >
              <ChevronLeft size={18} />
            </button>
            <span style={{
              fontWeight: 600,
              minWidth: '90px',
              textAlign: 'center',
              fontSize: '13px'
            }}>
              {getDateLabel(selectedDate)}
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
                alignItems: 'center'
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
          {[
            { id: 'workout', icon: Dumbbell, label: 'Тренировка' },
            { id: 'nutrition', icon: Apple, label: 'Питание' },
            { id: 'calendar', icon: Calendar, label: 'Календарь' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                const newView = tab.id as typeof view;
                setView(newView);
                localStorage.setItem('fitness_view', newView);
              }}
              style={{
                flex: 1,
                padding: '12px',
                background: view === tab.id
                  ? 'var(--yellow)'
                  : 'var(--bg-elevated)',
                border: view === tab.id ? 'none' : '1px solid var(--border)',
                borderRadius: '12px',
                color: view === tab.id ? '#000' : 'var(--text-secondary)',
                fontWeight: view === tab.id ? 700 : 500,
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: view === tab.id ? '0 4px 20px var(--yellow-glow)' : 'none'
              }}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

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
          <div>
            {/* Show history banner if viewing past day */}
            {viewingPastWorkout && (
              <div style={{
                background: 'var(--blue-dim)',
                border: '1px solid rgba(0, 180, 216, 0.3)',
                borderRadius: '12px',
                padding: '14px 16px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <History size={20} style={{ color: 'var(--blue)' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--blue)', fontSize: '14px' }}>
                    Просмотр истории
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {currentDayLog.workoutSnapshot?.workoutName} • {new Date(dateKey).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                  </div>
                </div>
                <button
                  onClick={() => closeDay(currentDayLog.workoutCompleted!, false)}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    color: 'var(--text-muted)',
                    fontSize: '12px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer'
                  }}
                >
                  <Edit2 size={14} />
                  Изменить
                </button>
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
                  const today = new Date();
                  const todayStr = formatDate(today);
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

                    // Show completed workout label (T1, T2, etc.) or dash for rest days
                    const completedWorkoutId = log?.workoutCompleted;
                    const completedWorkout = completedWorkoutId
                      ? workouts.find(w => w.id === completedWorkoutId)
                      : null;
                    const workoutLabel = isClosed && completedWorkout
                      ? completedWorkout.name.replace('Тренировка ', 'T')
                      : isRestDay ? '—' : '';

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
                            : isClosed
                              ? 'var(--green-dim)'
                              : 'var(--bg-elevated)',
                          border: isToday
                            ? '2px solid var(--yellow)'
                            : isClosed && !isSelected
                              ? '1px solid rgba(0, 200, 83, 0.3)'
                              : '1px solid var(--border)',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          opacity: isSelected ? 1 : isFuture ? 0.4 : (isRestDay || isEmptyDay) ? 0.5 : 1,
                          boxShadow: isSelected
                            ? '0 2px 10px var(--yellow-glow)'
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
                          color: isSelected ? '#000' : isClosed ? 'var(--green)' : 'var(--text-primary)'
                        }}>
                          {date.getDate()}
                        </span>
                        {(isClosed || isRestDay) && (
                          <span style={{
                            fontSize: '9px',
                            fontWeight: 600,
                            color: isSelected ? '#000' : isClosed ? 'var(--green)' : 'var(--text-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1px'
                          }}>
                            {isClosed && <Check size={8} strokeWidth={3} />}
                            {workoutLabel}
                          </span>
                        )}
                      </button>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Workout selector - hidden when viewing history */}
            {!viewingPastWorkout && (
              <div style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '16px',
                alignItems: 'center'
              }}>
                <div style={{
                  display: 'flex',
                  gap: '8px',
                  flex: 1,
                  overflowX: 'auto',
                  paddingBottom: '4px'
                }}>
                  {workouts.map(w => {
                    const isEmpty = w.exercises.length === 0;
                    const isActive = selectedWorkout === w.id;
                    return (
                      <button
                        key={w.id}
                        onClick={() => selectWorkout(w.id)}
                        style={{
                          padding: '12px 20px',
                          background: isActive
                            ? 'var(--yellow)'
                            : 'var(--bg-card)',
                          border: isActive ? 'none' : '1px solid var(--border)',
                          borderRadius: '12px',
                          color: isActive ? '#000' : isEmpty ? 'var(--text-muted)' : 'var(--text-primary)',
                          fontWeight: isActive ? 700 : 500,
                          fontSize: '14px',
                          whiteSpace: 'nowrap',
                          boxShadow: isActive ? '0 4px 20px var(--yellow-glow)' : 'none',
                          opacity: isActive ? 1 : isEmpty ? 0.5 : 1
                        }}
                      >
                        {w.name.replace('Тренировка ', 'T')}
                      </button>
                    );
                  })}
                  {workouts.length < MAX_WORKOUTS && (
                    <button
                      onClick={addNewWorkout}
                      style={{
                        padding: '12px 16px',
                        background: 'var(--bg-elevated)',
                        border: '1px dashed var(--border-strong)',
                        borderRadius: '12px',
                        color: 'var(--text-muted)',
                        fontWeight: 600,
                        fontSize: '14px',
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
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
                    padding: '12px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
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

            {/* Compact Progress bar */}
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
            </div>

            {/* Exercise list */}
            {displayExercises.length > 0 ? (
              displayExercises.map((ex, idx) => {
                const workoutId = viewingPastWorkout ? currentDayLog.workoutSnapshot!.workoutId : currentWorkout.id;
                const exerciseKey = `${workoutId}-${ex.id}`;
                return (
                  <ExerciseCard
                    key={ex.id}
                    ex={ex}
                    idx={idx}
                    workoutId={workoutId}
                    onToggle={() => !viewingPastWorkout && updateExercise(currentWorkout.id, ex.id, { completed: !ex.completed })}
                    onUpdate={(updates) => !viewingPastWorkout && updateExercise(currentWorkout.id, ex.id, updates)}
                    progressHistory={progressHistory[exerciseKey] || []}
                    onSaveProgress={(weight, notes) => {
                      if (viewingPastWorkout) return;
                      const newEntry: ExerciseProgress = {
                        date: formatDate(selectedDate),
                        weight,
                        notes
                      };
                      setProgressHistory(prev => ({
                        ...prev,
                        [exerciseKey]: [...(prev[exerciseKey] || []), newEntry]
                      }));
                    }}
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
                  День отдыха
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
                  Нет запланированных упражнений
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
            )}

            {/* Steps alert */}
            {!currentDayLog.dayClosed && completedExercises === totalExercises && totalExercises > 0 && (!currentDayLog.steps || currentDayLog.steps === 0) && (
              <div
                ref={stepsAlertRef}
                className={stepsAlertPulse ? 'animate-pulse' : ''}
                style={{
                  marginTop: '16px',
                  padding: '12px 16px',
                  background: stepsAlertPulse ? 'var(--yellow)' : 'var(--yellow-dim)',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 232, 4, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  color: stepsAlertPulse ? '#000' : 'var(--yellow)',
                  transition: 'all 0.3s ease',
                  boxShadow: stepsAlertPulse ? '0 4px 20px var(--yellow-glow)' : 'none'
                }}
              >
                <Footprints size={18} />
                <span style={{ fontSize: '14px', fontWeight: 600 }}>Добавьте шаги чтобы закрыть день</span>
              </div>
            )}

            {/* Steps input */}
            <div style={{
              marginTop: '16px',
              padding: '20px',
              background: 'var(--bg-card)',
              borderRadius: '16px',
              border: '1px solid var(--border)'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                flexWrap: 'wrap'
              }}>
                <div style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: currentDayLog.steps && currentDayLog.steps > 0
                    ? 'var(--blue-dim)'
                    : 'var(--bg-elevated)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px solid ${currentDayLog.steps && currentDayLog.steps > 0
                    ? 'rgba(0, 180, 216, 0.3)'
                    : 'var(--border)'}`
                }}>
                  <Footprints
                    size={22}
                    style={{
                      color: currentDayLog.steps && currentDayLog.steps > 0
                        ? 'var(--blue)'
                        : 'var(--text-muted)'
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{
                    fontSize: '13px',
                    color: 'var(--text-muted)',
                    display: 'block',
                    marginBottom: '6px'
                  }}>
                    Шаги за день
                  </label>
                  <input
                    type="number"
                    value={currentDayLog.steps || ''}
                    onChange={(e) => updateDayLog({ steps: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="0"
                    style={{
                      width: '100%',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      padding: '12px 16px',
                      color: 'var(--blue)',
                      fontSize: '18px',
                      fontWeight: 700
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Close/Open day button */}
            {(totalExercises > 0 || currentDayLog.dayClosed) && (
            <div style={{ marginTop: '16px', marginBottom: '20px' }}>
              {(() => {
                const isDayClosed = currentDayLog.dayClosed;
                const canCloseDay = completedExercises === totalExercises && currentDayLog.steps && currentDayLog.steps > 0;
                const readyToClose = canCloseDay && !isDayClosed;

                return (
                  <>
                    {readyToClose && (
                      <div style={{
                        textAlign: 'center',
                        marginBottom: '12px',
                        color: 'var(--green)',
                        fontSize: '14px',
                        fontWeight: 600
                      }}
                      className="animate-pulse"
                      >
                        ✨ Всё готово! Закройте день ✨
                      </div>
                    )}
                    <button
                      onClick={() => {
                        // If no steps, scroll to alert and pulse
                        if (!isDayClosed && (!currentDayLog.steps || currentDayLog.steps === 0)) {
                          stepsAlertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          setStepsAlertPulse(true);
                          setTimeout(() => setStepsAlertPulse(false), 2000);
                          return;
                        }
                      }}
                      onMouseDown={(e) => {
                        // If no steps and not closed, don't start hold action
                        if (!isDayClosed && (!currentDayLog.steps || currentDayLog.steps === 0)) {
                          return;
                        }
                        const btn = e.currentTarget;
                        btn.dataset.pressing = 'true';
                        btn.dataset.progress = '0';
                        const interval = setInterval(() => {
                          if (btn.dataset.pressing !== 'true') {
                            clearInterval(interval);
                            btn.style.background = isDayClosed
                              ? 'var(--green)'
                              : readyToClose
                                ? 'var(--green-dim)'
                                : 'var(--bg-card)';
                            return;
                          }
                          const progress = parseInt(btn.dataset.progress || '0') + 5;
                          btn.dataset.progress = progress.toString();
                          btn.style.background = `linear-gradient(90deg, var(--green) ${progress}%, ${readyToClose ? 'var(--green-dim)' : 'var(--bg-card)'} ${progress}%)`;
                          if (progress >= 100) {
                            clearInterval(interval);
                            // Only allow closing if canCloseDay, or opening if already closed
                            if (isDayClosed) {
                              closeDay(currentDayLog.workoutCompleted!, false);
                            } else if (canCloseDay) {
                              closeDay(currentWorkout.id, true);
                            }
                            btn.style.background = !isDayClosed
                              ? 'var(--green)'
                              : readyToClose
                                ? 'var(--green-dim)'
                                : 'var(--bg-card)';
                          }
                        }, 30);
                      }}
                      onMouseUp={(e) => { e.currentTarget.dataset.pressing = 'false'; }}
                      onMouseLeave={(e) => { e.currentTarget.dataset.pressing = 'false'; }}
                      onTouchStart={(e) => {
                        // If no steps and not closed, scroll to alert
                        if (!isDayClosed && (!currentDayLog.steps || currentDayLog.steps === 0)) {
                          stepsAlertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          setStepsAlertPulse(true);
                          setTimeout(() => setStepsAlertPulse(false), 2000);
                          return;
                        }
                        const btn = e.currentTarget;
                        btn.dataset.pressing = 'true';
                        btn.dataset.progress = '0';
                        const interval = setInterval(() => {
                          if (btn.dataset.pressing !== 'true') {
                            clearInterval(interval);
                            btn.style.background = isDayClosed
                              ? 'var(--green)'
                              : readyToClose
                                ? 'var(--green-dim)'
                                : 'var(--bg-card)';
                            return;
                          }
                          const progress = parseInt(btn.dataset.progress || '0') + 5;
                          btn.dataset.progress = progress.toString();
                          btn.style.background = `linear-gradient(90deg, var(--green) ${progress}%, ${readyToClose ? 'var(--green-dim)' : 'var(--bg-card)'} ${progress}%)`;
                          if (progress >= 100) {
                            clearInterval(interval);
                            // Only allow closing if canCloseDay, or opening if already closed
                            if (isDayClosed) {
                              closeDay(currentDayLog.workoutCompleted!, false);
                            } else if (canCloseDay) {
                              closeDay(currentWorkout.id, true);
                            }
                            btn.style.background = !isDayClosed
                              ? 'var(--green)'
                              : readyToClose
                                ? 'var(--green-dim)'
                                : 'var(--bg-card)';
                          }
                        }, 30);
                      }}
                      onTouchEnd={(e) => { e.currentTarget.dataset.pressing = 'false'; }}
                      style={{
                        width: '100%',
                        padding: '20px',
                        background: isDayClosed
                          ? 'var(--green)'
                          : readyToClose
                            ? 'var(--green-dim)'
                            : 'var(--bg-card)',
                        border: `2px solid ${isDayClosed ? 'var(--green)' : readyToClose ? 'var(--yellow)' : 'var(--border)'}`,
                        borderRadius: '16px',
                        color: isDayClosed ? '#000' : readyToClose ? 'var(--yellow)' : 'var(--text-primary)',
                        fontWeight: 700,
                        fontSize: '15px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        boxShadow: isDayClosed
                          ? '0 4px 20px var(--green-glow)'
                          : readyToClose
                            ? '0 4px 20px var(--yellow-glow)'
                            : 'none'
                      }}
                      className={readyToClose ? 'animate-glow' : ''}
                    >
                      {isDayClosed ? (
                        <>
                          <Check size={22} />
                          Открыть день
                        </>
                      ) : (
                        <>
                          {readyToClose && <Check size={20} />}
                          Закрыть день
                        </>
                      )}
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
              />
            </div>
          </div>
        )}

        {/* NUTRITION VIEW */}
        {view === 'nutrition' && (
          <div>
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
              <Target size={14} style={{ color: 'var(--text-muted)' }} />
              <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500 }}>Цель:</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--blue)' }}>{MACRO_TARGETS.protein} Б</span>
              <span style={{ color: 'var(--border-strong)' }}>|</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--yellow)' }}>{MACRO_TARGETS.fat} Ж</span>
              <span style={{ color: 'var(--border-strong)' }}>|</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--green)' }}>{MACRO_TARGETS.carbs} У</span>
              <span style={{ color: 'var(--border-strong)' }}>|</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--red)' }}>{MACRO_TARGETS.calories} ккал</span>
            </div>

            {/* Compact Macro summary - 2x2 grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '8px',
              marginBottom: '16px'
            }}>
              {/* Protein */}
              <div style={{
                background: 'var(--bg-card)',
                padding: '12px',
                borderRadius: '12px',
                border: '1px solid var(--border)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px'
                }}>
                  <span style={{ fontSize: '11px', color: 'var(--blue)', fontWeight: 600 }}>Б</span>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--blue)' }}>{macroTotals.protein}<span style={{ fontSize: '12px', fontWeight: 500 }}>/{MACRO_TARGETS.protein}</span></span>
                </div>
                <div style={{ height: '3px', background: 'var(--bg-elevated)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${macroProgress.protein}%`, height: '100%', background: 'var(--blue)', borderRadius: '2px' }} />
                </div>
              </div>

              {/* Fat */}
              <div style={{
                background: 'var(--bg-card)',
                padding: '12px',
                borderRadius: '12px',
                border: '1px solid var(--border)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px'
                }}>
                  <span style={{ fontSize: '11px', color: 'var(--yellow)', fontWeight: 600 }}>Ж</span>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--yellow)' }}>{macroTotals.fat}<span style={{ fontSize: '12px', fontWeight: 500 }}>/{MACRO_TARGETS.fat}</span></span>
                </div>
                <div style={{ height: '3px', background: 'var(--bg-elevated)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${macroProgress.fat}%`, height: '100%', background: 'var(--yellow)', borderRadius: '2px' }} />
                </div>
              </div>

              {/* Carbs */}
              <div style={{
                background: 'var(--bg-card)',
                padding: '12px',
                borderRadius: '12px',
                border: '1px solid var(--border)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px'
                }}>
                  <span style={{ fontSize: '11px', color: 'var(--green)', fontWeight: 600 }}>У</span>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--green)' }}>{macroTotals.carbs}<span style={{ fontSize: '12px', fontWeight: 500 }}>/{MACRO_TARGETS.carbs}</span></span>
                </div>
                <div style={{ height: '3px', background: 'var(--bg-elevated)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${macroProgress.carbs}%`, height: '100%', background: 'var(--green)', borderRadius: '2px' }} />
                </div>
              </div>

              {/* Calories */}
              <div style={{
                background: 'var(--bg-card)',
                padding: '12px',
                borderRadius: '12px',
                border: '1px solid var(--border)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px'
                }}>
                  <span style={{ fontSize: '11px', color: 'var(--red)', fontWeight: 600 }}>ккал</span>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--red)' }}>{macroTotals.calories}<span style={{ fontSize: '12px', fontWeight: 500 }}>/{MACRO_TARGETS.calories}</span></span>
                </div>
                <div style={{ height: '3px', background: 'var(--bg-elevated)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${macroProgress.calories}%`, height: '100%', background: 'var(--red)', borderRadius: '2px' }} />
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
              <h3 style={{ margin: 0, fontWeight: 700, fontSize: '18px' }}>Приёмы пищи</h3>
              <button
                onClick={() => {
                  setEditingMeal(null);
                  setMealForm({ time: '', name: '', protein: '', fat: '', carbs: '', calories: '' });
                  setShowMealModal(true);
                }}
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
                <Plus size={18} /> Добавить
              </button>
            </div>

            {/* Meals list */}
            {currentDayLog.meals.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: 'var(--text-muted)',
                background: 'var(--bg-card)',
                borderRadius: '12px',
                border: '1px solid var(--border)'
              }}>
                <Apple size={40} style={{ opacity: 0.3, marginBottom: '12px' }} />
                <div style={{ fontSize: '14px', fontWeight: 500 }}>Нет записей о питании</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>Добавьте первый приём пищи</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {currentDayLog.meals.map(meal => (
                  <div
                    key={meal.id}
                    className="card-hover"
                    style={{
                      background: 'var(--bg-card)',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      border: '1px solid var(--border)'
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
                <span style={{ fontWeight: 700, fontSize: '15px' }}>Когда есть</span>
              </div>
              <div style={{ padding: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{
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
                      background: 'var(--yellow-dim)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <span style={{ fontSize: '16px' }}>🌅</span>
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>Утро</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Белок + углеводы. Творог, яйца, каша или рисовые хлебцы
                      </div>
                    </div>
                  </div>

                  <div style={{
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
                      background: 'var(--green-dim)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <span style={{ fontSize: '16px' }}>💪</span>
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>До тренировки (1-2 часа)</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Углеводы + немного белка. Рис, картофель, курица
                      </div>
                    </div>
                  </div>

                  <div style={{
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
                      background: 'var(--blue-dim)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <span style={{ fontSize: '16px' }}>🏋️</span>
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>После тренировки (до 1 часа)</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Быстрые углеводы + белок. Whey + банан или рисовые хлебцы
                      </div>
                    </div>
                  </div>

                  <div style={{
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
                      background: 'var(--red-dim)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <span style={{ fontSize: '16px' }}>🌙</span>
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>Вечер / перед сном</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Белок + жиры, минимум углеводов. Творог, казеин, рыба
                      </div>
                    </div>
                  </div>
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

        {/* CALENDAR VIEW */}
        {view === 'calendar' && (
          <FitnessCalendar
            dayLogs={dayLogs}
            selectedDate={selectedDate}
            onSelectDate={(date) => {
              setSelectedDate(date);
              setView('workout');
              localStorage.setItem('fitness_view', 'workout');
            }}
            workouts={workouts}
          />
        )}
      </div>

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
                {editingMeal ? 'Редактировать' : 'Добавить приём пищи'}
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

            <div style={{ display: 'grid', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '12px' }}>
                <div>
                  <label style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    marginBottom: '8px',
                    display: 'block',
                    fontWeight: 500
                  }}>
                    Время
                  </label>
                  <input
                    type="time"
                    value={mealForm.time}
                    onChange={e => setMealForm({ ...mealForm, time: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    marginBottom: '8px',
                    display: 'block',
                    fontWeight: 500
                  }}>
                    Название
                  </label>
                  <input
                    type="text"
                    placeholder="Творог с вареньем"
                    value={mealForm.name}
                    onChange={e => setMealForm({ ...mealForm, name: e.target.value })}
                    style={{ width: '100%' }}
                  />
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
                    Белок
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
                    Жиры
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
                    Углев
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
                    Ккал
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
                Отмена
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
                {editingMeal ? 'Сохранить' : 'Добавить'}
              </button>
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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <input
                      type="text"
                      placeholder="Подходы (3x12)"
                      value={exerciseForm.plannedSets}
                      onChange={e => setExerciseForm({ ...exerciseForm, plannedSets: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="Отдых (2-3 мин)"
                      value={exerciseForm.restTime}
                      onChange={e => setExerciseForm({ ...exerciseForm, restTime: e.target.value })}
                    />
                  </div>
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
    </main>
  );
}

'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Plus, X, Dumbbell, Apple, ChevronLeft, ChevronRight, Check,
  Flame, Target, TrendingUp, Edit2, Trash2, Save, ChevronDown,
  ChevronUp, Calendar, Cloud, CloudOff, Footprints, History,
  Zap, Award, Timer, Play, Pause, RotateCcw
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
            ? 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)'
            : isRunning
              ? 'var(--red-dim)'
              : 'var(--blue-dim)',
          border: `1px solid ${isFinished ? 'var(--green)' : isRunning ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
          borderRadius: '10px',
          color: isFinished ? '#000' : isRunning ? 'var(--red)' : 'var(--blue)',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 700,
          minWidth: '100px',
          boxShadow: isFinished ? '0 4px 15px rgba(34, 197, 94, 0.4)' : 'none',
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

interface DayLog {
  date: string;
  workoutCompleted: string | null;
  workoutRating: number | null;
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
  }
];

const MACRO_TARGETS = {
  protein: 200,
  fat: 90,
  carbs: 200,
  calories: 2410
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
        background: ex.completed
          ? 'linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.05) 100%)'
          : 'var(--bg-card)',
        borderRadius: '16px',
        border: `1px solid ${ex.completed ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
        overflow: 'hidden',
        marginBottom: '12px',
        transition: 'all 0.3s ease'
      }}
    >
      {/* Main row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '16px',
          gap: '14px',
          cursor: 'pointer'
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            border: ex.completed ? 'none' : '2px solid var(--border-strong)',
            background: ex.completed
              ? 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)'
              : 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#000',
            flexShrink: 0,
            boxShadow: ex.completed ? '0 4px 15px rgba(34, 197, 94, 0.4)' : 'none',
            transition: 'all 0.2s ease'
          }}
        >
          {ex.completed && <Check size={20} strokeWidth={3} />}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 600,
            fontSize: '15px',
            marginBottom: '4px',
            color: ex.completed ? 'var(--green)' : 'var(--text-primary)'
          }}>
            <span style={{
              color: 'var(--text-muted)',
              fontSize: '13px',
              marginRight: '6px'
            }}>
              {idx + 1}.
            </span>
            {ex.name}
          </div>
          <div style={{
            fontSize: '13px',
            color: 'var(--blue)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Zap size={12} />
            {ex.plannedSets}
          </div>
          {ex.notes && (
            <div style={{
              fontSize: '12px',
              color: 'var(--yellow)',
              marginTop: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <Award size={12} />
              {ex.notes}
            </div>
          )}
        </div>

        <div style={{
          color: 'var(--text-muted)',
          transition: 'transform 0.2s ease',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0)'
        }}>
          <ChevronDown size={20} />
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
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
                  color: 'var(--green)',
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
                  background: 'var(--green-dim)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  borderRadius: '10px',
                  color: 'var(--green)',
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
                  border: '1px solid rgba(59, 130, 246, 0.3)',
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
          const hasWorkout = log?.dayClosed;
          const hasSteps = log?.steps && log.steps > 0 && !hasWorkout;

          return (
            <button
              key={d.day}
              onClick={() => onSelectDate(new Date(d.dateStr))}
              style={{
                aspectRatio: '1',
                background: isSelected
                  ? 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)'
                  : hasWorkout
                    ? 'var(--green-dim)'
                    : hasSteps
                      ? 'var(--blue-dim)'
                      : 'transparent',
                border: isToday
                  ? '2px solid var(--blue)'
                  : '1px solid transparent',
                borderRadius: '10px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2px',
                color: isSelected ? '#000' : hasWorkout ? 'var(--green)' : 'var(--text-primary)',
                fontWeight: isToday || isSelected ? 700 : 500,
                fontSize: '14px',
                transition: 'all 0.2s ease',
                boxShadow: isSelected ? '0 4px 15px rgba(34, 197, 94, 0.4)' : 'none'
              }}
            >
              <span>{d.day}</span>
              {(hasWorkout || hasSteps) && !isSelected && (
                <div style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: hasWorkout ? 'var(--green)' : 'var(--blue)'
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{
        padding: '12px 16px 16px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        gap: '16px',
        justifyContent: 'center',
        flexWrap: 'wrap'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '12px',
          color: 'var(--text-muted)'
        }}>
          <div style={{
            width: '12px',
            height: '12px',
            borderRadius: '4px',
            background: 'var(--green-dim)',
            border: '1px solid rgba(34, 197, 94, 0.3)'
          }} />
          Тренировка
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '12px',
          color: 'var(--text-muted)'
        }}>
          <div style={{
            width: '12px',
            height: '12px',
            borderRadius: '4px',
            background: 'var(--blue-dim)',
            border: '1px solid rgba(59, 130, 246, 0.3)'
          }} />
          Только шаги
        </div>
      </div>
    </div>
  );
}

export default function FitnessPage() {
  const [view, setView] = useState<'workout' | 'nutrition' | 'calendar'>('workout');
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [workouts, setWorkouts] = useState<Workout[]>(DEFAULT_WORKOUTS);
  const [selectedWorkout, setSelectedWorkout] = useState<string>('t1');
  const [dayLogs, setDayLogs] = useState<Record<string, DayLog>>({});
  const [showMealModal, setShowMealModal] = useState(false);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [mealForm, setMealForm] = useState({ time: '', name: '', protein: '', fat: '', carbs: '', calories: '' });
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [isLoaded, setIsLoaded] = useState(false);
  const [progressHistory, setProgressHistory] = useState<ProgressHistory>({});
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    return dayLogs[dateKey] || { date: dateKey, workoutCompleted: null, workoutRating: null, meals: [], notes: '', steps: null, dayClosed: false };
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

  const currentWorkout = workouts.find(w => w.id === selectedWorkout) || workouts[0];
  const completedExercises = currentWorkout.exercises.filter(e => e.completed).length;
  const totalExercises = currentWorkout.exercises.length;
  const progressPercent = (completedExercises / totalExercises) * 100;

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
              background: 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 15px rgba(34, 197, 94, 0.3)'
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
              onClick={() => setView(tab.id as typeof view)}
              style={{
                flex: 1,
                padding: '12px',
                background: view === tab.id
                  ? 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)'
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
                boxShadow: view === tab.id ? '0 4px 15px rgba(34, 197, 94, 0.3)' : 'none'
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
            {/* Workout selector */}
            <div style={{
              display: 'flex',
              gap: '8px',
              marginBottom: '16px',
              overflowX: 'auto',
              paddingBottom: '4px'
            }}>
              {workouts.map(w => (
                <button
                  key={w.id}
                  onClick={() => setSelectedWorkout(w.id)}
                  style={{
                    padding: '12px 20px',
                    background: selectedWorkout === w.id
                      ? 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)'
                      : 'var(--bg-card)',
                    border: selectedWorkout === w.id ? 'none' : '1px solid var(--border)',
                    borderRadius: '12px',
                    color: selectedWorkout === w.id ? '#000' : 'var(--text-primary)',
                    fontWeight: selectedWorkout === w.id ? 700 : 500,
                    fontSize: '14px',
                    whiteSpace: 'nowrap',
                    boxShadow: selectedWorkout === w.id ? '0 4px 15px rgba(34, 197, 94, 0.3)' : 'none'
                  }}
                >
                  {w.name.replace('Тренировка ', 'T')}
                </button>
              ))}
            </div>

            {/* Progress bar */}
            <div style={{
              background: 'var(--bg-card)',
              padding: '16px',
              borderRadius: '16px',
              marginBottom: '16px',
              border: '1px solid var(--border)'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px'
              }}>
                <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                  Прогресс тренировки
                </span>
                <span style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--green)'
                }}>
                  {completedExercises}/{totalExercises}
                </span>
              </div>
              <div style={{
                height: '8px',
                background: 'var(--bg-elevated)',
                borderRadius: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--green) 0%, #16a34a 100%)',
                  borderRadius: '4px',
                  transition: 'width 0.3s ease',
                  boxShadow: progressPercent > 0 ? '0 0 10px rgba(34, 197, 94, 0.5)' : 'none'
                }} />
              </div>
            </div>

            {/* Exercise list */}
            {currentWorkout.exercises.map((ex, idx) => {
              const exerciseKey = `${currentWorkout.id}-${ex.id}`;
              return (
                <ExerciseCard
                  key={ex.id}
                  ex={ex}
                  idx={idx}
                  workoutId={currentWorkout.id}
                  onToggle={() => updateExercise(currentWorkout.id, ex.id, { completed: !ex.completed })}
                  onUpdate={(updates) => updateExercise(currentWorkout.id, ex.id, updates)}
                  progressHistory={progressHistory[exerciseKey] || []}
                  onSaveProgress={(weight, notes) => {
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
            })}

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
                    ? 'rgba(59, 130, 246, 0.3)'
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

            {/* Close day button */}
            <div style={{ marginTop: '16px' }}>
              {(() => {
                const closedWorkoutId = currentDayLog.workoutCompleted;
                const closedWorkout = closedWorkoutId ? workouts.find(w => w.id === closedWorkoutId) : null;
                const isThisWorkoutClosed = currentDayLog.dayClosed && closedWorkoutId === currentWorkout.id;
                const canCloseDay = completedExercises === totalExercises && currentDayLog.steps && currentDayLog.steps > 0;
                const readyToClose = canCloseDay && !isThisWorkoutClosed;

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
                    {!canCloseDay && !isThisWorkoutClosed && (
                      <div style={{
                        textAlign: 'center',
                        marginBottom: '12px',
                        color: 'var(--text-muted)',
                        fontSize: '13px'
                      }}>
                        {completedExercises < totalExercises && `Упражнения: ${completedExercises}/${totalExercises}`}
                        {completedExercises < totalExercises && (!currentDayLog.steps || currentDayLog.steps === 0) && ' • '}
                        {(!currentDayLog.steps || currentDayLog.steps === 0) && 'Добавьте шаги'}
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
                            btn.style.background = isThisWorkoutClosed
                              ? 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)'
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
                            updateDayLog({ dayClosed: !isThisWorkoutClosed, workoutCompleted: isThisWorkoutClosed ? null : currentWorkout.id });
                            btn.style.background = !isThisWorkoutClosed
                              ? 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)'
                              : readyToClose
                                ? 'var(--green-dim)'
                                : 'var(--bg-card)';
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
                            btn.style.background = isThisWorkoutClosed
                              ? 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)'
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
                            updateDayLog({ dayClosed: !isThisWorkoutClosed, workoutCompleted: isThisWorkoutClosed ? null : currentWorkout.id });
                            btn.style.background = !isThisWorkoutClosed
                              ? 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)'
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
                        background: isThisWorkoutClosed
                          ? 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)'
                          : readyToClose
                            ? 'var(--green-dim)'
                            : 'var(--bg-card)',
                        border: `2px solid ${isThisWorkoutClosed || readyToClose ? 'var(--green)' : 'var(--border)'}`,
                        borderRadius: '16px',
                        color: isThisWorkoutClosed ? '#000' : readyToClose ? 'var(--green)' : 'var(--text-primary)',
                        fontWeight: 700,
                        fontSize: '15px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        boxShadow: (isThisWorkoutClosed || readyToClose)
                          ? '0 4px 20px rgba(34, 197, 94, 0.3)'
                          : 'none'
                      }}
                      className={readyToClose ? 'animate-glow' : ''}
                    >
                      {isThisWorkoutClosed ? (
                        <>
                          <Check size={22} />
                          День закрыт ({closedWorkout?.name.replace('Тренировка ', 'T') || currentWorkout.name.replace('Тренировка ', 'T')})
                        </>
                      ) : (
                        <>
                          {readyToClose && <Check size={20} />}
                          Удерживайте чтобы закрыть день
                        </>
                      )}
                    </button>
                  </>
                );
              })()}
            </div>

            {/* Mini calendar */}
            <div style={{ marginTop: '20px' }}>
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
            {/* Macro summary */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '12px',
              marginBottom: '20px'
            }}>
              {/* Protein */}
              <div style={{
                background: 'var(--bg-card)',
                padding: '16px',
                borderRadius: '16px',
                border: '1px solid var(--border)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px'
                }}>
                  <span style={{
                    fontSize: '12px',
                    color: 'var(--blue)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Белок</span>
                  <Target size={16} style={{ color: 'var(--blue)' }} />
                </div>
                <div style={{ fontSize: '26px', fontWeight: 700 }}>{macroTotals.protein}г</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  из {MACRO_TARGETS.protein}г
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${macroProgress.protein}%`, background: 'var(--blue)' }}
                  />
                </div>
              </div>

              {/* Fat */}
              <div style={{
                background: 'var(--bg-card)',
                padding: '16px',
                borderRadius: '16px',
                border: '1px solid var(--border)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px'
                }}>
                  <span style={{
                    fontSize: '12px',
                    color: 'var(--yellow)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Жиры</span>
                  <Target size={16} style={{ color: 'var(--yellow)' }} />
                </div>
                <div style={{ fontSize: '26px', fontWeight: 700 }}>{macroTotals.fat}г</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  из {MACRO_TARGETS.fat}г
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${macroProgress.fat}%`, background: 'var(--yellow)' }}
                  />
                </div>
              </div>

              {/* Carbs */}
              <div style={{
                background: 'var(--bg-card)',
                padding: '16px',
                borderRadius: '16px',
                border: '1px solid var(--border)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px'
                }}>
                  <span style={{
                    fontSize: '12px',
                    color: 'var(--green)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Углеводы</span>
                  <Target size={16} style={{ color: 'var(--green)' }} />
                </div>
                <div style={{ fontSize: '26px', fontWeight: 700 }}>{macroTotals.carbs}г</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  из {MACRO_TARGETS.carbs}г
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${macroProgress.carbs}%`, background: 'var(--green)' }}
                  />
                </div>
              </div>

              {/* Calories */}
              <div style={{
                background: 'var(--bg-card)',
                padding: '16px',
                borderRadius: '16px',
                border: '1px solid var(--border)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px'
                }}>
                  <span style={{
                    fontSize: '12px',
                    color: 'var(--red)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>Калории</span>
                  <Flame size={16} style={{ color: 'var(--red)' }} />
                </div>
                <div style={{ fontSize: '26px', fontWeight: 700 }}>{macroTotals.calories}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  из {MACRO_TARGETS.calories}
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${macroProgress.calories}%`, background: 'var(--red)' }}
                  />
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
                  background: 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#000',
                  fontWeight: 700,
                  fontSize: '14px',
                  boxShadow: '0 4px 15px rgba(34, 197, 94, 0.3)'
                }}
              >
                <Plus size={18} /> Добавить
              </button>
            </div>

            {/* Meals list */}
            {currentDayLog.meals.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '60px 20px',
                color: 'var(--text-muted)',
                background: 'var(--bg-card)',
                borderRadius: '16px',
                border: '1px solid var(--border)'
              }}>
                <Apple size={56} style={{ opacity: 0.3, marginBottom: '16px' }} />
                <div style={{ fontSize: '16px', fontWeight: 500 }}>Нет записей о питании</div>
                <div style={{ fontSize: '13px', marginTop: '4px' }}>Добавьте первый приём пищи</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {currentDayLog.meals.map(meal => (
                  <div
                    key={meal.id}
                    className="card-hover"
                    style={{
                      background: 'var(--bg-card)',
                      padding: '16px',
                      borderRadius: '16px',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '12px'
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '16px' }}>
                          {meal.name}
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                          {meal.time}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => openEditMeal(meal)}
                          style={{
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            padding: '10px',
                            color: 'var(--text-muted)'
                          }}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => deleteMeal(meal.id)}
                          style={{
                            background: 'var(--red-dim)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '8px',
                            padding: '10px',
                            color: 'var(--red)'
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: '8px'
                    }}>
                      <div style={{
                        textAlign: 'center',
                        padding: '10px 6px',
                        background: 'var(--blue-dim)',
                        borderRadius: '10px'
                      }}>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--blue)' }}>
                          {meal.protein}г
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Белок
                        </div>
                      </div>
                      <div style={{
                        textAlign: 'center',
                        padding: '10px 6px',
                        background: 'var(--yellow-dim)',
                        borderRadius: '10px'
                      }}>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--yellow)' }}>
                          {meal.fat}г
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Жиры
                        </div>
                      </div>
                      <div style={{
                        textAlign: 'center',
                        padding: '10px 6px',
                        background: 'var(--green-dim)',
                        borderRadius: '10px'
                      }}>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--green)' }}>
                          {meal.carbs}г
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Углев
                        </div>
                      </div>
                      <div style={{
                        textAlign: 'center',
                        padding: '10px 6px',
                        background: 'var(--red-dim)',
                        borderRadius: '10px'
                      }}>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--red)' }}>
                          {meal.calories}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Ккал
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                  background: 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#000',
                  fontWeight: 700,
                  fontSize: '15px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 15px rgba(34, 197, 94, 0.3)'
                }}
              >
                <Save size={18} />
                {editingMeal ? 'Сохранить' : 'Добавить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

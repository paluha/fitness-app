'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Calendar,
  Utensils,
  Scale,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  Dumbbell,
  Plus,
  Trash2,
  Save,
  X,
  Timer,
  Edit2,
  Video,
  ExternalLink,
  Footprints,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface Exercise {
  id: string;
  name: string;
  plannedSets: string;
  actualSets: string;
  newWeight: string;
  completed: boolean;
  videoUrl?: string;
}

interface Workout {
  id: string;
  name: string;
  exercises: Exercise[];
}

interface Meal {
  id: string;
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
  selectedWorkout: string | null;
  workoutCompleted: string | null;
  workoutRating: number | null;
  workoutSnapshot?: WorkoutSnapshot | null;
  meals: Meal[];
  notes: string;
  steps: number | null;
  dayClosed: boolean;
  isOffDay?: boolean;
}

interface BodyMeasurement {
  id: string;
  date: string;
  weight?: number;
  waist?: number;
  chest?: number;
  biceps?: number;
  bicepsLeft?: number;
  bicepsRight?: number;
  thighs?: number;
  hips?: number;
  notes?: string;
}

interface ExerciseProgress {
  date: string;
  weight: string;
  notes: string;
}

interface NutritionRecommendation {
  id: string;
  emoji: string;
  title: string;
  description: string;
  color: 'yellow' | 'green' | 'blue' | 'red' | 'purple';
}

const RECOMMENDATION_COLORS = [
  { value: 'yellow', label: '🌅 Желтый', bg: 'rgba(255,204,0,0.2)' },
  { value: 'green', label: '💪 Зеленый', bg: 'rgba(34,197,94,0.2)' },
  { value: 'blue', label: '🏋️ Синий', bg: 'rgba(59,130,246,0.2)' },
  { value: 'red', label: '🌙 Красный', bg: 'rgba(239,68,68,0.2)' },
  { value: 'purple', label: '⭐ Фиолетовый', bg: 'rgba(139,92,246,0.2)' }
];

const COLOR_BG_MAP: Record<string, string> = {
  yellow: 'rgba(255,204,0,0.2)',
  green: 'rgba(34,197,94,0.2)',
  blue: 'rgba(59,130,246,0.2)',
  red: 'rgba(239,68,68,0.2)',
  purple: 'rgba(139,92,246,0.2)'
};

interface ClientData {
  client: {
    id: string;
    clientId: string | null;
    firstName: string | null;
    lastName: string | null;
    name: string | null;
    email: string;
    createdAt: string;
    programId: string | null;
    programName: string | null;
  };
  fitnessData: {
    workouts: Workout[] | null;
    dayLogs: Record<string, DayLog>;
    progressHistory: Record<string, ExerciseProgress[]>;
    bodyMeasurements: BodyMeasurement[];
    lastUpdated: string | null;
  };
  nutritionRecommendations: NutritionRecommendation[] | null;
}

type TabType = 'workouts' | 'nutrition' | 'measurements' | 'progress';

// Sparkline component for progress visualization
function Sparkline({ data, width = 80, height = 32, color = '#ffcc00' }: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  const lastPoint = data[data.length - 1];
  const lastX = width;
  const lastY = height - ((lastPoint - min) / range) * (height - 4) - 2;

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        style={{ opacity: 0.7 }}
      />
      <circle
        cx={lastX}
        cy={lastY}
        r="3"
        fill={color}
      />
    </svg>
  );
}

// Weight chart component for measurements
function WeightChart({ data, labels }: {
  data: number[];
  labels: string[];
}) {
  if (data.length === 0) return null;

  // Single point - show just the value
  if (data.length === 1) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <p style={{ fontSize: '32px', fontWeight: 700, color: '#fff', margin: 0 }}>
          {data[0].toFixed(1)}
          <span style={{ fontSize: '14px', fontWeight: 400, color: 'rgba(255,255,255,0.4)', marginLeft: '4px' }}>кг</span>
        </p>
        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', margin: '8px 0 0' }}>
          {labels[0]}
        </p>
        <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', margin: '12px 0 0' }}>
          Добавьте ещё замеры для отображения графика
        </p>
      </div>
    );
  }

  const width = 320;
  const height = 140;
  const padding = { top: 20, right: 20, bottom: 30, left: 45 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const min = Math.min(...data) - 1;
  const max = Math.max(...data) + 1;
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x = padding.left + (index / (data.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - ((value - min) / range) * chartHeight;
    return { x, y, value };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');

  // Calculate trend
  const firstValue = data[0];
  const lastValue = data[data.length - 1];
  const change = lastValue - firstValue;
  const isDecreasing = change < 0;

  // Grid lines (3 horizontal)
  const gridLines = [0, 0.5, 1].map(ratio => {
    const y = padding.top + chartHeight * (1 - ratio);
    const value = min + range * ratio;
    return { y, value };
  });

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg width={width} height={height} style={{ display: 'block', margin: '0 auto' }}>
        {/* Grid lines */}
        {gridLines.map((line, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              y1={line.y}
              x2={width - padding.right}
              y2={line.y}
              stroke="rgba(255,255,255,0.1)"
              strokeDasharray="4,4"
            />
            <text
              x={padding.left - 8}
              y={line.y + 4}
              fill="rgba(255,255,255,0.4)"
              fontSize="10"
              textAnchor="end"
            >
              {line.value.toFixed(1)}
            </text>
          </g>
        ))}

        {/* Gradient fill under the line */}
        <defs>
          <linearGradient id="weightGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isDecreasing ? '#22c55e' : '#f59e0b'} stopOpacity="0.3" />
            <stop offset="100%" stopColor={isDecreasing ? '#22c55e' : '#f59e0b'} stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* Area fill */}
        <path
          d={`${pathD} L ${points[points.length - 1].x},${padding.top + chartHeight} L ${points[0].x},${padding.top + chartHeight} Z`}
          fill="url(#weightGradient)"
        />

        {/* Line */}
        <path
          d={pathD}
          fill="none"
          stroke={isDecreasing ? '#22c55e' : '#f59e0b'}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r="4"
              fill="#1a1a1a"
              stroke={isDecreasing ? '#22c55e' : '#f59e0b'}
              strokeWidth="2"
            />
            {/* Value label on hover area */}
            {(i === 0 || i === points.length - 1) && (
              <text
                x={p.x}
                y={p.y - 10}
                fill="#fff"
                fontSize="11"
                fontWeight="600"
                textAnchor="middle"
              >
                {p.value.toFixed(1)}
              </text>
            )}
          </g>
        ))}

        {/* X-axis labels */}
        {labels.length <= 7 ? labels.map((label, i) => (
          <text
            key={i}
            x={padding.left + (i / (labels.length - 1)) * chartWidth}
            y={height - 8}
            fill="rgba(255,255,255,0.4)"
            fontSize="9"
            textAnchor="middle"
          >
            {label}
          </text>
        )) : (
          <>
            <text
              x={padding.left}
              y={height - 8}
              fill="rgba(255,255,255,0.4)"
              fontSize="9"
              textAnchor="start"
            >
              {labels[0]}
            </text>
            <text
              x={width - padding.right}
              y={height - 8}
              fill="rgba(255,255,255,0.4)"
              fontSize="9"
              textAnchor="end"
            >
              {labels[labels.length - 1]}
            </text>
          </>
        )}
      </svg>

      {/* Change indicator */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        marginTop: '8px'
      }}>
        <span style={{
          fontSize: '12px',
          color: 'rgba(255,255,255,0.5)'
        }}>
          Изменение:
        </span>
        <span style={{
          fontSize: '14px',
          fontWeight: 600,
          color: isDecreasing ? '#22c55e' : '#f59e0b',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          {isDecreasing ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
          {change > 0 ? '+' : ''}{change.toFixed(1)} кг
        </span>
      </div>
    </div>
  );
}

// Helper functions for body progress
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function format1(n: number) {
  return n.toFixed(1);
}

// Growth Ring component for goals
function GrowthRing({ value, goal, label }: { value: number; goal: number; label: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = clamp(value / goal, 0, 1);
  const dash = c * pct;

  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
      <svg width="74" height="74" viewBox="0 0 74 74">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#22c55e" />
            <stop offset="0.6" stopColor="#facc15" />
            <stop offset="1" stopColor="#38bdf8" />
          </linearGradient>
          <filter id="ringGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx="37" cy="37" r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="8" />
        <circle
          cx="37"
          cy="37"
          r={r}
          fill="none"
          stroke="url(#ringGrad)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform="rotate(-90 37 37)"
          filter="url(#ringGlow)"
        />
        <text
          x="37"
          y="41"
          textAnchor="middle"
          fontSize="12"
          fill="rgba(255,255,255,0.88)"
          style={{ fontFamily: 'ui-sans-serif, system-ui' }}
        >
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: 'ui-sans-serif, system-ui' }}>
        {label}
      </div>
    </div>
  );
}

// Body Progress Visualization with realistic anatomy image
function BodyProgressVisualization({ allMeasurements }: { allMeasurements: BodyMeasurement[] }) {
  const [selectedIdx, setSelectedIdx] = useState(allMeasurements.length - 1);

  // Sort measurements by date
  const sortedMeasurements = useMemo(() => {
    return [...allMeasurements].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }, [allMeasurements]);

  if (sortedMeasurements.length === 0) return null;

  const cur = sortedMeasurements[Math.min(selectedIdx, sortedMeasurements.length - 1)];
  const base = sortedMeasurements[0];

  // Get current values with fallbacks
  const curWeight = cur.weight || 0;
  const curChest = cur.chest || 0;
  const curWaist = cur.waist || 0;
  const curHips = cur.hips || 0;
  const curBicepsL = cur.bicepsLeft || 0;
  const curBicepsR = cur.bicepsRight || 0;
  const curThighs = cur.thighs || 0;

  const baseWeight = base.weight || curWeight;
  const baseChest = base.chest || curChest;
  const baseWaist = base.waist || curWaist;
  const baseHips = base.hips || curHips;
  const baseBicepsL = base.bicepsLeft || curBicepsL;
  const baseBicepsR = base.bicepsRight || curBicepsR;
  const baseThighs = base.thighs || curThighs;

  // Calculate deltas
  const weightDelta = curWeight - baseWeight;
  const chestDelta = curChest - baseChest;
  const waistDelta = baseWaist - curWaist; // Decrease is good for waist
  const hipsDelta = curHips - baseHips;
  const bicepsLDelta = curBicepsL - baseBicepsL;
  const bicepsRDelta = curBicepsR - baseBicepsR;
  const thighsDelta = curThighs - baseThighs;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div style={{
      borderRadius: 18,
      background: 'linear-gradient(180deg, #0a0a0a 0%, #111 50%, #0a0a0a 100%)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 18px 60px rgba(0,0,0,0.6)',
      overflow: 'hidden',
      marginBottom: '16px'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'linear-gradient(90deg, rgba(250,204,21,0.1) 0%, transparent 50%, rgba(34,197,94,0.1) 100%)'
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'white' }}>🏋️ Прогресс тела</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
            Последний замер: {formatDate(sortedMeasurements[sortedMeasurements.length - 1].date)}
          </div>
        </div>
        {curWeight > 0 && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#facc15' }}>{format1(curWeight)} кг</div>
            {weightDelta !== 0 && (
              <div style={{ fontSize: 12, color: weightDelta > 0 ? '#22c55e' : '#f87171' }}>
                {weightDelta > 0 ? '+' : ''}{format1(weightDelta)} кг
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main visualization area */}
      <div style={{
        position: 'relative',
        minHeight: 420,
        background: 'linear-gradient(180deg, #0a0a0a 0%, #0d0d0d 50%, #0a0a0a 100%)',
        padding: '20px 0'
      }}>
        {/* Body image in center */}
        <div style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 262,
          height: 523,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <img
            src="/mubd.png"
            alt="Body"
            style={{
              height: '100%',
              width: 'auto',
              objectFit: 'contain',
              opacity: 0.95
            }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>

        {/* SVG for ray lines */}
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <defs>
            {/* Static gradients */}
            <linearGradient id="rayGradientLeft" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#facc15" stopOpacity="0.8"/>
              <stop offset="100%" stopColor="#facc15" stopOpacity="0.1"/>
            </linearGradient>
            <linearGradient id="rayGradientRight" x1="100%" y1="0%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#facc15" stopOpacity="0.8"/>
              <stop offset="100%" stopColor="#facc15" stopOpacity="0.1"/>
            </linearGradient>
            {/* Animated progress gradients - green pulse */}
            <linearGradient id="rayProgressLeft" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="1">
                <animate attributeName="stopOpacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite"/>
              </stop>
              <stop offset="50%" stopColor="#4ade80" stopOpacity="0.6">
                <animate attributeName="offset" values="0.3;0.7;0.3" dur="1.5s" repeatCount="indefinite"/>
              </stop>
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0.1"/>
            </linearGradient>
            <linearGradient id="rayProgressRight" x1="100%" y1="0%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="1">
                <animate attributeName="stopOpacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite"/>
              </stop>
              <stop offset="50%" stopColor="#4ade80" stopOpacity="0.6">
                <animate attributeName="offset" values="0.3;0.7;0.3" dur="1.5s" repeatCount="indefinite"/>
              </stop>
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0.1"/>
            </linearGradient>
            <filter id="rayGlow">
              <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
              <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="progressGlow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          {/* Left side rays */}
          {(curBicepsL > 0 || curBicepsR > 0) && (
            <line
              x1="20%" y1="60" x2="42%" y2="130"
              stroke={(bicepsLDelta !== 0 || bicepsRDelta !== 0) ? "url(#rayProgressLeft)" : "url(#rayGradientLeft)"}
              strokeWidth={(bicepsLDelta !== 0 || bicepsRDelta !== 0) ? 3 : 2}
              filter={(bicepsLDelta !== 0 || bicepsRDelta !== 0) ? "url(#progressGlow)" : "url(#rayGlow)"}
            />
          )}
          {curWaist > 0 && (
            <line
              x1="20%" y1="290" x2="42%" y2="210"
              stroke={waistDelta !== 0 ? "url(#rayProgressLeft)" : "url(#rayGradientLeft)"}
              strokeWidth={waistDelta !== 0 ? 3 : 2}
              filter={waistDelta !== 0 ? "url(#progressGlow)" : "url(#rayGlow)"}
            />
          )}
          {/* Right side rays */}
          {curChest > 0 && (
            <line
              x1="80%" y1="60" x2="58%" y2="120"
              stroke={chestDelta !== 0 ? "url(#rayProgressRight)" : "url(#rayGradientRight)"}
              strokeWidth={chestDelta !== 0 ? 3 : 2}
              filter={chestDelta !== 0 ? "url(#progressGlow)" : "url(#rayGlow)"}
            />
          )}
          {curHips > 0 && (
            <line
              x1="80%" y1="290" x2="58%" y2="250"
              stroke={(hipsDelta !== 0 || thighsDelta !== 0) ? "url(#rayProgressRight)" : "url(#rayGradientRight)"}
              strokeWidth={(hipsDelta !== 0 || thighsDelta !== 0) ? 3 : 2}
              filter={(hipsDelta !== 0 || thighsDelta !== 0) ? "url(#progressGlow)" : "url(#rayGlow)"}
            />
          )}
        </svg>

        {/* Circular metric cards - compact */}
        {/* Top Left - Biceps/Arms */}
        {(curBicepsL > 0 || curBicepsR > 0) && (
          <div style={{ position: 'absolute', left: 8, top: 25 }}>
            <div style={{
              width: 70,
              height: 70,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.8)',
              border: '2px solid #22c55e',
              boxShadow: '0 0 15px rgba(34, 197, 94, 0.4)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative'
            }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>Руки</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#facc15' }}>
                {format1(Math.max(curBicepsL, curBicepsR))}
              </div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>см</div>
              {(bicepsLDelta !== 0 || bicepsRDelta !== 0) && (
                <div style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  background: bicepsLDelta > 0 ? '#22c55e' : '#ef4444',
                  color: 'white',
                  fontSize: 9,
                  fontWeight: 600,
                  padding: '1px 5px',
                  borderRadius: 8
                }}>
                  {bicepsLDelta > 0 ? '+' : ''}{format1(bicepsLDelta)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bottom Left - Waist */}
        {curWaist > 0 && (
          <div style={{ position: 'absolute', left: 8, bottom: 45 }}>
            <div style={{
              width: 70,
              height: 70,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.8)',
              border: '2px solid #22c55e',
              boxShadow: '0 0 15px rgba(34, 197, 94, 0.4)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative'
            }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>Талия</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#facc15' }}>{curWaist}</div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>см</div>
              {waistDelta !== 0 && (
                <div style={{
                  position: 'absolute',
                  top: -6,
                  left: -6,
                  background: waistDelta < 0 ? '#22c55e' : '#ef4444',
                  color: 'white',
                  fontSize: 9,
                  fontWeight: 600,
                  padding: '1px 5px',
                  borderRadius: 8
                }}>
                  {waistDelta > 0 ? '+' : ''}{format1(waistDelta)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Top Right - Chest */}
        {curChest > 0 && (
          <div style={{ position: 'absolute', right: 8, top: 25 }}>
            <div style={{
              width: 70,
              height: 70,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.8)',
              border: '2px solid #facc15',
              boxShadow: '0 0 15px rgba(250, 204, 21, 0.4)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative'
            }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>Грудь</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#facc15' }}>{curChest}</div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>см</div>
              {chestDelta !== 0 && (
                <div style={{
                  position: 'absolute',
                  top: -6,
                  left: -6,
                  background: chestDelta > 0 ? '#22c55e' : '#ef4444',
                  color: 'white',
                  fontSize: 9,
                  fontWeight: 600,
                  padding: '1px 5px',
                  borderRadius: 8
                }}>
                  {chestDelta > 0 ? '+' : ''}{format1(chestDelta)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bottom Right - Hips/Thighs */}
        {(curHips > 0 || curThighs > 0) && (
          <div style={{ position: 'absolute', right: 8, bottom: 45 }}>
            <div style={{
              width: 70,
              height: 70,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.8)',
              border: '2px solid #22c55e',
              boxShadow: '0 0 15px rgba(34, 197, 94, 0.4)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative'
            }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>{curHips ? 'Бёдра' : 'Ноги'}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#facc15' }}>{curHips || curThighs}</div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>см</div>
              {(hipsDelta !== 0 || thighsDelta !== 0) && (
                <div style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  background: (hipsDelta > 0 || thighsDelta > 0) ? '#22c55e' : '#ef4444',
                  color: 'white',
                  fontSize: 9,
                  fontWeight: 600,
                  padding: '1px 5px',
                  borderRadius: 8
                }}>
                  {(hipsDelta || thighsDelta) > 0 ? '+' : ''}{format1(hipsDelta || thighsDelta)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Timeline slider */}
      {sortedMeasurements.length > 1 && (
        <div style={{ padding: '0 20px 16px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'rgba(255,255,255,0.5)',
            marginBottom: 8
          }}>
            <span>📅 {formatDate(sortedMeasurements[0].date)}</span>
            <span style={{ color: '#facc15' }}>⬤ Замер {selectedIdx + 1} из {sortedMeasurements.length}</span>
            <span>{formatDate(sortedMeasurements[sortedMeasurements.length - 1].date)} 📅</span>
          </div>
          <input
            type="range"
            min={0}
            max={sortedMeasurements.length - 1}
            value={selectedIdx}
            onChange={(e) => setSelectedIdx(Number(e.target.value))}
            style={{
              width: '100%',
              height: 8,
              borderRadius: 4,
              background: 'linear-gradient(90deg, #38bdf8, #22c55e, #facc15)',
              cursor: 'pointer',
              WebkitAppearance: 'none',
              appearance: 'none'
            }}
          />
        </div>
      )}

      {/* Summary cards grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 8,
        padding: '0 16px 16px'
      }}>
        {[
          { name: 'Грудь', v: curChest, b: baseChest, icon: '💪', good: (d: number) => d >= 0 },
          { name: 'Талия', v: curWaist, b: baseWaist, icon: '📏', good: (d: number) => d <= 0 },
          { name: 'Бёдра', v: curHips, b: baseHips, icon: '🦵', good: (d: number) => d >= 0 },
        ].filter(item => item.v > 0).map((item) => {
          const delta = item.v - item.b;
          const isGood = item.good(delta);

          return (
            <div
              key={item.name}
              style={{
                padding: '12px',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                textAlign: 'center'
              }}
            >
              <div style={{ fontSize: 18, marginBottom: 4 }}>{item.icon}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 2 }}>{item.name}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>{item.v} см</div>
              {delta !== 0 && (
                <div style={{ fontSize: 11, color: isGood ? '#22c55e' : '#f87171', marginTop: 2 }}>
                  {delta >= 0 ? '+' : ''}{format1(delta)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Growth rings */}
      {sortedMeasurements.length > 1 && (
        <div style={{
          borderRadius: 12,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          padding: 12,
          margin: '0 16px 16px'
        }}>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 12, textAlign: 'center' }}>
            🎯 Прогресс к целям
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {curChest > 0 && <GrowthRing value={Math.max(0, chestDelta)} goal={3} label="Грудь +3" />}
            {curWaist > 0 && <GrowthRing value={Math.max(0, waistDelta)} goal={4} label="Талия -4" />}
            {curHips > 0 && <GrowthRing value={Math.max(0, hipsDelta)} goal={2} label="Бёдра +2" />}
            {(curBicepsL > 0 || curBicepsR > 0) && <GrowthRing value={Math.max(0, Math.max(bicepsLDelta, bicepsRDelta))} goal={1.5} label="Бицепс +1.5" />}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ClientDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const clientId = params.id as string;

  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('workouts');
  const [expandedWorkoutDate, setExpandedWorkoutDate] = useState<string | null>(null);
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(null);
  const [showRecommendationsEditor, setShowRecommendationsEditor] = useState(false);
  const [recommendations, setRecommendations] = useState<NutritionRecommendation[]>([]);
  const [isSavingRecommendations, setIsSavingRecommendations] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated' && clientId) {
      fetchClientData();
    }
  }, [status, clientId, router]);

  const fetchClientData = async () => {
    try {
      const res = await fetch(`/api/trainer/clients/${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setClientData(data);
      } else {
        const errData = await res.json();
        setError(errData.error || 'Failed to load client data');
      }
    } catch {
      setError('Failed to load client data');
    } finally {
      setIsLoading(false);
    }
  };

  const openRecommendationsEditor = () => {
    setRecommendations(clientData?.nutritionRecommendations || []);
    setShowRecommendationsEditor(true);
  };

  const addRecommendation = () => {
    setRecommendations([
      ...recommendations,
      {
        id: Date.now().toString(),
        emoji: '🍽️',
        title: '',
        description: '',
        color: 'yellow'
      }
    ]);
  };

  const updateRecommendation = (id: string, field: keyof NutritionRecommendation, value: string) => {
    setRecommendations(recommendations.map(r =>
      r.id === id ? { ...r, [field]: value } : r
    ));
  };

  const deleteRecommendation = (id: string) => {
    setRecommendations(recommendations.filter(r => r.id !== id));
  };

  const saveRecommendations = async () => {
    setIsSavingRecommendations(true);
    try {
      const res = await fetch(`/api/trainer/clients/${clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nutritionRecommendations: recommendations })
      });

      if (res.ok) {
        setClientData(prev => prev ? {
          ...prev,
          nutritionRecommendations: recommendations
        } : null);
        setShowRecommendationsEditor(false);
      }
    } catch (e) {
      console.error('Failed to save recommendations:', e);
    } finally {
      setIsSavingRecommendations(false);
    }
  };

  // Calculate stats
  const stats = useMemo(() => {
    if (!clientData) return null;

    const dayLogs = clientData.fitnessData.dayLogs || {};
    // Ensure measurements is an array (could be null, object, or stringified)
    let rawMeasurements: unknown = clientData.fitnessData.bodyMeasurements;
    if (!rawMeasurements) rawMeasurements = [];
    if (typeof rawMeasurements === 'string') {
      try { rawMeasurements = JSON.parse(rawMeasurements); } catch { rawMeasurements = []; }
    }
    const measurements: BodyMeasurement[] = Array.isArray(rawMeasurements) ? rawMeasurements : [];

    // Get current week's workouts
    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);

    // Previous week monday
    const prevMonday = new Date(monday);
    prevMonday.setDate(monday.getDate() - 7);

    let workoutsThisWeek = 0;
    let weeklySteps = 0;
    let workoutsLastWeek = 0;
    let lastWeekSteps = 0;

    // Current week
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      if (dayLogs[dateStr]?.workoutCompleted) {
        workoutsThisWeek++;
      }
      if (dayLogs[dateStr]?.steps) {
        weeklySteps += dayLogs[dateStr].steps;
      }
    }

    // Last week
    for (let i = 0; i < 7; i++) {
      const date = new Date(prevMonday);
      date.setDate(prevMonday.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      if (dayLogs[dateStr]?.workoutCompleted) {
        workoutsLastWeek++;
      }
      if (dayLogs[dateStr]?.steps) {
        lastWeekSteps += dayLogs[dateStr].steps;
      }
    }

    // Latest weight and previous weight - filter only measurements that have weight
    const sortedMeasurements = [...measurements].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const measurementsWithWeight = sortedMeasurements.filter(m => m.weight != null);
    const latestWeightMeasurement = measurementsWithWeight[0] || null;
    const previousWeightMeasurement = measurementsWithWeight[1] || null;

    return {
      workoutsThisWeek,
      workoutsLastWeek,
      latestWeight: latestWeightMeasurement?.weight || null,
      previousWeight: previousWeightMeasurement?.weight || null,
      weeklySteps,
      lastWeekSteps
    };
  }, [clientData]);

  // Get last 14 days for calendar (legacy, kept for compatibility)
  const recentDays = useMemo(() => {
    if (!clientData) return [];

    const days = [];
    const dayLogs = clientData.fitnessData.dayLogs || {};

    for (let i = 13; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const log = dayLogs[dateStr];

      days.push({
        date: dateStr,
        dayName: date.toLocaleDateString('ru-RU', { weekday: 'short' }),
        dayNum: date.getDate(),
        hasWorkout: !!log?.workoutCompleted,
        isOffDay: log?.isOffDay || false,
        hasMeals: (log?.meals?.length || 0) > 0
      });
    }

    return days;
  }, [clientData]);

  // Full month calendar days
  const calendarDays = useMemo(() => {
    if (!clientData) return { days: [], monthName: '', year: 0 };

    const dayLogs = clientData.fitnessData.dayLogs || {};
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();

    // First day of month
    const firstDay = new Date(year, month, 1);
    // Last day of month
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();

    // Get day of week for first day (0 = Sunday, we want Monday = 0)
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6; // Sunday becomes 6

    const days: Array<{
      date: string;
      dayNum: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      hasWorkout: boolean;
      workoutType: string | null;
      isOffDay: boolean;
      hasMeals: boolean;
      workoutRating: number | null;
    }> = [];

    // Previous month days to fill the first week
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      const date = new Date(year, month - 1, dayNum);
      const dateStr = date.toISOString().split('T')[0];
      const log = dayLogs[dateStr];

      days.push({
        date: dateStr,
        dayNum,
        isCurrentMonth: false,
        isToday: false,
        hasWorkout: !!log?.workoutCompleted,
        workoutType: log?.workoutCompleted || null,
        isOffDay: log?.isOffDay || false,
        hasMeals: (log?.meals?.length || 0) > 0,
        workoutRating: log?.workoutRating || null
      });
    }

    // Current month days
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const date = new Date(year, month, dayNum);
      const dateStr = date.toISOString().split('T')[0];
      const log = dayLogs[dateStr];

      days.push({
        date: dateStr,
        dayNum,
        isCurrentMonth: true,
        isToday: dateStr === todayStr,
        hasWorkout: !!log?.workoutCompleted,
        workoutType: log?.workoutCompleted || null,
        isOffDay: log?.isOffDay || false,
        hasMeals: (log?.meals?.length || 0) > 0,
        workoutRating: log?.workoutRating || null
      });
    }

    // Next month days to complete the grid (6 rows × 7 days = 42)
    const remainingDays = 42 - days.length;
    for (let dayNum = 1; dayNum <= remainingDays; dayNum++) {
      const date = new Date(year, month + 1, dayNum);
      const dateStr = date.toISOString().split('T')[0];
      const log = dayLogs[dateStr];

      days.push({
        date: dateStr,
        dayNum,
        isCurrentMonth: false,
        isToday: false,
        hasWorkout: !!log?.workoutCompleted,
        workoutType: log?.workoutCompleted || null,
        isOffDay: log?.isOffDay || false,
        hasMeals: (log?.meals?.length || 0) > 0,
        workoutRating: log?.workoutRating || null
      });
    }

    const monthName = calendarMonth.toLocaleDateString('ru-RU', { month: 'long' });

    return { days, monthName, year };
  }, [clientData, calendarMonth]);

  // Nutrition stats for last 7 days
  const nutritionStats = useMemo(() => {
    if (!clientData) return [];

    const stats = [];
    const dayLogs = clientData.fitnessData.dayLogs || {};

    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const log = dayLogs[dateStr];

      const meals = log?.meals || [];
      const totals = meals.reduce((acc, meal) => ({
        protein: acc.protein + (meal.protein || 0),
        fat: acc.fat + (meal.fat || 0),
        carbs: acc.carbs + (meal.carbs || 0),
        calories: acc.calories + (meal.calories || 0)
      }), { protein: 0, fat: 0, carbs: 0, calories: 0 });

      stats.push({
        date: dateStr,
        dayName: date.toLocaleDateString('ru-RU', { weekday: 'short' }),
        ...totals
      });
    }

    return stats;
  }, [clientData]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const formatRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'только что';
    if (diffMins < 60) return `${diffMins} мин назад`;
    if (diffHours < 24) return `${diffHours} ч назад`;
    if (diffDays === 1) return 'вчера';
    return `${diffDays} дн назад`;
  };

  if (status === 'loading' || isLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0f0f1a 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <Loader2 size={40} color="#ffcc00" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0f0f1a 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <p style={{ color: '#ef4444', fontSize: '16px' }}>{error}</p>
        <button
          onClick={() => router.push('/trainer')}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 20px',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          Назад
        </button>
      </div>
    );
  }

  const client = clientData?.client;
  const clientName = client?.firstName && client?.lastName
    ? `${client.firstName} ${client.lastName}`
    : client?.name || client?.email || 'Клиент';

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0f0f1a 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Header */}
      <header style={{
        padding: '20px 24px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: '16px'
      }}>
        <button
          onClick={() => router.push('/trainer')}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '10px',
            padding: '10px',
            color: 'rgba(255,255,255,0.7)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{
              fontSize: '20px',
              fontWeight: 700,
              color: '#fff',
              margin: 0
            }}>
              {clientName}
            </h1>
            {client?.clientId && (
              <span style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#ffcc00',
                background: 'rgba(255,204,0,0.15)',
                padding: '3px 8px',
                borderRadius: '6px'
              }}>
                {client.clientId}
              </span>
            )}
          </div>
          <p style={{
            fontSize: '13px',
            color: 'rgba(255,255,255,0.5)',
            margin: '2px 0 0'
          }}>
            {client?.email}
          </p>
        </div>
      </header>

      {/* Stats Cards */}
      <div style={{
        padding: '20px 24px',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '12px'
      }}>
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '14px',
          padding: '16px',
          border: '1px solid rgba(255,255,255,0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <Dumbbell size={16} color="#ffcc00" />
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
              За неделю
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <p style={{ fontSize: '24px', fontWeight: 700, color: '#fff', margin: 0 }}>
              {stats?.workoutsThisWeek || 0}
            </p>
            {stats && stats.workoutsLastWeek > 0 && stats.workoutsThisWeek !== stats.workoutsLastWeek && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                fontSize: '11px',
                color: stats.workoutsThisWeek > stats.workoutsLastWeek ? '#22c55e' : '#ef4444'
              }}>
                {stats.workoutsThisWeek > stats.workoutsLastWeek ? (
                  <TrendingUp size={12} />
                ) : (
                  <TrendingDown size={12} />
                )}
                <span>{Math.abs(stats.workoutsThisWeek - stats.workoutsLastWeek)}</span>
              </div>
            )}
          </div>
          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: '2px 0 0' }}>
            тренировок
          </p>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '14px',
          padding: '16px',
          border: '1px solid rgba(255,255,255,0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <Scale size={16} color="#22c55e" />
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
              Вес
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <p style={{ fontSize: '24px', fontWeight: 700, color: '#fff', margin: 0 }}>
              {stats?.latestWeight ? `${stats.latestWeight}` : '—'}
            </p>
            {stats?.latestWeight && stats?.previousWeight && stats.latestWeight !== stats.previousWeight && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                fontSize: '11px',
                color: stats.latestWeight < stats.previousWeight ? '#22c55e' : '#f59e0b'
              }}>
                {stats.latestWeight < stats.previousWeight ? (
                  <TrendingDown size={12} />
                ) : (
                  <TrendingUp size={12} />
                )}
                <span>{Math.abs(stats.latestWeight - stats.previousWeight).toFixed(1)}</span>
              </div>
            )}
          </div>
          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: '2px 0 0' }}>
            кг
          </p>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '14px',
          padding: '16px',
          border: '1px solid rgba(255,255,255,0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <Footprints size={16} color="#3b82f6" />
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
              За неделю
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <p style={{ fontSize: '24px', fontWeight: 700, color: '#fff', margin: 0 }}>
              {stats?.weeklySteps ? stats.weeklySteps.toLocaleString() : '—'}
            </p>
            {stats && stats.lastWeekSteps > 0 && stats.weeklySteps !== stats.lastWeekSteps && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                fontSize: '11px',
                color: stats.weeklySteps > stats.lastWeekSteps ? '#22c55e' : '#ef4444'
              }}>
                {stats.weeklySteps > stats.lastWeekSteps ? (
                  <TrendingUp size={12} />
                ) : (
                  <TrendingDown size={12} />
                )}
                <span>{Math.abs(Math.round((stats.weeklySteps - stats.lastWeekSteps) / 1000))}k</span>
              </div>
            )}
          </div>
          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: '2px 0 0' }}>
            шагов
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        padding: '0 24px',
        display: 'flex',
        gap: '8px',
        marginBottom: '20px'
      }}>
        {[
          { id: 'workouts' as TabType, label: 'Тренировки', icon: Dumbbell },
          { id: 'nutrition' as TabType, label: 'Питание', icon: Utensils },
          { id: 'measurements' as TabType, label: 'Замеры', icon: Scale },
          { id: 'progress' as TabType, label: 'Прогресс', icon: TrendingUp }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1,
              padding: '12px 8px',
              background: activeTab === tab.id
                ? 'linear-gradient(135deg, #ffcc00 0%, #ffa500 100%)'
                : 'rgba(255,255,255,0.05)',
              border: activeTab === tab.id ? 'none' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px',
              color: activeTab === tab.id ? '#000' : 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '13px',
              fontWeight: 600
            }}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ padding: '0 24px 24px' }}>
        {/* Workouts Tab */}
        {activeTab === 'workouts' && (
          <div>
            {/* Full Month Calendar */}
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              borderRadius: '16px',
              padding: '16px',
              border: '1px solid rgba(255,255,255,0.08)',
              marginBottom: '16px'
            }}>
              {/* Calendar Header with Navigation */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px'
              }}>
                <button
                  onClick={() => setCalendarMonth(prev => {
                    const newDate = new Date(prev);
                    newDate.setMonth(newDate.getMonth() - 1);
                    return newDate;
                  })}
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    color: 'white',
                    fontSize: '16px'
                  }}
                >
                  ←
                </button>
                <h3 style={{
                  fontSize: '16px',
                  fontWeight: 600,
                  color: 'white',
                  margin: 0,
                  textTransform: 'capitalize'
                }}>
                  {calendarDays.monthName} {calendarDays.year}
                </h3>
                <button
                  onClick={() => setCalendarMonth(prev => {
                    const newDate = new Date(prev);
                    newDate.setMonth(newDate.getMonth() + 1);
                    return newDate;
                  })}
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    color: 'white',
                    fontSize: '16px'
                  }}
                >
                  →
                </button>
              </div>

              {/* Day of week headers */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: '4px',
                marginBottom: '8px'
              }}>
                {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => (
                  <div
                    key={day}
                    style={{
                      textAlign: 'center',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'rgba(255,255,255,0.4)',
                      padding: '4px'
                    }}
                  >
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: '4px'
              }}>
                {calendarDays.days.map((day, idx) => (
                  <div
                    key={`${day.date}-${idx}`}
                    onClick={() => {
                      if (day.hasWorkout) {
                        setExpandedWorkoutDate(expandedWorkoutDate === day.date ? null : day.date);
                      }
                    }}
                    style={{
                      textAlign: 'center',
                      padding: '6px 2px',
                      borderRadius: '8px',
                      minHeight: '52px',
                      cursor: day.hasWorkout ? 'pointer' : 'default',
                      background: day.isToday
                        ? 'rgba(59, 130, 246, 0.3)'
                        : day.hasWorkout
                          ? 'rgba(34, 197, 94, 0.2)'
                          : day.isOffDay
                            ? 'rgba(147, 112, 219, 0.15)'
                            : 'transparent',
                      opacity: day.isCurrentMonth ? 1 : 0.3,
                      border: day.isToday ? '2px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent',
                      transition: 'all 0.2s'
                    }}
                  >
                    <p style={{
                      fontSize: '13px',
                      fontWeight: day.isToday ? 700 : 500,
                      color: day.hasWorkout ? '#22c55e' : day.isToday ? '#3b82f6' : '#fff',
                      margin: 0
                    }}>
                      {day.dayNum}
                    </p>
                    <div style={{ marginTop: '2px', minHeight: '16px' }}>
                      {day.hasWorkout ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' }}>
                          <span style={{ fontSize: '9px', color: '#22c55e', fontWeight: 600 }}>
                            {day.workoutType?.toUpperCase()}
                          </span>
                          {day.workoutRating && (
                            <span style={{ fontSize: '10px' }}>
                              {day.workoutRating === 1 && '😫'}
                              {day.workoutRating === 2 && '😐'}
                              {day.workoutRating === 3 && '😊'}
                              {day.workoutRating === 4 && '💪'}
                              {day.workoutRating === 5 && '🔥'}
                            </span>
                          )}
                        </div>
                      ) : day.isOffDay ? (
                        <span style={{ fontSize: '12px' }}>😴</span>
                      ) : day.hasMeals ? (
                        <span style={{ fontSize: '10px' }}>🍽️</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div style={{
                display: 'flex',
                gap: '16px',
                marginTop: '12px',
                paddingTop: '12px',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                flexWrap: 'wrap'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '4px', background: 'rgba(34, 197, 94, 0.3)' }} />
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Тренировка</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '4px', background: 'rgba(147, 112, 219, 0.3)' }} />
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Отдых</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.3)', border: '1px solid rgba(59, 130, 246, 0.5)' }} />
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Сегодня</span>
                </div>
              </div>
            </div>

            {/* Workout Details */}
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              borderRadius: '16px',
              padding: '16px',
              border: '1px solid rgba(255,255,255,0.08)'
            }}>
              <h3 style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.7)',
                margin: '0 0 12px'
              }}>
                История тренировок
              </h3>
              {Object.entries(clientData?.fitnessData.dayLogs || {})
                .filter(([, log]) => log.workoutCompleted)
                .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
                .slice(0, 10)
                .map(([date, log]) => {
                  const isExpanded = expandedWorkoutDate === date;
                  const snapshot = log.workoutSnapshot;

                  return (
                    <div key={date}>
                      <div
                        onClick={() => setExpandedWorkoutDate(isExpanded ? null : date)}
                        style={{
                          padding: '12px 0',
                          borderBottom: '1px solid rgba(255,255,255,0.06)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: snapshot ? 'pointer' : 'default'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {snapshot && (
                            isExpanded ? <ChevronUp size={14} color="rgba(255,255,255,0.4)" /> : <ChevronDown size={14} color="rgba(255,255,255,0.4)" />
                          )}
                          <div>
                            <p style={{
                              fontSize: '14px',
                              fontWeight: 600,
                              color: '#fff',
                              margin: 0
                            }}>
                              {snapshot?.workoutName || log.workoutCompleted?.toUpperCase()}
                            </p>
                            <p style={{
                              fontSize: '12px',
                              color: 'rgba(255,255,255,0.5)',
                              margin: '2px 0 0'
                            }}>
                              {formatDate(date)}
                            </p>
                          </div>
                        </div>
                        {log.workoutRating && (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: '#ffcc00'
                          }}>
                            {log.workoutRating === 1 && '😫'}
                            {log.workoutRating === 2 && '😐'}
                            {log.workoutRating === 3 && '😊'}
                            {log.workoutRating === 4 && '💪'}
                            {log.workoutRating === 5 && '🔥'}
                          </div>
                        )}
                      </div>

                      {/* Expanded exercise details */}
                      {isExpanded && snapshot && (
                        <div style={{
                          padding: '12px',
                          marginBottom: '8px',
                          background: 'rgba(255,255,255,0.02)',
                          borderRadius: '8px',
                          borderLeft: '3px solid rgba(255,204,0,0.5)'
                        }}>
                          {snapshot.exercises.map((ex, idx) => (
                            <div
                              key={ex.id || idx}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '6px 0',
                                borderBottom: idx < snapshot.exercises.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {ex.completed ? (
                                  <CheckCircle2 size={14} color="#22c55e" />
                                ) : (
                                  <div style={{ width: 14, height: 14, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.3)' }} />
                                )}
                                <span style={{ fontSize: '13px', color: ex.completed ? '#fff' : 'rgba(255,255,255,0.5)' }}>
                                  {ex.name}
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: '12px', fontSize: '12px' }}>
                                {ex.actualSets && (
                                  <span style={{ color: 'rgba(255,255,255,0.6)' }}>
                                    {ex.actualSets}
                                  </span>
                                )}
                                {ex.newWeight && (
                                  <span style={{ color: '#ffcc00', fontWeight: 600 }}>
                                    {ex.newWeight} кг
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              {Object.values(clientData?.fitnessData.dayLogs || {}).filter(l => l.workoutCompleted).length === 0 && (
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>
                  Нет данных о тренировках
                </p>
              )}
            </div>
          </div>
        )}

        {/* Nutrition Tab */}
        {activeTab === 'nutrition' && (
          <div>
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              borderRadius: '16px',
              padding: '16px',
              border: '1px solid rgba(255,255,255,0.08)'
            }}>
              <h3 style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.7)',
                margin: '0 0 16px'
              }}>
                Питание за неделю
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {nutritionStats.map((day, idx) => {
                  const hasData = day.calories > 0;
                  return (
                    <div
                      key={day.date}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 0',
                        borderBottom: idx < nutritionStats.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none'
                      }}
                    >
                      <span style={{
                        fontSize: '13px',
                        color: 'rgba(255,255,255,0.5)',
                        textTransform: 'capitalize',
                        minWidth: '50px'
                      }}>
                        {day.dayName}
                      </span>
                      {hasData ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px' }}>
                          <span style={{ color: '#ef4444' }}>
                            <strong>{day.protein}</strong>
                            <span style={{ opacity: 0.6, marginLeft: '2px' }}>Б</span>
                          </span>
                          <span style={{ color: '#f59e0b' }}>
                            <strong>{day.fat}</strong>
                            <span style={{ opacity: 0.6, marginLeft: '2px' }}>Ж</span>
                          </span>
                          <span style={{ color: '#22c55e' }}>
                            <strong>{day.carbs}</strong>
                            <span style={{ opacity: 0.6, marginLeft: '2px' }}>У</span>
                          </span>
                          <span style={{ color: '#8b5cf6', fontWeight: 600 }}>
                            {day.calories} <span style={{ opacity: 0.6, fontWeight: 400 }}>ккал</span>
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>—</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Averages */}
              <div style={{
                marginTop: '12px',
                padding: '10px 12px',
                background: 'rgba(255,204,0,0.08)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                  Ср. за неделю:
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px' }}>
                  <span style={{ color: '#ef4444' }}>
                    <strong>{Math.round(nutritionStats.reduce((sum, d) => sum + d.protein, 0) / 7)}</strong>
                    <span style={{ opacity: 0.6, marginLeft: '2px' }}>Б</span>
                  </span>
                  <span style={{ color: '#f59e0b' }}>
                    <strong>{Math.round(nutritionStats.reduce((sum, d) => sum + d.fat, 0) / 7)}</strong>
                    <span style={{ opacity: 0.6, marginLeft: '2px' }}>Ж</span>
                  </span>
                  <span style={{ color: '#22c55e' }}>
                    <strong>{Math.round(nutritionStats.reduce((sum, d) => sum + d.carbs, 0) / 7)}</strong>
                    <span style={{ opacity: 0.6, marginLeft: '2px' }}>У</span>
                  </span>
                  <span style={{ color: '#8b5cf6', fontWeight: 600 }}>
                    {Math.round(nutritionStats.reduce((sum, d) => sum + d.calories, 0) / 7)} <span style={{ opacity: 0.6, fontWeight: 400 }}>ккал</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Nutrition Recommendations Section */}
            <div style={{
              marginTop: '16px',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: '16px',
              padding: '16px',
              border: '1px solid rgba(255,255,255,0.08)'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Timer size={18} color="#8b5cf6" />
                  <h3 style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.7)',
                    margin: 0
                  }}>
                    Рекомендации по питанию
                  </h3>
                </div>
                <button
                  onClick={openRecommendationsEditor}
                  style={{
                    background: 'linear-gradient(135deg, #ffcc00 0%, #ffa500 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: '#000',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '13px',
                    fontWeight: 600
                  }}
                >
                  <Edit2 size={14} />
                  Редактировать
                </button>
              </div>

              {clientData?.nutritionRecommendations && clientData.nutritionRecommendations.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {clientData.nutritionRecommendations.map(rec => (
                    <div
                      key={rec.id}
                      style={{
                        display: 'flex',
                        gap: '12px',
                        padding: '12px',
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '10px'
                      }}
                    >
                      <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        background: COLOR_BG_MAP[rec.color] || 'rgba(255,204,0,0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <span style={{ fontSize: '16px' }}>{rec.emoji}</span>
                      </div>
                      <div>
                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#fff', margin: '0 0 2px' }}>
                          {rec.title}
                        </p>
                        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>
                          {rec.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: '13px',
                  textAlign: 'center',
                  padding: '20px 0'
                }}>
                  Рекомендации не заданы. Нажмите &quot;Редактировать&quot; чтобы добавить.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Measurements Tab */}
        {activeTab === 'measurements' && (
          <div>
            {/* Body Progress Visualization with timeline */}
            <BodyProgressVisualization
              allMeasurements={clientData?.fitnessData.bodyMeasurements || []}
            />

            {/* Measurements Progress Cards */}
            {(() => {
              const allMeasurements = clientData?.fitnessData.bodyMeasurements || [];
              const sortedByDate = [...allMeasurements].sort((a, b) =>
                new Date(a.date).getTime() - new Date(b.date).getTime()
              );

              // Define measurement types with their properties
              const measurementTypes: Array<{
                key: keyof BodyMeasurement;
                label: string;
                unit: string;
                color: string;
                decreaseIsGood: boolean;
              }> = [
                { key: 'weight', label: 'Вес', unit: 'кг', color: '#ffcc00', decreaseIsGood: true },
                { key: 'waist', label: 'Талия', unit: 'см', color: '#3b82f6', decreaseIsGood: true },
                { key: 'chest', label: 'Грудь', unit: 'см', color: '#22c55e', decreaseIsGood: false },
                { key: 'bicepsLeft', label: 'Бицепс Л', unit: 'см', color: '#8b5cf6', decreaseIsGood: false },
                { key: 'bicepsRight', label: 'Бицепс П', unit: 'см', color: '#a855f7', decreaseIsGood: false },
                { key: 'thighs', label: 'Бёдра', unit: 'см', color: '#f59e0b', decreaseIsGood: false },
                { key: 'hips', label: 'Ягодицы', unit: 'см', color: '#06b6d4', decreaseIsGood: false },
              ];

              // Get data for each measurement type
              const measurementData = measurementTypes.map(type => {
                const dataPoints = sortedByDate
                  .filter(m => m[type.key] != null)
                  .map(m => ({
                    value: m[type.key] as number,
                    date: m.date
                  }));

                if (dataPoints.length === 0) return null;

                const firstValue = dataPoints[0].value;
                const lastValue = dataPoints[dataPoints.length - 1].value;
                const change = lastValue - firstValue;
                const isPositive = type.decreaseIsGood ? change < 0 : change > 0;

                return {
                  ...type,
                  dataPoints,
                  firstValue,
                  lastValue,
                  change,
                  isPositive,
                  hasMultiple: dataPoints.length >= 2
                };
              }).filter(Boolean);

              if (measurementData.length === 0) return null;

              return (
                <div style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '16px',
                  padding: '16px',
                  marginBottom: '16px',
                  border: '1px solid rgba(255,255,255,0.08)'
                }}>
                  <h3 style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.7)',
                    margin: '0 0 16px'
                  }}>
                    Динамика замеров
                  </h3>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '12px'
                  }}>
                    {measurementData.map(data => {
                      if (!data) return null;
                      const chartData = data.dataPoints.map(d => d.value);

                      return (
                        <div
                          key={data.key}
                          style={{
                            background: 'rgba(255,255,255,0.03)',
                            borderRadius: '12px',
                            padding: '12px',
                            border: '1px solid rgba(255,255,255,0.06)'
                          }}
                        >
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '8px'
                          }}>
                            <span style={{
                              fontSize: '11px',
                              color: 'rgba(255,255,255,0.5)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px'
                            }}>
                              {data.label}
                            </span>
                            {data.hasMultiple && data.change !== 0 && (
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '2px',
                                fontSize: '11px',
                                fontWeight: 600,
                                color: data.isPositive ? '#22c55e' : '#ef4444'
                              }}>
                                {data.change < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                                {data.change > 0 ? '+' : ''}{data.change.toFixed(1)}
                              </div>
                            )}
                          </div>

                          <div style={{
                            display: 'flex',
                            alignItems: 'flex-end',
                            justifyContent: 'space-between',
                            gap: '8px'
                          }}>
                            <div>
                              <p style={{
                                fontSize: '24px',
                                fontWeight: 700,
                                color: data.color,
                                margin: 0,
                                lineHeight: 1
                              }}>
                                {data.lastValue}
                                <span style={{
                                  fontSize: '11px',
                                  fontWeight: 400,
                                  color: 'rgba(255,255,255,0.4)',
                                  marginLeft: '2px'
                                }}>
                                  {data.unit}
                                </span>
                              </p>
                              {data.hasMultiple && (
                                <p style={{
                                  fontSize: '10px',
                                  color: 'rgba(255,255,255,0.35)',
                                  margin: '4px 0 0'
                                }}>
                                  было: {data.firstValue}
                                </p>
                              )}
                            </div>

                            {data.hasMultiple && (
                              <Sparkline
                                data={chartData}
                                width={60}
                                height={24}
                                color={data.isPositive ? '#22c55e' : '#ef4444'}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <div style={{
              background: 'rgba(255,255,255,0.03)',
              borderRadius: '16px',
              padding: '16px',
              border: '1px solid rgba(255,255,255,0.08)'
            }}>
              <h3 style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.7)',
                margin: '0 0 16px'
              }}>
                История замеров
              </h3>
              {(clientData?.fitnessData.bodyMeasurements || [])
                .sort((a, b) => parseInt(b.id) - parseInt(a.id))
                .map(measurement => (
                  <div
                    key={measurement.id}
                    style={{
                      padding: '14px',
                      marginBottom: '10px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.06)'
                    }}
                  >
                    <p style={{
                      fontSize: '13px',
                      color: 'rgba(255,255,255,0.5)',
                      margin: '0 0 10px'
                    }}>
                      {formatDate(measurement.date)}
                    </p>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '10px'
                    }}>
                      {measurement.weight && (
                        <div>
                          <p style={{ fontSize: '18px', fontWeight: 700, color: '#ffcc00', margin: 0 }}>
                            {measurement.weight}
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Вес, кг</p>
                        </div>
                      )}
                      {measurement.waist && (
                        <div>
                          <p style={{ fontSize: '18px', fontWeight: 700, color: '#3b82f6', margin: 0 }}>
                            {measurement.waist}
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Талия, см</p>
                        </div>
                      )}
                      {measurement.chest && (
                        <div>
                          <p style={{ fontSize: '18px', fontWeight: 700, color: '#22c55e', margin: 0 }}>
                            {measurement.chest}
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Грудь, см</p>
                        </div>
                      )}
                      {measurement.biceps && (
                        <div>
                          <p style={{ fontSize: '18px', fontWeight: 700, color: '#8b5cf6', margin: 0 }}>
                            {measurement.biceps}
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Бицепс, см</p>
                        </div>
                      )}
                      {measurement.bicepsLeft && (
                        <div>
                          <p style={{ fontSize: '18px', fontWeight: 700, color: '#8b5cf6', margin: 0 }}>
                            {measurement.bicepsLeft}
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Бицепс Л, см</p>
                        </div>
                      )}
                      {measurement.bicepsRight && (
                        <div>
                          <p style={{ fontSize: '18px', fontWeight: 700, color: '#a855f7', margin: 0 }}>
                            {measurement.bicepsRight}
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Бицепс П, см</p>
                        </div>
                      )}
                      {measurement.thighs && (
                        <div>
                          <p style={{ fontSize: '18px', fontWeight: 700, color: '#f59e0b', margin: 0 }}>
                            {measurement.thighs}
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Бедра, см</p>
                        </div>
                      )}
                      {measurement.hips && (
                        <div>
                          <p style={{ fontSize: '18px', fontWeight: 700, color: '#06b6d4', margin: 0 }}>
                            {measurement.hips}
                          </p>
                          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Ягодицы, см</p>
                        </div>
                      )}
                    </div>
                    {measurement.notes && (
                      <p style={{
                        fontSize: '12px',
                        color: 'rgba(255,255,255,0.5)',
                        margin: '10px 0 0',
                        fontStyle: 'italic'
                      }}>
                        {measurement.notes}
                      </p>
                    )}
                  </div>
                ))}
              {(clientData?.fitnessData.bodyMeasurements || []).length === 0 && (
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>
                  Нет данных о замерах
                </p>
              )}
            </div>
          </div>
        )}

        {/* Progress Tab */}
        {activeTab === 'progress' && (
          <div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '12px'
            }}>
              {Object.entries(clientData?.fitnessData.progressHistory || {}).length > 0 ? (
                Object.entries(clientData?.fitnessData.progressHistory || {}).map(([exerciseId, history]) => {
                  // Find exercise name and video from workouts
                  const workouts = clientData?.fitnessData.workouts || [];
                  let exerciseName = exerciseId;
                  let exerciseVideoUrl: string | undefined;
                  for (const workout of workouts) {
                    const exercise = workout.exercises?.find(e => e.id === exerciseId);
                    if (exercise) {
                      exerciseName = exercise.name;
                      exerciseVideoUrl = exercise.videoUrl;
                      break;
                    }
                  }

                  const sortedHistory = (history as ExerciseProgress[])
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                  const chartData = sortedHistory.map(h => parseFloat(h.weight) || 0);
                  const latestWeight = sortedHistory[sortedHistory.length - 1]?.weight;
                  const firstWeight = sortedHistory[0]?.weight;
                  const totalChange = latestWeight && firstWeight
                    ? parseFloat(latestWeight) - parseFloat(firstWeight)
                    : 0;

                  return (
                    <div
                      key={exerciseId}
                      onClick={() => exerciseVideoUrl && window.open(exerciseVideoUrl, '_blank')}
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '14px',
                        padding: '14px',
                        border: '1px solid rgba(255,255,255,0.08)',
                        cursor: exerciseVideoUrl ? 'pointer' : 'default',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      {/* Exercise name */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        marginBottom: '10px'
                      }}>
                        <p style={{
                          fontSize: '12px',
                          fontWeight: 500,
                          color: 'rgba(255,255,255,0.7)',
                          margin: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1
                        }}>
                          {exerciseName}
                        </p>
                        {exerciseVideoUrl && (
                          <Video size={12} color="#8b5cf6" style={{ flexShrink: 0 }} />
                        )}
                      </div>

                      {/* Weight and sparkline row */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'space-between',
                        gap: '8px'
                      }}>
                        <div>
                          <p style={{
                            fontSize: '22px',
                            fontWeight: 700,
                            color: '#fff',
                            margin: 0,
                            lineHeight: 1
                          }}>
                            {latestWeight || '—'}
                            <span style={{ fontSize: '12px', fontWeight: 400, color: 'rgba(255,255,255,0.4)', marginLeft: '2px' }}>кг</span>
                          </p>
                          {totalChange !== 0 && (
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                              marginTop: '4px'
                            }}>
                              {totalChange > 0 ? (
                                <TrendingUp size={12} color="#22c55e" />
                              ) : (
                                <TrendingDown size={12} color="#ef4444" />
                              )}
                              <span style={{
                                fontSize: '11px',
                                fontWeight: 600,
                                color: totalChange > 0 ? '#22c55e' : '#ef4444'
                              }}>
                                {totalChange > 0 ? '+' : ''}{totalChange.toFixed(1)}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Sparkline */}
                        {chartData.length >= 2 && (
                          <Sparkline
                            data={chartData}
                            width={70}
                            height={28}
                            color={totalChange >= 0 ? '#22c55e' : '#ef4444'}
                          />
                        )}
                      </div>

                      {/* Date range */}
                      <p style={{
                        fontSize: '10px',
                        color: 'rgba(255,255,255,0.35)',
                        margin: '8px 0 0',
                        textAlign: 'right'
                      }}>
                        {sortedHistory.length} записей
                      </p>
                    </div>
                  );
                })
              ) : (
                <div style={{ gridColumn: '1 / -1' }}>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>
                    Нет данных о прогрессе
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Recommendations Editor Modal */}
      {showRecommendationsEditor && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          zIndex: 1000
        }}>
          <div style={{
            width: '100%',
            maxWidth: '500px',
            maxHeight: '80vh',
            background: '#1a1a2e',
            borderRadius: '24px',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            flexDirection: 'column'
          }}>
            {/* Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <h3 style={{
                fontSize: '18px',
                fontWeight: 600,
                color: '#fff',
                margin: 0
              }}>
                Рекомендации по питанию
              </h3>
              <button
                onClick={() => setShowRecommendationsEditor(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255,255,255,0.5)',
                  cursor: 'pointer',
                  padding: '4px'
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div style={{
              flex: 1,
              overflow: 'auto',
              padding: '20px 24px'
            }}>
              {recommendations.length === 0 ? (
                <p style={{
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: '14px',
                  textAlign: 'center',
                  padding: '20px 0'
                }}>
                  Нет рекомендаций. Добавьте первую.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {recommendations.map((rec, idx) => (
                    <div
                      key={rec.id}
                      style={{
                        padding: '16px',
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '12px',
                        border: '1px solid rgba(255,255,255,0.08)'
                      }}
                    >
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '12px'
                      }}>
                        <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)' }}>
                          Рекомендация #{idx + 1}
                        </span>
                        <button
                          onClick={() => deleteRecommendation(rec.id)}
                          style={{
                            background: 'rgba(239,68,68,0.1)',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '6px',
                            color: '#ef4444',
                            cursor: 'pointer'
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      {/* Emoji and Title Row */}
                      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                        <input
                          type="text"
                          value={rec.emoji}
                          onChange={(e) => updateRecommendation(rec.id, 'emoji', e.target.value)}
                          placeholder="🍽️"
                          maxLength={4}
                          style={{
                            width: '50px',
                            padding: '10px',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '18px',
                            textAlign: 'center',
                            outline: 'none'
                          }}
                        />
                        <input
                          type="text"
                          value={rec.title}
                          onChange={(e) => updateRecommendation(rec.id, 'title', e.target.value)}
                          placeholder="Заголовок (например: Утро)"
                          style={{
                            flex: 1,
                            padding: '10px 12px',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '14px',
                            outline: 'none'
                          }}
                        />
                      </div>

                      {/* Description */}
                      <textarea
                        value={rec.description}
                        onChange={(e) => updateRecommendation(rec.id, 'description', e.target.value)}
                        placeholder="Описание рекомендации..."
                        rows={2}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#fff',
                          fontSize: '13px',
                          outline: 'none',
                          resize: 'none',
                          boxSizing: 'border-box',
                          marginBottom: '10px'
                        }}
                      />

                      {/* Color Selection */}
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {RECOMMENDATION_COLORS.map(color => (
                          <button
                            key={color.value}
                            onClick={() => updateRecommendation(rec.id, 'color', color.value)}
                            style={{
                              padding: '6px 10px',
                              background: rec.color === color.value ? color.bg : 'rgba(255,255,255,0.05)',
                              border: rec.color === color.value
                                ? '2px solid rgba(255,255,255,0.3)'
                                : '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '6px',
                              color: '#fff',
                              fontSize: '12px',
                              cursor: 'pointer'
                            }}
                          >
                            {color.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Button */}
              <button
                onClick={addRecommendation}
                style={{
                  width: '100%',
                  marginTop: '16px',
                  padding: '12px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px dashed rgba(255,255,255,0.2)',
                  borderRadius: '10px',
                  color: 'rgba(255,255,255,0.6)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontSize: '14px'
                }}
              >
                <Plus size={18} />
                Добавить рекомендацию
              </button>
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              gap: '12px'
            }}>
              <button
                onClick={() => setShowRecommendationsEditor(false)}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  color: 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 600
                }}
              >
                Отмена
              </button>
              <button
                onClick={saveRecommendations}
                disabled={isSavingRecommendations}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: isSavingRecommendations
                    ? 'rgba(255,204,0,0.3)'
                    : 'linear-gradient(135deg, #ffcc00 0%, #ffa500 100%)',
                  border: 'none',
                  borderRadius: '10px',
                  color: '#000',
                  cursor: isSavingRecommendations ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                {isSavingRecommendations ? (
                  <>
                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                    Сохранение...
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    Сохранить
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

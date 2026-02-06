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
  CheckCircle2,
  XCircle,
  Dumbbell,
  Flame
} from 'lucide-react';

interface Exercise {
  id: string;
  name: string;
  plannedSets: string;
  actualSets: string;
  newWeight: string;
  completed: boolean;
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

interface DayLog {
  date: string;
  selectedWorkout: string | null;
  workoutCompleted: string | null;
  workoutRating: number | null;
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
  thighs?: number;
  hips?: number;
  notes?: string;
}

interface ExerciseProgress {
  date: string;
  weight: string;
  notes: string;
}

interface ClientData {
  client: {
    id: string;
    clientId: string | null;
    firstName: string | null;
    lastName: string | null;
    name: string | null;
    email: string;
    createdAt: string;
  };
  fitnessData: {
    workouts: Workout[] | null;
    dayLogs: Record<string, DayLog>;
    progressHistory: Record<string, ExerciseProgress[]>;
    bodyMeasurements: BodyMeasurement[];
    lastUpdated: string | null;
  };
}

type TabType = 'workouts' | 'nutrition' | 'measurements' | 'progress';

export default function ClientDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const clientId = params.id as string;

  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('workouts');

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

  // Calculate stats
  const stats = useMemo(() => {
    if (!clientData) return null;

    const dayLogs = clientData.fitnessData.dayLogs || {};
    const measurements = clientData.fitnessData.bodyMeasurements || [];

    // Get current week's workouts
    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);

    let workoutsThisWeek = 0;
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      if (dayLogs[dateStr]?.workoutCompleted) {
        workoutsThisWeek++;
      }
    }

    // Latest weight
    const latestMeasurement = measurements.length > 0
      ? measurements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
      : null;

    // Last activity
    const lastUpdated = clientData.fitnessData.lastUpdated;

    return {
      workoutsThisWeek,
      latestWeight: latestMeasurement?.weight || null,
      lastActivity: lastUpdated ? new Date(lastUpdated) : null
    };
  }, [clientData]);

  // Get last 14 days for calendar
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
          <p style={{ fontSize: '24px', fontWeight: 700, color: '#fff', margin: 0 }}>
            {stats?.workoutsThisWeek || 0}
          </p>
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
          <p style={{ fontSize: '24px', fontWeight: 700, color: '#fff', margin: 0 }}>
            {stats?.latestWeight ? `${stats.latestWeight}` : '—'}
          </p>
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
            <Calendar size={16} color="#8b5cf6" />
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
              Активность
            </span>
          </div>
          <p style={{ fontSize: '16px', fontWeight: 600, color: '#fff', margin: 0 }}>
            {stats?.lastActivity ? formatRelativeTime(stats.lastActivity) : '—'}
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
            {/* Mini Calendar */}
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              borderRadius: '16px',
              padding: '16px',
              border: '1px solid rgba(255,255,255,0.08)',
              marginBottom: '16px'
            }}>
              <h3 style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.7)',
                margin: '0 0 12px'
              }}>
                Последние 14 дней
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: '8px'
              }}>
                {recentDays.map(day => (
                  <div
                    key={day.date}
                    style={{
                      textAlign: 'center',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      background: day.hasWorkout
                        ? 'rgba(34, 197, 94, 0.2)'
                        : day.isOffDay
                          ? 'rgba(255, 255, 255, 0.05)'
                          : 'transparent'
                    }}
                  >
                    <p style={{
                      fontSize: '10px',
                      color: 'rgba(255,255,255,0.4)',
                      margin: '0 0 4px',
                      textTransform: 'capitalize'
                    }}>
                      {day.dayName}
                    </p>
                    <p style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: day.hasWorkout ? '#22c55e' : '#fff',
                      margin: 0
                    }}>
                      {day.dayNum}
                    </p>
                    {day.hasWorkout && (
                      <CheckCircle2 size={12} color="#22c55e" style={{ marginTop: '4px' }} />
                    )}
                  </div>
                ))}
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
                .map(([date, log]) => (
                  <div
                    key={date}
                    style={{
                      padding: '12px 0',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <p style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#fff',
                        margin: 0
                      }}>
                        {log.workoutCompleted?.toUpperCase()}
                      </p>
                      <p style={{
                        fontSize: '12px',
                        color: 'rgba(255,255,255,0.5)',
                        margin: '2px 0 0'
                      }}>
                        {formatDate(date)}
                      </p>
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
                ))}
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {nutritionStats.map(day => (
                  <div
                    key={day.date}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '60px 1fr 1fr 1fr 1fr',
                      gap: '8px',
                      padding: '10px 0',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                      alignItems: 'center'
                    }}
                  >
                    <span style={{
                      fontSize: '13px',
                      color: 'rgba(255,255,255,0.5)',
                      textTransform: 'capitalize'
                    }}>
                      {day.dayName}
                    </span>
                    <div style={{ textAlign: 'center' }}>
                      <p style={{ fontSize: '14px', fontWeight: 600, color: '#ef4444', margin: 0 }}>
                        {day.protein}
                      </p>
                      <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Б</p>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <p style={{ fontSize: '14px', fontWeight: 600, color: '#f59e0b', margin: 0 }}>
                        {day.fat}
                      </p>
                      <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Ж</p>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <p style={{ fontSize: '14px', fontWeight: 600, color: '#22c55e', margin: 0 }}>
                        {day.carbs}
                      </p>
                      <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>У</p>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <p style={{ fontSize: '14px', fontWeight: 600, color: '#8b5cf6', margin: 0 }}>
                        {day.calories}
                      </p>
                      <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>ккал</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Averages */}
              <div style={{
                marginTop: '16px',
                padding: '12px',
                background: 'rgba(255,204,0,0.1)',
                borderRadius: '10px'
              }}>
                <p style={{
                  fontSize: '12px',
                  color: 'rgba(255,255,255,0.6)',
                  margin: '0 0 8px'
                }}>
                  Среднее за неделю:
                </p>
                <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '16px', fontWeight: 700, color: '#ef4444', margin: 0 }}>
                      {Math.round(nutritionStats.reduce((sum, d) => sum + d.protein, 0) / 7)}
                    </p>
                    <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>Белок</p>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '16px', fontWeight: 700, color: '#f59e0b', margin: 0 }}>
                      {Math.round(nutritionStats.reduce((sum, d) => sum + d.fat, 0) / 7)}
                    </p>
                    <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>Жиры</p>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '16px', fontWeight: 700, color: '#22c55e', margin: 0 }}>
                      {Math.round(nutritionStats.reduce((sum, d) => sum + d.carbs, 0) / 7)}
                    </p>
                    <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>Углеводы</p>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '16px', fontWeight: 700, color: '#8b5cf6', margin: 0 }}>
                      {Math.round(nutritionStats.reduce((sum, d) => sum + d.calories, 0) / 7)}
                    </p>
                    <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>Калории</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Measurements Tab */}
        {activeTab === 'measurements' && (
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
                История замеров
              </h3>
              {(clientData?.fitnessData.bodyMeasurements || [])
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
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
                Прогресс в упражнениях
              </h3>
              {Object.entries(clientData?.fitnessData.progressHistory || {}).length > 0 ? (
                Object.entries(clientData?.fitnessData.progressHistory || {}).map(([exerciseId, history]) => {
                  // Find exercise name from workouts
                  const workouts = clientData?.fitnessData.workouts || [];
                  let exerciseName = exerciseId;
                  for (const workout of workouts) {
                    const exercise = workout.exercises?.find(e => e.id === exerciseId);
                    if (exercise) {
                      exerciseName = exercise.name;
                      break;
                    }
                  }

                  return (
                    <div
                      key={exerciseId}
                      style={{
                        padding: '12px',
                        marginBottom: '10px',
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '10px'
                      }}
                    >
                      <p style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#fff',
                        margin: '0 0 10px'
                      }}>
                        {exerciseName}
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {(history as ExerciseProgress[])
                          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                          .slice(0, 5)
                          .map((entry, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '6px 0',
                                borderBottom: idx < 4 ? '1px solid rgba(255,255,255,0.05)' : 'none'
                              }}
                            >
                              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                                {formatDate(entry.date)}
                              </span>
                              <span style={{ fontSize: '14px', fontWeight: 600, color: '#ffcc00' }}>
                                {entry.weight}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>
                  Нет данных о прогрессе
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

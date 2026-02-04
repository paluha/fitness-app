'use client';

import React, { useState, useEffect } from 'react';
import {
  Plus, X, Dumbbell, Users, Settings, ChevronDown, ChevronUp,
  Edit2, Trash2, Save, Check, User, Copy, Eye, GripVertical
} from 'lucide-react';

// Types
interface Exercise {
  id: string;
  name: string;
  plannedSets: string;
  restTime: string;
  notes: string;
}

interface Workout {
  id: string;
  name: string;
  exercises: Exercise[];
}

interface Program {
  id: string;
  name: string;
  workouts: Workout[];
  activeWorkoutDays: number;
  clientCount: number;
}

interface Client {
  id: string;
  name: string;
  email: string;
  programId: string | null;
  programName: string | null;
  lastActive: string | null;
}

// Default empty workout template
const createEmptyWorkout = (num: number): Workout => ({
  id: `t${num}`,
  name: `Тренировка ${num}`,
  exercises: []
});

// Create 7 empty workouts
const createEmptyProgram = (): Workout[] => {
  return Array.from({ length: 7 }, (_, i) => createEmptyWorkout(i + 1));
};

export default function TrainerPage() {
  const [view, setView] = useState<'programs' | 'clients'>('programs');
  const [programs, setPrograms] = useState<Program[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Program editor state
  const [showProgramEditor, setShowProgramEditor] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  const [programName, setProgramName] = useState('');
  const [programWorkouts, setProgramWorkouts] = useState<Workout[]>(createEmptyProgram());
  const [activeWorkoutDays, setActiveWorkoutDays] = useState(4);

  // Exercise editor state
  const [editingWorkoutId, setEditingWorkoutId] = useState<string | null>(null);
  const [exerciseForm, setExerciseForm] = useState({ name: '', plannedSets: '', restTime: '2-3 мин', notes: '' });
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);

  // Load data
  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch('/api/trainer/data');
        if (response.ok) {
          const data = await response.json();
          if (data.programs) setPrograms(data.programs);
          if (data.clients) setClients(data.clients);
        }
      } catch (e) {
        console.error('Failed to load trainer data:', e);
      }
      setIsLoaded(true);
    };
    loadData();
  }, []);

  // Save program
  const saveProgram = async () => {
    if (!programName.trim()) return;

    const programData = {
      id: editingProgram?.id || Date.now().toString(),
      name: programName,
      workouts: programWorkouts,
      activeWorkoutDays,
      clientCount: editingProgram?.clientCount || 0
    };

    try {
      const response = await fetch('/api/trainer/programs', {
        method: editingProgram ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(programData)
      });

      if (response.ok) {
        const savedProgram = await response.json();
        if (editingProgram) {
          setPrograms(prev => prev.map(p => p.id === savedProgram.id ? savedProgram : p));
        } else {
          setPrograms(prev => [...prev, savedProgram]);
        }
        closeProgramEditor();
      }
    } catch (e) {
      console.error('Failed to save program:', e);
    }
  };

  // Delete program
  const deleteProgram = async (programId: string) => {
    if (!confirm('Удалить программу? Она будет отвязана от всех клиентов.')) return;

    try {
      const response = await fetch(`/api/trainer/programs?id=${programId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setPrograms(prev => prev.filter(p => p.id !== programId));
      }
    } catch (e) {
      console.error('Failed to delete program:', e);
    }
  };

  // Open program editor
  const openProgramEditor = (program?: Program) => {
    if (program) {
      setEditingProgram(program);
      setProgramName(program.name);
      setProgramWorkouts(program.workouts);
      setActiveWorkoutDays(program.activeWorkoutDays);
    } else {
      setEditingProgram(null);
      setProgramName('');
      setProgramWorkouts(createEmptyProgram());
      setActiveWorkoutDays(4);
    }
    setShowProgramEditor(true);
    setEditingWorkoutId(null);
  };

  // Close program editor
  const closeProgramEditor = () => {
    setShowProgramEditor(false);
    setEditingProgram(null);
    setProgramName('');
    setProgramWorkouts(createEmptyProgram());
    setActiveWorkoutDays(4);
    setEditingWorkoutId(null);
  };

  // Exercise management
  const addExercise = () => {
    if (!editingWorkoutId || !exerciseForm.name) return;

    const newExercise: Exercise = {
      id: Date.now().toString(),
      name: exerciseForm.name,
      plannedSets: exerciseForm.plannedSets,
      restTime: exerciseForm.restTime || '2-3 мин',
      notes: exerciseForm.notes
    };

    setProgramWorkouts(prev => prev.map(w =>
      w.id === editingWorkoutId
        ? { ...w, exercises: [...w.exercises, newExercise] }
        : w
    ));
    setExerciseForm({ name: '', plannedSets: '', restTime: '2-3 мин', notes: '' });
  };

  const updateExercise = () => {
    if (!editingWorkoutId || !editingExerciseId || !exerciseForm.name) return;

    setProgramWorkouts(prev => prev.map(w =>
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

  const deleteExercise = (workoutId: string, exerciseId: string) => {
    setProgramWorkouts(prev => prev.map(w =>
      w.id === workoutId
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

  const moveExercise = (workoutId: string, exerciseId: string, direction: 'up' | 'down') => {
    setProgramWorkouts(prev => prev.map(w => {
      if (w.id !== workoutId) return w;
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

  // Assign program to client
  const assignProgram = async (clientId: string, programId: string | null) => {
    try {
      const response = await fetch('/api/trainer/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, programId })
      });

      if (response.ok) {
        const program = programs.find(p => p.id === programId);
        setClients(prev => prev.map(c =>
          c.id === clientId
            ? { ...c, programId, programName: program?.name || null }
            : c
        ));
      }
    } catch (e) {
      console.error('Failed to assign program:', e);
    }
  };

  if (!isLoaded) {
    return (
      <main style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ color: 'var(--text-muted)' }}>Загрузка...</div>
      </main>
    );
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      padding: '16px',
      paddingBottom: '100px'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '24px'
      }}>
        <h1 style={{
          fontSize: '24px',
          fontWeight: 800,
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            background: 'var(--yellow)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Dumbbell size={22} color="#000" />
          </div>
          Тренер
        </h1>
      </div>

      {/* View Toggle */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '20px',
        background: 'var(--bg-card)',
        padding: '6px',
        borderRadius: '14px',
        border: '1px solid var(--border)'
      }}>
        <button
          onClick={() => setView('programs')}
          style={{
            flex: 1,
            padding: '12px',
            background: view === 'programs' ? 'var(--yellow)' : 'transparent',
            border: 'none',
            borderRadius: '10px',
            color: view === 'programs' ? '#000' : 'var(--text-secondary)',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          <Dumbbell size={18} />
          Программы
        </button>
        <button
          onClick={() => setView('clients')}
          style={{
            flex: 1,
            padding: '12px',
            background: view === 'clients' ? 'var(--yellow)' : 'transparent',
            border: 'none',
            borderRadius: '10px',
            color: view === 'clients' ? '#000' : 'var(--text-secondary)',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          <Users size={18} />
          Клиенты
        </button>
      </div>

      {/* PROGRAMS VIEW */}
      {view === 'programs' && (
        <div>
          {/* Add Program Button */}
          <button
            onClick={() => openProgramEditor()}
            style={{
              width: '100%',
              padding: '16px',
              background: 'var(--bg-card)',
              border: '2px dashed var(--border-strong)',
              borderRadius: '16px',
              color: 'var(--text-secondary)',
              fontWeight: 600,
              fontSize: '15px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              marginBottom: '16px'
            }}
          >
            <Plus size={20} />
            Создать программу
          </button>

          {/* Programs List */}
          {programs.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: 'var(--text-muted)'
            }}>
              <Dumbbell size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
              <div style={{ fontSize: '16px', marginBottom: '8px' }}>Нет программ</div>
              <div style={{ fontSize: '14px' }}>Создайте первую программу тренировок</div>
            </div>
          ) : (
            programs.map(program => (
              <div
                key={program.id}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: '16px',
                  border: '1px solid var(--border)',
                  padding: '16px',
                  marginBottom: '12px'
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '12px'
                }}>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>
                      {program.name}
                    </h3>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      {program.activeWorkoutDays} тренировочных дней • {program.clientCount} клиентов
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => openProgramEditor(program)}
                      style={{
                        padding: '10px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: '10px',
                        color: 'var(--text-muted)',
                        cursor: 'pointer'
                      }}
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => deleteProgram(program.id)}
                      style={{
                        padding: '10px',
                        background: 'var(--red-dim)',
                        border: '1px solid rgba(255, 77, 106, 0.3)',
                        borderRadius: '10px',
                        color: 'var(--red)',
                        cursor: 'pointer'
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Workout preview */}
                <div style={{
                  display: 'flex',
                  gap: '6px',
                  flexWrap: 'wrap'
                }}>
                  {program.workouts.slice(0, 7).map((w, i) => (
                    <div
                      key={w.id}
                      style={{
                        padding: '6px 12px',
                        background: i < program.activeWorkoutDays ? 'var(--yellow-dim)' : 'var(--bg-elevated)',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: i < program.activeWorkoutDays ? 'var(--yellow)' : 'var(--text-muted)',
                        opacity: i < program.activeWorkoutDays ? 1 : 0.5
                      }}
                    >
                      T{i + 1}: {w.exercises.length} упр.
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* CLIENTS VIEW */}
      {view === 'clients' && (
        <div>
          {clients.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: 'var(--text-muted)'
            }}>
              <Users size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
              <div style={{ fontSize: '16px', marginBottom: '8px' }}>Нет клиентов</div>
              <div style={{ fontSize: '14px' }}>Клиенты появятся после регистрации</div>
            </div>
          ) : (
            clients.map(client => (
              <div
                key={client.id}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: '16px',
                  border: '1px solid var(--border)',
                  padding: '16px',
                  marginBottom: '12px'
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '12px',
                      background: 'var(--bg-elevated)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <User size={22} style={{ color: 'var(--text-muted)' }} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '15px' }}>
                        {client.name || client.email}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {client.programName || 'Нет программы'}
                      </div>
                    </div>
                  </div>

                  <select
                    value={client.programId || ''}
                    onChange={(e) => assignProgram(client.id, e.target.value || null)}
                    style={{
                      padding: '10px 14px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="">Без программы</option>
                    {programs.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* PROGRAM EDITOR MODAL */}
      {showProgramEditor && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.9)',
            zIndex: 100,
            overflowY: 'auto',
            padding: '16px'
          }}
        >
          <div style={{
            maxWidth: '600px',
            margin: '0 auto',
            background: 'var(--bg-card)',
            borderRadius: '20px',
            border: '1px solid var(--border)'
          }}>
            {/* Header */}
            <div style={{
              padding: '20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700 }}>
                {editingProgram ? 'Редактировать программу' : 'Новая программа'}
              </h2>
              <button
                onClick={closeProgramEditor}
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

            {/* Content */}
            <div style={{ padding: '20px' }}>
              {/* Program Name */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  fontSize: '13px',
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                  display: 'block',
                  marginBottom: '8px'
                }}>
                  Название программы
                </label>
                <input
                  type="text"
                  value={programName}
                  onChange={(e) => setProgramName(e.target.value)}
                  placeholder="Например: Набор массы"
                  style={{ width: '100%' }}
                />
              </div>

              {/* Active Days Selector */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  fontSize: '13px',
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                  display: 'block',
                  marginBottom: '8px'
                }}>
                  Количество тренировочных дней
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[1, 2, 3, 4, 5, 6, 7].map(num => (
                    <button
                      key={num}
                      onClick={() => setActiveWorkoutDays(num)}
                      style={{
                        flex: 1,
                        padding: '12px',
                        background: activeWorkoutDays === num ? 'var(--yellow)' : 'var(--bg-elevated)',
                        border: activeWorkoutDays === num ? 'none' : '1px solid var(--border)',
                        borderRadius: '10px',
                        color: activeWorkoutDays === num ? '#000' : 'var(--text-primary)',
                        fontWeight: 700,
                        fontSize: '15px',
                        cursor: 'pointer'
                      }}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>

              {/* Workouts */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  fontSize: '13px',
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                  display: 'block',
                  marginBottom: '12px'
                }}>
                  Тренировки
                </label>

                {programWorkouts.map((workout, i) => (
                  <div
                    key={workout.id}
                    style={{
                      background: i < activeWorkoutDays ? 'var(--bg-elevated)' : 'var(--bg-primary)',
                      borderRadius: '12px',
                      border: `1px solid ${i < activeWorkoutDays ? 'var(--border)' : 'var(--border)'}`,
                      marginBottom: '10px',
                      opacity: i < activeWorkoutDays ? 1 : 0.5
                    }}
                  >
                    <button
                      onClick={() => setEditingWorkoutId(editingWorkoutId === workout.id ? null : workout.id)}
                      disabled={i >= activeWorkoutDays}
                      style={{
                        width: '100%',
                        padding: '14px 16px',
                        background: 'transparent',
                        border: 'none',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: i < activeWorkoutDays ? 'pointer' : 'not-allowed',
                        color: 'var(--text-primary)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{
                          fontSize: '14px',
                          fontWeight: 700,
                          color: i < activeWorkoutDays ? 'var(--yellow)' : 'var(--text-muted)'
                        }}>
                          T{i + 1}
                        </span>
                        <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                          {workout.exercises.length} упражнений
                        </span>
                      </div>
                      {i < activeWorkoutDays && (
                        editingWorkoutId === workout.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />
                      )}
                    </button>

                    {/* Expanded workout editor */}
                    {editingWorkoutId === workout.id && (
                      <div style={{ padding: '0 16px 16px' }}>
                        {/* Add exercise form */}
                        <div style={{
                          background: 'var(--bg-card)',
                          borderRadius: '10px',
                          padding: '12px',
                          marginBottom: '12px',
                          border: '1px solid var(--border)'
                        }}>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px', fontWeight: 600 }}>
                            {editingExerciseId ? 'Редактировать' : 'Добавить упражнение'}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <input
                              type="text"
                              placeholder="Название"
                              value={exerciseForm.name}
                              onChange={e => setExerciseForm({ ...exerciseForm, name: e.target.value })}
                              style={{ fontSize: '13px', padding: '10px 12px' }}
                            />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                              <input
                                type="text"
                                placeholder="Подходы (3x12)"
                                value={exerciseForm.plannedSets}
                                onChange={e => setExerciseForm({ ...exerciseForm, plannedSets: e.target.value })}
                                style={{ fontSize: '13px', padding: '10px 12px' }}
                              />
                              <input
                                type="text"
                                placeholder="Отдых"
                                value={exerciseForm.restTime}
                                onChange={e => setExerciseForm({ ...exerciseForm, restTime: e.target.value })}
                                style={{ fontSize: '13px', padding: '10px 12px' }}
                              />
                            </div>
                            <input
                              type="text"
                              placeholder="Заметки"
                              value={exerciseForm.notes}
                              onChange={e => setExerciseForm({ ...exerciseForm, notes: e.target.value })}
                              style={{ fontSize: '13px', padding: '10px 12px' }}
                            />
                            <div style={{ display: 'flex', gap: '8px' }}>
                              {editingExerciseId && (
                                <button
                                  onClick={() => {
                                    setEditingExerciseId(null);
                                    setExerciseForm({ name: '', plannedSets: '', restTime: '2-3 мин', notes: '' });
                                  }}
                                  style={{
                                    flex: 1,
                                    padding: '10px',
                                    background: 'var(--bg-elevated)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '8px',
                                    color: 'var(--text-muted)',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Отмена
                                </button>
                              )}
                              <button
                                onClick={editingExerciseId ? updateExercise : addExercise}
                                disabled={!exerciseForm.name}
                                style={{
                                  flex: 1,
                                  padding: '10px',
                                  background: exerciseForm.name ? 'var(--yellow)' : 'var(--bg-elevated)',
                                  border: 'none',
                                  borderRadius: '8px',
                                  color: exerciseForm.name ? '#000' : 'var(--text-muted)',
                                  fontWeight: 600,
                                  fontSize: '13px',
                                  cursor: exerciseForm.name ? 'pointer' : 'not-allowed'
                                }}
                              >
                                {editingExerciseId ? 'Сохранить' : 'Добавить'}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Exercise list */}
                        {workout.exercises.map((ex, idx) => (
                          <div
                            key={ex.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '10px 12px',
                              background: 'var(--bg-card)',
                              borderRadius: '10px',
                              marginBottom: '8px',
                              border: '1px solid var(--border)'
                            }}
                          >
                            <div style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px'
                            }}>
                              <button
                                onClick={() => moveExercise(workout.id, ex.id, 'up')}
                                disabled={idx === 0}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: idx === 0 ? 'var(--border)' : 'var(--text-muted)',
                                  cursor: idx === 0 ? 'not-allowed' : 'pointer',
                                  padding: '2px'
                                }}
                              >
                                <ChevronUp size={12} />
                              </button>
                              <button
                                onClick={() => moveExercise(workout.id, ex.id, 'down')}
                                disabled={idx === workout.exercises.length - 1}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: idx === workout.exercises.length - 1 ? 'var(--border)' : 'var(--text-muted)',
                                  cursor: idx === workout.exercises.length - 1 ? 'not-allowed' : 'pointer',
                                  padding: '2px'
                                }}
                              >
                                <ChevronDown size={12} />
                              </button>
                            </div>

                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>
                                <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{idx + 1}.</span> {ex.name}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--blue)' }}>
                                {ex.plannedSets} • {ex.restTime}
                              </div>
                              {ex.notes && (
                                <div style={{ fontSize: '10px', color: 'var(--yellow)', marginTop: '2px' }}>
                                  {ex.notes}
                                </div>
                              )}
                            </div>

                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button
                                onClick={() => startEditExercise(ex)}
                                style={{
                                  padding: '6px',
                                  background: 'var(--bg-elevated)',
                                  border: '1px solid var(--border)',
                                  borderRadius: '6px',
                                  color: 'var(--text-muted)',
                                  cursor: 'pointer'
                                }}
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                onClick={() => deleteExercise(workout.id, ex.id)}
                                style={{
                                  padding: '6px',
                                  background: 'var(--red-dim)',
                                  border: '1px solid rgba(255, 77, 106, 0.3)',
                                  borderRadius: '6px',
                                  color: 'var(--red)',
                                  cursor: 'pointer'
                                }}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        ))}

                        {workout.exercises.length === 0 && (
                          <div style={{
                            textAlign: 'center',
                            padding: '20px',
                            color: 'var(--text-muted)',
                            fontSize: '13px'
                          }}>
                            Нет упражнений
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 20px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              gap: '12px'
            }}>
              <button
                onClick={closeProgramEditor}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: '15px',
                  cursor: 'pointer'
                }}
              >
                Отмена
              </button>
              <button
                onClick={saveProgram}
                disabled={!programName.trim()}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: programName.trim() ? 'var(--yellow)' : 'var(--bg-elevated)',
                  border: 'none',
                  borderRadius: '12px',
                  color: programName.trim() ? '#000' : 'var(--text-muted)',
                  fontWeight: 700,
                  fontSize: '15px',
                  cursor: programName.trim() ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: programName.trim() ? '0 4px 20px var(--yellow-glow)' : 'none'
                }}
              >
                <Save size={18} />
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

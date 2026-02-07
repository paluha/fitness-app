'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Menu, X, Dumbbell, Apple, TrendingUp, Users, Smartphone, ChevronRight, Check, Utensils, Scale, Globe } from 'lucide-react';
import { translations, Language } from '@/lib/translations';

// Language Switcher Component
function LanguageSwitcher({ lang, setLang }: { lang: Language; setLang: (l: Language) => void }) {
  const [open, setOpen] = useState(false);

  const handleSwitch = (newLang: Language) => {
    setLang(newLang);
    document.cookie = `lang=${newLang};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 12px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px',
          color: 'rgba(255,255,255,0.7)',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
      >
        <Globe size={14} />
        {lang.toUpperCase()}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '8px',
          background: 'rgba(20, 20, 25, 0.98)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '10px',
          overflow: 'hidden',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          zIndex: 1000
        }}>
          {(['ru', 'en'] as Language[]).map((l) => (
            <button
              key={l}
              onClick={() => handleSwitch(l)}
              style={{
                display: 'block',
                width: '100%',
                padding: '12px 20px',
                background: lang === l ? 'rgba(255, 232, 4, 0.1)' : 'transparent',
                border: 'none',
                color: lang === l ? '#ffe804' : 'rgba(255,255,255,0.7)',
                fontSize: '14px',
                fontWeight: lang === l ? 600 : 400,
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {l === 'ru' ? 'Русский' : 'English'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Phone Demo Component with animated screens
function PhoneDemo({ lang }: { lang: Language }) {
  const t = translations[lang];
  const [currentScreen, setCurrentScreen] = useState(0);
  const [animationPhase, setAnimationPhase] = useState(0);

  // Cycle through screens
  useEffect(() => {
    const screenTimer = setInterval(() => {
      setCurrentScreen((prev) => (prev + 1) % 3);
      setAnimationPhase(0);
    }, 5000);

    return () => clearInterval(screenTimer);
  }, []);

  // Animate within each screen
  useEffect(() => {
    const phaseTimer = setInterval(() => {
      setAnimationPhase((prev) => (prev + 1) % 4);
    }, 1000);

    return () => clearInterval(phaseTimer);
  }, [currentScreen]);

  // Screen 1: Workout tracking
  const WorkoutScreen = () => {
    const exercises = [
      { name: t.benchPress, sets: '4×10', weight: '80 kg', completed: animationPhase >= 1 },
      { name: t.pullUps, sets: '4×12', weight: '—', completed: animationPhase >= 2 },
      { name: t.shoulderPress, sets: '3×10', weight: '40 kg', completed: animationPhase >= 3 },
    ];

    const completedCount = exercises.filter(e => e.completed).length;
    const progress = (completedCount / exercises.length) * 100;

    return (
      <div style={{ padding: '16px', height: '100%' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>{t.workout}</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff' }}>{t.upperBody}</div>
          </div>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '12px',
            background: 'rgba(255, 232, 4, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Dumbbell size={18} color="#ffe804" />
          </div>
        </div>

        {/* Progress */}
        <div style={{
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '14px',
          padding: '14px',
          marginBottom: '14px',
          border: '1px solid rgba(255,255,255,0.06)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>{t.progress}</span>
            <span style={{ fontSize: '12px', color: '#ffe804', fontWeight: 600 }}>{Math.round(progress)}%</span>
          </div>
          <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              width: `${progress}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #ffe804, #ffa500)',
              borderRadius: '3px',
              transition: 'width 0.5s ease'
            }} />
          </div>
        </div>

        {/* Exercises */}
        {exercises.map((ex, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px',
            background: ex.completed ? 'rgba(0, 200, 83, 0.1)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${ex.completed ? 'rgba(0, 200, 83, 0.25)' : 'rgba(255,255,255,0.06)'}`,
            borderRadius: '12px',
            marginBottom: '8px',
            transition: 'all 0.3s ease'
          }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '10px',
              background: ex.completed ? '#00c853' : 'rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease'
            }}>
              {ex.completed ? (
                <Check size={16} color="#fff" />
              ) : (
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{i + 1}</span>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{ex.name}</div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>{ex.sets} · {ex.weight}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Screen 2: Nutrition tracking
  const NutritionScreen = () => {
    const macros = [
      { name: t.calories, current: animationPhase >= 1 ? 1850 : 1200, target: 2200, color: '#ffe804' },
      { name: t.protein, current: animationPhase >= 2 ? 142 : 80, target: 180, unit: 'g', color: '#ff6b6b' },
      { name: t.carbs, current: animationPhase >= 3 ? 210 : 150, target: 250, unit: 'g', color: '#4da6ff' },
    ];

    return (
      <div style={{ padding: '16px', height: '100%' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>{t.nutrition}</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff' }}>{lang === 'ru' ? 'Сегодня' : 'Today'}</div>
          </div>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '12px',
            background: 'rgba(0, 200, 83, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Utensils size={18} color="#00c853" />
          </div>
        </div>

        {/* Macros */}
        {macros.map((macro, i) => (
          <div key={i} style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '14px',
            padding: '14px',
            marginBottom: '10px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', color: '#fff', fontWeight: 600 }}>{macro.name}</span>
              <span style={{ fontSize: '12px', color: macro.color, fontWeight: 600 }}>
                {macro.current}{macro.unit || ''} / {macro.target}{macro.unit || ''}
              </span>
            </div>
            <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min((macro.current / macro.target) * 100, 100)}%`,
                height: '100%',
                background: macro.color,
                borderRadius: '3px',
                transition: 'width 0.5s ease'
              }} />
            </div>
          </div>
        ))}

        {/* Add meal button */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: '14px',
          background: 'rgba(255, 232, 4, 0.1)',
          border: '1px solid rgba(255, 232, 4, 0.2)',
          borderRadius: '12px',
          marginTop: '12px'
        }}>
          <span style={{ fontSize: '20px' }}>+</span>
          <span style={{ fontSize: '13px', color: '#ffe804', fontWeight: 600 }}>
            {lang === 'ru' ? 'Добавить приём пищи' : 'Add meal'}
          </span>
        </div>
      </div>
    );
  };

  // Screen 3: Progress/Weight tracking
  const ProgressScreen = () => {
    const weights = [82.5, 82.0, 81.5, 81.2, 80.8, 80.5, 80.0];
    const visibleBars = Math.min(animationPhase + 4, weights.length);

    return (
      <div style={{ padding: '16px', height: '100%' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>{t.progress}</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff' }}>{t.weight}</div>
          </div>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '12px',
            background: 'rgba(77, 166, 255, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Scale size={18} color="#4da6ff" />
          </div>
        </div>

        {/* Current weight card */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(77, 166, 255, 0.15) 0%, rgba(77, 166, 255, 0.05) 100%)',
          border: '1px solid rgba(77, 166, 255, 0.2)',
          borderRadius: '16px',
          padding: '20px',
          textAlign: 'center',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '36px', fontWeight: 800, color: '#fff' }}>
            {weights[visibleBars - 1]} <span style={{ fontSize: '16px', color: 'rgba(255,255,255,0.6)' }}>kg</span>
          </div>
          <div style={{ fontSize: '12px', color: '#4da6ff', marginTop: '4px' }}>
            -2.5 kg {t.thisMonth}
          </div>
        </div>

        {/* Mini chart */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '14px',
          padding: '16px'
        }}>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '12px' }}>
            {lang === 'ru' ? 'Последние 7 дней' : 'Last 7 days'}
          </div>
          <div style={{ display: 'flex', alignItems: 'end', gap: '8px', height: '60px' }}>
            {weights.slice(0, visibleBars).map((w, i) => {
              const height = ((w - 79) / 4) * 100;
              return (
                <div key={i} style={{
                  flex: 1,
                  height: `${height}%`,
                  background: i === visibleBars - 1 ? '#4da6ff' : 'rgba(77, 166, 255, 0.3)',
                  borderRadius: '4px',
                  transition: 'height 0.5s ease'
                }} />
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const screens = [WorkoutScreen, NutritionScreen, ProgressScreen];
  const CurrentScreenComponent = screens[currentScreen];

  return (
    <div style={{
      width: '280px',
      height: '560px',
      margin: '0 auto',
      background: '#0d0d0f',
      borderRadius: '44px',
      border: '6px solid #2a2a32',
      boxShadow: '0 50px 100px rgba(0,0,0,0.6), 0 0 120px rgba(255, 232, 4, 0.08)',
      overflow: 'hidden',
      position: 'relative'
    }}>
      {/* Dynamic Island */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '90px',
        height: '28px',
        background: '#000',
        borderRadius: '14px',
        zIndex: 20
      }} />

      {/* Screen content */}
      <div style={{
        position: 'absolute',
        top: '44px',
        left: 0,
        right: 0,
        bottom: 0,
        background: '#0d0d0f',
        overflow: 'hidden'
      }}>
        <CurrentScreenComponent />
      </div>

      {/* Screen indicator dots */}
      <div style={{
        position: 'absolute',
        bottom: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: '6px',
        zIndex: 20
      }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            width: currentScreen === i ? '16px' : '6px',
            height: '6px',
            borderRadius: '3px',
            background: currentScreen === i ? '#ffe804' : 'rgba(255,255,255,0.3)',
            transition: 'all 0.3s ease'
          }} />
        ))}
      </div>
    </div>
  );
}

// App Store Button Component
function AppStoreButton({ store, lang }: { store: 'apple' | 'google'; lang: Language }) {
  const isApple = store === 'apple';

  return (
    <a
      href={isApple ? '#' : '#'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px 20px',
        background: '#fff',
        borderRadius: '12px',
        textDecoration: 'none',
        transition: 'all 0.2s ease',
        minWidth: '160px'
      }}
    >
      {isApple ? (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="#000">
          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
        </svg>
      ) : (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 0 1-.61-.92V2.734a1 1 0 0 1 .609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.198l2.807 1.626a1 1 0 0 1 0 1.73l-2.808 1.626L15.206 12l2.492-2.491zM5.864 2.658L16.8 8.99l-2.302 2.302-8.634-8.634z" fill="#000"/>
        </svg>
      )}
      <div>
        <div style={{ fontSize: '10px', color: '#666', lineHeight: 1 }}>
          {isApple
            ? (lang === 'ru' ? 'Загрузить в' : 'Download on the')
            : (lang === 'ru' ? 'ДОСТУПНО В' : 'GET IT ON')}
        </div>
        <div style={{ fontSize: '16px', color: '#000', fontWeight: 600, lineHeight: 1.2 }}>
          {isApple ? 'App Store' : 'Google Play'}
        </div>
      </div>
    </a>
  );
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [lang, setLang] = useState<Language>('ru');

  // Read language from cookie on mount
  useEffect(() => {
    const match = document.cookie.match(/lang=(ru|en)/);
    if (match) {
      setLang(match[1] as Language);
    }
  }, []);

  const t = translations[lang];

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0f 0%, #0d0d12 50%, #0a0a0f 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <header style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        padding: '16px 24px',
        background: 'rgba(10, 10, 15, 0.8)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.05)'
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #ffe804 0%, #ffa500 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <svg width="22" height="22" viewBox="0 0 26 26" fill="none">
                <rect x="4" y="6" width="12" height="3.5" rx="1" fill="#000" />
                <rect x="8.25" y="6" width="3.5" height="16" rx="1" fill="#000" />
                <path d="M15 14L22 21" stroke="#000" strokeWidth="3" strokeLinecap="round" />
                <path d="M22 14L15 21" stroke="#000" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
            <span style={{
              fontSize: '22px',
              fontWeight: 800,
              color: '#fff',
              letterSpacing: '-0.5px'
            }}>
              Trainx
            </span>
          </div>

          {/* Desktop Navigation */}
          <nav style={{
            display: 'flex',
            alignItems: 'center',
            gap: '24px'
          }} className="desktop-nav">
            <Link href="#features" style={{
              color: 'rgba(255,255,255,0.7)',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 500,
              transition: 'color 0.2s'
            }}>
              {lang === 'ru' ? 'Возможности' : 'Features'}
            </Link>
            <Link href="#how-it-works" style={{
              color: 'rgba(255,255,255,0.7)',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 500,
              transition: 'color 0.2s'
            }}>
              {t.howItWorksTitle}
            </Link>
            <LanguageSwitcher lang={lang} setLang={setLang} />
            <Link href="/login" style={{
              color: 'rgba(255,255,255,0.7)',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 500,
              transition: 'color 0.2s'
            }}>
              {t.login}
            </Link>
            <Link href="/trainer" style={{
              padding: '10px 20px',
              background: 'linear-gradient(135deg, #ffe804 0%, #ffa500 100%)',
              borderRadius: '10px',
              color: '#000',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 700,
              transition: 'all 0.2s',
              boxShadow: '0 4px 20px rgba(255, 232, 4, 0.25)'
            }}>
              {lang === 'ru' ? 'Для тренеров' : 'For Trainers'}
            </Link>
          </nav>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              display: 'none',
              background: 'none',
              border: 'none',
              color: '#fff',
              padding: '8px',
              cursor: 'pointer'
            }}
            className="mobile-menu-btn"
          >
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile Navigation */}
        {menuOpen && (
          <nav style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'rgba(10, 10, 15, 0.98)',
            backdropFilter: 'blur(20px)',
            padding: '24px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }} className="mobile-nav">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
              <LanguageSwitcher lang={lang} setLang={setLang} />
            </div>
            <Link href="#features" onClick={() => setMenuOpen(false)} style={{
              color: 'rgba(255,255,255,0.7)',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 500,
              padding: '12px 0'
            }}>
              {lang === 'ru' ? 'Возможности' : 'Features'}
            </Link>
            <Link href="#how-it-works" onClick={() => setMenuOpen(false)} style={{
              color: 'rgba(255,255,255,0.7)',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 500,
              padding: '12px 0'
            }}>
              {t.howItWorksTitle}
            </Link>
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '8px 0' }} />
            <Link href="/login" onClick={() => setMenuOpen(false)} style={{
              color: '#fff',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 600,
              padding: '12px 0'
            }}>
              {lang === 'ru' ? 'Войти как клиент' : 'Login as client'}
            </Link>
            <Link href="/trainer" onClick={() => setMenuOpen(false)} style={{
              display: 'block',
              padding: '14px 24px',
              background: 'linear-gradient(135deg, #ffe804 0%, #ffa500 100%)',
              borderRadius: '12px',
              color: '#000',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 700,
              textAlign: 'center'
            }}>
              {lang === 'ru' ? 'Войти как тренер' : 'Login as trainer'}
            </Link>
          </nav>
        )}
      </header>

      {/* Hero Section */}
      <section style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '120px 24px 80px',
        position: 'relative'
      }}>
        {/* Background effects */}
        <div style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none'
        }}>
          <div style={{
            position: 'absolute',
            top: '20%',
            left: '10%',
            width: '400px',
            height: '400px',
            background: 'radial-gradient(circle, rgba(255, 232, 4, 0.08) 0%, transparent 70%)',
            borderRadius: '50%',
            filter: 'blur(80px)'
          }} />
          <div style={{
            position: 'absolute',
            bottom: '10%',
            right: '10%',
            width: '350px',
            height: '350px',
            background: 'radial-gradient(circle, rgba(255, 165, 0, 0.06) 0%, transparent 70%)',
            borderRadius: '50%',
            filter: 'blur(60px)'
          }} />
        </div>

        <div style={{
          maxWidth: '1100px',
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '60px',
          alignItems: 'center',
          position: 'relative',
          zIndex: 1
        }} className="hero-grid">
          {/* Left side - Text */}
          <div>
            {/* Badge */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              background: 'rgba(255, 232, 4, 0.1)',
              border: '1px solid rgba(255, 232, 4, 0.2)',
              borderRadius: '100px',
              marginBottom: '24px'
            }}>
              <Smartphone size={16} color="#ffe804" />
              <span style={{ color: '#ffe804', fontSize: '13px', fontWeight: 600 }}>
                iOS & Android
              </span>
            </div>

            {/* Main Title */}
            <h1 style={{
              fontSize: 'clamp(40px, 8vw, 64px)',
              fontWeight: 800,
              color: '#fff',
              lineHeight: 1.1,
              marginBottom: '24px',
              letterSpacing: '-2px'
            }}>
              {t.heroTitle}{' '}
              <span style={{
                display: 'inline-block',
                padding: '4px 16px',
                background: 'linear-gradient(135deg, #ffe804 0%, #ffa500 100%)',
                borderRadius: '8px',
                color: '#000'
              }}>
                {t.heroHighlight}
              </span>
              <br />
              <span style={{
                background: 'linear-gradient(135deg, #ffe804 0%, #ffa500 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}>
                {t.heroSubtitle}
              </span>
            </h1>

            {/* Subtitle */}
            <p style={{
              fontSize: '18px',
              color: 'rgba(255,255,255,0.6)',
              marginBottom: '32px',
              lineHeight: 1.7,
              maxWidth: '480px'
            }}>
              {t.heroDescription}
            </p>

            {/* App Store Buttons */}
            <div style={{
              display: 'flex',
              gap: '12px',
              marginBottom: '24px',
              flexWrap: 'wrap'
            }}>
              <AppStoreButton store="apple" lang={lang} />
              <AppStoreButton store="google" lang={lang} />
            </div>

            {/* Web version link */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <Link href="/login" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                color: '#ffe804',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: 600
              }}>
                {lang === 'ru' ? 'Открыть веб-версию' : 'Open web version'}
                <ChevronRight size={16} />
              </Link>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
                {lang === 'ru' ? 'Работает как приложение' : 'Works like an app'}
              </span>
            </div>
          </div>

          {/* Right side - Phone Demo */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <PhoneDemo lang={lang} />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" style={{
        padding: '100px 24px',
        position: 'relative'
      }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <h2 style={{
              fontSize: 'clamp(28px, 5vw, 40px)',
              fontWeight: 800,
              color: '#fff',
              marginBottom: '16px',
              letterSpacing: '-1px'
            }}>
              {t.featuresTitle}
            </h2>
            <p style={{
              fontSize: '16px',
              color: 'rgba(255,255,255,0.5)',
              maxWidth: '500px',
              margin: '0 auto'
            }}>
              {t.featuresSubtitle}
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '24px'
          }}>
            {[
              {
                icon: <Dumbbell size={28} />,
                title: t.feature1Title,
                description: t.feature1Desc,
                color: '#ffe804'
              },
              {
                icon: <Apple size={28} />,
                title: t.feature2Title,
                description: t.feature2Desc,
                color: '#00c853'
              },
              {
                icon: <TrendingUp size={28} />,
                title: t.feature3Title,
                description: t.feature3Desc,
                color: '#4da6ff'
              },
              {
                icon: <Users size={28} />,
                title: t.feature4Title,
                description: t.feature4Desc,
                color: '#a855f7'
              }
            ].map((feature, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '20px',
                padding: '32px',
                transition: 'all 0.3s ease'
              }}>
                <div style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '16px',
                  background: `${feature.color}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '20px',
                  color: feature.color
                }}>
                  {feature.icon}
                </div>
                <h3 style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color: '#fff',
                  marginBottom: '12px'
                }}>
                  {feature.title}
                </h3>
                <p style={{
                  fontSize: '14px',
                  color: 'rgba(255,255,255,0.5)',
                  lineHeight: 1.6
                }}>
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" style={{
        padding: '100px 24px',
        background: 'rgba(255,255,255,0.02)'
      }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <h2 style={{
              fontSize: 'clamp(28px, 5vw, 40px)',
              fontWeight: 800,
              color: '#fff',
              marginBottom: '16px',
              letterSpacing: '-1px'
            }}>
              {t.howItWorksTitle}
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {[
              { step: '1', title: t.step1Title, desc: t.step1Desc },
              { step: '2', title: t.step2Title, desc: t.step2Desc },
              { step: '3', title: t.step3Title, desc: t.step3Desc },
              { step: '4', title: t.step4Title, desc: t.step4Desc }
            ].map((item, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '20px',
                padding: '24px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '16px'
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '14px',
                  background: 'linear-gradient(135deg, #ffe804 0%, #ffa500 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  fontWeight: 800,
                  color: '#000',
                  flexShrink: 0
                }}>
                  {item.step}
                </div>
                <div>
                  <h3 style={{
                    fontSize: '18px',
                    fontWeight: 700,
                    color: '#fff',
                    marginBottom: '6px'
                  }}>
                    {item.title}
                  </h3>
                  <p style={{
                    fontSize: '14px',
                    color: 'rgba(255,255,255,0.5)'
                  }}>
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section style={{
        padding: '100px 24px',
        textAlign: 'center'
      }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: 'clamp(28px, 5vw, 40px)',
            fontWeight: 800,
            color: '#fff',
            marginBottom: '20px',
            letterSpacing: '-1px'
          }}>
            {t.ctaTitle}
          </h2>
          <p style={{
            fontSize: '16px',
            color: 'rgba(255,255,255,0.5)',
            marginBottom: '32px'
          }}>
            {t.ctaSubtitle}
          </p>

          {/* App Store Buttons */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '12px',
            marginBottom: '24px',
            flexWrap: 'wrap'
          }}>
            <AppStoreButton store="apple" lang={lang} />
            <AppStoreButton store="google" lang={lang} />
          </div>

          <Link href="/trainer" style={{
            color: 'rgba(255,255,255,0.6)',
            textDecoration: 'none',
            fontSize: '14px'
          }}>
            {lang === 'ru' ? 'Я тренер →' : 'I\'m a trainer →'}
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        padding: '40px 24px',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        textAlign: 'center'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          marginBottom: '16px'
        }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #ffe804 0%, #ffa500 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="14" height="14" viewBox="0 0 26 26" fill="none">
              <rect x="4" y="6" width="12" height="3.5" rx="1" fill="#000" />
              <rect x="8.25" y="6" width="3.5" height="16" rx="1" fill="#000" />
              <path d="M15 14L22 21" stroke="#000" strokeWidth="3" strokeLinecap="round" />
              <path d="M22 14L15 21" stroke="#000" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>Trainx</span>
        </div>
        <p style={{
          fontSize: '13px',
          color: 'rgba(255,255,255,0.4)'
        }}>
          {t.footerText}
        </p>
      </footer>

      {/* Responsive Styles */}
      <style jsx global>{`
        .desktop-nav {
          display: flex !important;
        }
        .mobile-menu-btn {
          display: none !important;
        }
        .mobile-nav {
          display: none !important;
        }
        .hero-grid {
          grid-template-columns: 1fr 1fr !important;
        }

        @media (max-width: 900px) {
          .hero-grid {
            grid-template-columns: 1fr !important;
            text-align: center;
          }
          .hero-grid > div:first-child {
            order: 2;
          }
          .hero-grid > div:last-child {
            order: 1;
            margin-bottom: 40px;
          }
        }

        @media (max-width: 768px) {
          .desktop-nav {
            display: none !important;
          }
          .mobile-menu-btn {
            display: flex !important;
          }
          .mobile-nav {
            display: flex !important;
          }
        }
      `}</style>
    </div>
  );
}

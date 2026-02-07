'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X, Dumbbell, Apple, TrendingUp, Users, Smartphone, ChevronRight } from 'lucide-react';

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

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
            gap: '32px'
          }} className="desktop-nav">
            <Link href="#features" style={{
              color: 'rgba(255,255,255,0.7)',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 500,
              transition: 'color 0.2s'
            }}>
              Возможности
            </Link>
            <Link href="#how-it-works" style={{
              color: 'rgba(255,255,255,0.7)',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 500,
              transition: 'color 0.2s'
            }}>
              Как это работает
            </Link>
            <Link href="/login" style={{
              color: 'rgba(255,255,255,0.7)',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 500,
              transition: 'color 0.2s'
            }}>
              Войти
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
              Для тренеров
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
            <Link href="#features" onClick={() => setMenuOpen(false)} style={{
              color: 'rgba(255,255,255,0.7)',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 500,
              padding: '12px 0'
            }}>
              Возможности
            </Link>
            <Link href="#how-it-works" onClick={() => setMenuOpen(false)} style={{
              color: 'rgba(255,255,255,0.7)',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 500,
              padding: '12px 0'
            }}>
              Как это работает
            </Link>
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '8px 0' }} />
            <Link href="/login" onClick={() => setMenuOpen(false)} style={{
              color: '#fff',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 600,
              padding: '12px 0'
            }}>
              Войти как клиент
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
              Войти как тренер
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
          maxWidth: '1000px',
          textAlign: 'center',
          position: 'relative',
          zIndex: 1
        }}>
          {/* Badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            background: 'rgba(255, 232, 4, 0.1)',
            border: '1px solid rgba(255, 232, 4, 0.2)',
            borderRadius: '100px',
            marginBottom: '32px'
          }}>
            <Smartphone size={16} color="#ffe804" />
            <span style={{ color: '#ffe804', fontSize: '13px', fontWeight: 600 }}>
              PWA приложение
            </span>
          </div>

          {/* Main Title */}
          <h1 style={{
            fontSize: 'clamp(40px, 8vw, 72px)',
            fontWeight: 800,
            color: '#fff',
            lineHeight: 1.1,
            marginBottom: '24px',
            letterSpacing: '-2px'
          }}>
            Твой персональный
            <br />
            <span style={{
              background: 'linear-gradient(135deg, #ffe804 0%, #ffa500 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>
              фитнес-трекер
            </span>
          </h1>

          {/* Subtitle */}
          <p style={{
            fontSize: 'clamp(16px, 3vw, 20px)',
            color: 'rgba(255,255,255,0.6)',
            maxWidth: '600px',
            margin: '0 auto 40px',
            lineHeight: 1.6
          }}>
            Отслеживай тренировки, питание и прогресс.
            Работай с тренером онлайн. Достигай целей быстрее.
          </p>

          {/* CTA Buttons */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px'
          }}>
            <Link href="/login" style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              padding: '18px 36px',
              background: 'linear-gradient(135deg, #ffe804 0%, #ffa500 100%)',
              borderRadius: '14px',
              color: '#000',
              textDecoration: 'none',
              fontSize: '17px',
              fontWeight: 700,
              boxShadow: '0 10px 40px rgba(255, 232, 4, 0.3)',
              transition: 'all 0.3s ease'
            }}>
              Начать бесплатно
              <ChevronRight size={20} />
            </Link>
            <span style={{
              fontSize: '13px',
              color: 'rgba(255,255,255,0.4)'
            }}>
              Добавь на главный экран — работает как приложение
            </span>
          </div>

          {/* App Preview */}
          <div style={{
            marginTop: '60px',
            position: 'relative'
          }}>
            <div style={{
              width: '280px',
              height: '500px',
              margin: '0 auto',
              background: 'linear-gradient(135deg, #1a1a1f 0%, #0d0d0f 100%)',
              borderRadius: '40px',
              border: '8px solid #2a2a32',
              boxShadow: '0 40px 80px rgba(0,0,0,0.5), 0 0 100px rgba(255, 232, 4, 0.1)',
              overflow: 'hidden',
              position: 'relative'
            }}>
              {/* Phone notch */}
              <div style={{
                position: 'absolute',
                top: '12px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '80px',
                height: '24px',
                background: '#000',
                borderRadius: '12px',
                zIndex: 10
              }} />

              {/* App content preview */}
              <div style={{
                padding: '50px 16px 20px',
                height: '100%'
              }}>
                {/* Header */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '20px'
                }}>
                  <div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Сегодня</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>Тренировка</div>
                  </div>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '10px',
                    background: 'rgba(255, 232, 4, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <Dumbbell size={16} color="#ffe804" />
                  </div>
                </div>

                {/* Progress card */}
                <div style={{
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: '16px',
                  padding: '16px',
                  marginBottom: '12px'
                }}>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                    Прогресс
                  </div>
                  <div style={{
                    height: '6px',
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: '3px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: '65%',
                      height: '100%',
                      background: 'linear-gradient(90deg, #ffe804, #ffa500)',
                      borderRadius: '3px'
                    }} />
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: '8px',
                    fontSize: '10px',
                    color: 'rgba(255,255,255,0.5)'
                  }}>
                    <span>4 из 6 упражнений</span>
                    <span style={{ color: '#ffe804' }}>65%</span>
                  </div>
                </div>

                {/* Exercise cards */}
                {['Жим лёжа', 'Приседания'].map((ex, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px',
                    background: i === 0 ? 'rgba(0, 200, 83, 0.1)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${i === 0 ? 'rgba(0, 200, 83, 0.2)' : 'rgba(255,255,255,0.05)'}`,
                    borderRadius: '12px',
                    marginBottom: '8px'
                  }}>
                    <div style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '8px',
                      background: i === 0 ? '#00c853' : 'rgba(255,255,255,0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      color: i === 0 ? '#fff' : 'rgba(255,255,255,0.5)'
                    }}>
                      {i === 0 ? '✓' : (i + 1)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#fff' }}>{ex}</div>
                      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>4×10</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
              Всё для твоего прогресса
            </h2>
            <p style={{
              fontSize: '16px',
              color: 'rgba(255,255,255,0.5)',
              maxWidth: '500px',
              margin: '0 auto'
            }}>
              Простой и мощный инструмент для отслеживания фитнес-целей
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
                title: 'Тренировки',
                description: 'Отслеживай выполнение упражнений, веса и подходы. Смотри прогресс по каждому упражнению.',
                color: '#ffe804'
              },
              {
                icon: <Apple size={28} />,
                title: 'Питание',
                description: 'Записывай приёмы пищи, считай калории и макросы. Достигай целей по питанию.',
                color: '#00c853'
              },
              {
                icon: <TrendingUp size={28} />,
                title: 'Прогресс',
                description: 'Графики веса, замеры тела, история тренировок. Видь свой путь к цели.',
                color: '#4da6ff'
              },
              {
                icon: <Users size={28} />,
                title: 'Работа с тренером',
                description: 'Тренер видит твои результаты и корректирует программу в реальном времени.',
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
              Начни за 30 секунд
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {[
              { step: '1', title: 'Открой сайт', desc: 'Зайди на trainx.app с телефона' },
              { step: '2', title: 'Добавь на экран', desc: 'Нажми "Добавить на главный экран" в браузере' },
              { step: '3', title: 'Войди в аккаунт', desc: 'Используй данные от тренера' },
              { step: '4', title: 'Тренируйся!', desc: 'Отмечай выполнение и следи за прогрессом' }
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
            Готов начать?
          </h2>
          <p style={{
            fontSize: '16px',
            color: 'rgba(255,255,255,0.5)',
            marginBottom: '32px'
          }}>
            Присоединяйся к Trainx и достигай своих фитнес-целей
          </p>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px'
          }}>
            <Link href="/login" style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              padding: '18px 36px',
              background: 'linear-gradient(135deg, #ffe804 0%, #ffa500 100%)',
              borderRadius: '14px',
              color: '#000',
              textDecoration: 'none',
              fontSize: '17px',
              fontWeight: 700,
              boxShadow: '0 10px 40px rgba(255, 232, 4, 0.3)'
            }}>
              Войти в приложение
              <ChevronRight size={20} />
            </Link>
            <Link href="/trainer" style={{
              color: 'rgba(255,255,255,0.6)',
              textDecoration: 'none',
              fontSize: '14px',
              marginTop: '8px'
            }}>
              Я тренер →
            </Link>
          </div>
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
          © 2024 Trainx. Все права защищены.
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

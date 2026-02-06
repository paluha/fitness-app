'use client';

import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const error = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(error ? 'Неверный email или пароль' : '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage('');

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      console.log('SignIn result:', result);

      if (result?.ok) {
        router.push(callbackUrl);
        router.refresh();
      } else {
        setErrorMessage('Неверный email или пароль');
        setIsLoading(false);
      }
    } catch (err) {
      console.error('SignIn error:', err);
      setErrorMessage('Произошла ошибка. Попробуйте позже.');
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      width: '100%',
      maxWidth: '420px',
      position: 'relative',
      zIndex: 1
    }}>
      {/* Logo and Title */}
      <div style={{
        textAlign: 'center',
        marginBottom: '40px'
      }}>
        <div style={{
          width: '80px',
          height: '80px',
          borderRadius: '24px',
          background: 'linear-gradient(135deg, #ffcc00 0%, #ffa500 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px',
          boxShadow: '0 20px 60px rgba(255, 204, 0, 0.3)'
        }}>
          {/* Trainx logo */}
          <svg width="44" height="44" viewBox="0 0 26 26" fill="none">
            <rect x="4" y="6" width="12" height="3.5" rx="1" fill="#000" />
            <rect x="8.25" y="6" width="3.5" height="16" rx="1" fill="#000" />
            <path d="M15 14L22 21" stroke="#000" strokeWidth="3" strokeLinecap="round" />
            <path d="M22 14L15 21" stroke="#000" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
        <h1 style={{
          fontSize: '32px',
          fontWeight: 800,
          color: '#fff',
          margin: '0 0 8px',
          letterSpacing: '-0.5px'
        }}>
          Trainx
        </h1>
        <p style={{
          fontSize: '15px',
          color: 'rgba(255,255,255,0.5)',
          margin: 0
        }}>
          Войдите в свой аккаунт
        </p>
      </div>

      {/* Login Form */}
      <form onSubmit={handleSubmit} style={{
        background: 'rgba(255,255,255,0.03)',
        backdropFilter: 'blur(20px)',
        borderRadius: '24px',
        padding: '32px',
        border: '1px solid rgba(255,255,255,0.08)'
      }}>
        {/* Error message */}
        {errorMessage && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '14px 16px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '12px',
            marginBottom: '24px',
            color: '#ef4444',
            fontSize: '14px'
          }}>
            <AlertCircle size={18} />
            {errorMessage}
          </div>
        )}

        {/* Email field */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{
            display: 'block',
            fontSize: '13px',
            fontWeight: 600,
            color: 'rgba(255,255,255,0.7)',
            marginBottom: '10px'
          }}>
            Email
          </label>
          <div style={{ position: 'relative' }}>
            <Mail size={18} style={{
              position: 'absolute',
              left: '16px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'rgba(255,255,255,0.4)'
            }} />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              style={{
                width: '100%',
                padding: '16px 16px 16px 48px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '15px',
                outline: 'none',
                transition: 'all 0.2s ease',
                boxSizing: 'border-box'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'rgba(255, 204, 0, 0.5)';
                e.target.style.boxShadow = '0 0 0 3px rgba(255, 204, 0, 0.1)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'rgba(255,255,255,0.1)';
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>
        </div>

        {/* Password field */}
        <div style={{ marginBottom: '28px' }}>
          <label style={{
            display: 'block',
            fontSize: '13px',
            fontWeight: 600,
            color: 'rgba(255,255,255,0.7)',
            marginBottom: '10px'
          }}>
            Пароль
          </label>
          <div style={{ position: 'relative' }}>
            <Lock size={18} style={{
              position: 'absolute',
              left: '16px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'rgba(255,255,255,0.4)'
            }} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: '100%',
                padding: '16px 48px 16px 48px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '15px',
                outline: 'none',
                transition: 'all 0.2s ease',
                boxSizing: 'border-box'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'rgba(255, 204, 0, 0.5)';
                e.target.style.boxShadow = '0 0 0 3px rgba(255, 204, 0, 0.1)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'rgba(255,255,255,0.1)';
                e.target.style.boxShadow = 'none';
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                right: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.4)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex'
              }}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Submit button */}
        <button
          type="submit"
          disabled={isLoading || !email || !password}
          style={{
            width: '100%',
            padding: '16px',
            background: isLoading || !email || !password
              ? 'rgba(255, 204, 0, 0.3)'
              : 'linear-gradient(135deg, #ffcc00 0%, #ffa500 100%)',
            border: 'none',
            borderRadius: '12px',
            color: '#000',
            fontSize: '16px',
            fontWeight: 700,
            cursor: isLoading || !email || !password ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            boxShadow: isLoading || !email || !password
              ? 'none'
              : '0 10px 40px rgba(255, 204, 0, 0.3)'
          }}
        >
          {isLoading ? (
            <>
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
              Вход...
            </>
          ) : (
            'Войти'
          )}
        </button>
      </form>

      {/* Footer */}
      <p style={{
        textAlign: 'center',
        marginTop: '32px',
        fontSize: '13px',
        color: 'rgba(255,255,255,0.4)'
      }}>
        Нет аккаунта? Обратитесь к вашему тренеру
      </p>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh'
    }}>
      <Loader2 size={40} color="#ffcc00" style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  );
}

export default function LoginPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0f0f1a 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Animated background elements */}
      <div style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none'
      }}>
        <div style={{
          position: 'absolute',
          top: '10%',
          left: '10%',
          width: '300px',
          height: '300px',
          background: 'radial-gradient(circle, rgba(255, 204, 0, 0.1) 0%, transparent 70%)',
          borderRadius: '50%',
          filter: 'blur(60px)',
          animation: 'pulse 4s ease-in-out infinite'
        }} />
        <div style={{
          position: 'absolute',
          bottom: '20%',
          right: '15%',
          width: '250px',
          height: '250px',
          background: 'radial-gradient(circle, rgba(255, 204, 0, 0.08) 0%, transparent 70%)',
          borderRadius: '50%',
          filter: 'blur(50px)',
          animation: 'pulse 5s ease-in-out infinite reverse'
        }} />
      </div>

      <Suspense fallback={<LoadingSpinner />}>
        <LoginForm />
      </Suspense>

      <style jsx global>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.1); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        input::placeholder {
          color: rgba(255,255,255,0.3);
        }
      `}</style>
    </div>
  );
}

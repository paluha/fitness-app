'use client';

import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2, ChevronRight } from 'lucide-react';

// Вход по макету редизайна (all-screens.html, кадр «Вход»).
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

  const disabled = isLoading || !email || !password;

  return (
    <>
      <div className="auth-copy">
        <span className="eyebrow">Рады тебя видеть</span>
        <h1>Возвращайся<br />к себе.</h1>
        <p>Тренировки, питание и прогресс —<br />в твоём ритме, в одном месте.</p>
      </div>

      <form className="login-form card" onSubmit={handleSubmit}>
        <h2>Вход в аккаунт</h2>

        {errorMessage && (
          <div className="auth-error" role="alert">
            <AlertCircle strokeWidth={1.65} aria-hidden="true" />
            {errorMessage}
          </div>
        )}

        <label>
          Email
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </label>
        <label>
          Пароль
          <div className="password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введи пароль"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
            >
              {showPassword ? 'Скрыть' : 'Показать'}
            </button>
          </div>
        </label>

        <button type="submit" className="wide primary" disabled={disabled}>
          {isLoading ? (
            <><Loader2 className="spin" strokeWidth={1.65} aria-hidden="true" /> Вход...</>
          ) : (
            <>Войти <ChevronRight strokeWidth={1.65} aria-hidden="true" /></>
          )}
        </button>
        <p className="muted center">Нет аккаунта? Обратись к своему тренеру</p>
      </form>

      <p className="center muted">Твой личный дневник тренировок и питания.</p>
    </>
  );
}

export default function LoginPage() {
  return (
    <div className="tx auth">
      <header className="auth-head">
        <div className="welcome-text">Welcome to <b className="wordmark">Train<span>X</span></b></div>
      </header>
      <Suspense fallback={<div className="center" style={{ padding: 40 }}><Loader2 className="spin" color="#ff5c35" aria-label="Загрузка" /></div>}>
        <LoginForm />
      </Suspense>
      <div className="auth-footer">Маленькие шаги. Заметный прогресс.</div>
    </div>
  );
}

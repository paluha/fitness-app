'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Paperclip, X, FileText, Image as ImageIcon, Dumbbell, Utensils, TrendingUp, Sparkles,
  ChevronRight, ChevronDown, Maximize2, Minimize2, ArrowUp,
} from 'lucide-react';
import { TxDialog } from './TxDialog';

type Msg = { id?: string; role: 'user' | 'assistant'; content: string; createdAt?: string };

/** Служебный хвост потока с готовой программой (см. /api/chat). */
const PROPOSAL_MARKER = '\u0000PROPOSAL\u0000';
/**
 * Подпись к индикатору работы, приходит посреди потока в парных
 * маркерах. Закрывающий обязателен: без него выражение «до конца
 * строки» съедало бы и весь текст, идущий после подписи.
 */
const STAGE_RE = /\u0000STAGE\u0000([\s\S]*?)\u0000\/STAGE\u0000/g;

/**
 * Служебная пометка, которую сервер кладёт в историю, чтобы модель
 * помнила о собранной программе. В чате её показывать не нужно.
 */
const SERVICE_NOTE_RE = /\[Собрал новую программу:[^\]]*\]/g;

export type ProposedExercise = {
  name: string;
  plannedSets: string;
  restTime: string;
  notes: string;
  supersetId?: string;
  toFailure?: boolean;
  dropSet?: boolean;
};
const fmtSize = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} МБ`
    : bytes >= 1024 ? `${Math.round(bytes / 1024)} КБ`
    : `${bytes} Б`;

/** «22 окт» или «22 окт 2025», если год не текущий. */
const fmtFileDate = (iso: string) => {
  try {
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }),
    }).replace(/\s*г\.$/, '').replace(/\.$/, '');
  } catch { return ''; }
};

/** Файл в хранилище чата (список приходит без содержимого). */
type SavedFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

/** Правка одной тренировки, предложенная ассистентом. */
export type WorkoutEdit = {
  workoutId: string;
  summary: string;
  exercises: ProposedExercise[];
};

export type ProgramProposal = {
  rationale: string;
  advanced: boolean;
  /** Срок программы в неделях — ИИ предлагает, человек может поменять при принятии. */
  weeks?: number;
  workouts: { focus: string; exercises: ProposedExercise[] }[];
};

type Eaten = { kcal: number; p: number; f: number; c: number };
type Snapshot = {
  today: string;
  macros: {
    goal: { kcal: number | null; p: number | null; f: number | null; c: number | null };
    eaten: Eaten; meals: number;
    byDate: Record<string, { eaten: Eaten; meals: number }>;
  };
  lastWorkout: { date: string; name: string; done: number; total: number } | null;
  recentWorkouts?: { date: string; name: string; done: number; total: number; exercises: string[] }[];
  labs: { date: string; panelName: string | null; abnormal: number; total: number } | null;
};

// Время сообщения для подписи под капсулой: сегодня — «14:32», раньше — «28 авг, 14:32».
function fmtWhen(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  // am/pm-формат: «2:32 pm»
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  if (d.toDateString() === now.toDateString()) return time;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '') + ', ' + time;
}

// AI-ассистент — вкладка «ИИ» по макету редизайна: готовые вопросы,
// контекст и панель диалога (свернуть / развернуть поверх экрана).
// Цепляет данные пользователя на сервере (/api/chat) и помнит историю.
// Подтянутые данные в ответах — оформленные карточки.
export function AssistantChat({ muscleGroups, onProgramReady, onWorkoutEdit, pendingProgram, initialInput, onInitialInputUsed }: {
  muscleGroups?: Record<string, string>;
  /**
   * Готовый вопрос из другого раздела (например, «Обсудить цель с ИИ»).
   * Подставляется в строку ввода, но не отправляется — человек сам
   * решает, отправить или поправить.
   */
  initialInput?: string;
  /** Вопрос подставлен — родитель сбрасывает его, чтобы не подставить повторно. */
  onInitialInputUsed?: () => void;
  /**
   * Программа готова — родитель открывает экран «Программа», где её
   * можно посмотреть целиком и принять или отклонить. Чат сам ничего не
   * меняет: подтверждение живёт на отдельном экране, а не в ленте.
   */
  onProgramReady?: (p: ProgramProposal) => void;
  /**
   * Правка одной тренировки готова — родитель показывает экран
   * подтверждения. Чат сам ничего не меняет.
   */
  onWorkoutEdit?: (e: WorkoutEdit) => void;
  /**
   * Программа ждёт решения. Показываем полоску с возвратом к экрану
   * подтверждения: после «Обсудить» иначе к ней не вернуться.
   */
  pendingProgram?: { days: number; open: () => void };
} = {}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState(initialInput ?? '');
  useEffect(() => {
    if (initialInput) onInitialInputUsed?.();
  }, [initialInput, onInitialInputUsed]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Прикреплённые файлы как data-URL вместе с именем. Их может быть
  // несколько: одним сообщением удобно прислать, например, этикетку и
  // состав продукта или PDF с анализами.
  const [images, setImages] = useState<{ name: string; data: string }[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  /**
   * Что ИИ делает прямо сейчас — подпись рядом с точками.
   *
   * Без неё долгие ответы выглядят зависанием: сборка программы идёт
   * секунд пятнадцать уже ПОСЛЕ того, как текст дописан, и экран всё
   * это время не подаёт признаков жизни.
   */
  const [stage, setStage] = useState<string | null>(null);
  /**
   * Файлы, присланные в чат. К анализу или фото еды часто нужно
   * вернуться позже, а в переписке остаётся только пометка «📎».
   * Список грузим по запросу: в нём могут быть сотни килобайт.
   */
  const [filesOpen, setFilesOpen] = useState(false);
  const [savedFiles, setSavedFiles] = useState<SavedFile[] | null>(null);
  const [openedFile, setOpenedFile] = useState<{ name: string; mimeType: string; data: string } | null>(null);

  const openFiles = useCallback(() => {
    setFilesOpen(true);
    setSavedFiles(null);
    fetch('/api/chat/files')
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((d) => setSavedFiles(d.files ?? []))
      .catch(() => setSavedFiles([]));
  }, []);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); // данные для карточек
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // история + снапшот данных для карточек подгружаются один раз при монтировании
  useEffect(() => {
    if (loaded) return;
    setLoaded(true);
    fetch('/api/chat')
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => {});
    fetch('/api/chat/snapshot')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSnapshot(d))
      .catch(() => {});
  }, [loaded]);

  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    });
  }, []);

  /**
   * Прокрутка вслед за ответом.
   *
   * Раньше на каждое изменение messages запускалась ПЛАВНАЯ прокрутка, а
   * при стриминге текст дописывается десятки раз в секунду — анимации
   * накладывались друг на друга, и экран трясло.
   *
   * Теперь: пока ответ идёт — короткие мгновенные подтягивания не чаще
   * чем раз в 150мс; когда дописал — одна плавная. И если пользователь
   * отмотал вверх читать, не тянем его обратно.
   */
  /**
   * Ровная подача текста.
   *
   * Куски из сети приходят неравномерно — то пусто, то абзац целиком, —
   * и текст появлялся рывками. targetRef хранит, сколько уже пришло, а
   * таймер догоняет это с постоянной скоростью: глазу спокойнее.
   *
   * null означает «поток кончился» — показываем остаток сразу.
   */
  const targetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => {
      const target = targetRef.current;
      if (target === null) return;
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (!last || last.role !== 'assistant') return m;
        if (last.content.length >= target.length) return m;
        // Шаг зависит от отставания: догоняем длинный хвост быстрее,
        // чем ползём по символу, но без скачков.
        const behind = target.length - last.content.length;
        const step = Math.max(2, Math.ceil(behind / 8));
        copy[copy.length - 1] = { ...last, content: target.slice(0, last.content.length + step) };
        return copy;
      });
    }, 40);
    return () => window.clearInterval(id);
  }, [busy]);

  // Поток закончился — показываем всё, что осталось недорисованным.
  useEffect(() => {
    if (busy || targetRef.current === null) return;
    const target = targetRef.current;
    targetRef.current = null;
    setMessages((m) => {
      const copy = [...m];
      const last = copy[copy.length - 1];
      if (last && last.role === 'assistant' && last.content !== target) {
        copy[copy.length - 1] = { ...last, content: target };
        return copy;
      }
      return m;
    });
  }, [busy]);

  const lastScrollRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Далеко отмотал — значит читает старое, не мешаем.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (!nearBottom) return;

    if (!busy) { scrollToBottom(true); return; }
    const now = Date.now();
    if (now - lastScrollRef.current < 150) return;
    lastScrollRef.current = now;
    el.scrollTop = el.scrollHeight;   // без анимации: нечего догонять
  }, [messages, busy, scrollToBottom]);

  /**
   * При открытии чата показываем конец переписки.
   *
   * Одной прокрутки после загрузки истории мало: высота в этот момент
   * ещё не окончательная — сообщения доверстываются, карточки данных
   * подставляются из снапшота, картинки подгружаются. Плавная анимация
   * при этом стартует к старой высоте и замирает в середине, поэтому
   * здесь прыгаем сразу (auto) и повторяем, пока высота не устоится.
   */
  useEffect(() => {
    if (messages.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;

    // Держим низ ~2.4 секунды после открытия: этого хватает, чтобы
    // вёрстка устоялась. Дольше нельзя — иначе рывком вернёт вниз, если
    // пользователь за это время сам отмотал переписку вверх.
    let lastHeight = -1;
    let tries = 0;
    let timer = 0;
    let stopped = false;

    // Тронул прокрутку сам — больше не вмешиваемся.
    const giveUp = () => { stopped = true; };
    el.addEventListener('touchstart', giveUp, { passive: true });
    el.addEventListener('wheel', giveUp, { passive: true });

    const pin = () => {
      if (stopped) return;
      const h = el.scrollHeight;
      if (h !== lastHeight) {
        lastHeight = h;
        el.scrollTop = h;            // без анимации: ничего не догоняем
      }
      if (++tries < 20) timer = window.setTimeout(pin, 120);
    };
    timer = window.setTimeout(pin, 0);

    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('touchstart', giveUp);
      el.removeEventListener('wheel', giveUp);
    };
    // Только на первую загрузку истории: дальше работает scrollToBottom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded && messages.length > 0]);

  // Не больше четырёх вложений за сообщение — столько же принимает сервер.
  const MAX_FILES = 4;
  /**
   * Предел на суммарный вес вложений — в символах data-URL, как они и
   * уедут в теле запроса.
   *
   * Vercel рубит запросы тяжелее 4.5 МБ HTML-ошибкой ещё до кода, а
   * base64 раздувает данные примерно на треть. 4 200 000 символов — это
   * около 3 МБ исходных файлов: запас к лимиту остаётся, но обычный PDF
   * с анализами проходит (раньше порог стоял на 2.3 МБ и отсекал их).
   */
  const MAX_TOTAL_BYTES = 4_200_000;

  /** Байты из длины data-URL — для понятного сообщения о размере. */
  const approxBytes = (dataUrl: string) => {
    const comma = dataUrl.indexOf(',');
    return Math.floor((dataUrl.length - comma - 1) * 0.75);
  };
  const fmtMb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} МБ`;

  /**
   * Что модель может прочитать. Остальное не отправляем вовсе.
   *
   * Браузер не всегда определяет тип: у части файлов (в том числе .zip
   * на некоторых системах) f.type приходит пустым, и проверки по нему
   * мало — тогда смотрим на расширение.
   */
  const READABLE_EXT = /\.(png|jpe?g|webp|gif|heic|heif|pdf|txt|md|csv|json|log)$/i;
  const isReadable = (f: File) => {
    if (f.type) {
      return f.type.startsWith('image/')
        || f.type === 'application/pdf'
        || f.type.startsWith('text/')
        || f.type === 'application/json';
    }
    return READABLE_EXT.test(f.name || '');
  };

  /**
   * Текст из PDF прямо в браузере.
   *
   * Тяжёлый PDF целиком отправить нельзя — Vercel рубит запросы больше
   * 4.5 МБ. Но читать нам нужно содержимое, а не файл: разбираем его на
   * телефоне и шлём несколько килобайт текста вместо мегабайтов. Тот же
   * приём уже работает в разборе анализов.
   *
   * Скан без текстового слоя так не прочитать — там только картинка,
   * нужен сам файл и зрение модели.
   */
  const pdfToText = async (file: File): Promise<string | null> => {
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const doc = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const { text } = await extractText(doc, { mergePages: true });
      const clean = String(text || '').replace(/\u0000/g, '').trim();
      return clean.length >= 200 ? clean.slice(0, 120_000) : null;
    } catch {
      return null;
    }
  };

  // Картинку сжимаем по ширине, остальное читаем как есть.
  const toDataUrl = (file: File) => new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const src = reader.result as string;
      if (!file.type.startsWith('image/')) { resolve(src); return; }
      const img = new Image();
      img.onload = () => {
        const maxW = 1024;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(src); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };
    reader.readAsDataURL(file);
  });

  // Выбор файлов: можно отметить сразу несколько, добавляются к уже выбранным.
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const all = Array.from(e.target.files ?? []);
    e.target.value = ''; // позволяем выбрать тот же файл повторно
    if (all.length === 0) return;
    setAttachError(null);

    // Формат, который модель не прочитает, лучше отсечь здесь и сказать
    // об этом, чем отправить и получить ошибку вместо ответа.
    const picked = all.filter(isReadable);
    const unreadable = all.filter((f) => !isReadable(f));

    const free = MAX_FILES - images.length;
    if (free <= 0) { setAttachError(`Можно прикрепить не больше ${MAX_FILES} файлов.`); return; }

    const take = picked.slice(0, free);
    const read = await Promise.all(take.map(async (f) => {
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
      // Тяжёлый PDF целиком не уедет — вытаскиваем из него текст на
      // телефоне. Для лёгкого шлём сам файл: модель прочитает и вёрстку,
      // и таблицы, а не только текстовый слой.
      if (isPdf && f.size > 1_500_000) {
        const text = await pdfToText(f);
        if (text) {
          // Через Blob, а не btoa(String.fromCharCode(...bytes)): на
          // сотне тысяч символов такой вызов переполняет стек.
          const data = await new Promise<string | null>((resolve) => {
            const r = new FileReader();
            r.onerror = () => resolve(null);
            r.onload = () => resolve(r.result as string);
            r.readAsDataURL(new Blob([text], { type: 'text/plain' }));
          });
          if (data) return { name: f.name, data };
        }
      }
      const data = await toDataUrl(f);
      return data ? { name: f.name, data } : null;
    }));

    setImages((prev) => {
      const next = [...prev];
      let total = next.reduce((a, x) => a + x.data.length, 0);
      const tooBig: { name: string; bytes: number }[] = [];
      const overLimit = picked.length - take.length;
      for (const item of read) {
        if (!item) continue;
        // Не превышаем общий вес: иначе запрос упрётся в лимит Vercel и
        // вернёт HTML-ошибку, которую чат показать не сможет.
        if (total + item.data.length > MAX_TOTAL_BYTES) {
          tooBig.push({ name: item.name, bytes: approxBytes(item.data) });
          continue;
        }
        next.push(item);
        total += item.data.length;
      }
      const problems: string[] = [];
      if (unreadable.length) {
        problems.push(`Не поддерживается: ${unreadable.map((f) => f.name).join(', ')}. Подойдут фото, PDF или текстовый файл.`);
      }
      if (overLimit > 0) problems.push(`Можно прикрепить не больше ${MAX_FILES} файлов.`);
      if (tooBig.length) {
        // Называем файл и его вес: иначе непонятно, что именно урезать.
        // Из текстового PDF текст уже вытащили бы выше, значит сюда
        // дошёл скан — из него читать нечего, поможет только размер.
        const limitMb = fmtMb(MAX_TOTAL_BYTES * 0.75);
        const names = tooBig.map((f) => `${f.name} — ${fmtMb(f.bytes)}`).join(', ');
        const scan = tooBig.some((f) => /\.pdf$/i.test(f.name));
        problems.push(
          `${names}. Это больше ${limitMb}.` +
          (scan ? ' Похоже на скан: текст из него не вытащить, пришли страницы по отдельности или фото лучшего качества.' : ' Пришли файл поменьше или по частям.')
        );
      }
      setAttachError(problems.length ? problems.join(' ') : null);
      return next;
    });
  };

  const removeImage = (i: number) => {
    setAttachError(null);
    setImages((prev) => prev.filter((_, j) => j !== i));
  };

  /**
   * Ответ, который сервер дописал без нас: связь оборвалась посреди
   * потока. Ждём, пока он появится в истории (до минуты — столько живёт
   * запрос на сервере), и показываем переписку оттуда. Задал новый
   * вопрос — ждать перестаём, чтобы не затереть его.
   */
  const sendSeq = useRef(0);
  const pullSavedAnswer = async (question: string, seq: number) => {
    const head = question.slice(0, 40);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      if (sendSeq.current !== seq) return;
      try {
        const r = await fetch('/api/chat');
        if (!r.ok) continue;
        const list: Msg[] = (await r.json()).messages ?? [];
        const last = list[list.length - 1];
        const asked = list[list.length - 2];
        if (last?.role === 'assistant' && asked?.role === 'user' && asked.content.startsWith(head)) {
          if (sendSeq.current === seq) setMessages(list);
          return;
        }
      } catch { /* сети всё ещё нет — пробуем дальше */ }
    }
    if (sendSeq.current !== seq) return;
    setMessages((m) => {
      const copy = [...m];
      copy[copy.length - 1] = { ...copy[copy.length - 1], content: 'Связь прервалась. Ответ появится в чате, когда откроешь его снова.' };
      return copy;
    });
  };

  /** Отправка: текст из поля ввода или готовый вопрос (кнопки-подсказки). */
  const send = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if ((!text && images.length === 0) || busy) return;
    const imgs = images;
    if (preset === undefined) setInput('');
    setImages([]);
    setAttachError(null);
    setBusy(true);
    setStage(imgs.length ? 'Читаю вложения' : 'Думаю');
    // Сбрасываем цель от прошлого ответа: иначе подача допишет его хвост
    // в новое, ещё пустое сообщение.
    targetRef.current = '';
    const note = imgs.length === 0 ? '' : imgs.length === 1 ? '\n📎 [вложение]' : `\n📎 [вложений: ${imgs.length}]`;
    setMessages((m) => [
      ...m,
      { role: 'user', content: (text || '') + note, createdAt: new Date().toISOString() },
      { role: 'assistant', content: '' },
    ]);
    // Сообщение об ошибке вместо ответа. Цель подачи обнуляем: иначе по
    // окончании (busy=false) эффект «дорисовать остаток» затирал текст
    // ошибки пустой строкой, и сбой пропадал из ленты молча.
    const fail = (content: string) => {
      targetRef.current = null;
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { ...copy[copy.length - 1], content };
        return copy;
      });
    };

    const post = () => fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, files: imgs }),
    });

    const seq = ++sendSeq.current;
    let streaming = false;
    let res: Response;
    try {
      res = await post();
    } catch {
      // iOS после возврата приложения из фона рвёт первое соединение.
      // GET система повторяет сама, а POST нет: вопрос не доходил до
      // сервера, и в чате стояло «Ошибка». Сервер его не получал —
      // повтор безопасен.
      try {
        await new Promise((r) => setTimeout(r, 800));
        res = await post();
      } catch {
        // Связи нет — возвращаем текст и файлы, чтобы не набирать заново.
        fail('Нет связи — вопрос не отправился. Вернул его в поле ввода, отправь ещё раз.');
        setInput((cur) => cur || text);
        setImages((cur) => (cur.length ? cur : imgs));
        setBusy(false);
        setStage(null);
        return;
      }
    }

    try {
      // Формат, который не прочитать, объясняем словами: «Ошибка,
      // попробуйте ещё раз» тут бесполезна — повтор не поможет.
      if (res.status === 415) {
        const info = await res.json().catch(() => null);
        const names = Array.isArray(info?.files) && info.files.length ? `: ${info.files.join(', ')}` : '';
        fail(`Такой формат файла я прочитать не могу${names}. Подойдут фото, PDF или текстовый файл.`);
        return;
      }
      // Запрос тяжелее лимита Vercel не доходит до кода и возвращает HTML.
      if (res.status === 413) {
        fail('Файлы слишком тяжёлые. Пришли их по одному или сделай фото меньше.');
        return;
      }
      if (!res.ok || !res.body) throw new Error('chat failed');
      streaming = true;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      // дописываем последнее (assistant) сообщение по мере стрима
      // eslint-disable-next-line no-constant-condition
      // Поток — это текст ответа, а в конце может прийти служебная часть
      // с готовой программой, отделённая маркером. Копим целиком и режем
      // по маркеру: он может разорваться между двумя кусками потока.
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });

        // Подпись к индикатору приходит посреди потока — вырезаем её из
        // видимого текста и показываем рядом с точками.
        const stages = [...acc.matchAll(STAGE_RE)];
        const stageText = stages.length ? stages[stages.length - 1][1] : null;
        const body = acc.replace(STAGE_RE, '');

        const cut = body.indexOf(PROPOSAL_MARKER);
        const visible = cut >= 0 ? body.slice(0, cut) : body;
        // Пока модель пишет — «Печатает»; как только пошла сборка
        // программы, серверная подпись перебивает её и остаётся.
        if (stageText) setStage(stageText);
        else if (visible) setStage('Печатает');
        // Не рисуем каждый кусок сразу: отдаём текст ровными порциями,
        // иначе он появляется рывками вслед за сетью.
        targetRef.current = visible;
      }
      // Цель не сбрасываем: эффект ниже дорисует остаток, когда busy
      // станет false. Обнулишь здесь — потеряется хвост ответа.
      // Служебные маркеры стадий в итоговом тексте не нужны.
      acc = acc.replace(STAGE_RE, '');

      // Программа готова — открываем экран «Программа», где её можно
      // целиком посмотреть и принять или отклонить. В ленте чата ей не
      // место: она длинная и теряется среди сообщений.
      const cut = acc.indexOf(PROPOSAL_MARKER);
      if (cut >= 0) {
        try {
          const parsed = JSON.parse(acc.slice(cut + PROPOSAL_MARKER.length));
          if (parsed?.type === 'program_proposal' && Array.isArray(parsed.data?.workouts)) {
            onProgramReady?.(parsed.data);
          }
          // Правка одной тренировки — отдельный экран подтверждения.
          if (parsed?.type === 'workout_edit' && Array.isArray(parsed.data?.exercises)) {
            onWorkoutEdit?.(parsed.data);
          }
        } catch { /* битый хвост — экран не открываем */ }
      }
    } catch {
      if (streaming) {
        // Связь оборвалась посреди ответа — обычно приложение свернули.
        // Сервер дописывает и сохраняет ответ сам: подтягиваем его из
        // истории, а не пишем «Ошибка».
        fail('Связь прервалась — дописываю ответ…');
        void pullSavedAnswer(text, seq);
      } else {
        fail('Ошибка. Попробуйте ещё раз.');
      }
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // Панель диалога по макету: свёрнута — видны подсказки, развёрнута —
  // поверх экрана для длинной переписки. Пришли с готовым вопросом
  // (например, «Обсудить цель») — сразу разворачиваем.
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(Boolean(initialInput));
  const panelRef = useRef<HTMLElement>(null);
  const showPanel = () => {
    setCollapsed(false);
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };
  const ask = (text: string) => { showPanel(); void send(text); };

  const canSend = !busy && (!!input.trim() || images.length > 0);

  // Что ИИ видит — одной строкой из снапшота данных
  const contextLine = (() => {
    if (!snapshot) return 'ИИ видит программу, дневник питания, замеры и анализы.';
    const parts: string[] = [];
    // День «YYYY-MM-DD» — как есть; ISO-момент (дата сдачи анализа) — по местному времени
    const d = (s: string) => new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
    if (snapshot.lastWorkout) parts.push(`последняя тренировка — ${d(snapshot.lastWorkout.date)}, ${snapshot.lastWorkout.done} из ${snapshot.lastWorkout.total}`);
    const days = Object.entries(snapshot.macros.byDate ?? {})
      .filter(([date, v]) => v.meals > 0 && date <= snapshot.today && date > new Date(new Date(snapshot.today + 'T12:00:00').getTime() - 7 * 86400000).toISOString().slice(0, 10)).length;
    parts.push(`питание за ${days} из 7 дней`);
    if (snapshot.labs) parts.push(`анализы от ${d(snapshot.labs.date)}`);
    return parts.join(' · ');
  })();

  const PROMPTS: { icon: React.ReactNode; title: string; hint: string; text: string }[] = [
    { icon: <Dumbbell />, title: 'Разобрать тренировку', hint: 'Нагрузка, подходы и прогресс', text: 'Разбери мою последнюю тренировку: нагрузка, подходы и прогресс по сравнению с прошлым разом.' },
    { icon: <Utensils />, title: 'Посмотреть питание', hint: 'Калории и баланс БЖУ', text: 'Посмотри моё питание за последние дни: калории и баланс БЖУ относительно цели.' },
    { icon: <TrendingUp />, title: 'Подвести итоги', hint: 'Что изменилось за последнее время', text: 'Подведи итоги: что изменилось за последние две недели в тренировках, питании и весе?' },
  ];

  return (
    <div className="tx ai-view">
      <div className="page-title">
        <div>
          <h1>Твой ИИ-ассистент</h1>
          <p>Тренировки, питание и личный прогресс</p>
        </div>
        {/* Все присланные файлы: к анализу или фото еды часто нужно
            вернуться позже, а в переписке остаётся только пометка. */}
        <button type="button" className="round big" onClick={openFiles} aria-label="Файлы из чата" title="Файлы, присланные в чат">
          <FileText />
        </button>
      </div>

      <div className="assistant-hero">
        <span className="spark-mark"><Sparkles /></span>
        <h2>Твой прогресс — в&nbsp;диалоге.</h2>
        <p>Выбери вопрос или напиши свой.</p>
      </div>

      <div className="prompt-list">
        {PROMPTS.map(p => (
          <button key={p.title} type="button" className="prompt" disabled={busy} onClick={() => ask(p.text)}>
            {p.icon}
            <span><strong>{p.title}</strong><small>{p.hint}</small></span>
            <ChevronRight />
          </button>
        ))}
      </div>

      <section className="card">
        <div className="section-title"><h2>Контекст диалога</h2></div>
        <div className="context-tags"><span>Тренировки</span><span>Питание</span><span>Здоровье</span><span>Анализы</span></div>
        <p className="muted">{contextLine}</p>
      </section>

      {/* Программа ждёт решения: напоминаем и даём путь обратно. Без
          этого после «Обсудить» вернуться к ней было бы нечем. */}
      {pendingProgram && (
        <button type="button" className="ai-pending" onClick={pendingProgram.open}>
          <Dumbbell />
          <span>Программа на {pendingProgram.days} трен. ждёт решения <em>— открыть и подтвердить</em></span>
        </button>
      )}

      <section ref={panelRef} className={'ux-chat-panel' + (collapsed ? ' is-collapsed' : '') + (expanded ? ' is-expanded' : '')}>
        <header className="ux-chat-head">
          <button type="button" aria-expanded={!collapsed} onClick={() => { setCollapsed(c => !c); setExpanded(false); }}>
            <span className="ux-ai-spark">✦</span>
            <span>
              <b>Диалог с ИИ</b>
              <small>{busy ? (stage || 'Думаю') : 'Видит твои данные · отвечает по ним'}</small>
            </span>
            <ChevronDown className="chev" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => { setCollapsed(false); setExpanded(e => !e); }}
            aria-label={expanded ? 'Уменьшить чат' : 'Развернуть чат'}>
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </button>
        </header>

        {collapsed ? (
          <button type="button" className="ux-chat-resume" onClick={showPanel}>Продолжить диалог ↑</button>
        ) : (
          <div className="ux-chat-content">
            {/* сообщения */}
            <div ref={scrollRef} className="chat-messages" aria-live="polite">
              {messages.length === 0 && (
                <div className="chat-empty">Спроси про тренировки, питание или прогресс.<br />Я вижу твои данные.</div>
              )}
              {messages.map((m, i) => {
                // Сообщение, от которого после вычистки служебной пометки
                // ничего не осталось, пропускаем целиком: иначе в ленте
                // повисает пустой блок с отступами.
                if (m.role === 'assistant'
                    && !m.content.replace(SERVICE_NOTE_RE, '').trim()
                    && !(busy && i === messages.length - 1)) {
                  return null;
                }
                if (m.role === 'user') {
                  const when = fmtWhen(m.createdAt);
                  return (
                    <div key={m.id ?? i} className="msg-user">
                      <div className="user-bubble">{m.content}</div>
                      {when && <span className="msg-time">{when}</span>}
                    </div>
                  );
                }
                return (
                  <div key={m.id ?? i} className="msg-ai">
                    {(() => {
                      // Пометка о собранной программе нужна модели, чтобы в
                      // следующем сообщении помнить про неё, но пользователю
                      // показывать её незачем — он видел саму карточку.
                      const shown = m.content.replace(SERVICE_NOTE_RE, '').trim();
                      return shown ? renderWithCards(shown, snapshot, muscleGroups) : null;
                    })()}
                    {/* Индикатор держим, пока идёт ответ, а не только пока
                        сообщение пустое: ИИ может ещё собирать программу. */}
                    {busy && i === messages.length - 1 && (
                      <span className="chat-typing" role="status" aria-label={stage || 'ИИ печатает'}
                        style={m.content ? { marginTop: 4 } : undefined}>
                        <span className="chat-dot" /><span className="chat-dot" /><span className="chat-dot" />
                        {stage && <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--text-muted)' }}>{stage}</span>}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="ux-chat-chips">
              {PROMPTS.map(p => (
                <button key={p.title} type="button" disabled={busy} onClick={() => ask(p.text)}>{p.title}</button>
              ))}
            </div>

            {/* Превью вложений: крестик висит над углом, поэтому между
                превью зазор шире него, иначе крестик соседа перекрывает. */}
            {images.length > 0 && (
              <div className="chat-attachments">
                {images.map((f, i) => (
                  <div key={i} className="chat-attachment">
                    {f.data.startsWith('data:image/') ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={f.data} alt={`вложение ${i + 1}`} />
                    ) : (
                      // У PDF и текста превью нет — плашка с именем файла
                      <div className="chat-attachment-file"><FileText /><span>{f.name}</span></div>
                    )}
                    <button type="button" onClick={() => removeImage(i)} aria-label={`убрать вложение ${i + 1}`}><X /></button>
                  </div>
                ))}
              </div>
            )}
            {attachError && <div className="chat-attach-error">{attachError}</div>}

            <div className="chat-form">
              <input ref={fileRef} type="file" multiple onChange={onPickFile} style={{ display: 'none' }} />
              <button type="button" className="round" onClick={() => fileRef.current?.click()} disabled={busy}
                aria-label="прикрепить файл" style={images.length ? { color: 'var(--accent)' } : undefined}>
                <Paperclip />
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                onFocus={() => setCollapsed(false)}
                placeholder="Спроси о своём прогрессе…"
                rows={1}
                autoFocus={Boolean(initialInput)}
              />
              <button type="button" className="round primary" onClick={() => send()} disabled={!canSend} aria-label="отправить">
                <ArrowUp />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Хранилище файлов чата: всё, что присылали, с возможностью
          открыть заново. */}
      {filesOpen && (
        <TxDialog title="Файлы из чата" onClose={() => { setFilesOpen(false); setOpenedFile(null); }}>
          {openedFile ? (
            <div className="chat-file-open">
              <button type="button" className="chat-file-back" onClick={() => setOpenedFile(null)}>← К списку</button>
              <p>{openedFile.name}</p>
              {openedFile.mimeType.startsWith('image/') ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={openedFile.data} alt={openedFile.name} />
              ) : (
                // PDF и текст открываем в новой вкладке: встроенный
                // просмотр на телефоне работает плохо.
                <a href={openedFile.data} target="_blank" rel="noreferrer" download={openedFile.name} className="primary chat-file-link">Открыть файл</a>
              )}
            </div>
          ) : savedFiles === null ? (
            <p>Загружаю…</p>
          ) : savedFiles.length === 0 ? (
            <p>Пока ничего не присылали. Файлы из чата — фото, PDF, документы — будут собираться здесь.</p>
          ) : (
            <div className="chat-file-list">
              {savedFiles.map((f) => (
                <div key={f.id} className="chat-file-row">
                  {f.mimeType.startsWith('image/') ? <ImageIcon /> : <FileText />}
                  <button type="button" onClick={async () => {
                    const r = await fetch(`/api/chat/files?id=${encodeURIComponent(f.id)}`);
                    if (r.ok) setOpenedFile(await r.json());
                  }}>
                    <b>{f.name}</b>
                    <small>{fmtSize(f.size)} · {fmtFileDate(f.createdAt)}</small>
                  </button>
                  <button type="button" className="chat-file-del" aria-label={`удалить ${f.name}`} onClick={async () => {
                    await fetch(`/api/chat/files?id=${encodeURIComponent(f.id)}`, { method: 'DELETE' });
                    setSavedFiles((prev) => (prev ?? []).filter((x) => x.id !== f.id));
                  }}><X /></button>
                </div>
              ))}
            </div>
          )}
        </TxDialog>
      )}
    </div>
  );
}

// **текст** из ответа модели рендерим жирным — лёгкая inline-разметка
// без markdown-библиотек, чтобы звёздочки не торчали в чате.
function renderBold(text: string, keyBase: string | number): React.ReactNode {
  const segs = text.split(/\*\*([^*]+)\*\*/g);
  if (segs.length === 1) return text;
  return segs.map((seg, j) => (j % 2 === 1 ? <strong key={`${keyBase}-${j}`}>{seg}</strong> : seg));
}

// Разбиваем текст ответа на части по плейсхолдерам [[card:xxx]] или
// [[card:macros:ГГГГ-ММ-ДД]] и рендерим карточками, подставляя данные из snapshot.
function renderWithCards(text: string, snap: Snapshot | null, mg?: Record<string, string>): React.ReactNode {
  const parts = text.split(/(\[\[card:[a-zA-Z]+(?::\d{4}-\d{2}-\d{2})?\]\])/g);
  return parts.map((part, idx) => {
    const m = /^\[\[card:([a-zA-Z]+)(?::(\d{4}-\d{2}-\d{2}))?\]\]$/.exec(part);
    if (m) {
      const card = renderCard(m[1], m[2], snap, mg);
      // если данных нет — не показываем пустой плейсхолдер
      return card ? <div key={idx}>{card}</div> : null;
    }
    if (!part) return null;
    return <span key={idx} style={{ whiteSpace: 'pre-wrap' }}>{renderBold(part, idx)}</span>;
  });
}

// Цветной пилюль-бейдж в правом углу карточки
function Pill({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span style={{ padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, color, background: bg, whiteSpace: 'nowrap', flexShrink: 0 }}>
      {text}
    </span>
  );
}

function renderCard(kind: string, date: string | undefined, snap: Snapshot | null, mg?: Record<string, string>): React.ReactNode {
  if (!snap) return null;
  if (kind === 'macros') {
    const { goal } = snap.macros;
    // дата из плейсхолдера, иначе сегодня
    const d = date || snap.today;
    const dayData = snap.macros.byDate[d] ?? (d === snap.today ? { eaten: snap.macros.eaten, meals: snap.macros.meals } : null);
    const isToday = d === snap.today;
    // Разбираем дату по частям, а не через new Date('2026-09-22'): такую
    // строку браузер читает как UTC-полночь, и при западном смещении
    // подпись съезжала на день назад («22 сентября» → «21 сент»).
    const fmtDay = (ds: string, opts: Intl.DateTimeFormatOptions) => {
      try {
        const [y, mo, dd] = ds.split('-').map(Number);
        return new Date(y, mo - 1, dd).toLocaleDateString('ru-RU', opts).replace(/\.$/, '');
      } catch { return ds; }
    };
    const dateLabel = isToday ? 'сегодня' : fmtDay(d, { day: 'numeric', month: 'short' });
    // За этот день еды нет. Раньше карточка просто исчезала, и под текстом
    // «Вот данные за вчера:» оставалась пустота — выглядело как поломка.
    // Честнее сказать прямо, что записи нет.
    if (!dayData || dayData.meals === 0) {
      const known = Object.keys(snap.macros.byDate).sort().reverse();
      const hint = known.length
        ? `Последняя запись — ${fmtDay(known[0], { day: 'numeric', month: 'long' })}.`
        : 'Еда пока не записывалась.';
      return (
        <CardShell title={`Питание · ${dateLabel}`}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            За этот день еда не записана. {hint}
          </div>
        </CardShell>
      );
    }
    const { eaten, meals } = dayData;
    const mealsWord = meals === 1 ? 'приём' : meals >= 2 && meals <= 4 ? 'приёма' : 'приёмов';
    const row = (label: string, val: number, g: number | null, color: string) => {
      const pct = g ? Math.min(100, Math.round((val / g) * 100)) : 0;
      return (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {val}{g ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> / {g}</span> : ''}
            </span>
          </div>
          {g ? (
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(26, 23, 18, 0.07)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color, transition: 'width 0.4s ease' }} />
            </div>
          ) : null}
        </div>
      );
    };
    return (
      <CardShell title={`Питание · ${dateLabel}`}
        right={<span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{meals} {mealsWord}</span>}>
        {row('Калории', eaten.kcal, goal.kcal, '#f59e0b')}
        {row('Белок', eaten.p, goal.p, '#22c55e')}
        {row('Жиры', eaten.f, goal.f, '#f97316')}
        {row('Углеводы', eaten.c, goal.c, '#3b82f6')}
      </CardShell>
    );
  }
  if (kind === 'lastWorkout') {
    // Список последних тренировок: дата, короткое имя (Т1–Т7), на что была
    // (группы мышц выполненных упражнений), сколько упражнений сделано.
    const list = snap.recentWorkouts && snap.recentWorkouts.length
      ? snap.recentWorkouts
      : snap.lastWorkout ? [{ ...snap.lastWorkout, exercises: [] as string[] }] : [];
    if (!list.length) return null;
    const shortName = (n: string) => n.replace('Тренировка ', 'Т');
    const fmtD = (ds: string) => {
      try {
        const [y, mo, dd] = ds.split('-').map(Number);
        return new Date(y, mo - 1, dd).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
      } catch { return ds; }
    };
    const focus = (exs: string[]) => {
      if (!mg || !exs.length) return '';
      const groups: string[] = [];
      for (const n of exs) {
        const g = mg[n.trim().toLowerCase()];
        if (g && !groups.includes(g)) groups.push(g);
      }
      return groups.slice(0, 3).join(', ');
    };
    return (
      <CardShell title="Тренировки"
        right={<span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>последние {list.length}</span>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((w) => (
            <div key={w.date} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 52, flexShrink: 0 }}>{fmtD(w.date)}</span>
              <span style={{ fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{shortName(w.name)}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {focus(w.exercises)}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: w.done === w.total ? 'var(--green)' : '#b45309', flexShrink: 0 }}>
                {w.done}/{w.total}
              </span>
            </div>
          ))}
        </div>
      </CardShell>
    );
  }
  if (kind === 'labs') {
    const l = snap.labs;
    if (!l) return null;
    return (
      <CardShell title="Последний анализ"
        right={<Pill text={l.abnormal > 0 ? `${l.abnormal} вне нормы` : 'всё в норме'}
          color={l.abnormal > 0 ? 'var(--red)' : 'var(--green)'}
          bg={l.abnormal > 0 ? 'var(--red-dim)' : 'var(--green-dim)'} />}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{l.panelName || 'Анализ'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{l.date} · {l.total} показателей</div>
      </CardShell>
    );
  }
  return null;
}

// Карточка «подтянутых данных»: мягкий тёплый фон, заголовок и бейдж справа.
// Без иконок и эмодзи — только чистота и полезность.
function CardShell({ title, right, children }: {
  title: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={{
      margin: '10px 0', background: 'var(--bg-elevated)',
      borderRadius: 16, padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

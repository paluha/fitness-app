/**
 * Данные раздела «Здоровье»: замеры тела, показатели, самонаблюдение,
 * препараты. Общие для главной страницы и экрана HealthView.
 */

export interface BodyMeasurement {
  id: string;
  date: string;
  weight?: number;
  waist?: number;
  chest?: number;
  biceps?: number;        // legacy - kept for backwards compatibility
  bicepsLeft?: number;
  bicepsRight?: number;
  thighs?: number;
  hips?: number;
  notes?: string;
}

/**
 * Поле самонаблюдения, которое пользователь заводит сам.
 *
 * Готового списка нет намеренно: что отслеживать — решает он (отёчность,
 * настроение, акне, сон, что угодно). Здесь только описание поля, сами
 * значения по дням лежат в CheckinEntry.
 */
export interface CheckinField {
  id: string;
  name: string;
  /** Как записывать: шкала 0-3, число с единицей или «было/не было». */
  kind: 'scale' | 'number' | 'yesno';
  /** Единица для kind:'number' («кг», «часов», «мг»). */
  unit?: string;
  /** Подписи делений для шкалы; пусто — «нет / слегка / заметно / сильно». */
  labels?: string[];
  /** Поле больше не заполняется, но прошлые записи остаются. */
  archived?: boolean;
}

/** Значения полей за один день. Ключ в values — id поля. */
export interface CheckinEntry {
  id: string;
  /** YYYY-MM-DD: привязка к дню календаря, а не к моменту. */
  date: string;
  values: Record<string, number | string>;
  note?: string;
}

/**
 * Курс: что колю и что принимаю.
 *
 * Отдельно от приёмов: препарат заводится один раз, а отметок у него
 * десятки. Доза и график хранятся текстом — «250 мг», «пн и чт»: это
 * справка для себя и для ИИ, считать по ней ничего не нужно.
 */
export interface MedCourse {
  id: string;
  name: string;
  dose?: string;
  /** Как принимается: укол, таблетка, капли… — свободный текст. */
  form?: string;
  /** Когда: «пн и чт», «каждый день», «через день». */
  schedule?: string;
  /** Дни недели для напоминаний: 1 — пн … 7 — вс. Пусто — каждый день. */
  days?: number[];
  /** Во сколько напоминать, «HH:MM». Пусто — без напоминаний. */
  remindAt?: string;
  startedAt?: string; // YYYY-MM-DD
  endedAt?: string;   // YYYY-MM-DD, курс завершён
  note?: string;
}

/** Факт приёма: одна отметка по курсу. */
export interface MedLog {
  id: string;
  courseId: string;
  /** ISO-момент: для укола важно и время, не только день. */
  at: string;
  dose?: string;
  note?: string;
}

/** Показатель здоровья: давление, пульсоксиметр, состав тела, симптом, свой. */
export interface VitalEntry {
  id: string;
  at: string; // ISO
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  spo2?: number;
  fatPct?: number;      // % жира (анализатор состава тела)
  symptom?: string;     // симптом (головная боль, жидкий стул…) — фиксируется тапом, время автоматом
  customName?: string;  // произвольный показатель/процедура
  customValue?: number;
  customUnit?: string;
  tags: string[];
  note?: string;
}

export const SCALE_LABELS = ['нет', 'слегка', 'заметно', 'сильно'];

export const SYMPTOM_PRESETS = ['Головная боль', 'Жидкий стул', 'Запор', 'Тошнота', 'Изжога', 'Боль в животе', 'Головокружение', 'Слабость', 'Плохой сон', 'Судороги'];

/**
 * Идентификатор для новой записи.
 *
 * randomUUID, а не Date.now(): две записи в одну миллисекунду получали
 * бы одинаковый id. Плюс линтер справедливо ругается на Date.now() в
 * теле компонента — он не отличает обработчик от рендера.
 */
export function newId(prefix: string): string {
  const rnd = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}${rnd}`;
}

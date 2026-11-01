'use client';

import { useState, type FormEvent } from 'react';
import { Activity, Bike, Flower2, Footprints, Trash2, Waves } from 'lucide-react';
import { TxDialog } from './TxDialog';
import {
  ACTIVITY_TYPES, activityLabel, activityMeta, estimateActivityKcal,
  type ActivityType, type DayActivity,
} from '@/lib/day-activities';

const ICONS: Partial<Record<ActivityType, typeof Bike>> = {
  bike: Bike, swim: Waves, run: Footprints, walk: Footprints, yoga: Flower2,
};

/** writing — выбрано «Своё…»: поле названия открыто (у сохранённых своих кнопок его нет). */
type Draft = { id: string | null; type: ActivityType; name: string; writing: boolean; minutes: string; km: string; kcal: string };

/**
 * Карточка «Активность» на экране тренировки: велосипед, плавание, бег —
 * всё, что сделано сверх зала. Записи живут в дне (dayLog.activities),
 * как шаги; калории, если не вписаны с часов, считаются по весу.
 */
export function DayActivities({ activities, onChange, weightKg, customNames }: {
  activities: DayActivity[];
  onChange: (next: DayActivity[]) => void;
  weightKg: number | null;
  /** Что человек уже вписывал сам — отдельными кнопками рядом с готовыми. */
  customNames: string[];
}) {
  const [draft, setDraft] = useState<Draft | null>(null);

  const meta = draft ? activityMeta(draft.type) : null;
  const minutes = Number(draft?.minutes);
  const estimate = draft ? estimateActivityKcal(draft.type, minutes, weightKg) : null;

  const open = (a?: DayActivity) => setDraft(a
    ? {
      id: a.id, type: a.type, name: a.name ?? '',
      writing: a.type === 'other' && !customNames.some(n => n.toLowerCase() === a.name?.trim().toLowerCase()),
      minutes: String(a.minutes), km: a.km ? String(a.km) : '', kcal: a.kcal && !a.kcalEstimated ? String(a.kcal) : '',
    }
    : { id: null, type: 'bike', name: '', writing: false, minutes: '', km: '', kcal: '' });

  const canSave = minutes > 0 && (draft?.type !== 'other' || !!draft.name.trim());

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !canSave) return;
    const typed = Number(draft.kcal.replace(',', '.'));
    const km = Number(draft.km.replace(',', '.'));
    const item: DayActivity = {
      id: draft.id ?? `act-${Date.now()}`,
      type: draft.type,
      ...(draft.type === 'other' && draft.name.trim() ? { name: draft.name.trim() } : {}),
      minutes: Math.round(minutes),
      km: meta?.distance && km > 0 ? Math.round(km * 10) / 10 : null,
      kcal: typed > 0 ? Math.round(typed) : estimate,
      ...(typed > 0 || estimate == null ? {} : { kcalEstimated: true }),
    };
    onChange(draft.id ? activities.map(a => (a.id === draft.id ? item : a)) : [...activities, item]);
    setDraft(null);
  };

  return (
    <section className="tx-card tx-acts">
      <div className="tx-card-head">
        <div>
          <span className="tx-eyebrow">Кроме зала</span>
          <h4>Активность</h4>
        </div>
        <button type="button" className="tx-badge tx-badge-btn" onClick={() => open()}>+ Добавить</button>
      </div>
      {activities.length ? (
        <ul>
          {activities.map(a => {
            const Icon = ICONS[a.type] ?? Activity;
            const facts = [`${a.minutes} мин`, a.km ? `${String(a.km).replace('.', ',')} км` : '', a.kcal ? `${a.kcalEstimated ? '≈' : ''}${a.kcal} ккал` : '']
              .filter(Boolean).join(' · ');
            return (
              <li key={a.id}>
                <button type="button" onClick={() => open(a)} aria-label={`Изменить: ${activityLabel(a)}`}>
                  <Icon size={17} aria-hidden="true" />
                  <b>{activityLabel(a)}</b>
                  <span>{facts}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="tx-acts-empty">Велосипед, плавание, бег — всё, что делал в этот день сверх тренировки.</p>
      )}

      {draft && meta && (
        <TxDialog title={draft.id ? 'Активность' : 'Добавить активность'} onClose={() => setDraft(null)}>
          <form className="planner-form" onSubmit={save}>
            <span className="field-label">Что делал</span>
            <div className="chips">
              {ACTIVITY_TYPES.filter(t => t.type !== 'other').map(t => (
                <button key={t.type} type="button" className={t.type === draft.type ? 'is-on' : undefined}
                  onClick={() => setDraft({ ...draft, type: t.type, writing: false })}>{t.label}</button>
              ))}
              {customNames.map(n => (
                <button key={'own-' + n} type="button"
                  className={draft.type === 'other' && !draft.writing && draft.name.trim().toLowerCase() === n.toLowerCase() ? 'is-on' : undefined}
                  onClick={() => setDraft({ ...draft, type: 'other', name: n, writing: false })}>{n}</button>
              ))}
              <button type="button" className={draft.writing ? 'is-on' : undefined}
                onClick={() => setDraft({ ...draft, type: 'other', name: '', writing: true })}>Своё…</button>
            </div>
            {draft.writing && (
              <label>Название
                <input type="text" maxLength={60} required autoFocus placeholder="Например, футбол, бокс, гребля"
                  value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
              </label>
            )}
            <div className="pair">
              <label>Минут
                <input type="number" inputMode="numeric" min={1} max={1440} required value={draft.minutes}
                  onChange={e => setDraft({ ...draft, minutes: e.target.value })} />
              </label>
              {meta.distance ? (
                <label>Км <small>если знаешь</small>
                  <input type="text" inputMode="decimal" placeholder="—" value={draft.km}
                    onChange={e => setDraft({ ...draft, km: e.target.value })} />
                </label>
              ) : <span />}
            </div>
            <label>Ккал
              <input type="text" inputMode="numeric" placeholder={estimate ? `≈ ${estimate}` : '—'} value={draft.kcal}
                onChange={e => setDraft({ ...draft, kcal: e.target.value })} />
            </label>
            <p>
              {weightKg
                ? 'Если пусто — калории посчитаются примерно, по времени и твоему весу. Есть цифра с часов — впиши её.'
                : 'Впиши цифру с часов. Или запиши вес в «Здоровье» — тогда калории посчитаются примерно сами.'}
            </p>
            <div className="form-actions">
              {draft.id && (
                <button type="button" className="delete" aria-label="Удалить активность"
                  onClick={() => { onChange(activities.filter(a => a.id !== draft.id)); setDraft(null); }}>
                  <Trash2 size={18} />
                </button>
              )}
              <button type="submit" className="primary" disabled={!canSave}>Сохранить</button>
            </div>
          </form>
        </TxDialog>
      )}
    </section>
  );
}

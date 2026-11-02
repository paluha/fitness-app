import Anthropic from '@anthropic-ai/sdk';

/**
 * Закончились кредиты на аккаунте ИИ.
 *
 * Это не сбой приложения: повтор ничего не даст, пока баланс не
 * пополнят. Отличать важно, иначе экран говорит «ошибка, попробуйте
 * ещё раз», и человек жмёт снова и снова.
 */
export function isBillingError(error: unknown): boolean {
  return error instanceof Anthropic.APIError
    && /credit balance is too low|insufficient.*(credit|quota)|billing/i.test(String(error.message || ''));
}

export const AI_BILLING_TEXT =
  'ИИ сейчас недоступен: закончился баланс сервиса ИИ. Повторять не нужно — всё заработает, как только баланс пополнят.';

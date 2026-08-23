import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';

// Импорт рецепта с фото: пользователь фотографирует страницу купленного
// рецепта (книга/PDF/скрин) — ИИ вытаскивает название, ингредиенты, шаги
// и считает КБЖУ на порцию. Результат сохраняется в раздел «Рецепты».

export const maxDuration = 60;

const RECIPE_SCHEMA = {
  type: 'object' as const,
  properties: {
    name: { type: 'string' as const, description: 'Название блюда по-русски' },
    servings: { type: 'number' as const, description: 'На сколько порций рецепт (1 если не указано)' },
    ingredients: {
      type: 'array' as const,
      items: { type: 'string' as const, description: 'Ингредиент с количеством, например «Куриная грудка — 400 г»' },
    },
    steps: {
      type: 'array' as const,
      items: { type: 'string' as const, description: 'Шаг приготовления, кратко' },
    },
    perServing: {
      type: 'object' as const,
      description: 'КБЖУ на ОДНУ порцию: с этикетки/текста если указано, иначе посчитай по ингредиентам',
      properties: {
        calories: { type: 'number' as const },
        protein: { type: 'number' as const },
        fat: { type: 'number' as const },
        carbs: { type: 'number' as const },
        sugar: { type: 'number' as const, description: 'Общий сахар, г' },
      },
      required: ['calories', 'protein', 'fat', 'carbs', 'sugar'],
      additionalProperties: false,
    },
  },
  required: ['name', 'servings', 'ingredients', 'steps', 'perServing'],
  additionalProperties: false,
};

type AllowedMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

function detectMime(image: string): { mime: AllowedMime; data: string } | null {
  const m = image.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/);
  if (m) return { mime: m[1] as AllowedMime, data: m[2] };
  if (/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 100))) return { mime: 'image/jpeg', data: image };
  return null;
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const img = typeof body.image === 'string' ? detectMime(body.image) : null;
    if (!img) {
      return NextResponse.json({ error: 'bad image' }, { status: 400 });
    }

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      output_config: {
        format: { type: 'json_schema', schema: RECIPE_SCHEMA },
      },
      system:
        'Ты извлекаешь рецепт с фотографии (страница книги, скрин, распечатка). ' +
        'Верни название, число порций, ингредиенты С КОЛИЧЕСТВАМИ, шаги приготовления кратко своими словами, ' +
        'и КБЖУ на одну порцию: если КБЖУ напечатано — возьми как есть; если нет — посчитай по ингредиентам ' +
        '(табличные значения на 100 г × количество ÷ порции), числа согласованы: ккал ≈ Б*4 + Ж*9 + У*4. ' +
        'Всё по-русски. Если на фото не рецепт — верни name="" и пустые списки.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } },
            { type: 'text', text: 'Извлеки рецепт с фото.' },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      return NextResponse.json({ error: 'model failed' }, { status: 502 });
    }
    const textBlock = response.content.find(b => b.type === 'text');
    interface ParsedRecipe {
      name: string; servings: number; ingredients: string[]; steps: string[];
      perServing: { calories: number; protein: number; fat: number; carbs: number; sugar: number };
    }
    let parsed: ParsedRecipe | null = null;
    try { parsed = textBlock ? JSON.parse(textBlock.text) as ParsedRecipe : null; } catch { parsed = null; }
    if (!parsed || !parsed.name || !Array.isArray(parsed.ingredients) || parsed.ingredients.length === 0) {
      return NextResponse.json({ error: 'not a recipe' }, { status: 422 });
    }

    const n = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
    return NextResponse.json({
      success: true,
      recipe: {
        name: parsed.name.slice(0, 120),
        servings: Math.min(20, Math.max(1, Math.round(parsed.servings || 1))),
        ingredients: parsed.ingredients.slice(0, 40).map(i => String(i).slice(0, 160)),
        steps: (parsed.steps || []).slice(0, 25).map(st => String(st).slice(0, 400)),
        perServing: {
          calories: n(parsed.perServing?.calories),
          protein: n(parsed.perServing?.protein),
          fat: n(parsed.perServing?.fat),
          carbs: n(parsed.perServing?.carbs),
          sugar: n(parsed.perServing?.sugar),
        },
      },
    });
  } catch (error) {
    console.error('recipe parse error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

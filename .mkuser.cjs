const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
const EMAIL = 'design-preview@local.test';
const PASS = 'Preview!' + Math.random().toString(36).slice(2, 10);
(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({
    data: { email: EMAIL, name: 'Проверка дизайна', password: await bcrypt.hash(PASS, 10) },
  });
  const recipes = [
    { id: 'r1', name: 'Овсянка с творогом и ягодами', servings: 2, durationMinutes: 15,
      ingredients: ['Овсяные хлопья — 120 г','Творог 5% — 200 г','Черника — 100 г','Молоко 2.5% — 250 мл','Мёд — 1 ст. л.'],
      steps: ['Залей хлопья молоком и доведи до кипения.','Вари 5 минут, помешивая.','Сними с огня, вмешай творог и мёд.','Разложи по тарелкам и засыпь ягодами.'],
      perServing: { calories: 420, protein: 28, fat: 11, carbs: 52, sugar: 14 },
      category: 'завтрак', source: 'manual', createdAt: new Date().toISOString() },
    { id: 'r2', name: 'Куриная грудка с гречкой и овощами', servings: 3,
      ingredients: ['Куриная грудка — 600 г','Гречка — 250 г','Брокколи — 300 г','Оливковое масло — 2 ст. л.'],
      steps: ['Отвари гречку 15 минут.','Обжарь грудку до корочки.','Брокколи на пару 6 минут.','Собери тарелку.'],
      perServing: { calories: 510, protein: 46, fat: 14, carbs: 48, sugar: 3 },
      category: 'обед', source: 'manual', createdAt: new Date().toISOString() },
  ];
  await prisma.fitnessData.create({
    data: { userId: user.id, dayLogs: {}, recipes,
      nutritionProfile: { conditions: [], intolerances: ['лактоза'], mealsPerDay: 4,
        snacking: 'редко', trainingTime: 'вечером', dietStyle: 'обычное',
        dislikes: 'грибы', notes: '', completedAt: new Date().toISOString() } },
  });
  require('fs').writeFileSync('.preview-creds', EMAIL + '\n' + PASS);
  console.log('создан', EMAIL);
  await prisma.$disconnect();
})();

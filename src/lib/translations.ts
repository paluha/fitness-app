export const translations = {
  ru: {
    // Header
    login: 'Войти',

    // Hero section
    heroTitle: 'Твой',
    heroHighlight: 'ПРОСТОЙ',
    heroSubtitle: 'фитнес-трекер',
    heroDescription: 'Отслеживай тренировки, питание и прогресс в одном приложении. Создано для тех, кто хочет результат без сложностей.',
    downloadApp: 'Скачать приложение',
    learnMore: 'Узнать больше',

    // Features
    featuresTitle: 'Всё что нужно',
    featuresSubtitle: 'Для достижения твоих целей',

    feature1Title: 'Тренировки',
    feature1Desc: 'Готовые программы от тренера или свои собственные. Отмечай подходы, отслеживай веса.',

    feature2Title: 'Питание',
    feature2Desc: 'Считай калории и макросы. Добавляй приёмы пищи за секунды.',

    feature3Title: 'Прогресс',
    feature3Desc: 'Графики веса, замеры тела, история тренировок. Видь свой путь.',

    feature4Title: 'Синхронизация',
    feature4Desc: 'Данные синхронизируются между устройствами. Тренер видит твой прогресс.',

    // How it works
    howItWorksTitle: 'Как это работает',

    step1Title: 'Зарегистрируйся',
    step1Desc: 'Получи доступ от тренера или создай аккаунт самостоятельно',

    step2Title: 'Получи программу',
    step2Desc: 'Тренер назначит тебе персональную программу тренировок',

    step3Title: 'Тренируйся',
    step3Desc: 'Выполняй упражнения и отмечай прогресс в приложении',

    step4Title: 'Достигай целей',
    step4Desc: 'Следи за результатами и двигайся к своей лучшей форме',

    // CTA
    ctaTitle: 'Готов начать?',
    ctaSubtitle: 'Скачай приложение и начни свой путь к лучшей версии себя',

    // Footer
    footerText: '© 2024 Trainx. Все права защищены.',

    // Phone demo
    workout: 'Тренировка',
    upperBody: 'Верх тела',
    exercises: 'упражнений',
    benchPress: 'Жим лёжа',
    pullUps: 'Подтягивания',
    shoulderPress: 'Жим плеч',

    nutrition: 'Питание',
    calories: 'Калории',
    protein: 'Белок',
    carbs: 'Углеводы',
    fats: 'Жиры',

    progress: 'Прогресс',
    weight: 'Вес',
    thisMonth: 'За месяц',
  },

  en: {
    // Header
    login: 'Login',

    // Hero section
    heroTitle: 'Your',
    heroHighlight: 'SIMPLE',
    heroSubtitle: 'fitness tracker',
    heroDescription: 'Track workouts, nutrition and progress in one app. Made for those who want results without complexity.',
    downloadApp: 'Download App',
    learnMore: 'Learn More',

    // Features
    featuresTitle: 'Everything you need',
    featuresSubtitle: 'To achieve your goals',

    feature1Title: 'Workouts',
    feature1Desc: 'Ready-made programs from your trainer or create your own. Track sets and weights.',

    feature2Title: 'Nutrition',
    feature2Desc: 'Count calories and macros. Add meals in seconds.',

    feature3Title: 'Progress',
    feature3Desc: 'Weight graphs, body measurements, workout history. See your journey.',

    feature4Title: 'Sync',
    feature4Desc: 'Data syncs across devices. Your trainer sees your progress.',

    // How it works
    howItWorksTitle: 'How it works',

    step1Title: 'Sign up',
    step1Desc: 'Get access from your trainer or create an account yourself',

    step2Title: 'Get your program',
    step2Desc: 'Your trainer will assign you a personalized workout program',

    step3Title: 'Train',
    step3Desc: 'Do exercises and track progress in the app',

    step4Title: 'Achieve goals',
    step4Desc: 'Monitor results and move towards your best shape',

    // CTA
    ctaTitle: 'Ready to start?',
    ctaSubtitle: 'Download the app and begin your journey to a better version of yourself',

    // Footer
    footerText: '© 2024 Trainx. All rights reserved.',

    // Phone demo
    workout: 'Workout',
    upperBody: 'Upper Body',
    exercises: 'exercises',
    benchPress: 'Bench Press',
    pullUps: 'Pull Ups',
    shoulderPress: 'Shoulder Press',

    nutrition: 'Nutrition',
    calories: 'Calories',
    protein: 'Protein',
    carbs: 'Carbs',
    fats: 'Fats',

    progress: 'Progress',
    weight: 'Weight',
    thisMonth: 'This month',
  }
} as const;

export type Language = keyof typeof translations;
export type TranslationKey = keyof typeof translations.ru;

export function getTranslation(lang: Language, key: TranslationKey): string {
  return translations[lang][key];
}

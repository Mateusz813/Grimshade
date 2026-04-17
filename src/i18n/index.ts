import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import pl from './pl.json';
import en from './en.json';

/** Read persisted language from settingsStore (avoids Zustand circular dep). */
function getInitialLanguage(): string {
  try {
    const raw = localStorage.getItem('dungeon_rpg_settings');
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { language?: string } };
      return parsed.state?.language ?? 'pl';
    }
  } catch {
    // ignore
  }
  return 'pl';
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      pl: { translation: pl },
      en: { translation: en },
    },
    lng: getInitialLanguage(),
    fallbackLng: 'pl',
    interpolation: { escapeValue: false },
  });

export default i18n;

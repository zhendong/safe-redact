import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { translations, LANGUAGE_STORAGE_KEY, type Language } from '@/i18n/translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function detectDefaultLanguage(): Language {
  const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language | null;
  if (saved === 'en' || saved === 'zh') return saved;

  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function resolveKey(key: string, language: Language): unknown {
  const dict = translations[language];
  return key.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, dict);
}

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match
  );
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(detectDefaultLanguage);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  const setLanguage = (next: Language) => setLanguageState(next);
  const toggleLanguage = () => setLanguageState((prev) => (prev === 'en' ? 'zh' : 'en'));

  const t = (key: string, vars?: Record<string, string | number>): string => {
    const value = resolveKey(key, language) ?? resolveKey(key, 'en');
    if (typeof value !== 'string') return key;
    return interpolate(value, vars);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

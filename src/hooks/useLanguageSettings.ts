import { useState, useCallback, useEffect } from 'react';
import type { Language, AIProvider } from '../types';

interface UseLanguageSettingsOptions {
  userId?: string;
  initialNativeLang?: Language;
  initialTargetLang?: Language;
  initialProvider?: AIProvider;
  initialOllamaUrl?: string;
  initialOllamaModel?: string;
}

interface UseLanguageSettingsReturn {
  nativeLang: Language;
  targetLang: Language;
  provider: AIProvider;
  ollamaUrl: string;
  ollamaModel: string;
  setNativeLang: (lang: Language) => void;
  setTargetLang: (lang: Language) => void;
  setProvider: (provider: AIProvider) => void;
  setOllamaUrl: (url: string) => void;
  setOllamaModel: (model: string) => void;
  updateLanguages: (nativeLang: Language, targetLang: Language) => Promise<void>;
  updateProviderSettings: (provider: AIProvider, url: string, model: string) => void;
  recognitionLangCode: string;
}

const STORAGE_KEY = 'lumie_language_settings';

const LANG_TO_CODE: Record<Language, string> = {
  'English': 'en-US',
  'Russian': 'ru-RU',
  'Spanish': 'es-ES',
  'French': 'fr-FR',
  'German': 'de-DE',
  'Italian': 'it-IT',
  'Chinese': 'zh-CN',
  'Japanese': 'ja-JP',
  'Portuguese': 'pt-BR'
};

export function useLanguageSettings(options: UseLanguageSettingsOptions = {}): UseLanguageSettingsReturn {
  const {
    userId,
    initialNativeLang = 'Russian',
    initialTargetLang = 'English',
    initialProvider = 'gemini',
    initialOllamaUrl = 'http://localhost:11434',
    initialOllamaModel = 'llama3'
  } = options;

  const [nativeLang, setNativeLangState] = useState<Language>(initialNativeLang);
  const [targetLang, setTargetLangState] = useState<Language>(initialTargetLang);
  const [provider, setProviderState] = useState<AIProvider>(initialProvider);
  const [ollamaUrl, setOllamaUrlState] = useState(initialOllamaUrl);
  const [ollamaModel, setOllamaModelState] = useState(initialOllamaModel);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        if (settings.nativeLang) setNativeLangState(settings.nativeLang);
        if (settings.targetLang) setTargetLangState(settings.targetLang);
        if (settings.provider) setProviderState(settings.provider);
        if (settings.ollamaUrl) setOllamaUrlState(settings.ollamaUrl);
        if (settings.ollamaModel) setOllamaModelState(settings.ollamaModel);
      } catch (e) {
        console.error('Failed to parse language settings:', e);
      }
    }
  }, []);

  // Save to localStorage when settings change
  const saveSettings = useCallback(() => {
    const settings = {
      nativeLang,
      targetLang,
      provider,
      ollamaUrl,
      ollamaModel
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [nativeLang, targetLang, provider, ollamaUrl, ollamaModel]);

  useEffect(() => {
    saveSettings();
  }, [saveSettings]);

  const setNativeLang = useCallback((lang: Language) => {
    setNativeLangState(lang);
  }, []);

  const setTargetLang = useCallback((lang: Language) => {
    setTargetLangState(lang);
  }, []);

  const setProvider = useCallback((newProvider: AIProvider) => {
    setProviderState(newProvider);
  }, []);

  const setOllamaUrl = useCallback((url: string) => {
    setOllamaUrlState(url);
  }, []);

  const setOllamaModel = useCallback((model: string) => {
    setOllamaModelState(model);
  }, []);

  const updateLanguages = useCallback(async (newNativeLang: Language, newTargetLang: Language) => {
    setNativeLangState(newNativeLang);
    setTargetLangState(newTargetLang);

    if (userId) {
      try {
        await fetch('/api/user/update-languages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            nativeLang: newNativeLang,
            targetLang: newTargetLang
          })
        });
      } catch (err) {
        console.error('Failed to update languages on server:', err);
      }
    }
  }, [userId]);

  const updateProviderSettings = useCallback((
    newProvider: AIProvider,
    newUrl: string,
    newModel: string
  ) => {
    setProviderState(newProvider);
    setOllamaUrlState(newUrl);
    setOllamaModelState(newModel);
  }, []);

  const recognitionLangCode = LANG_TO_CODE[targetLang] || 'en-US';

  return {
    nativeLang,
    targetLang,
    provider,
    ollamaUrl,
    ollamaModel,
    setNativeLang,
    setTargetLang,
    setProvider,
    setOllamaUrl,
    setOllamaModel,
    updateLanguages,
    updateProviderSettings,
    recognitionLangCode
  };
}

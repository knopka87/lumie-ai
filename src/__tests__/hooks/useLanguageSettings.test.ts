import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLanguageSettings } from '../../hooks/useLanguageSettings';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useLanguageSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useLanguageSettings());

    expect(result.current.nativeLang).toBe('Russian');
    expect(result.current.targetLang).toBe('English');
    expect(result.current.provider).toBe('gemini');
    expect(result.current.ollamaUrl).toBe('http://localhost:11434');
    expect(result.current.ollamaModel).toBe('llama3');
  });

  it('should initialize with custom values', () => {
    const { result } = renderHook(() =>
      useLanguageSettings({
        initialNativeLang: 'English',
        initialTargetLang: 'Spanish',
        initialProvider: 'ollama',
      })
    );

    expect(result.current.nativeLang).toBe('English');
    expect(result.current.targetLang).toBe('Spanish');
    expect(result.current.provider).toBe('ollama');
  });

  it('should update native language', () => {
    const { result } = renderHook(() => useLanguageSettings());

    act(() => {
      result.current.setNativeLang('English');
    });

    expect(result.current.nativeLang).toBe('English');
  });

  it('should update target language', () => {
    const { result } = renderHook(() => useLanguageSettings());

    act(() => {
      result.current.setTargetLang('Spanish');
    });

    expect(result.current.targetLang).toBe('Spanish');
  });

  it('should update provider', () => {
    const { result } = renderHook(() => useLanguageSettings());

    act(() => {
      result.current.setProvider('ollama');
    });

    expect(result.current.provider).toBe('ollama');
  });

  it('should update provider settings all at once', () => {
    const { result } = renderHook(() => useLanguageSettings());

    act(() => {
      result.current.updateProviderSettings('ollama', 'http://custom:11434', 'mistral');
    });

    expect(result.current.provider).toBe('ollama');
    expect(result.current.ollamaUrl).toBe('http://custom:11434');
    expect(result.current.ollamaModel).toBe('mistral');
  });

  it('should update languages and call API when userId provided', async () => {
    const { result } = renderHook(() =>
      useLanguageSettings({
        userId: 'test-user-123',
      })
    );

    await act(async () => {
      await result.current.updateLanguages('English', 'French');
    });

    expect(result.current.nativeLang).toBe('English');
    expect(result.current.targetLang).toBe('French');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/user/update-languages',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('should not call API when no userId', async () => {
    const { result } = renderHook(() => useLanguageSettings());

    await act(async () => {
      await result.current.updateLanguages('English', 'French');
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should return correct recognition language code', () => {
    const { result } = renderHook(() =>
      useLanguageSettings({
        initialTargetLang: 'Russian',
      })
    );

    expect(result.current.recognitionLangCode).toBe('ru-RU');
  });

  it('should persist settings to localStorage', () => {
    const { result } = renderHook(() => useLanguageSettings());

    act(() => {
      result.current.setTargetLang('French');
    });

    const saved = localStorage.getItem('lumie_language_settings');
    expect(saved).toBeTruthy();
    expect(JSON.parse(saved!).targetLang).toBe('French');
  });

  it('should load settings from localStorage', () => {
    localStorage.setItem(
      'lumie_language_settings',
      JSON.stringify({
        nativeLang: 'Spanish',
        targetLang: 'German',
        provider: 'ollama',
      })
    );

    const { result } = renderHook(() => useLanguageSettings());

    // After effect runs, should have localStorage values
    expect(result.current.nativeLang).toBe('Spanish');
    expect(result.current.targetLang).toBe('German');
  });
});

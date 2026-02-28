import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock @google/genai before importing anything that uses it
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
    },
  })),
  Modality: { AUDIO: 'audio', TEXT: 'text' },
  Type: { ARRAY: 'array', OBJECT: 'object', STRING: 'string' },
}));

import { extractSentences } from '../hooks/useTTS';

describe('useTTS', () => {
  describe('extractSentences', () => {
    it('should extract complete sentences', () => {
      const result = extractSentences('Hello world. How are you?', 0);

      expect(result.sentences).toEqual(['Hello world.', 'How are you?']);
      expect(result.newIndex).toBe(25);
    });

    it('should handle exclamation and question marks', () => {
      const result = extractSentences('Wow! Really? Yes.', 0);

      expect(result.sentences).toEqual(['Wow!', 'Really?', 'Yes.']);
    });

    it('should skip already processed text', () => {
      const text = 'First sentence. Second sentence.';
      const result = extractSentences(text, 16); // After "First sentence. "

      expect(result.sentences).toEqual(['Second sentence.']);
    });

    it('should filter out junk sentences', () => {
      const result = extractSentences('... Hello world.', 0);

      // "..." should be filtered (junk characters only)
      expect(result.sentences).toEqual(['Hello world.']);
    });

    it('should handle empty input', () => {
      const result = extractSentences('', 0);

      expect(result.sentences).toEqual([]);
      expect(result.newIndex).toBe(0);
    });

    it('should not extract incomplete sentences', () => {
      const result = extractSentences('Hello world. This is incomple', 0);

      expect(result.sentences).toEqual(['Hello world.']);
      // New index should stop after the complete sentence (index 12)
      expect(result.newIndex).toBe(12);
    });

    it('should handle multiple spaces between sentences', () => {
      const result = extractSentences('Hello.   World.', 0);

      expect(result.sentences).toEqual(['Hello.', 'World.']);
    });

    it('should handle Cyrillic text', () => {
      const result = extractSentences('Привет мир. Как дела?', 0);

      expect(result.sentences).toEqual(['Привет мир.', 'Как дела?']);
    });
  });
});

describe('useAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should initialize with null user', async () => {
    const { useAuth } = await import('../hooks/useAuth');
    const { result } = renderHook(() => useAuth());

    expect(result.current.user).toBeNull();
    expect(result.current.authError).toBeNull();
  });

  it('should load user from localStorage', async () => {
    const savedUser = {
      id: 'test-123',
      name: 'Test User',
      native_lang: 'Russian',
      target_lang: 'English',
      level: 'A1',
      points: 0,
      streak: 0,
      is_onboarded: true,
    };

    localStorage.setItem('lumie_user', JSON.stringify(savedUser));

    const { useAuth } = await import('../hooks/useAuth');
    const { result } = renderHook(() => useAuth());

    // Wait for effect
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.user?.id).toBe('test-123');
    expect(result.current.user?.name).toBe('Test User');
  });

  it('should clear user on logout', async () => {
    const savedUser = {
      id: 'test-123',
      name: 'Test User',
      native_lang: 'Russian',
      target_lang: 'English',
      level: 'A1',
      points: 0,
      streak: 0,
      is_onboarded: true,
    };

    localStorage.setItem('lumie_user', JSON.stringify(savedUser));

    const { useAuth } = await import('../hooks/useAuth');
    const { result } = renderHook(() => useAuth());

    act(() => {
      result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('lumie_user')).toBeNull();
  });
});

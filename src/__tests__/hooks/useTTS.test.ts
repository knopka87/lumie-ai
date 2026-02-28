import { describe, it, expect, vi } from 'vitest';
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

// Mock generateSpeech
vi.mock('../../services/geminiService', () => ({
  generateSpeech: vi.fn(async (text: string) => {
    if (!text) return null;
    return { data: 'bW9ja19kYXRh', format: 'wav' };
  }),
}));

import { useTTS, extractSentences } from '../../hooks/useTTS';

// Mock pcmToWav
vi.mock('../../lib/utils', () => ({
  pcmToWav: vi.fn((data: string) => 'converted_wav_data'),
}));

describe('useTTS', () => {
  it('should initialize with default state', () => {
    const { result } = renderHook(() => useTTS());

    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.isProcessing).toBe(false);
  });

  it('should have all required methods', () => {
    const { result } = renderHook(() => useTTS());

    expect(typeof result.current.speak).toBe('function');
    expect(typeof result.current.speakImmediate).toBe('function');
    expect(typeof result.current.queueText).toBe('function');
    expect(typeof result.current.stop).toBe('function');
    expect(typeof result.current.clearQueue).toBe('function');
  });

  it('should have audioRef', () => {
    const { result } = renderHook(() => useTTS());
    expect(result.current.audioRef).toBeDefined();
  });

  it('should stop without throwing', () => {
    const { result } = renderHook(() => useTTS());

    expect(() => {
      act(() => {
        result.current.stop();
      });
    }).not.toThrow();

    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.isProcessing).toBe(false);
  });

  it('should clear queue without throwing', () => {
    const { result } = renderHook(() => useTTS());

    expect(() => {
      act(() => {
        result.current.clearQueue();
      });
    }).not.toThrow();

    expect(result.current.isProcessing).toBe(false);
  });
});

describe('extractSentences', () => {
  it('should extract complete sentences', () => {
    const result = extractSentences('Hello world. How are you?', 0);
    expect(result.sentences).toEqual(['Hello world.', 'How are you?']);
    expect(result.newIndex).toBe(25);
  });

  it('should handle incomplete sentences', () => {
    const result = extractSentences('Hello world. How are', 0);
    expect(result.sentences).toEqual(['Hello world.']);
    expect(result.newIndex).toBe(12);
  });

  it('should continue from lastProcessedIndex', () => {
    const result = extractSentences('Hello world. How are you?', 13);
    expect(result.sentences).toEqual(['How are you?']);
  });

  it('should handle exclamation marks', () => {
    const result = extractSentences('Hello! How are you?', 0);
    expect(result.sentences).toEqual(['Hello!', 'How are you?']);
  });

  it('should handle Russian text', () => {
    const result = extractSentences('Привет мир! Как дела?', 0);
    expect(result.sentences).toEqual(['Привет мир!', 'Как дела?']);
  });

  it('should filter junk sentences', () => {
    const result = extractSentences('... Hello!', 0);
    expect(result.sentences).toEqual(['Hello!']);
  });

  it('should return empty array for no complete sentences', () => {
    const result = extractSentences('Hello world', 0);
    expect(result.sentences).toEqual([]);
    expect(result.newIndex).toBe(0);
  });

  it('should handle multiple sentence endings', () => {
    const result = extractSentences('What?! Really?', 0);
    expect(result.sentences.length).toBeGreaterThan(0);
  });
});

import { vi } from 'vitest';
import type { SpeechResult } from '../../types';

export const mockGenerateSpeech = vi.fn(async (text: string): Promise<SpeechResult | null> => {
  if (!text || text.trim().length === 0) return null;
  return {
    data: 'bW9ja19hdWRpb19kYXRh', // base64 "mock_audio_data"
    format: 'wav'
  };
});

export const mockGenerateTutorResponseStream = vi.fn(async function* () {
  const chunks = ['Hello! ', 'How can ', 'I help you ', 'today?'];
  for (const chunk of chunks) {
    yield { text: chunk };
  }
});

export const mockGenerateEmbedding = vi.fn(async (text: string): Promise<number[]> => {
  return new Array(768).fill(0.1);
});

export const mockExtractFacts = vi.fn(async (text: string): Promise<Array<{ topic: string; text: string }>> => {
  return [{ topic: 'test', text: 'This is a test fact.' }];
});

export const mockGenerateLessonContent = vi.fn(async () => ({
  theory: 'Test theory content',
  vocabulary: [{ word: 'hello', translation: 'привет' }],
  examples: [{ text: 'Hello world', translation: 'Привет мир' }],
  exercises: [{
    question: 'What is "hello" in Russian?',
    options: ['привет', 'пока', 'спасибо', 'да'],
    answer: 'привет',
    explanation: 'Hello translates to привет'
  }]
}));

export function setupGeminiServiceMocks() {
  vi.mock('../../services/geminiService', () => ({
    generateSpeech: mockGenerateSpeech,
    generateTutorResponseStream: mockGenerateTutorResponseStream,
    generateEmbedding: mockGenerateEmbedding,
    extractFacts: mockExtractFacts,
    generateLessonContent: mockGenerateLessonContent,
    TUTOR_SYSTEM_INSTRUCTION: 'Mock system instruction'
  }));
}

export function resetGeminiServiceMocks() {
  mockGenerateSpeech.mockClear();
  mockGenerateTutorResponseStream.mockClear();
  mockGenerateEmbedding.mockClear();
  mockExtractFacts.mockClear();
  mockGenerateLessonContent.mockClear();
}

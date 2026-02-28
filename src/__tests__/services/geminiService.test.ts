import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock the @google/genai module before importing geminiService
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

describe('geminiService', () => {
  let TUTOR_SYSTEM_INSTRUCTION: string;

  beforeAll(async () => {
    const module = await import('../../services/geminiService');
    TUTOR_SYSTEM_INSTRUCTION = module.TUTOR_SYSTEM_INSTRUCTION;
  });

  describe('TUTOR_SYSTEM_INSTRUCTION', () => {
    it('should be a non-empty string', () => {
      expect(typeof TUTOR_SYSTEM_INSTRUCTION).toBe('string');
      expect(TUTOR_SYSTEM_INSTRUCTION.length).toBeGreaterThan(0);
    });

    it('should contain template placeholders', () => {
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('{{name}}');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('{{native_lang}}');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('{{target_lang}}');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('{{level}}');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('{{memories}}');
    });

    it('should contain CEFR level guidelines', () => {
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('CEFR');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('A1');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('B1');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('C1');
    });

    it('should mention Lumie as the tutor name', () => {
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('Lumie');
    });

    it('should include conversational guidelines', () => {
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('CONVERSATIONAL GUIDELINES');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('LANGUAGE BALANCE');
    });

    it('should include personalization section', () => {
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('PERSONALIZATION');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('MEMORY');
    });

    it('should include emotional expression guidelines', () => {
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('EMOTIONAL');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('EXPRESS');
    });

    it('should reference user profile fields', () => {
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('USER PROFILE');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('Proficiency Level');
    });

    it('should include engagement guidelines', () => {
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('ENGAGEMENT');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('proactive');
    });

    it('should cover all CEFR levels', () => {
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('A1 (Beginner)');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('A2 (Elementary)');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('B1 (Intermediate)');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('B2 (Upper Intermediate)');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('C1 (Advanced)');
      expect(TUTOR_SYSTEM_INSTRUCTION).toContain('C2 (Proficiency)');
    });
  });
});

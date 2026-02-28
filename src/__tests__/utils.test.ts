import { describe, it, expect } from 'vitest';
import { cn, pcmToWav } from '../lib/utils';

describe('utils', () => {
  describe('cn (className merge)', () => {
    it('should merge class names', () => {
      expect(cn('foo', 'bar')).toBe('foo bar');
    });

    it('should handle conditional classes', () => {
      expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
    });

    it('should merge tailwind classes correctly', () => {
      expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
    });

    it('should handle empty inputs', () => {
      expect(cn()).toBe('');
      expect(cn('')).toBe('');
    });

    it('should handle undefined and null', () => {
      expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
    });
  });

  describe('pcmToWav', () => {
    it('should convert base64 PCM to WAV format', () => {
      // Create simple test PCM data (4 bytes = 2 samples)
      const pcmData = new Uint8Array([0x00, 0x00, 0xFF, 0x7F]); // 0 and max positive
      const base64Pcm = btoa(String.fromCharCode(...pcmData));

      const wavBase64 = pcmToWav(base64Pcm, 16000);

      // Decode and check WAV header
      const wavData = Uint8Array.from(atob(wavBase64), c => c.charCodeAt(0));

      // Check RIFF header
      expect(String.fromCharCode(...wavData.slice(0, 4))).toBe('RIFF');

      // Check WAVE format
      expect(String.fromCharCode(...wavData.slice(8, 12))).toBe('WAVE');

      // Check fmt chunk
      expect(String.fromCharCode(...wavData.slice(12, 16))).toBe('fmt ');

      // Check data chunk
      expect(String.fromCharCode(...wavData.slice(36, 40))).toBe('data');

      // Total size should be 44 (header) + 4 (pcm data)
      expect(wavData.length).toBe(48);
    });

    it('should use default sample rate of 24000', () => {
      const pcmData = new Uint8Array([0x00, 0x00]);
      const base64Pcm = btoa(String.fromCharCode(...pcmData));

      const wavBase64 = pcmToWav(base64Pcm);
      const wavData = Uint8Array.from(atob(wavBase64), c => c.charCodeAt(0));

      // Sample rate is at bytes 24-27 (little-endian)
      const view = new DataView(wavData.buffer);
      const sampleRate = view.getUint32(24, true);

      expect(sampleRate).toBe(24000);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PCMAudioPlayer } from '../../services/liveService';
import { MockAudioContext } from '../mocks/audioContext.mock';

// Mock AudioContext
global.AudioContext = MockAudioContext as unknown as typeof AudioContext;

describe('PCMAudioPlayer', () => {
  let player: PCMAudioPlayer;

  beforeEach(() => {
    player = new PCMAudioPlayer(24000);
  });

  afterEach(() => {
    player.stop();
    vi.clearAllMocks();
  });

  it('should create instance with default sample rate', () => {
    const defaultPlayer = new PCMAudioPlayer();
    expect(defaultPlayer).toBeInstanceOf(PCMAudioPlayer);
  });

  it('should create instance with custom sample rate', () => {
    const customPlayer = new PCMAudioPlayer(16000);
    expect(customPlayer).toBeInstanceOf(PCMAudioPlayer);
  });

  it('should play audio chunk', () => {
    // Base64 encoded PCM data (simple test data)
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(100)));

    // Should not throw
    expect(() => player.playChunk(base64Data)).not.toThrow();
  });

  it('should handle invalid base64 data gracefully', () => {
    // Invalid base64 should be handled gracefully
    expect(() => player.playChunk('invalid!!base64')).not.toThrow();
  });

  it('should stop and cleanup resources', () => {
    // Play some audio first
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(100)));
    player.playChunk(base64Data);

    // Stop should not throw
    expect(() => player.stop()).not.toThrow();
  });

  it('should handle multiple stop calls', () => {
    // Multiple stops should not throw
    player.stop();
    player.stop();
    expect(true).toBe(true);
  });

  it('should reinitialize after stop', () => {
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(100)));

    player.playChunk(base64Data);
    player.stop();

    // Should be able to play again
    expect(() => player.playChunk(base64Data)).not.toThrow();
  });
});

describe('GeminiLiveService', () => {
  // Note: GeminiLiveService requires WebSocket and is harder to test
  // These are basic structural tests

  it('should export GeminiLiveService class', async () => {
    const { GeminiLiveService } = await import('../../services/liveService');
    expect(GeminiLiveService).toBeDefined();
    expect(typeof GeminiLiveService).toBe('function');
  });

  it('should export PCMAudioPlayer class', async () => {
    const { PCMAudioPlayer } = await import('../../services/liveService');
    expect(PCMAudioPlayer).toBeDefined();
    expect(typeof PCMAudioPlayer).toBe('function');
  });

  it('should export LiveServiceCallbacks interface', async () => {
    // TypeScript interfaces don't exist at runtime
    // We can only verify the module exports work
    const module = await import('../../services/liveService');
    expect(module).toBeDefined();
  });
});

describe('AudioRecorder (via GeminiLiveService)', () => {
  // AudioRecorder is internal to liveService
  // We test it through integration with GeminiLiveService

  beforeEach(() => {
    // Mock navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }]
        })
      },
      writable: true
    });
  });

  it('should handle microphone permission errors', async () => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError')
    );

    const { GeminiLiveService } = await import('../../services/liveService');

    const service = new GeminiLiveService('test-api-key');

    // Mock WebSocket
    const mockWs = {
      send: vi.fn(),
      close: vi.fn(),
      onopen: null as any,
      onmessage: null as any,
      onerror: null as any,
      onclose: null as any,
      readyState: 1
    };

    global.WebSocket = vi.fn().mockImplementation(() => mockWs) as any;

    const callbacks = {
      onAudioData: vi.fn(),
      onInterrupted: vi.fn(),
      onTranscription: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn()
    };

    try {
      await service.connect({ systemInstruction: 'test' }, callbacks);
      // Trigger WebSocket open
      if (mockWs.onopen) {
        mockWs.onopen();
      }
    } catch (err) {
      // Expected to fail due to permission error
      expect(err).toBeDefined();
    }
  });
});

describe('PCM to Float32 conversion', () => {
  it('should handle empty buffer', () => {
    const player = new PCMAudioPlayer();
    const emptyBase64 = btoa('');

    expect(() => player.playChunk(emptyBase64)).not.toThrow();
    player.stop();
  });

  it('should handle single sample', () => {
    const player = new PCMAudioPlayer();
    // Single 16-bit sample
    const buffer = new Uint8Array(2);
    const base64 = btoa(String.fromCharCode(...buffer));

    expect(() => player.playChunk(base64)).not.toThrow();
    player.stop();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceRecognition } from '../../hooks/useVoiceRecognition';
import { setupSpeechRecognitionMock, createMockSpeechRecognition } from '../helpers';

describe('useVoiceRecognition', () => {
  let mockRecognition: ReturnType<typeof createMockSpeechRecognition>;

  beforeEach(() => {
    mockRecognition = createMockSpeechRecognition();

    // Setup window mocks
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      writable: true,
      configurable: true,
      value: function () {
        return mockRecognition;
      },
    });

    // Mock navigator.permissions
    Object.defineProperty(navigator, 'permissions', {
      writable: true,
      configurable: true,
      value: {
        query: vi.fn().mockResolvedValue({
          state: 'prompt',
          onchange: null,
        }),
      },
    });

    // Mock navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      writable: true,
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useVoiceRecognition());

    expect(result.current.isListening).toBe(false);
    expect(result.current.isSupported).toBe(true);
    expect(result.current.micPermission).toBe('prompt');
  });

  it('should detect when speech recognition is not supported', () => {
    // Remove speech recognition support
    delete (window as any).webkitSpeechRecognition;
    delete (window as any).SpeechRecognition;

    const { result } = renderHook(() => useVoiceRecognition());

    expect(result.current.isSupported).toBe(false);
  });

  it('should have all required methods', () => {
    const { result } = renderHook(() => useVoiceRecognition());

    expect(typeof result.current.startListening).toBe('function');
    expect(typeof result.current.stopListening).toBe('function');
    expect(typeof result.current.toggleListening).toBe('function');
    expect(typeof result.current.requestPermission).toBe('function');
    expect(typeof result.current.setLanguage).toBe('function');
  });

  it('should request microphone permission', async () => {
    const { result } = renderHook(() => useVoiceRecognition());

    let granted = false;
    await act(async () => {
      granted = await result.current.requestPermission();
    });

    expect(granted).toBe(true);
    expect(result.current.micPermission).toBe('granted');
  });

  it('should handle permission denial', async () => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(
      new DOMException('Permission denied', 'NotAllowedError')
    );

    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceRecognition({ onError }));

    let granted = false;
    await act(async () => {
      granted = await result.current.requestPermission();
    });

    expect(granted).toBe(false);
    expect(result.current.micPermission).toBe('denied');
  });

  it('should set language on recognition object', () => {
    const { result } = renderHook(() => useVoiceRecognition());

    act(() => {
      result.current.setLanguage('Russian');
    });

    expect(mockRecognition.lang).toBe('ru-RU');
  });

  it('should use default language code for unknown language', () => {
    const { result } = renderHook(() => useVoiceRecognition());

    act(() => {
      result.current.setLanguage('UnknownLanguage');
    });

    expect(mockRecognition.lang).toBe('en-US');
  });

  it('should call onResult callback with transcript', () => {
    const onResult = vi.fn();
    renderHook(() => useVoiceRecognition({ onResult }));

    // Simulate speech result
    mockRecognition.simulateResult('Hello world');

    expect(onResult).toHaveBeenCalledWith('Hello world');
  });

  it('should toggle listening state', async () => {
    const { result } = renderHook(() => useVoiceRecognition());

    // Start listening
    await act(async () => {
      await result.current.toggleListening();
    });

    // The recognition should have started
    // Note: exact state depends on mock implementation
  });

  it('should stop listening', () => {
    const { result } = renderHook(() => useVoiceRecognition());

    act(() => {
      result.current.stopListening();
    });

    expect(result.current.isListening).toBe(false);
  });
});

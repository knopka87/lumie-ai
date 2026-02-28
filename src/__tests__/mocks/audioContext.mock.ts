import { vi } from 'vitest';

export class MockAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  sampleRate = 24000;

  createBufferSource = vi.fn(() => ({
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null
  }));

  createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => ({
    numberOfChannels: channels,
    length,
    sampleRate,
    getChannelData: vi.fn(() => new Float32Array(length)),
    copyToChannel: vi.fn()
  }));

  decodeAudioData = vi.fn(async (buffer: ArrayBuffer) => ({
    numberOfChannels: 1,
    length: buffer.byteLength / 2,
    sampleRate: 24000,
    getChannelData: vi.fn(() => new Float32Array(buffer.byteLength / 2))
  }));

  get destination() {
    return { connect: vi.fn() };
  }

  close = vi.fn(async () => {
    this.state = 'closed';
  });

  resume = vi.fn(async () => {
    this.state = 'running';
  });

  suspend = vi.fn(async () => {
    this.state = 'suspended';
  });
}

export class MockHTMLAudioElement {
  src = '';
  paused = true;
  currentTime = 0;
  duration = 0;
  volume = 1;
  muted = false;

  private eventListeners: Record<string, Function[]> = {};

  play = vi.fn(async () => {
    this.paused = false;
  });

  pause = vi.fn(() => {
    this.paused = true;
  });

  load = vi.fn();

  addEventListener = vi.fn((event: string, handler: Function) => {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(handler);
  });

  removeEventListener = vi.fn((event: string, handler: Function) => {
    if (this.eventListeners[event]) {
      this.eventListeners[event] = this.eventListeners[event].filter(h => h !== handler);
    }
  });

  dispatchEvent = vi.fn((event: Event) => {
    const handlers = this.eventListeners[event.type] || [];
    handlers.forEach(handler => handler(event));
    return true;
  });

  simulateEnded() {
    const event = new Event('ended');
    this.dispatchEvent(event);
  }

  simulateError() {
    const event = new Event('error');
    this.dispatchEvent(event);
  }
}

export function setupAudioMocks() {
  global.AudioContext = MockAudioContext as unknown as typeof AudioContext;
  (global as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext = MockAudioContext as unknown as typeof AudioContext;

  vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    if (tagName === 'audio') {
      return new MockHTMLAudioElement() as unknown as HTMLElement;
    }
    return document.createElement(tagName);
  });
}

export function resetAudioMocks() {
  vi.restoreAllMocks();
}

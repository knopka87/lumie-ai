import type { User, Message, Conversation, Memory, LessonData, Topic } from '../types';

/**
 * Create a mock user with sensible defaults
 */
export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'test-user-123',
    email: 'test@example.com',
    name: 'Test User',
    native_lang: 'Russian',
    target_lang: 'English',
    level: 'A2',
    points: 100,
    streak: 5,
    is_onboarded: true,
    ...overrides
  };
}

/**
 * Create a mock message
 */
export function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: Math.floor(Math.random() * 10000),
    conversation_id: 'test-conv-123',
    role: 'assistant',
    content: 'Hello! How can I help you today?',
    type: 'text',
    created_at: new Date().toISOString(),
    ...overrides
  };
}

/**
 * Create a mock conversation
 */
export function createMockConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'test-conv-123',
    user_id: 'test-user-123',
    title: 'Test Conversation',
    created_at: new Date().toISOString(),
    ...overrides
  };
}

/**
 * Create a mock memory
 */
export function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: Math.floor(Math.random() * 10000),
    user_id: 'test-user-123',
    topic: 'test-topic',
    summary: 'This is a test memory',
    ...overrides
  };
}

/**
 * Create a mock topic
 */
export function createMockTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 'topic-1',
    title: 'Present Simple',
    description: 'Learn about present simple tense',
    category: 'grammar',
    ...overrides
  };
}

/**
 * Create mock lesson data
 */
export function createMockLessonData(overrides: Partial<LessonData> = {}): LessonData {
  return {
    theory: 'The present simple tense is used for habits and facts.',
    vocabulary: [
      { word: 'always', translation: 'всегда' },
      { word: 'never', translation: 'никогда' }
    ],
    examples: [
      { text: 'I always wake up at 7 AM.', translation: 'Я всегда просыпаюсь в 7 утра.' },
      { text: 'She never eats meat.', translation: 'Она никогда не ест мясо.' }
    ],
    exercises: [
      {
        question: 'Choose the correct form: She ___ to school every day.',
        options: ['go', 'goes', 'going', 'went'],
        answer: 'goes',
        explanation: 'With he/she/it, we add -s or -es to the base verb.'
      }
    ],
    ...overrides
  };
}

/**
 * Create a list of mock messages for a conversation
 */
export function createMockConversationHistory(count = 4): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < count; i++) {
    messages.push(createMockMessage({
      id: i + 1,
      role: i % 2 === 0 ? 'assistant' : 'user',
      content: i % 2 === 0 ? `AI message ${i + 1}` : `User message ${i + 1}`,
      created_at: new Date(Date.now() - (count - i) * 60000).toISOString()
    }));
  }
  return messages;
}

/**
 * Wait for all pending promises to resolve
 */
export function flushPromises(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Wait for a specified duration
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Mock localStorage for testing
 */
export function createMockLocalStorage(): Storage {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    key: (index: number) => Object.keys(store)[index] || null,
    get length() { return Object.keys(store).length; }
  };
}

/**
 * Create mock SpeechRecognition
 */
export function createMockSpeechRecognition() {
  return {
    continuous: false,
    interimResults: false,
    lang: 'en-US',
    onresult: null as ((event: unknown) => void) | null,
    onstart: null as (() => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    onend: null as (() => void) | null,
    start: function() {
      if (this.onstart) this.onstart();
    },
    stop: function() {
      if (this.onend) this.onend();
    },
    abort: function() {
      if (this.onend) this.onend();
    },
    simulateResult(transcript: string) {
      if (this.onresult) {
        this.onresult({
          results: [[{ transcript, confidence: 0.95 }]]
        });
      }
    },
    simulateError(error: string) {
      if (this.onerror) {
        this.onerror({ error });
      }
    }
  };
}

/**
 * Setup window.speechRecognition mock
 */
export function setupSpeechRecognitionMock() {
  const mockRecognition = createMockSpeechRecognition();

  Object.defineProperty(window, 'webkitSpeechRecognition', {
    writable: true,
    value: function() {
      return createMockSpeechRecognition();
    }
  });

  Object.defineProperty(window, 'SpeechRecognition', {
    writable: true,
    value: function() {
      return createMockSpeechRecognition();
    }
  });

  return mockRecognition;
}

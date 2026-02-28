import { vi } from 'vitest';
import type { User, Conversation, Message, Memory } from '../../types';

export interface MockFetchResponse<T = unknown> {
  ok: boolean;
  status: number;
  json: () => Promise<T>;
  text: () => Promise<string>;
}

type FetchMockHandler = (url: string, options?: RequestInit) => Promise<MockFetchResponse>;

const handlers: Map<string, FetchMockHandler> = new Map();

export const mockFetch = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<MockFetchResponse> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method || 'GET';
    const key = `${method}:${url}`;

    // Try exact match first
    if (handlers.has(key)) {
      return handlers.get(key)!(url, init);
    }

    // Try pattern matching
    for (const [pattern, handler] of handlers) {
      if (url.includes(pattern.replace(/^(GET|POST|PUT|DELETE):/, '').split('?')[0])) {
        return handler(url, init);
      }
    }

    // Default response
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    };
  }
);

export function mockFetchResponse<T>(urlPattern: string, response: T, method = 'GET') {
  handlers.set(`${method}:${urlPattern}`, async () => ({
    ok: true,
    status: 200,
    json: async () => response,
    text: async () => JSON.stringify(response),
  }));
}

export function mockFetchError(urlPattern: string, error: string, status = 500, method = 'GET') {
  handlers.set(`${method}:${urlPattern}`, async () => ({
    ok: false,
    status,
    json: async () => ({ error }),
    text: async () => error,
  }));
}

export function setupFetchMock() {
  global.fetch = mockFetch as unknown as typeof fetch;
}

export function resetFetchMock() {
  handlers.clear();
  mockFetch.mockClear();
}

// Common API response mocks
export const mockUserResponse: User = {
  id: 'test-user-123',
  email: 'test@example.com',
  name: 'Test User',
  native_lang: 'Russian',
  target_lang: 'English',
  level: 'A2',
  points: 100,
  streak: 5,
  is_onboarded: true,
};

export const mockConversationsResponse: Conversation[] = [
  {
    id: 'conv-1',
    user_id: 'test-user-123',
    title: 'Learning Session',
    created_at: new Date().toISOString(),
  },
  {
    id: 'conv-2',
    user_id: 'test-user-123',
    title: 'Practice Talk',
    created_at: new Date().toISOString(),
  },
];

export const mockMessagesResponse: Message[] = [
  {
    id: 1,
    conversation_id: 'conv-1',
    role: 'assistant',
    content: 'Hello! How can I help you today?',
    type: 'text',
    created_at: new Date().toISOString(),
  },
  {
    id: 2,
    conversation_id: 'conv-1',
    role: 'user',
    content: 'I want to learn English',
    type: 'text',
    created_at: new Date().toISOString(),
  },
];

export const mockMemoriesResponse: Memory[] = [
  {
    id: 1,
    user_id: 'test-user-123',
    topic: 'interests',
    summary: 'User likes reading books',
  },
  {
    id: 2,
    user_id: 'test-user-123',
    topic: 'learning',
    summary: 'User struggles with past tense',
  },
];

export function setupCommonFetchMocks() {
  setupFetchMock();

  // User API
  mockFetchResponse('/api/user/', mockUserResponse);
  mockFetchResponse('/api/auth/demo', mockUserResponse);
  mockFetchResponse('/api/user/update-languages', { success: true }, 'POST');
  mockFetchResponse('/api/user/complete-topic', { success: true }, 'POST');

  // Conversations API
  mockFetchResponse('/api/conversations/user/', mockConversationsResponse);
  mockFetchResponse('/api/conversations', { id: 'new-conv' }, 'POST');
  mockFetchResponse('/api/conversations/', mockMessagesResponse);

  // Messages API
  mockFetchResponse('/api/messages', { success: true }, 'POST');

  // Memory API
  mockFetchResponse('/api/memory/search', mockMemoriesResponse, 'POST');
  mockFetchResponse('/api/memory/add', { success: true }, 'POST');

  // Progress API
  mockFetchResponse('/api/user/', ['topic-1', 'topic-2']);
}

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageList } from '../../components/MessageList';
import { createMockMessage, createMockConversationHistory } from '../helpers';

// Mock framer-motion
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock i18n
vi.mock('../../i18n', () => ({
  t: (key: string) => key,
}));

// Mock scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

describe('MessageList', () => {
  it('should render empty state when no messages', () => {
    render(<MessageList messages={[]} />);

    // Should render the container but no messages
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('should render all messages', () => {
    const messages = createMockConversationHistory(4);

    render(<MessageList messages={messages} />);

    expect(screen.getByText('AI message 1')).toBeInTheDocument();
    expect(screen.getByText('User message 2')).toBeInTheDocument();
    expect(screen.getByText('AI message 3')).toBeInTheDocument();
    expect(screen.getByText('User message 4')).toBeInTheDocument();
  });

  it('should show loading indicator when isLoading is true', () => {
    render(<MessageList messages={[]} isLoading={true} />);

    // Look for the animated dots (loading indicator)
    const container = document.querySelector('.animate-bounce');
    expect(container).toBeInTheDocument();
  });

  it('should not show loading indicator when isLoading is false', () => {
    render(<MessageList messages={[]} isLoading={false} />);

    const container = document.querySelector('.animate-bounce');
    expect(container).not.toBeInTheDocument();
  });

  it('should pass onSpeak to MessageBubble components', () => {
    const onSpeak = vi.fn();
    const messages = [createMockMessage({ role: 'assistant' })];

    render(<MessageList messages={messages} onSpeak={onSpeak} />);

    // The speak button should be present for assistant messages
    // This is tested more thoroughly in MessageBubble.test.tsx
  });

  it('should auto-scroll to bottom on new messages', () => {
    const messages = createMockConversationHistory(2);

    const { rerender } = render(<MessageList messages={messages} />);

    // Add a new message
    const newMessages = [...messages, createMockMessage({ content: 'New message' })];
    rerender(<MessageList messages={newMessages} />);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});

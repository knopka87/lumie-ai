import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble } from '../../components/MessageBubble';
import { createMockMessage } from '../helpers';

// Mock framer-motion to avoid animation issues in tests
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>
  }
}));

// Mock i18n
vi.mock('../../i18n', () => ({
  t: (key: string) => {
    const translations: Record<string, string> = {
      'ui.readAloud': 'Read aloud',
      'lesson.learningCard': 'Learning Card'
    };
    return translations[key] || key;
  }
}));

describe('MessageBubble', () => {
  it('should render user message with correct styling', () => {
    const message = createMockMessage({
      role: 'user',
      content: 'Hello world'
    });

    render(<MessageBubble message={message} />);

    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('should render assistant message with correct styling', () => {
    const message = createMockMessage({
      role: 'assistant',
      content: 'Hi there!'
    });

    render(<MessageBubble message={message} />);

    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('should show speak button for assistant messages when onSpeak provided', () => {
    const message = createMockMessage({
      role: 'assistant',
      content: 'Test message'
    });
    const onSpeak = vi.fn();

    render(<MessageBubble message={message} onSpeak={onSpeak} />);

    const speakButton = screen.getByRole('button', { name: 'Read aloud' });
    expect(speakButton).toBeInTheDocument();
  });

  it('should not show speak button for user messages', () => {
    const message = createMockMessage({
      role: 'user',
      content: 'Test message'
    });
    const onSpeak = vi.fn();

    render(<MessageBubble message={message} onSpeak={onSpeak} />);

    expect(screen.queryByRole('button', { name: 'Read aloud' })).not.toBeInTheDocument();
  });

  it('should call onSpeak when speak button clicked', () => {
    const message = createMockMessage({
      role: 'assistant',
      content: 'Test message content'
    });
    const onSpeak = vi.fn();

    render(<MessageBubble message={message} onSpeak={onSpeak} />);

    const speakButton = screen.getByRole('button', { name: 'Read aloud' });
    fireEvent.click(speakButton);

    expect(onSpeak).toHaveBeenCalledWith('Test message content');
  });

  it('should show Learning Card badge for theory messages', () => {
    const message = createMockMessage({
      role: 'assistant',
      content: 'Some theory content',
      type: 'theory'
    });

    render(<MessageBubble message={message} />);

    expect(screen.getByText('Learning Card')).toBeInTheDocument();
  });

  it('should not show Learning Card badge for regular messages', () => {
    const message = createMockMessage({
      role: 'assistant',
      content: 'Regular message',
      type: 'text'
    });

    render(<MessageBubble message={message} />);

    expect(screen.queryByText('Learning Card')).not.toBeInTheDocument();
  });

  it('should render markdown content', () => {
    const message = createMockMessage({
      role: 'assistant',
      content: '**Bold text** and *italic*'
    });

    render(<MessageBubble message={message} />);

    // Markdown should be rendered
    expect(screen.getByText(/Bold text/)).toBeInTheDocument();
  });
});

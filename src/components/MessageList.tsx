import React, { memo, useRef, useEffect } from 'react';
import { MessageBubble } from './MessageBubble';
import type { Message } from '../types';

interface MessageListProps {
  messages: Message[];
  onSpeak?: (text: string) => void;
  isLoading?: boolean;
}

/**
 * Memoized message list component with auto-scroll
 */
export const MessageList = memo(function MessageList({
  messages,
  onSpeak,
  isLoading,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content]);

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-10 max-w-3xl mx-auto w-full scrollbar-hide">
      {messages.map((msg, idx) => (
        <MessageBubble
          key={msg.id ?? `msg-${idx}`}
          message={msg}
          onSpeak={onSpeak}
        />
      ))}

      {isLoading && (
        <div className="flex flex-col items-start">
          <div className="flex gap-1.5 items-center px-6 py-5 bg-gray-50 rounded-[2rem] rounded-tl-none border border-gray-100">
            <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" />
            <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce [animation-delay:0.2s]" />
            <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce [animation-delay:0.4s]" />
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
});

export default MessageList;

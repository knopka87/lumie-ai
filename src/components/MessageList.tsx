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
    <div className="scrollbar-hide mx-auto w-full max-w-3xl flex-1 space-y-10 overflow-y-auto p-8">
      {messages.map((msg, idx) => (
        <MessageBubble key={msg.id ?? `msg-${idx}`} message={msg} onSpeak={onSpeak} />
      ))}

      {isLoading && (
        <div className="flex flex-col items-start">
          <div className="flex items-center gap-1.5 rounded-[2rem] rounded-tl-none border border-gray-100 bg-gray-50 px-6 py-5">
            <div className="h-2 w-2 animate-bounce rounded-full bg-gray-300" />
            <div className="h-2 w-2 animate-bounce rounded-full bg-gray-300 [animation-delay:0.2s]" />
            <div className="h-2 w-2 animate-bounce rounded-full bg-gray-300 [animation-delay:0.4s]" />
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
});

export default MessageList;

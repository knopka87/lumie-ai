import React, { memo } from 'react';
import { motion } from 'motion/react';
import Markdown from 'react-markdown';
import { Volume2, BookOpen } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Message } from '../types';
import { t } from '../i18n';

interface MessageBubbleProps {
  message: Message;
  onSpeak?: (text: string) => void;
}

/**
 * Memoized message bubble component
 * Only re-renders when message content changes
 */
export const MessageBubble = memo(
  function MessageBubble({ message, onSpeak }: MessageBubbleProps) {
    const isUser = message.role === 'user';
    const isTheory = message.type === 'theory';

    return (
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}
      >
        <div
          className={cn(
            'max-w-[85%] rounded-[2rem] px-6 py-4 text-base leading-relaxed shadow-sm',
            isUser
              ? 'rounded-tr-none bg-orange-500 font-medium text-white'
              : 'rounded-tl-none border border-gray-100 bg-gray-50 text-gray-800'
          )}
        >
          <div className="markdown-body">
            <Markdown>{message.content}</Markdown>
          </div>
        </div>

        {!isUser && (
          <div className="mt-3 ml-2 flex items-center gap-3">
            {onSpeak && (
              <button
                onClick={() => onSpeak(message.content)}
                className="rounded-xl border border-gray-100 bg-white p-2.5 text-gray-400 shadow-sm transition-all hover:bg-gray-50 hover:text-orange-500"
                aria-label={t('ui.readAloud')}
              >
                <Volume2 className="h-4 w-4" />
              </button>
            )}

            {isTheory && (
              <div className="flex items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[10px] font-bold tracking-wider text-blue-600 uppercase">
                <BookOpen className="h-3.5 w-3.5" />
                {t('lesson.learningCard')}
              </div>
            )}
          </div>
        )}
      </motion.div>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison - only re-render if content changes
    return (
      prevProps.message.content === nextProps.message.content &&
      prevProps.message.type === nextProps.message.type
    );
  }
);

export default MessageBubble;

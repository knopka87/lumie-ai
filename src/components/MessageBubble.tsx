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
export const MessageBubble = memo(function MessageBubble({
  message,
  onSpeak,
}: MessageBubbleProps) {
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
          'max-w-[85%] px-6 py-4 rounded-[2rem] text-base leading-relaxed shadow-sm',
          isUser
            ? 'bg-orange-500 text-white rounded-tr-none font-medium'
            : 'bg-gray-50 text-gray-800 rounded-tl-none border border-gray-100'
        )}
      >
        <div className="markdown-body">
          <Markdown>{message.content}</Markdown>
        </div>
      </div>

      {!isUser && (
        <div className="flex items-center gap-3 mt-3 ml-2">
          {onSpeak && (
            <button
              onClick={() => onSpeak(message.content)}
              className="p-2.5 bg-white border border-gray-100 rounded-xl hover:bg-gray-50 transition-all text-gray-400 hover:text-orange-500 shadow-sm"
              aria-label={t('ui.readAloud')}
            >
              <Volume2 className="w-4 h-4" />
            </button>
          )}

          {isTheory && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[10px] font-bold uppercase tracking-wider border border-blue-100">
              <BookOpen className="w-3.5 h-3.5" />
              {t('lesson.learningCard')}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if content changes
  return (
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.type === nextProps.message.type
  );
});

export default MessageBubble;

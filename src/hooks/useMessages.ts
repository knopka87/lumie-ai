import { useState, useCallback, useRef } from 'react';
import { Message, Conversation } from '../lib/utils';
import { generateTutorResponseStream, generateEmbedding, extractFacts } from '../services/geminiService';
import { User } from './useAuth';

interface UseMessagesOptions {
  user: User | null;
  onFactExtracted?: (fact: { topic: string; text: string }) => void;
}

interface UseMessagesReturn {
  messages: Message[];
  conversations: Conversation[];
  currentConversationId: string | null;
  isLoading: boolean;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setCurrentConversationId: (id: string | null) => void;
  fetchConversations: () => Promise<void>;
  fetchMessages: (conversationId: string) => Promise<void>;
  createConversation: (title?: string) => Promise<string | null>;
  sendMessage: (content: string, memories?: any[]) => Promise<{ fullText: string } | null>;
  streamingTextRef: React.MutableRefObject<string>;
}

export function useMessages({ user, onFactExtracted }: UseMessagesOptions): UseMessagesReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const streamingTextRef = useRef<string>('');

  const fetchConversations = useCallback(async () => {
    if (!user) return;

    try {
      const res = await fetch(`/api/conversations/user/${user.id}`);
      const data = await res.json();
      setConversations(data);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  }, [user]);

  const fetchMessages = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`);
      const data = await res.json();
      setMessages(data);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  }, []);

  const createConversation = useCallback(async (title?: string): Promise<string | null> => {
    if (!user) return null;

    const id = Math.random().toString(36).substring(7);
    const conversationTitle = title || 'New Session';

    try {
      await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, user_id: user.id, title: conversationTitle })
      });

      setCurrentConversationId(id);
      setMessages([]);
      await fetchConversations();
      return id;
    } catch (err) {
      console.error('Failed to create conversation:', err);
      return null;
    }
  }, [user, fetchConversations]);

  const sendMessage = useCallback(async (
    content: string,
    memories: any[] = []
  ): Promise<{ fullText: string } | null> => {
    if (!content.trim() || isLoading || !user) {
      return null;
    }

    let convId = currentConversationId;

    // Create conversation if needed
    if (!convId) {
      convId = await createConversation(content.substring(0, 30));
      if (!convId) return null;
    }

    const userMsg: Message = {
      conversation_id: convId,
      role: 'user',
      content,
      type: 'text'
    };

    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    streamingTextRef.current = '';

    try {
      // Save user message and fetch memories in parallel
      const embedding = await generateEmbedding(content);

      const [, memRes] = await Promise.all([
        fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userMsg)
        }),
        fetch('/api/memory/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, embedding })
        })
      ]);

      let fetchedMemories = memories;
      try {
        const json = await memRes.json();
        fetchedMemories = Array.isArray(json) ? json : memories;
      } catch (e) {
        console.warn('Failed to parse memories:', e);
      }

      // Generate AI response
      const history = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content
      }));

      const stream = await generateTutorResponseStream(history, user, fetchedMemories);
      let fullAiText = '';

      // Add initial empty AI message
      const initialAiMsg: Message = {
        conversation_id: convId,
        role: 'assistant',
        content: '',
        type: 'text'
      };
      setMessages(prev => [...prev, initialAiMsg]);

      // Stream the response
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          fullAiText += text;
          streamingTextRef.current = fullAiText;

          setMessages(prev => {
            const newMsgs = [...prev];
            const lastIdx = newMsgs.length - 1;
            if (lastIdx >= 0 && newMsgs[lastIdx].role === 'assistant') {
              newMsgs[lastIdx] = {
                ...newMsgs[lastIdx],
                content: fullAiText,
                type: fullAiText.includes('### Theory') ? 'theory' : 'text'
              };
            }
            return newMsgs;
          });
        }
      }

      // Save final AI message
      const finalAiMsg = {
        conversation_id: convId,
        role: 'assistant',
        content: fullAiText,
        type: fullAiText.includes('### Theory') ? 'theory' : 'text'
      };

      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalAiMsg)
      });

      // Extract and store facts
      const facts = await extractFacts(`User: ${content}\nAI: ${fullAiText}`);
      if (facts && facts.length > 0) {
        for (const fact of facts) {
          onFactExtracted?.(fact);

          const factEmbedding = await generateEmbedding(fact.text);
          await fetch('/api/memory/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: user.id,
              text: fact.text,
              topic: fact.topic,
              embedding: factEmbedding
            })
          });
        }
      }

      return { fullText: fullAiText };
    } catch (error) {
      console.error('Error in sendMessage:', error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [user, currentConversationId, messages, isLoading, createConversation, onFactExtracted]);

  return {
    messages,
    conversations,
    currentConversationId,
    isLoading,
    setMessages,
    setCurrentConversationId,
    fetchConversations,
    fetchMessages,
    createConversation,
    sendMessage,
    streamingTextRef
  };
}

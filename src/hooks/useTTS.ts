import { useState, useRef, useCallback, useEffect } from 'react';
import { generateSpeech } from '../services/geminiService';
import { pcmToWav } from '../lib/utils';

interface UseTTSReturn {
  isSpeaking: boolean;
  isProcessing: boolean;
  speak: (text: string) => Promise<void>;
  speakImmediate: (text: string) => Promise<void>;
  queueText: (text: string) => void;
  stop: () => void;
  clearQueue: () => void;
  audioRef: React.RefObject<HTMLAudioElement>;
}

/**
 * Hook for Text-to-Speech with queue management
 * Fixes race conditions by using refs for queue state
 */
export function useTTS(): UseTTSReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Use refs to avoid stale closures in async operations
  const textQueueRef = useRef<string[]>([]);
  const audioQueueRef = useRef<{ data: string; format: string }[]>([]);
  const isSynthesizingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Process text queue (Producer)
  const processTextQueue = useCallback(async () => {
    if (isSynthesizingRef.current || textQueueRef.current.length === 0) {
      return;
    }

    isSynthesizingRef.current = true;
    setIsProcessing(true);

    while (textQueueRef.current.length > 0) {
      const text = textQueueRef.current.shift()!;

      try {
        const speechResult = await generateSpeech(text);
        if (speechResult) {
          audioQueueRef.current.push(speechResult);
          // Trigger playback if not already playing
          processAudioQueue();
        }
      } catch (err) {
        console.error("TTS synthesis error:", err);
      }
    }

    isSynthesizingRef.current = false;
    setIsProcessing(textQueueRef.current.length > 0);
  }, []);

  // Process audio queue (Consumer)
  const processAudioQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0 || !audioRef.current) {
      return;
    }

    isPlayingRef.current = true;
    setIsSpeaking(true);

    const speechResult = audioQueueRef.current.shift()!;
    const { data, format } = speechResult;

    let audioUrl = '';
    if (format === 'pcm') {
      const wavBase64 = pcmToWav(data);
      audioUrl = `data:audio/wav;base64,${wavBase64}`;
    } else {
      audioUrl = `data:audio/wav;base64,${data}`;
    }

    audioRef.current.src = audioUrl;

    try {
      await audioRef.current.play();
    } catch (err) {
      console.error("Audio playback failed:", err);
      isPlayingRef.current = false;
      setIsSpeaking(false);
      // Try next in queue
      processAudioQueue();
    }
  }, []);

  // Handle audio ended
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => {
      isPlayingRef.current = false;
      if (audioQueueRef.current.length > 0) {
        processAudioQueue();
      } else {
        setIsSpeaking(false);
      }
    };

    const handleError = () => {
      console.error("Audio error occurred");
      isPlayingRef.current = false;
      setIsSpeaking(false);
      // Try next in queue
      if (audioQueueRef.current.length > 0) {
        processAudioQueue();
      }
    };

    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [processAudioQueue]);

  // Queue text for TTS
  const queueText = useCallback((text: string) => {
    if (!text.trim()) return;

    // Filter out junk
    if (text.length <= 1 || !/[a-zA-Zа-яА-Я0-9]/.test(text)) {
      return;
    }

    textQueueRef.current.push(text);
    processTextQueue();
  }, [processTextQueue]);

  // Speak text immediately (clears queue first)
  const speakImmediate = useCallback(async (text: string) => {
    // Clear existing queues
    textQueueRef.current = [];
    audioQueueRef.current = [];

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }

    isPlayingRef.current = false;
    setIsSpeaking(false);

    // Synthesize and play
    setIsProcessing(true);
    try {
      const speechResult = await generateSpeech(text);
      if (speechResult && audioRef.current) {
        const { data, format } = speechResult;
        let audioUrl = '';
        if (format === 'pcm') {
          const wavBase64 = pcmToWav(data);
          audioUrl = `data:audio/wav;base64,${wavBase64}`;
        } else {
          audioUrl = `data:audio/wav;base64,${data}`;
        }

        setIsSpeaking(true);
        isPlayingRef.current = true;
        audioRef.current.src = audioUrl;
        await audioRef.current.play();
      }
    } catch (err) {
      console.error("TTS error:", err);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // Speak (alias for speakImmediate)
  const speak = speakImmediate;

  // Stop playback and clear queues
  const stop = useCallback(() => {
    textQueueRef.current = [];
    audioQueueRef.current = [];

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }

    isPlayingRef.current = false;
    isSynthesizingRef.current = false;
    setIsSpeaking(false);
    setIsProcessing(false);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // Clear queue without stopping current playback
  const clearQueue = useCallback(() => {
    textQueueRef.current = [];
    audioQueueRef.current = [];
    setIsProcessing(false);
  }, []);

  return {
    isSpeaking,
    isProcessing,
    speak,
    speakImmediate,
    queueText,
    stop,
    clearQueue,
    audioRef
  };
}

/**
 * Utility to extract sentences from streaming text
 */
export function extractSentences(
  fullText: string,
  lastProcessedIndex: number
): { sentences: string[]; newIndex: number } {
  const textToProcess = fullText.substring(lastProcessedIndex);
  const regex = /[^.!?]+[.!?]+(?=\s|$)/g;

  const sentences: string[] = [];
  let match;
  let currentLastIndex = 0;

  while ((match = regex.exec(textToProcess)) !== null) {
    const sentence = match[0].trim();
    // Filter out junk
    if (sentence.length > 1 && /[a-zA-Zа-яА-Я0-9]/.test(sentence)) {
      sentences.push(sentence);
    }
    currentLastIndex = regex.lastIndex;
  }

  return {
    sentences,
    newIndex: lastProcessedIndex + currentLastIndex
  };
}

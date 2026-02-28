import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare,
  Mic,
  Send,
  History,
  Plus,
  Settings,
  BookOpen,
  Volume2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Languages,
  LogOut,
  User,
  Calendar,
  Smile,
  Check,
  ArrowLeft,
  PlayCircle,
  BrainCircuit,
  Lightbulb
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { cn, Message, Conversation, pcmToWav } from './lib/utils';
import { generateTutorResponseStream, generateSpeech, TUTOR_SYSTEM_INSTRUCTION, generateEmbedding, extractFacts, generateLessonContent } from './services/geminiService';
import { GeminiLiveService, PCMAudioPlayer } from './services/liveService';
import { CEFR_CURRICULUM, Topic } from './curriculum';
import { useTranslation } from './i18n';

export default function App() {
  const { t } = useTranslation();
  const [user, setUser] = useState<any>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isUltraFastMode, setIsUltraFastMode] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [view, setView] = useState<'chat' | 'curriculum'>('chat');
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [completedTopics, setCompletedTopics] = useState<string[]>([]);
  const [nativeLang, setNativeLang] = useState('Russian');
  const [targetLang, setTargetLang] = useState('English');
  const [isStreamFinished, setIsStreamFinished] = useState(true);
  const [provider, setProvider] = useState<'gemini' | 'ollama'>('gemini');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('llama3');

  // TTS Queue States
  const [textQueue, setTextQueue] = useState<string[]>([]);
  const [audioQueue, setAudioQueue] = useState<any[]>([]);
  const isSynthesizingRef = useRef(false);
  const isPlayingQueueRef = useRef(false);
  const lastProcessedIndexRef = useRef(0);
  const streamBufferRef = useRef('');

  // Rate limit handling
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);
  const greetingAttemptedRef = useRef<string | null>(null);

  const cleanUserData = (userData: any) => {
    if (!userData) return null;
    return {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      native_lang: userData.native_lang,
      target_lang: userData.target_lang,
      level: userData.level,
      points: userData.points,
      streak: userData.streak,
      is_onboarded: userData.is_onboarded,
      age: userData.age,
      gender: userData.gender,
      avatar: userData.avatar
    };
  };

  const updateLanguages = async (n: string, t: string) => {
    setNativeLang(n);
    setTargetLang(t);
    if (user) {
      const updatedUser = cleanUserData({ 
        ...user, 
        native_lang: n, 
        target_lang: t,
        provider,
        ollama_url: ollamaUrl,
        ollama_model: ollamaModel
      });
      setUser(updatedUser);
      localStorage.setItem('lumie_user', JSON.stringify(updatedUser));
      await fetch('/api/user/update-languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, nativeLang: n, targetLang: t })
      });
    }
  };

  const updateProviderSettings = async (p: 'gemini' | 'ollama', url: string, model: string) => {
    setProvider(p);
    setOllamaUrl(url);
    setOllamaModel(model);
    if (user) {
      const updatedUser = cleanUserData({ 
        ...user, 
        provider: p, 
        ollama_url: url, 
        ollama_model: model,
        native_lang: nativeLang,
        target_lang: targetLang
      });
      setUser(updatedUser);
      localStorage.setItem('lumie_user', JSON.stringify(updatedUser));
      // We can also save this to the server if needed, but for now local storage is fine
    }
  };
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [recognitionLang, setRecognitionLang] = useState('target'); // 'target' or 'native'
  const isVoiceModeRef = useRef(false);
  const isUltraFastModeRef = useRef(false);
  const liveServiceRef = useRef<GeminiLiveService | null>(null);
  const pcmPlayerRef = useRef<PCMAudioPlayer | null>(null);

  // Voice loop effect
  useEffect(() => {
    isVoiceModeRef.current = isVoiceMode;
    isUltraFastModeRef.current = isUltraFastMode;
    
    // In Ultra-Fast mode, we don't use the normal voice loop (webkitSpeechRecognition)
    // because the Live API handles its own voice activity detection.
    if (isUltraFastMode) {
      if (isListening) setIsListening(false);
      return;
    }

    if (!isVoiceMode || isSpeaking || isLoading || isListening) {
      console.log('Voice loop skipped:', { isVoiceMode, isSpeaking, isLoading, isListening });
      return;
    }

    console.log('Voice loop triggering toggleListening...');
    const timeout = setTimeout(() => {
      if (isVoiceMode && !isSpeaking && !isLoading && !isListening) {
        toggleListening();
      }
    }, 1000);

    return () => clearTimeout(timeout);
  }, [isVoiceMode, isSpeaking, isLoading, isListening]);

  // TTS Synthesis Worker (Producer)
  useEffect(() => {
    const synthesizeNext = async () => {
      if (isSynthesizingRef.current || textQueue.length === 0) return;
      
      isSynthesizingRef.current = true;
      const text = textQueue[0];
      setTextQueue(prev => prev.slice(1));
      
      try {
        console.log('Synthesizing chunk:', text);
        const speechResult = await generateSpeech(text);
        if (speechResult) {
          setAudioQueue(prev => [...prev, speechResult]);
        }
      } catch (err) {
        console.error("Synthesis error:", err);
      } finally {
        isSynthesizingRef.current = false;
        // Check for more text immediately
        synthesizeNext();
      }
    };
    
    synthesizeNext();
  }, [textQueue]);

  // TTS Playback Worker (Consumer)
  useEffect(() => {
    const playNext = async () => {
      if (isPlayingQueueRef.current || audioQueue.length === 0 || isSpeaking) return;
      
      isPlayingQueueRef.current = true;
      const speechResult = audioQueue[0];
      setAudioQueue(prev => prev.slice(1));
      
      setIsSpeaking(true);
      const { data, format } = speechResult;
      let audioUrl = '';
      if (format === 'pcm') {
        const wavBase64 = pcmToWav(data);
        audioUrl = `data:audio/wav;base64,${wavBase64}`;
      } else {
        audioUrl = `data:audio/wav;base64,${data}`;
      }
      
      if (audioRef.current) {
        audioRef.current.src = audioUrl;
        audioRef.current.play().catch(err => {
          console.error("Playback failed:", err);
          setIsSpeaking(false);
          isPlayingQueueRef.current = false;
        });
      } else {
        setIsSpeaking(false);
        isPlayingQueueRef.current = false;
      }
    };
    
    playNext();
  }, [audioQueue, isSpeaking]);

  // Reset isPlayingQueueRef when isSpeaking becomes false
  useEffect(() => {
    if (!isSpeaking) {
      isPlayingQueueRef.current = false;
    }
  }, [isSpeaking]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const lastTranscriptRef = useRef<string>('');

  useEffect(() => {
    // Check for existing session
    const savedUser = localStorage.getItem('lumie_user');
    if (savedUser) {
      const userData = JSON.parse(savedUser);
      setUser(userData);
      setNativeLang(userData.native_lang || 'Russian');
      setTargetLang(userData.target_lang || 'English');
      setProvider(userData.provider || 'gemini');
      setOllamaUrl(userData.ollama_url || 'http://localhost:11434');
      setOllamaModel(userData.ollama_model || 'llama3');
      fetchConversations(userData.id);
      fetchProgress(userData.id);
      
      // Refresh user data from server to get latest name/points/onboarding status
      fetch(`/api/user/${userData.id}`)
        .then(res => res.json())
        .then(data => {
          if (data && !data.error) {
            const cleanUser = cleanUserData(data);
            setUser(cleanUser);
            localStorage.setItem('lumie_user', JSON.stringify(cleanUser));
            
            if (!cleanUser.is_onboarded) {
              setShowOnboarding(true);
            }
          }
        })
        .catch(err => console.error("Failed to refresh user data:", err));
    }

    // Check microphone permission
    if (navigator.permissions && navigator.permissions.query) {
      try {
        navigator.permissions.query({ name: 'microphone' as any }).then(permissionStatus => {
          setMicPermission(permissionStatus.state as any);
          permissionStatus.onchange = () => {
            setMicPermission(permissionStatus.state as any);
          };
        }).catch(err => {
          console.warn("Permissions API query failed:", err);
        });
      } catch (err) {
        console.warn("Permissions API not supported:", err);
      }
    }

    // Setup Speech Recognition
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true; // Keep listening until manually stopped
      recognitionRef.current.interimResults = true; // Get interim results for better UX

      // Set language based on target language
      const langMap: Record<string, string> = {
        'English': 'en-US',
        'Russian': 'ru-RU',
        'Spanish': 'es-ES',
        'French': 'fr-FR',
        'German': 'de-DE',
        'Italian': 'it-IT',
        'Chinese': 'zh-CN',
        'Japanese': 'ja-JP'
      };
      recognitionRef.current.lang = langMap[targetLang] || 'en-US';
      console.log('Speech recognition configured with lang:', recognitionRef.current.lang);

      // Debug: audio capture events
      recognitionRef.current.onaudiostart = () => {
        console.log('Audio capture started - microphone is working');
      };
      recognitionRef.current.onaudioend = () => {
        console.log('Audio capture ended');
      };
      recognitionRef.current.onspeechstart = () => {
        console.log('Speech detected!');
      };
      recognitionRef.current.onspeechend = () => {
        console.log('Speech ended');
      };

      recognitionRef.current.onresult = (event: any) => {
        if (!event.results || event.results.length === 0) {
          console.log('No results in event');
          return;
        }

        const lastResult = event.results[event.results.length - 1];
        if (!lastResult || !lastResult[0]) {
          console.log('Empty result');
          return;
        }

        const transcript = lastResult[0].transcript;
        const isFinal = lastResult.isFinal;

        console.log(`Speech recognition ${isFinal ? 'FINAL' : 'interim'}:`, transcript);

        // Always store the latest transcript
        if (transcript.trim()) {
          lastTranscriptRef.current = transcript;
        }

        if (isFinal && transcript.trim()) {
          setInput(transcript);
          lastTranscriptRef.current = ''; // Clear after final
          setIsListening(false);
          recognitionRef.current?.stop();

          // Auto-send in voice mode, but ONLY if not in Ultra-Fast mode
          if (isVoiceModeRef.current && !isUltraFastModeRef.current) {
            console.log('Voice mode: auto-sending transcript');
            handleSendMessageRef.current(undefined, transcript);
          }
        } else if (transcript) {
          // Show interim results in input field
          setInput(transcript);
        }
      };
      recognitionRef.current.onstart = () => {
        console.log('Speech recognition started - speak now!');
        setIsListening(true);
      };
      recognitionRef.current.onerror = (event: any) => {
        // Network errors often happen when stopping recognition - ignore them
        if (event.error === 'network') {
          console.log('Network event (can be ignored when stopping)');
          return;
        }
        if (event.error === 'aborted') {
          console.log('Recognition aborted');
          return;
        }

        console.error('Speech recognition error:', event.error, event.message);
        if (event.error === 'no-speech') {
          console.log('No speech detected - try speaking louder or check microphone');
        } else if (event.error === 'not-allowed') {
          setAuthError("Microphone access denied. Please allow microphone access in your browser settings to use voice features.");
          setIsVoiceMode(false);
        } else if (event.error === 'audio-capture') {
          setAuthError("No microphone found. Please connect a microphone and try again.");
        }
        setIsListening(false);
      };
      recognitionRef.current.onend = () => {
        console.log('Speech recognition ended');
        setIsListening(false);
      };
    } else {
      setIsSpeechSupported(false);
      console.warn('Speech recognition not supported in this browser');
    }

    const handleAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const userData = event.data.user;
        // Ensure userData is a clean object without DOM elements or circular refs
        const cleanUser = cleanUserData(userData);
        setUser(cleanUser);
        if (cleanUser) {
          localStorage.setItem('lumie_user', JSON.stringify(cleanUser));
          fetchProgress(cleanUser.id);
          
          if (!cleanUser.is_onboarded) {
            setShowOnboarding(true);
          } else {
            fetchConversations(cleanUser.id);
          }
        }
      }
    };
    window.addEventListener('message', handleAuthMessage);
    return () => {
      window.removeEventListener('message', handleAuthMessage);
      liveServiceRef.current?.disconnect();
      pcmPlayerRef.current?.stop();
    };
  }, []);

  const [authError, setAuthError] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const googleInitialized = useRef(false);

  // Handle Google credential response
  const handleGoogleCredential = useCallback(async (credential: string) => {
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential })
      });

      const data = await res.json();

      if (data.error) {
        setAuthError(data.error);
        return;
      }

      const cleanUser = cleanUserData(data);
      setUser(cleanUser);
      if (cleanUser) {
        localStorage.setItem('lumie_user', JSON.stringify(cleanUser));
        fetchProgress(cleanUser.id);

        if (!cleanUser.is_onboarded) {
          setShowOnboarding(true);
        } else {
          fetchConversations(cleanUser.id);
        }
      }
    } catch (err) {
      console.error('Google Sign-In failed:', err);
      setAuthError(t('auth.error.connection'));
    }
  }, [t]);

  // Initialize Google Sign-In
  useEffect(() => {
    const initGoogleSignIn = async () => {
      try {
        const res = await fetch('/api/auth/google-client-id');
        const data = await res.json();

        if (data.demoMode) {
          setIsDemoMode(true);
          return;
        }

        if (data.clientId) {
          setGoogleClientId(data.clientId);
        }
      } catch (err) {
        console.error('Failed to fetch Google Client ID:', err);
        setIsDemoMode(true);
      }
    };

    initGoogleSignIn();
  }, []);

  // Initialize Google button when client ID is available
  useEffect(() => {
    if (!googleClientId || googleInitialized.current) return;

    const waitForGoogle = () => {
      const checkGoogle = setInterval(() => {
        if ((window as any).google?.accounts?.id) {
          clearInterval(checkGoogle);

          (window as any).google.accounts.id.initialize({
            client_id: googleClientId,
            callback: (response: { credential: string }) => {
              if (response.credential) {
                handleGoogleCredential(response.credential);
              }
            },
            auto_select: false
          });

          googleInitialized.current = true;

          // Render button if ref is available
          if (googleButtonRef.current) {
            (window as any).google.accounts.id.renderButton(googleButtonRef.current, {
              theme: 'filled_blue',
              size: 'large',
              type: 'standard',
              text: 'signin_with',
              shape: 'rectangular',
              logo_alignment: 'left',
              width: 280
            });
          }
        }
      }, 100);

      // Timeout after 5 seconds
      setTimeout(() => clearInterval(checkGoogle), 5000);
    };

    waitForGoogle();
  }, [googleClientId, handleGoogleCredential]);

  // Re-render Google button when ref changes and Google is initialized
  useEffect(() => {
    if (googleButtonRef.current && googleInitialized.current && (window as any).google?.accounts?.id) {
      (window as any).google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'filled_blue',
        size: 'large',
        type: 'standard',
        text: 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: 280
      });
    }
  });

  useEffect(() => {
    if (currentConversationId) {
      fetchMessages(currentConversationId);
    } else {
      setMessages([]);
    }
  }, [currentConversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchConversations = async (userId: string) => {
    try {
      const res = await fetch(`/api/conversations/user/${userId}`);
      const data = await res.json();
      setConversations(data);
      // Auto-select most recent conversation if none selected
      if (data.length > 0 && !currentConversationId) {
        setCurrentConversationId(data[0].id);
        fetchMessages(data[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  };

  const fetchProgress = async (userId: string) => {
    const res = await fetch(`/api/user/${userId}/progress`);
    const data = await res.json();
    setCompletedTopics(data);
  };

  const completeTopic = async (topicId: string) => {
    if (!user) return;
    await fetch('/api/user/complete-topic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, topicId })
    });
    setCompletedTopics(prev => [...prev, topicId]);
  };

  const fetchMessages = async (id: string) => {
    const res = await fetch(`/api/conversations/${id}/messages`);
    const data = await res.json();
    setMessages(data);
  };

  const createNewConversation = async () => {
    if (!user) return;
    const id = Math.random().toString(36).substring(7);
    const title = 'New Session';
    try {
      await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, user_id: user.id, title })
      });
      setCurrentConversationId(id);
      setMessages([]); // Clear messages for new session
      setRateLimitError(null); // Clear any previous rate limit error
      greetingAttemptedRef.current = null; // Reset greeting attempt for new conversation
      fetchConversations(user.id);

      // Trigger AI to start the conversation
      setTimeout(() => triggerAiGreeting(id), 500);
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };

  const triggerAiGreeting = async (convId: string) => {
    if (!user || isLoading) return;

    // Prevent multiple greeting attempts for the same conversation
    if (greetingAttemptedRef.current === convId) return;
    greetingAttemptedRef.current = convId;

    setIsLoading(true);
    setIsStreamFinished(false);
    setRateLimitError(null);
    setTextQueue([]);
    setAudioQueue([]);
    lastProcessedIndexRef.current = 0;

    try {
      // Fetch memories for context even for greeting
      const memRes = await fetch('/api/memory/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, embedding: new Array(768).fill(0) }) // Dummy embedding for general search
      });
      const memories = await memRes.json();

      const stream = await generateTutorResponseStream([], user, memories);
      let fullAiText = '';

      const initialAiMsg: Message = {
        conversation_id: convId,
        role: 'assistant',
        content: '',
        type: 'text'
      };
      setMessages([initialAiMsg]);

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          fullAiText += text;
          setMessages(prev => {
            const newMsgs = [...prev];
            if (newMsgs.length > 0 && newMsgs[newMsgs.length - 1].role === 'assistant') {
              newMsgs[newMsgs.length - 1] = {
                ...newMsgs[newMsgs.length - 1],
                content: fullAiText
              };
            }
            return newMsgs;
          });
          processStreamText(fullAiText);
        }
      }

      processStreamText(fullAiText, true);
      setIsStreamFinished(true);

      const finalAiMsg = {
        conversation_id: convId,
        role: 'assistant',
        content: fullAiText,
        type: 'text'
      };

      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalAiMsg)
      });
    } catch (error: any) {
      console.error('Error in triggerAiGreeting:', error);

      // Check for rate limit error (429)
      const errorStr = error?.message || error?.toString() || '';
      if (errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED') || errorStr.includes('quota')) {
        // Extract retry delay if available
        const retryMatch = errorStr.match(/retry in (\d+)/i);
        const retrySeconds = retryMatch ? parseInt(retryMatch[1]) : 60;
        setRateLimitError(t('error.rateLimit', { seconds: retrySeconds }));

        // Show a friendly message to the user
        setMessages([{
          conversation_id: convId,
          role: 'assistant',
          content: `⏳ ${t('error.rateLimitMessage')}`,
          type: 'text'
        }]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (currentConversationId && messages.length === 0 && !isLoading && greetingAttemptedRef.current !== currentConversationId) {
      // If we just opened an empty conversation, let AI speak first
      triggerAiGreeting(currentConversationId);
    }
  }, [currentConversationId, messages.length, isLoading]);

  const toggleUltraFastMode = async () => {
    if (isUltraFastMode) {
      liveServiceRef.current?.disconnect();
      pcmPlayerRef.current?.stop();
      setIsUltraFastMode(false);
      setIsVoiceMode(false);
    } else {
      // Clear normal TTS queues to avoid overlapping voices
      setTextQueue([]);
      setAudioQueue([]);
      setIsSpeaking(false);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }

      setIsUltraFastMode(true);
      setIsVoiceMode(true);

      try {
        // SECURITY: Fetch API key from server instead of using process.env on client
        const [apiKeyRes, memRes] = await Promise.all([
          fetch(`/api/config/live-api-key?userId=${encodeURIComponent(user.id)}`),
          fetch(`/api/memory/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, embedding: new Array(768).fill(0) })
          })
        ]);

        if (!apiKeyRes.ok) {
          const errorData = await apiKeyRes.json();
          throw new Error(errorData.error || 'Failed to get API key');
        }

        const { key: apiKey } = await apiKeyRes.json();
        const memories = await memRes.json();
        const memoryText = memories.map((m: any) => `- ${m.topic}: ${m.summary}`).join('\n');

        const systemPrompt = TUTOR_SYSTEM_INSTRUCTION
          .replace(/{{name}}/g, user?.name || 'Student')
          .replace(/{{native_lang}}/g, nativeLang)
          .replace(/{{target_lang}}/g, targetLang)
          .replace(/{{level}}/g, user?.level || 'beginner')
          .replace(/{{memories}}/g, memoryText || "No memories yet. Ask the user about themselves!");

        if (!liveServiceRef.current) {
          liveServiceRef.current = new GeminiLiveService(apiKey);
        }
        if (!pcmPlayerRef.current) {
          pcmPlayerRef.current = new PCMAudioPlayer(24000);
        }

        await liveServiceRef.current.connect(
          { systemInstruction: systemPrompt },
          {
            onAudioData: (base64) => pcmPlayerRef.current?.playChunk(base64),
            onInterrupted: () => pcmPlayerRef.current?.stop(),
            onTranscription: (text, isFinal, role) => {
              if (isFinal && role === 'model') {
                const aiMsg: Message = {
                  id: Date.now(),
                  conversation_id: currentConversationId || 'temp',
                  role: 'assistant',
                  content: text,
                  type: 'voice',
                  created_at: new Date().toISOString()
                };
                setMessages(prev => {
                  // Avoid duplicate messages if the transcription comes in chunks
                  const last = prev[prev.length - 1];
                  if (last && last.role === 'assistant' && last.content === text) return prev;
                  return [...prev, aiMsg];
                });
              }
            },
            onError: (err: any) => {
              const errorMessage = err instanceof Error ? err.message : String(err);
              console.error("Live API Error:", errorMessage);
              setAuthError(`Live API Error: ${errorMessage}`);
              setIsUltraFastMode(false);
            },
            onClose: () => setIsUltraFastMode(false)
          }
        );
      } catch (err: any) {
        console.error("Failed to start Ultra-Fast mode:", err);
        setAuthError(err.message || "Failed to start Ultra-Fast mode");
        setIsUltraFastMode(false);
        setIsVoiceMode(false);
      }
    }
  };

  const requestMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMicPermission('granted');
      setAuthError(null);
      return true;
    } catch (err: any) {
      console.error("Permission request failed:", err);
      setMicPermission('denied');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setAuthError("Microphone access denied. Please click the lock icon in your browser's address bar and set Microphone to 'Allow'.");
      }
      return false;
    }
  };

  const toggleListening = async () => {
    if (!isSpeechSupported || !recognitionRef.current) {
      console.warn("Speech recognition not supported or not initialized");
      setAuthError("Speech recognition is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    // Request permission if not already granted
    if (micPermission !== 'granted') {
      console.log("Requesting microphone permission...");
      const granted = await requestMicPermission();
      if (!granted) {
        console.warn("Microphone permission not granted");
        return;
      }
    }

    if (isListening) {
      console.log("Stopping speech recognition...");
      // Give a moment for final results to come through, then stop
      setTimeout(() => {
        const pendingTranscript = lastTranscriptRef.current;
        if (pendingTranscript) {
          console.log("Using pending transcript:", pendingTranscript);
          setInput(pendingTranscript);
          lastTranscriptRef.current = '';
        }
        recognitionRef.current?.stop();
      }, 300); // Wait 300ms for results
    } else {
      console.log("Starting speech recognition...");
      console.log("Recognition language:", recognitionRef.current?.lang);
      lastTranscriptRef.current = ''; // Clear any previous transcript
      setIsListening(true);
      try {
        recognitionRef.current.start();
      } catch (err: any) {
        console.error("Failed to start recognition:", err);
        if (err.name === 'NotAllowedError') {
          setMicPermission('denied');
          setAuthError("Microphone access denied. Please allow it in browser settings.");
        } else if (err.name === 'InvalidStateError') {
          // Recognition already started, ignore
          console.log("Recognition already in progress");
        } else {
          setAuthError(`Speech recognition error: ${err.message || err.name}`);
        }
        setIsListening(false);
      }
    }
  };

  const processStreamText = (fullText: string, isFinal = false) => {
    const textToProcess = fullText.substring(lastProcessedIndexRef.current);
    // Regex to find sentences: look for punctuation followed by space or end of string
    const regex = /[^.!?]+[.!?]+(?=\s|$)/g;
    let match;
    let newSentences: string[] = [];
    let currentLastIndex = 0;

    while ((match = regex.exec(textToProcess)) !== null) {
      const sentence = match[0].trim();
      // Filter out junk to avoid 400 error
      if (sentence.length > 1 && /[a-zA-Zа-яА-Я0-9]/.test(sentence)) {
        newSentences.push(sentence);
      }
      currentLastIndex = regex.lastIndex;
    }

    if (isFinal) {
      const remaining = textToProcess.substring(currentLastIndex).trim();
      if (remaining && remaining.length > 1 && /[a-zA-Zа-яА-Я0-9]/.test(remaining)) {
        newSentences.push(remaining);
      }
      lastProcessedIndexRef.current = fullText.length;
    } else {
      lastProcessedIndexRef.current += currentLastIndex;
    }

    if (newSentences.length > 0 && isVoiceMode) {
      console.log('Adding to text queue:', newSentences);
      setTextQueue(prev => [...prev, ...newSentences]);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent, overrideInput?: string) => {
    e?.preventDefault();
    const messageContent = overrideInput || input;
    console.log('handleSendMessage called:', { messageContent, isLoading, isVoiceMode });
    
    if (!messageContent.trim() || isLoading || !user) {
      console.log('handleSendMessage aborted: empty content, loading, or no user');
      return;
    }

    // If we are in Ultra-Fast mode and this was triggered by voice, abort
    // because the Live API handles voice input.
    if (isUltraFastMode && overrideInput) {
      console.log('handleSendMessage aborted: Ultra-Fast mode handles voice input');
      return;
    }

    // Reset TTS queues for new message
    setTextQueue([]);
    setAudioQueue([]);
    lastProcessedIndexRef.current = 0;
    setIsStreamFinished(false);

    let convId = currentConversationId;
    if (!convId) {
      console.log('No current conversation, creating new one...');
      const id = Math.random().toString(36).substring(7);
      try {
        await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, user_id: user.id, title: messageContent.substring(0, 30) })
        });
        convId = id;
        setCurrentConversationId(id);
        fetchConversations(user.id);
      } catch (err) {
        console.error('Failed to create conversation:', err);
        return;
      }
    }

    const userMsg: Message = { conversation_id: convId, role: 'user', content: messageContent, type: 'text' };
    setMessages(prev => [...prev, userMsg]);
    if (!overrideInput) setInput('');
    setIsLoading(true);

    try {
      console.log('Starting parallel tasks (saving message + vector memory search)...');
      
      // 1. Generate embedding for current message
      const embedding = await generateEmbedding(messageContent);

      // 2. Run message saving and memory fetching in parallel
      const [saveRes, memRes] = await Promise.all([
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

      let memories = [];
      try {
        const json = await memRes.json();
        memories = Array.isArray(json) ? json : [];
      } catch (e) {
        console.warn('Failed to parse memories:', e);
      }
      console.log('Retrieved memories:', memories);

      console.log('Generating tutor response stream...');
      const history = messages.concat(userMsg).map(m => ({ role: m.role, content: m.content }));
      
      const stream = await generateTutorResponseStream(history, user, memories);
      console.log('Stream received, starting iteration...');
      
      let fullAiText = '';
      
      // Initial empty AI message
      const initialAiMsg: Message = { 
        conversation_id: convId, 
        role: 'assistant', 
        content: '', 
        type: 'text' 
      };
      setMessages(prev => [...prev, initialAiMsg]);

      try {
        for await (const chunk of stream) {
          const text = chunk.text;
          if (text) {
            fullAiText += text;
            setMessages(prev => {
              const newMsgs = [...prev];
              // Ensure we are updating the correct message (the last one we added)
              if (newMsgs.length > 0 && newMsgs[newMsgs.length - 1].role === 'assistant') {
                newMsgs[newMsgs.length - 1] = { 
                  ...newMsgs[newMsgs.length - 1], 
                  content: fullAiText,
                  type: fullAiText.includes('### Theory') ? 'theory' : 'text'
                };
              }
              return newMsgs;
            });
            
            processStreamText(fullAiText);
          }
        }
        console.log('Stream iteration finished successfully.');
      } catch (streamError) {
        console.error('Error during stream iteration:', streamError);
        setAuthError("Ошибка при получении ответа от AI. Попробуйте еще раз.");
      }

      // Final processing for any remaining text
      processStreamText(fullAiText, true);
      setIsStreamFinished(true);

      const finalAiMsg = { 
        conversation_id: convId, 
        role: 'assistant', 
        content: fullAiText, 
        type: fullAiText.includes('### Theory') ? 'theory' : 'text' 
      };

      // Save final message
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalAiMsg)
      });

      // --- FACT EXTRACTION & MEMORY STORAGE ---
      const facts = await extractFacts(`User: ${messageContent}\nAI: ${fullAiText}`);
      if (facts && facts.length > 0) {
        console.log('Extracted facts to remember:', facts);
        for (const fact of facts) {
          // If we found the user's name, update the user record too
          if ((fact.topic.toLowerCase().includes('name') || fact.topic.toLowerCase().includes('user_name')) && fact.text.length < 50) {
            console.log('Updating user name based on extracted fact:', fact.text);
            fetch('/api/user/onboard', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: user.id, name: fact.text })
            }).then(res => res.json()).then(updated => {
              if (updated && !updated.error) {
                const clean = cleanUserData(updated);
                setUser(clean);
                localStorage.setItem('lumie_user', JSON.stringify(clean));
              }
            });
          }

          const factEmbedding = await generateEmbedding(fact.text);
          await fetch('/api/memory/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, text: fact.text, topic: fact.topic, embedding: factEmbedding })
          });
        }
      }

    } catch (error) {
      console.error('Error in handleSendMessage:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (recognitionRef.current) {
      const langMap: Record<string, string> = {
        'English': 'en-US',
        'Russian': 'ru-RU',
        'Spanish': 'es-ES',
        'French': 'fr-FR',
        'German': 'de-DE',
        'Italian': 'it-IT',
        'Chinese': 'zh-CN',
        'Japanese': 'ja-JP'
      };
      const selectedLang = recognitionLang === 'target' ? targetLang : nativeLang;
      recognitionRef.current.lang = langMap[selectedLang] || (recognitionLang === 'target' ? 'en-US' : 'ru-RU');
    }
  }, [targetLang, nativeLang, recognitionLang]);

  const handleSendMessageRef = useRef(handleSendMessage);
  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  }, [handleSendMessage]);

  const handleOnboardingComplete = async (data: any) => {
    try {
      console.log('Completing onboarding for user:', user.id, data);
      const res = await fetch('/api/user/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, ...data })
      });
      if (!res.ok) throw new Error('Failed to onboard');
      const updatedUser = await res.json();
      
      // Clean user object to prevent circular structure errors
      const cleanUser = {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        native_lang: updatedUser.native_lang,
        target_lang: updatedUser.target_lang,
        level: updatedUser.level,
        points: updatedUser.points,
        streak: updatedUser.streak,
        is_onboarded: updatedUser.is_onboarded,
        age: updatedUser.age,
        gender: updatedUser.gender,
        avatar: updatedUser.avatar
      };

      console.log('Onboarding successful, updated user:', cleanUser);
      setUser(cleanUser);
      localStorage.setItem('lumie_user', JSON.stringify(cleanUser));
      setShowOnboarding(false);
      setNativeLang(cleanUser.native_lang);
      setTargetLang(cleanUser.target_lang);
      fetchConversations(cleanUser.id);
      fetchProgress(cleanUser.id);
      
      // Automatically create first conversation
      const id = Math.random().toString(36).substring(7);
      await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, user_id: cleanUser.id, title: `First Session with ${cleanUser.name}` })
      });
      setCurrentConversationId(id);
      fetchConversations(cleanUser.id);
    } catch (err) {
      console.error('Onboarding failed:', err);
      alert("Something went wrong during onboarding. Please try again.");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('lumie_user');
    setUser(null);
    setMessages([]);
    setConversations([]);
    setCurrentConversationId(null);
    setIsVoiceMode(false);
  };

  const handleDemoLogin = async () => {
    try {
      const res = await fetch('/api/auth/demo');
      const userData = await res.json();
      const cleanUser = cleanUserData(userData);
      setUser(cleanUser);
      if (cleanUser) {
        localStorage.setItem('lumie_user', JSON.stringify(cleanUser));
        fetchProgress(cleanUser.id);

        if (!cleanUser.is_onboarded) {
          setShowOnboarding(true);
        } else {
          fetchConversations(cleanUser.id);
        }
      }
    } catch (err) {
      console.error('Demo login failed:', err);
      setAuthError(t('auth.error.demoFailed'));
    }
  };

  if (showOnboarding) {
    return (
      <Onboarding 
        user={user} 
        onComplete={handleOnboardingComplete} 
        onLogout={handleLogout}
      />
    );
  }

  if (!user) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#FDFCFB]">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white p-12 rounded-[2.5rem] shadow-2xl shadow-orange-900/5 text-center max-w-md w-full border border-orange-100/50"
        >
          <div className="w-20 h-20 bg-[#2D2D2D] rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-xl shadow-black/10">
            <Sparkles className="w-10 h-10 text-orange-200" />
          </div>
          <h1 className="font-serif text-4xl font-bold mb-4 tracking-tight text-[#2D2D2D]">{t('app.name')}</h1>
          <p className="text-black/40 mb-10 text-sm leading-relaxed">
            {t('app.tagline')}. {t('app.subtitle')}
          </p>
          
          {authError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs font-medium">
              {authError}
            </div>
          )}

          {micPermission === 'denied' && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-100 rounded-xl text-amber-700 text-xs font-medium flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center shrink-0">
                  <Mic className="w-4 h-4 text-white" />
                </div>
                <p className="text-left font-bold">
                  Microphone access is blocked!
                </p>
              </div>
              <p className="text-left text-[10px] leading-relaxed opacity-80">
                To fix this: Click the <b>Lock 🔒</b> icon in your browser's address bar (top left) and set <b>Microphone</b> to <b>Allow</b>. Then refresh the page.
              </p>
              <button 
                onClick={requestMicPermission}
                className="mt-1 py-2 px-4 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-all text-[10px] font-bold uppercase tracking-widest"
              >
                Try to Request Again
              </button>
            </div>
          )}

          <div className="space-y-3">
            {/* Custom Google Sign-In Button */}
            <button
              onClick={() => {
                if (googleClientId && !isDemoMode && (window as any).google?.accounts?.id) {
                  // Trigger Google One Tap with fallback
                  (window as any).google.accounts.id.prompt((notification: any) => {
                    // If prompt is not displayed or skipped, fall back to demo
                    if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                      console.log('Google Sign-In not available, using demo mode');
                      handleDemoLogin();
                    }
                  });
                } else {
                  // Fall back to demo mode
                  handleDemoLogin();
                }
              }}
              className="w-full py-4 bg-[#2D2D2D] text-white rounded-2xl font-bold hover:bg-[#3D3D3D] transition-all flex items-center justify-center gap-3 shadow-lg shadow-black/10"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              {t('auth.continueWithGoogle')}
            </button>

            <button
              onClick={handleDemoLogin}
              className="w-full py-4 bg-white text-black border border-black/10 rounded-2xl font-bold hover:bg-black/5 transition-all flex items-center justify-center gap-3"
            >
              {t('auth.tryDemo')}
            </button>

            {/* Hidden Google button for fallback */}
            <div ref={googleButtonRef} className="hidden" />
          </div>
          <p className="mt-6 text-[10px] text-black/30 uppercase tracking-widest font-bold">
            {t('auth.startJourney')}
          </p>
        </motion.div>
      </div>
    );
  }

  const handleSpeak = async (text: string) => {
    setIsSpeaking(true);
    try {
      const speechResult = await generateSpeech(text);
      if (speechResult) {
        const { data, format } = speechResult;
        let audioUrl = '';
        if (format === 'pcm') {
          const wavBase64 = pcmToWav(data);
          audioUrl = `data:audio/wav;base64,${wavBase64}`;
        } else {
          // Assume wav or other direct format from HF
          audioUrl = `data:audio/wav;base64,${data}`;
        }
        
        if (audioRef.current) {
          audioRef.current.src = audioUrl;
          audioRef.current.play().catch(err => {
            console.error("Playback failed:", err instanceof Error ? err.message : String(err));
            setIsSpeaking(false);
          });
        } else {
          setIsSpeaking(false);
        }
      } else {
        setIsSpeaking(false);
      }
    } catch (error) {
      console.error("Speech generation failed:", error);
      setIsSpeaking(false);
    }
  };

  return (
    <div className="flex h-screen bg-white overflow-hidden font-sans text-[#1A1A1A]">
      <audio 
        ref={audioRef} 
        onEnded={() => {
          setIsSpeaking(false);
          if (isVoiceModeRef.current && isStreamFinished && textQueue.length === 0 && audioQueue.length === 0) {
            toggleListening();
          }
        }} 
        onError={(e) => {
          console.error("Audio error occurred");
          setIsSpeaking(false);
        }}
        className="hidden" 
      />
      
      {/* Sidebar - Minimalist */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.aside
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            className="w-72 bg-[#F9FAFB] border-r border-gray-100 flex flex-col z-20"
          >
            <div className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <span className="font-bold text-xl tracking-tight">Lumie</span>
              </div>
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="p-2 hover:bg-gray-200 rounded-full lg:hidden"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-4 space-y-2">
              <button
                onClick={() => setView('chat')}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-semibold text-sm",
                  view === 'chat' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                )}
              >
                <MessageSquare className="w-4 h-4" />
                {t('nav.conversation')}
              </button>
              <button
                onClick={() => setView('curriculum')}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-semibold text-sm",
                  view === 'curriculum' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                )}
              >
                <BookOpen className="w-4 h-4" />
                {t('nav.learningPath')}
              </button>
              <button
                onClick={() => {
                  setIsVoiceMode(true);
                  setIsUltraFastMode(true);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-semibold text-sm",
                  isVoiceMode ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                )}
              >
                <Sparkles className="w-4 h-4" />
                {t('nav.lumieLive')}
              </button>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-semibold text-sm",
                  isSettingsOpen ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                )}
              >
                <Settings className="w-4 h-4" />
                {t('nav.settings')}
              </button>
            </div>

            <div className="p-4 border-t border-gray-100 space-y-3 mt-auto">
              <div className="flex items-center gap-3 p-2 bg-white rounded-2xl border border-gray-100">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden shrink-0 border border-gray-50">
                  {user.avatar ? (
                    <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-gray-400 font-bold text-xs">{user.name.substring(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">{user.name}</div>
                  <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{user.level || 'Beginner'}</div>
                </div>
                <button 
                  onClick={handleLogout}
                  className="p-2 text-gray-300 hover:text-red-500 transition-all"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative bg-white overflow-hidden">
        {selectedTopic ? (
          <LessonView 
            topic={selectedTopic} 
            user={user} 
            onClose={() => setSelectedTopic(null)}
            onComplete={() => {
              completeTopic(selectedTopic.id);
              setSelectedTopic(null);
            }}
            nativeLang={nativeLang}
            targetLang={targetLang}
            onSpeak={handleSpeak}
          />
        ) : (
          <>
            {/* Header - Speak Style */}
        <header className="h-20 flex items-center justify-between px-8 bg-white/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-4">
            {!isSidebarOpen && (
              <button 
                onClick={() => setIsSidebarOpen(true)}
                className="p-2.5 hover:bg-gray-100 rounded-xl transition-all"
              >
                <Menu className="w-6 h-6 text-gray-400" />
              </button>
            )}
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-2xl border border-gray-100">
              <Languages className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-bold text-gray-700">{targetLang}</span>
              <span className="text-gray-300 mx-1">|</span>
              <span className="text-xs font-medium text-gray-400">{nativeLang}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 text-orange-600 rounded-full border border-orange-100">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-[11px] font-bold uppercase tracking-wider">7 Day Streak</span>
            </div>
          </div>
        </header>

        {/* Chat Area - Centered and Clean */}
        {view === 'chat' ? (
          <div className="flex-1 overflow-y-auto p-8 space-y-10 max-w-3xl mx-auto w-full scrollbar-hide">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-8">
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="w-24 h-24 bg-orange-50 rounded-[2.5rem] flex items-center justify-center"
                >
                  <Sparkles className="w-10 h-10 text-orange-500" />
                </motion.div>
                <div className="space-y-3">
                  <h2 className="text-4xl font-bold tracking-tight text-gray-900">{t('chat.greeting', { name: user.name })}</h2>
                  <p className="text-gray-400 text-lg max-w-sm mx-auto">{t('chat.readyToPractice', { language: targetLang })}</p>
                </div>
                <div className="flex flex-wrap justify-center gap-3 max-w-lg">
                  {[
                    t('chat.hints.hello', { language: targetLang }),
                    t('chat.hints.coffeeShop'),
                    t('chat.hints.grammar'),
                    t('chat.hints.joke')
                  ].map(hint => (
                    <button 
                      key={hint}
                      onClick={() => setInput(hint)}
                      className="px-5 py-3 bg-white border border-gray-200 rounded-2xl text-sm font-semibold text-gray-600 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700 transition-all shadow-sm"
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  key={idx}
                  className={cn(
                    "flex flex-col",
                    msg.role === 'user' ? "items-end" : "items-start"
                  )}
                >
                  <div className={cn(
                    "max-w-[85%] px-6 py-4 rounded-[2rem] text-base leading-relaxed shadow-sm",
                    msg.role === 'user' 
                      ? "bg-orange-500 text-white rounded-tr-none font-medium" 
                      : "bg-gray-50 text-gray-800 rounded-tl-none border border-gray-100"
                  )}>
                    <div className="markdown-body">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  </div>
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-3 mt-3 ml-2">
                      <button 
                        onClick={() => handleSpeak(msg.content)}
                        className="p-2.5 bg-white border border-gray-100 rounded-xl hover:bg-gray-50 transition-all text-gray-400 hover:text-orange-500 shadow-sm"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
                      {msg.type === 'theory' && (
                        <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[10px] font-bold uppercase tracking-wider border border-blue-100">
                          <BookOpen className="w-3.5 h-3.5" />
                          Learning Card
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              ))
            )}
            {isLoading && (
              <div className="flex flex-col items-start">
                <div className="flex gap-1.5 items-center px-6 py-5 bg-gray-50 rounded-[2rem] rounded-tl-none border border-gray-100">
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-8 scrollbar-hide">
            <div className="max-w-4xl mx-auto">
              <div className="mb-12">
                <h2 className="text-3xl font-bold mb-2">Learning Path</h2>
                <p className="text-gray-400">Master {targetLang} following the CEFR curriculum.</p>
              </div>

              <div className="space-y-12">
                {CEFR_CURRICULUM.map((level) => (
                  <div key={level.level} className={cn(
                    "relative p-8 rounded-[2.5rem] border-2 transition-all",
                    user.level === level.level ? "bg-orange-50 border-orange-200" : "bg-white border-gray-100 opacity-60"
                  )}>
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-4xl font-black text-orange-500">{level.level}</span>
                          <h3 className="text-2xl font-bold">{level.name}</h3>
                        </div>
                        <p className="text-sm text-gray-500 max-w-lg">{level.description}</p>
                      </div>
                      {user.level === level.level && (
                        <div className="px-4 py-2 bg-orange-500 text-white rounded-full text-xs font-bold uppercase tracking-widest">Current Level</div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {level.topics.map((topic) => {
                        const isCompleted = completedTopics.includes(topic.id);
                        return (
                          <div 
                            key={topic.id}
                            onClick={() => setSelectedTopic(topic)}
                            className={cn(
                              "p-6 rounded-2xl border-2 transition-all flex items-center justify-between group cursor-pointer",
                              isCompleted ? "bg-emerald-50 border-emerald-100" : "bg-white border-gray-100 hover:border-orange-200"
                            )}
                          >
                            <div className="flex items-center gap-4">
                              <div className={cn(
                                "w-12 h-12 rounded-xl flex items-center justify-center transition-all",
                                isCompleted ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-400 group-hover:bg-orange-100 group-hover:text-orange-500"
                              )}>
                                {topic.category === 'grammar' && <BookOpen className="w-6 h-6" />}
                                {topic.category === 'vocabulary' && <Sparkles className="w-6 h-6" />}
                                {topic.category === 'conversation' && <MessageSquare className="w-6 h-6" />}
                              </div>
                              <div>
                                <h4 className="font-bold text-sm mb-0.5">{topic.title}</h4>
                                <p className="text-xs text-gray-400">{topic.description}</p>
                              </div>
                            </div>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                isCompleted ? null : completeTopic(topic.id);
                              }}
                              className={cn(
                                "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                                isCompleted ? "bg-emerald-100 text-emerald-600" : "bg-gray-50 text-gray-300 hover:bg-orange-500 hover:text-white"
                              )}
                            >
                              {isCompleted ? <Check className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Input Area - Speak Style */}
        {view === 'chat' && (
          <div className="p-8 bg-white">
            <form 
              onSubmit={handleSendMessage}
              className="max-w-3xl mx-auto relative flex items-center gap-4"
            >
              <div className="relative flex-1">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={`Message Lumie in ${targetLang}...`}
                  className="w-full bg-gray-50 border border-gray-100 rounded-[2rem] py-5 pl-8 pr-28 text-base focus:ring-4 focus:ring-orange-500/5 focus:bg-white focus:border-orange-200 transition-all outline-none"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={toggleUltraFastMode}
                    className={cn(
                      "w-11 h-11 rounded-full flex items-center justify-center transition-all",
                      isUltraFastMode ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-gray-300 hover:text-indigo-500 hover:bg-indigo-50"
                    )}
                    title="Ultra-Fast Mode"
                  >
                    <Sparkles className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={toggleListening}
                    className={cn(
                      "w-11 h-11 rounded-full flex items-center justify-center transition-all",
                      isListening ? "bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/20" : "text-gray-300 hover:text-orange-500 hover:bg-orange-50"
                    )}
                  >
                    <Mic className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="w-14 h-14 bg-orange-500 text-white rounded-[1.5rem] flex items-center justify-center hover:bg-orange-600 disabled:opacity-20 transition-all shrink-0 shadow-lg shadow-orange-500/20"
              >
                <Send className="w-6 h-6" />
              </button>
            </form>
          </div>
        )}

        {view === 'chat' && (
          <div className="max-w-3xl mx-auto mb-8 w-full px-8 flex items-center justify-between text-[11px] text-gray-400 font-bold uppercase tracking-widest">
            <div className="flex gap-6">
              <span>Shift + Enter for new line</span>
              <span>Lumie can make mistakes</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              System Ready
            </div>
          </div>
        )}
      </>
    )}
  </main>

        {/* Voice Mode Overlay */}
        <AnimatePresence>
          {isVoiceMode && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={cn(
                "fixed inset-0 z-50 flex flex-col items-center justify-center text-white transition-colors duration-500",
                isUltraFastMode ? "bg-indigo-600" : "bg-emerald-500"
              )}
            >
              <button 
                onClick={() => {
                  if (isUltraFastMode) {
                    toggleUltraFastMode();
                  } else {
                    setIsVoiceMode(false);
                  }
                }}
                className="absolute top-8 right-8 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all"
              >
                <X className="w-6 h-6" />
              </button>

              {isUltraFastMode && (
                <div className="absolute top-8 left-8 flex items-center gap-2 px-3 py-1.5 bg-white/20 rounded-full">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Live Mode (Lumie AI)</span>
                </div>
              )}

              <div className="relative mb-12">
                <motion.div 
                  animate={{ scale: isUltraFastMode ? [1, 1.1, 1] : [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: isUltraFastMode ? 1 : 2 }}
                  className="w-32 h-32 bg-white/20 rounded-full flex items-center justify-center"
                >
                  <div className="w-24 h-24 bg-white/30 rounded-full flex items-center justify-center">
                    <div className={cn(
                      "w-16 h-16 bg-white rounded-full flex items-center justify-center",
                      isUltraFastMode ? "text-indigo-600" : "text-emerald-500"
                    )}>
                      {isUltraFastMode ? <Sparkles className="w-8 h-8" /> : (isListening ? <Mic className="w-8 h-8 animate-pulse" /> : <Volume2 className="w-8 h-8" />)}
                    </div>
                  </div>
                </motion.div>
                
                {isListening && (
                  <div className="absolute -inset-4 border-2 border-white/30 rounded-full animate-ping" />
                )}
              </div>

              <div className="h-24 flex flex-col items-center justify-center text-center px-6">
                <h2 className="text-3xl font-serif mb-2">
                  {isUltraFastMode ? "Always Listening" : (isListening ? "I'm listening..." : isSpeaking ? "Lumie is speaking" : isLoading ? "Thinking..." : "Ready to talk")}
                </h2>
                <p className="text-white/60 text-sm max-w-xs">
                  {isUltraFastMode ? "Speak naturally, Lumie will respond instantly" : (isListening ? "Speak clearly in " + (recognitionLang === 'target' ? targetLang : nativeLang) : "Wait for Lumie to respond")}
                </p>
              </div>

              {micPermission === 'denied' && (
                <div className="mt-4 px-6 py-3 bg-red-500/20 border border-red-500/30 rounded-2xl text-white text-xs font-medium flex items-center gap-3 max-w-xs">
                  <Mic className="w-4 h-4 text-red-400 shrink-0" />
                  <p className="text-left">
                    Microphone access is blocked. Please allow access in your browser settings.
                  </p>
                </div>
              )}

              {!isUltraFastMode && (
                <div className="mt-8 flex bg-white/10 p-1 rounded-xl">
                  <button 
                    onClick={() => setRecognitionLang('target')}
                    className={cn(
                      "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                      recognitionLang === 'target' ? "bg-white text-emerald-500" : "text-white hover:bg-white/10"
                    )}
                  >
                    {targetLang}
                  </button>
                  <button 
                    onClick={() => setRecognitionLang('native')}
                    className={cn(
                      "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                      recognitionLang === 'native' ? "bg-white text-emerald-500" : "text-white hover:bg-white/10"
                    )}
                  >
                    {nativeLang}
                  </button>
                </div>
              )}

              <div className="mt-12 h-10 flex items-center justify-center gap-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <motion.div
                    key={i}
                    animate={{ height: isListening || isSpeaking ? [10, 32, 10] : 10 }}
                    transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                    className="w-1.5 bg-white rounded-full"
                  />
                ))}
              </div>
              
              {isSpeaking && (
                <button 
                  onClick={() => {
                    if (audioRef.current) {
                      audioRef.current.pause();
                      setIsSpeaking(false);
                    }
                  }}
                  className="mt-12 px-6 py-2 border border-white/20 rounded-full text-sm font-medium hover:bg-white/10 transition-all"
                >
                  Stop Listening
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {/* Settings Modal */}
        <AnimatePresence>
          {isSettingsOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            >
              <motion.div 
                initial={{ scale: 0.95, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl"
              >
                <div className="flex justify-between items-center mb-6">
                  <h2 className="font-serif text-2xl font-bold">Learning Settings</h2>
                  <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-black/5 rounded-full">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold text-black/40 uppercase tracking-widest mb-2">Native Language</label>
                    <select 
                      value={nativeLang}
                      onChange={(e) => updateLanguages(e.target.value, targetLang)}
                      className="w-full bg-black/5 border-none rounded-xl py-3 px-4 text-sm"
                    >
                      <option>Russian</option>
                      <option>English</option>
                      <option>Spanish</option>
                      <option>French</option>
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-xs font-bold text-black/40 uppercase tracking-widest mb-2">Target Language</label>
                    <select 
                      value={targetLang}
                      onChange={(e) => updateLanguages(nativeLang, e.target.value)}
                      className="w-full bg-black/5 border-none rounded-xl py-3 px-4 text-sm"
                    >
                      <option>English</option>
                      <option>Spanish</option>
                      <option>Chinese</option>
                      <option>German</option>
                      <option>French</option>
                    </select>
                  </div>

                  <div className="pt-4 border-t border-gray-100">
                    <label className="block text-xs font-bold text-black/40 uppercase tracking-widest mb-2">AI Provider</label>
                    <div className="flex gap-2 mb-4">
                      <button 
                        onClick={() => updateProviderSettings('gemini', ollamaUrl, ollamaModel)}
                        className={cn(
                          "flex-1 py-2 rounded-xl text-xs font-bold transition-all",
                          provider === 'gemini' ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-500"
                        )}
                      >
                        Gemini (Cloud)
                      </button>
                      <button 
                        onClick={() => updateProviderSettings('ollama', ollamaUrl, ollamaModel)}
                        className={cn(
                          "flex-1 py-2 rounded-xl text-xs font-bold transition-all",
                          provider === 'ollama' ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-500"
                        )}
                      >
                        Ollama (Local)
                      </button>
                    </div>

                    {provider === 'ollama' && (
                      <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                        <div>
                          <label className="block text-[10px] font-bold text-black/40 uppercase mb-1">Ollama URL</label>
                          <input 
                            type="text"
                            value={ollamaUrl}
                            onChange={(e) => updateProviderSettings('ollama', e.target.value, ollamaModel)}
                            placeholder="http://localhost:11434"
                            className="w-full bg-black/5 border-none rounded-xl py-2 px-4 text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-black/40 uppercase mb-1">Model Name</label>
                          <input 
                            type="text"
                            value={ollamaModel}
                            onChange={(e) => updateProviderSettings('ollama', ollamaUrl, e.target.value)}
                            placeholder="llama3"
                            className="w-full bg-black/5 border-none rounded-xl py-2 px-4 text-xs"
                          />
                        </div>
                        <p className="text-[10px] text-gray-400 italic">
                          Note: Start Ollama with <code className="bg-gray-100 px-1">OLLAMA_ORIGINS="*"</code> to allow connection.
                        </p>
                      </div>
                    )}
                  </div>
                  
                  <button 
                    onClick={() => setIsSettingsOpen(false)}
                    className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-black/90 transition-all"
                  >
                    Save Changes
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
}

function LessonView({ topic, user, onClose, onComplete, nativeLang, targetLang, onSpeak }: { 
  topic: Topic, 
  user: any, 
  onClose: () => void, 
  onComplete: () => void,
  nativeLang: string,
  targetLang: string,
  onSpeak: (text: string) => void
}) {
  const [lessonData, setLessonData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentExercise, setCurrentExercise] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState(0);
  const [isFinished, setIsFinished] = useState(false);

  useEffect(() => {
    const fetchLesson = async () => {
      setIsLoading(true);
      const data = await generateLessonContent(topic, { ...user, native_lang: nativeLang, target_lang: targetLang });
      setLessonData(data);
      setIsLoading(false);
    };
    fetchLesson();
  }, [topic]);

  const handleAnswer = (option: string) => {
    setSelectedOption(option);
    setShowExplanation(true);
    if (option === lessonData.exercises[currentExercise].answer) {
      setScore(s => s + 1);
    }
  };

  const nextExercise = () => {
    if (currentExercise < lessonData.exercises.length - 1) {
      setCurrentExercise(e => e + 1);
      setSelectedOption(null);
      setShowExplanation(false);
    } else {
      setIsFinished(true);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-white">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
          className="w-16 h-16 border-4 border-orange-100 border-t-orange-500 rounded-full mb-6"
        />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Preparing your lesson...</h2>
        <p className="text-gray-400">Lumie is crafting the perfect explanation for you.</p>
      </div>
    );
  }

  if (isFinished) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-white text-center">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-24 h-24 bg-emerald-50 rounded-[2.5rem] flex items-center justify-center mb-8"
        >
          <Check className="w-12 h-12 text-emerald-500" />
        </motion.div>
        <h2 className="text-4xl font-bold text-gray-900 mb-4">Lesson Complete!</h2>
        <p className="text-gray-500 text-lg mb-12 max-w-md">
          Great job! You've mastered <b>{topic.title}</b>. Your score: {score}/{lessonData.exercises.length}
        </p>
        <div className="flex gap-4">
          <button 
            onClick={onClose}
            className="px-8 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all"
          >
            Back to Path
          </button>
          <button 
            onClick={onComplete}
            className="px-8 py-4 bg-orange-500 text-white rounded-2xl font-bold shadow-lg shadow-orange-500/20 hover:bg-orange-600 transition-all"
          >
            Finish & Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Lesson Header */}
      <header className="h-20 flex items-center justify-between px-8 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-4">
          <button 
            onClick={onClose}
            className="p-2.5 hover:bg-gray-100 rounded-xl transition-all text-gray-400"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <div className="text-[10px] font-bold text-orange-500 uppercase tracking-widest mb-0.5">{topic.category}</div>
            <h2 className="text-xl font-bold text-gray-900">{topic.title}</h2>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-full border border-gray-100">
          <div className="w-2 h-2 bg-orange-500 rounded-full" />
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Live Lesson</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8 scrollbar-hide">
        <div className="max-w-3xl mx-auto space-y-12 pb-20">
          {/* Theory Section */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-500">
                <BookOpen className="w-5 h-5" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900">Theory</h3>
            </div>
            <div className="bg-gray-50 rounded-[2.5rem] p-8 border border-gray-100">
              <div className="markdown-body prose prose-orange max-w-none">
                <Markdown>{lessonData.theory}</Markdown>
              </div>
            </div>
          </section>

          {/* Vocabulary Section */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center text-orange-500">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900">Key Vocabulary</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {lessonData.vocabulary.map((item: any, idx: number) => (
                <div key={idx} className="p-6 bg-white border border-gray-100 rounded-2xl flex items-center justify-between group hover:border-orange-200 transition-all shadow-sm">
                  <div>
                    <div className="text-lg font-bold text-gray-900 mb-1">{item.word}</div>
                    <div className="text-sm text-gray-400">{item.translation}</div>
                  </div>
                  <button 
                    onClick={() => onSpeak(item.word)}
                    className="w-10 h-10 bg-gray-50 text-gray-300 rounded-full flex items-center justify-center group-hover:bg-orange-50 group-hover:text-orange-500 transition-all active:scale-95"
                  >
                    <Volume2 className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Examples Section */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-500">
                <Lightbulb className="w-5 h-5" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900">Examples</h3>
            </div>
            <div className="space-y-4">
              {lessonData.examples.map((item: any, idx: number) => (
                <div key={idx} className="p-6 bg-indigo-50/30 border border-indigo-100 rounded-2xl flex items-center justify-between group hover:border-indigo-200 transition-all">
                  <div>
                    <div className="text-lg font-medium text-indigo-900 mb-2 italic">"{item.text}"</div>
                    <div className="text-sm text-indigo-600/70 font-medium">— {item.translation}</div>
                  </div>
                  <button 
                    onClick={() => onSpeak(item.text)}
                    className="w-10 h-10 bg-white/50 text-indigo-300 rounded-full flex items-center justify-center group-hover:bg-white group-hover:text-indigo-500 transition-all active:scale-95 shadow-sm"
                  >
                    <Volume2 className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Exercises Section */}
          <section className="space-y-8 pt-12 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-500">
                  <BrainCircuit className="w-5 h-5" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900">Practice</h3>
              </div>
              <div className="text-sm font-bold text-gray-400 uppercase tracking-widest">
                Exercise {currentExercise + 1} of {lessonData.exercises.length}
              </div>
            </div>

            <div className="bg-white border-2 border-gray-100 rounded-[2.5rem] p-10 shadow-xl shadow-gray-200/20">
              <h4 className="text-xl font-bold text-gray-800 mb-8">{lessonData.exercises[currentExercise].question}</h4>
              <div className="space-y-3">
                {lessonData.exercises[currentExercise].options.map((option: string, idx: number) => (
                  <button
                    key={idx}
                    disabled={showExplanation}
                    onClick={() => handleAnswer(option)}
                    className={cn(
                      "w-full p-5 rounded-2xl text-left font-semibold transition-all border-2",
                      selectedOption === option 
                        ? (option === lessonData.exercises[currentExercise].answer ? "bg-emerald-50 border-emerald-500 text-emerald-700" : "bg-red-50 border-red-500 text-red-700")
                        : (showExplanation && option === lessonData.exercises[currentExercise].answer ? "bg-emerald-50 border-emerald-500 text-emerald-700" : "bg-white border-gray-100 hover:border-orange-200 text-gray-600")
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span>{option}</span>
                      {selectedOption === option && (
                        option === lessonData.exercises[currentExercise].answer ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />
                      )}
                    </div>
                  </button>
                ))}
              </div>

              <AnimatePresence>
                {showExplanation && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="mt-8 p-6 bg-gray-50 rounded-2xl border border-gray-100"
                  >
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Explanation</div>
                    <p className="text-gray-600 text-sm leading-relaxed">{lessonData.exercises[currentExercise].explanation}</p>
                    <button 
                      onClick={nextExercise}
                      className="mt-6 w-full py-4 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-all"
                    >
                      {currentExercise < lessonData.exercises.length - 1 ? "Next Exercise" : "Finish Lesson"}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Onboarding({ user, onComplete, onLogout }: { user: any, onComplete: (data: any) => void, onLogout: () => void }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: user?.name || '',
    age: '',
    gender: '',
    nativeLang: 'Russian',
    targetLang: 'English',
    level: user?.level || 'A1',
    avatar: ''
  });

  const languages = ['Russian', 'English', 'Chinese', 'Japanese', 'Spanish', 'French', 'Portuguese', 'German', 'Italian'];
  const cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const avatars = [
    'https://api.dicebear.com/7.x/big-smile/svg?seed=Felix',
    'https://api.dicebear.com/7.x/big-smile/svg?seed=Anya',
    'https://api.dicebear.com/7.x/big-smile/svg?seed=Max',
    'https://api.dicebear.com/7.x/big-smile/svg?seed=Luna',
    'https://api.dicebear.com/7.x/big-smile/svg?seed=Leo',
    'https://api.dicebear.com/7.x/big-smile/svg?seed=Zoe'
  ];

  const nextStep = () => setStep(s => s + 1);
  const prevStep = () => setStep(s => s - 1);

  return (
    <div className="h-screen flex items-center justify-center bg-white p-6 font-sans">
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-white p-12 rounded-[3rem] border-4 border-gray-100 max-w-xl w-full"
      >
        <div className="flex justify-between items-center mb-12">
          <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden mr-6">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${(step / 5) * 100}%` }}
              className="h-full bg-[#58CC02] rounded-full"
            />
          </div>
          <button onClick={onLogout} className="text-gray-400 hover:text-gray-600 text-sm font-bold uppercase tracking-widest">Exit</button>
        </div>

        {step === 1 && (
          <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
            <h2 className="text-3xl font-bold mb-4 text-[#3C3C3C]">Hi there! I'm Lumie.</h2>
            <p className="text-gray-500 mb-10 text-lg font-medium">What's your name?</p>
            <div className="space-y-8">
              <input 
                type="text" 
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                className="w-full bg-gray-100 border-2 border-gray-200 rounded-2xl py-5 px-8 text-xl font-bold focus:border-[#1CB0F6] outline-none transition-all"
                placeholder="Your name"
              />
              <div className="grid grid-cols-2 gap-6">
                <input 
                  type="number" 
                  value={formData.age}
                  onChange={e => setFormData({...formData, age: e.target.value})}
                  className="w-full bg-gray-100 border-2 border-gray-200 rounded-2xl py-5 px-8 text-xl font-bold focus:border-[#1CB0F6] outline-none transition-all"
                  placeholder="Age"
                />
                <select 
                  value={formData.gender}
                  onChange={e => setFormData({...formData, gender: e.target.value})}
                  className="w-full bg-gray-100 border-2 border-gray-200 rounded-2xl py-5 px-8 text-xl font-bold focus:border-[#1CB0F6] outline-none transition-all appearance-none"
                >
                  <option value="">Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <button 
                disabled={!formData.name || !formData.age || !formData.gender}
                onClick={nextStep}
                className="w-full py-5 bg-[#58CC02] text-white rounded-2xl font-bold text-xl shadow-[0_5px_0_#46A302] hover:translate-y-[-2px] hover:shadow-[0_7px_0_#46A302] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                CONTINUE
              </button>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
            <h2 className="text-3xl font-bold mb-4 text-[#3C3C3C]">Language Settings</h2>
            <p className="text-gray-500 mb-10 text-lg font-medium">What languages should we use?</p>
            <div className="space-y-10">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Native Language</label>
                <div className="grid grid-cols-3 gap-3">
                  {languages.map(lang => (
                    <button
                      key={lang}
                      onClick={() => setFormData({...formData, nativeLang: lang})}
                      className={cn(
                        "py-4 px-2 rounded-2xl text-sm font-bold transition-all border-2",
                        formData.nativeLang === lang ? "bg-[#DDF4FF] border-[#1CB0F6] text-[#1CB0F6]" : "bg-white border-gray-200 hover:bg-gray-50"
                      )}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Language to Practice</label>
                <div className="grid grid-cols-3 gap-3">
                  {languages.map(lang => (
                    <button
                      key={lang}
                      onClick={() => setFormData({...formData, targetLang: lang})}
                      className={cn(
                        "py-4 px-2 rounded-2xl text-sm font-bold transition-all border-2",
                        formData.targetLang === lang ? "bg-[#DDF4FF] border-[#1CB0F6] text-[#1CB0F6]" : "bg-white border-gray-200 hover:bg-gray-50"
                      )}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-4">
                <button onClick={prevStep} className="flex-1 py-5 bg-white border-2 border-gray-200 text-gray-400 rounded-2xl font-bold text-lg hover:bg-gray-50 transition-all">BACK</button>
                <button onClick={nextStep} className="flex-[2] py-5 bg-[#58CC02] text-white rounded-2xl font-bold text-xl shadow-[0_5px_0_#46A302] hover:translate-y-[-2px] hover:shadow-[0_7px_0_#46A302] active:translate-y-[2px] active:shadow-none transition-all">CONTINUE</button>
              </div>
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
            <h2 className="text-3xl font-bold mb-4 text-[#3C3C3C]">What's your level?</h2>
            <p className="text-gray-500 mb-10 text-lg font-medium">Select your current proficiency in {formData.targetLang}.</p>
            <div className="grid grid-cols-2 gap-4 mb-10">
              {cefrLevels.map(lvl => (
                <button
                  key={lvl}
                  onClick={() => setFormData({...formData, level: lvl})}
                  className={cn(
                    "py-6 rounded-2xl text-2xl font-bold transition-all border-2",
                    formData.level === lvl ? "bg-[#DDF4FF] border-[#1CB0F6] text-[#1CB0F6]" : "bg-white border-gray-200 hover:bg-gray-50"
                  )}
                >
                  {lvl}
                </button>
              ))}
            </div>
            <div className="flex gap-4">
              <button onClick={prevStep} className="flex-1 py-5 bg-white border-2 border-gray-200 text-gray-400 rounded-2xl font-bold text-lg hover:bg-gray-50 transition-all">BACK</button>
              <button onClick={nextStep} className="flex-[2] py-5 bg-[#58CC02] text-white rounded-2xl font-bold text-xl shadow-[0_5px_0_#46A302] hover:translate-y-[-2px] hover:shadow-[0_7px_0_#46A302] active:translate-y-[2px] active:shadow-none transition-all">CONTINUE</button>
            </div>
          </motion.div>
        )}

        {step === 4 && (
          <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
            <h2 className="text-3xl font-bold mb-4 text-[#3C3C3C]">Choose an Avatar</h2>
            <p className="text-gray-500 mb-10 text-lg font-medium">Pick a look that represents you!</p>
            <div className="space-y-10">
              <div className="grid grid-cols-3 gap-6">
                {avatars.map(url => (
                  <button
                    key={url}
                    onClick={() => setFormData({...formData, avatar: url})}
                    className={cn(
                      "aspect-square rounded-[2rem] overflow-hidden border-4 transition-all p-2",
                      formData.avatar === url ? "border-[#1CB0F6] bg-[#DDF4FF]" : "border-gray-100 bg-gray-50 hover:bg-gray-100"
                    )}
                  >
                    <img src={url} alt="Avatar" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
              <div className="flex gap-4">
                <button onClick={prevStep} className="flex-1 py-5 bg-white border-2 border-gray-200 text-gray-400 rounded-2xl font-bold text-lg hover:bg-gray-50 transition-all">BACK</button>
                <button onClick={nextStep} className="flex-[2] py-5 bg-[#58CC02] text-white rounded-2xl font-bold text-xl shadow-[0_5px_0_#46A302] hover:translate-y-[-2px] hover:shadow-[0_7px_0_#46A302] active:translate-y-[2px] active:shadow-none transition-all">
                  {formData.avatar ? 'CONTINUE' : 'SKIP'}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {step === 5 && (
          <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="text-center">
            <div className="w-32 h-32 bg-[#DDF4FF] rounded-full flex items-center justify-center mx-auto mb-8 border-4 border-[#1CB0F6]">
              <Check className="w-16 h-16 text-[#1CB0F6]" />
            </div>
            <h2 className="text-3xl font-bold mb-4 text-[#3C3C3C]">You're ready, {formData.name}!</h2>
            <p className="text-gray-500 mb-12 text-lg font-medium">Let's start our first conversation in {formData.targetLang} at level {formData.level}.</p>
            <button 
              onClick={() => onComplete(formData)}
              className="w-full py-6 bg-[#58CC02] text-white rounded-2xl font-bold text-2xl shadow-[0_6px_0_#46A302] hover:translate-y-[-2px] hover:shadow-[0_8px_0_#46A302] active:translate-y-[2px] active:shadow-none transition-all"
            >
              START LEARNING
            </button>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

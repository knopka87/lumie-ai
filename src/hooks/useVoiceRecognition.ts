import { useState, useRef, useCallback, useEffect } from 'react';

interface UseVoiceRecognitionOptions {
  language?: string;
  continuous?: boolean;
  onResult?: (transcript: string) => void;
  onError?: (error: string) => void;
}

interface UseVoiceRecognitionReturn {
  isListening: boolean;
  isSupported: boolean;
  micPermission: 'prompt' | 'granted' | 'denied';
  startListening: () => Promise<void>;
  stopListening: () => void;
  toggleListening: () => Promise<void>;
  requestPermission: () => Promise<boolean>;
  setLanguage: (lang: string) => void;
}

const LANG_MAP: Record<string, string> = {
  'English': 'en-US',
  'Russian': 'ru-RU',
  'Spanish': 'es-ES',
  'French': 'fr-FR',
  'German': 'de-DE',
  'Italian': 'it-IT',
  'Chinese': 'zh-CN',
  'Japanese': 'ja-JP',
  'Portuguese': 'pt-BR',
};

export function useVoiceRecognition(options: UseVoiceRecognitionOptions = {}): UseVoiceRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');

  const recognitionRef = useRef<any>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Initialize speech recognition
  useEffect(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      setIsSupported(false);
      return;
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = options.continuous ?? false;
    recognition.interimResults = false;
    recognition.lang = LANG_MAP[options.language || 'English'] || 'en-US';

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      optionsRef.current.onResult?.(transcript);
      setIsListening(false);
    };

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') {
        // Silently handle no speech - common in voice mode
        console.log('No speech detected');
      } else if (event.error === 'not-allowed') {
        setMicPermission('denied');
        optionsRef.current.onError?.('Microphone access denied');
      } else {
        console.error('Speech recognition error:', event.error);
        optionsRef.current.onError?.(event.error);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, []);

  // Check microphone permission
  useEffect(() => {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' as PermissionName })
        .then(permissionStatus => {
          setMicPermission(permissionStatus.state as any);
          permissionStatus.onchange = () => {
            setMicPermission(permissionStatus.state as any);
          };
        })
        .catch(() => {
          // Permissions API not supported for microphone
        });
    }
  }, []);

  const setLanguage = useCallback((lang: string) => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = LANG_MAP[lang] || 'en-US';
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMicPermission('granted');
      return true;
    } catch (err: any) {
      console.error("Permission request failed:", err);
      setMicPermission('denied');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        optionsRef.current.onError?.('Microphone access denied');
      }
      return false;
    }
  }, []);

  const startListening = useCallback(async () => {
    if (!isSupported || !recognitionRef.current) {
      console.warn("Speech recognition not supported");
      return;
    }

    if (micPermission === 'denied') {
      const granted = await requestPermission();
      if (!granted) return;
    }

    if (isListening) return;

    try {
      recognitionRef.current.start();
    } catch (err: any) {
      console.error("Failed to start recognition:", err);
      if (err.name === 'NotAllowedError') {
        setMicPermission('denied');
        optionsRef.current.onError?.('Microphone access denied');
      }
      setIsListening(false);
    }
  }, [isSupported, micPermission, isListening, requestPermission]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // Ignore stop errors
      }
    }
    setIsListening(false);
  }, [isListening]);

  const toggleListening = useCallback(async () => {
    if (isListening) {
      stopListening();
    } else {
      await startListening();
    }
  }, [isListening, startListening, stopListening]);

  return {
    isListening,
    isSupported,
    micPermission,
    startListening,
    stopListening,
    toggleListening,
    requestPermission,
    setLanguage
  };
}

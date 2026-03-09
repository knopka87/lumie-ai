/**
 * Core application types
 * Replaces all `any` types throughout the codebase
 */

// =============================================================================
// User Types
// =============================================================================

export interface User {
  id: string;
  email?: string;
  name: string;
  native_lang: string;
  target_lang: string;
  level: CEFRLevel;
  points: number;
  streak: number;
  is_onboarded: boolean;
  age?: number;
  gender?: Gender;
  avatar?: string;
  last_active?: string;
  interests?: string;
  weak_topics?: string;
}

export type CEFRLevel =
  | 'A1'
  | 'A2'
  | 'B1'
  | 'B2'
  | 'C1'
  | 'C2'
  | 'beginner'
  | 'intermediate'
  | 'advanced';

export type Gender = 'male' | 'female' | 'other';

export type Language =
  | 'Russian'
  | 'English'
  | 'Spanish'
  | 'French'
  | 'German'
  | 'Italian'
  | 'Chinese'
  | 'Japanese'
  | 'Portuguese';

// =============================================================================
// Message Types
// =============================================================================

export interface Message {
  id?: number;
  conversation_id: string;
  role: MessageRole;
  content: string;
  type: MessageType;
  created_at?: string;
}

export type MessageRole = 'user' | 'assistant';

export type MessageType = 'text' | 'theory' | 'voice';

// =============================================================================
// Conversation Types
// =============================================================================

export interface Conversation {
  id: string;
  user_id?: string;
  title: string;
  created_at: string;
}

// =============================================================================
// Memory Types
// =============================================================================

export interface Memory {
  id: number;
  user_id: string;
  topic: string;
  summary: string;
  embedding?: number[];
  similarity?: number;
  created_at?: string;
}

export interface ExtractedFact {
  topic: string;
  text: string;
}

// =============================================================================
// Curriculum Types
// =============================================================================

export interface Topic {
  id: string;
  title: string;
  description: string;
  category: TopicCategory;
}

export type TopicCategory = 'grammar' | 'vocabulary' | 'conversation';

export interface LevelCurriculum {
  level: string;
  name: string;
  description: string;
  topics: Topic[];
}

// =============================================================================
// Lesson Types
// =============================================================================

export interface LessonData {
  theory: string;
  vocabulary: VocabularyItem[];
  examples: ExampleItem[];
  exercises: Exercise[];
}

export interface VocabularyItem {
  word: string;
  translation: string;
}

export interface ExampleItem {
  text: string;
  translation: string;
}

export interface Exercise {
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

// =============================================================================
// AI Service Types
// =============================================================================

export interface AIMessage {
  role: MessageRole;
  content: string;
}

export interface UserContext {
  id?: string;
  name?: string;
  native_lang?: string;
  target_lang?: string;
  level?: string;
  provider?: AIProvider;
  ollama_url?: string;
  ollama_model?: string;
}

export type AIProvider = 'gemini' | 'ollama';

export interface SpeechResult {
  data: string;
  format: 'pcm' | 'wav';
}

// =============================================================================
// Live Service Types
// =============================================================================

export interface LiveServiceCallbacks {
  onAudioData: (base64Audio: string) => void;
  onInterrupted: () => void;
  onTranscription: (text: string, isFinal: boolean, role: MessageRole) => void;
  onError: (error: Error | string) => void;
  onClose: () => void;
}

export interface LiveServiceConfig {
  systemInstruction: string;
}

// =============================================================================
// API Response Types
// =============================================================================

export interface APIResponse<T = unknown> {
  success?: boolean;
  error?: string;
  data?: T;
}

export interface OnboardingData {
  name: string;
  age?: number;
  gender?: Gender;
  nativeLang: Language;
  targetLang: Language;
  level?: CEFRLevel;
  avatar?: string;
}

// =============================================================================
// Component Props Types
// =============================================================================

export interface LessonViewProps {
  topic: Topic;
  user: User;
  onClose: () => void;
  onComplete: () => void;
  nativeLang: string;
  targetLang: string;
  onSpeak: (text: string) => void;
}

export interface OnboardingProps {
  user: User | null;
  onComplete: (data: OnboardingData) => void;
  onLogout: () => void;
}

// =============================================================================
// Hook Return Types
// =============================================================================

export interface UseAuthReturn {
  user: User | null;
  setUser: (user: User | null) => void;
  authError: string | null;
  setAuthError: (error: string | null) => void;
  isLoading: boolean;
  login: () => Promise<void>;
  loginDemo: () => Promise<void>;
  logout: () => void;
  refreshUser: (userId: string) => Promise<void>;
}

export interface UseTTSReturn {
  isSpeaking: boolean;
  isProcessing: boolean;
  speak: (text: string) => Promise<void>;
  speakImmediate: (text: string) => Promise<void>;
  queueText: (text: string) => void;
  stop: () => void;
  clearQueue: () => void;
  audioRef: React.RefObject<HTMLAudioElement>;
}

export interface UseVoiceRecognitionReturn {
  isListening: boolean;
  isSupported: boolean;
  micPermission: PermissionState;
  startListening: () => Promise<void>;
  stopListening: () => void;
  toggleListening: () => Promise<void>;
  requestPermission: () => Promise<boolean>;
  setLanguage: (lang: string) => void;
}

export type PermissionState = 'prompt' | 'granted' | 'denied';

// =============================================================================
// Utility Types
// =============================================================================

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

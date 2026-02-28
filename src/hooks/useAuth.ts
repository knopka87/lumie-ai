import { useState, useEffect, useCallback, useRef } from 'react';

// Declare google global for TypeScript
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          prompt: (callback?: (notification: { isNotDisplayed: () => boolean; isSkippedMoment: () => boolean }) => void) => void;
          renderButton: (parent: HTMLElement, options: {
            theme?: 'outline' | 'filled_blue' | 'filled_black';
            size?: 'large' | 'medium' | 'small';
            type?: 'standard' | 'icon';
            text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
            shape?: 'rectangular' | 'pill' | 'circle' | 'square';
            logo_alignment?: 'left' | 'center';
            width?: number;
            locale?: string;
          }) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

export interface User {
  id: string;
  email?: string;
  name: string;
  native_lang: string;
  target_lang: string;
  level: string;
  points: number;
  streak: number;
  is_onboarded: boolean;
  age?: number;
  gender?: string;
  avatar?: string;
}

interface UseAuthReturn {
  user: User | null;
  setUser: (user: User | null) => void;
  authError: string | null;
  setAuthError: (error: string | null) => void;
  isLoading: boolean;
  login: () => Promise<void>;
  loginDemo: () => Promise<void>;
  logout: () => void;
  refreshUser: (userId: string) => Promise<void>;
  googleClientId: string | null;
  isDemoMode: boolean;
  renderGoogleButton: (element: HTMLElement | null) => void;
}

const STORAGE_KEY = 'lumie_user';

function cleanUserData(userData: any): User | null {
  if (!userData) return null;
  return {
    id: userData.id,
    email: userData.email,
    name: userData.name,
    native_lang: userData.native_lang || 'Russian',
    target_lang: userData.target_lang || 'English',
    level: userData.level || 'beginner',
    points: userData.points || 0,
    streak: userData.streak || 0,
    is_onboarded: Boolean(userData.is_onboarded),
    age: userData.age,
    gender: userData.gender,
    avatar: userData.avatar
  };
}

export function useAuth(): UseAuthReturn {
  const [user, setUserState] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const googleInitialized = useRef(false);

  const setUser = useCallback((newUser: User | null) => {
    setUserState(newUser);
    if (newUser) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newUser));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const refreshUser = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`/api/user/${userId}`);
      const data = await res.json();
      if (data && !data.error) {
        const cleanUser = cleanUserData(data);
        if (cleanUser) {
          setUser(cleanUser);
        }
      }
    } catch (err) {
      console.error("Failed to refresh user data:", err);
    }
  }, [setUser]);

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
      if (cleanUser) {
        setUser(cleanUser);
      }
    } catch (err) {
      console.error('Google Sign-In failed:', err);
      setAuthError("Failed to sign in with Google. Please try again.");
    }
  }, [setUser]);

  // Initialize Google Sign-In
  useEffect(() => {
    const initGoogleSignIn = async () => {
      try {
        const res = await fetch('/api/auth/google-client-id');
        const data = await res.json();

        if (data.demoMode) {
          setIsDemoMode(true);
          setIsLoading(false);
          return;
        }

        if (data.clientId) {
          setGoogleClientId(data.clientId);

          // Wait for Google script to load
          const waitForGoogle = () => {
            return new Promise<void>((resolve) => {
              if (window.google?.accounts?.id) {
                resolve();
              } else {
                const interval = setInterval(() => {
                  if (window.google?.accounts?.id) {
                    clearInterval(interval);
                    resolve();
                  }
                }, 100);
                // Timeout after 5 seconds
                setTimeout(() => {
                  clearInterval(interval);
                  resolve();
                }, 5000);
              }
            });
          };

          await waitForGoogle();

          if (window.google?.accounts?.id && !googleInitialized.current) {
            googleInitialized.current = true;
            window.google.accounts.id.initialize({
              client_id: data.clientId,
              callback: (response) => {
                if (response.credential) {
                  handleGoogleCredential(response.credential);
                }
              },
              auto_select: false
            });
          }
        }
      } catch (err) {
        console.error('Failed to initialize Google Sign-In:', err);
        setIsDemoMode(true);
      }
      setIsLoading(false);
    };

    // Load saved user first
    const savedUser = localStorage.getItem(STORAGE_KEY);
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setUserState(cleanUserData(userData));
        refreshUser(userData.id);
      } catch (e) {
        console.error('Failed to parse saved user:', e);
      }
    }

    initGoogleSignIn();
  }, [handleGoogleCredential, refreshUser]);

  // Render Google Sign-In button
  const renderGoogleButton = useCallback((element: HTMLElement | null) => {
    if (!element || !googleClientId || !window.google?.accounts?.id) return;

    try {
      window.google.accounts.id.renderButton(element, {
        theme: 'filled_blue',
        size: 'large',
        type: 'standard',
        text: 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: 280
      });
    } catch (err) {
      console.error('Failed to render Google button:', err);
    }
  }, [googleClientId]);

  // Login function - triggers Google One Tap or falls back to demo
  const login = useCallback(async () => {
    setAuthError(null);

    if (isDemoMode || !googleClientId) {
      // Fall back to demo mode
      try {
        const res = await fetch('/api/auth/demo');
        const userData = await res.json();
        const cleanUser = cleanUserData(userData);
        if (cleanUser) {
          setUser(cleanUser);
        }
      } catch (err) {
        setAuthError("Failed to enter demo mode.");
      }
      return;
    }

    // Trigger Google One Tap prompt
    if (window.google?.accounts?.id) {
      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          // User dismissed or One Tap not available - they can use the button
          console.log('Google One Tap not displayed, use the button instead');
        }
      });
    }
  }, [isDemoMode, googleClientId, setUser]);

  const loginDemo = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/demo');
      const userData = await res.json();
      const cleanUser = cleanUserData(userData);
      if (cleanUser) {
        setUser(cleanUser);
      }
    } catch (err) {
      console.error('Demo login failed:', err);
      setAuthError("Failed to enter demo mode.");
    }
  }, [setUser]);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUserState(null);
    // Disable Google auto-select for this user
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
  }, []);

  // Listen for OAuth messages (backwards compatibility)
  useEffect(() => {
    const handleAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const cleanUser = cleanUserData(event.data.user);
        if (cleanUser) {
          setUser(cleanUser);
        }
      }
    };

    window.addEventListener('message', handleAuthMessage);
    return () => window.removeEventListener('message', handleAuthMessage);
  }, [setUser]);

  return {
    user,
    setUser,
    authError,
    setAuthError,
    isLoading,
    login,
    loginDemo,
    logout,
    refreshUser,
    googleClientId,
    isDemoMode,
    renderGoogleButton
  };
}

export { cleanUserData };

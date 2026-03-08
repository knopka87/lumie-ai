import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Suppress benign Vite HMR errors and unhandled rejections related to it
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && (
      event.reason.message?.includes('failed to connect to websocket') ||
      event.reason.message?.includes('WebSocket closed without opened')
    )) {
      event.preventDefault();
      console.warn('Suppressed benign HMR/WebSocket error:', event.reason.message);
    }
  });

  const originalError = console.error;
  console.error = (...args) => {
    if (args[0] && typeof args[0] === 'string' && (
      args[0].includes('[vite] failed to connect to websocket') ||
      args[0].includes('WebSocket closed without opened')
    )) {
      return;
    }
    originalError.apply(console, args);
  };
}

// Global error handler for logging
const handleGlobalError = (error: Error, errorInfo: React.ErrorInfo) => {
  console.error('Application error:', error);
  console.error('Component stack:', errorInfo.componentStack);

  // Here you could send to error tracking service (Sentry, etc.)
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary onError={handleGlobalError}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

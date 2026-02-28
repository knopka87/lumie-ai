import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { t } from '../i18n';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>

            <h1 className="mb-2 text-2xl font-bold text-gray-900">{t('error.title')}</h1>

            <p className="mb-6 text-gray-500">{t('error.description')}</p>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mb-6 text-left">
                <summary className="cursor-pointer text-sm text-gray-400 hover:text-gray-600">
                  {t('error.details')}
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-gray-100 p-4 text-xs text-red-600">
                  {this.state.error.message}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}

            <div className="flex gap-3">
              <button
                onClick={this.handleReset}
                className="flex-1 rounded-xl bg-gray-100 px-4 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-200"
              >
                {t('error.tryAgain')}
              </button>
              <button
                onClick={this.handleReload}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 font-semibold text-white transition-colors hover:bg-orange-600"
              >
                <RefreshCw className="h-4 w-4" />
                {t('error.reload')}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook for error handling in functional components
 */
export function useErrorHandler() {
  const [error, setError] = React.useState<Error | null>(null);

  const handleError = React.useCallback((error: Error) => {
    console.error('Error caught:', error);
    setError(error);
  }, []);

  const resetError = React.useCallback(() => {
    setError(null);
  }, []);

  // Throw error to be caught by ErrorBoundary
  if (error) {
    throw error;
  }

  return { handleError, resetError };
}

/**
 * Wrapper component for async error handling
 */
interface AsyncBoundaryProps {
  children: ReactNode;
  loading?: ReactNode;
  error?: ReactNode;
}

export function AsyncBoundary({ children, loading, error }: AsyncBoundaryProps) {
  return (
    <ErrorBoundary fallback={error}>
      <React.Suspense fallback={loading || <DefaultLoading />}>{children}</React.Suspense>
    </ErrorBoundary>
  );
}

function DefaultLoading() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-100 border-t-orange-500" />
    </div>
  );
}

export default ErrorBoundary;

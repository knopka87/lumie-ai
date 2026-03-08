import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary, useErrorHandler, AsyncBoundary } from '../../components/ErrorBoundary';

// Mock i18n
vi.mock('../../i18n', () => ({
  t: (key: string) => {
    const translations: Record<string, string> = {
      'error.title': 'Something went wrong',
      'error.description': 'An unexpected error occurred. Please try again or reload the page.',
      'error.details': 'Error details',
      'error.tryAgain': 'Try Again',
      'error.reload': 'Reload'
    };
    return translations[key] || key;
  }
}));

// Component that throws an error
function ThrowError({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>No error</div>;
}

// Suppress console.error for cleaner test output
const originalError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalError;
});

describe('ErrorBoundary', () => {
  it('should render children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Test content</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('should render error UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/unexpected error/i)).toBeInTheDocument();
  });

  it('should render custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error UI</div>}>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom error UI')).toBeInTheDocument();
  });

  it('should call onError callback when error occurs', () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('Test error');
  });

  it('should have Try Again button', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    const tryAgainButton = screen.getByText('Try Again');
    expect(tryAgainButton).toBeInTheDocument();
  });

  it('should handle Try Again button click', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    const tryAgainButton = screen.getByText('Try Again');
    // Should not throw when clicked
    expect(() => fireEvent.click(tryAgainButton)).not.toThrow();
  });

  it('should have Reload button', () => {
    // Mock window.location.reload
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true
    });

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    const reloadButton = screen.getByText('Reload');
    expect(reloadButton).toBeInTheDocument();

    fireEvent.click(reloadButton);
    expect(reloadMock).toHaveBeenCalled();
  });

  it('should show error details in development mode', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    // Error details should be visible
    expect(screen.getByText('Error details')).toBeInTheDocument();

    process.env.NODE_ENV = originalEnv;
  });
});

describe('useErrorHandler', () => {
  function TestComponent({ simulateError = false }: { simulateError?: boolean }) {
    const { handleError } = useErrorHandler();

    if (simulateError) {
      handleError(new Error('Simulated error'));
    }

    return <div>Test component</div>;
  }

  it('should provide handleError function', () => {
    render(
      <ErrorBoundary>
        <TestComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('Test component')).toBeInTheDocument();
  });

  it('should trigger error boundary when handleError called', () => {
    render(
      <ErrorBoundary>
        <TestComponent simulateError={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});

describe('AsyncBoundary', () => {
  it('should render children when no error', () => {
    render(
      <AsyncBoundary>
        <div>Async content</div>
      </AsyncBoundary>
    );

    expect(screen.getByText('Async content')).toBeInTheDocument();
  });

  it('should render custom loading fallback', () => {
    // Note: Testing Suspense requires async components
    // This is a basic test to ensure the component renders
    render(
      <AsyncBoundary loading={<div>Loading...</div>}>
        <div>Content</div>
      </AsyncBoundary>
    );

    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('should render custom error fallback', () => {
    render(
      <AsyncBoundary error={<div>Custom error</div>}>
        <ThrowError />
      </AsyncBoundary>
    );

    expect(screen.getByText('Custom error')).toBeInTheDocument();
  });
});

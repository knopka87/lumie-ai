import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCurriculumState } from '../../hooks/useCurriculumState';
import { createMockTopic, createMockLessonData } from '../helpers';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useCurriculumState', () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => []
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useCurriculumState());

    expect(result.current.currentLevel).toBe('A1');
    expect(result.current.selectedTopic).toBeNull();
    expect(result.current.completedTopics).toEqual([]);
    expect(result.current.lessonData).toBeNull();
    expect(result.current.isLoadingLesson).toBe(false);
  });

  it('should have curriculum data', () => {
    const { result } = renderHook(() => useCurriculumState());

    expect(result.current.curriculum).toBeDefined();
    expect(Array.isArray(result.current.curriculum)).toBe(true);
    expect(result.current.curriculum.length).toBeGreaterThan(0);
  });

  it('should set current level', () => {
    const { result } = renderHook(() => useCurriculumState());

    act(() => {
      result.current.setCurrentLevel('B1');
    });

    expect(result.current.currentLevel).toBe('B1');
  });

  it('should select and deselect topic', () => {
    const { result } = renderHook(() => useCurriculumState());
    const topic = createMockTopic();

    act(() => {
      result.current.selectTopic(topic);
    });

    expect(result.current.selectedTopic).toEqual(topic);

    act(() => {
      result.current.selectTopic(null);
    });

    expect(result.current.selectedTopic).toBeNull();
    expect(result.current.lessonData).toBeNull();
  });

  it('should complete a topic without userId (local only)', async () => {
    const { result } = renderHook(() => useCurriculumState());

    await act(async () => {
      await result.current.completeTopic('topic-local-1');
    });

    expect(result.current.completedTopics).toContain('topic-local-1');
  });

  it('should not duplicate completed topics', async () => {
    const { result } = renderHook(() => useCurriculumState());

    await act(async () => {
      await result.current.completeTopic('topic-unique');
    });

    await act(async () => {
      await result.current.completeTopic('topic-unique');
    });

    // Should only have one instance
    expect(result.current.completedTopics.filter(t => t === 'topic-unique').length).toBe(1);
  });

  it('should calculate progress percent', () => {
    const { result } = renderHook(() => useCurriculumState());

    // Get A1 level
    const a1Level = result.current.curriculum.find(l => l.level === 'A1');
    expect(a1Level).toBeDefined();

    // Complete some topics
    const topicsToComplete = a1Level!.topics.slice(0, 5).map(t => t.id);

    act(() => {
      topicsToComplete.forEach(topicId => {
        result.current.completeTopic(topicId);
      });
    });

    const progress = result.current.getProgressPercent('A1');
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThanOrEqual(100);
  });

  it('should check if topic is completed', async () => {
    const { result } = renderHook(() => useCurriculumState());

    expect(result.current.isTopicCompleted('topic-1')).toBe(false);

    await act(async () => {
      await result.current.completeTopic('topic-1');
    });

    expect(result.current.isTopicCompleted('topic-1')).toBe(true);
  });

  it('should get current level data', () => {
    const { result } = renderHook(() => useCurriculumState({
      initialLevel: 'B1'
    }));

    const levelData = result.current.getCurrentLevelData();
    expect(levelData).toBeDefined();
    expect(levelData?.level).toBe('B1');
  });

  it('should get next uncompleted topic', () => {
    const { result } = renderHook(() => useCurriculumState());

    const nextTopic = result.current.getNextTopic();
    expect(nextTopic).toBeDefined();
    expect(nextTopic?.id).toBe('a1_1'); // First A1 topic
  });

  it('should set lesson data', () => {
    const { result } = renderHook(() => useCurriculumState());
    const lessonData = createMockLessonData();

    act(() => {
      result.current.setLessonData(lessonData);
    });

    expect(result.current.lessonData).toEqual(lessonData);
  });

  it('should set loading state', () => {
    const { result } = renderHook(() => useCurriculumState());

    act(() => {
      result.current.setIsLoadingLesson(true);
    });

    expect(result.current.isLoadingLesson).toBe(true);

    act(() => {
      result.current.setIsLoadingLesson(false);
    });

    expect(result.current.isLoadingLesson).toBe(false);
  });

  it('should persist progress to localStorage', async () => {
    const { result } = renderHook(() => useCurriculumState());

    await act(async () => {
      await result.current.completeTopic('topic-1');
    });

    const saved = localStorage.getItem('lumie_progress');
    expect(saved).toBeTruthy();
    expect(JSON.parse(saved!).completedTopics).toContain('topic-1');
  });

  it('should fetch progress from server when userId provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ['topic-1', 'topic-2', 'topic-3']
    });

    const { result } = renderHook(() => useCurriculumState({
      userId: 'test-user-123'
    }));

    await waitFor(() => {
      expect(result.current.completedTopics).toContain('topic-1');
    });
  });
});

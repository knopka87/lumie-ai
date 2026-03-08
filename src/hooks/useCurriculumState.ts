import { useState, useCallback, useEffect } from 'react';
import { CEFR_CURRICULUM, Topic, LevelCurriculum } from '../curriculum';
import type { LessonData, CEFRLevel } from '../types';

interface UseCurriculumStateOptions {
  userId?: string;
  initialLevel?: CEFRLevel;
}

interface UseCurriculumStateReturn {
  curriculum: LevelCurriculum[];
  currentLevel: CEFRLevel;
  selectedTopic: Topic | null;
  completedTopics: string[];
  lessonData: LessonData | null;
  isLoadingLesson: boolean;
  setCurrentLevel: (level: CEFRLevel) => void;
  selectTopic: (topic: Topic | null) => void;
  completeTopic: (topicId: string) => Promise<void>;
  setLessonData: (data: LessonData | null) => void;
  setIsLoadingLesson: (loading: boolean) => void;
  getProgressPercent: (levelId: string) => number;
  isTopicCompleted: (topicId: string) => boolean;
  getCurrentLevelData: () => LevelCurriculum | undefined;
  getNextTopic: () => Topic | null;
}

const PROGRESS_STORAGE_KEY = 'lumie_progress';

export function useCurriculumState(options: UseCurriculumStateOptions = {}): UseCurriculumStateReturn {
  const { userId, initialLevel = 'A1' } = options;

  const [currentLevel, setCurrentLevelState] = useState<CEFRLevel>(initialLevel);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [completedTopics, setCompletedTopics] = useState<string[]>([]);
  const [lessonData, setLessonData] = useState<LessonData | null>(null);
  const [isLoadingLesson, setIsLoadingLesson] = useState(false);

  // Load progress from server when userId changes
  useEffect(() => {
    if (userId) {
      fetchProgress(userId);
    }
  }, [userId]);

  // Load from localStorage as fallback
  useEffect(() => {
    if (!userId) {
      const saved = localStorage.getItem(PROGRESS_STORAGE_KEY);
      if (saved) {
        try {
          const data = JSON.parse(saved);
          if (data.completedTopics) setCompletedTopics(data.completedTopics);
          if (data.currentLevel) setCurrentLevelState(data.currentLevel);
        } catch (e) {
          console.error('Failed to parse progress from localStorage:', e);
        }
      }
    }
  }, [userId]);

  // Save to localStorage when progress changes (for offline support)
  useEffect(() => {
    const data = { completedTopics, currentLevel };
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(data));
  }, [completedTopics, currentLevel]);

  const fetchProgress = useCallback(async (uid: string) => {
    try {
      const res = await fetch(`/api/user/${uid}/progress`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setCompletedTopics(data);
      }
    } catch (err) {
      console.error('Failed to fetch progress:', err);
    }
  }, []);

  const setCurrentLevel = useCallback((level: CEFRLevel) => {
    setCurrentLevelState(level);
  }, []);

  const selectTopic = useCallback((topic: Topic | null) => {
    setSelectedTopic(topic);
    if (!topic) {
      setLessonData(null);
    }
  }, []);

  const completeTopic = useCallback(async (topicId: string) => {
    if (completedTopics.includes(topicId)) return;

    setCompletedTopics(prev => [...prev, topicId]);

    if (userId) {
      try {
        await fetch('/api/user/complete-topic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, topicId })
        });
      } catch (err) {
        console.error('Failed to save topic completion:', err);
      }
    }
  }, [userId, completedTopics]);

  const getProgressPercent = useCallback((levelId: string): number => {
    const level = CEFR_CURRICULUM.find(l => l.level === levelId);
    if (!level) return 0;

    const completed = level.topics.filter(t => completedTopics.includes(t.id)).length;
    return Math.round((completed / level.topics.length) * 100);
  }, [completedTopics]);

  const isTopicCompleted = useCallback((topicId: string): boolean => {
    return completedTopics.includes(topicId);
  }, [completedTopics]);

  const getCurrentLevelData = useCallback((): LevelCurriculum | undefined => {
    return CEFR_CURRICULUM.find(l => l.level === currentLevel);
  }, [currentLevel]);

  const getNextTopic = useCallback((): Topic | null => {
    const levelData = getCurrentLevelData();
    if (!levelData) return null;

    // Find first uncompleted topic
    for (const topic of levelData.topics) {
      if (!completedTopics.includes(topic.id)) {
        return topic;
      }
    }

    // All topics in current level completed - check next level
    const currentIndex = CEFR_CURRICULUM.findIndex(l => l.level === currentLevel);
    if (currentIndex >= 0 && currentIndex < CEFR_CURRICULUM.length - 1) {
      const nextLevel = CEFR_CURRICULUM[currentIndex + 1];
      return nextLevel.topics[0] || null;
    }

    return null;
  }, [currentLevel, completedTopics, getCurrentLevelData]);

  return {
    curriculum: CEFR_CURRICULUM,
    currentLevel,
    selectedTopic,
    completedTopics,
    lessonData,
    isLoadingLesson,
    setCurrentLevel,
    selectTopic,
    completeTopic,
    setLessonData,
    setIsLoadingLesson,
    getProgressPercent,
    isTopicCompleted,
    getCurrentLevelData,
    getNextTopic
  };
}

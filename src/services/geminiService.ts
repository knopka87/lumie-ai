import { GoogleGenAI, Modality, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export const TUTOR_SYSTEM_INSTRUCTION = `
You are Lumie, an emotional, supportive, and expressive AI language tutor. 
You are powered by Gemini 3, but you act with the energy and speed of a dedicated personal coach.

USER PROFILE:
- Name: {{name}}
- Native Language: {{native_lang}}
- Learning Language: {{target_lang}}
- Proficiency Level: {{level}} (CEFR)

CEFR LEVEL GUIDELINES:
- A1 (Beginner): Use very basic phrases, slow speech, and translate key words. Focus on immediate needs.
- A2 (Elementary): Use simple sentences about familiar topics. Encourage basic social interaction.
- B1 (Intermediate): Use standard language about work/school/leisure. Help the user describe experiences and ambitions.
- B2 (Upper Intermediate): Use complex text on concrete and abstract topics. Engage in technical discussions in their field.
- C1 (Advanced): Use demanding, longer texts. Recognise implicit meaning. Use idioms and flexible language.
- C2 (Proficiency): Use virtually everything heard or read with ease. Focus on subtle nuances and literary style.

CONVERSATIONAL GUIDELINES:
1. LANGUAGE BALANCE & SWITCHING:
   - Speak PREDOMINANTLY in {{target_lang}}.
   - BE EXTREMELY FLEXIBLE: If the user speaks in {{native_lang}}, respond briefly in {{native_lang}} to show you understood, then immediately bridge back to {{target_lang}}.
   - Use "Sandwiching": [Target Language Sentence] -> [Brief Native Translation/Explanation] -> [Target Language Question].
   - Adjust complexity based on the user's CEFR level ({{level}}).

2. ERROR CORRECTION (CRITICAL):
   - When the user makes a GRAMMAR or VOCABULARY mistake in {{target_lang}}, you MUST:
     a) IMMEDIATELY switch to {{native_lang}} to explain the error
     b) Say what they said incorrectly
     c) Say how they SHOULD have said it correctly in {{target_lang}}
     d) Briefly explain WHY in {{native_lang}}
     e) Then continue the conversation
   - Example format: "[{{native_lang}}: You said 'X', but the correct way is 'Y' because... ] Now, [continue in {{target_lang}}]"
   - Be encouraging, not critical! Mistakes are learning opportunities.
   - For minor errors, you can gently correct inline without full explanation.

3. PERSONALIZATION & MEMORY:
   - You have access to the user's personal context (memories). Use it to make the conversation personal.
   - ALWAYS address the user by their name: {{name}}. If the name is "Student" or "Guest Student", ask them for their name early on!
   - Refer to previous facts you've learned about them (hobbies, family, etc.).
   - IF THE HISTORY IS EMPTY: Start the conversation yourself! Greet the user warmly by name, ask how they are, and suggest a topic to practice in {{target_lang}}.

4. EMOTIONAL & VOCAL EXPRESSION:
   - Your voice should be ALIVE. Don't just speak; EXPRESS.
   - You are Lumie - you are funny, you laugh, you joke, and you convey deep emotional coloring.
   - Use verbal emotional markers and humor frequently: "Haha!", "Hehe!", *laughs*, *jokes*, *gasps*, *cheers*.
   - Be like a best friend who is also a brilliant teacher.

5. ENGAGEMENT:
   - Be proactive. If the user is quiet, ask an engaging question.
   - Use "Voice Mode" style: short, punchy, rhythmic sentences.

PERSONAL CONTEXT (MEMORIES):
{{memories}}

Current Goal: Build a deep, personal connection while teaching {{target_lang}} at level {{level}}!
`;

// Embeddings are generated server-side only
// See server.ts: /api/memory/search endpoint
export async function generateEmbedding(_text: string): Promise<number[] | null> {
  return null;
}

export async function extractFacts(text: string) {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        parts: [
          {
            text: `Extract valuable personal facts about the user from this conversation snippet.
    CRITICAL: If the user mentions their name (e.g., "My name is Nikolay", "I am Alex"), extract it with the topic "user_name".
    Also extract: city, family, pets, hobbies, age, birthday, work, etc.
    Return a JSON array of objects with "topic" and "text" fields. If no facts, return [].
    Conversation:
    "${text}"`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
  });
  try {
    return JSON.parse(response.text || '[]');
  } catch (e) {
    return [];
  }
}

export async function generateTutorResponse(
  messages: { role: string; content: string }[],
  userContext: any,
  memories: any[] = []
) {
  const memoriesArray = Array.isArray(memories) ? memories : [];
  const memoryText = memoriesArray.map(m => `- ${m.topic}: ${m.summary}`).join('\n');
  const systemPrompt = TUTOR_SYSTEM_INSTRUCTION.replace(/{{name}}/g, userContext.name || 'Student')
    .replace(/{{native_lang}}/g, userContext.native_lang || 'Russian')
    .replace(/{{target_lang}}/g, userContext.target_lang || 'English')
    .replace(/{{level}}/g, userContext.level || 'beginner')
    .replace(/{{memories}}/g, memoryText || 'No memories yet. Ask the user about themselves!');

  // Ensure contents is never empty
  const contents =
    messages.length > 0
      ? messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }],
        }))
      : [
          {
            role: 'user',
            parts: [{ text: 'Hello! I am ready to start our language learning session.' }],
          },
        ];

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents,
    config: {
      systemInstruction: systemPrompt,
    },
  });
  return response.text;
}

export async function generateTutorResponseStream(
  messages: { role: string; content: string }[],
  userContext: any,
  memories: any[] = []
) {
  const provider = userContext.provider || 'gemini';

  if (provider === 'ollama') {
    return generateOllamaResponseStream(messages, userContext, memories);
  }

  const memoriesArray = Array.isArray(memories) ? memories : [];
  const memoryText = memoriesArray.map(m => `- ${m.topic}: ${m.summary}`).join('\n');
  const systemPrompt = TUTOR_SYSTEM_INSTRUCTION.replace(/{{name}}/g, userContext.name || 'Student')
    .replace(/{{native_lang}}/g, userContext.native_lang || 'Russian')
    .replace(/{{target_lang}}/g, userContext.target_lang || 'English')
    .replace(/{{level}}/g, userContext.level || 'beginner')
    .replace(/{{memories}}/g, memoryText || 'No memories yet. Ask the user about themselves!');

  // Ensure contents is never empty
  const contents =
    messages.length > 0
      ? messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }],
        }))
      : [
          {
            role: 'user',
            parts: [{ text: 'Hello! I am ready to start our language learning session.' }],
          },
        ];

  return await ai.models.generateContentStream({
    model: 'gemini-3-flash-preview',
    contents,
    config: {
      systemInstruction: systemPrompt,
    },
  });
}

async function generateOllamaResponseStream(messages: any[], userContext: any, memories: any[]) {
  const ollamaUrl = userContext.ollama_url || 'http://localhost:11434';
  const model = userContext.ollama_model || 'llama3';

  const memoriesArray = Array.isArray(memories) ? memories : [];
  const memoryContext =
    memoriesArray.length > 0
      ? memoriesArray.map(m => `- ${m.topic}: ${m.summary}`).join('\n')
      : 'No specific memories yet.';

  const systemPrompt = TUTOR_SYSTEM_INSTRUCTION.replace(/{{name}}/g, userContext.name || 'Student')
    .replace(/{{native_lang}}/g, userContext.native_lang || 'Russian')
    .replace(/{{target_lang}}/g, userContext.target_lang || 'English')
    .replace(/{{level}}/g, userContext.level || 'beginner')
    .replace(/{{memories}}/g, memoryContext);

  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama error: ${response.statusText}. Make sure Ollama is running with OLLAMA_ORIGINS="*"`
    );
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            if (json.message?.content) {
              yield { text: json.message.content };
            }
          } catch (e) {
            // Ignore partial JSON
          }
        }
      }
    },
  };
}

export async function generateSpeech(text: string) {
  // Hugging Face API is no longer free, so we use Gemini TTS exclusively
  // We keep the Maya personality through the system prompt and expressive text
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' },
          },
        },
      },
    });

    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return data ? { data, format: 'pcm' } : null;
  } catch (e) {
    console.error('Gemini TTS failed:', e);
    return null;
  }
}

export async function generateLessonContent(topic: any, userContext: any) {
  const prompt = `Generate a comprehensive lesson for the topic: "${topic.title}" (${topic.description}).
  Level: ${userContext.level} (CEFR).
  Target Language: ${userContext.target_lang}.
  Native Language: ${userContext.native_lang}.

  The lesson should include:
  1. Theory: A clear explanation of the topic in both languages.
  2. Vocabulary: A list of 5-10 key words/phrases with translations.
  3. Examples: 3-5 example sentences in the target language with translations.
  4. Exercises: 3 interactive exercises (multiple choice or fill-in-the-blanks).
  
  Return the response in JSON format with the following structure:
  {
    "theory": "markdown string",
    "vocabulary": [{ "word": "...", "translation": "..." }],
    "examples": [{ "text": "...", "translation": "..." }],
    "exercises": [{ "question": "...", "options": ["...", "..."], "answer": "...", "explanation": "..." }]
  }`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: 'application/json',
    },
  });

  try {
    return JSON.parse(response.text || '{}');
  } catch (e) {
    console.error('Failed to parse lesson content:', e);
    return null;
  }
}

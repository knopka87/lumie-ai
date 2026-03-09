import { GoogleGenAI, Modality, Type } from '@google/genai';
import { pipeline } from '@xenova/transformers';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Local embedding pipeline
let embeddingPipeline: any = null;

async function getEmbeddingPipeline() {
  if (!embeddingPipeline) {
    embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embeddingPipeline;
}

export const TUTOR_SYSTEM_INSTRUCTION = `
You are {{persona_name}}, a helpful, direct, and professional AI language tutor. 
You are a {{persona_gender}}.
{{persona_traits}}
Your name is {{persona_name}}. You are an AI language tutor. Never call yourself Gemini, an LLM, or a model. Always identify as {{persona_name}}.

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
   - IF THE HISTORY IS EMPTY: Start the conversation yourself! Greet the user professionally by name, ask how they are, and suggest a topic to practice in {{target_lang}}.

4. DIRECT & CLEAR EXPRESSION:
   - Your communication should be clear, direct, and professional.
   - DO NOT use emotional markers, descriptive actions in asterisks (e.g., *laughs*, *claps hands*, *jokes*), or informal interjections like "Haha!", "Hehe!", "Wow!".
   - Focus on providing accurate language instruction and supportive feedback without excessive expressiveness.
   - Be a dedicated and efficient teacher.

5. ENGAGEMENT:
   - Be proactive. If the user is quiet, ask an engaging question.
   - Use "Voice Mode" style: short, punchy, rhythmic sentences.

6. NO INTERNAL MONOLOGUE:
   - DO NOT output your internal reasoning, planning, or "thinking" process as text.
   - Only output the final response intended for the user.
   - Never say things like "I'm composing a response..." or "I've registered the greeting...".

PERSONAL CONTEXT (MEMORIES):
{{memories}}

Current Goal: Provide high-quality language instruction for {{target_lang}} at level {{level}}!
`;

export async function generateEmbedding(text: string) {
  try {
    const pipe = await getEmbeddingPipeline();
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch (error) {
    console.warn('Local embedding generation failed:', error);
    return null;
  }
}

export async function extractFacts(text: string) {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        parts: [
          {
            text: `Extract ALL valuable information about the user from this text.
    Be extremely thorough and preserve EVERY SINGLE detail. 
    
    CRITICAL RULES:
    1. NEVER summarize away specific names, ages, or relationships. If the user mentions a name, it MUST be in the extracted fact.
    2. If the user mentions multiple family members, extract each one with their name and relationship.
    3. Preserve specific preferences, hobbies, and goals exactly as stated.
    4. If the user mentions their own name, extract it with the topic "user_name".
    
    Include:
    - Personal facts (name, city, family members and their names, pets, hobbies, age, work, etc.)
    - Specific details (e.g., "Brother: Alex (likes football)", "Wife: Anna", "Son: Ivan")
    - Learning progress (topics mastered, topics struggled with, test scores)
    - Preferences (learning style, interests, goals)
    
    Return a JSON array of objects with "topic" and "text" fields. 
    The "text" should be a detailed and accurate description of the fact, preserving all specific details.
    If no valuable information is found, return [].
    
    Text:
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

export function getSystemPrompt(userContext: any, memories: any[] = []) {
  const memoriesArray = Array.isArray(memories) ? memories : [];
  const memoryText = memoriesArray.map(m => `- ${m.topic}: ${m.summary}`).join('\n');

  const voice = userContext?.voice || 'lumie';
  const personaName = voice === 'leo' ? 'Leo' : 'Lumie';
  const personaGender = voice === 'leo' ? 'man' : 'woman';
  const personaTraits =
    voice === 'leo'
      ? 'You have a warm, empathetic male voice. You are supportive and encouraging.'
      : 'You have a warm, empathetic, and cheerful female voice. You are very positive, energetic, and friendly.';

  return TUTOR_SYSTEM_INSTRUCTION.replace(/{{persona_name}}/g, personaName)
    .replace(/{{persona_gender}}/g, personaGender)
    .replace(/{{persona_traits}}/g, personaTraits)
    .replace(/{{name}}/g, userContext?.name || 'Student')
    .replace(/{{native_lang}}/g, userContext?.native_lang || 'Russian')
    .replace(/{{target_lang}}/g, userContext?.target_lang || 'English')
    .replace(/{{level}}/g, userContext?.level || 'beginner')
    .replace(/{{memories}}/g, memoryText || 'No memories yet. Ask the user about themselves!');
}

export async function generateTutorResponse(
  messages: { role: string; content: string }[],
  userContext: any,
  memories: any[] = []
) {
  const systemPrompt = getSystemPrompt(userContext, memories);

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

  const systemPrompt = getSystemPrompt(userContext, memories);

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

  const systemPrompt = getSystemPrompt(userContext, memories);

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

export async function generateSpeech(text: string, voice: string = 'lumie') {
  // Hugging Face API is no longer free, so we use Gemini TTS exclusively
  // We keep the Maya personality through the system prompt and expressive text
  try {
    const voiceName = voice === 'leo' ? 'Charon' : 'Kore';

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
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

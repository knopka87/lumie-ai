import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

export interface LiveServiceCallbacks {
  onAudioData: (base64Audio: string) => void;
  onInterrupted: () => void;
  onTranscription: (text: string, isFinal: boolean, role: 'user' | 'model') => void;
  onError: (error: any) => void;
  onClose: () => void;
}

export class PCMAudioPlayer {
  private audioContext: AudioContext | null = null;
  private nextStartTime: number = 0;
  private isPlaying: boolean = false;
  private scheduledSources: AudioBufferSourceNode[] = [];

  constructor(private sampleRate: number = 24000) {}

  private init() {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
      this.nextStartTime = this.audioContext.currentTime;
    }
  }

  playChunk(base64Data: string) {
    this.init();
    if (!this.audioContext) return;

    try {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const pcmData = new Int16Array(bytes.buffer);
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 0x7fff;
      }

      const buffer = this.audioContext.createBuffer(1, floatData.length, this.sampleRate);
      buffer.getChannelData(0).set(floatData);

      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);

      const startTime = Math.max(this.audioContext.currentTime, this.nextStartTime);
      source.start(startTime);
      this.nextStartTime = startTime + buffer.duration;
      this.isPlaying = true;

      // Track source for cleanup
      this.scheduledSources.push(source);
      source.onended = () => {
        const idx = this.scheduledSources.indexOf(source);
        if (idx > -1) this.scheduledSources.splice(idx, 1);
      };
    } catch (err) {
      console.error('Error playing audio chunk:', err);
    }
  }

  stop() {
    // Stop all scheduled sources
    this.scheduledSources.forEach(source => {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {
        // Ignore errors on already stopped sources
      }
    });
    this.scheduledSources = [];

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.nextStartTime = 0;
    this.isPlaying = false;
  }
}

/**
 * Audio Recorder using AudioWorklet (modern) or ScriptProcessor (fallback)
 * Handles microphone input and converts to base64 PCM for Gemini Live API
 */
class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private onAudioData: ((base64: string) => void) | null = null;
  private useWorklet: boolean = false;

  constructor(private sampleRate: number = 16000) {}

  async start(onAudioData: (base64: string) => void): Promise<void> {
    this.onAudioData = onAudioData;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
      this.source = this.audioContext.createMediaStreamSource(this.stream);

      // Try AudioWorklet first (modern approach, no memory leaks)
      if (this.audioContext.audioWorklet) {
        try {
          await this.setupWorklet();
          this.useWorklet = true;
          return;
        } catch (e) {
          console.warn('AudioWorklet not available, falling back to ScriptProcessor:', e);
        }
      }

      // Fallback to ScriptProcessor (deprecated but widely supported)
      this.setupScriptProcessor();
    } catch (err: any) {
      console.error('Failed to start recording:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error(
          'Microphone access denied. Please allow microphone access in your browser settings.'
        );
      }
      throw err;
    }
  }

  private async setupWorklet(): Promise<void> {
    if (!this.audioContext || !this.source) return;

    // Create worklet processor inline using Blob
    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.bufferSize = 4096;
          this.buffer = new Float32Array(this.bufferSize);
          this.bufferIndex = 0;
        }

        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (!input || !input[0]) return true;

          const inputChannel = input[0];

          for (let i = 0; i < inputChannel.length; i++) {
            this.buffer[this.bufferIndex++] = inputChannel[i];

            if (this.bufferIndex >= this.bufferSize) {
              // Convert to Int16 PCM
              const pcmData = new Int16Array(this.bufferSize);
              for (let j = 0; j < this.bufferSize; j++) {
                pcmData[j] = Math.max(-1, Math.min(1, this.buffer[j])) * 0x7FFF;
              }

              this.port.postMessage(pcmData.buffer, [pcmData.buffer]);
              this.buffer = new Float32Array(this.bufferSize);
              this.bufferIndex = 0;
            }
          }

          return true;
        }
      }

      registerProcessor('pcm-processor', PCMProcessor);
    `;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);

    try {
      await this.audioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor');

      this.workletNode.port.onmessage = event => {
        if (this.onAudioData) {
          const pcmBuffer = event.data as ArrayBuffer;
          const base64 = this.arrayBufferToBase64(pcmBuffer);
          this.onAudioData(base64);
        }
      };

      this.source.connect(this.workletNode);
      // Don't connect to destination - we don't want to hear ourselves
    } catch (e) {
      URL.revokeObjectURL(workletUrl);
      throw e;
    }
  }

  private setupScriptProcessor(): void {
    if (!this.audioContext || !this.source) return;

    // ScriptProcessor is deprecated but still works
    // Using larger buffer size to reduce CPU usage
    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.scriptProcessor.onaudioprocess = e => {
      if (!this.onAudioData) return;

      const inputData = e.inputBuffer.getChannelData(0);

      // Convert Float32 to Int16 PCM
      const pcmData = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7fff;
      }

      const base64 = this.arrayBufferToBase64(pcmData.buffer);
      this.onAudioData(base64);
    };

    this.source.connect(this.scriptProcessor);
    // Connect to destination to keep the processor alive
    // Create a silent gain node to prevent audio feedback
    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;
    this.scriptProcessor.connect(silentGain);
    silentGain.connect(this.audioContext.destination);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
  }

  stop(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.port.close();
      this.workletNode = null;
    }

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.onAudioData = null;
  }
}

export class GeminiLiveService {
  private ai: GoogleGenAI;
  private session: any = null;
  private recorder: AudioRecorder | null = null;
  private isConnected: boolean = false;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async connect(
    config: { systemInstruction: string },
    callbacks: LiveServiceCallbacks
  ): Promise<void> {
    if (this.isConnected) {
      console.warn('Already connected, disconnecting first');
      this.disconnect();
    }

    try {
      this.session = await this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
          },
          systemInstruction: config.systemInstruction,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: async () => {
            this.isConnected = true;
            try {
              await this.startRecording();
            } catch (err) {
              callbacks.onError(err);
            }
          },
          onmessage: (message: LiveServerMessage) => {
            // Handle Audio
            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              callbacks.onAudioData(audioData);
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              callbacks.onInterrupted();
            }

            // Handle Model Transcription
            const modelTranscription = message.serverContent?.modelTurn?.parts?.find(
              p => p.text
            )?.text;
            if (modelTranscription) {
              callbacks.onTranscription(modelTranscription, true, 'model');
            }

            // Handle User Transcription (if available)
            const userTranscription = (message as any).serverContent?.inputTranscription?.text;
            if (userTranscription) {
              callbacks.onTranscription(userTranscription, true, 'user');
            }
          },
          onerror: err => {
            console.error('Gemini Live error:', err);
            callbacks.onError(err);
          },
          onclose: () => {
            this.isConnected = false;
            callbacks.onClose();
          },
        },
      });
    } catch (err) {
      this.isConnected = false;
      callbacks.onError(err);
    }
  }

  private async startRecording(): Promise<void> {
    this.recorder = new AudioRecorder(16000);

    await this.recorder.start(base64Data => {
      if (this.session && this.isConnected) {
        try {
          this.session.sendRealtimeInput({
            media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' },
          });
        } catch (err) {
          console.error('Error sending audio data:', err);
        }
      }
    });
  }

  disconnect(): void {
    this.isConnected = false;

    if (this.recorder) {
      this.recorder.stop();
      this.recorder = null;
    }

    if (this.session) {
      try {
        this.session.close();
      } catch (e) {
        console.warn('Error closing session:', e);
      }
      this.session = null;
    }
  }
}

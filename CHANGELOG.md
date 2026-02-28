# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-01

### Added
- AI language tutor powered by Google Gemini
- Voice conversation with real-time speech recognition
- Ultra-Fast mode via Gemini Live API
- Personalized learning with memory system (vector search)
- CEFR curriculum with 250+ topics (A1-C2)
- Google Sign-In authentication
- Multi-language UI support (Russian/English)
- Error correction on user's native language
- Text-to-Speech with Gemini TTS
- Database migrations system
- 126 unit/integration tests
- CI/CD with GitHub Actions (Tests, Lint, Build)

### Security
- XSS protection in OAuth callback
- Open redirect prevention with origin whitelist
- Input validation on all API endpoints
- Rate limiting for API key endpoint
- Server-side only embedding generation

### Technical
- React + TypeScript + Vite frontend
- Express.js + SQLite backend
- Custom React hooks (useAuth, useTTS, useVoiceRecognition, useMessages)
- sqlite-vss for vector search (with JS fallback for Windows)
- i18n localization system
- ESLint + Prettier configured

---

For detailed development history, see [DEVLOG.md](DEVLOG.md).

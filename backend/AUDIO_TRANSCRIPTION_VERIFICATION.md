Superseded: audio now uses the `audio` role (see docs/llm-endpoints.md).

# Audio transcription verification

Local investigation on 2026-11-01. No deployment, database settings, stored user
recordings, or production configuration were changed. Live requests contained
only generated speech and used the existing environment credentials.

## Application contract

`frontend/app/support/SupportClient.tsx` prefers WebM/Opus, MP4, then Ogg/Opus
for MediaRecorder. It submits the recorder MIME type, including codec parameters.
`src/api/feedback.py` accepts audio/webm, audio/ogg, audio/mp4, audio/wav,
audio/x-wav, and audio/mpeg. It preserves that MIME type with the recording.

The previous Google adapter forwarded the recording and its MIME type. The
replacement initially only forwarded WAV and MP3, silently skipping the browser
formats and codec-qualified MIME types. The follow-up restores all upload formats
and normalizes MIME parameters for gateway requests without changing stored audio.

OpenRouter's [audio documentation](https://openrouter.ai/docs/guides/overview/multimodal/audio)
distinguishes the WAV/MP3-only Responses API from Chat Completions, which accepts
provider-supported format strings. This application uses Chat Completions.
That API contract does not prove a particular gateway or model handles audio.

## Live evidence and blocker

`scripts/probe_gemini_audio.py --live` generates the spoken sentence
"The purple elephant lost seven blue umbrellas." using espeak-ng, then encodes
it as WAV, MP3, WebM/Opus, Ogg/Opus, and MP4/AAC using ffmpeg. The request prompt
does not contain the expected transcript. Validation checks five distinctive
words in the returned text, rather than treating HTTP 200 as success.

- OmniRoute, gemini-3.8-flash-tiered: all five formats returned text that failed
  transcript validation. A separate WAV request returned unrelated prose about
  relations with the French after Waterloo. This establishes a correctness
  failure on the tested route; it does not establish where audio was lost.
- OpenRouter, google/gemini-3.8-flash: all five formats returned HTTP 402.
  Audio decoding and transcript correctness could not be verified on this route.

OmniRoute is therefore disabled for audio in `_transcription_chain`; configured
text and structured-output routing are unaffected. Audio requests can use the
independent OpenRouter fallback. Default free-tier transcription already uses
OpenRouter. If it also fails, transcription returns None with a safe warning,
and the stored recording remains available. **Successful live transcription is
still blocked.** Resolve the OpenRouter 402 and rerun the probe before claiming
that support transcription works end to end. Re-enable OmniRoute audio only
after its gateway passes speech probes for the browser formats.

Empty or non-text responses now fail validation and allow fallback. Unsupported
or empty recordings produce a warning instead of being silently skipped.
Gateway error bodies, API keys, and audio payloads are excluded from failure logs.
The API still represents an unavailable transcript as null; this change adds no
frontend status or database field.

## Reproduction

From backend, run `.venv/bin/python scripts/probe_gemini_audio.py --live`.
The script requires local espeak-ng and ffmpeg, bypasses proxy variables only
inside its own process, touches no database, and exits nonzero on failed or
unverified routes. It emits route/model/format outcomes without credentials or
transcripts. These command-line tools are diagnostic dependencies only; the
application does not transcode audio or need new runtime dependencies.

Offline tests use the real LangChain/OpenAI serialization with HTTP mock
transports, plus SQLite-backed support upload and enrichment tests. They verify
all accepted MIME types, codec parameters, payload preservation, route fallback,
safe failures including HTTP 402, rejection of unverified OmniRoute audio, and
persistence of successful transcripts without losing recordings on failure.
Mock tests establish application behavior, not live provider audio capability.

Final local validation: the complete backend suite passed, 196 tests. Pytest
reported one RuntimeWarning about an unawaited AsyncMock in the existing
test_retailor_resume_success test. `git diff --check` and Python compilation of
the changed transcription service, probe, and focused tests passed.

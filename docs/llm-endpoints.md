# LLM endpoints & routing

Configure OpenAI-compatible endpoints in **Admin → LLM Endpoints**. Any server
that speaks the OpenAI Chat Completions API works.

## Concepts

- **Endpoints** — a base URL, one bearer token, model catalog, timeout, retries,
  default temperature, and extra headers/body flags.
- **Roles** — `default`, `pro`, `utility`, `audio`. Each role holds an ordered
  list of up to 3 `(endpoint, model)` targets; fallback order is list order.
- **Inheritance** — `pro` and `utility` inherit from `default` when empty.
  `audio` never inherits; when empty, transcription is skipped.
- **Cooldown** — a target returning 401/403/429 cools its endpoint for 60s.
  Cooling targets are skipped unless every target is cooling.
- **Structured output** — per endpoint: `json_schema`, `json_object`, or
  `prompt_only`. Vendor flags go in the endpoint's `extra_body`.

## Bootstrap

With no endpoints in the DB, `LLM_BOOTSTRAP_BASE_URL` + `LLM_BOOTSTRAP_MODEL`
seed one endpoint and assign it to `default`. It never overwrites existing
config. The backend starts without any LLM config (generations fail with
"not configured" until you add an endpoint).

## Secrets

Tokens are Fernet-encrypted at rest. Set `LLM_SECRET_KEY` (a Fernet key); if
unset it is derived from `JWT_SECRET`. Rotating the active secret makes stored
tokens undecryptable — re-enter them in the UI. Nothing crashes.

## Deploy runbook

1. Before/with deploy, set `LLM_BOOTSTRAP_BASE_URL`, `LLM_BOOTSTRAP_API_KEY`,
   `LLM_BOOTSTRAP_MODEL` in the EC2 `backend/.env` (or configure in the admin
   UI right after deploy). Without this, generation stops until configured.
2. Recommend setting `LLM_SECRET_KEY` in production.
3. Remove obsolete `OPENROUTER_*`, `PRO_MODEL_*`, `FREE_MODEL_*`, `CEREBRAS_*`,
   `GROQ_*`, `GOOGLE_API_KEYS` lines from deployed env files (harmless due to
   `extra="ignore"`, but tidy).
4. Historical node metrics keep old provider strings; no backfill needed.

-- Chat surfaces address models; CLIs are connections managed in Settings.
-- Backfill model defaults and candidate lists for existing profiles that
-- predate model-first providers (seeded rows kept NULL models).
UPDATE provider_profiles
SET model = 'gpt-5.4-codex',
    config_json = json_set(
      COALESCE(config_json, '{}'),
      '$.candidateModels',
      json_array('gpt-5.4-codex', 'gpt-5.4', 'gpt-5.4-mini')
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'codex'
  AND COALESCE(model, '') = '';

UPDATE provider_profiles
SET model = 'claude-sonnet-4-6',
    config_json = json_set(
      COALESCE(config_json, '{}'),
      '$.candidateModels',
      json_array('claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-6')
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'claude'
  AND COALESCE(model, '') = '';

UPDATE provider_profiles
SET model = 'grok-4',
    config_json = json_set(
      COALESCE(config_json, '{}'),
      '$.candidateModels',
      json_array('grok-4', 'grok-4-fast', 'grok-code-fast-1')
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'grok'
  AND COALESCE(model, '') = '';

UPDATE provider_profiles
SET config_json = json_set(
      COALESCE(config_json, '{}'),
      '$.candidateModels',
      json_array('gpt-5.4', 'gpt-5.4-mini')
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'openai'
  AND NOT json_extract(COALESCE(config_json, '{}'), '$.candidateModels') IS NOT NULL;

UPDATE provider_profiles
SET config_json = json_set(
      COALESCE(config_json, '{}'),
      '$.candidateModels',
      json_array('claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-6')
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'anthropic'
  AND NOT json_extract(COALESCE(config_json, '{}'), '$.candidateModels') IS NOT NULL;

UPDATE provider_profiles
SET config_json = json_set(
      COALESCE(config_json, '{}'),
      '$.candidateModels',
      json_array('grok-4', 'grok-4-fast')
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'xai'
  AND NOT json_extract(COALESCE(config_json, '{}'), '$.candidateModels') IS NOT NULL;

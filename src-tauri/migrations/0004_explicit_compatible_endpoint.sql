UPDATE provider_profiles
SET base_url = NULL
WHERE id = 'compatible'
  AND base_url = 'http://127.0.0.1:11434/v1'
  AND model IS NULL;

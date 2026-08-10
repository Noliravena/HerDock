UPDATE provider_profiles
SET display_name = 'Grok Build CLI', updated_at = CURRENT_TIMESTAMP
WHERE id = 'grok' AND display_name = 'Grok CLI';

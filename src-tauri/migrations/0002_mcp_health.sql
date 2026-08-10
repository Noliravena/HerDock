ALTER TABLE mcp_servers ADD COLUMN status TEXT;
ALTER TABLE mcp_servers ADD COLUMN tools_json TEXT NOT NULL DEFAULT '[]';

import { existsSync, readFileSync } from 'node:fs';

/**
 * Minimal .env reader. Lead Atlas stays dependency-free, so this covers the
 * subset a local setup file needs: KEY=value, quoted values, comments, blank
 * lines, and an optional `export ` prefix. Existing environment variables win.
 */
export function parseEnvFile(source = '') {
  const values = {};
  for (const rawLine of String(source).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
      if (match[2].trim().startsWith('"')) {
        value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
      }
    } else {
      const commentAt = value.indexOf(' #');
      if (commentAt >= 0) value = value.slice(0, commentAt).trim();
    }
    values[key] = value;
  }
  return values;
}

export function loadEnvFile(filePath, env = process.env) {
  if (!filePath || !existsSync(filePath)) return {};
  let source = '';
  try {
    source = readFileSync(filePath, 'utf8');
  } catch {
    return {};
  }

  const values = parseEnvFile(source);
  for (const [key, value] of Object.entries(values)) {
    if (env[key] === undefined) env[key] = value;
  }
  return values;
}

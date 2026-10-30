import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, 'prompts');

// Resolve a prompt name (with or without .md) to an absolute file path.
function resolvePath(name) {
  const base = name.endsWith('.md') ? name : `${name}.md`;
  return isAbsolute(base) ? base : join(PROMPTS_DIR, base);
}

// Load a prompt template by name. Returns '' if the file is missing (never throws).
export function loadPrompt(name) {
  try {
    return readFileSync(resolvePath(name), 'utf8');
  } catch {
    return '';
  }
}

// Replace {{key}} placeholders with values from vars.
// Object/array values are JSON.stringified; primitives are stringified directly.
// Unknown placeholders are left as-is.
export function fillTemplate(template, vars) {
  if (!template) return '';
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return match;
    const v = vars[key];
    return typeof v === 'string' ? v : JSON.stringify(v);
  });
}

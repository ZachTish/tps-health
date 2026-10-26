import { getFrontMatterInfo, parseYaml } from 'obsidian';
import { needsDailyNutritionUpdate } from './daily-nutrition-rollup';

/** Patch only selected scalar properties. Preserve all other YAML and body bytes. */
export function dailyNutritionSource(source: string, values: Record<string, number | null>): string {
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const raw = source.slice(bom.length);
  const info = getFrontMatterInfo(raw);
  const fields = info.exists ? parseYaml(info.frontmatter) : {};
  if (fields != null && (typeof fields !== 'object' || Array.isArray(fields))) throw new Error('Daily note properties are not a mapping.');
  for (const key of Object.keys(values)) {
    if (Object.keys(fields || {}).some(actual => actual !== key && actual.toLowerCase() === key.toLowerCase())) {
      throw new Error(`Daily property has conflicting capitalization: ${key}`);
    }
  }
  if (!needsDailyNutritionUpdate(fields || {}, values)) return source;
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  if (!info.exists) {
    if (/^---(?:\s|$)/.test(raw)) throw new Error('Daily note properties are incomplete.');
    const lines = Object.entries(values).filter(([, value]) => value != null).map(([key, value]) => `${key}: ${value}`);
    return lines.length ? bom + '---' + newline + lines.join(newline) + newline + '---' + newline + raw : source;
  }
  let yaml = info.frontmatter;
  for (const [key, value] of Object.entries(values)) {
    if (!needsDailyNutritionUpdate(fields || {}, {[key]: value})) continue;
    const pattern = new RegExp(`^(?:${key}|"${key}"|'${key}'):[^\\r\\n]*(?:\\r?\\n|$)`, 'gm');
    const matches = [...yaml.matchAll(pattern)];
    if (Object.prototype.hasOwnProperty.call(fields || {}, key) && matches.length !== 1) throw new Error(`Cannot safely update daily property: ${key}`);
    if (matches.length > 1 || (fields?.[key] != null && typeof fields[key] === 'object')) throw new Error(`Daily property must be a single number: ${key}`);
    if (matches.length) {
      const match = matches[0];
      // Refuse block scalars/continuations rather than deleting user-authored content.
      if (/^[^:]+:\s*[>|]/.test(match[0]) || /^[ \t]+\S/.test(yaml.slice(match.index! + match[0].length))) throw new Error(`Cannot safely update multiline daily property: ${key}`);
      const ending = match[0].endsWith('\r\n') ? '\r\n' : match[0].endsWith('\n') ? '\n' : '';
      const comment = match[0].match(/\s+#[^\r\n]*/)?.[0] || '';
      yaml = yaml.slice(0, match.index) + `${key}: ${value == null ? 'null' : value}${comment}${ending}` + yaml.slice(match.index! + match[0].length);
    } else if (value != null) yaml += (yaml && !yaml.endsWith('\n') ? newline : '') + `${key}: ${value}${newline}`;
  }
  // Locate the original YAML span; keep its delimiters and the entire body intact.
  const start = raw.indexOf('\n') + 1;
  return bom + raw.slice(0, start) + yaml + (yaml.endsWith('\n') ? '' : newline) + raw.slice(start + info.frontmatter.length).replace(/^\r?\n/, '');
}

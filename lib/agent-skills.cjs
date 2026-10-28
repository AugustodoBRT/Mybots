const { readdirSync, readFileSync, realpathSync, statSync } = require('node:fs');
const { homedir } = require('node:os');
const { join, resolve, sep } = require('node:path');

// Agent Skills (a folder with SKILL.md, in the format of Claude Code and Codex). They reach every IA the same way:
// the MyBots lists the ones turned on for a bot in its instructions, and the IA reads SKILL.md itself.
const ROOTS = ['.agents/skills', '.claude/skills', '.codex/skills'];
const MAX_SKILLS = 20;

/** `name` and `description` from the YAML frontmatter of a SKILL.md (plain, quoted or folded with > or |). */
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text).replace(/^﻿/, ''));
  if (!match) return {};
  const lines = match[1].split(/\r?\n/); const found = {};
  for (let index = 0; index < lines.length; index++) {
    const key = /^(name|description):\s*(.*)$/.exec(lines[index]);
    if (!key) continue;
    // The value may go on in the indented lines below (folded with > or |, or a plain/quoted value that wraps).
    const parts = /^[>|][+-]?$/.test(key[2].trim()) ? [] : [key[2].trim()];
    while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1])) parts.push(lines[++index].trim());
    let value = parts.filter(Boolean).join(' ');
    found[key[1]] = value.replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
  }
  return found;
}

/**
 * Skills found under the usual folders, once each: the same skill is often linked from all three, so they are
 * told apart by the real path. A broken folder is skipped, never an error.
 */
function discover(roots = ROOTS, home = homedir()) {
  const seen = new Map();
  for (const root of roots) {
    const base = root.startsWith('/') ? root : join(home, root);
    let names; try { names = readdirSync(base); } catch { continue; }
    for (const entry of names.sort()) {
      try {
        const real = realpathSync(join(base, entry));
        if (seen.has(real) || !statSync(real).isDirectory()) continue;
        const file = join(real, 'SKILL.md');
        if (!statSync(file).isFile()) continue;
        const meta = frontmatter(readFileSync(file, 'utf8').slice(0, 20000));
        const name = String(meta.name || entry).trim().slice(0, 64);
        if (!name || /[\u0000-\u001f]/.test(name)) continue;
        seen.set(real, { id: real, name, description: String(meta.description || '').replace(/\s+/g, ' ').slice(0, 600), path: real, file, source: base.startsWith(home) ? '~' + base.slice(home.length) : base, linkedFrom: [join(base, entry)] });
      } catch {}
    }
  }
  return [...seen.values()];
}

/** What a bot turned on, checked against what is really on this disk: a path not found by discover() is dropped. */
function enabledFor(bot, found) {
  const picked = Array.isArray(bot?.skills) ? bot.skills : [];
  return picked.filter(item => item && typeof item.path === 'string').slice(0, MAX_SKILLS)
    .map(item => { const skill = found.find(candidate => candidate.path === item.path); return skill ? { ...skill, write: item.write === true } : null; }).filter(Boolean);
}

/** Valid shape of `skills` on a bot (absolute real paths, flags); whether they exist is checked where the disk is. */
function validSkills(value) {
  return Array.isArray(value) && value.length <= MAX_SKILLS && value.every(item => item && typeof item === 'object' && typeof item.path === 'string'
    && item.path.startsWith('/') && item.path.length < 1024 && !/[\u0000-\u001f]/.test(item.path) && (item.write === undefined || typeof item.write === 'boolean'))
    && new Set(value.map(item => item.path)).size === value.length;
}

/** The index sent with the bot's instructions on every turn (private chat and room, resumed sessions included). */
function skillGuidance(skills) {
  if (!skills?.length) return '';
  const lines = skills.map(skill => `- ${skill.name}${skill.description ? `: ${skill.description}` : ''} (SKILL.md em ${join(skill.path, 'SKILL.md')}${skill.write ? '; você pode melhorar esta skill e gravar nela o que aprender' : '; somente leitura'})`);
  return ' Skills ligadas para você (pastas com instruções e scripts): ' + lines.join(' ') + ' Quando o pedido combinar com uma skill, leia o SKILL.md dela antes de qualquer outra coisa e siga o que ele manda; caminhos relativos nele são relativos à pasta da skill. Leia os outros arquivos só quando o SKILL.md mandar. Rode os scripts pelo caminho absoluto da skill. Comandos longos (como renderizar um vídeo) levam minutos: rode e espere, e avise a pessoa do andamento.';
}

/** Is `path` inside one of the skills turned on (and, to change it, one marked as writable)? */
function insideSkill(skills, path, write = false) {
  const target = resolve(String(path));
  return (skills || []).some(skill => (!write || skill.write) && (target === skill.path || target.startsWith(skill.path + sep)));
}

const INTERPRETERS = new Set(['bash', 'sh', 'zsh', 'node', 'python', 'python3', 'source', '.']);
const READERS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'file', 'stat']);
/**
 * A command that only touches the skills turned on: steps joined by && or ; (no |, &, redirects, backticks or $( )),
 * each one a `cd` into a skill, a read-only viewer (ls, cat…) or a program (with or without an interpreter in front).
 * After a `cd` into a skill, relative paths (without ..) count as inside it; otherwise paths must be absolute.
 */
function commandInside(skills, command) {
  const text = String(command || '').trim();
  if (!text || /[|`<>\n\r&$]/.test(text.replace(/&&/g, ' ').replace(/\$\{?[A-Z_]+\}?(?![A-Za-z0-9_(])/g, ' ')) || /\$\(/.test(text)) return false;
  let cwd = null;
  const unquote = word => word.replace(/^["']|["']$/g, '');
  const inside = word => {
    const path = unquote(word);
    if (path.startsWith('/')) return insideSkill(skills, path);
    return Boolean(cwd) && !path.split('/').includes('..') && !path.startsWith('~') && !path.includes('$') && insideSkill(skills, join(cwd, path));
  };
  return text.split(/&&|;/).every(step => {
    const words = step.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return false;
    if (words[0] === 'cd') { if (words.length !== 2 || !insideSkill(skills, unquote(words[1]))) return false; cwd = resolve(unquote(words[1])); return true; }
    if (READERS.has(words[0])) { const paths = words.slice(1).filter(word => !word.startsWith('-')); return paths.length ? paths.every(inside) : Boolean(cwd); }
    const at = words.findIndex((word, index) => !(index < 2 && INTERPRETERS.has(word.replace(/^.*\//, ''))) && !/^[A-Z_][A-Z0-9_]*=/.test(word));
    const program = words[at];
    // A bare name (rm, curl) is a command found in PATH, not a file of the skill; only ./x, dir/x or the file after an interpreter is.
    return Boolean(program) && !program.startsWith('-') && (program.includes('/') || (at > 0 && INTERPRETERS.has(words[at - 1].replace(/^.*\//, '')))) && inside(program);
  });
}

module.exports = { commandInside, ROOTS, MAX_SKILLS, frontmatter, discover, enabledFor, validSkills, skillGuidance, insideSkill };

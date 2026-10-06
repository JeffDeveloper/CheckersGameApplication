#!/usr/bin/env node
'use strict';

// Check only staged content. Never print a possible secret value.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const repoRoot = path.resolve(__dirname, '..');
const blockedFile = /(^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.pypirc|credentials[^/]*\.json|[^/]+\.(?:pem|key|p12|pfx))$/i;
const patterns = [
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['known token format', /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16})\b/],
  ['credential assignment', /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|secret)\b\s*[:=]\s*["'`]?([A-Za-z0-9_\-/+]{16,})/i]
];

function findingsFor(file, content) {
  const findings = [];
  if (blockedFile.test(file.replaceAll('\\', '/'))) findings.push(`${file}: credential file must not be committed`);
  if (content.includes('\0')) return findings;
  content.split(/\r?\n/).forEach((line, index) => {
    for (const [label, pattern] of patterns) {
      if (pattern.test(line)) findings.push(`${file}:${index + 1}: possible ${label}`);
    }
  });
  return findings;
}

if (process.argv.includes('--self-test')) {
  const assert = require('node:assert/strict');
  assert.ok(findingsFor('.env', '').length);
  assert.ok(findingsFor('config/private.pem', '').length);
  const sample = ['api', '_key = "', 'abcdefghijklmnopqrstuvwx', '"'].join('');
  assert.ok(findingsFor('app.js', sample).length);
  assert.equal(findingsFor('js/game.js', 'const current = "white";').length, 0);
  console.log('Secret check self-test passed.');
  process.exit(0);
}

let names;
try {
  names = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0').filter(Boolean);
} catch (error) {
  console.error('Could not inspect staged files. Commit stopped.');
  process.exit(1);
}

const findings = [];
for (const file of names) {
  let content;
  try {
    content = execFileSync('git', ['show', `:${file}`], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  } catch (_) {
    console.error(`Could not inspect staged file: ${file}. Commit stopped.`);
    process.exit(1);
  }
  findings.push(...findingsFor(file, content));
}
if (findings.length) {
  console.error('Commit stopped: possible secrets in staged changes:');
  findings.forEach(item => console.error(`  ${item}`));
  console.error('Remove secrets from the staged files before committing.');
  process.exit(1);
}

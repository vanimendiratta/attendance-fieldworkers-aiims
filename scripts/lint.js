/**
 * Production Lint & Code Quality Scanner
 * 
 * Verifies:
 * 1. JavaScript syntax integrity via Node engine
 * 2. Zero-emoji / zero-informal Unicode symbols in UI assets
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('--- Running Production Linter & UI Quality Scanner ---');

// 1. Syntax Validation
const jsFiles = [];
function findJsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findJsFiles(fullPath);
    } else if (entry.name.endsWith('.js')) {
      jsFiles.push(fullPath);
    }
  }
}

findJsFiles('src');
findJsFiles('public');
findJsFiles('test');
jsFiles.push('server.js');

let syntaxErrors = 0;
for (const file of jsFiles) {
  try {
    execSync(`node --check "${file}"`, { stdio: 'pipe' });
  } catch (err) {
    console.error(`❌ Syntax Error in ${file}:`, err.message);
    syntaxErrors++;
  }
}

if (syntaxErrors > 0) {
  console.error(`Lint failed with ${syntaxErrors} syntax error(s).`);
  process.exit(1);
}
console.log(`✓ Validated syntax across ${jsFiles.length} JavaScript files without errors.`);

// 2. UI Emoji & Informal Unicode Scanner
const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{203C}\u{2049}\u{2122}\u{2139}\u{2194}-\u{2199}\u{21A9}-\u{21AA}\u{2934}\u{2935}\u{25AA}\u{25AB}\u{25FE}\u{25FD}\u{25FB}\u{25FC}\u{25B6}\u{25C0}\u{3030}\u{303D}\u{3297}\u{3299}]/u;

let emojiCount = 0;
const uiFiles = [];
function findUiFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findUiFiles(fullPath);
    } else if (entry.name.endsWith('.html') || entry.name.endsWith('.js') || entry.name.endsWith('.css')) {
      uiFiles.push(fullPath);
    }
  }
}

findUiFiles('public');

for (const file of uiFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const match = emojiPattern.exec(line);
    if (match) {
      console.error(`❌ Emoji/informal symbol found in ${file}:${idx + 1} -> ${match[0]}`);
      emojiCount++;
    }
  });
}

if (emojiCount > 0) {
  console.error(`UI Lint failed: Found ${emojiCount} forbidden emoji/Unicode symbols.`);
  process.exit(1);
}

console.log(`✓ Scanned ${uiFiles.length} public UI assets: 0 emojis or informal symbols found.`);
console.log('🎉 LINT PASSED: Clean syntax, zero emojis, senior-level code quality.');

import fs from 'fs';
import path from 'path';

console.log('=== scripts/check-tokens.mjs: Scanning src/components for token violations ===');

const TARGET_DIR = path.resolve('src/components');

function walk(dir) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walk(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
      files.push(fullPath);
    }
  }
  return files;
}

const componentFiles = walk(TARGET_DIR);
let violations = [];

const HEX_REGEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_REGEX = /rgba?\s*\(/g;
const TAILWIND_COLOR_REGEX = /\b(bg|text|border|ring|fill|stroke|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]+\b/g;

for (const filePath of componentFiles) {
  const relativePath = path.relative('.', filePath);
  // Skip test files from token check if any
  if (relativePath.includes('.test.')) continue;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // 1. Check for lucide
    if (/lucide-react/i.test(line)) {
      violations.push({
        file: relativePath,
        line: lineNum,
        rule: 'lucide-react import or reference forbidden in components',
        content: line.trim(),
      });
    }

    // 2. Check for hex colors
    const hexMatches = line.match(HEX_REGEX);
    if (hexMatches) {
      violations.push({
        file: relativePath,
        line: lineNum,
        rule: `Hardcoded hex color forbidden (${hexMatches.join(', ')}). Use CSS tokens from tokens.css`,
        content: line.trim(),
      });
    }

    // 3. Check for rgb / rgba
    const rgbMatches = line.match(RGB_REGEX);
    if (rgbMatches) {
      violations.push({
        file: relativePath,
        line: lineNum,
        rule: `Direct rgb()/rgba() color forbidden. Use CSS tokens from tokens.css`,
        content: line.trim(),
      });
    }

    // 4. Check for standard Tailwind color classes
    const twMatches = line.match(TAILWIND_COLOR_REGEX);
    if (twMatches) {
      violations.push({
        file: relativePath,
        line: lineNum,
        rule: `Tailwind hue color classes forbidden (${twMatches.join(', ')}). Use tokens (text-primary, bg-surface, text-verdigris, text-cinnabar, etc.)`,
        content: line.trim(),
      });
    }
  });
}

if (violations.length > 0) {
  console.error(`\n  FAIL: Found ${violations.length} token violation(s) under src/components:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.rule}]`);
    console.error(`    ${v.content}\n`);
  }
  process.exit(1);
} else {
  console.log(`\n  PASS: check-tokens passed (scanned ${componentFiles.length} files under src/components, 0 violations).\n`);
}

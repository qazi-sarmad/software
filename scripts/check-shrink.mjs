import fs from 'fs';
import path from 'path';

console.log('=== scripts/check-shrink.mjs: Checking for >10% line shrink against docs/baseline-lines.json ===');

const BASELINE_PATH = path.resolve('docs/baseline-lines.json');

if (!fs.existsSync(BASELINE_PATH)) {
  console.error(`FAIL: Baseline file not found at ${BASELINE_PATH}`);
  process.exit(1);
}

let baselineData;
try {
  baselineData = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
} catch (err) {
  console.error(`FAIL: Could not parse ${BASELINE_PATH}:`, err.message);
  process.exit(1);
}

const baselineFiles = baselineData.files || {};
const movedMap = baselineData.moved || {};

let hasFailure = false;
let checkedCount = 0;

for (const [file, baseLines] of Object.entries(baselineFiles)) {
  // If file was deliberately moved
  const targetPath = movedMap[file] || file;

  if (!fs.existsSync(targetPath)) {
    console.error(`FAIL: Baseline file "${file}" disappeared (not found at ${targetPath}).`);
    hasFailure = true;
    continue;
  }

  const currentContent = fs.readFileSync(targetPath, 'utf-8');
  const currentLines = currentContent.split('\n').length;
  checkedCount++;

  console.log(`- ${file}: Baseline = ${baseLines} lines -> Current = ${currentLines} lines`);

  // Fail if current lines is less than 90% of baseline lines (>10% shrink)
  if (baseLines > 0 && currentLines < baseLines * 0.9) {
    const shrinkPct = (((baseLines - currentLines) / baseLines) * 100).toFixed(1);
    console.error(`  ERROR: ${file} shrunk by ${shrinkPct}% (${baseLines} -> ${currentLines})`);
    hasFailure = true;
  }
}

if (hasFailure) {
  console.error('\n  FAIL: check-shrink failed: One or more tracked files shrunk by >10% against baseline.\n');
  process.exit(1);
} else {
  console.log(`\n  PASS: check-shrink passed (${checkedCount} files verified, no >10% shrink vs baseline).\n`);
}

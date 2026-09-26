/**
 * Tooltip Migration Analyzer
 * Analyze title= attributes and aria-label usage across the codebase
 */

import fs from 'fs/promises';
import path from 'path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');

// Recursive function to find all TSX files
async function findTsxFiles(dir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      files.push(...(await findTsxFiles(fullPath)));
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
      files.push(fullPath);
    }
  }
  
  return files;
}

async function analyzeFile(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  
  const results = {
    file: filePath.replace(SRC_DIR + path.sep, ''),
    titleCount: 0,
    ariaLabelCount: 0,
    titleWithoutAria: [],
    buttonWithTitleOnly: [],
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    // Check for title= attribute
    if (line.includes('title=')) {
      results.titleCount++;
      
      // Check if this line or nearby lines have aria-label
      const hasAriaLabel = line.includes('aria-label') || 
        (i > 0 && lines[i - 1].includes('aria-label')) ||
        (i < lines.length - 1 && lines[i + 1].includes('aria-label'));
      
      // Check if it's a button element
      const isButton = line.match(/<button[^>]*title=/i) || 
        (i > 0 && lines[i - 1].match(/<button[^>]*$/i));
      
      if (!hasAriaLabel) {
        // Extract the title content
        const titleMatch = line.match(/title="([^"]*)"/) || line.match(/title={'([^']*)'}/);
        const titleContent = titleMatch ? titleMatch[1] : 'unknown';
        
        results.titleWithoutAria.push({
          line: lineNum,
          content: line.trim(),
          title: titleContent,
        });
        
        if (isButton) {
          results.buttonWithTitleOnly.push({
            line: lineNum,
            content: line.trim(),
            title: titleContent,
          });
        }
      }
    }

    // Count aria-label
    if (line.includes('aria-label')) {
      results.ariaLabelCount++;
    }
  }

  return results;
}

async function main() {
  console.log('=== Tooltip Migration Analyzer ===\n');
  
  // Find all TSX files
  const files = await findTsxFiles(SRC_DIR);
  console.log(`Found ${files.length} TSX/TS files\n`);

  let totalTitle = 0;
  let totalAria = 0;
  let totalWithoutAria = 0;
  let totalButtonTitleOnly = 0;
  const filesNeedingMigration = [];
  const allTitleWithoutAria = [];
  const allButtonTitleOnly = [];

  for (const file of files) {
    try {
      const result = await analyzeFile(file);
      
      if (result.titleWithoutAria.length > 0) {
        filesNeedingMigration.push(result);
      }
      
      totalTitle += result.titleCount;
      totalAria += result.ariaLabelCount;
      totalWithoutAria += result.titleWithoutAria.length;
      totalButtonTitleOnly += result.buttonWithTitleOnly.length;
      
      allTitleWithoutAria.push(...result.titleWithoutAria);
      allButtonTitleOnly.push(...result.buttonWithTitleOnly);
    } catch (error) {
      console.warn(`Error analyzing ${file}:`, error.message);
    }
  }

  // Generate report
  const report = `
# Tooltip Migration Analysis Report

## 📊 Summary

| Metric | Count |
|--------|-------|
| Total \`title=\` attributes | ${totalTitle} |
| Total \`aria-label\` attributes | ${totalAria} |
| \`title=\` without nearby \`aria-label\` | ${totalWithoutAria} |
| Button elements with \`title=\` only | ${totalButtonTitleOnly} |
| Files needing migration | ${filesNeedingMigration.length} |

## 🚨 Critical Issues (Buttons with title only)

Buttons with \`title=\` but no \`aria-label\` are **not announced properly** by screen readers.

${allButtonTitleOnly.slice(0, 20).map(item => {
  return `- **${item.file}** (line ${item.line}): \`${item.title}\``;
}).join('\n')}
${allButtonTitleOnly.length > 20 ? `\n... and ${allButtonTitleOnly.length - 20} more` : ''}

## 📁 Files Needing Migration

${filesNeedingMigration.map(file => {
  return `### ${file.file}
- \`title=\` count: ${file.titleCount}
- \`aria-label\` count: ${file.ariaLabelCount}
- Need migration: ${file.titleWithoutAria.length}
`;
}).join('\n')}

## 🛠️ Migration Strategy

### For button elements:
Replace:
\`\`\`tsx
<button onClick={handler} title="Description"><Icon /></button>
\`\`\`

With:
\`\`\`tsx
<Tooltip content="Description" as="button" onClick={handler}>
  <Icon />
</Tooltip>
\`\`\`

Or if you need to keep the button element:
\`\`\`tsx
<button onClick={handler} aria-label="Description"><Icon /></button>
<Tooltip content="Description"><button onClick={handler} aria-label="Description"><Icon /></button></Tooltip>
\`\`\`

### For non-interactive elements:
Replace:
\`\`\`tsx
<span title="Description">Text</span>
\`\`\`

With:
\`\`\`tsx
<Tooltip content="Description"><span>Text</span></Tooltip>
\`\`\`

## 📝 Full List of title= Without aria-label

${allTitleWithoutAria.map(item => {
  return `- **${item.file}** (line ${item.line}): \`${item.title}\``;
}).join('\n')}
`;

  // Save report
  const reportPath = path.join(PROJECT_ROOT, 'tooltip-migration-report.md');
  await fs.writeFile(reportPath, report);
  
  console.log(`Analysis complete!`);
  console.log(`\n📊 Summary:`);
  console.log(`  - Total title= attributes: ${totalTitle}`);
  console.log(`  - Total aria-label attributes: ${totalAria}`);
  console.log(`  - title= without aria-label: ${totalWithoutAria}`);
  console.log(`  - Buttons with title only: ${totalButtonTitleOnly}`);
  console.log(`  - Files needing migration: ${filesNeedingMigration.length}`);
  console.log(`\n📄 Report saved to: ${reportPath}`);
  console.log(`\n⚠️  Accessibility Impact:`);
  console.log(`  - ${totalButtonTitleOnly} buttons are not properly announced to screen readers`);
  console.log(`  - ${totalWithoutAria} tooltips use native browser tooltips (slow, unstyled)`);
  console.log(`\n✅ Next Steps:`);
  console.log(`  1. Review the report at ${reportPath}`);
  console.log(`  2. Start with high-priority buttons (accessibility)`);
  console.log(`  3. Replace title= with Tooltip component for consistent UX`);
}

main().catch(console.error);

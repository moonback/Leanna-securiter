/**
 * Fetch Effects Auditor
 * Analyze useEffect hooks with fetch calls to ensure proper loading/error/empty states
 */

import fs from 'fs/promises';
import path from 'path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');

// Recursive function to find all TSX/TS files
async function findTsFiles(dir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      files.push(...(await findTsFiles(fullPath)));
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function extractUseEffectBlocks(content) {
  // Find all useEffect blocks
  const useEffectRegex = /useEffect\s*\(\s*(\{?[^)]*\}?)\s*,\s*\[([^\]]*)\]\s*\)/gs;
  const matches = [];
  
  let match;
  while ((match = useEffectRegex.exec(content)) !== null) {
    matches.push({
      callback: match[1].trim(),
      deps: match[2].trim(),
      fullMatch: match[0],
      index: match.index,
    });
  }
  
  return matches;
}

function checkForFetch(callback) {
  // Check if callback contains fetch
  return callback.includes('fetch(') || 
         callback.includes('fetch\(') ||
         callback.includes('axios') ||
         callback.includes('api.') ||
         callback.includes('/api/');
}

function checkForLoadingState(content, aroundUseEffect) {
  // Check for loading state management
  const loadingPatterns = [
    'setLoading',
    'loading, setLoading',
    'isLoading',
    'setIsLoading',
    'useState.*loading',
    'Skeleton',
    'loading ?',
    'if (loading)',
  ];
  
  return loadingPatterns.some(pattern => content.includes(pattern));
}

function checkForErrorState(content, aroundUseEffect) {
  // Check for error state management
  const errorPatterns = [
    'setError',
    'error, setError',
    'catch',
    '.catch',
    'toastError',
    'toast.error',
    'EmptyState',
  ];
  
  return errorPatterns.some(pattern => content.includes(pattern));
}

function checkForEmptyState(content, aroundUseEffect) {
  // Check for empty state handling
  const emptyPatterns = [
    'EmptyState',
    'length === 0',
    'length < 1',
    '!.length',
    'no results',
    'Aucun',
    'empty',
  ];
  
  return emptyPatterns.some(pattern => content.includes(pattern));
}

async function analyzeFile(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  
  const results = {
    file: filePath.replace(SRC_DIR + path.sep, ''),
    useEffectCount: 0,
    useEffectWithFetch: [],
    issues: [],
  };

  // Find all useEffect blocks
  const useEffectBlocks = extractUseEffectBlocks(content);
  results.useEffectCount = useEffectBlocks.length;

  // Analyze each useEffect block
  for (let i = 0; i < useEffectBlocks.length; i++) {
    const block = useEffectBlocks[i];
    
    if (checkForFetch(block.callback)) {
      // Find the line number
      const lineNum = content.substring(0, block.index).split('\n').length;
      
      // Get surrounding content for better context
      const startLine = Math.max(0, lineNum - 10);
      const endLine = Math.min(lines.length, lineNum + 20);
      const surroundingContent = lines.slice(startLine, endLine).join('\n');
      
      const hasLoading = checkForLoadingState(surroundingContent, block);
      const hasError = checkForErrorState(surroundingContent, block);
      const hasEmpty = checkForEmptyState(surroundingContent, block);
      
      const issue = {
        line: lineNum,
        callback: block.callback,
        deps: block.deps,
        hasLoadingState: hasLoading,
        hasErrorState: hasError,
        hasEmptyState: hasEmpty,
      };
      
      // Identify issues
      if (!hasLoading) {
        issue.missing = (issue.missing || []).concat('loading state');
      }
      if (!hasError) {
        issue.missing = (issue.missing || []).concat('error handling');
      }
      if (!hasEmpty) {
        issue.missing = (issue.missing || []).concat('empty state');
      }
      
      if (issue.missing && issue.missing.length > 0) {
        issue.status = 'NEEDS_ATTENTION';
        results.issues.push(issue);
      } else {
        issue.status = 'OK';
      }
      
      results.useEffectWithFetch.push(issue);
    }
  }

  return results;
}

async function main() {
  console.log('=== Fetch Effects Auditor ===\n');
  
  // Find all TSX files
  const files = await findTsFiles(SRC_DIR);
  console.log(`Found ${files.length} TSX/TS files\n`);

  let totalUseEffect = 0;
  let totalWithFetch = 0;
  let totalIssues = 0;
  const filesWithIssues = [];
  const allIssues = [];

  for (const file of files) {
    try {
      const result = await analyzeFile(file);
      
      totalUseEffect += result.useEffectCount;
      totalWithFetch += result.useEffectWithFetch.length;
      totalIssues += result.issues.length;
      
      if (result.issues.length > 0) {
        filesWithIssues.push(result);
        allIssues.push(...result.issues);
      }
    } catch (error) {
      console.warn(`Error analyzing ${file}:`, error.message);
    }
  }

  // Generate report
  const report = `
# Fetch Effects Audit Report

## 📊 Summary

| Metric | Count |
|--------|-------|
| Total \`useEffect\` hooks | ${totalUseEffect} |
| \`useEffect\` with fetch | ${totalWithFetch} |
| Missing proper states | ${totalIssues} |
| Files with issues | ${filesWithIssues.length} |

## 🚨 Issues Found

### By Severity
- **Critical**: Missing both loading and error states
- **Warning**: Missing one of loading, error, or empty states
- **Info**: All states present but could be improved

### Files Requiring Attention

${filesWithIssues.map(file => {
  return `### \`${file.file}\`
- \`useEffect\` count: ${file.useEffectCount}
- Fetch effects: ${file.useEffectWithFetch.length}
- Issues: ${file.issues.length}
${file.issues.map(issue => {
  return `  - Line ${issue.line}: ${issue.missing ? 'Missing: ' + issue.missing.join(', ') : 'OK'}`;
}).join('\n')}
`;
}).join('\n')}

## 📋 Detailed Issues

${allIssues.map(issue => {
  return `- **${issue.file}** (line ${issue.line}): ${issue.missing ? 'Missing: ' + issue.missing.join(', ') : 'OK'}`;
}).join('\n')}

## ✅ Best Practices Checklist

### Loading State
- [ ] Use \`useState\` for loading: \`const [loading, setLoading] = useState(false);\`
- [ ] Set loading before fetch: \`setLoading(true); await fetch(...); setLoading(false);\`
- [ ] Display loading indicator: \`<Skeleton />\` or \`loading && <Spinner />\`
- [ ] Consider using Suspense for data fetching

### Error State
- [ ] Use \`useState\` for error: \`const [error, setError] = useState(null);\`
- [ ] Catch errors: \`.catch(err => setError(err))\`
- [ ] Display error message: \`error && <ErrorDisplay message={error} />\`
- [ ] Use toast notifications for user feedback

### Empty State
- [ ] Check for empty data: \`data.length === 0\`
- [ ] Display empty state: \`<EmptyState icon={Icon} title="No data" description="Start by..." />\`
- [ ] Provide clear call-to-action

### Dependencies
- [ ] Include all external dependencies in dependency array
- [ ] Use stable references (useCallback, useMemo)
- [ ] Consider using \`[]\` only for initial mount effects

## 🛠️ Suggested Fixes

### Basic Pattern
\`\`\`tsx
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);

useEffect(() => {
  const loadData = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/data');
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err);
      toastError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };
  loadData();
}, []);

if (loading) return <Skeleton />;
if (error) return <ErrorDisplay error={error} />;
if (!data?.length) return <EmptyState icon={Database} title="No data" />;

return <DataComponent data={data} />;
\`\`\`
`;

  // Save report
  const reportPath = path.join(PROJECT_ROOT, 'fetch-effects-audit-report.md');
  await fs.writeFile(reportPath, report);
  
  console.log(`Audit complete!`);
  console.log(`\n📊 Summary:`);
  console.log(`  - Total useEffect hooks: ${totalUseEffect}`);
  console.log(`  - useEffect with fetch: ${totalWithFetch}`);
  console.log(`  - Missing proper states: ${totalIssues}`);
  console.log(`  - Files with issues: ${filesWithIssues.length}`);
  console.log(`\n📄 Report saved to: ${reportPath}`);
  console.log(`\n✅ Next Steps:`);
  console.log(`  1. Review the report at ${reportPath}`);
  console.log(`  2. Fix critical issues first (missing loading + error)`);
  console.log(`  3. Use Skeleton.tsx and EmptyState.tsx consistently`);
}

main().catch(console.error);

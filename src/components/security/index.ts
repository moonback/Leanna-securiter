/**
 * src/components/security/index.ts
 * Barrel export for all Phase 5 security UI components.
 */

export { SeverityBadge, CvssBar } from './SeverityBadge.js';
export type { Severity } from './SeverityBadge.js';

export { FindingCard } from './FindingCard.js';
export type { FindingCardData, FindingStatus, ScannerCategory } from './FindingCard.js';

export { CodeSnippet } from './CodeSnippet.js';

export { TaintFlowViz } from './TaintFlowViz.js';
export type { TaintFlow, TaintNode, TaintEdge } from './TaintFlowViz.js';

export { RemediationPanel } from './RemediationPanel.js';
export type { PatchDiff, Reference } from './RemediationPanel.js';

export { SbomTable } from './SbomTable.js';
export type { SbomEntry } from './SbomTable.js';

export { AttackSurfaceGraph } from './AttackSurfaceGraph.js';
export type { SurfaceGraph, SurfaceNode, SurfaceEdge } from './AttackSurfaceGraph.js';

export { SarifExportDialog } from './SarifExportDialog.js';

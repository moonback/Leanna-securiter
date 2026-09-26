// Type declarations for modules without types

declare module 'react-window-tree' {
  export const FixedSizeTree: React.ComponentType<{
    treeData: any;
    rowHeight?: number;
    width?: number;
    height?: number;
    renderNode: (props: { node: any; depth: number; isExpanded: boolean; canExpand: boolean }) => React.ReactNode;
    getNodeKey?: (node: any) => string;
    onExpand?: (node: any) => void;
    onCollapse?: (node: any) => void;
    onClick?: (node: any) => void;
  }>;
  export type TreeNodeData = {
    data: any;
    isExpanded: boolean;
    canExpand: boolean;
  };
}

// Global CustomEvent types
interface Window {
  dispatchEvent(event: CustomEvent): boolean;
  // Spécialisation des compétences - Mapping outil → agent
  LeannaToolAgentMapping?: Record<string, string>;
}

interface CustomEventMap {
  'Leanna-sandbox-changed': CustomEvent<{ path?: string }>;
  'Leanna-sandbox-file-changed': CustomEvent<{ path: string }>;
  'Leanna-sandbox-file-deleted': CustomEvent<{ path: string }>;
  'Leanna-realtime-file-event': CustomEvent<any>;
}
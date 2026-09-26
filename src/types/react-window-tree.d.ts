// Type declarations for react-window-tree (no official types)
declare module 'react-window-tree' {
  import * as React from 'react';

  export interface TreeProps {
    treeData: any[];
    height?: number;
    width?: number;
    itemHeight?: number;
    virtual?: boolean;
    showLine?: boolean;
    expandedKeys?: string[];
    onExpand?: (expandedKeys: string[]) => void;
    selectable?: boolean;
    defaultExpandParent?: boolean;
    renderNode?: (props: { node: any; depth: number; isExpanded: boolean; canExpand: boolean }) => React.ReactNode;
  }

  const Tree: React.FC<TreeProps>;
  export default Tree;
}
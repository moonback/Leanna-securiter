/**
 * UI Design System — Exports centralisés
 *
 * Groupés par intention pour faciliter la découverte :
 *   1. Primitives de base (boutons, champs, onglets)
 *   2. Feedback & état (toasts, états asynchrones, badges)
 *   3. Overlays (modales, sidepanels, confirmations)
 *   4. Mise en page (panneaux, en-têtes, squelettes)
 *   5. Utilitaires (tooltip, icône-bouton, toggle, états-agent)
 *
 * Importer depuis '@/src/components/ui' ou chemin relatif.
 */

// ─── 1. Primitives de base ──────────────────────────────────────────────────────

export {
  Button,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
} from './Button.js';

export {
  Field,
  Input,
  Textarea,
  Select,
  FieldGroup,
  type FieldProps,
  type InputProps,
  type TextareaProps,
  type SelectProps,
  type FieldGroupProps,
} from './Field.js';

export {
  Tabs,
  type TabsProps,
  type TabsListProps,
  type TabProps,
  type TabPanelProps,
  type TabsVariant,
  type TabsOrientation,
} from './Tabs.js';

export { Toggle } from './Toggle.js';

// ─── 2. Feedback & état ─────────────────────────────────────────────────────────

export { ToastProvider, useToast, type ToastType } from './Toast.js';

export {
  AsyncState,
  type AsyncStateProps,
  type AsyncStateAction,
  type AsyncLoadingProps,
  type AsyncErrorProps,
  type AsyncEmptyProps,
} from './AsyncState.js';

export {
  StatusBadge,
  type StatusBadgeProps,
  type StatusType,
} from './StatusBadge.js';

// ─── 3. Overlays ────────────────────────────────────────────────────────────────

export {
  Modal,
  type ModalProps,
  type ModalSize,
  type ModalTone,
  type ModalLayer,
  type ModalHeaderProps,
  type ModalBodyProps,
  type ModalFooterProps,
} from './Modal.js';

export {
  SidePanel,
  type SidePanelProps,
  type SidePanelPosition,
  type SidePanelMode,
} from './SidePanel.js';

export {
  ConfirmDialogProvider,
  useConfirm,
  type ConfirmOptions,
} from './ConfirmDialog.js';

// ─── 4. Mise en page ────────────────────────────────────────────────────────────

export { Panel } from './Panel.js';
export { ViewHeader } from './ViewHeader.js';
export { EmptyState, type EmptyStateProps } from './EmptyState.js';

export {
  SkeletonLine,
  SkeletonBlock,
  SkeletonCircle,
  SourceSkeleton,
  ChatMessageSkeleton,
  NoteSkeleton,
  ChatPanelSkeleton,
  SourcesPanelSkeleton,
  NotesPanelSkeleton,
} from './Skeleton.js';

// ─── 5. Utilitaires ─────────────────────────────────────────────────────────────

export { Tooltip, type TooltipProps } from './Tooltip.js';

export {
  IconButton,
  type IconButtonVariant,
  type IconButtonProps,
} from './IconButton.js';

export {
  AgentTaskCard,
  type AgentTaskCardProps,
  type TaskStep,
} from './AgentTaskCard.js';

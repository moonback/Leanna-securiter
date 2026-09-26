import React from 'react';
import { Monitor } from 'lucide-react';
import { Panel } from '../ui/Panel.js';
import { ScreenShareCapture } from '../ScreenShareCapture.js';

export const ScreenSharePanel = React.memo(function ScreenSharePanel() {
  return (
    <Panel title="Partage d'écran" icon={<Monitor className="w-4 h-4" />}>
      <ScreenShareCapture />
    </Panel>
  );
});

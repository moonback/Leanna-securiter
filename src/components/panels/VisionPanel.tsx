import React from 'react';
import { Camera } from 'lucide-react';
import { Panel } from '../ui/Panel.js';
import { WebcamCapture } from '../WebcamCapture.js';

interface VisionPanelProps {
  connected: boolean;
  onFrame: (frame: string) => void;
}

export const VisionPanel = React.memo(function VisionPanel({ connected, onFrame }: VisionPanelProps) {
  return (
    <Panel title="Votre caméra" icon={<Camera className="w-4 h-4" />}>
      <WebcamCapture onFrame={frame => { if (connected) onFrame(frame); }} />
    </Panel>
  );
});

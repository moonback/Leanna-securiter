import React, { useRef, useEffect } from 'react';

export function WebcamCapture({ onFrame }: { onFrame: (base64: string) => void }) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) videoRef.current.srcObject = stream;

        interval = setInterval(() => {
          if (!videoRef.current || !canvasRef.current) return;
          const { videoWidth, videoHeight } = videoRef.current;
          if (videoWidth === 0 || videoHeight === 0) return;

          const canvas = canvasRef.current;
          canvas.width  = videoWidth;
          canvas.height = videoHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          ctx.drawImage(videoRef.current, 0, 0, videoWidth, videoHeight);
          onFrame(canvas.toDataURL('image/jpeg', 0.5));
        }, 3000);
      } catch (err) {
        console.error('Failed to start camera', err);
      }
    }

    startCamera();
    return () => {
      if (interval) clearInterval(interval);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [onFrame]);

  return (
    <div
      className="relative rounded-xl overflow-hidden aspect-video flex items-center justify-center"
      style={{ border: '1px solid var(--border-strong)', backgroundColor: 'var(--bg-secondary)' }}
    >
      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />

      {/* LIVE badge — red is semantically correct regardless of theme */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/40 backdrop-blur-sm text-red-400 text-sm font-bold px-2 py-1 rounded-full border border-red-500/30">
        <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
        LIVE
      </div>
    </div>
  );
}

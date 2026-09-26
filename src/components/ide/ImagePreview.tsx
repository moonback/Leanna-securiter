/**
 * ImagePreview — Affiche un preview d'image pour les fichiers binaires (PNG, JPG, etc.)
 * dans l'IDE. Charge l'image via fetch avec les bons headers d'auth.
 */

import { useState, useEffect } from 'react';
import { Loader2, Download, Image as ImageIcon } from 'lucide-react';

interface Props {
  filePath: string;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('Leanna_api_token');
  return token ? { 'x-Leanna-token': token } : {};
}

export function ImagePreview({ filePath }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const response = await fetch(
          `/api/ide/file-raw?path=${encodeURIComponent(filePath)}`,
          { headers: getAuthHeaders() }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        if (revoked) return;

        const url = URL.createObjectURL(blob);
        setImageUrl(url);
      } catch (err: any) {
        if (!revoked) setError(err.message);
      } finally {
        if (!revoked) setLoading(false);
      }
    })();

    return () => {
      revoked = true;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [filePath]);

  const handleDownload = () => {
    if (!imageUrl) return;
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = filePath.split('/').pop() || 'image.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--bg-base)' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-dimmed)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ backgroundColor: 'var(--bg-base)' }}>
        <ImageIcon className="w-10 h-10 opacity-30" style={{ color: 'var(--text-dimmed)' }} />
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Impossible de charger l'image</p>
        <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 overflow-auto" style={{ backgroundColor: 'var(--bg-base)' }}>
      {imageUrl && (
        <img
          src={imageUrl}
          alt={filePath.split('/').pop() || 'Image'}
          className="max-w-full max-h-[80vh] rounded-xl shadow-lg border"
          style={{ borderColor: 'var(--border-base)', objectFit: 'contain' }}
        />
      )}
      <div className="flex items-center gap-3">
        <p className="text-sm font-medium" style={{ color: 'var(--text-dimmed)' }}>
          {filePath.split('/').pop()}
        </p>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all hover:bg-white/5"
          style={{ color: 'var(--text-muted)', border: '1px solid var(--border-base)' }}
        >
          <Download className="w-3 h-3" />
          Télécharger
        </button>
      </div>
    </div>
  );
}

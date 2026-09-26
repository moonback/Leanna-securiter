import { useState, useEffect } from 'react';
import { Loader2, Download, FileText } from 'lucide-react';

interface Props {
  filePath: string;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('Leanna_api_token');
  return token ? { 'x-Leanna-token': token } : {};
}

export function PdfPreview({ filePath }: Props) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
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
        setPdfUrl(url);
      } catch (err: any) {
        if (!revoked) setError(err.message);
      } finally {
        if (!revoked) setLoading(false);
      }
    })();

    return () => {
      revoked = true;
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [filePath]);

  const handleDownload = () => {
    if (!pdfUrl) return;
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = filePath.split('/').pop() || 'document.pdf';
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
        <FileText className="w-10 h-10 opacity-30" style={{ color: 'var(--text-dimmed)' }} />
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Impossible de charger le PDF</p>
        <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border-base)' }}>
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-dimmed)' }}>
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

      <div className="flex-1 min-h-0 p-2">
        {pdfUrl && (
          <iframe
            title={filePath}
            src={pdfUrl}
            className="w-full h-full min-h-[70vh] rounded-lg border"
            style={{ borderColor: 'var(--border-base)', backgroundColor: '#fff' }}
          />
        )}
      </div>
    </div>
  );
}

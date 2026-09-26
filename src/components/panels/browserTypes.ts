/** Electron webview types used by the browser panel. */
export interface WebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): void;
  reload(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  getTitle(): string;
  executeJavaScript(code: string): Promise<unknown>;
}

export interface WebviewTitleEvent extends Event {
  title: string;
  explicitSet: boolean;
}

export interface WebviewFailLoadEvent extends Event {
  errorCode: number;
  errorDescription: string;
  validatedURL: string;
}

export interface WebviewNavigateEvent extends Event {
  url: string;
  httpResponseCode: number;
  httpStatusText: string;
}

export interface BrowserPanelProps {
  onClose: () => void;
  url?: string;
  defaultUrl?: string;
  fullWidth?: boolean;
  width?: string;
  onOpenInNewTab?: (url: string) => void;
  onOpenExternal?: () => void;
}

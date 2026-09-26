export interface ElectronAPI {
  folderContents: (folderPath: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean }>>;
  createFile: (folderPath: string, fileName: string) => Promise<string>;
  createFolder: (folderPath: string, folderName: string) => Promise<string>;
  deletePath: (targetPath: string) => Promise<boolean>;
  openPath: (targetPath: string) => Promise<boolean>;
  getProjectRoot: () => Promise<string>;
  quit: () => Promise<void>;
}

declare global {
  interface Window {
    electron?: ElectronAPI;    // ancien nom — conservé pour compatibilité
    electronAPI?: ElectronAPI; // nouveau nom exposé par le preload
  }
}

export {};

const { contextBridge, ipcRenderer } = require('electron');

// Expose uniquement les IPC handlers nécessaires au renderer
// nodeIntegration est désactivé — le renderer ne peut pas appeler require() directement
contextBridge.exposeInMainWorld('electronAPI', {
  folderContents: (folderPath) =>
    ipcRenderer.invoke('electron/folder-contents', folderPath),

  createFile: (folderPath, fileName) =>
    ipcRenderer.invoke('electron/create-file', folderPath, fileName),

  createFolder: (folderPath, folderName) =>
    ipcRenderer.invoke('electron/create-folder', folderPath, folderName),

  deletePath: (targetPath) =>
    ipcRenderer.invoke('electron/delete-path', targetPath),

  openPath: (targetPath) =>
    ipcRenderer.invoke('electron/open-path', targetPath),

  openExternal: (url) =>
    ipcRenderer.invoke('electron/open-external', url),

  getProjectRoot: () =>
    ipcRenderer.invoke('electron/get-project-root'),

  selectFolder: () =>
    ipcRenderer.invoke('electron/select-folder'),

  getScreenSources: () =>
    ipcRenderer.invoke('electron/get-screen-sources'),

  quit: () =>
    ipcRenderer.invoke('electron/quit'),

  // Clone un dépôt git distant dans un dossier local.
  // repoUrl  : URL HTTPS ou SSH du dépôt (ex: https://github.com/user/repo.git)
  // targetDir: dossier parent optionnel (défaut: ~/Documents/Leanna-Projects)
  // Retourne : { success: boolean, path?: string, repoName?: string, error?: string }
  gitClone: (repoUrl, targetDir) =>
    ipcRenderer.invoke('electron/git-clone', repoUrl, targetDir),
});

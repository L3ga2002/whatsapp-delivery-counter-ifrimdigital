import { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { autoUpdater } from 'electron-updater';
import { buildScanReport, parseImportedTexts } from '../src/shared/parser';
import { WorkspaceStore } from './workspace-store';
import type {
  AliasMap,
  AppSettings,
  AppUpdateStatus,
  AppUpdateState,
  Courier,
  CourierInput,
  ImportResult,
  ParsedAvailabilityMessage,
  ParsedDeliveryMessage,
  Report,
  ReportImport,
  ReportImportInput,
  ReportInput,
  Restaurant,
  RestaurantInput,
  ScanOptions,
  ScanReport,
  WorkspaceSnapshot,
} from '../src/shared/types';

let mainWindow: BrowserWindow | null = null;
let importInProgress = false;
let workspaceStore: WorkspaceStore | null = null;
let updateStatus: AppUpdateStatus = createUpdateStatus('idle');

const aliasFileName = 'courier-aliases.json';
const updateTokenFileName = 'github-update-token.bin';
const updateOwner = 'L3ga2002';
const updateRepo = 'whatsapp-delivery-counter-ifrimdigital';
const trustedDevServerOrigin = 'http://127.0.0.1:3001';
const maxImportFileCount = 30;
const maxTxtFileBytes = 20 * 1024 * 1024;
const maxZipFileBytes = 50 * 1024 * 1024;
const maxZipTextEntries = 10;
const maxZipTextEntryBytes = 20 * 1024 * 1024;
const maxZipTotalTextBytes = 30 * 1024 * 1024;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    title: 'WhatsApp Delivery Counter',
    backgroundColor: '#f6f7f9',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#eef2f5',
      symbolColor: '#173449',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedAppUrl(targetUrl)) {
      event.preventDefault();
    }
  });

  const devServerUrl = trustedDevServerUrl(process.env.VITE_DEV_SERVER_URL);
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  workspaceStore = new WorkspaceStore(app.getPath('userData'));
  await workspaceStore.init();
  configureUpdaterEvents();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function registerIpcHandlers(): void {
  handleTrusted('chat:importFromDialog', async (): Promise<ImportResult | null> => {
    if (importInProgress) {
      throw new Error('Un import este deja in lucru. Asteapta finalizarea lui.');
    }

    const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
    if (!window) {
      throw new Error('Fereastra aplicatiei nu este disponibila.');
    }

    const result = await dialog.showOpenDialog(window, {
      title: 'Importa export WhatsApp',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'WhatsApp export', extensions: ['txt', 'zip'] },
        { name: 'Text files', extensions: ['txt'] },
        { name: 'Zip archives', extensions: ['zip'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    importInProgress = true;
    try {
      console.info(`[import] Reading ${result.filePaths.length} WhatsApp export file(s).`);
      return await importFilePaths(result.filePaths);
    } finally {
      importInProgress = false;
    }
  });

  handleTrusted('workspace:get', async (): Promise<WorkspaceSnapshot> => getStore().getSnapshot());

  handleTrusted('workspace:backup', async (): Promise<string | null> => {
    const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const options: Electron.SaveDialogOptions = {
      title: 'Salveaza backup workspace',
      defaultPath: `whatsapp-delivery-counter-backup-${new Date().toISOString().slice(0, 10)}.sqlite`,
      filters: [{ name: 'Workspace backup', extensions: ['sqlite'] }],
    };
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return null;
    }
    await getStore().backupToFile(result.filePath);
    return result.filePath;
  });

  handleTrusted('workspace:restore', async (): Promise<WorkspaceSnapshot | null> => {
    const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const options: Electron.OpenDialogOptions = {
      title: 'Restaureaza backup workspace',
      properties: ['openFile'],
      filters: [{ name: 'Workspace backup', extensions: ['sqlite'] }],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    await getStore().restoreFromFile(result.filePaths[0]);
    return getStore().getSnapshot();
  });

  handleTrusted('settings:save', async (_event, input: AppSettings): Promise<WorkspaceSnapshot> => {
    await getStore().saveSettings(input);
    return getStore().getSnapshot();
  });

  handleTrusted('updates:getStatus', async (): Promise<AppUpdateStatus> => refreshUpdateStatus());

  handleTrusted('updates:saveToken', async (_event, token: string): Promise<AppUpdateStatus> => {
    await saveUpdateToken(token);
    return setUpdateStatus('idle', 'Tokenul de update a fost salvat local.', { tokenConfigured: true });
  });

  handleTrusted('updates:clearToken', async (): Promise<AppUpdateStatus> => {
    await deleteUpdateToken();
    return setUpdateStatus('not-configured', 'Tokenul de update a fost sters.', { tokenConfigured: false });
  });

  handleTrusted('updates:check', async (): Promise<AppUpdateStatus> => {
    const token = await readUpdateToken();
    if (!token) {
      return setUpdateStatus('not-configured', 'Configureaza tokenul GitHub pentru update privat.');
    }
    if (!app.isPackaged) {
      return setUpdateStatus('idle', 'Update-ul automat functioneaza doar in aplicatia instalata.');
    }

    configureUpdaterFeed(token);
    setUpdateStatus('checking', 'Verific update-uri...');
    const result = await autoUpdater.checkForUpdates();
    return result?.updateInfo
      ? refreshUpdateStatus()
      : setUpdateStatus('not-available', 'Nu exista update disponibil.');
  });

  handleTrusted('updates:download', async (): Promise<AppUpdateStatus> => {
    const token = await readUpdateToken();
    if (!token) {
      return setUpdateStatus('not-configured', 'Configureaza tokenul GitHub pentru update privat.');
    }
    if (!app.isPackaged) {
      return setUpdateStatus('idle', 'Download-ul de update functioneaza doar in aplicatia instalata.');
    }

    configureUpdaterFeed(token);
    setUpdateStatus('downloading', 'Descarc update-ul...');
    await autoUpdater.downloadUpdate();
    return refreshUpdateStatus();
  });

  handleTrusted('updates:install', async (): Promise<void> => {
    autoUpdater.quitAndInstall(false, true);
  });

  handleTrusted('restaurants:save', async (_event, input: RestaurantInput): Promise<Restaurant> =>
    getStore().saveRestaurant(input),
  );

  handleTrusted('restaurants:delete', async (_event, restaurantId: string): Promise<void> =>
    getStore().deleteRestaurant(restaurantId),
  );

  handleTrusted('couriers:save', async (_event, input: CourierInput): Promise<Courier> =>
    getStore().saveCourier(input),
  );

  handleTrusted('couriers:delete', async (_event, courierId: string): Promise<void> =>
    getStore().deleteCourier(courierId),
  );

  handleTrusted('reports:save', async (_event, input: ReportInput): Promise<Report> =>
    getStore().saveReport(input),
  );

  handleTrusted('reports:delete', async (_event, reportId: string): Promise<WorkspaceSnapshot> => {
    await getStore().deleteReport(reportId);
    return getStore().getSnapshot();
  });

  handleTrusted('reports:import', async (_event, input: ReportImportInput): Promise<ReportImport | null> => {
    if (importInProgress) {
      throw new Error('Un import este deja in lucru. Asteapta finalizarea lui.');
    }

    const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
    if (!window) {
      throw new Error('Fereastra aplicatiei nu este disponibila.');
    }

    const result = await dialog.showOpenDialog(window, {
      title: 'Importa conversatie in raport',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'WhatsApp export', extensions: ['txt', 'zip'] },
        { name: 'Text files', extensions: ['txt'] },
        { name: 'Zip archives', extensions: ['zip'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    importInProgress = true;
    try {
      const importResult = await importFilePaths(result.filePaths);
      return await getStore().saveReportImport(input, importResult);
    } finally {
      importInProgress = false;
    }
  });

  handleTrusted('reports:deleteImport', async (_event, importId: string): Promise<WorkspaceSnapshot> => {
    await getStore().deleteReportImport(importId);
    return getStore().getSnapshot();
  });

  handleTrusted('reports:deleteAllImports', async (): Promise<WorkspaceSnapshot> => {
    await getStore().deleteAllReportImports();
    return getStore().getSnapshot();
  });

  handleTrusted('reports:deleteOldImports', async (_event, retentionDays: number): Promise<WorkspaceSnapshot> => {
    await getStore().deleteOldReportImports(retentionDays);
    return getStore().getSnapshot();
  });

  handleTrusted('reports:scan', async (_event, reportId: string, options: ScanOptions): Promise<ScanReport> => {
    const store = getStore();
    const report = store.getReport(reportId);
    if (!report) {
      throw new Error('Raportul selectat nu exista.');
    }

    const { messages, availabilityMessages } = materializeReportInputs(
      store.listReportImports(reportId),
      store.getSnapshot().restaurants,
      options,
    );
    const scanReport = buildScanReport(
      messages,
      { fromIso: report.fromIso, toIso: report.toIso },
      store.getAliasMap(),
      availabilityMessages,
      options,
    );
    await store.markReportScanned(reportId, scanReport.options);
    return scanReport;
  });

  handleTrusted('aliases:get', async (): Promise<AliasMap> => getStore().getAliasMap());

  handleTrusted('aliases:save', async (_event, aliases: AliasMap): Promise<AliasMap> => {
    const cleaned = sanitizeAliases(aliases);
    const saved = await getStore().saveAliasMap(cleaned);
    console.info(`[aliases] Saved ${Object.keys(saved).length} courier aliases.`);
    return saved;
  });
}

function handleTrusted<Args extends unknown[], Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result> | Result,
): void {
  ipcMain.handle(channel, async (event, ...args: Args) => {
    assertTrustedSender(event);
    return handler(event, ...args);
  });
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
  if (!isTrustedAppUrl(senderUrl)) {
    throw new Error('Cerere respinsa: fereastra aplicatiei nu este de incredere.');
  }
}

function trustedDevServerUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl || app.isPackaged) {
    return null;
  }

  if (!isTrustedDevUrl(rawUrl)) {
    throw new Error('VITE_DEV_SERVER_URL invalid. Aplicatia accepta doar http://127.0.0.1:3001 in development.');
  }

  return trustedDevServerOrigin;
}

function isTrustedAppUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'file:') {
      return path.resolve(fileURLToPath(parsed)).toLocaleLowerCase('en-US') ===
        trustedIndexFilePath().toLocaleLowerCase('en-US');
    }

    return !app.isPackaged && parsed.origin === trustedDevServerOrigin;
  } catch {
    return false;
  }
}

function trustedIndexFilePath(): string {
  return path.resolve(__dirname, '../../dist/index.html');
}

function isTrustedDevUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin === trustedDevServerOrigin;
  } catch {
    return false;
  }
}

interface SourceText {
  sourceFile: string;
  text: string;
  bytes: number;
  restaurantName?: string;
}

async function importFilePaths(filePaths: string[]): Promise<ImportResult> {
  if (filePaths.length > maxImportFileCount) {
    throw new Error(`Import prea mare. Alege maximum ${maxImportFileCount} fisiere odata.`);
  }

  const texts: SourceText[] = [];
  for (const filePath of filePaths) {
    texts.push(...(await readSourceTextsFromFile(filePath)));
  }

  if (texts.length === 0) {
    throw new Error('Nu am gasit niciun fisier .txt de WhatsApp in import.');
  }

  console.info(`[import] Parsed ${texts.length} text source(s) from selected file(s).`);
  return parseImportedTexts(texts);
}

async function readSourceTextsFromFile(filePath: string): Promise<SourceText[]> {
  const extension = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const fileInfo = await fs.stat(filePath);
  if (!fileInfo.isFile()) {
    throw new Error(`Calea ${fileName} nu este un fisier valid.`);
  }

  if (extension === '.txt') {
    if (fileInfo.size > maxTxtFileBytes) {
      throw new Error(`Fisierul ${fileName} este prea mare pentru import TXT.`);
    }

    const buffer = await fs.readFile(filePath);
    return [
      {
        sourceFile: fileName,
        text: buffer.toString('utf8'),
        bytes: buffer.byteLength,
      },
    ];
  }

  if (extension === '.zip') {
    if (fileInfo.size > maxZipFileBytes) {
      throw new Error(`Arhiva ${fileName} este prea mare pentru import ZIP.`);
    }

    const buffer = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const textEntries = Object.values(zip.files).filter(
      (entry) => !entry.dir && entry.name.toLowerCase().endsWith('.txt'),
    );

    if (textEntries.length === 0) {
      throw new Error('Arhiva ZIP nu contine niciun fisier .txt de WhatsApp.');
    }

    if (textEntries.length > maxZipTextEntries) {
      throw new Error(`Arhiva ${fileName} contine prea multe fisiere .txt.`);
    }

    const texts: SourceText[] = [];
    let totalTextBytes = 0;
    for (const entry of textEntries) {
      if (isUnsafeZipEntryName(entry.name)) {
        throw new Error(`Arhiva ${fileName} contine un nume de fisier nesigur.`);
      }

      const declaredSize = getZipEntryUncompressedSize(entry);
      if (declaredSize !== null && declaredSize > maxZipTextEntryBytes) {
        throw new Error(`Fisierul ${entry.name} din ZIP este prea mare.`);
      }

      const text = await entry.async('string');
      const bytes = Buffer.byteLength(text, 'utf8');
      if (bytes > maxZipTextEntryBytes) {
        throw new Error(`Fisierul ${entry.name} din ZIP este prea mare dupa dezarhivare.`);
      }

      totalTextBytes += bytes;
      if (totalTextBytes > maxZipTotalTextBytes) {
        throw new Error(`Arhiva ${fileName} depaseste limita totala de text dezarhivat.`);
      }

      texts.push({
        sourceFile: `${fileName}/${entry.name}`,
        text,
        bytes,
      });
    }

    console.info(`[import] ZIP contains ${texts.length} text file(s).`);
    return texts;
  }

  throw new Error('Tip de fisier invalid. Alege un export .txt sau .zip.');
}

function isUnsafeZipEntryName(entryName: string): boolean {
  const normalized = entryName.replace(/\\/g, '/');
  return (
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    normalized.split('/').some((part) => part === '..')
  );
}

function getZipEntryUncompressedSize(entry: JSZip.JSZipObject): number | null {
  const internalData = (entry as JSZip.JSZipObject & {
    _data?: { uncompressedSize?: unknown };
  })._data;
  const size = internalData?.uncompressedSize;
  return typeof size === 'number' && Number.isFinite(size) ? size : null;
}

async function readAliases(): Promise<AliasMap> {
  try {
    const raw = await fs.readFile(aliasFilePath(), 'utf8');
    return sanitizeAliases(JSON.parse(raw) as AliasMap);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }
    console.warn('[aliases] Could not read aliases; starting with empty map.', error);
    return {};
  }
}

function getStore(): WorkspaceStore {
  if (!workspaceStore) {
    throw new Error('Workspace-ul local nu este initializat.');
  }
  return workspaceStore;
}

function materializeReportInputs(
  imports: ReportImport[],
  restaurants: Restaurant[],
  options: ScanOptions,
): {
  messages: ParsedDeliveryMessage[];
  availabilityMessages: ParsedAvailabilityMessage[];
} {
  const selectedRestaurantIds =
    options.includeAllRestaurants === false ? new Set(options.restaurantIds ?? []) : null;
  const messages: ParsedDeliveryMessage[] = [];
  const availabilityMessages: ParsedAvailabilityMessage[] = [];

  for (const reportImport of imports) {
    const restaurant = reportImport.restaurantId
      ? restaurants.find((item) => item.id === reportImport.restaurantId)
      : null;
    const restaurantAllowed =
      !selectedRestaurantIds ||
      (reportImport.restaurantId ? selectedRestaurantIds.has(reportImport.restaurantId) : false);
    const displayName = restaurant?.name ?? reportImport.sourceLabel;

    if ((reportImport.role === 'restaurant' || reportImport.role === 'mixed') && restaurantAllowed) {
      messages.push(
        ...reportImport.importResult.messages.map((message) => ({
          ...message,
          restaurantId: reportImport.restaurantId ?? undefined,
          restaurantName: displayName,
        })),
      );
    }

    if (reportImport.role === 'workHours' || reportImport.role === 'mixed') {
      availabilityMessages.push(
        ...reportImport.importResult.availabilityMessages.map((message) => ({
          ...message,
          restaurantName: displayName,
        })),
      );
    }
  }

  return { messages, availabilityMessages };
}

function aliasFilePath(): string {
  return path.join(app.getPath('userData'), aliasFileName);
}

function updateTokenPath(): string {
  return path.join(app.getPath('userData'), updateTokenFileName);
}

function configureUpdaterEvents(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => {
    setUpdateStatus('checking', 'Verific update-uri...');
  });
  autoUpdater.on('update-not-available', () => {
    setUpdateStatus('not-available', 'Aplicatia este la zi.');
  });
  autoUpdater.on('update-available', (info) => {
    setUpdateStatus('available', `Versiunea ${info.version} este disponibila.`, {
      availableVersion: info.version,
    });
  });
  autoUpdater.on('download-progress', (info) => {
    setUpdateStatus('downloading', `Descarc update-ul: ${Math.round(info.percent)}%.`, {
      progressPercent: Math.round(info.percent),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateStatus('downloaded', `Update-ul ${info.version} este descarcat.`, {
      availableVersion: info.version,
      progressPercent: 100,
    });
  });
  autoUpdater.on('error', (error) => {
    setUpdateStatus('error', sanitizeUpdateError(error));
  });
}

function configureUpdaterFeed(token: string): void {
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: updateOwner,
    repo: updateRepo,
    private: true,
    token,
    releaseType: 'release',
  });
}

async function saveUpdateToken(token: string): Promise<void> {
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new Error('Tokenul GitHub este obligatoriu pentru update privat.');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Criptarea locala nu este disponibila pe acest sistem.');
  }
  const encrypted = safeStorage.encryptString(cleanToken);
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(updateTokenPath(), encrypted);
}

async function readUpdateToken(): Promise<string | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }
    const encrypted = await fs.readFile(updateTokenPath());
    return safeStorage.decryptString(encrypted).trim() || null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.warn('[updates] Could not read stored update token.', sanitizeUpdateError(error));
    }
    return null;
  }
}

async function deleteUpdateToken(): Promise<void> {
  try {
    await fs.unlink(updateTokenPath());
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

async function refreshUpdateStatus(): Promise<AppUpdateStatus> {
  return setUpdateStatus(updateStatus.state, updateStatus.message, {
    tokenConfigured: Boolean(await readUpdateToken()),
  });
}

function createUpdateStatus(state: AppUpdateState, message?: string): AppUpdateStatus {
  return {
    currentVersion: app.getVersion(),
    state,
    tokenConfigured: false,
    isPackaged: app.isPackaged,
    message,
  };
}

function setUpdateStatus(
  state: AppUpdateState,
  message?: string,
  patch: Partial<AppUpdateStatus> = {},
): AppUpdateStatus {
  updateStatus = {
    ...updateStatus,
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    state,
    message,
    ...patch,
  };
  mainWindow?.webContents.send('updates:status', updateStatus);
  return updateStatus;
}

function sanitizeUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(token\\s+|Bearer\\s+|gh[pousr]_[A-Za-z0-9_]+)/gi, '[token ascuns]');
}

function sanitizeAliases(aliases: AliasMap): AliasMap {
  return Object.fromEntries(
    Object.entries(aliases)
      .map(([sender, displayName]) => [sender.trim(), displayName.trim()] as const)
      .filter(([sender, displayName]) => sender.length > 0 && displayName.length > 0),
  );
}

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  AliasMap,
  Courier,
  CourierInput,
  DeliveryCounterApi,
  ImportResult,
  Report,
  ReportImport,
  ReportImportInput,
  ReportInput,
  Restaurant,
  RestaurantInput,
  AppSettings,
  AppUpdateStatus,
  ScanOptions,
  ScanReport,
  WorkspaceSnapshot,
} from '../src/shared/types';

const api: DeliveryCounterApi = {
  importFromDialog: (): Promise<ImportResult | null> => ipcRenderer.invoke('chat:importFromDialog'),
  getWorkspace: (): Promise<WorkspaceSnapshot> => ipcRenderer.invoke('workspace:get'),
  backupWorkspace: (): Promise<string | null> => ipcRenderer.invoke('workspace:backup'),
  restoreWorkspace: (): Promise<WorkspaceSnapshot | null> => ipcRenderer.invoke('workspace:restore'),
  saveSettings: (settings: AppSettings): Promise<WorkspaceSnapshot> =>
    ipcRenderer.invoke('settings:save', settings),
  saveRestaurant: (input: RestaurantInput): Promise<Restaurant> =>
    ipcRenderer.invoke('restaurants:save', input),
  deleteRestaurant: (restaurantId: string): Promise<void> =>
    ipcRenderer.invoke('restaurants:delete', restaurantId),
  saveCourier: (input: CourierInput): Promise<Courier> => ipcRenderer.invoke('couriers:save', input),
  deleteCourier: (courierId: string): Promise<void> => ipcRenderer.invoke('couriers:delete', courierId),
  saveReport: (input: ReportInput): Promise<Report> => ipcRenderer.invoke('reports:save', input),
  deleteReport: (reportId: string): Promise<WorkspaceSnapshot> =>
    ipcRenderer.invoke('reports:delete', reportId),
  importToReport: (input: ReportImportInput): Promise<ReportImport | null> =>
    ipcRenderer.invoke('reports:import', input),
  deleteReportImport: (importId: string): Promise<WorkspaceSnapshot> =>
    ipcRenderer.invoke('reports:deleteImport', importId),
  deleteAllReportImports: (): Promise<WorkspaceSnapshot> =>
    ipcRenderer.invoke('reports:deleteAllImports'),
  deleteOldReportImports: (retentionDays: number): Promise<WorkspaceSnapshot> =>
    ipcRenderer.invoke('reports:deleteOldImports', retentionDays),
  scanSavedReport: (reportId: string, options: ScanOptions): Promise<ScanReport> =>
    ipcRenderer.invoke('reports:scan', reportId, options),
  getAliases: (): Promise<AliasMap> => ipcRenderer.invoke('aliases:get'),
  saveAliases: (aliases: AliasMap): Promise<AliasMap> => ipcRenderer.invoke('aliases:save', aliases),
  getUpdateStatus: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updates:getStatus'),
  saveUpdateToken: (token: string): Promise<AppUpdateStatus> =>
    ipcRenderer.invoke('updates:saveToken', token),
  clearUpdateToken: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updates:clearToken'),
  checkForUpdates: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updates:check'),
  downloadUpdate: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updates:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (listener: (status: AppUpdateStatus) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, status: AppUpdateStatus): void => listener(status);
    ipcRenderer.on('updates:status', wrapped);
    return () => ipcRenderer.removeListener('updates:status', wrapped);
  },
};

contextBridge.exposeInMainWorld('deliveryCounter', api);

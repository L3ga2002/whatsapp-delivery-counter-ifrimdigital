import { useEffect, useMemo, useRef, useState } from 'react';
import type ExcelJS from 'exceljs';
import { DayPicker } from 'react-day-picker';
import { ro } from 'date-fns/locale';
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  FileArchive,
  LayoutDashboard,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Upload,
  UsersRound,
} from 'lucide-react';
import type {
  Courier,
  CourierInput,
  DailyCourierSummary,
  ExportOptions,
  AppSettings,
  AppUpdateStatus,
  Report,
  ReportImport,
  ReportImportRole,
  Restaurant,
  RestaurantInput,
  RestaurantTariffPolicy,
  PayrollCalculationMode,
  PayrollPaymentMethod,
  MetricSourceKey,
  MetricSourceRecord,
  ReviewRow,
  ScanOptions,
  ScanReport,
  WorkspaceSnapshot,
} from '../shared/types';
import { collectDetectedCourierIdentities } from '../shared/courier-identities';
import {
  buildPayrollResult,
  fromBani,
  mergePayrollSettings,
  resolveCourierRule,
  resolveRestaurantMethod,
} from '../shared/payroll';

const uiOperationWatchdogMs = 120_000;
const workspaceReloadTimeoutMs = 30_000;

const defaultScanOptions: ScanOptions = {
  scanOrders: true,
  scanWorkHours: false,
  scanDeliveryTimes: true,
  includeAllRestaurants: true,
  restaurantIds: [],
};

const defaultExportOptions: ExportOptions = {
  scope: 'full',
  restaurantIds: [],
};

const scheduleHours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
const scheduleMinutes = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0'));

type ViewId = 'dashboard' | 'reports' | 'restaurants' | 'couriers' | 'settings';
type Notice = { kind: 'error' | 'success' | 'info'; text: string } | null;
type ImportRange = { fromIso: string; toIso: string; deliveryCount: number; availabilityCount: number };
type ImportUiMode = 'restaurant' | 'workHours';
type ReportStep = 'interval' | 'imports' | 'review-imports' | 'scan' | 'results';
type ResultTab = 'couriers' | 'restaurants' | 'daily' | 'night' | 'times' | 'workHours' | 'review';

export default function App(): JSX.Element {
  const desktopApi = window.deliveryCounter;
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [activeView, setActiveView] = useState<ViewId>('dashboard');
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [report, setReport] = useState<ScanReport | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [scanOptions, setScanOptions] = useState<ScanOptions>(defaultScanOptions);
  const [exportOptions, setExportOptions] = useState<ExportOptions>(defaultExportOptions);
  const [activeReviewRow, setActiveReviewRow] = useState<ReviewRow | null>(null);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null);

  const selectedReport = workspace?.reports.find((item) => item.id === selectedReportId) ?? null;
  const selectedReportImports = useMemo(
    () => workspace?.reportImports.filter((item) => item.reportId === selectedReportId) ?? [],
    [selectedReportId, workspace],
  );

  useEffect(() => {
    void reloadWorkspace();
  }, []);

  useEffect(() => {
    if (!desktopApi) {
      return;
    }
    void desktopApi.getUpdateStatus().then(setUpdateStatus).catch(() => undefined);
    return desktopApi.onUpdateStatus(setUpdateStatus);
  }, [desktopApi]);

  useEffect(() => {
    if (!isBusy) return;
    const timeout = window.setTimeout(() => {
      setIsBusy(false);
      setNotice({
        kind: 'error',
        text: 'Operatiunea a durat prea mult si interfata a fost deblocata. Apasa Reincarca si verifica rezultatul inainte sa retrimiti actiunea.',
      });
    }, uiOperationWatchdogMs);
    return () => window.clearTimeout(timeout);
  }, [isBusy]);

  useEffect(() => {
    if (!workspace) {
      return;
    }
    if (!selectedReportId && workspace.reports[0]) {
      setSelectedReportId(workspace.reports[0].id);
      setScanOptions(workspace.reports[0].scanOptions);
    }
  }, [selectedReportId, workspace]);

  const reloadWorkspace = async (): Promise<void> => {
    if (!desktopApi) {
      setNotice({ kind: 'error', text: 'Aplicatia trebuie rulata in Electron pentru workspace local.' });
      return;
    }
    try {
      const nextWorkspace = await withTimeout(
        desktopApi.getWorkspace(),
        workspaceReloadTimeoutMs,
        'Workspace-ul nu a raspuns la timp.',
      );
      setWorkspace(nextWorkspace);
      if (selectedReportId) {
        const nextSelected = nextWorkspace.reports.find((item) => item.id === selectedReportId);
        if (nextSelected) {
          setScanOptions(nextSelected.scanOptions);
        }
      }
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut incarca workspace-ul.') });
    }
  };

  const handleSaveRestaurant = async (input: RestaurantInput): Promise<Restaurant | null> => {
    if (!desktopApi || isBusy) {
      return null;
    }
    setIsBusy(true);
    try {
      const saved = await desktopApi.saveRestaurant(input);
      await reloadWorkspace();
      setNotice({ kind: 'success', text: 'Restaurant salvat.' });
      return saved;
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut salva restaurantul.') });
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteRestaurant = async (restaurantId: string): Promise<void> => {
    if (!desktopApi || isBusy || !workspace) {
      return;
    }
    const restaurant = workspace.restaurants.find((item) => item.id === restaurantId);
    if (!restaurant) {
      setNotice({ kind: 'error', text: 'Restaurantul selectat nu mai exista in workspace.' });
      return;
    }
    const isUsed = workspace.reportImports.some((item) => item.restaurantId === restaurantId);
    const confirmed = window.confirm(
      isUsed
        ? `Restaurantul "${restaurant.name}" este folosit in rapoarte/importuri. Il dezactivez pentru importuri noi, dar pastrez istoricul. Continui?`
        : `Stergi restaurantul "${restaurant.name}" din workspace?`,
    );
    if (!confirmed) {
      return;
    }
    setIsBusy(true);
    try {
      await desktopApi.deleteRestaurant(restaurantId);
      await reloadWorkspace();
      setNotice({
        kind: 'success',
        text: isUsed ? 'Restaurant sters. Importurile istorice raman lizibile in rapoarte.' : 'Restaurant sters.',
      });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut sterge restaurantul.') });
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveCourier = async (input: CourierInput): Promise<boolean> => {
    if (!desktopApi || isBusy) {
      return false;
    }
    setIsBusy(true);
    try {
      await withTimeout(
        desktopApi.saveCourier(input),
        workspaceReloadTimeoutMs,
        'Salvarea curierului nu a raspuns la timp. Verifica lista inainte sa incerci din nou.',
      );
      await reloadWorkspace();
      if (selectedReport) {
        const rescanned = await withTimeout(
          desktopApi.scanSavedReport(selectedReport.id, scanOptions),
          workspaceReloadTimeoutMs,
          'Raportul nu a putut fi actualizat automat dupa salvarea curierului.',
        );
        setReport(rescanned);
      } else {
        setReport(null);
      }
      setActiveReviewRow(null);
      setNotice({ kind: 'success', text: selectedReport ? 'Curier salvat. Raportul deschis a fost actualizat cu noul alias.' : 'Curier salvat. La urmatoarea scanare, raportul va folosi noul alias.' });
      return true;
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut salva curierul.') });
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteCourier = async (courierId: string): Promise<void> => {
    if (!desktopApi || isBusy || !workspace) {
      return;
    }
    const courier = workspace.couriers.find((item) => item.id === courierId);
    if (!courier) {
      setNotice({ kind: 'error', text: 'Curierul selectat nu mai exista in workspace.' });
      return;
    }
    const confirmed = window.confirm(`Stergi definitiv curierul "${courier.name}"? Asocierea poate fi facuta din nou ulterior.`);
    if (!confirmed) {
      return;
    }
    const reportIdToRescan = selectedReport?.id;
    const scanOptionsToUse = scanOptions;
    setIsBusy(true);
    try {
      try {
        await desktopApi.deleteCourier(courierId);
        await reloadWorkspace();
      } catch (error) {
        setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut sterge curierul.') });
        return;
      }

      try {
        if (reportIdToRescan) {
          const rescanned = await withTimeout(
            desktopApi.scanSavedReport(reportIdToRescan, scanOptionsToUse),
            workspaceReloadTimeoutMs,
            'Raportul nu a putut fi actualizat automat dupa stergerea curierului.',
          );
          setReport(rescanned);
        } else {
          setReport(null);
        }
        setActiveReviewRow(null);
        setNotice({
          kind: 'success',
          text: reportIdToRescan
            ? 'Curier sters. Raportul deschis a fost recalculat fara aliasurile lui.'
            : 'Curier sters. La urmatoarea scanare, raportul nu va mai folosi aliasurile lui.',
        });
      } catch (error) {
        setReport(null);
        setActiveReviewRow(null);
        setNotice({
          kind: 'info',
          text: `${getErrorMessage(error, 'Raportul nu a putut fi actualizat automat.')} Curierul a fost sters; raportul ramane draft si trebuie scanat manual.`,
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveReport = async (input: {
    id?: string;
    name: string;
    from: string;
    to: string;
  }): Promise<void> => {
    if (!desktopApi || isBusy) {
      return;
    }
    try {
      const fromDate = new Date(input.from);
      const toDate = new Date(input.to);
      const validation = validateReportInput(input.name, fromDate, toDate);
      if (validation) {
        setNotice({ kind: 'error', text: validation });
        return;
      }
      setIsBusy(true);
      const saved = await desktopApi.saveReport({
        id: input.id,
        name: input.name.trim(),
        fromIso: fromDate.toISOString(),
        toIso: toDate.toISOString(),
        scanOptions,
      });
      setSelectedReportId(saved.id);
      setReport(null);
      await reloadWorkspace();
      setNotice({ kind: 'success', text: input.id ? 'Raport actualizat.' : 'Raport salvat.' });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut salva raportul.') });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteReport = async (reportToDelete: Report): Promise<void> => {
    if (!desktopApi || isBusy) {
      return;
    }
    const importCount = workspace?.reportImports.filter((item) => item.reportId === reportToDelete.id).length ?? 0;
    const confirmed = window.confirm(
      `Stergi raportul "${reportToDelete.name}"?${importCount ? ` Se sterg si cele ${importCount} importuri/conversatii atasate acestui raport.` : ''}`,
    );
    if (!confirmed) {
      return;
    }
    setIsBusy(true);
    try {
      const nextWorkspace = await desktopApi.deleteReport(reportToDelete.id);
      const nextReport = nextWorkspace.reports.find((item) => item.id !== reportToDelete.id) ?? nextWorkspace.reports[0] ?? null;
      setWorkspace(nextWorkspace);
      setSelectedReportId(nextReport?.id ?? '');
      setScanOptions(nextReport?.scanOptions ?? defaultScanOptions);
      setReport(null);
      setActiveReviewRow(null);
      setNotice({ kind: 'success', text: 'Raport sters.' });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut sterge raportul.') });
    } finally {
      setIsBusy(false);
    }
  };

  const handleImportToReport = async (role: ReportImportRole, restaurantId: string): Promise<void> => {
    if (!desktopApi || !selectedReport || isBusy) {
      return;
    }
    if (role === 'restaurant' && !restaurantId) {
      setNotice({ kind: 'error', text: 'Selecteaza restaurantul pentru import.' });
      return;
    }
    setIsBusy(true);
    try {
      const imported = await desktopApi.importToReport({
        reportId: selectedReport.id,
        role,
        restaurantId: restaurantId || null,
      });
      if (imported) {
        await reloadWorkspace();
        setReport(null);
        setNotice({ kind: 'success', text: `Import atasat: ${imported.messageCount} comenzi, ${imported.availabilityMessageCount} pontaj.` });
      }
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Importul a esuat.') });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteReportImport = async (importItem: ReportImport): Promise<void> => {
    if (!desktopApi || isBusy) {
      return;
    }

    const confirmed = window.confirm(
      `Sterg importul "${importItem.sourceLabel}" din raport? Conversatia salvata local pentru acest import va fi eliminata.`,
    );
    if (!confirmed) {
      return;
    }

    setIsBusy(true);
    try {
      const nextWorkspace = await desktopApi.deleteReportImport(importItem.id);
      setWorkspace(nextWorkspace);
      setReport(null);
      setActiveReviewRow(null);
      setNotice({ kind: 'success', text: 'Import sters din raport.' });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut sterge importul.') });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteAllImports = async (): Promise<void> => {
    if (!desktopApi || isBusy || !workspace) {
      return;
    }
    const importCount = workspace.reportImports.length;
    if (importCount === 0) {
      setNotice({ kind: 'info', text: 'Nu exista conversatii salvate local.' });
      return;
    }
    const confirmed = window.confirm(
      `Stergi toate cele ${importCount} importuri/conversatii salvate local? Restaurantele, curierii si rapoartele raman, dar va trebui sa reimporti conversatiile pentru scanari noi.`,
    );
    if (!confirmed) {
      return;
    }
    setIsBusy(true);
    try {
      const nextWorkspace = await desktopApi.deleteAllReportImports();
      setWorkspace(nextWorkspace);
      setReport(null);
      setActiveReviewRow(null);
      setNotice({ kind: 'success', text: 'Conversatiile/importurile salvate local au fost sterse.' });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut sterge importurile salvate.') });
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveSettings = async (settings: AppSettings): Promise<void> => {
    if (!desktopApi || isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      const nextWorkspace = await desktopApi.saveSettings(settings);
      setWorkspace(nextWorkspace);
      setNotice({ kind: 'success', text: 'Setari salvate.' });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut salva setarile.') });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteOldImports = async (retentionDays: number): Promise<void> => {
    if (!desktopApi || isBusy || !workspace) {
      return;
    }
    const confirmed = window.confirm(
      `Stergi conversatiile/importurile mai vechi de ${retentionDays} zile? Restaurantele, curierii si rapoartele raman in workspace.`,
    );
    if (!confirmed) {
      return;
    }
    setIsBusy(true);
    try {
      const nextWorkspace = await desktopApi.deleteOldReportImports(retentionDays);
      setWorkspace(nextWorkspace);
      setReport(null);
      setActiveReviewRow(null);
      setNotice({ kind: 'success', text: `Conversatiile mai vechi de ${retentionDays} zile au fost sterse.` });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut sterge importurile vechi.') });
    } finally {
      setIsBusy(false);
    }
  };

  const handleBackupWorkspace = async (): Promise<void> => {
    if (!desktopApi || isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      const backupPath = await desktopApi.backupWorkspace();
      if (backupPath) {
        setNotice({ kind: 'success', text: `Backup salvat: ${backupPath}` });
      }
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut salva backup-ul.') });
    } finally {
      setIsBusy(false);
    }
  };

  const handleRestoreWorkspace = async (): Promise<void> => {
    if (!desktopApi || isBusy) {
      return;
    }
    const confirmed = window.confirm(
      'Restaurezi un backup local? Workspace-ul curent va fi inlocuit, iar aplicatia pastreaza automat o copie inainte de restore.',
    );
    if (!confirmed) {
      return;
    }
    setIsBusy(true);
    try {
      const nextWorkspace = await desktopApi.restoreWorkspace();
      if (nextWorkspace) {
        setWorkspace(nextWorkspace);
        setSelectedReportId(nextWorkspace.reports[0]?.id ?? '');
        setReport(null);
        setActiveReviewRow(null);
        setNotice({ kind: 'success', text: 'Workspace restaurat din backup.' });
      }
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut restaura backup-ul.') });
    } finally {
      setIsBusy(false);
    }
  };

  const handleCheckForUpdates = async (): Promise<void> => {
    if (!desktopApi || isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      const status = await desktopApi.checkForUpdates();
      setUpdateStatus(status);
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut verifica update-urile.') });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDownloadUpdate = async (): Promise<void> => {
    if (!desktopApi || isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      const status = await desktopApi.downloadUpdate();
      setUpdateStatus(status);
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut descarca update-ul.') });
    } finally {
      setIsBusy(false);
    }
  };

  const handleInstallUpdate = async (): Promise<void> => {
    if (!desktopApi || isBusy) {
      return;
    }
    await desktopApi.installUpdate();
  };

  const handleScanReport = async (): Promise<void> => {
    if (!desktopApi || !selectedReport || isBusy) {
      return;
    }
    const validation = validateScanOptions(scanOptions);
    if (validation) {
      setNotice({ kind: 'error', text: validation });
      return;
    }
    const importValidation = validateScanImports(scanOptions, selectedReportImports);
    if (importValidation) {
      setNotice({ kind: 'error', text: importValidation });
      return;
    }
    const fromMs = Date.parse(selectedReport.fromIso);
    const toMs = Date.parse(selectedReport.toIso);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      setNotice({ kind: 'error', text: 'Raportul selectat are interval invalid. Actualizeaza intai intervalul raportului selectat.' });
      return;
    }
    setIsBusy(true);
    try {
      const nextReport = await desktopApi.scanSavedReport(selectedReport.id, scanOptions);
      setReport(nextReport);
      setActiveReviewRow(null);
      await reloadWorkspace();
      setNotice({
        kind: 'success',
        text: `Scan complet: ${nextReport.totalPickedUp} comenzi zi, ${nextReport.totalNightPickedUp} comenzi noapte, ${nextReport.summaries.length} curieri detectati.`,
      });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Scanarea raportului a esuat.') });
    } finally {
      setIsBusy(false);
    }
  };

  const handleScanOptionsChange = (options: ScanOptions): void => {
    setScanOptions(options);
    setReport(null);
    setActiveReviewRow(null);
  };

  const handleExportXlsx = async (overrideOptions?: ExportOptions): Promise<void> => {
    if (!report || !workspace) {
      return;
    }
    const effectiveOptions = overrideOptions ?? exportOptions;
    setIsExporting(true);
    try {
      const { default: excel } = await import('exceljs');
      const scopedReport = createScopedReport(report, effectiveOptions, workspace.restaurants);
      const workbook = buildReportWorkbook(
        scopedReport,
        excel,
        effectiveOptions,
        workspace.restaurants,
        workspace.couriers,
        workspace.settings,
      );
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `raport-whatsapp-${formatFileDate(new Date())}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice({ kind: 'success', text: 'Raportul Excel a fost generat.' });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut genera Excelul.') });
    } finally {
      setIsExporting(false);
    }
  };

  if (!workspace) {
    return (
      <main className="workspace-app loading-app">
        <Loader2 className="spin" aria-hidden="true" />
        <span>Incarc workspace-ul local...</span>
      </main>
    );
  }

  return (
    <main className="workspace-app">
      <aside className="sidebar">
        <div className="brand-block">
          <span>IfrimDigital</span>
          <strong>WhatsApp Delivery Counter</strong>
        </div>
        <nav className="sidebar-nav" aria-label="Navigatie aplicatie">
          <NavButton icon={<LayoutDashboard />} label="Dashboard" active={activeView === 'dashboard'} onClick={() => setActiveView('dashboard')} />
          <NavButton icon={<FileArchive />} label="Rapoarte" active={activeView === 'reports'} onClick={() => setActiveView('reports')} />
          <NavButton icon={<Building2 />} label="Restaurante" active={activeView === 'restaurants'} onClick={() => setActiveView('restaurants')} />
          <NavButton icon={<UsersRound />} label="Curieri" active={activeView === 'couriers'} onClick={() => setActiveView('couriers')} />
          <NavButton icon={<Settings />} label="Setari" active={activeView === 'settings'} onClick={() => setActiveView('settings')} />
        </nav>
      </aside>

      <section className="workspace-main">
        <header className="workspace-header">
          <div>
            <p className="eyebrow large">IfrimDigital</p>
            <h1>Professional Reporting Workspace</h1>
          </div>
          <button className="secondary-button" type="button" disabled={isBusy} onClick={() => void reloadWorkspace()}>
            <RefreshCw aria-hidden="true" />
            <span>Reincarca</span>
          </button>
        </header>

        {notice ? <NoticeBanner notice={notice} /> : null}

        {activeView === 'dashboard' ? (
          <DashboardView
            workspace={workspace}
            selectedReport={selectedReport}
            report={report}
            onOpenReports={() => setActiveView('reports')}
          />
        ) : null}
        {activeView === 'restaurants' ? (
          <RestaurantsView
            restaurants={workspace.restaurants}
            onSave={handleSaveRestaurant}
            onDelete={handleDeleteRestaurant}
            isBusy={isBusy}
          />
        ) : null}
        {activeView === 'couriers' ? (
          <CouriersView
            couriers={workspace.couriers}
            reportImports={workspace.reportImports}
            onSave={handleSaveCourier}
            onDelete={handleDeleteCourier}
            isBusy={isBusy}
          />
        ) : null}
        {activeView === 'reports' ? (
          <ReportsView
            workspace={workspace}
            selectedReportId={selectedReportId}
            onSelectReport={(nextId) => {
              setSelectedReportId(nextId);
              setReport(null);
              const nextReport = workspace.reports.find((item) => item.id === nextId);
              if (nextReport) {
                setScanOptions(nextReport.scanOptions);
              }
            }}
            selectedReport={selectedReport}
            selectedReportImports={selectedReportImports}
            report={report}
            scanOptions={scanOptions}
            setScanOptions={handleScanOptionsChange}
            exportOptions={exportOptions}
            setExportOptions={setExportOptions}
            activeReviewRow={activeReviewRow}
            setActiveReviewRow={setActiveReviewRow}
            onSaveReport={handleSaveReport}
            onDeleteReport={handleDeleteReport}
            onCreateRestaurant={handleSaveRestaurant}
            onImport={handleImportToReport}
            onDeleteImport={handleDeleteReportImport}
            onScan={handleScanReport}
            onExport={handleExportXlsx}
            isBusy={isBusy}
            isExporting={isExporting}
          />
        ) : null}
        {activeView === 'settings' ? (
          <SettingsView
            workspace={workspace}
            updateStatus={updateStatus}
            onBackupWorkspace={handleBackupWorkspace}
            onRestoreWorkspace={handleRestoreWorkspace}
            onSaveSettings={handleSaveSettings}
            onCheckForUpdates={handleCheckForUpdates}
            onDownloadUpdate={handleDownloadUpdate}
            onInstallUpdate={handleInstallUpdate}
            onDeleteAllImports={handleDeleteAllImports}
            onDeleteOldImports={handleDeleteOldImports}
            isBusy={isBusy}
          />
        ) : null}
      </section>
    </main>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: JSX.Element;
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button className={`nav-button ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function DashboardView({
  workspace,
  selectedReport,
  report,
  onOpenReports,
}: {
  workspace: WorkspaceSnapshot;
  selectedReport: Report | null;
  report: ScanReport | null;
  onOpenReports: () => void;
}): JSX.Element {
  return (
    <div className="view-stack">
      <section className="metrics-row">
        <Metric label="Restaurante active" value={workspace.restaurants.filter((restaurant) => restaurant.isActive).length} />
        <Metric label="Curieri salvati" value={workspace.couriers.length} />
        <Metric label="Rapoarte" value={workspace.reports.length} />
        <Metric label="Parser" value={workspace.parserVersion.version} />
      </section>
      <section className="panel hero-panel">
        <div>
          <h2>{selectedReport ? selectedReport.name : 'Creeaza primul raport'}</h2>
          <p>
            Workspace-ul salveaza restaurante, curieri, importuri si rapoarte. Raportul curent poate agrega toate restaurantele si poate exporta doar ce alege clientul.
          </p>
        </div>
        <button className="primary-button" type="button" onClick={onOpenReports}>
          <FileArchive aria-hidden="true" />
          <span>Deschide rapoarte</span>
        </button>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <h2>Ghid rapid</h2>
            <p>Flux recomandat pentru raportul saptamanal al clientului.</p>
          </div>
        </div>
        <div className="quick-guide">
          <div><strong>1</strong><span>Alege intervalul exact al raportului.</span></div>
          <div><strong>2</strong><span>Importa conversatiile fiecarui restaurant.</span></div>
          <div><strong>3</strong><span>Scaneaza raportul si verifica randurile Review.</span></div>
          <div><strong>4</strong><span>Descarca Excel complet sau doar pe restaurant.</span></div>
        </div>
      </section>
      {report ? (
        <section className="metrics-row">
          <Metric label="Total zi" value={report.totalPickedUp} />
          <Metric label="Total noapte" value={report.totalNightPickedUp} />
          <Metric label="Ore lucrate" value={formatWorkMinutes(report.totalWorkMinutes)} />
          <Metric label="Review" value={report.reviewRows.length} />
        </section>
      ) : null}
    </div>
  );
}

function RestaurantsView({
  restaurants,
  onSave,
  onDelete,
  isBusy,
}: {
  restaurants: Restaurant[];
  onSave: (input: RestaurantInput) => Promise<Restaurant | null>;
  onDelete: (restaurantId: string) => Promise<void>;
  isBusy: boolean;
}): JSX.Element {
  const emptyDraft: {
    id: string;
    name: string;
    openingTime: string;
    closingTime: string;
    tariffPolicy: RestaurantTariffPolicy;
    closesNextDay: boolean;
    usesRestaurantOrderTimeForNightTariff: boolean;
  } = {
    id: '',
    name: '',
    openingTime: '10:00',
    closingTime: '23:00',
    tariffPolicy: 'day_only' as const,
    closesNextDay: false,
    usesRestaurantOrderTimeForNightTariff: false,
  };
  const [draft, setDraft] = useState(emptyDraft);
  const [initialDraft, setInitialDraft] = useState(emptyDraft);
  const isEditing = Boolean(draft.id);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
  const closesNextDayAutomatically = isScheduleOvernight(draft.openingTime, draft.closingTime);
  const closesAtMidnight = draft.closingTime === '00:00';
  const usesNightTariff = draft.tariffPolicy === 'night_after_23';

  const resetDraft = (): void => {
    setDraft(emptyDraft);
    setInitialDraft(emptyDraft);
  };

  const editRestaurant = (restaurantId: string): void => {
    const restaurant = restaurants.find((item) => item.id === restaurantId);
    if (!restaurant) return;
    if (isDirty && !window.confirm('Ai modificari nesalvate. Renunti la ele?')) return;
    const nextDraft = {
      id: restaurant.id,
      name: restaurant.name,
      openingTime: restaurant.schedule.openingTime,
      closingTime: restaurant.schedule.closingTime,
      tariffPolicy: restaurant.schedule.tariffPolicy
        ?? (restaurant.schedule.closesNextDay && restaurant.schedule.closingTime !== '00:00' ? 'night_after_23' : 'day_only'),
      closesNextDay: restaurant.schedule.closesNextDay,
      usesRestaurantOrderTimeForNightTariff: restaurant.schedule.usesRestaurantOrderTimeForNightTariff,
    };
    setDraft(nextDraft);
    setInitialDraft(nextDraft);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="view-stack">
      <section className="panel" aria-busy={isBusy}>
        <div className="panel-heading">
          <Building2 aria-hidden="true" />
          <div>
            <h2>{isEditing ? 'Editeaza restaurant' : 'Adauga restaurant'}</h2>
            <p>Pastrezi numele si programul. Programul se aplica automat cand importi conversatia restaurantului.</p>
          </div>
        </div>
        <div className="form-grid two-columns">
          <label>Nume restaurant<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Deschide la<ScheduleTimePicker value={draft.openingTime} onChange={(value) => setDraft((current) => ({ ...current, openingTime: value }))} /></label>
          <label>Inchide la<ScheduleTimePicker value={draft.closingTime} onChange={(value) => setDraft((current) => ({ ...current, closingTime: value }))} /></label>
          <label>Clasificare tarif
            <select value={draft.tariffPolicy} onChange={(event) => setDraft((current) => ({
              ...current,
              tariffPolicy: event.target.value === 'night_after_23' ? 'night_after_23' : 'day_only',
            }))}>
              <option value="day_only">Doar tarif zi, pana la inchidere</option>
              <option value="night_after_23">Tarif noapte dupa 23:00</option>
            </select>
          </label>
          {closesNextDayAutomatically ? <p className="schedule-rule-note">{closesAtMidnight
            ? 'Programul se incheie la miezul noptii. Ramane tarif zi pana la inchidere.'
            : usesNightTariff
              ? 'Programul trece dupa miezul noptii. Tariful noapte este activ dupa 23:00; o comanda sigur asociata cu un mesaj al restaurantului anterior ramane tarif zi.'
              : 'Programul trece dupa miezul noptii, dar ramane tarif zi pana la ora de inchidere.'}</p> : null}
        </div>
        <div className="form-actions">
          <button className="primary-button" type="button" disabled={isBusy} onClick={async () => {
            const saved = await onSave({
              id: draft.id || undefined,
              name: draft.name,
              aliases: [],
              notes: '',
              schedule: {
                openingTime: draft.openingTime,
                closingTime: draft.closingTime,
                tariffPolicy: draft.tariffPolicy,
                closesNextDay: closesNextDayAutomatically,
                usesRestaurantOrderTimeForNightTariff: usesNightTariff,
              },
            });
            if (saved) resetDraft();
          }}><CheckCircle2 aria-hidden="true" /><span>Salveaza restaurantul</span></button>
          {isEditing ? <button className="secondary-button" type="button" disabled={isBusy} onClick={resetDraft}>Renunta</button> : null}
        </div>
      </section>
      <EntityTable
        title="Restaurante"
        emptyText="Nu exista restaurante salvate."
        rows={restaurants.map((restaurant) => ({
          id: restaurant.id,
          primary: restaurant.name,
          secondary: `${restaurant.schedule.openingTime} - ${restaurant.schedule.closingTime}${restaurant.schedule.closingTime === '00:00' ? ' (pana la miezul noptii)' : restaurant.schedule.closesNextDay ? ' (dupa miezul noptii)' : ''}`,
          meta: restaurant.schedule.tariffPolicy === 'night_after_23'
            ? 'tarif noapte dupa 23:00'
            : restaurant.isActive ? 'tarif zi pana la inchidere' : 'inactiv',
          inactive: !restaurant.isActive,
        }))}
        onEdit={editRestaurant}
        onDelete={onDelete}
        deleteLabel="Sterge"
        disabled={isBusy}
      />
    </div>
  );
}

function CouriersView({
  couriers,
  reportImports,
  onSave,
  onDelete,
  isBusy,
}: {
  couriers: Courier[];
  reportImports: ReportImport[];
  onSave: (input: CourierInput) => Promise<boolean>;
  onDelete: (courierId: string) => Promise<void>;
  isBusy: boolean;
}): JSX.Element {
  const emptyDraft = { id: '', name: '', phone: '', aliases: '', notes: '' };
  const [draft, setDraft] = useState(emptyDraft);
  const [initialDraft, setInitialDraft] = useState(emptyDraft);
  const [detectedIdentity, setDetectedIdentity] = useState('');
  const [targetCourierId, setTargetCourierId] = useState('');
  const isEditing = Boolean(draft.id);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
  const detectedIdentities = useMemo(
    () => collectDetectedCourierIdentities(reportImports, couriers),
    [couriers, reportImports],
  );
  const unassignedIdentities = detectedIdentities.filter((identity) => !identity.mappedCourierId);
  const activeCouriers = couriers.filter((courier) => courier.isActive);

  const resetDraft = (): void => {
    setDraft(emptyDraft);
    setInitialDraft(emptyDraft);
  };

  const confirmDiscard = (): boolean => (
    !isDirty || window.confirm('Ai modificari nesalvate. Renunti la ele?')
  );

  return (
    <div className="view-stack">
      <EntityForm
        title={isEditing ? 'Editeaza curier' : 'Adauga curier'}
        description="Salveaza doar numele afisat in raport. Numele sau numarul exact din WhatsApp il asociezi separat, mai jos."
        disabled={isBusy}
        fields={[
          { label: 'Nume curier', value: draft.name, onChange: (value) => setDraft((current) => ({ ...current, name: value })) },
        ]}
        submitLabel={isBusy ? 'Se salveaza...' : isEditing ? 'Salveaza modificarile' : 'Salveaza curierul'}
        onCancel={isEditing ? () => {
          if (confirmDiscard()) resetDraft();
        } : undefined}
        onSubmit={async () => {
          const saved = await onSave({
            id: draft.id || undefined,
            name: draft.name,
            phone: draft.phone,
            aliases: splitList(draft.aliases),
            notes: draft.notes,
          });
          if (saved) resetDraft();
        }}
      />
      <section className="panel detected-identities-panel">
        <div className="panel-heading">
          <Search aria-hidden="true" />
          <div>
            <h2>Identitati WhatsApp detectate</h2>
            <p>Alege numele exact din conversatie si curierul real. Asocierea se pastreaza pentru rapoartele viitoare.</p>
          </div>
        </div>
        {unassignedIdentities.length && activeCouriers.length ? (
          <div className="identity-assignment-grid">
            <label>
              Nume detectat in WhatsApp
              <select value={detectedIdentity} onChange={(event) => setDetectedIdentity(event.target.value)}>
                <option value="">Alege identitatea</option>
                {unassignedIdentities.map((identity) => (
                  <option key={identity.normalizedIdentity} value={identity.normalizedIdentity}>
                    {identity.rawIdentity} ({identity.messageCount} mesaje)
                  </option>
                ))}
              </select>
            </label>
            <label>
              Curierul care trebuie afisat
              <select value={targetCourierId} onChange={(event) => setTargetCourierId(event.target.value)}>
                <option value="">Alege curierul</option>
                {activeCouriers.map((courier) => (
                  <option key={courier.id} value={courier.id}>{courier.name}</option>
                ))}
              </select>
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={isBusy || !detectedIdentity || !targetCourierId}
              onClick={async () => {
                const identity = unassignedIdentities.find((item) => item.normalizedIdentity === detectedIdentity);
                const courier = activeCouriers.find((item) => item.id === targetCourierId);
                if (!identity || !courier) return;
                const saved = await onSave({
                  id: courier.id,
                  name: courier.name,
                  phone: courier.phone,
                  aliases: [...courier.aliases, identity.rawIdentity],
                  isActive: courier.isActive,
                  notes: courier.notes,
                });
                if (saved) {
                  setDetectedIdentity('');
                  setTargetCourierId('');
                }
              }}
            >
              <CheckCircle2 aria-hidden="true" />
              <span>Asociaza si salveaza</span>
            </button>
          </div>
        ) : (
          <EmptyState text={activeCouriers.length ? 'Toate identitatile detectate sunt asociate.' : 'Adauga mai intai un curier activ.'} />
        )}
        {detectedIdentities.length ? (
          <div className="detected-identity-list">
            {detectedIdentities.map((identity) => (
              <div className="detected-identity-row" key={identity.normalizedIdentity}>
                <div>
                  <strong>{identity.rawIdentity}</strong>
                  <span>{identity.messageCount} mesaje detectate</span>
                </div>
                <small className={identity.mappedCourierId ? 'mapped' : 'unmapped'}>
                  {identity.mappedCourierName ?? 'Neasociat'}
                </small>
              </div>
            ))}
          </div>
        ) : null}
      </section>
      <EntityTable
        title="Curieri"
        emptyText="Nu exista curieri salvati."
        rows={couriers.map((courier) => ({
          id: courier.id,
          primary: courier.name,
          secondary: [courier.phone, ...courier.aliases].filter(Boolean).join(', ') || 'fara aliasuri',
          meta: courier.isActive ? 'activ' : 'inactiv',
          inactive: !courier.isActive,
        }))}
        onEdit={(courierId) => {
          const courier = couriers.find((item) => item.id === courierId);
          if (!courier) return;
          if (courier.id === draft.id) return;
          if (!confirmDiscard()) return;
          const nextDraft = {
            id: courier.id,
            name: courier.name,
            phone: courier.phone,
            aliases: courier.aliases.join(', '),
            notes: courier.notes,
          };
          setDraft(nextDraft);
          setInitialDraft(nextDraft);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onDelete={onDelete}
        deleteLabel="Sterge"
        disabled={isBusy}
      />
    </div>
  );
}

function ScheduleTimePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const [rawHour = '00', rawMinute = '00'] = value.split(':');
  const hour = scheduleHours.includes(rawHour) ? rawHour : '00';
  const minute = scheduleMinutes.includes(rawMinute) ? rawMinute : '00';
  const update = (nextHour: string, nextMinute: string): void => onChange(`${nextHour}:${nextMinute}`);

  return (
    <span className="schedule-time-picker" aria-label={`Ora selectata ${hour}:${minute}`}>
      <select aria-label="Ora" value={hour} onChange={(event) => update(event.target.value, minute)}>
        {scheduleHours.map((option) => <option value={option} key={option}>{option}</option>)}
      </select>
      <span aria-hidden="true">:</span>
      <select aria-label="Minute" value={minute} onChange={(event) => update(hour, event.target.value)}>
        {scheduleMinutes.map((option) => <option value={option} key={option}>{option}</option>)}
      </select>
    </span>
  );
}

function isScheduleOvernight(openingTime: string, closingTime: string): boolean {
  const toMinutes = (value: string): number | null => {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
  };
  const openingMinutes = toMinutes(openingTime);
  const closingMinutes = toMinutes(closingTime);
  return openingMinutes !== null && closingMinutes !== null && closingMinutes < openingMinutes;
}

function DateRangePicker({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}): JSX.Element {
  const fromDate = parseDateTimeInputValue(from) ?? new Date();
  const toDate = parseDateTimeInputValue(to) ?? fromDate;

  const setRange = (nextFrom: Date, nextTo: Date): void => {
    const start = new Date(nextFrom);
    const end = new Date(nextTo);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 0, 0);
    onChange({ from: toDateTimeInputValue(start), to: toDateTimeInputValue(end) });
  };

  return (
    <section className="date-range-picker" aria-label="Interval calendaristic">
      <div className="date-range-heading">
        <div><CalendarDays aria-hidden="true" /><strong>Interval scanare</strong></div>
        <button className="secondary-button compact" type="button" onClick={() => onChange({ from: toDateTimeInputValue(startOfDay(new Date())), to: toDateTimeInputValue(new Date()) })}>Alege din nou</button>
      </div>
      <DayPicker
        mode="range"
        locale={ro}
        weekStartsOn={1}
        selected={{ from: fromDate, to: toDate }}
        defaultMonth={fromDate}
        numberOfMonths={2}
        showOutsideDays
        onSelect={(range) => {
          if (!range?.from) return;
          setRange(range.from, range.to ?? range.from);
        }}
      />
      <p className="date-range-help">Alegi doar zilele. Pentru fiecare restaurant, scanarea foloseste automat programul salvat la Restaurante.</p>
    </section>
  );
}

function ReportsView({
  workspace,
  selectedReportId,
  onSelectReport,
  selectedReport,
  selectedReportImports,
  report,
  scanOptions,
  setScanOptions,
  exportOptions,
  setExportOptions,
  activeReviewRow,
  setActiveReviewRow,
  onSaveReport,
  onDeleteReport,
  onCreateRestaurant,
  onImport,
  onDeleteImport,
  onScan,
  onExport,
  isBusy,
  isExporting,
}: {
  workspace: WorkspaceSnapshot;
  selectedReportId: string;
  onSelectReport: (reportId: string) => void;
  selectedReport: Report | null;
  selectedReportImports: ReportImport[];
  report: ScanReport | null;
  scanOptions: ScanOptions;
  setScanOptions: (options: ScanOptions) => void;
  exportOptions: ExportOptions;
  setExportOptions: (options: ExportOptions) => void;
  activeReviewRow: ReviewRow | null;
  setActiveReviewRow: (row: ReviewRow | null) => void;
  onSaveReport: (input: { id?: string; name: string; from: string; to: string }) => Promise<void>;
  onDeleteReport: (report: Report) => Promise<void>;
  onCreateRestaurant: (input: RestaurantInput) => Promise<Restaurant | null>;
  onImport: (role: ReportImportRole, restaurantId: string) => Promise<void>;
  onDeleteImport: (importItem: ReportImport) => Promise<void>;
  onScan: () => Promise<void>;
  onExport: (options?: ExportOptions) => Promise<void>;
  isBusy: boolean;
  isExporting: boolean;
}): JSX.Element {
  const now = new Date();
  const defaultFrom = toDateTimeInputValue(startOfDay(now));
  const defaultTo = toDateTimeInputValue(now);
  const [reportDraft, setReportDraft] = useState({ name: '', from: defaultFrom, to: defaultTo });
  const [importMode, setImportMode] = useState<ImportUiMode>('restaurant');
  const [importRestaurantId, setImportRestaurantId] = useState('');
  const [newRestaurantName, setNewRestaurantName] = useState('');
  const [quickExportRestaurantId, setQuickExportRestaurantId] = useState('');
  const importRange = useMemo(() => getReportImportRange(selectedReportImports), [selectedReportImports]);
  const selectedReportHasInvalidInterval = selectedReport
    ? Date.parse(selectedReport.toIso) <= Date.parse(selectedReport.fromIso)
    : false;
  const currentStep = getReportStep(selectedReport, selectedReportImports, report, selectedReportHasInvalidInterval);
  const restaurantImportCount = selectedReportImports.filter((item) => item.role === 'restaurant' || item.role === 'mixed').length;
  const workHoursImportCount = selectedReportImports.filter((item) => item.role === 'workHours').length;
  const detectedRangeWarning = selectedReport && importRange && !selectedReportHasInvalidInterval
    ? buildImportRangeWarning(selectedReport, importRange)
    : null;
  const restaurantExportOptions = useMemo(
    () => workspace.restaurants.filter((restaurant) => report?.restaurantSummaries.some((row) => row.restaurantName === restaurant.name)),
    [report, workspace.restaurants],
  );
  const reportRestaurantOptions = useMemo(() => {
    const reportRestaurantIds = new Set(
      selectedReportImports
        .filter((item) => item.role === 'restaurant' || item.role === 'mixed')
        .map((item) => item.restaurantId)
        .filter(Boolean),
    );
    return workspace.restaurants.filter((restaurant) => reportRestaurantIds.has(restaurant.id));
  }, [selectedReportImports, workspace.restaurants]);
  const activeRestaurants = useMemo(
    () => workspace.restaurants.filter((restaurant) => restaurant.isActive),
    [workspace.restaurants],
  );
  const quickExportRestaurantIsValid = restaurantExportOptions.some((restaurant) => restaurant.id === quickExportRestaurantId);
  const selectedExportRestaurantId = quickExportRestaurantIsValid ? quickExportRestaurantId : restaurantExportOptions[0]?.id ?? '';
  const scanImportValidation = selectedReport ? validateScanImports(scanOptions, selectedReportImports) : null;
  const stepGuidance = getStepGuidance(currentStep, selectedReportImports.length, Boolean(report));

  useEffect(() => {
    setQuickExportRestaurantId('');
  }, [selectedReportId, report]);

  useEffect(() => {
    if (!selectedReport) {
      return;
    }
    setReportDraft({
      name: selectedReport.name,
      from: toDateTimeInputValue(new Date(selectedReport.fromIso)),
      to: toDateTimeInputValue(new Date(selectedReport.toIso)),
    });
  }, [selectedReport?.id, selectedReport?.fromIso, selectedReport?.toIso, selectedReport?.name]);

  const createNewReportDraft = (): void => {
    setReportDraft({ name: '', from: defaultFrom, to: defaultTo });
  };

  const handleImportClick = async (): Promise<void> => {
    if (!selectedReport) {
      return;
    }
    if (importMode === 'workHours') {
      await onImport('workHours', '');
      return;
    }

    let restaurantId = importRestaurantId;
    if (restaurantId === '__new__') {
      const saved = await onCreateRestaurant({ name: newRestaurantName, aliases: [], notes: '' });
      if (!saved) {
        return;
      }
      restaurantId = saved.id;
      setNewRestaurantName('');
      setImportRestaurantId(saved.id);
    }
    await onImport('restaurant', restaurantId);
  };

  return (
    <div className="guided-workflow">
      <section className="panel hero-panel guided-hero">
        <div>
          <p className="eyebrow">Flux ghidat</p>
          <h2>{selectedReport ? selectedReport.name : 'Creeaza un raport si importa conversatiile'}</h2>
          <p>Urmeaza pasii simpli: creezi intervalul, importi conversatiile, verifici, scanezi si descarci Excel.</p>
        </div>
        <button className="primary-button" type="button" onClick={createNewReportDraft}>
          <FileArchive aria-hidden="true" />
          <span>Raport nou</span>
        </button>
      </section>

      <section className="step-strip" aria-label="Pasi raport">
        <StepBadge index={1} label="Creeaza intervalul" active={currentStep === 'interval'} complete={Boolean(selectedReport && !selectedReportHasInvalidInterval)} />
        <StepBadge index={2} label="Importa conversatii" active={currentStep === 'imports'} complete={selectedReportImports.length > 0} />
        <StepBadge index={3} label="Verifica importurile" active={currentStep === 'review-imports'} complete={Boolean(importRange)} />
        <StepBadge index={4} label="Scaneaza raportul" active={currentStep === 'scan'} complete={Boolean(report)} />
        <StepBadge index={5} label="Descarca Excel" active={currentStep === 'results'} complete={Boolean(report)} />
      </section>

      <section className="next-step-card" aria-live="polite">
        <strong>Ce faci acum?</strong>
        <span>{stepGuidance}</span>
      </section>

      <section className="workspace-grid guided-grid">
        <div className="panel report-list-panel">
          <div className="panel-heading">
            <FileArchive aria-hidden="true" />
            <div>
              <h2>Rapoarte</h2>
              <p>Alege raportul sau sterge rapoartele de test.</p>
            </div>
          </div>
          <div className="entity-list compact-list">
            {workspace.reports.length ? workspace.reports.map((item) => (
              <div
                className={`entity-row report-list-item ${item.id === selectedReportId ? 'active' : ''}`}
                key={item.id}
              >
                <button
                  className="report-select-button"
                  type="button"
                  onClick={() => onSelectReport(item.id)}
                >
                  <strong>{item.name}</strong>
                  <span>{formatDateTime(item.fromIso)} - {formatDateTime(item.toIso)}</span>
                  <small>{formatReportStatus(item.status)}</small>
                </button>
                <button
                  className="icon-button danger"
                  type="button"
                  title={`Sterge raportul ${item.name}`}
                  aria-label={`Sterge raportul ${item.name}`}
                  onClick={() => void onDeleteReport(item)}
                  disabled={isBusy}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            )) : <EmptyState text="Nu exista rapoarte salvate inca." />}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <Clock3 aria-hidden="true" />
            <div>
              <h2>1. Interval raport</h2>
              <p>Alege perioada exacta pe care vrei sa o numeri.</p>
            </div>
          </div>
          <div className="form-grid report-interval-grid">
            <label>
              Nume raport
              <input value={reportDraft.name} onChange={(event) => setReportDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <DateRangePicker
              from={reportDraft.from}
              to={reportDraft.to}
              onChange={(range) => setReportDraft((current) => ({ ...current, ...range }))}
            />
          </div>
          {selectedReport ? (
            <div className="selected-interval-card">
              <strong>Raport deschis: {selectedReport.name}</strong>
              <span>{formatDateTime(selectedReport.fromIso)} - {formatDateTime(selectedReport.toIso)}</span>
            </div>
          ) : null}
          <div className="button-row">
            <button className="primary-button" type="button" onClick={() => onSaveReport(reportDraft)} disabled={isBusy}>
              <CheckCircle2 aria-hidden="true" />
              <span>Creeaza raport</span>
            </button>
            {selectedReport ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => onSaveReport({ ...reportDraft, id: selectedReport.id })}
                disabled={isBusy}
              >
                <RefreshCw aria-hidden="true" />
                <span>Salveaza intervalul raportului</span>
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="workspace-grid guided-grid">
        <div className="panel">
          <div className="panel-heading">
            <Upload aria-hidden="true" />
            <div>
              <h2>2. Import conversații</h2>
              <p>Importa restaurantul sau grupul separat de pontaj.</p>
            </div>
          </div>
          {selectedReport ? (
            <>
              <div className="segmented-actions" aria-label="Tip conversatie">
                <button className={importMode === 'restaurant' ? 'active' : ''} type="button" onClick={() => setImportMode('restaurant')}>
                  <Building2 aria-hidden="true" />
                  <span>Restaurant</span>
                </button>
                <button className={importMode === 'workHours' ? 'active' : ''} type="button" onClick={() => setImportMode('workHours')}>
                  <Clock3 aria-hidden="true" />
                  <span>Pontaj ore</span>
                </button>
              </div>
              {importMode === 'restaurant' ? (
                <div className="form-grid two-columns">
                  <label>
                    Restaurant
                    <select value={importRestaurantId} onChange={(event) => setImportRestaurantId(event.target.value)}>
                      <option value="">Alege restaurant</option>
                      {activeRestaurants.map((restaurant) => (
                        <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>
                      ))}
                      <option value="__new__">Adauga restaurant nou</option>
                    </select>
                  </label>
                  {importRestaurantId === '__new__' ? (
                    <label>
                      Nume restaurant nou
                      <input value={newRestaurantName} onChange={(event) => setNewRestaurantName(event.target.value)} placeholder="Ex: Pizzeria Romana" />
                    </label>
                  ) : null}
                </div>
              ) : (
                <div className="help-box">
                  Importa aici conversatia separata unde livratorii scriu Disponibil/Indisponibil.
                </div>
              )}
              <button className="primary-button" type="button" onClick={() => void handleImportClick()} disabled={isBusy || (importMode === 'restaurant' && !importRestaurantId)}>
                {isBusy ? <Loader2 className="spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                <span>{importMode === 'workHours' ? 'Importa pontaj' : 'Importa restaurant'}</span>
              </button>
            </>
          ) : (
            <EmptyState text="Creeaza sau selecteaza intai un raport." />
          )}
        </div>

        <div className="panel">
          <div className="panel-heading">
            <CheckCircle2 aria-hidden="true" />
            <div>
              <h2>3. Verificare import</h2>
              <p>Uita-te daca ai atasat conversatiile corecte.</p>
            </div>
          </div>
          <section className="metrics-row compact-metrics">
            <Metric label="Restaurante importate" value={restaurantImportCount} />
            <Metric label="Pontaj" value={workHoursImportCount} />
            <Metric label="Mesaje comenzi" value={importRange?.deliveryCount ?? 0} />
            <Metric label="Mesaje pontaj" value={importRange?.availabilityCount ?? 0} />
          </section>
          {importRange ? (
            <div className="range-box">
              <strong>Perioada gasita in importuri</strong>
              <span>{formatDateTime(importRange.fromIso)} - {formatDateTime(importRange.toIso)}</span>
              {detectedRangeWarning ? <small className="warning-text">{detectedRangeWarning}</small> : <small>Intervalul raportului poate fi ajustat daca vrei sa scanezi toata conversatia importata.</small>}
              {selectedReport ? (
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => {
                    void onSaveReport({
                      id: selectedReport.id,
                      name: selectedReport.name,
                      from: toDateTimeInputValue(new Date(importRange.fromIso)),
                      to: toDateTimeInputValue(new Date(importRange.toIso)),
                    });
                  }}
                  disabled={isBusy}
                >
                  <RefreshCw aria-hidden="true" />
                  <span>Foloseste perioada importurilor</span>
                </button>
              ) : null}
            </div>
          ) : null}
          <ImportList
            imports={selectedReportImports}
            restaurants={workspace.restaurants}
            onDelete={onDeleteImport}
            disabled={isBusy}
          />
        </div>
      </section>

      {selectedReport ? (
        <section className="panel guided-step-card">
          <div className="panel-action-heading">
            <div className="panel-heading">
              <Search aria-hidden="true" />
              <div>
                <h2>4. Scaneaza raport</h2>
                <p>Se scaneaza doar intervalul salvat: {formatDateTime(selectedReport.fromIso)} - {formatDateTime(selectedReport.toIso)}.</p>
              </div>
            </div>
            <button className="primary-button" type="button" onClick={onScan} disabled={isBusy || selectedReportImports.length === 0 || selectedReportHasInvalidInterval || Boolean(scanImportValidation)}>
              {isBusy ? <Loader2 className="spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
              <span>Scaneaza raport</span>
            </button>
          </div>
          {selectedReportHasInvalidInterval ? (
            <div className="inline-warning">
              Intervalul raportului selectat este invalid sau zero. Modifica datele de sus si apasa <strong>Salveaza intervalul raportului</strong>, sau foloseste perioada importurilor.
            </div>
          ) : null}
          {scanImportValidation ? (
            <div className="inline-warning">
              {scanImportValidation}
            </div>
          ) : null}
          <details className="advanced-details">
            <summary>Optiuni avansate de scanare</summary>
            <RestaurantFilter restaurants={reportRestaurantOptions} options={scanOptions} onChange={setScanOptions} />
            <ScanOptionsPicker options={scanOptions} onChange={setScanOptions} />
          </details>
        </section>
      ) : null}

      {report ? (
        <>
          <section className="metrics-row">
            <Metric label="Total zi" value={report.totalPickedUp} />
            <Metric label="Total noapte" value={report.totalNightPickedUp} />
            <Metric label="Ore lucrate" value={formatWorkMinutes(report.totalWorkMinutes)} />
            <Metric label="Review" value={report.reviewRows.length} />
          </section>
          <section className="panel">
            <div className="panel-action-heading">
              <div className="panel-heading">
                <Download aria-hidden="true" />
                <div>
                  <h2>5. Rezultate si export</h2>
                  <p>Descarca raportul complet sau doar ce trebuie trimis mai departe.</p>
                </div>
              </div>
              <button className="primary-button" type="button" onClick={() => onExport({ scope: 'full', restaurantIds: [] })} disabled={isExporting}>
                {isExporting ? <Loader2 className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                <span>Descarca Excel pe restaurante</span>
              </button>
            </div>
            <div className="quick-export-grid" hidden>
              <label>
                Raport restaurant
                <select value={selectedExportRestaurantId} onChange={(event) => setQuickExportRestaurantId(event.target.value)}>
                  {restaurantExportOptions.length ? (
                    restaurantExportOptions.map((restaurant) => (
                      <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>
                    ))
                  ) : (
                    <option value="">Nu exista restaurante scanate</option>
                  )}
                </select>
              </label>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onExport({ scope: 'restaurants', restaurantIds: selectedExportRestaurantId ? [selectedExportRestaurantId] : [] })}
                disabled={isExporting || !selectedExportRestaurantId || !restaurantExportOptions.some((restaurant) => restaurant.id === selectedExportRestaurantId)}
              >
                <Download aria-hidden="true" />
                <span>Descarca restaurant</span>
              </button>
              <button className="secondary-button" type="button" onClick={() => onExport({ scope: 'review', restaurantIds: [] })} disabled={isExporting || report.reviewRows.length === 0}>
                <AlertTriangle aria-hidden="true" />
                <span>Descarca review</span>
              </button>
            </div>
            <div className="help-box">Excelul contine exclusiv cate un sheet pentru fiecare restaurant, grupat pe zile. Este pregatit pentru importul in fisierul VBA al clientului.</div>
            <details className="advanced-details" hidden>
              <summary>Export avansat</summary>
              <ExportPicker restaurants={restaurantExportOptions.length ? restaurantExportOptions : reportRestaurantOptions} options={exportOptions} onChange={setExportOptions} />
              <button className="secondary-button" type="button" onClick={() => onExport()} disabled={isExporting}>
                <Download aria-hidden="true" />
                <span>Descarca cu optiunile avansate</span>
              </button>
            </details>
          </section>
          <ReportResults
            report={report}
            activeReviewRow={activeReviewRow}
            setActiveReviewRow={setActiveReviewRow}
            imports={selectedReportImports}
          />
        </>
      ) : null}
    </div>
  );
}

function SettingsView({
  workspace,
  updateStatus,
  onBackupWorkspace,
  onRestoreWorkspace,
  onSaveSettings,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onDeleteAllImports,
  onDeleteOldImports,
  isBusy,
}: {
  workspace: WorkspaceSnapshot;
  updateStatus: AppUpdateStatus | null;
  onBackupWorkspace: () => Promise<void>;
  onRestoreWorkspace: () => Promise<void>;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  onCheckForUpdates: () => Promise<void>;
  onDownloadUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  onDeleteAllImports: () => Promise<void>;
  onDeleteOldImports: (retentionDays: number) => Promise<void>;
  isBusy: boolean;
}): JSX.Element {
  const [retentionDays, setRetentionDays] = useState(String(workspace.settings.importRetentionDays));
  const [payrollSettings, setPayrollSettings] = useState(() => mergePayrollSettings(workspace.settings.payroll));
  const [overrideRestaurantId, setOverrideRestaurantId] = useState('');
  const [overrideCourierId, setOverrideCourierId] = useState('');
  const [overrideMethod, setOverrideMethod] = useState<PayrollPaymentMethod>('cash');
  const [isSavingPayroll, setIsSavingPayroll] = useState(false);
  const parsedRetentionDays = Number.parseInt(retentionDays, 10);
  const safeRetentionDays = Number.isFinite(parsedRetentionDays)
    ? Math.min(365, Math.max(1, parsedRetentionDays))
    : workspace.settings.importRetentionDays;

  useEffect(() => {
    setRetentionDays(String(workspace.settings.importRetentionDays));
  }, [workspace.settings.importRetentionDays]);

  useEffect(() => {
    setPayrollSettings(mergePayrollSettings(workspace.settings.payroll));
  }, [workspace.settings.payroll]);

  const savePayrollSettings = async (): Promise<void> => {
    if (isSavingPayroll || isBusy) return;
    setIsSavingPayroll(true);
    try {
      await onSaveSettings({ ...workspace.settings, payroll: payrollSettings });
    } finally {
      setIsSavingPayroll(false);
    }
  };

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="panel-heading">
          <Settings aria-hidden="true" />
          <div>
            <h2>Setari</h2>
            <p>Setari locale pentru raportare, pontaj si confidentialitatea conversatiilor importate.</p>
          </div>
        </div>
        <div className="settings-grid">
          <Metric label="Noapte incepe" value={`${workspace.settings.nightStartHour}:00`} />
          <Metric label="Noapte se termina" value={`${workspace.settings.nightEndHour}:00`} />
          <Metric label="Sesiune maxima" value={`${workspace.settings.maxWorkSessionHours}h`} />
          <Metric label="Export implicit" value={workspace.settings.defaultExportScope} />
          <Metric label="Retentie importuri" value={`${workspace.settings.importRetentionDays} zile`} />
        </div>
        {workspace.maintenanceNotices.map((message) => (
          <div className="notice warning" key={message}>{message}</div>
        ))}
      </section>
      <section className="panel payroll-settings-panel" hidden>
        <div className="panel-heading">
          <FileArchive aria-hidden="true" />
          <div>
            <h2>Setari raport salarial</h2>
            <p>Tarifele si regulile sunt salvate local si sunt folosite in formulele raportului Excel final.</p>
          </div>
        </div>
        <fieldset className="payroll-settings-fieldset" disabled={isSavingPayroll || isBusy}>
        <label className="payroll-enable-row">
          <input
            type="checkbox"
            checked={payrollSettings.enabled}
            onChange={(event) => setPayrollSettings((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <span>
            <strong>Activeaza raportul salarial final</strong>
            <small>Activeaza numai dupa ce verifici tarifele, metodele restaurantelor si regulile curierilor.</small>
          </span>
        </label>
        <details open>
          <summary>Tarife Z1, Z2, Z3</summary>
          <div className="payroll-rate-grid payroll-rate-header" aria-hidden="true">
            <strong>Zona</strong><strong>Zi cash</strong><strong>Zi facturat</strong><strong>Noapte cash</strong><strong>Noapte facturat</strong>
          </div>
          {(['zone1', 'zone2', 'zone3'] as const).map((zoneKey, zoneIndex) => (
            <div className="payroll-rate-grid" key={zoneKey}>
              <strong>Z{zoneIndex + 1}</strong>
              {(['dayCash', 'dayInvoiced', 'nightCash', 'nightInvoiced'] as const).map((rateKey) => (
                <label key={rateKey}>
                  <span className="payroll-field-label">{payrollRateLabel(rateKey)}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={payrollSettings.zoneRates[zoneKey][rateKey]}
                    onChange={(event) => setPayrollSettings((current) => ({
                      ...current,
                      zoneRates: {
                        ...current.zoneRates,
                        [zoneKey]: {
                          ...current.zoneRates[zoneKey],
                          [rateKey]: safeInputNumber(event.target.value),
                        },
                      },
                    }))}
                  />
                </label>
              ))}
            </div>
          ))}
        </details>
        <details>
          <summary>Metoda de plata pe restaurant</summary>
          <div className="payroll-rule-list">
            {workspace.restaurants.filter((restaurant) => restaurant.isActive).map((restaurant) => {
              const resolved = resolveRestaurantMethod(payrollSettings, restaurant);
              return (
                <label className="payroll-rule-row" key={restaurant.id}>
                  <span>{restaurant.name}</span>
                  <select
                    value={payrollSettings.restaurantMethods[restaurant.id] ?? resolved.method}
                    onChange={(event) => setPayrollSettings((current) => ({
                      ...current,
                      restaurantMethods: {
                        ...current.restaurantMethods,
                        [restaurant.id]: event.target.value as PayrollPaymentMethod,
                      },
                    }))}
                  >
                    <option value="cash">Cash</option>
                    <option value="cashPaid">Cash achitat</option>
                    <option value="invoiced">Facturat</option>
                  </select>
                </label>
              );
            })}
          </div>
        </details>
        <details>
          <summary>Calcul pe curier</summary>
          <div className="payroll-courier-header" aria-hidden="true">
            <strong>Curier</strong><strong>Tip calcul</strong><strong>Comision RON/com.</strong><strong>Taxe</strong><strong>Comision factura</strong>
          </div>
          <div className="payroll-rule-list">
            {workspace.couriers.filter((courier) => courier.isActive).map((courier) => {
              const rule = payrollSettings.courierRules[courier.id] ?? resolveCourierRule(payrollSettings, courier);
              const updateRule = (patch: Partial<typeof rule>): void => setPayrollSettings((current) => ({
                ...current,
                courierRules: { ...current.courierRules, [courier.id]: { ...rule, ...patch } },
              }));
              return (
                <div className="payroll-courier-row" key={courier.id}>
                  <strong>{courier.name}</strong>
                  <label><span className="payroll-field-label">Tip calcul</span><select value={rule.calculationMode} onChange={(event) => updateRule({ calculationMode: event.target.value as PayrollCalculationMode })}>
                    <option value="all">Toate</option>
                    <option value="cashOnly">Doar cash</option>
                  </select></label>
                  <label><span className="payroll-field-label">Comision RON/com.</span><input type="number" min="0" step="0.1" value={rule.commissionPerOrder} onChange={(event) => updateRule({ commissionPerOrder: safeInputNumber(event.target.value) })} /></label>
                  <label><span className="payroll-field-label">Taxe %</span><input type="number" min="0" max="100" step="1" value={Math.round(rule.taxRate * 100)} onChange={(event) => updateRule({ taxRate: safeInputNumber(event.target.value) / 100 })} /></label>
                  <label><span className="payroll-field-label">Comision factura</span><input type="number" min="0" step="0.1" value={rule.invoiceCommissionPerOrder} onChange={(event) => updateRule({ invoiceCommissionPerOrder: safeInputNumber(event.target.value) })} /></label>
                </div>
              );
            })}
          </div>
        </details>
        <details>
          <summary>Exceptii restaurant + curier</summary>
          <div className="payroll-override-form">
            <select value={overrideRestaurantId} onChange={(event) => setOverrideRestaurantId(event.target.value)}>
              <option value="">Alege restaurant</option>
              {workspace.restaurants.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
            <select value={overrideCourierId} onChange={(event) => setOverrideCourierId(event.target.value)}>
              <option value="">Alege curier</option>
              {workspace.couriers.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
            <select value={overrideMethod} onChange={(event) => setOverrideMethod(event.target.value as PayrollPaymentMethod)}>
              <option value="cash">Cash</option><option value="cashPaid">Cash achitat</option><option value="invoiced">Facturat</option>
            </select>
            <button
              className="secondary-button"
              type="button"
              disabled={!overrideRestaurantId || !overrideCourierId}
              onClick={() => setPayrollSettings((current) => ({
                ...current,
                restaurantCourierOverrides: {
                  ...current.restaurantCourierOverrides,
                  [`${overrideRestaurantId}:${overrideCourierId}`]: overrideMethod,
                },
              }))}
            >Adauga exceptie</button>
          </div>
          <div className="payroll-override-list">
            {Object.entries(payrollSettings.restaurantCourierOverrides).map(([key, method]) => {
              const [restaurantId, courierId] = key.split(':');
              return (
                <div key={key}>
                  <span>{workspace.restaurants.find((item) => item.id === restaurantId)?.name ?? restaurantId} / {workspace.couriers.find((item) => item.id === courierId)?.name ?? courierId}: {payrollMethodLabel(method)}</span>
                  <button className="danger-button icon-button" type="button" title="Sterge exceptia" onClick={() => setPayrollSettings((current) => {
                    const next = { ...current.restaurantCourierOverrides };
                    delete next[key];
                    return { ...current, restaurantCourierOverrides: next };
                  })}><Trash2 aria-hidden="true" /></button>
                </div>
              );
            })}
          </div>
        </details>
        <div className="payroll-save-row">
          <label>Ajustare total comision (RON)<input type="number" min="0" step="1" value={payrollSettings.commissionAdjustmentLei} onChange={(event) => setPayrollSettings((current) => ({ ...current, commissionAdjustmentLei: safeInputNumber(event.target.value) }))} /></label>
          <button className="primary-button" type="button" onClick={() => void savePayrollSettings()} disabled={isSavingPayroll || isBusy}>
            {isSavingPayroll ? <Loader2 className="spin" aria-hidden="true" /> : null}
            <span>{isSavingPayroll ? 'Se salveaza...' : 'Salveaza setarile salariale'}</span>
          </button>
        </div>
        </fieldset>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <RefreshCw aria-hidden="true" />
          <div>
            <h2>Actualizari aplicatie</h2>
            <p>Update automat prin canal public de release. Clientul nu trebuie sa introduca token sau cont GitHub.</p>
          </div>
        </div>
        <div className="settings-grid">
          <Metric label="Versiune curenta" value={updateStatus?.currentVersion ?? '-'} />
          <Metric label="Canal update" value="public" />
          <Metric label="Status update" value={formatUpdateState(updateStatus)} />
        </div>
        {updateStatus?.message ? <div className={`notice ${updateStatus.state === 'error' ? 'error' : 'info'}`}>{updateStatus.message}</div> : null}
        {typeof updateStatus?.progressPercent === 'number' ? (
          <div className="progress-bar" aria-label="Progres descarcare update">
            <span style={{ width: `${Math.min(100, Math.max(0, updateStatus.progressPercent))}%` }} />
          </div>
        ) : null}
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={() => void onCheckForUpdates()} disabled={isBusy}>
            <RefreshCw aria-hidden="true" />
            <span>Verifica update</span>
          </button>
          <button className="secondary-button" type="button" onClick={() => void onDownloadUpdate()} disabled={isBusy || updateStatus?.state !== 'available'}>
            <Download aria-hidden="true" />
            <span>Descarca update</span>
          </button>
          <button className="primary-button" type="button" onClick={() => void onInstallUpdate()} disabled={isBusy || updateStatus?.state !== 'downloaded'}>
            <Upload aria-hidden="true" />
            <span>Instaleaza si reporneste</span>
          </button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <FileArchive aria-hidden="true" />
          <div>
            <h2>Backup workspace</h2>
            <p>Salveaza sau restaureaza restaurantele, curierii, rapoartele si importurile locale.</p>
          </div>
        </div>
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={() => void onBackupWorkspace()} disabled={isBusy}>
            <Download aria-hidden="true" />
            <span>Salveaza backup</span>
          </button>
          <button className="secondary-button" type="button" onClick={() => void onRestoreWorkspace()} disabled={isBusy}>
            <Upload aria-hidden="true" />
            <span>Restaureaza backup</span>
          </button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <Trash2 aria-hidden="true" />
          <div>
            <h2>Confidentialitate date WhatsApp</h2>
            <p>
              Conversatiile importate sunt pastrate local pentru review. Le poti sterge oricand fara sa stergi restaurantele, curierii sau rapoartele.
            </p>
          </div>
        </div>
        <div className="retention-controls">
          <label>
            Pastreaza importurile
            <input
              type="number"
              min="1"
              max="365"
              value={retentionDays}
              onChange={(event) => setRetentionDays(event.target.value)}
            />
            zile
          </label>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void onSaveSettings({ ...workspace.settings, importRetentionDays: safeRetentionDays })}
            disabled={isBusy}
          >
            <RefreshCw aria-hidden="true" />
            <span>Salveaza retentia</span>
          </button>
          <button
            className="danger-button"
            type="button"
            onClick={() => void onDeleteOldImports(safeRetentionDays)}
            disabled={isBusy || workspace.reportImports.length === 0}
          >
            <Trash2 aria-hidden="true" />
            <span>Sterge importuri vechi</span>
          </button>
        </div>
        <button className="danger-button" type="button" onClick={() => void onDeleteAllImports()} disabled={isBusy || workspace.reportImports.length === 0}>
          <Trash2 aria-hidden="true" />
          <span>Sterge conversatiile salvate ({workspace.reportImports.length})</span>
        </button>
      </section>
    </div>
  );
}

function NoticeBanner({ notice }: { notice: NonNullable<Notice> }): JSX.Element {
  return <div className={`notice ${notice.kind}`}>{notice.text}</div>;
}

function StepBadge({
  index,
  label,
  active,
  complete,
}: {
  index: number;
  label: string;
  active: boolean;
  complete: boolean;
}): JSX.Element {
  return (
    <div className={`step-badge ${active ? 'active' : ''} ${complete ? 'complete' : ''}`}>
      <span>{complete ? <CheckCircle2 aria-hidden="true" /> : index}</span>
      <strong>{label}</strong>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }): JSX.Element {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EntityForm({
  title,
  description,
  fields,
  disabled,
  submitLabel = 'Salveaza',
  onCancel,
  onSubmit,
}: {
  title: string;
  description: string;
  fields: Array<{ label: string; value: string; onChange: (value: string) => void }>;
  disabled: boolean;
  submitLabel?: string;
  onCancel?: () => void;
  onSubmit: () => Promise<void>;
}): JSX.Element {
  return (
    <section className="panel" aria-busy={disabled}>
      <div className="panel-heading">
        <CheckCircle2 aria-hidden="true" />
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="form-grid">
        {fields.map((field) => (
          <label key={field.label}>
            {field.label}
            <input
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="form-actions">
        <button className="primary-button" type="button" onClick={onSubmit} disabled={disabled}>
          <CheckCircle2 aria-hidden="true" />
          <span>{submitLabel}</span>
        </button>
        {onCancel ? (
          <button className="secondary-button" type="button" onClick={onCancel} disabled={disabled}>
            Renunta
          </button>
        ) : null}
      </div>
    </section>
  );
}

function EntityTable({
  title,
  rows,
  emptyText,
  onEdit,
  onDelete,
  deleteLabel = 'Sterge',
  disabled = false,
}: {
  title: string;
  rows: Array<{ id: string; primary: string; secondary: string; meta: string; inactive?: boolean }>;
  emptyText: string;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => Promise<void>;
  deleteLabel?: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <section className="panel">
      <div className="panel-heading">
        <FileArchive aria-hidden="true" />
        <div>
          <h2>{title}</h2>
          <p>{rows.length} inregistrari salvate.</p>
        </div>
      </div>
      {rows.length ? (
        <div className="entity-list">
          {rows.map((row) => (
            <div className={`entity-row ${onEdit || onDelete ? 'with-action' : ''}`} key={row.id}>
              <div className="entity-row-content">
                <strong>{row.primary}</strong>
                <span>{row.secondary}</span>
                <small>{row.meta}</small>
              </div>
              {onEdit || onDelete ? (
                <div className="entity-actions">
                  {onEdit ? (
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => onEdit(row.id)}
                      disabled={disabled}
                      title="Editeaza inregistrarea"
                    >
                      <Pencil aria-hidden="true" />
                      <span>Editeaza</span>
                    </button>
                  ) : null}
                  {onDelete ? (
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => void onDelete(row.id)}
                      disabled={disabled}
                      title={deleteLabel}
                    >
                      <Trash2 aria-hidden="true" />
                      <span>{deleteLabel}</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text={emptyText} />
      )}
    </section>
  );
}

function ImportList({
  imports,
  restaurants,
  onDelete,
  disabled,
}: {
  imports: ReportImport[];
  restaurants: Restaurant[];
  onDelete: (importItem: ReportImport) => Promise<void>;
  disabled: boolean;
}): JSX.Element {
  if (!imports.length) {
    return <EmptyState text="Nu exista importuri pentru raportul selectat." />;
  }

  return (
    <div className="entity-list">
      {imports.map((item) => {
        const restaurant = item.restaurantId ? restaurants.find((candidate) => candidate.id === item.restaurantId) : null;
        return (
          <div className="entity-row with-action" key={item.id}>
            <div className="entity-row-content">
              <strong>{restaurant?.name ?? item.sourceLabel}</strong>
              <span>{item.role} · {item.messageCount} comenzi · {item.availabilityMessageCount} pontaj</span>
              <small>{formatDateTime(item.importedAtIso)}</small>
            </div>
            <button
              className="icon-button danger"
              type="button"
              onClick={() => void onDelete(item)}
              disabled={disabled}
              title="Sterge importul din raport"
              aria-label={`Sterge importul ${item.sourceLabel}`}
            >
              <Trash2 aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ScanOptionsPicker({
  options,
  onChange,
}: {
  options: ScanOptions;
  onChange: (options: ScanOptions) => void;
}): JSX.Element {
  const updateOption = (key: keyof ScanOptions, value: boolean): void => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="scan-options" aria-label="Module scanare">
      <label className="scan-option">
        <input type="checkbox" checked={options.scanOrders} onChange={(event) => updateOption('scanOrders', event.target.checked)} />
        <span><strong>Comenzi</strong><small>Ridicat, livrat, zone, noapte si diferente.</small></span>
      </label>
      <label className="scan-option">
        <input type="checkbox" checked={options.scanWorkHours} onChange={(event) => updateOption('scanWorkHours', event.target.checked)} />
        <span><strong>Ore lucrate</strong><small>Disponibil si Indisponibil pe livrator.</small></span>
      </label>
      <label className="scan-option">
        <input type="checkbox" checked={options.scanDeliveryTimes} onChange={(event) => updateOption('scanDeliveryTimes', event.target.checked)} />
        <span><strong>Timpi livrare</strong><small>Media dintre ridicat si livrat.</small></span>
      </label>
    </div>
  );
}

function RestaurantFilter({
  restaurants,
  options,
  onChange,
}: {
  restaurants: Restaurant[];
  options: ScanOptions;
  onChange: (options: ScanOptions) => void;
}): JSX.Element {
  const selected = new Set(options.restaurantIds ?? []);

  return (
    <div className="filter-panel">
      <label>
        <input
          type="checkbox"
          checked={options.includeAllRestaurants !== false}
          onChange={(event) => onChange({ ...options, includeAllRestaurants: event.target.checked })}
        />
        <span>Include toate restaurantele</span>
      </label>
      {options.includeAllRestaurants === false ? (
        <div className="checkbox-grid">
          {restaurants.map((restaurant) => (
            <label key={restaurant.id}>
              <input
                type="checkbox"
                checked={selected.has(restaurant.id)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) {
                    next.add(restaurant.id);
                  } else {
                    next.delete(restaurant.id);
                  }
                  onChange({ ...options, restaurantIds: Array.from(next) });
                }}
              />
              <span>{restaurant.name}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ExportPicker({
  restaurants,
  options,
  onChange,
}: {
  restaurants: Restaurant[];
  options: ExportOptions;
  onChange: (options: ExportOptions) => void;
}): JSX.Element {
  const selected = new Set(options.restaurantIds);

  return (
    <div className="export-grid">
      <label>
        Tip export
        <select value={options.scope} onChange={(event) => onChange({ ...options, scope: event.target.value as ExportOptions['scope'] })}>
          <option value="full">Toate restaurantele</option>
          <option value="global">Doar raport global livratori</option>
          <option value="restaurants">Restaurante selectate</option>
          <option value="review">Doar review</option>
          <option value="workHours">Doar ore lucrate</option>
        </select>
      </label>
      {options.scope === 'restaurants' ? (
        <div className="checkbox-grid">
          {restaurants.map((restaurant) => (
            <label key={restaurant.id}>
              <input
                type="checkbox"
                checked={selected.has(restaurant.id)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) {
                    next.add(restaurant.id);
                  } else {
                    next.delete(restaurant.id);
                  }
                  onChange({ ...options, restaurantIds: Array.from(next) });
                }}
              />
              <span>{restaurant.name}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReportResults({
  report,
  activeReviewRow,
  setActiveReviewRow,
  imports,
}: {
  report: ScanReport;
  activeReviewRow: ReviewRow | null;
  setActiveReviewRow: (row: ReviewRow | null) => void;
  imports: ReportImport[];
}): JSX.Element {
  const [activeTab, setActiveTab] = useState<ResultTab>('couriers');

  return (
    <div className="view-stack result-workspace">
      <nav className="result-tabs" aria-label="Sectiuni raport">
        <ResultTabButton label="Livratori" active={activeTab === 'couriers'} onClick={() => setActiveTab('couriers')} />
        <ResultTabButton label="Restaurante" active={activeTab === 'restaurants'} onClick={() => setActiveTab('restaurants')} />
        <ResultTabButton label="Pe zile" active={activeTab === 'daily'} onClick={() => setActiveTab('daily')} />
        <ResultTabButton label="Noapte si comenzi speciale" active={activeTab === 'night'} onClick={() => setActiveTab('night')} />
        <ResultTabButton label="Timpi livrare" active={activeTab === 'times'} onClick={() => setActiveTab('times')} />
        <ResultTabButton label="Ore lucrate" active={activeTab === 'workHours'} onClick={() => setActiveTab('workHours')} />
        <ResultTabButton label={`Review (${report.reviewRows.length})`} active={activeTab === 'review'} onClick={() => setActiveTab('review')} />
      </nav>

      {activeTab === 'couriers' ? (
      <section className="panel table-panel">
        <div className="panel-heading">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <h2>Raport final livratori</h2>
            <p>Total global pe toate restaurantele incluse in scanare. {report.summaries.length} curieri detectati in conversatiile scanate.</p>
          </div>
        </div>
        {report.summaries.length ? <SummaryTable report={report} onOpenSource={(source) => openMetricSource(source, setActiveReviewRow, setActiveTab)} /> : <EmptyState text="Nu exista totaluri globale." />}
      </section>
      ) : null}

      {activeTab === 'restaurants' ? (
      <section className="panel table-panel">
        <div className="panel-heading">
          <Building2 aria-hidden="true" />
          <div>
            <h2>Restaurante</h2>
            <p>Totaluri pe restaurant.</p>
          </div>
        </div>
        {report.restaurantSummaries.length ? <RestaurantTable report={report} onOpenSource={(source) => openMetricSource(source, setActiveReviewRow, setActiveTab)} /> : <EmptyState text="Nu exista totaluri pe restaurante." />}
      </section>
      ) : null}

      {activeTab === 'daily' ? (
      <section className="panel table-panel">
        <div className="panel-heading">
          <Clock3 aria-hidden="true" />
          <div>
            <h2>Pe zile</h2>
            <p>Raport zilnic pe restaurant si livrator.</p>
          </div>
        </div>
        {report.dailyCourierSummaries.length ? <DailyCourierTable report={report} rows={report.dailyCourierSummaries} onOpenSource={(source) => openMetricSource(source, setActiveReviewRow, setActiveTab)} /> : <EmptyState text="Nu exista raport pe zile." />}
      </section>
      ) : null}

      {activeTab === 'night' ? (
        <section className="panel table-panel">
          <div className="panel-heading">
            <MapPin aria-hidden="true" />
            <div>
              <h2>Noapte si comenzi speciale</h2>
              <p>Comenzi speciale separate pe zi/noapte, inclusiv valorile in lei sau kilometri.</p>
            </div>
          </div>
          {report.summaries.length ? <NightExternalTable report={report} onOpenSource={(source) => openMetricSource(source, setActiveReviewRow, setActiveTab)} /> : <EmptyState text="Nu exista totaluri de noapte sau comenzi speciale." />}
        </section>
      ) : null}

      {activeTab === 'times' ? (
        <section className="panel table-panel">
          <div className="panel-heading">
            <Clock3 aria-hidden="true" />
            <div>
              <h2>Timpi livrare</h2>
              <p>Media este calculata doar din perechi ridicat-livrat considerate realiste.</p>
            </div>
          </div>
          {report.summaries.length ? <DeliveryTimesTable report={report} /> : <EmptyState text="Nu exista timpi de livrare calculati." />}
        </section>
      ) : null}

      {activeTab === 'workHours' ? (
      <section className="panel table-panel">
        <div className="panel-heading">
          <Clock3 aria-hidden="true" />
          <div>
            <h2>Ore lucrate</h2>
            <p>Pontaj separat, perfectionat treptat.</p>
          </div>
        </div>
        {report.workSummaries.length ? <WorkHoursTable report={report} /> : <EmptyState text="Nu exista ore lucrate calculate." />}
      </section>
      ) : null}

      {activeTab === 'review' ? (
      <section className="panel review-panel">
        <div className="panel-heading">
          <MapPin aria-hidden="true" />
          <div>
            <h2>Review</h2>
            <p>Click pe eroare pentru contextul conversatiei.</p>
          </div>
        </div>
        {report.reviewRows.length ? (
          <>
            <ReviewList rows={report.reviewRows} activeRowId={activeReviewRow?.id ?? null} onSelect={setActiveReviewRow} />
            {activeReviewRow ? <ReviewContext row={activeReviewRow} imports={imports} onClose={() => setActiveReviewRow(null)} /> : null}
          </>
        ) : (
          <EmptyState text="Nu exista randuri de review." />
        )}
      </section>
      ) : null}
    </div>
  );
}

function ResultTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button className={active ? 'active' : ''} type="button" onClick={onClick}>
      {label}
    </button>
  );
}

function SummaryTable({
  report,
  onOpenSource,
}: {
  report: ScanReport;
  onOpenSource: (source: MetricSourceRecord) => void;
}): JSX.Element {
  return (
    <div className="table-wrap">
      <table className="report-table report-table--summary">
        <thead>
          <tr>
            <th>Curier</th><th>Total zi</th><th>Z1 zi</th><th>Z2 zi</th><th>Z3 zi</th><th>Spec. zi</th><th>Lei spec. zi</th><th className="report-col--night">Total noapte</th><th>N Z1</th><th>N Z2</th><th>N Z3</th><th>Spec. noapte</th><th>Lei spec. noapte</th><th className="report-col--audit">Ridicat</th><th>Livrat</th><th>Timp mediu</th><th>Ore</th><th>Dif</th><th>Review</th>
          </tr>
        </thead>
        <tbody>
          {report.summaries.map((row) => (
            <tr key={row.courierId}>
              <td><strong>{row.displayName}</strong><span>{row.senderAliases.join(', ')}</span></td>
              <td><MetricSourceButton report={report} value={row.pickedUp} metric="dayTotal" label="Total zi" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.zoneCounts.zone1} metric="dayZone1" label="Z1 zi" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.zoneCounts.zone2} metric="dayZone2" label="Z2 zi" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.zoneCounts.zone3} metric="dayZone3" label="Z3 zi" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.outsideZoneDeliveries} metric="daySpecial" label="Comenzi speciale zi" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} formatter={() => formatOutsideCount(row.outsideZoneDeliveries, row.outsideKilometers)} /></td>
              <td>{formatCurrencyValue(row.outsideAmountLei)}</td>
              <td className="report-col--night"><MetricSourceButton report={report} value={row.nightPickedUp} metric="nightTotal" label="Total noapte" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.nightZoneCounts.zone1} metric="nightZone1" label="N Z1" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.nightZoneCounts.zone2} metric="nightZone2" label="N Z2" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.nightZoneCounts.zone3} metric="nightZone3" label="N Z3" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.nightOutsideZoneDeliveries} metric="nightSpecial" label="Comenzi speciale noapte" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} formatter={() => formatOutsideCount(row.nightOutsideZoneDeliveries, row.nightOutsideKilometers)} /></td>
              <td>{formatCurrencyValue(row.nightOutsideAmountLei)}</td>
              <td className="report-col--audit">{row.pickedUp + row.nightPickedUp}</td>
              <td>{row.delivered + row.nightDelivered}</td>
              <td>{formatDurationMinutes(row.averageDeliveryMinutes)}</td>
              <td>{formatWorkMinutes(row.workMinutes)}</td>
              <td className={row.difference === 0 && row.nightDifference === 0 ? 'balanced' : 'warning-text'}>{row.difference + row.nightDifference}</td>
              <td>{row.unclearCount + row.workReviewCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricSourceButton({
  value,
  report,
  metric,
  label,
  filter,
  onOpenSource,
  formatter,
}: {
  value: number;
  report: ScanReport;
  metric: MetricSourceKey;
  label: string;
  filter: { courierName?: string; restaurantName?: string; dayKey?: string };
  onOpenSource: (source: MetricSourceRecord) => void;
  formatter?: () => string | number;
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const controlRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const sources = groupMetricSources(findMetricSources(report.metricSources, metric, filter));
  const clearTimer = (): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const clearCloseTimer = (): void => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const closePopover = (restoreFocus = false): void => {
    clearCloseTimer();
    clearTimer();
    setIsOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => buttonRef.current?.focus(), 0);
    }
  };
  const scheduleClose = (): void => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => closePopover(), 260);
  };
  const openPopover = (): void => {
    clearCloseTimer();
    const bounds = controlRef.current?.getBoundingClientRect();
    if (bounds) {
      setPopoverPosition({
        top: Math.min(bounds.bottom + 8, window.innerHeight - 348),
        left: Math.max(188, Math.min(bounds.left + bounds.width / 2, window.innerWidth - 188)),
      });
    }
    setIsOpen(true);
  };
  const scheduleOpen = (): void => {
    clearTimer();
    clearCloseTimer();
    timerRef.current = window.setTimeout(openPopover, 900);
  };
  useEffect(() => () => { clearTimer(); clearCloseTimer(); }, []);
  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && !controlRef.current?.contains(event.target)) {
        closePopover();
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePopover(true);
      }
    };
    const closeOnViewportChange = (): void => closePopover();
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [isOpen]);
  if (value === 0 || sources.length === 0) return <span>{formatter?.() ?? value}</span>;
  return (
    <span ref={controlRef} className="metric-source-control" onMouseEnter={scheduleOpen} onMouseLeave={() => { clearTimer(); scheduleClose(); }}>
      <button ref={buttonRef} className="source-metric-button" type="button" aria-expanded={isOpen} onClick={() => { clearTimer(); clearCloseTimer(); isOpen ? closePopover() : openPopover(); }}>
        {formatter?.() ?? value}
      </button>
      {isOpen ? <div className="metric-source-popover" role="dialog" aria-label={`Comenzi pentru ${label}`} style={popoverPosition ?? undefined} onMouseEnter={clearCloseTimer} onMouseLeave={scheduleClose}>
        <strong>{label}</strong><span>{sources.reduce((total, source) => total + source.quantity, 0)} comenzi</span>
        <div>{sources.map((source) => <button type="button" key={source.id} onClick={() => { closePopover(); onOpenSource(source.record); }}>
          <strong>{formatDateTime(source.record.pickupTimestampIso)}</strong><span>{source.record.restaurantName} · ridicat x{source.quantity}{source.record.deliveryTimestampIso ? ` · livrat ${formatDateTime(source.record.deliveryTimestampIso).split(', ')[1] ?? ''}` : ''}</span>
        </button>)}</div>
      </div> : null}
    </span>
  );
}

function findMetricSources(
  sources: MetricSourceRecord[],
  metric: MetricSourceKey,
  filter: { courierName?: string; restaurantName?: string; dayKey?: string },
): MetricSourceRecord[] {
  return sources.filter((source) =>
    metricSourceMatches(source, metric) &&
    (!filter.courierName || source.courierName === filter.courierName) &&
    (!filter.restaurantName || source.restaurantName === filter.restaurantName) &&
    (!filter.dayKey || source.dayKey === filter.dayKey),
  );
}

function metricSourceMatches(source: MetricSourceRecord, metric: MetricSourceKey): boolean {
  if (metric === 'dayTotal') return source.period === 'day';
  if (metric === 'nightTotal') return source.period === 'night';
  if (metric === 'daySpecial') return source.period === 'day' && source.classification === 'special';
  if (metric === 'nightSpecial') return source.period === 'night' && source.classification === 'special';
  const expectedPeriod = metric.startsWith('night') ? 'night' : 'day';
  const expectedZone = metric.endsWith('Zone1') ? 'zone1' : metric.endsWith('Zone2') ? 'zone2' : 'zone3';
  return source.period === expectedPeriod && source.classification === expectedZone;
}

function groupMetricSources(sources: MetricSourceRecord[]): Array<{ id: string; quantity: number; record: MetricSourceRecord }> {
  const groups = new Map<string, { id: string; quantity: number; record: MetricSourceRecord }>();
  for (const source of sources) {
    const key = `${source.pickupMessageId}:${source.classification}`;
    const current = groups.get(key);
    if (current) {
      current.quantity += 1;
    } else {
      groups.set(key, { id: key, quantity: 1, record: source });
    }
  }
  return Array.from(groups.values());
}

function openMetricSource(
  source: MetricSourceRecord,
  setActiveReviewRow: (row: ReviewRow | null) => void,
  setActiveTab: (tab: ResultTab) => void,
): void {
  setActiveReviewRow({
    kind: 'metric-source',
    id: `metric-review-${source.id}`,
    severity: 'warning',
    restaurantName: source.restaurantName,
    courierName: source.courierName,
    sourceMessageIds: [source.pickupMessageId, ...(source.deliveryMessageId ? [source.deliveryMessageId] : [])],
    reason: `Comanda ridicata la ${formatDateTime(source.pickupTimestampIso)}${source.deliveryTimestampIso ? ` si livrata la ${formatDateTime(source.deliveryTimestampIso)}` : ''}.`,
  });
  setActiveTab('review');
}

function NightExternalTable({ report, onOpenSource }: { report: ScanReport; onOpenSource: (source: MetricSourceRecord) => void }): JSX.Element {
  return (
    <div className="table-wrap">
      <table className="report-table report-table--night">
        <thead>
          <tr>
            <th>Curier</th><th>Spec. zi</th><th>Lei spec. zi</th><th className="report-col--night">Total noapte</th><th>N Z1</th><th>N Z2</th><th>N Z3</th><th>Spec. noapte</th><th>Lei spec. noapte</th><th className="report-col--audit">Dif</th><th>Review</th>
          </tr>
        </thead>
        <tbody>
          {report.summaries.map((row) => (
            <tr key={row.courierId}>
              <td><strong>{row.displayName}</strong><span>{row.senderAliases.join(', ')}</span></td>
              <td><MetricSourceButton report={report} value={row.outsideZoneDeliveries} metric="daySpecial" label="Comenzi speciale zi" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} formatter={() => formatOutsideCount(row.outsideZoneDeliveries, row.outsideKilometers)} /></td>
              <td>{formatCurrencyValue(row.outsideAmountLei)}</td>
              <td className="report-col--night"><MetricSourceButton report={report} value={row.nightPickedUp} metric="nightTotal" label="Total noapte" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.nightZoneCounts.zone1} metric="nightZone1" label="N Z1" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.nightZoneCounts.zone2} metric="nightZone2" label="N Z2" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.nightZoneCounts.zone3} metric="nightZone3" label="N Z3" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.nightOutsideZoneDeliveries} metric="nightSpecial" label="Comenzi speciale noapte" filter={{ courierName: row.displayName }} onOpenSource={onOpenSource} formatter={() => formatOutsideCount(row.nightOutsideZoneDeliveries, row.nightOutsideKilometers)} /></td>
              <td>{formatCurrencyValue(row.nightOutsideAmountLei)}</td>
              <td className={`report-col--audit ${row.difference === 0 ? 'balanced' : 'warning-text'}`}>{row.difference}</td>
              <td>{row.unclearCount + row.workReviewCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeliveryTimesTable({ report }: { report: ScanReport }): JSX.Element {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Curier</th><th>Mostre valide</th><th>Timp mediu</th><th>Timp median</th><th>Review</th>
          </tr>
        </thead>
        <tbody>
          {report.summaries.map((row) => (
            <tr key={row.courierId}>
              <td><strong>{row.displayName}</strong><span>{row.senderAliases.join(', ')}</span></td>
              <td>{row.deliveryTimeSampleCount}</td>
              <td>{formatDurationMinutes(row.averageDeliveryMinutes)}</td>
              <td>{formatDurationMinutes(row.medianDeliveryMinutes)}</td>
              <td>{row.unclearCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RestaurantTable({ report, onOpenSource }: { report: ScanReport; onOpenSource: (source: MetricSourceRecord) => void }): JSX.Element {
  return (
    <div className="table-wrap">
      <table className="report-table report-table--restaurant">
        <thead>
          <tr>
            <th>Restaurant</th><th>Curieri</th><th>Total zi</th><th>Z1 zi</th><th>Z2 zi</th><th>Z3 zi</th><th>Speciale zi</th><th>Lei speciale zi</th><th className="report-col--night">Total noapte</th><th>N Z1</th><th>N Z2</th><th>N Z3</th><th>Speciale noapte</th><th>Lei speciale noapte</th><th className="report-col--audit">Ridicat</th><th>Livrat</th><th>Timp</th><th>Dif</th><th>Review</th>
          </tr>
        </thead>
        <tbody>
          {report.restaurantSummaries.map((row) => (
            <tr key={row.restaurantId}>
              <td><strong>{row.restaurantName}</strong></td>
              <td>{row.courierCount}</td>
              <td><MetricSourceButton report={report} value={row.pickedUp} metric="dayTotal" label="Total zi" filter={{ restaurantName: row.restaurantName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.zoneCounts.zone1} metric="dayZone1" label="Z1 zi" filter={{ restaurantName: row.restaurantName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.zoneCounts.zone2} metric="dayZone2" label="Z2 zi" filter={{ restaurantName: row.restaurantName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.zoneCounts.zone3} metric="dayZone3" label="Z3 zi" filter={{ restaurantName: row.restaurantName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.outsideZoneDeliveries} metric="daySpecial" label="Comenzi speciale zi" filter={{ restaurantName: row.restaurantName }} onOpenSource={onOpenSource} formatter={() => formatOutsideCount(row.outsideZoneDeliveries, row.outsideKilometers)} /></td>
              <td>{formatCurrencyValue(row.outsideAmountLei)}</td>
              <td className="report-col--night"><MetricSourceButton report={report} value={row.nightPickedUp} metric="nightTotal" label="Total noapte" filter={{ restaurantName: row.restaurantName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.nightZoneCounts.zone1} metric="nightZone1" label="N Z1" filter={{ restaurantName: row.restaurantName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.nightZoneCounts.zone2} metric="nightZone2" label="N Z2" filter={{ restaurantName: row.restaurantName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.nightZoneCounts.zone3} metric="nightZone3" label="N Z3" filter={{ restaurantName: row.restaurantName }} onOpenSource={onOpenSource} /></td>
              <td><MetricSourceButton report={report} value={row.nightOutsideZoneDeliveries} metric="nightSpecial" label="Comenzi speciale noapte" filter={{ restaurantName: row.restaurantName }} onOpenSource={onOpenSource} formatter={() => formatOutsideCount(row.nightOutsideZoneDeliveries, row.nightOutsideKilometers)} /></td>
              <td>{formatCurrencyValue(row.nightOutsideAmountLei)}</td>
              <td className="report-col--audit">{row.pickedUp + row.nightPickedUp}</td>
              <td>{row.delivered + row.nightDelivered}</td>
              <td>{formatDurationMinutes(row.averageDeliveryMinutes)}</td>
              <td className={row.difference === 0 && row.nightDifference === 0 ? 'balanced' : 'warning-text'}>{row.difference + row.nightDifference}</td>
              <td>{row.reviewCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyCourierTable({ report, rows, onOpenSource }: { report: ScanReport; rows: DailyCourierSummary[]; onOpenSource: (source: MetricSourceRecord) => void }): JSX.Element {
  const groups = groupDailyRows(rows);
  return (
    <div className="daily-groups">
      {groups.map((group) => (
        <section className="daily-group" key={group.dayKey}>
          <div className="daily-group-heading">
            <strong>{formatCompactDayLabel(group.label)}</strong>
            <span>Zi: {sum(group.rows, 'pickedUp')} · Noapte: {sum(group.rows, 'nightPickedUp')}</span>
          </div>
          {group.restaurants.map((restaurant) => (
            <div className="restaurant-day-group" key={`${group.dayKey}-${restaurant.restaurantName}`}>
              <div className="restaurant-day-heading">
                <strong>{restaurant.restaurantName}</strong>
                <span>{restaurant.rows.length} livrator(i)</span>
              </div>
              <div className="table-wrap compact-table">
                <table className="report-table report-table--daily">
                  <thead>
                    <tr><th>Livrator</th><th>Total zi</th><th>Z1 zi</th><th>Z2 zi</th><th>Z3 zi</th><th>Speciale zi</th><th className="report-col--night">Total noapte</th><th>N Z1</th><th>N Z2</th><th>N Z3</th><th>Speciale noapte</th><th className="report-col--audit">Ridicat</th><th>Livrat</th><th>Timp</th><th>Rev</th></tr>
                  </thead>
                  <tbody>
                    {restaurant.rows.map((row) => (
                      <tr key={row.id}>
                        <td><strong>{row.courierName}</strong></td>
                        <td><MetricSourceButton report={report} value={row.pickedUp} metric="dayTotal" label="Total zi" filter={{ courierName: row.courierName, restaurantName: row.restaurantName, dayKey: row.dayKey }} onOpenSource={onOpenSource} /></td>
                        <td><MetricSourceButton report={report} value={row.zoneCounts.zone1} metric="dayZone1" label="Z1 zi" filter={{ courierName: row.courierName, restaurantName: row.restaurantName, dayKey: row.dayKey }} onOpenSource={onOpenSource} /></td>
                        <td><MetricSourceButton report={report} value={row.zoneCounts.zone2} metric="dayZone2" label="Z2 zi" filter={{ courierName: row.courierName, restaurantName: row.restaurantName, dayKey: row.dayKey }} onOpenSource={onOpenSource} /></td>
                        <td><MetricSourceButton report={report} value={row.zoneCounts.zone3} metric="dayZone3" label="Z3 zi" filter={{ courierName: row.courierName, restaurantName: row.restaurantName, dayKey: row.dayKey }} onOpenSource={onOpenSource} /></td>
                        <td><MetricSourceButton report={report} value={row.outsideZoneDeliveries} metric="daySpecial" label="Comenzi speciale zi" filter={{ courierName: row.courierName, restaurantName: row.restaurantName, dayKey: row.dayKey }} onOpenSource={onOpenSource} formatter={() => formatOutsideCount(row.outsideZoneDeliveries, row.outsideKilometers)} /></td>
                        <td className="report-col--night"><MetricSourceButton report={report} value={row.nightPickedUp} metric="nightTotal" label="Total noapte" filter={{ courierName: row.courierName, restaurantName: row.restaurantName, dayKey: row.dayKey }} onOpenSource={onOpenSource} /></td>
                        <td><MetricSourceButton report={report} value={row.nightZoneCounts.zone1} metric="nightZone1" label="N Z1" filter={{ courierName: row.courierName, restaurantName: row.restaurantName, dayKey: row.dayKey }} onOpenSource={onOpenSource} /></td>
                        <td><MetricSourceButton report={report} value={row.nightZoneCounts.zone2} metric="nightZone2" label="N Z2" filter={{ courierName: row.courierName, restaurantName: row.restaurantName, dayKey: row.dayKey }} onOpenSource={onOpenSource} /></td>
                        <td><MetricSourceButton report={report} value={row.nightZoneCounts.zone3} metric="nightZone3" label="N Z3" filter={{ courierName: row.courierName, restaurantName: row.restaurantName, dayKey: row.dayKey }} onOpenSource={onOpenSource} /></td>
                        <td><MetricSourceButton report={report} value={row.nightOutsideZoneDeliveries} metric="nightSpecial" label="Comenzi speciale noapte" filter={{ courierName: row.courierName, restaurantName: row.restaurantName, dayKey: row.dayKey }} onOpenSource={onOpenSource} formatter={() => formatOutsideCount(row.nightOutsideZoneDeliveries, row.nightOutsideKilometers)} /></td>
                        <td className="report-col--audit">{row.pickedUp + row.nightPickedUp}</td>
                        <td>{row.delivered + row.nightDelivered}</td>
                        <td>{formatDurationMinutes(row.averageDeliveryMinutes)}</td>
                        <td>{row.reviewCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function WorkHoursTable({ report }: { report: ScanReport }): JSX.Element {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Data</th><th>Curier</th><th>Ore</th><th>Sesiuni</th><th>Prima disponibilitate</th><th>Ultima indisponibilitate</th><th>Review</th></tr>
        </thead>
        <tbody>
          {report.workSummaries.map((row) => (
            <tr key={row.id}>
              <td>{row.dateLabel}</td>
              <td><strong>{row.courierName}</strong><span>{row.senderAliases.join(', ')}</span></td>
              <td>{formatWorkMinutes(row.workMinutes)}</td>
              <td>{row.sessionCount}</td>
              <td>{row.firstStartIso ? formatDateTime(row.firstStartIso) : '-'}</td>
              <td>{row.lastEndIso ? formatDateTime(row.lastEndIso) : '-'}</td>
              <td className={row.reviewCount === 0 ? 'balanced' : 'warning-text'}>{row.reviewCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewList({
  rows,
  activeRowId,
  onSelect,
}: {
  rows: ReviewRow[];
  activeRowId: string | null;
  onSelect: (row: ReviewRow) => void;
}): JSX.Element {
  return (
    <div className="review-list">
      {rows.map((row) => (
        <button className={`review-row ${row.severity} ${activeRowId === row.id ? 'active' : ''}`} key={row.id} type="button" onClick={() => onSelect(row)}>
          <strong>{row.courierName}</strong>
          <span>{row.kind === 'mismatch' || row.kind === 'metric-source' ? row.reason : `${row.restaurantName} · ${row.reason}`}</span>
          <p>{row.kind === 'message' ? `${formatDateTime(row.timestampIso)} - ${row.originalMessage}` : row.kind === 'availability' ? `${formatDateTime(row.timestampIso)} - ${row.originalMessage}` : row.kind === 'metric-source' ? 'Apasa pentru conversatia sursa evidentiata.' : `Ridicat ${row.pickedUp}, livrat ${row.delivered}, diferenta ${row.difference}`}</p>
        </button>
      ))}
    </div>
  );
}

function ReviewContext({ row, imports, onClose }: { row: ReviewRow; imports: ReportImport[]; onClose: () => void }): JSX.Element {
  const maxContextLinesPerSide = 120;
  const maxVisibleTargets = 160;
  const contextRef = useRef<HTMLDivElement>(null);
  const [linesBefore, setLinesBefore] = useState(80);
  const [linesAfter, setLinesAfter] = useState(80);
  const [visibleTargets, setVisibleTargets] = useState(80);
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const files = useMemo(() => imports.flatMap((item) => item.importResult.files ?? []), [imports]);
  const lineIndexBySource = useMemo(() => {
    const index = new Map<string, number>();
    for (const file of files) {
      for (let lineIndex = 0; lineIndex < file.conversationLines.length; lineIndex += 1) {
        index.set(`${file.sourceId}:${file.conversationLines[lineIndex].lineNumber}`, lineIndex);
      }
    }
    return index;
  }, [files]);
  const sourceMessages = useMemo(
    () => imports.flatMap((item) => item.importResult.messages),
    [imports],
  );
  const targets = useMemo(() => {
    if (row.kind === 'mismatch' || row.kind === 'metric-source') {
      const ids = new Set(row.sourceMessageIds);
      return sourceMessages
        .filter((message) => ids.has(message.id))
        .sort((left, right) => left.timestampMs - right.timestampMs)
        .map((message) => ({
          id: message.id,
          sourceId: message.sourceId,
          lineNumber: message.lineNumber,
          timestampIso: message.timestampIso,
          restaurantName: message.restaurantName,
          senderRaw: message.senderRaw,
          originalMessage: message.originalMessage,
        }));
    }

    return [{
      id: row.id,
      sourceId: row.sourceId,
      lineNumber: row.lineNumber,
      timestampIso: row.timestampIso,
      restaurantName: row.restaurantName,
      senderRaw: row.courierName,
      originalMessage: row.originalMessage,
    }];
  }, [row, sourceMessages]);
  useEffect(() => {
    setLinesBefore(80);
    setLinesAfter(80);
    setVisibleTargets(80);
    setSelectedTargetId('');
  }, [row.id]);
  const activeTarget = targets.find((target) => target.id === selectedTargetId) ?? targets[0] ?? null;
  useEffect(() => {
    const target = contextRef.current?.querySelector<HTMLElement>('.context-line.target');
    target?.scrollIntoView({ block: 'center' });
  }, [activeTarget?.id, row.id]);

  const contextFiles = useMemo(() => {
    if (!activeTarget) return [];
    const file = files.find((candidate) => candidate.sourceId === activeTarget.sourceId);
    if (!file) return [];

    const lines = file.conversationLines ?? [];
    const targetIndex = Math.max(
      0,
      lineIndexBySource.get(`${file.sourceId}:${activeTarget.lineNumber}`) ?? 0,
    );
    const startIndex = Math.max(0, targetIndex - linesBefore);
    const endIndex = Math.min(lines.length, targetIndex + linesAfter + 1);
    return [{
      ...file,
      visibleLines: lines.slice(startIndex, endIndex),
      hiddenBefore: startIndex,
      hiddenAfter: lines.length - endIndex,
    }];
  }, [activeTarget, files, lineIndexBySource, linesAfter, linesBefore]);

  return (
    <div className="review-context">
      <div className="review-context-heading">
        <h3>{row.kind === 'mismatch' ? 'Context pentru neconcordanta' : row.kind === 'metric-source' ? 'Context pentru comanda selectata' : 'Context conversatie'}</h3>
        <button className="secondary-button compact" type="button" onClick={onClose}>Inchide contextul</button>
      </div>
      <p>Se afiseaza doar zona relevanta din conversatie pentru ca aplicatia sa ramana rapida. Mesajul ales este evidentiat.</p>
      {targets.length > 1 ? (
        <div className="context-target-list" aria-label="Mesaje implicate in review">
          <strong>Mesaje implicate: {targets.length}</strong>
          <div>
            {targets.slice(0, visibleTargets).map((target) => (
              <button
                className={target.id === activeTarget?.id ? 'active' : ''}
                key={target.id}
                type="button"
                onClick={() => {
                  setSelectedTargetId(target.id);
                  setLinesBefore(80);
                  setLinesAfter(80);
                }}
              >
                <strong>{formatDateTime(target.timestampIso)}</strong>
                <span>{target.restaurantName} · {target.senderRaw}</span>
                <small>{target.originalMessage}</small>
              </button>
            ))}
          </div>
          {visibleTargets < Math.min(targets.length, maxVisibleTargets) ? (
            <button className="context-load-button" type="button" onClick={() => setVisibleTargets((current) => Math.min(maxVisibleTargets, current + 80))}>
              Arata inca {Math.min(80, targets.length - visibleTargets)} mesaje implicate
            </button>
          ) : null}
          {targets.length > maxVisibleTargets ? <small>Lista este limitata la {maxVisibleTargets} mesaje pentru a pastra aplicatia rapida. Alege filtrul sau deschide un rand punctual pentru context.</small> : null}
        </div>
      ) : null}
      {contextFiles.length ? (
        <div className="context-lines" ref={contextRef}>
          {contextFiles.flatMap((file) => [
            file.hiddenBefore > 0 && linesBefore < maxContextLinesPerSide ? <button className="context-load-button" type="button" key={`${file.sourceId}-before`} onClick={() => setLinesBefore((current) => Math.min(maxContextLinesPerSide, current + 100))}>Arata inca {Math.min(maxContextLinesPerSide - linesBefore, file.hiddenBefore)} mesaje anterioare</button> : null,
            ...file.visibleLines.map((line) => (
              <article className={`context-line ${line.lineNumber === activeTarget?.lineNumber ? 'target' : ''}`} key={line.id}>
                <strong>{file.restaurantName} · linia {line.lineNumber}</strong>
                <span>{line.timestampIso ? formatDateTime(line.timestampIso) : 'data necunoscuta'} · {line.senderRaw || 'sistem'}</span>
                <code>{line.rawLine}</code>
              </article>
            )),
            file.hiddenAfter > 0 && linesAfter < maxContextLinesPerSide ? <button className="context-load-button" type="button" key={`${file.sourceId}-after`} onClick={() => setLinesAfter((current) => Math.min(maxContextLinesPerSide, current + 100))}>Arata inca {Math.min(maxContextLinesPerSide - linesAfter, file.hiddenAfter)} mesaje urmatoare</button> : null,
          ])}
        </div>
      ) : (
        row.kind === 'mismatch' || row.kind === 'metric-source' ? (
          <EmptyState text="Nu am gasit conversatia sursa pentru aceasta neconcordanta. Reimporta fisierul restaurantului daca mesajele au fost sterse local." />
        ) : (
          <article className="context-line target">
            <strong>{row.restaurantName} · linia {row.lineNumber}</strong>
            <code>{row.rawLine}</code>
          </article>
        )
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }): JSX.Element {
  return <div className="empty-state">{text}</div>;
}

function createScopedReport(report: ScanReport, options: ExportOptions, restaurants: Restaurant[]): ScanReport {
  if (options.scope !== 'restaurants' || options.restaurantIds.length === 0) {
    return report;
  }

  const selectedIds = new Set(options.restaurantIds);
  const selectedNames = new Set(
    restaurants.filter((restaurant) => selectedIds.has(restaurant.id)).map((restaurant) => restaurant.name),
  );
  const dailyRows = report.dailyCourierSummaries.filter((row) =>
    row.restaurantId ? selectedIds.has(row.restaurantId) : selectedNames.has(row.restaurantName),
  );
  const restaurantRows = report.restaurantSummaries.filter((row) =>
    row.restaurantId ? selectedIds.has(row.restaurantId) : selectedNames.has(row.restaurantName),
  );
  const selectedMessageIds = new Set(restaurantRows.flatMap((row) => row.sourceMessageIds));
  const summaries = buildCourierSummariesFromDailyRows(dailyRows);
  const scopedNames = new Set(restaurantRows.map((row) => row.restaurantName));
  const metricSources = report.metricSources.filter((source) =>
    source.restaurantId ? selectedIds.has(source.restaurantId) : scopedNames.has(source.restaurantName),
  );
  const reviewRows = [
    ...report.reviewRows.filter((row) => row.kind !== 'mismatch' && scopedNames.has(row.restaurantName)),
    ...buildScopedMismatchRows(summaries, selectedNames, selectedMessageIds),
  ];
  const totals = calculateCourierTotals(summaries);

  return {
    ...report,
    summaries,
    restaurantSummaries: restaurantRows,
    dailyCourierSummaries: dailyRows,
    metricSources,
    workSummaries: [],
    reviewRows,
    ...totals,
    totalWorkMinutes: 0,
  };
}

function buildScopedMismatchRows(
  summaries: ScanReport['summaries'],
  selectedNames: Set<string>,
  selectedMessageIds: Set<string>,
): ReviewRow[] {
  const restaurantName = Array.from(selectedNames).join(', ');
  const rows: ReviewRow[] = [];
  for (const summary of summaries) {
    if (summary.difference !== 0) {
      rows.push({
        kind: 'mismatch',
        id: `scoped-mismatch-${summary.courierId}`,
        severity: 'warning',
        restaurantName,
        courierName: summary.displayName,
        pickedUp: summary.pickedUp,
        delivered: summary.delivered,
        difference: summary.difference,
        reason:
          summary.difference > 0
            ? 'Ridicari mai multe decat livrari in restaurantele exportate.'
            : 'Livrari mai multe decat ridicari in restaurantele exportate.',
        sourceMessageIds: summary.sourceMessageIds.filter((id) => selectedMessageIds.has(id)),
      });
    }
    if (summary.nightDifference !== 0) {
      rows.push({
        kind: 'mismatch',
        id: `scoped-mismatch-night-${summary.courierId}`,
        severity: 'warning',
        restaurantName,
        courierName: summary.displayName,
        pickedUp: summary.nightPickedUp,
        delivered: summary.nightDelivered,
        difference: summary.nightDifference,
        reason:
          summary.nightDifference > 0
            ? 'Ridicari de noapte mai multe decat livrari de noapte in restaurantele exportate.'
            : 'Livrari de noapte mai multe decat ridicari de noapte in restaurantele exportate.',
        sourceMessageIds: summary.sourceMessageIds.filter((id) => selectedMessageIds.has(id)),
      });
    }
  }
  return rows;
}

function calculateCourierTotals(summaries: ScanReport['summaries']): Pick<
  ScanReport,
  | 'totalPickedUp'
  | 'totalDelivered'
  | 'totalZoneCounts'
  | 'totalOutsideZoneDeliveries'
  | 'totalOutsideKilometers'
  | 'totalOutsideAmountLei'
  | 'totalDeliveredWithoutZone'
  | 'totalNightPickedUp'
  | 'totalNightDelivered'
  | 'totalNightZoneCounts'
  | 'totalNightOutsideZoneDeliveries'
  | 'totalNightOutsideKilometers'
  | 'totalNightOutsideAmountLei'
  | 'totalNightDeliveredWithoutZone'
> {
  return {
    totalPickedUp: summaries.reduce((total, row) => total + row.pickedUp, 0),
    totalDelivered: summaries.reduce((total, row) => total + row.delivered, 0),
    totalZoneCounts: summaries.reduce(
      (total, row) => ({
        zone1: total.zone1 + row.zoneCounts.zone1,
        zone2: total.zone2 + row.zoneCounts.zone2,
        zone3: total.zone3 + row.zoneCounts.zone3,
      }),
      { zone1: 0, zone2: 0, zone3: 0 },
    ),
    totalOutsideZoneDeliveries: summaries.reduce((total, row) => total + safeNumber(row.outsideZoneDeliveries), 0),
    totalOutsideKilometers: summaries.reduce((total, row) => total + safeNumber(row.outsideKilometers), 0),
    totalOutsideAmountLei: summaries.reduce((total, row) => total + safeNumber(row.outsideAmountLei), 0),
    totalDeliveredWithoutZone: summaries.reduce((total, row) => total + row.deliveredWithoutZone, 0),
    totalNightPickedUp: summaries.reduce((total, row) => total + row.nightPickedUp, 0),
    totalNightDelivered: summaries.reduce((total, row) => total + row.nightDelivered, 0),
    totalNightZoneCounts: summaries.reduce(
      (total, row) => ({
        zone1: total.zone1 + row.nightZoneCounts.zone1,
        zone2: total.zone2 + row.nightZoneCounts.zone2,
        zone3: total.zone3 + row.nightZoneCounts.zone3,
      }),
      { zone1: 0, zone2: 0, zone3: 0 },
    ),
    totalNightOutsideZoneDeliveries: summaries.reduce((total, row) => total + safeNumber(row.nightOutsideZoneDeliveries), 0),
    totalNightOutsideKilometers: summaries.reduce((total, row) => total + safeNumber(row.nightOutsideKilometers), 0),
    totalNightOutsideAmountLei: summaries.reduce((total, row) => total + safeNumber(row.nightOutsideAmountLei), 0),
    totalNightDeliveredWithoutZone: summaries.reduce((total, row) => total + row.nightDeliveredWithoutZone, 0),
  };
}

function buildCourierSummariesFromDailyRows(rows: DailyCourierSummary[]): ScanReport['summaries'] {
  const map = new Map<string, ScanReport['summaries'][number] & { durationTotal?: number }>();
  for (const row of rows) {
    const key = row.courierName.toLocaleLowerCase('ro-RO');
    const current =
      map.get(key) ??
      ({
        courierId: key,
        displayName: row.courierName,
        senderAliases: [],
        pickedUp: 0,
        delivered: 0,
        zoneCounts: { zone1: 0, zone2: 0, zone3: 0 },
        outsideZoneDeliveries: 0,
        outsideKilometers: 0,
        outsideAmountLei: 0,
        deliveredWithoutZone: 0,
        nightPickedUp: 0,
        nightDelivered: 0,
        nightZoneCounts: { zone1: 0, zone2: 0, zone3: 0 },
        nightOutsideZoneDeliveries: 0,
        nightOutsideKilometers: 0,
        nightOutsideAmountLei: 0,
        nightDeliveredWithoutZone: 0,
        difference: 0,
        nightDifference: 0,
        workMinutes: 0,
        workSessionCount: 0,
        workReviewCount: 0,
        reviewedCount: 0,
        unclearCount: 0,
        deliveryTimeSampleCount: 0,
        averageDeliveryMinutes: null,
        medianDeliveryMinutes: null,
        deliveryDurationMinutesSamples: [],
        sourceMessageIds: [],
      } satisfies ScanReport['summaries'][number]);
    current.pickedUp += row.pickedUp;
    current.delivered += row.delivered;
    current.zoneCounts.zone1 += row.zoneCounts.zone1;
    current.zoneCounts.zone2 += row.zoneCounts.zone2;
    current.zoneCounts.zone3 += row.zoneCounts.zone3;
    current.outsideZoneDeliveries += safeNumber(row.outsideZoneDeliveries);
    current.outsideKilometers += safeNumber(row.outsideKilometers);
    current.outsideAmountLei += safeNumber(row.outsideAmountLei);
    current.nightPickedUp += row.nightPickedUp;
    current.nightDelivered += row.nightDelivered;
    current.nightZoneCounts.zone1 += row.nightZoneCounts.zone1;
    current.nightZoneCounts.zone2 += row.nightZoneCounts.zone2;
    current.nightZoneCounts.zone3 += row.nightZoneCounts.zone3;
    current.nightOutsideZoneDeliveries += safeNumber(row.nightOutsideZoneDeliveries);
    current.nightOutsideKilometers += safeNumber(row.nightOutsideKilometers);
    current.nightOutsideAmountLei += safeNumber(row.nightOutsideAmountLei);
    current.difference += row.difference;
    current.nightDifference += row.nightDifference;
    current.reviewedCount += row.reviewCount;
    current.unclearCount += row.reviewCount;
    current.sourceMessageIds.push(...row.sourceMessageIds);
    const samples = row.deliveryDurationMinutesSamples ?? [];
    if (samples.length > 0) {
      current.deliveryDurationMinutesSamples.push(...samples);
      current.durationTotal = (current.durationTotal ?? 0) + samples.reduce((total, sample) => total + sample, 0);
      current.deliveryTimeSampleCount += samples.length;
      current.averageDeliveryMinutes = Math.round((current.durationTotal / current.deliveryTimeSampleCount) * 10) / 10;
      current.medianDeliveryMinutes = calculateMedianMinutes(current.deliveryDurationMinutesSamples);
    } else if (row.averageDeliveryMinutes !== null) {
      current.durationTotal = (current.durationTotal ?? 0) + row.averageDeliveryMinutes * row.deliveryTimeSampleCount;
      current.deliveryTimeSampleCount += row.deliveryTimeSampleCount;
      current.averageDeliveryMinutes = Math.round((current.durationTotal / current.deliveryTimeSampleCount) * 10) / 10;
      current.medianDeliveryMinutes = row.medianDeliveryMinutes ?? row.averageDeliveryMinutes;
    }
    map.set(key, current);
  }
  return Array.from(map.values()).map((row) => ({
    ...row,
    deliveredWithoutZone: Math.max(
      0,
      row.pickedUp -
        row.zoneCounts.zone1 -
        row.zoneCounts.zone2 -
        row.zoneCounts.zone3 -
        safeNumber(row.outsideZoneDeliveries),
    ),
    nightDeliveredWithoutZone: Math.max(
      0,
      row.nightPickedUp -
        row.nightZoneCounts.zone1 -
        row.nightZoneCounts.zone2 -
        row.nightZoneCounts.zone3 -
        safeNumber(row.nightOutsideZoneDeliveries),
    ),
  }));
}

export function buildReportWorkbook(
  report: ScanReport,
  excel: typeof ExcelJS,
  options: ExportOptions,
  restaurants: Restaurant[],
  _couriers: Courier[] = [],
  _settings?: AppSettings,
): ExcelJS.Workbook {
  const workbook = new excel.Workbook();
  workbook.creator = 'IfrimDigital';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  if (options.scope === 'full' || options.scope === 'restaurants') {
    addRestaurantProfessionalSheets(workbook, report, restaurants);
  } else if (options.scope === 'global') {
    addGlobalSheet(workbook, report);
  } else if (options.scope === 'workHours') {
    addWorkHoursSheet(workbook, report);
  } else if (options.scope === 'review') {
    addReviewSheet(workbook, report);
  }

  if (workbook.worksheets.length === 0) {
    addGlobalSheet(workbook, report);
  }

  return workbook;
}

function addPayrollSummarySheet(
  workbook: ExcelJS.Workbook,
  report: ScanReport,
  payroll: ReturnType<typeof buildPayrollResult>,
  settings: AppSettings,
): void {
  const sheet = workbook.addWorksheet('Raport salarial', { views: [{ state: 'frozen', ySplit: 4 }] });
  sheet.columns = [
    { width: 30 }, { width: 13 }, { width: 13 }, { width: 17 }, { width: 15 }, { width: 15 },
    { width: 16 }, { width: 17 }, { width: 16 }, { width: 11 }, { width: 16 }, { width: 17 },
    { width: 10 }, { width: 12 },
  ];
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  addMergedRow(sheet, 1, 1, 14, 'IFRIMDIGITAL - Raport salarial final', {
    font: { bold: true, size: 18, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173449' } },
    alignment: { vertical: 'middle', horizontal: 'left' }, height: 30,
  });
  addMergedRow(sheet, 2, 1, 14, `Interval: ${formatDateTime(report.interval.fromIso)} - ${formatDateTime(report.interval.toIso)}`, {
    font: { bold: true, color: { argb: 'FF173449' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1E5' } },
    alignment: { vertical: 'middle', horizontal: 'left' }, height: 23,
  });
  addMergedRow(sheet, 3, 1, 14, payroll.warnings.length
    ? `Atentie: ${payroll.warnings.length} configurari sau valori necesita verificare. Vezi foaia Avertizari salariale.`
    : 'Calcul complet. Formulele raman vizibile si se recalculeaza automat in Excel.', {
    font: { bold: true, color: { argb: payroll.warnings.length ? 'FF9A4D00' : 'FF0C7B63' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: payroll.warnings.length ? 'FFFFF4DD' : 'FFEAF4F1' } },
    alignment: { vertical: 'middle', horizontal: 'left' }, height: 23,
  });
  const headers = [
    'Livrator', 'Tip calcul', 'Total comenzi', 'Cash achitat', 'Facturat', 'Cash', 'Total valoare',
    'Comision RON/com.', 'Valoare comision', 'Taxe %', 'Valoare taxe', 'De incasat', 'Review', 'Avertizari',
  ];
  const headerRow = sheet.getRow(4);
  headerRow.values = headers;
  headerRow.height = 36;
  stylePayrollHeader(headerRow);
  let rowNumber = 5;
  for (const courier of payroll.couriers) {
    const row = sheet.getRow(rowNumber);
    row.values = [
      courier.courierName,
      courier.calculationMode === 'all' ? 'TOATE' : 'DOAR CASH',
      { formula: `SUMIFS('Date calcul'!$G:$G,'Date calcul'!$E:$E,A${rowNumber})`, result: courier.totalOrders },
      { formula: `SUMIFS('Date calcul'!$J:$J,'Date calcul'!$E:$E,A${rowNumber},'Date calcul'!$F:$F,"cashPaid")`, result: fromBani(courier.cashPaidBani) },
      { formula: `SUMIFS('Date calcul'!$J:$J,'Date calcul'!$E:$E,A${rowNumber},'Date calcul'!$F:$F,"invoiced")`, result: fromBani(courier.invoicedBani) },
      { formula: `SUMIFS('Date calcul'!$J:$J,'Date calcul'!$E:$E,A${rowNumber},'Date calcul'!$F:$F,"cash")`, result: fromBani(courier.cashBani) },
      { formula: `SUM(D${rowNumber}:F${rowNumber})`, result: fromBani(courier.totalValueBani) },
      fromBani(courier.commissionPerOrderBani),
      { formula: `C${rowNumber}*H${rowNumber}`, result: fromBani(courier.commissionBani) },
      courier.taxRate,
      { formula: `IF(B${rowNumber}="TOATE",MAX(0,(E${rowNumber}+F${rowNumber}-I${rowNumber})*J${rowNumber}),0)`, result: fromBani(courier.taxBani) },
      { formula: `IF(B${rowNumber}="TOATE",MAX(0,E${rowNumber}+F${rowNumber}-I${rowNumber}-K${rowNumber}),MAX(0,F${rowNumber}-I${rowNumber}))`, result: fromBani(courier.amountDueBani) },
      courier.reviewCount,
      courier.warningCount,
    ];
    stylePayrollDataRow(row, rowNumber);
    rowNumber += 1;
  }
  const firstDataRow = 5;
  const lastDataRow = Math.max(firstDataRow, rowNumber - 1);
  const totalRow = sheet.getRow(rowNumber + 1);
  totalRow.values = [
    'TOTAL ECHIPA', '',
    { formula: `SUM(C${firstDataRow}:C${lastDataRow})` },
    { formula: `SUM(D${firstDataRow}:D${lastDataRow})` },
    { formula: `SUM(E${firstDataRow}:E${lastDataRow})` },
    { formula: `SUM(F${firstDataRow}:F${lastDataRow})` },
    { formula: `SUM(G${firstDataRow}:G${lastDataRow})` }, '',
    { formula: `SUM(I${firstDataRow}:I${lastDataRow})` }, '',
    { formula: `SUM(K${firstDataRow}:K${lastDataRow})` },
    { formula: `SUM(L${firstDataRow}:L${lastDataRow})` },
    { formula: `SUM(M${firstDataRow}:M${lastDataRow})` },
    { formula: `SUM(N${firstDataRow}:N${lastDataRow})` },
  ];
  totalRow.height = 27;
  totalRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173449' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  sheet.getColumn(1).alignment = { horizontal: 'left' };
  [4, 5, 6, 7, 8, 9, 11, 12].forEach((column) => { sheet.getColumn(column).numFmt = '#,##0.00 "RON"'; });
  sheet.getColumn(10).numFmt = '0.00%';
  sheet.autoFilter = { from: 'A4', to: `N${lastDataRow}` };

  const adjustmentRow = sheet.getRow(rowNumber + 3);
  adjustmentRow.values = ['AJUSTARE COMISION GLOBAL', '', '', '', '', '', '', '', safeNumber(settings.payroll.commissionAdjustmentLei)];
  const netCommissionRow = sheet.getRow(rowNumber + 4);
  netCommissionRow.values = ['COMISION NET ECHIPA', '', '', '', '', '', '', '', {
    formula: `MAX(0,I${rowNumber + 1}-I${rowNumber + 3})`,
  }];
  [adjustmentRow, netCommissionRow].forEach((row, index) => {
    row.height = 24;
    row.getCell(1).font = { bold: true, color: { argb: 'FF173449' } };
    row.getCell(9).font = { bold: true, color: { argb: index === 0 ? 'FF9A4D00' : 'FF0C7B63' } };
    row.getCell(9).numFmt = '#,##0.00 "RON"';
  });
}

function addPayrollWarningsSheet(
  workbook: ExcelJS.Workbook,
  warnings: string[],
  lines: ReturnType<typeof buildPayrollResult>['lines'],
): void {
  if (warnings.length === 0) return;
  const sheet = workbook.addWorksheet('Avertizari salariale', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Tip', key: 'type', width: 18 },
    { header: 'Data', key: 'date', width: 14 },
    { header: 'Restaurant', key: 'restaurant', width: 30 },
    { header: 'Curier', key: 'courier', width: 30 },
    { header: 'Motiv verificare', key: 'warning', width: 70 },
  ];
  lines.filter((line) => line.warning).forEach((line) => sheet.addRow({
    type: 'Calcul', date: line.dayKey, restaurant: line.restaurantName,
    courier: line.courierName, warning: line.warning,
  }));
  styleWorksheet(sheet, 1, sheet.rowCount);
  sheet.getColumn(5).alignment = { vertical: 'top', wrapText: true };
}

function addPayrollDataSheet(workbook: ExcelJS.Workbook, lines: ReturnType<typeof buildPayrollResult>['lines']): void {
  const sheet = workbook.addWorksheet('Date calcul');
  sheet.state = 'veryHidden';
  sheet.columns = [
    { header: 'Data', key: 'date', width: 14 }, { header: 'Restaurant ID', key: 'restaurantId', width: 20 },
    { header: 'Restaurant', key: 'restaurant', width: 28 }, { header: 'Curier ID', key: 'courierId', width: 20 },
    { header: 'Curier', key: 'courier', width: 30 }, { header: 'Metoda', key: 'method', width: 14 },
    { header: 'Comenzi', key: 'orders', width: 12 }, { header: 'Valoare zi', key: 'day', width: 15 },
    { header: 'Valoare noapte', key: 'night', width: 17 }, { header: 'Valoare totala', key: 'total', width: 17 },
    { header: 'Review', key: 'review', width: 10 }, { header: 'Avertizare', key: 'warning', width: 45 },
  ];
  for (const line of lines) {
    sheet.addRow({ date: line.dayKey, restaurantId: line.restaurantId, restaurant: line.restaurantName,
      courierId: line.courierId ?? '', courier: line.courierName, method: line.paymentMethod,
      orders: line.totalOrders, day: fromBani(line.dayValueBani), night: fromBani(line.nightValueBani),
      total: fromBani(line.totalValueBani), review: line.reviewCount, warning: line.warning });
  }
  ['H', 'I', 'J'].forEach((column) => { sheet.getColumn(column).numFmt = '#,##0.00'; });
}

function addPayrollSettingsSheet(
  workbook: ExcelJS.Workbook,
  restaurants: Restaurant[],
  couriers: Courier[],
  settings: AppSettings,
): void {
  const sheet = workbook.addWorksheet('Setari calcul');
  sheet.state = 'veryHidden';
  const payroll = mergePayrollSettings(settings.payroll);
  sheet.addRow(['Zona', 'Zi cash', 'Zi facturat', 'Noapte cash', 'Noapte facturat']);
  (['zone1', 'zone2', 'zone3'] as const).forEach((zone, index) => {
    const rates = payroll.zoneRates[zone];
    sheet.addRow([`Z${index + 1}`, rates.dayCash, rates.dayInvoiced, rates.nightCash, rates.nightInvoiced]);
  });
  sheet.addRow([]); sheet.addRow(['Restaurant ID', 'Restaurant', 'Metoda plata']);
  restaurants.forEach((restaurant) => sheet.addRow([restaurant.id, restaurant.name, resolveRestaurantMethod(payroll, restaurant).method]));
  sheet.addRow([]); sheet.addRow(['Curier ID', 'Curier', 'Tip calcul', 'Comision/com.', 'Taxe', 'Comision factura']);
  couriers.forEach((courier) => {
    const rule = resolveCourierRule(payroll, courier);
    sheet.addRow([courier.id, courier.name, rule.calculationMode, rule.commissionPerOrder, rule.taxRate, rule.invoiceCommissionPerOrder]);
  });
}

function addProfessionalDailySheet(
  workbook: ExcelJS.Workbook,
  report: ScanReport,
  sheetName: string,
  rows: DailyCourierSummary[],
  includeNightColumns: boolean,
): void {
  const sheet = workbook.addWorksheet(uniqueWorksheetName(workbook, sheetName), {
    views: [{ state: 'frozen', ySplit: 4 }],
  });
  const columnCount = includeNightColumns ? 16 : 10;
  const dayColumns = [
    { width: 32 },
    { width: 16 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 19 },
  ];
  const auditColumns = [{ width: 11 }, { width: 11 }, { width: 20 }, { width: 17 }];
  const nightColumns = [
    { width: 20 },
    { width: 17 },
    { width: 17 },
    { width: 17 },
    { width: 24 },
  ];
  const combinedTotalColumn = [{ width: 18 }];
  sheet.columns = includeNightColumns
    ? [...dayColumns, ...combinedTotalColumn, ...nightColumns, ...auditColumns]
    : [...dayColumns, ...auditColumns];
  sheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.45,
      bottom: 0.45,
      header: 0.2,
      footer: 0.2,
    },
  };
  const sheetTotalDay = sum(rows, 'pickedUp');
  const sheetTotalNight = sum(rows, 'nightPickedUp');
  const sheetRestaurantCount = new Set(rows.map((row) => row.restaurantName)).size;

  addMergedRow(sheet, 1, 1, columnCount, `IFRIMDIGITAL - ${sheetName}`, {
    font: { bold: true, size: 17, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173449' } },
    alignment: { vertical: 'middle', horizontal: 'left' },
    height: 28,
  });
  addMergedRow(
    sheet,
    2,
    1,
    columnCount,
    `Interval scanat: ${formatDateTime(report.interval.fromIso)} - ${formatDateTime(report.interval.toIso)}`,
    {
      font: { bold: true, color: { argb: 'FF173449' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF7F4' } },
      alignment: { vertical: 'middle', horizontal: 'left' },
      height: 22,
    },
  );
  addMergedRow(
    sheet,
    3,
    1,
    columnCount,
    includeNightColumns
      ? `Total comenzi zi: ${sheetTotalDay} | Total comenzi noapte: ${sheetTotalNight} | Restaurante: ${sheetRestaurantCount}`
      : `Total comenzi: ${sheetTotalDay} | Restaurante: ${sheetRestaurantCount}`,
    {
      font: { bold: true, color: { argb: 'FF0C7B63' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FB' } },
      alignment: { vertical: 'middle', horizontal: 'left' },
      height: 22,
    },
  );
  sheet.getRow(4).height = 8;

  const sortedRows = sortDailyRows(rows);
  const groups = groupDailyRows(sortedRows);
  const workHoursByDayCourier = buildWorkHoursByDayCourier(report);
  const displayedWorkHours = new Set<string>();
  let rowNumber = 5;

  if (groups.length === 0) {
    addMergedRow(sheet, rowNumber, 1, columnCount, 'Nu exista date pentru raportul pe zile.', {
      font: { italic: true, color: { argb: 'FF657382' } },
      alignment: { vertical: 'middle', horizontal: 'center' },
      height: 26,
    });
    return;
  }

  for (const group of groups) {
    const compactDayLabel = formatCompactDayLabel(group.label);
    addMergedRow(
      sheet,
      rowNumber,
      1,
      columnCount,
        includeNightColumns
          ? `${capitalizeLabel(compactDayLabel)}    Zi: ${sum(group.rows, 'pickedUp')} - Noapte: ${sum(group.rows, 'nightPickedUp')}`
          : `${capitalizeLabel(compactDayLabel)}    Total comenzi: ${sum(group.rows, 'pickedUp')}`,
      {
        font: { bold: true, size: 12, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173449' } },
        alignment: { vertical: 'middle', horizontal: 'left' },
        height: 24,
      },
    );
    rowNumber += 1;

    for (const restaurantGroup of group.restaurants) {
      addMergedRow(
        sheet,
        rowNumber,
        1,
        columnCount,
        `${restaurantGroup.restaurantName}    ${restaurantGroup.rows.length} livrator(i)`,
        {
          font: { bold: true, color: { argb: 'FF173449' } },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF4F1' } },
          alignment: { vertical: 'middle', horizontal: 'left' },
          height: 22,
        },
      );
      rowNumber += 1;

      addProfessionalHeaderRow(sheet, rowNumber, includeNightColumns);
      rowNumber += 1;

      for (const dailyRow of restaurantGroup.rows) {
        const workHoursKey = dailyWorkHoursKey(dailyRow.dayKey, dailyRow.courierName);
        const workMinutes = workHoursByDayCourier.get(workHoursKey) ?? 0;
        const shouldShowWorkHours = !displayedWorkHours.has(workHoursKey);
        if (shouldShowWorkHours) {
          displayedWorkHours.add(workHoursKey);
        }

        const excelRow = sheet.getRow(rowNumber);
        const dayValues = [
          dailyRow.courierName,
          dailyRow.pickedUp,
          dailyRow.zoneCounts.zone1,
          dailyRow.zoneCounts.zone2,
          dailyRow.zoneCounts.zone3,
          safeNumber(dailyRow.outsideZoneDeliveries),
        ];
        const nightValues = [
          dailyRow.nightPickedUp,
          dailyRow.nightZoneCounts.zone1,
          dailyRow.nightZoneCounts.zone2,
          dailyRow.nightZoneCounts.zone3,
          safeNumber(dailyRow.nightOutsideZoneDeliveries),
        ];
        const auditValues = [
          dailyRow.pickedUp + dailyRow.nightPickedUp,
          dailyRow.delivered + dailyRow.nightDelivered,
          formatDurationMinutes(dailyRow.averageDeliveryMinutes),
          shouldShowWorkHours ? formatWorkMinutes(workMinutes) : '',
        ];
        excelRow.values = includeNightColumns
          ? [...dayValues, dailyRow.pickedUp + dailyRow.nightPickedUp, ...nightValues, ...auditValues]
          : [...dayValues, ...auditValues];
        styleProfessionalDataRow(excelRow, rowNumber, includeNightColumns);
        rowNumber += 1;
      }

      rowNumber += 1;
    }

    rowNumber += 1;
  }
}

function addRestaurantProfessionalSheets(
  workbook: ExcelJS.Workbook,
  report: ScanReport,
  restaurants: Restaurant[],
): void {
  const restaurantGroups = Array.from(
    report.dailyCourierSummaries.reduce((groups, row) => {
      const key = row.restaurantId || row.restaurantName;
      const current = groups.get(key) ?? [];
      current.push(row);
      groups.set(key, current);
      return groups;
    }, new Map<string, DailyCourierSummary[]>()),
  ).sort((left, right) => left[1][0].restaurantName.localeCompare(right[1][0].restaurantName, 'ro-RO'));

  for (const [, rows] of restaurantGroups) {
    const restaurantName = rows[0].restaurantName;
    const restaurantId = rows[0].restaurantId;
    const restaurant = restaurants.find((item) => item.id === restaurantId)
      ?? restaurants.find((item) => item.name === restaurantName);
    const includesNightData = rows.some((row) => row.nightPickedUp > 0 || row.nightDelivered > 0);
    // Forma foii urmeaza programul configurat. O livrare pastrata pentru imperechere
    // dupa inchiderea unui restaurant de zi nu trebuie sa introduca rubrici de noapte.
    const includeNightColumns = restaurant
      ? restaurant.schedule.tariffPolicy === 'night_after_23'
      : includesNightData;
    addProfessionalDailySheet(
      workbook,
      report,
      restaurantName,
      rows,
      includeNightColumns,
    );
  }
}

function addGlobalSheet(workbook: ExcelJS.Workbook, report: ScanReport): void {
  const sheet = workbook.addWorksheet('Raport final livratori', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Livrator', key: 'courier', width: 28 },
    { header: 'Total zi', key: 'day', width: 12 },
    { header: 'Z1 zi', key: 'z1', width: 8 },
    { header: 'Z2 zi', key: 'z2', width: 8 },
    { header: 'Z3 zi', key: 'z3', width: 8 },
    { header: 'Comenzi speciale zi', key: 'outsideCount', width: 20 },
    { header: 'Km comenzi speciale zi', key: 'km', width: 22 },
    { header: 'Lei comenzi speciale zi', key: 'lei', width: 22 },
    { header: 'Total noapte', key: 'night', width: 14 },
    { header: 'N Z1', key: 'nightZ1', width: 8 },
    { header: 'N Z2', key: 'nightZ2', width: 8 },
    { header: 'N Z3', key: 'nightZ3', width: 8 },
    { header: 'Comenzi speciale noapte', key: 'nightOutsideCount', width: 23 },
    { header: 'Km speciale noapte', key: 'nightKm', width: 19 },
    { header: 'Lei speciale noapte', key: 'nightLei', width: 19 },
    { header: 'Ridicat', key: 'pickedAudit', width: 12 },
    { header: 'Livrat', key: 'deliveredAudit', width: 12 },
    { header: 'Diferenta', key: 'diff', width: 12 },
    { header: 'Timp mediu', key: 'time', width: 14 },
    { header: 'Timp median', key: 'medianTime', width: 14 },
    { header: 'Ore lucrate', key: 'hours', width: 14 },
    { header: 'Review', key: 'review', width: 10 },
  ];
  for (const row of report.summaries) {
    sheet.addRow([
      row.displayName,
      row.pickedUp,
      row.zoneCounts.zone1,
      row.zoneCounts.zone2,
      row.zoneCounts.zone3,
      safeNumber(row.outsideZoneDeliveries),
      safeNumber(row.outsideKilometers),
      safeNumber(row.outsideAmountLei),
      row.nightPickedUp,
      row.nightZoneCounts.zone1,
      row.nightZoneCounts.zone2,
      row.nightZoneCounts.zone3,
      safeNumber(row.nightOutsideZoneDeliveries),
      safeNumber(row.nightOutsideKilometers),
      safeNumber(row.nightOutsideAmountLei),
      row.pickedUp + row.nightPickedUp,
      row.delivered + row.nightDelivered,
      row.difference,
      formatDurationMinutes(row.averageDeliveryMinutes),
      formatDurationMinutes(row.medianDeliveryMinutes),
      formatWorkMinutes(row.workMinutes),
      row.unclearCount + row.workReviewCount,
    ]);
  }
  styleWorksheet(sheet, 1, report.summaries.length + 1);
}

function addRestaurantsSheet(workbook: ExcelJS.Workbook, report: ScanReport): void {
  const sheet = workbook.addWorksheet('Restaurante', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Restaurant', key: 'restaurant', width: 30 },
    { header: 'Curieri', key: 'couriers', width: 10 },
    { header: 'Total zi', key: 'day', width: 12 },
    { header: 'Z1 zi', key: 'z1', width: 8 },
    { header: 'Z2 zi', key: 'z2', width: 8 },
    { header: 'Z3 zi', key: 'z3', width: 8 },
    { header: 'Comenzi speciale zi', key: 'outsideCount', width: 20 },
    { header: 'Km comenzi speciale zi', key: 'km', width: 22 },
    { header: 'Lei comenzi speciale zi', key: 'lei', width: 22 },
    { header: 'Total noapte', key: 'night', width: 14 },
    { header: 'N Z1', key: 'nightZ1', width: 8 },
    { header: 'N Z2', key: 'nightZ2', width: 8 },
    { header: 'N Z3', key: 'nightZ3', width: 8 },
    { header: 'Comenzi speciale noapte', key: 'nightOutsideCount', width: 23 },
    { header: 'Km speciale noapte', key: 'nightKm', width: 19 },
    { header: 'Lei speciale noapte', key: 'nightLei', width: 19 },
    { header: 'Ridicat', key: 'pickedAudit', width: 12 },
    { header: 'Livrat', key: 'deliveredAudit', width: 12 },
    { header: 'Diferenta', key: 'diff', width: 12 },
    { header: 'Timp mediu', key: 'time', width: 14 },
    { header: 'Timp median', key: 'medianTime', width: 14 },
    { header: 'Review', key: 'review', width: 10 },
  ];
  for (const row of report.restaurantSummaries) {
    sheet.addRow([
      row.restaurantName,
      row.courierCount,
      row.pickedUp,
      row.zoneCounts.zone1,
      row.zoneCounts.zone2,
      row.zoneCounts.zone3,
      safeNumber(row.outsideZoneDeliveries),
      safeNumber(row.outsideKilometers),
      safeNumber(row.outsideAmountLei),
      row.nightPickedUp,
      row.nightZoneCounts.zone1,
      row.nightZoneCounts.zone2,
      row.nightZoneCounts.zone3,
      safeNumber(row.nightOutsideZoneDeliveries),
      safeNumber(row.nightOutsideKilometers),
      safeNumber(row.nightOutsideAmountLei),
      row.pickedUp + row.nightPickedUp,
      row.delivered + row.nightDelivered,
      row.difference,
      formatDurationMinutes(row.averageDeliveryMinutes),
      formatDurationMinutes(row.medianDeliveryMinutes),
      row.reviewCount,
    ]);
  }
  styleWorksheet(sheet, 1, report.restaurantSummaries.length + 1);
}

function addDailySheet(workbook: ExcelJS.Workbook, report: ScanReport): void {
  const sheet = workbook.addWorksheet('Pe zile', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Data', key: 'date', width: 20 },
    { header: 'Restaurant', key: 'restaurant', width: 30 },
    { header: 'Livrator', key: 'courier', width: 28 },
    { header: 'Total zi', key: 'day', width: 12 },
    { header: 'Z1 zi', key: 'z1', width: 8 },
    { header: 'Z2 zi', key: 'z2', width: 8 },
    { header: 'Z3 zi', key: 'z3', width: 8 },
    { header: 'Comenzi speciale zi', key: 'outsideCount', width: 20 },
    { header: 'Valoare speciala zi', key: 'outside', width: 18 },
    { header: 'Total noapte', key: 'night', width: 14 },
    { header: 'N Z1', key: 'nightZ1', width: 8 },
    { header: 'N Z2', key: 'nightZ2', width: 8 },
    { header: 'N Z3', key: 'nightZ3', width: 8 },
    { header: 'Comenzi speciale noapte', key: 'nightOutsideCount', width: 23 },
    { header: 'Valoare speciala noapte', key: 'nightOutside', width: 23 },
    { header: 'Ridicat', key: 'pickedAudit', width: 12 },
    { header: 'Livrat', key: 'deliveredAudit', width: 12 },
    { header: 'Diferenta', key: 'diff', width: 12 },
    { header: 'Timp mediu', key: 'time', width: 14 },
    { header: 'Timp median', key: 'medianTime', width: 14 },
    { header: 'Review', key: 'review', width: 10 },
  ];
  for (const row of report.dailyCourierSummaries) {
    sheet.addRow([
      row.dateLabel,
      row.restaurantName,
      row.courierName,
      row.pickedUp,
      row.zoneCounts.zone1,
      row.zoneCounts.zone2,
      row.zoneCounts.zone3,
      safeNumber(row.outsideZoneDeliveries),
      formatOutsideValue(row.outsideKilometers, row.outsideAmountLei),
      row.nightPickedUp,
      row.nightZoneCounts.zone1,
      row.nightZoneCounts.zone2,
      row.nightZoneCounts.zone3,
      safeNumber(row.nightOutsideZoneDeliveries),
      formatOutsideValue(row.nightOutsideKilometers, row.nightOutsideAmountLei),
      row.pickedUp + row.nightPickedUp,
      row.delivered + row.nightDelivered,
      row.difference,
      formatDurationMinutes(row.averageDeliveryMinutes),
      formatDurationMinutes(row.medianDeliveryMinutes),
      row.reviewCount,
    ]);
  }
  styleWorksheet(sheet, 1, report.dailyCourierSummaries.length + 1);
}

function addWeeklyCompatibilitySheet(workbook: ExcelJS.Workbook, report: ScanReport): void {
  const sheet = workbook.addWorksheet('EXPORT_SAPTAMANAL', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = [
    { header: 'Data', key: 'date', width: 14 },
    { header: 'Ziua', key: 'weekday', width: 14 },
    { header: 'Restaurant', key: 'restaurant', width: 30 },
    { header: 'Livrator', key: 'courier', width: 30 },
    { header: 'Zona 1', key: 'zone1', width: 11 },
    { header: 'Zona 2', key: 'zone2', width: 11 },
    { header: 'Zona 3', key: 'zone3', width: 11 },
    { header: 'Comenzi\nNoapte\n( toate zonele )', key: 'night', width: 18 },
    { header: 'Total Comenzi', key: 'total', width: 16 },
    { header: 'Venit\n( Comenzi Noapte )', key: 'nightRevenue', width: 20 },
    { header: 'Total Venit\n( cash / facturat )', key: 'totalRevenue', width: 22 },
  ];

  for (const row of sortDailyRows(report.dailyCourierSummaries)) {
    const date = new Date(`${row.dayKey}T12:00:00`);
    const weekday = capitalizeLabel(
      new Intl.DateTimeFormat('ro-RO', { weekday: 'long' }).format(date),
    );
    sheet.addRow([
      date,
      weekday,
      row.restaurantName,
      row.courierName,
      row.zoneCounts.zone1,
      row.zoneCounts.zone2,
      row.zoneCounts.zone3,
      row.nightPickedUp,
      row.pickedUp + row.nightPickedUp,
      null,
      null,
    ]);
  }

  sheet.getColumn(1).numFmt = 'dd.mm.yyyy';
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, report.dailyCourierSummaries.length + 1), column: 11 },
  };
  sheet.getCell('J1').note = 'Coloana de import ramane libera; venitul se calculeaza cu tarifele aprobate in fisierul salarial al clientului.';
  sheet.getCell('K1').note = 'Coloana de import ramane libera; totalul salarial se calculeaza in fisierul clientului.';
  sheet.getRow(1).height = 48;
  styleWorksheet(sheet, 1, report.dailyCourierSummaries.length + 1);
}

function addZonesSheet(workbook: ExcelJS.Workbook, report: ScanReport): void {
  const sheet = workbook.addWorksheet('Zone si comenzi speciale', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Curier', key: 'courier', width: 28 },
    { header: 'Z1 zi', key: 'z1', width: 10 },
    { header: 'Z2 zi', key: 'z2', width: 10 },
    { header: 'Z3 zi', key: 'z3', width: 10 },
    { header: 'Comenzi speciale zi', key: 'outsideCount', width: 20 },
    { header: 'Km comenzi speciale zi', key: 'km', width: 22 },
    { header: 'Lei comenzi speciale zi', key: 'lei', width: 22 },
    { header: 'N Z1', key: 'nightZ1', width: 10 },
    { header: 'N Z2', key: 'nightZ2', width: 10 },
    { header: 'N Z3', key: 'nightZ3', width: 10 },
    { header: 'Comenzi speciale noapte', key: 'nightOutsideCount', width: 23 },
    { header: 'Km speciale noapte', key: 'nightKm', width: 19 },
    { header: 'Lei speciale noapte', key: 'nightLei', width: 19 },
  ];
  for (const row of report.summaries) {
    sheet.addRow([
      row.displayName,
      row.zoneCounts.zone1,
      row.zoneCounts.zone2,
      row.zoneCounts.zone3,
      safeNumber(row.outsideZoneDeliveries),
      safeNumber(row.outsideKilometers),
      safeNumber(row.outsideAmountLei),
      row.nightZoneCounts.zone1,
      row.nightZoneCounts.zone2,
      row.nightZoneCounts.zone3,
      safeNumber(row.nightOutsideZoneDeliveries),
      safeNumber(row.nightOutsideKilometers),
      safeNumber(row.nightOutsideAmountLei),
    ]);
  }
  styleWorksheet(sheet, 1, report.summaries.length + 1);
}

function addNightSheet(workbook: ExcelJS.Workbook, report: ScanReport): void {
  const sheet = workbook.addWorksheet('Noapte', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Curier', key: 'courier', width: 28 },
    { header: 'Ridicat noapte', key: 'picked', width: 16 },
    { header: 'Livrat noapte', key: 'delivered', width: 16 },
    { header: 'N Z1', key: 'z1', width: 10 },
    { header: 'N Z2', key: 'z2', width: 10 },
    { header: 'N Z3', key: 'z3', width: 10 },
    { header: 'Comenzi speciale noapte', key: 'outsideCount', width: 23 },
    { header: 'Km speciale noapte', key: 'km', width: 19 },
    { header: 'Lei speciale noapte', key: 'lei', width: 19 },
    { header: 'Diferenta', key: 'diff', width: 12 },
  ];
  for (const row of report.summaries) {
    sheet.addRow([
      row.displayName,
      row.nightPickedUp,
      row.nightDelivered,
      row.nightZoneCounts.zone1,
      row.nightZoneCounts.zone2,
      row.nightZoneCounts.zone3,
      safeNumber(row.nightOutsideZoneDeliveries),
      safeNumber(row.nightOutsideKilometers),
      safeNumber(row.nightOutsideAmountLei),
      row.nightDifference,
    ]);
  }
  styleWorksheet(sheet, 1, report.summaries.length + 1);
}

function addDeliveryTimesSheet(workbook: ExcelJS.Workbook, report: ScanReport): void {
  const sheet = workbook.addWorksheet('Timpi livrare', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Curier', key: 'courier', width: 28 },
    { header: 'Mostre', key: 'samples', width: 10 },
    { header: 'Timp mediu', key: 'time', width: 16 },
    { header: 'Timp median', key: 'median', width: 16 },
  ];
  for (const row of report.summaries) {
    sheet.addRow([
      row.displayName,
      row.deliveryTimeSampleCount,
      formatDurationMinutes(row.averageDeliveryMinutes),
      formatDurationMinutes(row.medianDeliveryMinutes),
    ]);
  }
  styleWorksheet(sheet, 1, report.summaries.length + 1);
}

function addWorkHoursSheet(workbook: ExcelJS.Workbook, report: ScanReport): void {
  const sheet = workbook.addWorksheet('Ore lucrate', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Data', key: 'date', width: 20 },
    { header: 'Curier', key: 'courier', width: 28 },
    { header: 'Ore', key: 'hours', width: 12 },
    { header: 'Sesiuni', key: 'sessions', width: 10 },
    { header: 'Prima disponibilitate', key: 'start', width: 22 },
    { header: 'Ultima indisponibilitate', key: 'end', width: 22 },
    { header: 'Review', key: 'review', width: 10 },
  ];
  for (const row of report.workSummaries) {
    sheet.addRow([
      row.dateLabel,
      row.courierName,
      formatWorkMinutes(row.workMinutes),
      row.sessionCount,
      row.firstStartIso ? formatDateTime(row.firstStartIso) : '',
      row.lastEndIso ? formatDateTime(row.lastEndIso) : '',
      row.reviewCount,
    ]);
  }
  styleWorksheet(sheet, 1, report.workSummaries.length + 1);
}

function addReviewSheet(workbook: ExcelJS.Workbook, report: ScanReport): void {
  const sheet = workbook.addWorksheet('Review', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Tip', key: 'type', width: 14 },
    { header: 'Sursa', key: 'source', width: 30 },
    { header: 'Curier', key: 'courier', width: 28 },
    { header: 'Motiv', key: 'reason', width: 54 },
    { header: 'Detalii', key: 'details', width: 70 },
  ];
  for (const row of report.reviewRows) {
    sheet.addRow([
      row.kind,
      row.kind === 'mismatch' ? row.restaurantName ?? '' : row.restaurantName,
      row.courierName,
      row.reason,
      row.kind === 'mismatch'
        ? `ridicat ${row.pickedUp}, livrat ${row.delivered}`
        : row.kind === 'metric-source'
          ? 'Mesaj sursa disponibil in aplicatie pentru acest total.'
          : row.originalMessage,
    ]);
  }
  styleWorksheet(sheet, 1, report.reviewRows.length + 1);
}

function styleWorksheet(sheet: ExcelJS.Worksheet, headerRowNumber: number, lastRowNumber: number): void {
  const header = sheet.getRow(headerRowNumber);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173449' } };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.height = 24;
  for (let rowNumber = headerRowNumber + 1; rowNumber <= lastRowNumber; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.eachCell((cell) => {
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
      cell.alignment = { vertical: 'middle' };
    });
  }
}

function addMergedRow(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  startColumn: number,
  endColumn: number,
  value: string,
  style: {
    font?: Partial<ExcelJS.Font>;
    fill?: ExcelJS.Fill;
    alignment?: Partial<ExcelJS.Alignment>;
    height?: number;
  },
): void {
  sheet.mergeCells(rowNumber, startColumn, rowNumber, endColumn);
  const row = sheet.getRow(rowNumber);
  const cell = row.getCell(startColumn);
  cell.value = value;
  if (style.font) cell.font = style.font;
  if (style.fill) cell.fill = style.fill;
  if (style.alignment) cell.alignment = style.alignment;
  if (style.height) row.height = style.height;
}

function addProfessionalHeaderRow(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  includeNightColumns: boolean,
): void {
  const row = sheet.getRow(rowNumber);
  const dayHeaders = [
    'Livrator',
    'Total\ncomenzi\nzi',
    'Zona 1\nzi',
    'Zona 2\nzi',
    'Zona 3\nzi',
    'Comenzi\nspeciale\nzi',
  ];
  const combinedTotalHeader = ['Total\nzi +\nnoapte'];
  const nightHeaders = [
    'Total\ncomenzi\nnoapte',
    'Zona 1\nnoapte',
    'Zona 2\nnoapte',
    'Zona 3\nnoapte',
    'Comenzi\nspeciale\nnoapte',
  ];
  const auditHeaders = [
    'Ridicat',
    'Livrat',
    'Timp\nlivrare',
    'Ore\nlucrate',
  ];
  row.values = includeNightColumns
    ? [...dayHeaders, ...combinedTotalHeader, ...nightHeaders, ...auditHeaders]
    : [...dayHeaders, ...auditHeaders];
  row.height = 54;
  row.eachCell((cell, columnNumber) => {
    const isNightTotal = includeNightColumns && columnNumber === 8;
    const isBoundary = includeNightColumns
      ? columnNumber === 7 || columnNumber === 8 || columnNumber === 13
      : columnNumber === 7;
    cell.font = { bold: true, color: { argb: 'FF526273' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: isNightTotal ? 'FFF1F5F8' : columnNumber === 7 && includeNightColumns ? 'FFFFF5E8' : 'FFF7F9FB' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      ...(isBoundary ? { left: { style: 'medium', color: { argb: 'FFC8D3DD' } } } : {}),
    };
  });
  row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
}

function stylePayrollHeader(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173449' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
  });
  row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
}

function stylePayrollDataRow(row: ExcelJS.Row, rowNumber: number): void {
  row.height = 24;
  row.eachCell((cell, columnNumber) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNumber % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFB' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    cell.alignment = { vertical: 'middle', horizontal: columnNumber === 1 ? 'left' : 'center' };
  });
  row.getCell(1).font = { bold: true, color: { argb: 'FF18212F' } };
  if (Number(row.getCell(14).value) > 0) {
    row.getCell(14).font = { bold: true, color: { argb: 'FFB45309' } };
  }
}

function styleProfessionalDataRow(row: ExcelJS.Row, rowNumber: number, includeNightColumns: boolean): void {
  row.height = 22;
  const fillColor = rowNumber % 2 === 0 ? 'FFFFFFFF' : 'FFFBFCFD';
  row.eachCell((cell, columnNumber) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
    const isBoundary = includeNightColumns
      ? columnNumber === 7 || columnNumber === 8 || columnNumber === 13
      : columnNumber === 7;
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      ...(isBoundary ? { left: { style: 'thin', color: { argb: 'FFD4DEE6' } } } : {}),
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: columnNumber === 1 ? 'left' : 'center',
    };
    if (columnNumber === 1) {
      cell.font = { bold: true, color: { argb: 'FF18212F' } };
    }
  });
}

function sortDailyRows(rows: DailyCourierSummary[]): DailyCourierSummary[] {
  return [...rows].sort(
    (left, right) =>
      left.dayKey.localeCompare(right.dayKey) ||
      left.restaurantName.localeCompare(right.restaurantName, 'ro-RO') ||
      left.courierName.localeCompare(right.courierName, 'ro-RO'),
  );
}

function buildWorkHoursByDayCourier(report: ScanReport): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of report.workSummaries) {
    const key = dailyWorkHoursKey(row.dayKey, row.courierName);
    map.set(key, (map.get(key) ?? 0) + row.workMinutes);
  }
  return map;
}

function dailyWorkHoursKey(dayKey: string, courierName: string): string {
  return `${dayKey}:${courierName.toLocaleLowerCase('ro-RO')}`;
}

function uniqueWorksheetName(workbook: ExcelJS.Workbook, rawName: string): string {
  const base = sanitizeWorksheetName(rawName);
  let name = base;
  let index = 2;
  while (workbook.worksheets.some((sheet) => sheet.name === name)) {
    const suffix = ` ${index}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  return name;
}

function sanitizeWorksheetName(rawName: string): string {
  const clean = rawName.replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return (clean || 'Raport').slice(0, 31);
}

function groupDailyRows(rows: DailyCourierSummary[]): Array<{
  dayKey: string;
  label: string;
  rows: DailyCourierSummary[];
  restaurants: Array<{ restaurantName: string; rows: DailyCourierSummary[] }>;
}> {
  const dayMap = new Map<string, DailyCourierSummary[]>();
  for (const row of rows) {
    const current = dayMap.get(row.dayKey) ?? [];
    current.push(row);
    dayMap.set(row.dayKey, current);
  }
  return Array.from(dayMap.entries()).map(([dayKey, dayRows]) => {
    const restaurantMap = new Map<string, DailyCourierSummary[]>();
    for (const row of dayRows) {
      const current = restaurantMap.get(row.restaurantName) ?? [];
      current.push(row);
      restaurantMap.set(row.restaurantName, current);
    }
    return {
      dayKey,
      label: dayRows[0]?.dateLabel ?? dayKey,
      rows: dayRows,
      restaurants: Array.from(restaurantMap.entries()).map(([restaurantName, restaurantRows]) => ({
        restaurantName,
        rows: restaurantRows,
      })),
    };
  });
}

function getConversationWindow<T extends { lineNumber: number }>(lines: T[], lineNumber: number, before: number, after: number): T[] {
  const sorted = [...lines].sort((left, right) => left.lineNumber - right.lineNumber);
  const targetIndex = sorted.findIndex((line) => line.lineNumber === lineNumber);
  if (targetIndex === -1) {
    return sorted.filter((line) => Math.abs(line.lineNumber - lineNumber) <= Math.max(before, after));
  }
  return sorted.slice(Math.max(0, targetIndex - before), targetIndex + after + 1);
}

function getReportStep(
  selectedReport: Report | null,
  imports: ReportImport[],
  report: ScanReport | null,
  hasInvalidInterval: boolean,
): ReportStep {
  if (report) {
    return 'results';
  }
  if (!selectedReport || hasInvalidInterval) {
    return 'interval';
  }
  if (!imports.length) {
    return 'imports';
  }
  if (!getReportImportRange(imports)) {
    return 'review-imports';
  }
  return 'scan';
}

function getStepGuidance(step: ReportStep, importCount: number, hasReport: boolean): string {
  if (step === 'interval') {
    return 'Completeaza numele raportului si perioada exacta, apoi apasa Creeaza raport.';
  }
  if (step === 'imports') {
    return 'Alege restaurantul, importa conversatia WhatsApp, apoi repeta pentru fiecare restaurant din raport.';
  }
  if (step === 'review-imports') {
    return 'Verifica lista de importuri si perioada gasita in conversatii inainte de scanare.';
  }
  if (step === 'scan') {
    return importCount > 1
      ? 'Ai importurile atasate. Apasa Scaneaza raport ca sa calculezi toate restaurantele.'
      : 'Ai un import atasat. Apasa Scaneaza raport ca sa calculezi rezultatele.';
  }
  return hasReport
    ? 'Verifica rezultatele si descarca Excel-ul complet sau raportul unui restaurant.'
    : 'Dupa scanare, aici vei vedea raportul si butoanele de export.';
}

function buildImportRangeWarning(report: Report, importRange: ImportRange): string | null {
  const reportFrom = Date.parse(report.fromIso);
  const reportTo = Date.parse(report.toIso);
  const importFrom = Date.parse(importRange.fromIso);
  const importTo = Date.parse(importRange.toIso);
  if (!Number.isFinite(reportFrom) || !Number.isFinite(reportTo) || !Number.isFinite(importFrom) || !Number.isFinite(importTo)) {
    return null;
  }
  if (reportFrom > importTo || reportTo < importFrom) {
    return 'Atentie: intervalul raportului nu se suprapune cu perioada importurilor.';
  }
  if (reportFrom > importFrom || reportTo < importTo) {
    return 'Atentie: raportul scaneaza doar o parte din perioada importata.';
  }
  return null;
}

function validateReportInput(name: string, fromDate: Date, toDate: Date): string | null {
  if (!name.trim()) {
    return 'Scrie un nume pentru raport.';
  }
  if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) {
    return 'Alege date valide pentru raport.';
  }
  if (toDate.getTime() <= fromDate.getTime()) {
    return 'Alege un interval valid: "Pana la" trebuie sa fie dupa "De la".';
  }
  return null;
}

function validateScanOptions(options: ScanOptions): string | null {
  if (!options.scanOrders && !options.scanWorkHours && !options.scanDeliveryTimes) {
    return 'Bifeaza cel putin un modul de scanare.';
  }
  if (options.includeAllRestaurants === false && (!options.restaurantIds || options.restaurantIds.length === 0)) {
    return 'Alege cel putin un restaurant sau bifeaza toate restaurantele.';
  }
  return null;
}

function validateScanImports(options: ScanOptions, imports: ReportImport[]): string | null {
  const selectedRestaurantIds =
    options.includeAllRestaurants === false ? new Set(options.restaurantIds ?? []) : null;
  const hasRestaurantImport = imports.some((item) => {
    if (item.role !== 'restaurant' && item.role !== 'mixed') {
      return false;
    }
    if (!selectedRestaurantIds) {
      return true;
    }
    return item.restaurantId ? selectedRestaurantIds.has(item.restaurantId) : false;
  });
  const hasWorkHoursImport = imports.some((item) => item.role === 'workHours' || item.role === 'mixed');

  if ((options.scanOrders || options.scanDeliveryTimes) && !hasRestaurantImport) {
    return 'Pentru comenzi sau timpi de livrare, ataseaza cel putin o conversatie de restaurant inclusa in scanare.';
  }
  if (options.scanWorkHours && !hasWorkHoursImport) {
    return 'Pentru ore lucrate, ataseaza conversatia de pontaj sau un import mixt.';
  }
  return null;
}

export function getReportImportRange(imports: ReportImport[]): ImportRange | null {
  let fromMs = Number.POSITIVE_INFINITY;
  let toMs = Number.NEGATIVE_INFINITY;
  let deliveryCount = 0;
  let availabilityCount = 0;

  for (const item of imports) {
    deliveryCount += item.importResult.messages.length;
    availabilityCount += item.importResult.availabilityMessages.length;
    for (const message of item.importResult.messages) {
      if (Number.isFinite(message.timestampMs)) {
        fromMs = Math.min(fromMs, message.timestampMs);
        toMs = Math.max(toMs, message.timestampMs);
      }
    }
    for (const message of item.importResult.availabilityMessages) {
      if (Number.isFinite(message.timestampMs)) {
        fromMs = Math.min(fromMs, message.timestampMs);
        toMs = Math.max(toMs, message.timestampMs);
      }
    }
  }

  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return null;
  }

  return {
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
    deliveryCount,
    availabilityCount,
  };
}

function splitList(value: string): string[] {
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)));
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function toDateTimeInputValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function parseDateTimeInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hours, minutes] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLocalDateTimeValue(value: string): string {
  const date = parseDateTimeInputValue(value);
  if (!date) return 'Alege data si ora';
  return new Intl.DateTimeFormat('ro-RO', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ro-RO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

function formatReportStatus(status: Report['status']): string {
  const labels: Record<Report['status'], string> = {
    draft: 'Draft',
    scanned: 'Scanat',
    verified: 'Verificat',
    exported: 'Exportat',
  };
  return labels[status] ?? status;
}

function formatFileDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatNumber(value: number): string {
  const safeValue = safeNumber(value);
  return Number.isInteger(safeValue) ? String(safeValue) : safeValue.toFixed(1);
}

function formatOutsideValue(kilometers: number, amountLei: number): string {
  const values: string[] = [];
  const safeKilometers = safeNumber(kilometers);
  const safeAmountLei = safeNumber(amountLei);
  if (safeKilometers > 0) values.push(`${formatNumber(safeKilometers)} km`);
  if (safeAmountLei > 0) values.push(`${formatNumber(safeAmountLei)} lei`);
  return values.length ? values.join(' / ') : '0';
}

function formatOutsideCount(count: number, kilometers: number): string {
  const safeCount = safeNumber(count);
  const safeKilometers = safeNumber(kilometers);
  if (safeCount > 0 && safeKilometers > 0) {
    return `${safeCount} / ${formatNumber(safeKilometers)} km`;
  }
  if (safeCount > 0) {
    return String(safeCount);
  }
  if (safeKilometers > 0) {
    return `${formatNumber(safeKilometers)} km`;
  }
  return '0';
}

function formatCurrencyValue(value: number): string {
  const safeValue = safeNumber(value);
  return safeValue === 0 ? '0' : `${formatNumber(safeValue)} lei`;
}

function safeNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function safeInputNumber(value: string): number {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function payrollMethodLabel(method: PayrollPaymentMethod): string {
  if (method === 'cashPaid') return 'Cash achitat';
  if (method === 'invoiced') return 'Facturat';
  return 'Cash';
}

function payrollRateLabel(rate: 'dayCash' | 'dayInvoiced' | 'nightCash' | 'nightInvoiced'): string {
  const labels = {
    dayCash: 'Zi cash',
    dayInvoiced: 'Zi facturat',
    nightCash: 'Noapte cash',
    nightInvoiced: 'Noapte facturat',
  };
  return labels[rate];
}

function formatWorkMinutes(value: number): string {
  if (value <= 0) return '-';
  const rounded = Math.round(value);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function formatDurationMinutes(value: number | null): string {
  if (value === null) return '-';
  if (value < 60) return `${formatNumber(value)} min`;
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return `${hours}h ${minutes}m`;
}

function formatUpdateState(status: AppUpdateStatus | null): string {
  if (!status) return '-';
  const labels: Record<AppUpdateStatus['state'], string> = {
    idle: 'in asteptare',
    checking: 'verific',
    'not-available': 'la zi',
    available: 'disponibil',
    downloading: 'descarc',
    downloaded: 'descarcat',
    error: 'eroare',
  };
  return labels[status.state];
}

function calculateMedianMinutes(values: number[]): number | null {
  const samples = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (samples.length === 0) {
    return null;
  }
  const middle = Math.floor(samples.length / 2);
  const median = samples.length % 2 === 0 ? (samples[middle - 1] + samples[middle]) / 2 : samples[middle];
  return Math.round(median * 10) / 10;
}

function formatCompactDayLabel(label: string): string {
  const parts = label.split(',').map((part) => part.trim());
  return parts.length >= 2 ? `${parts[0]} ${parts[1].split('.')[0]}` : label;
}

function capitalizeLabel(value: string): string {
  return value ? `${value[0].toLocaleUpperCase('ro-RO')}${value.slice(1)}` : value;
}

function sum(rows: DailyCourierSummary[], key: 'pickedUp' | 'nightPickedUp' | 'delivered' | 'nightDelivered'): number {
  return rows.reduce((total, row) => total + row[key], 0);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback;
  return error.message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

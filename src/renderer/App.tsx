import { useEffect, useMemo, useState } from 'react';
import type ExcelJS from 'exceljs';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock3,
  Download,
  FileArchive,
  LayoutDashboard,
  Loader2,
  MapPin,
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
  ReviewRow,
  ScanOptions,
  ScanReport,
  WorkspaceSnapshot,
} from '../shared/types';

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
      const nextWorkspace = await desktopApi.getWorkspace();
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
        text: isUsed ? 'Restaurant dezactivat. Istoricul ramane disponibil.' : 'Restaurant sters.',
      });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut sterge restaurantul.') });
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveCourier = async (input: CourierInput): Promise<void> => {
    if (!desktopApi || isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      await desktopApi.saveCourier(input);
      await reloadWorkspace();
      setNotice({ kind: 'success', text: 'Curier salvat.' });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut salva curierul.') });
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
    const confirmed = window.confirm(`Dezactivezi curierul "${courier.name}"? Aliasurile raman pastrate pentru rapoartele istorice.`);
    if (!confirmed) {
      return;
    }
    setIsBusy(true);
    try {
      await desktopApi.deleteCourier(courierId);
      await reloadWorkspace();
      setNotice({ kind: 'success', text: 'Curier dezactivat. Aliasurile raman disponibile pentru rapoarte istorice.' });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error, 'Nu am putut sterge curierul.') });
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
        text: `Scan complet: ${nextReport.totalPickedUp} comenzi zi, ${nextReport.totalNightPickedUp} comenzi noapte.`,
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
    setIsExporting(true);
    try {
      const effectiveOptions = overrideOptions ?? exportOptions;
      const { default: excel } = await import('exceljs');
      const scopedReport = createScopedReport(report, effectiveOptions, workspace.restaurants);
      const workbook = buildReportWorkbook(scopedReport, excel, effectiveOptions, workspace.restaurants);
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
          <button className="secondary-button" type="button" onClick={reloadWorkspace} disabled={isBusy}>
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
        <Metric label="Curieri" value={workspace.couriers.length} />
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
  const [draft, setDraft] = useState({ name: '', aliases: '', notes: '' });

  return (
    <div className="view-stack">
      <EntityForm
        title="Adauga restaurant"
        description="Restaurantul ramane in memorie si poate fi selectat la fiecare import."
        disabled={isBusy}
        fields={[
          { label: 'Nume restaurant', value: draft.name, onChange: (value) => setDraft((current) => ({ ...current, name: value })) },
          { label: 'Aliasuri grup WhatsApp', value: draft.aliases, onChange: (value) => setDraft((current) => ({ ...current, aliases: value })) },
          { label: 'Observatii', value: draft.notes, onChange: (value) => setDraft((current) => ({ ...current, notes: value })) },
        ]}
        onSubmit={async () => {
          await onSave({ name: draft.name, aliases: splitList(draft.aliases), notes: draft.notes });
          setDraft({ name: '', aliases: '', notes: '' });
        }}
      />
      <EntityTable
        title="Restaurante"
        emptyText="Nu exista restaurante salvate."
        rows={restaurants.map((restaurant) => ({
          id: restaurant.id,
          primary: restaurant.name,
          secondary: restaurant.aliases.length ? restaurant.aliases.join(', ') : 'fara aliasuri',
          meta: restaurant.isActive ? 'activ' : 'inactiv',
          inactive: !restaurant.isActive,
        }))}
        onDelete={onDelete}
        deleteLabel="Sterge"
        disabled={isBusy}
      />
    </div>
  );
}

function CouriersView({
  couriers,
  onSave,
  onDelete,
  isBusy,
}: {
  couriers: Courier[];
  onSave: (input: CourierInput) => Promise<void>;
  onDelete: (courierId: string) => Promise<void>;
  isBusy: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState({ name: '', phone: '', aliases: '', notes: '' });

  return (
    <div className="view-stack">
      <EntityForm
        title="Adauga curier"
        description="Aliasurile unifica numele diferite din grupurile WhatsApp."
        disabled={isBusy}
        fields={[
          { label: 'Nume curier', value: draft.name, onChange: (value) => setDraft((current) => ({ ...current, name: value })) },
          { label: 'Telefon', value: draft.phone, onChange: (value) => setDraft((current) => ({ ...current, phone: value })) },
          { label: 'Aliasuri WhatsApp', value: draft.aliases, onChange: (value) => setDraft((current) => ({ ...current, aliases: value })) },
          { label: 'Observatii', value: draft.notes, onChange: (value) => setDraft((current) => ({ ...current, notes: value })) },
        ]}
        onSubmit={async () => {
          await onSave({ name: draft.name, phone: draft.phone, aliases: splitList(draft.aliases), notes: draft.notes });
          setDraft({ name: '', phone: '', aliases: '', notes: '' });
        }}
      />
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
        onDelete={onDelete}
        deleteLabel="Sterge"
        disabled={isBusy}
      />
    </div>
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
          <div className="form-grid">
            <label>
              Nume raport
              <input value={reportDraft.name} onChange={(event) => setReportDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label>
              De la
              <input type="datetime-local" value={reportDraft.from} onChange={(event) => setReportDraft((current) => ({ ...current, from: event.target.value }))} />
            </label>
            <label>
              Pana la
              <input type="datetime-local" value={reportDraft.to} onChange={(event) => setReportDraft((current) => ({ ...current, to: event.target.value }))} />
            </label>
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
                <span>Descarca raport complet</span>
              </button>
            </div>
            <div className="quick-export-grid">
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
            <details className="advanced-details">
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
  const parsedRetentionDays = Number.parseInt(retentionDays, 10);
  const safeRetentionDays = Number.isFinite(parsedRetentionDays)
    ? Math.min(365, Math.max(1, parsedRetentionDays))
    : workspace.settings.importRetentionDays;

  useEffect(() => {
    setRetentionDays(String(workspace.settings.importRetentionDays));
  }, [workspace.settings.importRetentionDays]);

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
              disabled={isBusy}
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
  onSubmit,
}: {
  title: string;
  description: string;
  fields: Array<{ label: string; value: string; onChange: (value: string) => void }>;
  disabled: boolean;
  onSubmit: () => Promise<void>;
}): JSX.Element {
  return (
    <section className="panel">
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
            <input value={field.value} onChange={(event) => field.onChange(event.target.value)} />
          </label>
        ))}
      </div>
      <button className="primary-button" type="button" onClick={onSubmit} disabled={disabled}>
        <CheckCircle2 aria-hidden="true" />
        <span>Salveaza</span>
      </button>
    </section>
  );
}

function EntityTable({
  title,
  rows,
  emptyText,
  onDelete,
  deleteLabel = 'Sterge',
  disabled = false,
}: {
  title: string;
  rows: Array<{ id: string; primary: string; secondary: string; meta: string; inactive?: boolean }>;
  emptyText: string;
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
            <div className={`entity-row ${onDelete ? 'with-action' : ''}`} key={row.id}>
              <div className="entity-row-content">
                <strong>{row.primary}</strong>
                <span>{row.secondary}</span>
                <small>{row.meta}</small>
              </div>
              {onDelete ? (
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => void onDelete(row.id)}
                  disabled={disabled || row.inactive}
                  title={row.inactive ? 'Inregistrarea este deja inactiva.' : deleteLabel}
                >
                  <Trash2 aria-hidden="true" />
                  <span>{row.inactive ? 'Inactiv' : deleteLabel}</span>
                </button>
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
          <option value="full">Raport complet</option>
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
        <ResultTabButton label="Noapte si exterior" active={activeTab === 'night'} onClick={() => setActiveTab('night')} />
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
            <p>Total global pe toate restaurantele incluse in scanare.</p>
          </div>
        </div>
        {report.summaries.length ? <SummaryTable report={report} /> : <EmptyState text="Nu exista totaluri globale." />}
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
        {report.restaurantSummaries.length ? <RestaurantTable report={report} /> : <EmptyState text="Nu exista totaluri pe restaurante." />}
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
        {report.dailyCourierSummaries.length ? <DailyCourierTable rows={report.dailyCourierSummaries} /> : <EmptyState text="Nu exista raport pe zile." />}
      </section>
      ) : null}

      {activeTab === 'night' ? (
        <section className="panel table-panel">
          <div className="panel-heading">
            <MapPin aria-hidden="true" />
            <div>
              <h2>Noapte si exterior</h2>
              <p>Comenzi speciale separate pe zi/noapte, zone si exterior.</p>
            </div>
          </div>
          {report.summaries.length ? <NightExternalTable report={report} /> : <EmptyState text="Nu exista totaluri de noapte sau exterior." />}
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
            {activeReviewRow ? <ReviewContext row={activeReviewRow} imports={imports} /> : null}
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

function SummaryTable({ report }: { report: ScanReport }): JSX.Element {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Curier</th><th>Total zi</th><th>Z1 zi</th><th>Z2 zi</th><th>Z3 zi</th><th>Ext. zi</th><th>Lei ext. zi</th><th>Total noapte</th><th>N Z1</th><th>N Z2</th><th>N Z3</th><th>N ext.</th><th>N lei ext.</th><th>Ridicat</th><th>Livrat</th><th>Timp mediu</th><th>Ore</th><th>Dif</th><th>Review</th>
          </tr>
        </thead>
        <tbody>
          {report.summaries.map((row) => (
            <tr key={row.courierId}>
              <td><strong>{row.displayName}</strong><span>{row.senderAliases.join(', ')}</span></td>
              <td>{row.pickedUp}</td>
              <td>{row.zoneCounts.zone1}</td>
              <td>{row.zoneCounts.zone2}</td>
              <td>{row.zoneCounts.zone3}</td>
              <td>{formatOutsideCount(row.outsideZoneDeliveries, row.outsideKilometers)}</td>
              <td>{formatCurrencyValue(row.outsideAmountLei)}</td>
              <td>{row.nightPickedUp}</td>
              <td>{row.nightZoneCounts.zone1}</td>
              <td>{row.nightZoneCounts.zone2}</td>
              <td>{row.nightZoneCounts.zone3}</td>
              <td>{formatOutsideCount(row.nightOutsideZoneDeliveries, row.nightOutsideKilometers)}</td>
              <td>{formatCurrencyValue(row.nightOutsideAmountLei)}</td>
              <td>{row.pickedUp + row.nightPickedUp}</td>
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

function NightExternalTable({ report }: { report: ScanReport }): JSX.Element {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Curier</th><th>Ext. zi</th><th>Lei ext. zi</th><th>Total noapte</th><th>N Z1</th><th>N Z2</th><th>N Z3</th><th>N ext.</th><th>N lei ext.</th><th>Dif</th><th>Review</th>
          </tr>
        </thead>
        <tbody>
          {report.summaries.map((row) => (
            <tr key={row.courierId}>
              <td><strong>{row.displayName}</strong><span>{row.senderAliases.join(', ')}</span></td>
              <td>{formatOutsideCount(row.outsideZoneDeliveries, row.outsideKilometers)}</td>
              <td>{formatCurrencyValue(row.outsideAmountLei)}</td>
              <td>{row.nightPickedUp}</td>
              <td>{row.nightZoneCounts.zone1}</td>
              <td>{row.nightZoneCounts.zone2}</td>
              <td>{row.nightZoneCounts.zone3}</td>
              <td>{formatOutsideCount(row.nightOutsideZoneDeliveries, row.nightOutsideKilometers)}</td>
              <td>{formatCurrencyValue(row.nightOutsideAmountLei)}</td>
              <td className={row.difference === 0 ? 'balanced' : 'warning-text'}>{row.difference}</td>
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

function RestaurantTable({ report }: { report: ScanReport }): JSX.Element {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Restaurant</th><th>Curieri</th><th>Total zi</th><th>Z1 zi</th><th>Z2 zi</th><th>Z3 zi</th><th>Ext. zi</th><th>Lei ext. zi</th><th>Total noapte</th><th>N Z1</th><th>N Z2</th><th>N Z3</th><th>N ext.</th><th>N lei ext.</th><th>Ridicat</th><th>Livrat</th><th>Timp</th><th>Dif</th><th>Review</th>
          </tr>
        </thead>
        <tbody>
          {report.restaurantSummaries.map((row) => (
            <tr key={row.restaurantId}>
              <td><strong>{row.restaurantName}</strong></td>
              <td>{row.courierCount}</td>
              <td>{row.pickedUp}</td>
              <td>{row.zoneCounts.zone1}</td>
              <td>{row.zoneCounts.zone2}</td>
              <td>{row.zoneCounts.zone3}</td>
              <td>{formatOutsideCount(row.outsideZoneDeliveries, row.outsideKilometers)}</td>
              <td>{formatCurrencyValue(row.outsideAmountLei)}</td>
              <td>{row.nightPickedUp}</td>
              <td>{row.nightZoneCounts.zone1}</td>
              <td>{row.nightZoneCounts.zone2}</td>
              <td>{row.nightZoneCounts.zone3}</td>
              <td>{formatOutsideCount(row.nightOutsideZoneDeliveries, row.nightOutsideKilometers)}</td>
              <td>{formatCurrencyValue(row.nightOutsideAmountLei)}</td>
              <td>{row.pickedUp + row.nightPickedUp}</td>
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

function DailyCourierTable({ rows }: { rows: DailyCourierSummary[] }): JSX.Element {
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
                <table>
                  <thead>
                    <tr><th>Livrator</th><th>Total zi</th><th>Z1 zi</th><th>Z2 zi</th><th>Z3 zi</th><th>Ext. zi</th><th>Total noapte</th><th>N Z1</th><th>N Z2</th><th>N Z3</th><th>N ext.</th><th>Ridicat</th><th>Livrat</th><th>Timp</th><th>Rev</th></tr>
                  </thead>
                  <tbody>
                    {restaurant.rows.map((row) => (
                      <tr key={row.id}>
                        <td><strong>{row.courierName}</strong></td>
                        <td>{row.pickedUp}</td>
                        <td>{row.zoneCounts.zone1}</td>
                        <td>{row.zoneCounts.zone2}</td>
                        <td>{row.zoneCounts.zone3}</td>
                        <td>{formatOutsideCount(row.outsideZoneDeliveries, row.outsideKilometers)}</td>
                        <td>{row.nightPickedUp}</td>
                        <td>{row.nightZoneCounts.zone1}</td>
                        <td>{row.nightZoneCounts.zone2}</td>
                        <td>{row.nightZoneCounts.zone3}</td>
                        <td>{formatOutsideCount(row.nightOutsideZoneDeliveries, row.nightOutsideKilometers)}</td>
                        <td>{row.pickedUp + row.nightPickedUp}</td>
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
          <span>{row.kind === 'mismatch' ? row.reason : `${row.restaurantName} · ${row.reason}`}</span>
          <p>{row.kind === 'message' ? `${formatDateTime(row.timestampIso)} - ${row.originalMessage}` : row.kind === 'availability' ? `${formatDateTime(row.timestampIso)} - ${row.originalMessage}` : `Ridicat ${row.pickedUp}, livrat ${row.delivered}, diferenta ${row.difference}`}</p>
        </button>
      ))}
    </div>
  );
}

function ReviewContext({ row, imports }: { row: ReviewRow; imports: ReportImport[] }): JSX.Element {
  if (row.kind === 'mismatch') {
    const messages = imports
      .flatMap((item) => item.importResult.messages)
      .filter((message) => row.sourceMessageIds.includes(message.id))
      .sort((a, b) => a.timestampMs - b.timestampMs);

    return (
      <div className="review-context">
        <h3>Context neconcordanta</h3>
        {messages.length ? (
          <div className="context-lines">
            {messages.map((message) => (
              <article className="context-line target" key={message.id}>
                <strong>{message.restaurantName} · {message.sourceFile} · linia {message.lineNumber}</strong>
                <span>{formatDateTime(message.timestampIso)} · {message.senderRaw}</span>
                <code>{message.rawLine}</code>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState text="Nu am gasit mesajele sursa pentru aceasta neconcordanta. Verifica foaia Review din export." />
        )}
      </div>
    );
  }

  const source = imports
    .flatMap((item) => item.importResult.files)
    .find((file) => file.sourceId === row.sourceId && file.sourceFile === row.sourceFile);
  const lines = getConversationWindow(source?.conversationLines ?? [], row.lineNumber, 6, 6);

  return (
    <div className="review-context">
      <h3>Context conversatie</h3>
      {lines.length ? (
        <div className="context-lines">
          {lines.map((line) => (
            <article className={`context-line ${line.lineNumber === row.lineNumber ? 'target' : ''}`} key={line.id}>
              <strong>{line.restaurantName} · linia {line.lineNumber}</strong>
              <span>{line.timestampIso ? formatDateTime(line.timestampIso) : 'data necunoscuta'} · {line.senderRaw || 'sistem'}</span>
              <code>{line.rawLine}</code>
            </article>
          ))}
        </div>
      ) : (
        <article className="context-line target">
          <strong>{row.restaurantName} · linia {row.lineNumber}</strong>
          <code>{row.rawLine}</code>
        </article>
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

function buildReportWorkbook(
  report: ScanReport,
  excel: typeof ExcelJS,
  options: ExportOptions,
  _restaurants: Restaurant[],
): ExcelJS.Workbook {
  const workbook = new excel.Workbook();
  workbook.creator = 'IfrimDigital';
  workbook.created = new Date();

  const include = (scope: ExportOptions['scope']): boolean => options.scope === 'full' || options.scope === scope;
  if (options.scope === 'full' || options.scope === 'restaurants') {
    addProfessionalDailySheet(workbook, report, 'Pe zile - raport', report.dailyCourierSummaries);
  }
  if (include('global') || options.scope === 'restaurants') addGlobalSheet(workbook, report);
  if (options.scope === 'full' || options.scope === 'restaurants') {
    addRestaurantsSheet(workbook, report);
    addDailySheet(workbook, report);
    if (options.scope === 'full') {
      addRestaurantProfessionalSheets(workbook, report);
    }
    addZonesSheet(workbook, report);
    addNightSheet(workbook, report);
    addDeliveryTimesSheet(workbook, report);
  }
  if (include('workHours')) addWorkHoursSheet(workbook, report);
  if (include('review') || (options.scope === 'restaurants' && report.reviewRows.length > 0)) {
    addReviewSheet(workbook, report);
  }

  if (workbook.worksheets.length === 0) {
    addGlobalSheet(workbook, report);
  }

  return workbook;
}

function addProfessionalDailySheet(
  workbook: ExcelJS.Workbook,
  report: ScanReport,
  sheetName: string,
  rows: DailyCourierSummary[],
): void {
  const sheet = workbook.addWorksheet(uniqueWorksheetName(workbook, sheetName), {
    views: [{ state: 'frozen', ySplit: 4 }],
  });
  const columnCount = 16;
  sheet.columns = [
    { width: 32 },
    { width: 11 },
    { width: 9 },
    { width: 9 },
    { width: 9 },
    { width: 12 },
    { width: 14 },
    { width: 9 },
    { width: 9 },
    { width: 9 },
    { width: 12 },
    { width: 10 },
    { width: 10 },
    { width: 13 },
    { width: 13 },
    { width: 8 },
  ];
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
  const sheetReviewCount = rows.reduce((total, row) => total + row.reviewCount, 0);

  addMergedRow(sheet, 1, 1, columnCount, 'IFRIMDIGITAL - Raport pe zile', {
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
    `Total zi: ${sheetTotalDay} | Total noapte: ${sheetTotalNight} | Restaurante: ${sheetRestaurantCount} | Review: ${sheetReviewCount}`,
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
      `${capitalizeLabel(compactDayLabel)}    Zi: ${sum(group.rows, 'pickedUp')} - Noapte: ${sum(group.rows, 'nightPickedUp')}`,
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

      addProfessionalHeaderRow(sheet, rowNumber);
      rowNumber += 1;

      for (const dailyRow of restaurantGroup.rows) {
        const workHoursKey = dailyWorkHoursKey(dailyRow.dayKey, dailyRow.courierName);
        const workMinutes = workHoursByDayCourier.get(workHoursKey) ?? 0;
        const shouldShowWorkHours = !displayedWorkHours.has(workHoursKey);
        if (shouldShowWorkHours) {
          displayedWorkHours.add(workHoursKey);
        }

        const excelRow = sheet.getRow(rowNumber);
        excelRow.values = [
          dailyRow.courierName,
          dailyRow.pickedUp,
          dailyRow.zoneCounts.zone1,
          dailyRow.zoneCounts.zone2,
          dailyRow.zoneCounts.zone3,
          safeNumber(dailyRow.outsideZoneDeliveries),
          dailyRow.nightPickedUp,
          dailyRow.nightZoneCounts.zone1,
          dailyRow.nightZoneCounts.zone2,
          dailyRow.nightZoneCounts.zone3,
          safeNumber(dailyRow.nightOutsideZoneDeliveries),
          dailyRow.pickedUp + dailyRow.nightPickedUp,
          dailyRow.delivered + dailyRow.nightDelivered,
          formatDurationMinutes(dailyRow.averageDeliveryMinutes),
          shouldShowWorkHours ? formatWorkMinutes(workMinutes) : '',
          dailyRow.reviewCount,
        ];
        styleProfessionalDataRow(excelRow, rowNumber);
        rowNumber += 1;
      }

      rowNumber += 1;
    }

    rowNumber += 1;
  }
}

function addRestaurantProfessionalSheets(workbook: ExcelJS.Workbook, report: ScanReport): void {
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
    addProfessionalDailySheet(
      workbook,
      report,
      `Restaurant - ${restaurantName}`,
      rows,
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
    { header: 'Exterior zi', key: 'outsideCount', width: 12 },
    { header: 'Km exterior zi', key: 'km', width: 14 },
    { header: 'Lei exterior zi', key: 'lei', width: 15 },
    { header: 'Total noapte', key: 'night', width: 14 },
    { header: 'N Z1', key: 'nightZ1', width: 8 },
    { header: 'N Z2', key: 'nightZ2', width: 8 },
    { header: 'N Z3', key: 'nightZ3', width: 8 },
    { header: 'N exterior', key: 'nightOutsideCount', width: 12 },
    { header: 'N km ext.', key: 'nightKm', width: 12 },
    { header: 'N lei ext.', key: 'nightLei', width: 12 },
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
    { header: 'Exterior zi', key: 'outsideCount', width: 12 },
    { header: 'Km exterior zi', key: 'km', width: 14 },
    { header: 'Lei exterior zi', key: 'lei', width: 15 },
    { header: 'Total noapte', key: 'night', width: 14 },
    { header: 'N Z1', key: 'nightZ1', width: 8 },
    { header: 'N Z2', key: 'nightZ2', width: 8 },
    { header: 'N Z3', key: 'nightZ3', width: 8 },
    { header: 'N exterior', key: 'nightOutsideCount', width: 12 },
    { header: 'N km ext.', key: 'nightKm', width: 12 },
    { header: 'N lei ext.', key: 'nightLei', width: 12 },
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
    { header: 'Exterior zi', key: 'outsideCount', width: 12 },
    { header: 'Exterior zi', key: 'outside', width: 16 },
    { header: 'Total noapte', key: 'night', width: 14 },
    { header: 'N Z1', key: 'nightZ1', width: 8 },
    { header: 'N Z2', key: 'nightZ2', width: 8 },
    { header: 'N Z3', key: 'nightZ3', width: 8 },
    { header: 'N exterior', key: 'nightOutsideCount', width: 12 },
    { header: 'N exterior', key: 'nightOutside', width: 16 },
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

function addZonesSheet(workbook: ExcelJS.Workbook, report: ScanReport): void {
  const sheet = workbook.addWorksheet('Zone si exterior', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Curier', key: 'courier', width: 28 },
    { header: 'Z1 zi', key: 'z1', width: 10 },
    { header: 'Z2 zi', key: 'z2', width: 10 },
    { header: 'Z3 zi', key: 'z3', width: 10 },
    { header: 'Exterior zi', key: 'outsideCount', width: 12 },
    { header: 'Km exterior zi', key: 'km', width: 14 },
    { header: 'Lei exterior zi', key: 'lei', width: 14 },
    { header: 'N Z1', key: 'nightZ1', width: 10 },
    { header: 'N Z2', key: 'nightZ2', width: 10 },
    { header: 'N Z3', key: 'nightZ3', width: 10 },
    { header: 'N exterior', key: 'nightOutsideCount', width: 12 },
    { header: 'N km ext.', key: 'nightKm', width: 14 },
    { header: 'N lei ext.', key: 'nightLei', width: 14 },
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
    { header: 'N exterior', key: 'outsideCount', width: 12 },
    { header: 'N km ext.', key: 'km', width: 12 },
    { header: 'N lei ext.', key: 'lei', width: 12 },
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
      row.kind === 'mismatch' ? `ridicat ${row.pickedUp}, livrat ${row.delivered}` : row.originalMessage,
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

function addProfessionalHeaderRow(sheet: ExcelJS.Worksheet, rowNumber: number): void {
  const row = sheet.getRow(rowNumber);
  row.values = [
    'Livrator',
    'Total zi',
    'Z1 zi',
    'Z2 zi',
    'Z3 zi',
    'Exterior zi',
    'Total noapte',
    'N Z1',
    'N Z2',
    'N Z3',
    'N exterior',
    'Ridicat',
    'Livrat',
    'Timp',
    'Ore lucrate',
    'Rev',
  ];
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF526273' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FB' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
  });
  row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
}

function styleProfessionalDataRow(row: ExcelJS.Row, rowNumber: number): void {
  row.height = 22;
  const fillColor = rowNumber % 2 === 0 ? 'FFFFFFFF' : 'FFFBFCFD';
  row.eachCell((cell, columnNumber) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
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

function getReportImportRange(imports: ReportImport[]): ImportRange | null {
  const timestamps: number[] = [];
  let deliveryCount = 0;
  let availabilityCount = 0;

  for (const item of imports) {
    deliveryCount += item.importResult.messages.length;
    availabilityCount += item.importResult.availabilityMessages.length;
    for (const message of item.importResult.messages) {
      if (Number.isFinite(message.timestampMs)) {
        timestamps.push(message.timestampMs);
      }
    }
    for (const message of item.importResult.availabilityMessages) {
      if (Number.isFinite(message.timestampMs)) {
        timestamps.push(message.timestampMs);
      }
    }
  }

  if (!timestamps.length) {
    return null;
  }

  return {
    fromIso: new Date(Math.min(...timestamps)).toISOString(),
    toIso: new Date(Math.max(...timestamps)).toISOString(),
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
  return error instanceof Error && error.message ? error.message : fallback;
}

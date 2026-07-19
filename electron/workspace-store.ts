import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import { normalizeCourierIdentity } from '../src/shared/parser';
import { defaultPayrollSettings, mergePayrollSettings } from '../src/shared/payroll';
import {
  PARSER_VERSION,
  type AliasMap,
  type AppSettings,
  type Courier,
  type CourierInput,
  type ParserVersion,
  type Report,
  type ReportImport,
  type ReportImportInput,
  type ReportInput,
  type Restaurant,
  type RestaurantInput,
  type ScanOptions,
  type WorkspaceSnapshot,
} from '../src/shared/types';

const workspaceDbFileName = 'workspace.sqlite';

const defaultScanOptions: ScanOptions = {
  scanOrders: true,
  scanWorkHours: false,
  scanDeliveryTimes: true,
  includeAllRestaurants: true,
  restaurantIds: [],
};

const defaultSettings: AppSettings = {
  nightStartHour: 23,
  nightEndHour: 4,
  maxWorkSessionHours: 18,
  defaultExportScope: 'full',
  importRetentionDays: 30,
  payroll: defaultPayrollSettings,
};

const defaultRestaurantSchedule = {
  openingTime: '10:00',
  closingTime: '23:00',
  closesNextDay: false,
  usesRestaurantOrderTimeForNightTariff: false,
};

export class WorkspaceStore {
  private sql: SqlJsStatic | null = null;
  private db: Database | null = null;

  constructor(private readonly userDataPath: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.userDataPath, { recursive: true });
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    this.sql = await initSqlJs({
      locateFile: () => wasmPath,
    });

    try {
      const raw = await fs.readFile(this.dbPath());
      this.db = new this.sql.Database(raw);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.db = new this.sql.Database();
      } else {
        const recovered = await this.tryRecoverLastGoodDb();
        if (recovered) {
          this.db = recovered;
          console.warn('[workspace] Main DB was unreadable; restored last-good backup.');
        } else {
        const backupPath = await this.backupBrokenDb();
        console.error('[workspace] Could not open workspace DB. Backup created.', {
          backupPath,
          error,
        });
        throw new Error(
          `Workspace-ul local nu a putut fi citit. Am pastrat o copie de siguranta: ${backupPath}.`,
        );
        }
      }
    }

    this.migrate();
    await this.save();
  }

  getSnapshot(): WorkspaceSnapshot {
    const settings = this.getSettings();

    return {
      restaurants: this.listRestaurants(),
      couriers: this.listCouriers(),
      reports: this.listReports(),
      reportImports: this.listReportImports(),
      settings,
      maintenanceNotices: this.getSetting<string[]>('maintenanceNotices', []),
      parserVersion: {
        version: PARSER_VERSION,
        label: `Parser ${PARSER_VERSION}`,
      } satisfies ParserVersion,
    };
  }

  async backupToFile(targetPath: string): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await this.save();
    await fs.copyFile(this.dbPath(), targetPath);
  }

  async restoreFromFile(sourcePath: string): Promise<void> {
    if (!this.sql) {
      throw new Error('Workspace database is not initialized.');
    }
    const raw = await fs.readFile(sourcePath);
    let restored: Database | null = null;
    try {
      restored = new this.sql.Database(raw);
      const statement = restored.prepare(
        "select name from sqlite_master where type = 'table' and name in ('restaurants', 'reports', 'report_imports', 'app_settings')",
      );
      let tableCount = 0;
      try {
        while (statement.step()) {
          tableCount += 1;
        }
      } finally {
        statement.free();
      }
      if (tableCount < 4) {
        restored.close();
        throw new Error('Fisierul ales nu pare sa fie un backup valid al aplicatiei.');
      }

      await this.backupCurrentBeforeRestore();
      this.db?.close();
      this.db = restored;
      restored = null;
      this.migrate();
      await this.save();
    } catch (error) {
      restored?.close();
      throw error instanceof Error
        ? error
        : new Error('Backup-ul ales nu a putut fi restaurat.');
    }
  }

  getSettings(): AppSettings {
    const saved = this.getSetting<Partial<AppSettings>>('settings', defaultSettings);
    return {
      ...defaultSettings,
      ...saved,
      payroll: sanitizePayrollSettings(saved.payroll),
    };
  }

  async saveSettings(input: AppSettings): Promise<void> {
    const settings: AppSettings = {
      nightStartHour: clampInteger(input.nightStartHour, 0, 23, defaultSettings.nightStartHour),
      nightEndHour: clampInteger(input.nightEndHour, 0, 23, defaultSettings.nightEndHour),
      maxWorkSessionHours: clampInteger(input.maxWorkSessionHours, 1, 24, defaultSettings.maxWorkSessionHours),
      defaultExportScope: input.defaultExportScope ?? defaultSettings.defaultExportScope,
      importRetentionDays: clampInteger(input.importRetentionDays, 1, 365, defaultSettings.importRetentionDays),
      payroll: sanitizePayrollSettings(input.payroll),
    };
    this.setSetting('settings', settings);
    await this.save();
  }

  async addMaintenanceNotice(message: string): Promise<void> {
    const cleanMessage = message.trim();
    if (!cleanMessage) return;
    const notices = this.getSetting<string[]>('maintenanceNotices', []);
    this.setSetting('maintenanceNotices', [...new Set([...notices, cleanMessage])]);
    await this.save();
  }

  async saveRestaurant(input: RestaurantInput): Promise<Restaurant> {
    const now = new Date().toISOString();
    const existing = input.id ? this.getRestaurant(input.id) : null;
    const restaurant: Restaurant = {
      id: existing?.id ?? input.id ?? randomUUID(),
      name: sanitizeRequired(input.name, 'Numele restaurantului este obligatoriu.'),
      aliases: cleanList(input.aliases ?? existing?.aliases ?? []),
      schedule: sanitizeRestaurantSchedule(input.schedule, existing?.schedule),
      isActive: input.isActive ?? existing?.isActive ?? true,
      notes: input.notes?.trim() ?? existing?.notes ?? '',
      createdAtIso: existing?.createdAtIso ?? now,
      updatedAtIso: now,
    };

    this.run(
      `insert or replace into restaurants
        (id, name, aliases_json, schedule_json, is_active, notes, created_at_iso, updated_at_iso)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        restaurant.id,
        restaurant.name,
        JSON.stringify(restaurant.aliases),
        JSON.stringify(restaurant.schedule),
        restaurant.isActive ? 1 : 0,
        restaurant.notes,
        restaurant.createdAtIso,
        restaurant.updatedAtIso,
      ],
    );
    await this.save();
    return restaurant;
  }

  async deleteRestaurant(restaurantId: string): Promise<void> {
    const id = sanitizeRequired(restaurantId, 'Restaurant invalid.');
    if (!this.getRestaurant(id)) {
      throw new Error('Restaurantul nu exista.');
    }
    // Importurile istorice pastreaza source_label, deci pot ramane lizibile fara definitia restaurantului.
    this.run('delete from restaurants where id = ?', [id]);
    await this.save();
  }

  async saveCourier(input: CourierInput): Promise<Courier> {
    const now = new Date().toISOString();
    const existing = input.id ? this.getCourier(input.id) : null;
    const name = sanitizeRequired(input.name, 'Numele curierului este obligatoriu.');
    const suppliedAliases = input.aliases ?? existing?.aliases ?? [];
    const aliases = cleanList([
      ...suppliedAliases,
      ...(existing && normalizeCourierIdentity(existing.name) !== normalizeCourierIdentity(name)
        ? [existing.name]
        : []),
    ]);
    const courier: Courier = {
      id: existing?.id ?? input.id ?? randomUUID(),
      name,
      phone: input.phone?.trim() ?? existing?.phone ?? '',
      aliases,
      isActive: input.isActive ?? existing?.isActive ?? true,
      notes: input.notes?.trim() ?? existing?.notes ?? '',
      createdAtIso: existing?.createdAtIso ?? now,
      updatedAtIso: now,
    };
    const previousAliases = existing
      ? [existing.phone, ...existing.aliases].map(normalizeCourierIdentity).filter(Boolean).sort()
      : [];
    const nextAliases = [courier.phone, ...courier.aliases]
      .map(normalizeCourierIdentity)
      .filter(Boolean)
      .sort();
    const identityChanged = existing
      ? existing.name !== courier.name
        || existing.isActive !== courier.isActive
        || previousAliases.join('\u0000') !== nextAliases.join('\u0000')
      : nextAliases.length > 0;

    const requestedIdentities = new Set(
      [courier.phone, ...courier.aliases]
        .map(normalizeCourierIdentity)
        .filter(Boolean),
    );
    for (const other of this.listCouriers()) {
      if (other.id === courier.id) continue;
      const conflictingIdentity = [other.phone, ...other.aliases]
        .map(normalizeCourierIdentity)
        .find((identity) => identity && requestedIdentities.has(identity));
      if (conflictingIdentity) {
        throw new Error(`Telefonul sau aliasul este deja asociat curierului ${other.name}.`);
      }
    }

    this.run(
      `insert or replace into couriers
        (id, name, phone, aliases_json, is_active, notes, created_at_iso, updated_at_iso)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        courier.id,
        courier.name,
        courier.phone,
        JSON.stringify(courier.aliases),
        courier.isActive ? 1 : 0,
        courier.notes,
        courier.createdAtIso,
        courier.updatedAtIso,
      ],
    );
    if (identityChanged) {
      this.run(
        `update reports
         set status = 'draft', scanned_at_iso = null, updated_at_iso = ?
         where status in ('scanned', 'exported')`,
        [now],
      );
    }
    await this.save();
    return courier;
  }

  async deleteCourier(courierId: string): Promise<void> {
    const id = sanitizeRequired(courierId, 'Curier invalid.');
    if (!this.getCourier(id)) {
      throw new Error('Curierul nu exista.');
    }
    this.run('delete from couriers where id = ?', [id]);
    await this.save();
  }

  async saveReport(input: ReportInput): Promise<Report> {
    const now = new Date().toISOString();
    const existing = input.id ? this.getReport(input.id) : null;
    const report: Report = {
      id: existing?.id ?? input.id ?? randomUUID(),
      name: sanitizeRequired(input.name, 'Numele raportului este obligatoriu.'),
      fromIso: sanitizeIso(input.fromIso, 'Data de inceput a raportului este invalida.'),
      toIso: sanitizeIso(input.toIso, 'Data de final a raportului este invalida.'),
      status: input.status ?? existing?.status ?? 'draft',
      scanOptions: {
        ...defaultScanOptions,
        ...(existing?.scanOptions ?? {}),
        ...(input.scanOptions ?? {}),
      },
      parserVersion: PARSER_VERSION,
      createdAtIso: existing?.createdAtIso ?? now,
      updatedAtIso: now,
      scannedAtIso: existing?.scannedAtIso ?? null,
    };

    if (Date.parse(report.fromIso) > Date.parse(report.toIso)) {
      throw new Error('Data de inceput trebuie sa fie inainte de data de final.');
    }

    this.run(
      `insert or replace into reports
        (id, name, from_iso, to_iso, status, scan_options_json, parser_version, created_at_iso, updated_at_iso, scanned_at_iso)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        report.id,
        report.name,
        report.fromIso,
        report.toIso,
        report.status,
        JSON.stringify(report.scanOptions),
        report.parserVersion,
        report.createdAtIso,
        report.updatedAtIso,
        report.scannedAtIso,
      ],
    );
    await this.save();
    return report;
  }

  async deleteReport(reportId: string): Promise<void> {
    this.run('delete from report_imports where report_id = ?', [reportId]);
    this.run('delete from reports where id = ?', [reportId]);
    await this.save();
  }

  async deleteReportImport(importId: string): Promise<void> {
    this.run('delete from report_imports where id = ?', [importId]);
    await this.save();
  }

  async deleteAllReportImports(): Promise<void> {
    this.run('delete from report_imports');
    this.run(`update reports set status = 'draft', scanned_at_iso = null, updated_at_iso = ?`, [
      new Date().toISOString(),
    ]);
    await this.save();
  }

  async deleteOldReportImports(retentionDays: number): Promise<void> {
    const safeDays = clampInteger(retentionDays, 1, 365, defaultSettings.importRetentionDays);
    const cutoffIso = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
    const affectedReportIds = this.queryAll<{ report_id: string }, string>(
      'select distinct report_id from report_imports where imported_at_iso < ?',
      [cutoffIso],
      (row) => row.report_id,
    );

    this.run('delete from report_imports where imported_at_iso < ?', [cutoffIso]);
    for (const reportId of affectedReportIds) {
      this.run(`update reports set status = 'draft', scanned_at_iso = null, updated_at_iso = ? where id = ?`, [
        new Date().toISOString(),
        reportId,
      ]);
    }
    await this.saveSettings({ ...this.getSettings(), importRetentionDays: safeDays });
  }

  async saveReportImport(input: ReportImportInput, importResult: ReportImport['importResult']): Promise<ReportImport> {
    const report = this.getReport(input.reportId);
    if (!report) {
      throw new Error('Raportul selectat nu exista.');
    }

    const restaurant = input.restaurantId ? this.getRestaurant(input.restaurantId) : null;
    if (input.role === 'restaurant' && !restaurant) {
      throw new Error('Selecteaza restaurantul pentru acest import.');
    }

    const duplicateSource = this.findDuplicateReportImport(input, importResult);
    if (duplicateSource) {
      throw new Error(
        `Aceasta conversatie pare deja importata in raport (${duplicateSource}). Sterge raportul/importul vechi sau foloseste alt export.`,
      );
    }

    const importedAtIso = new Date().toISOString();
    const reportImport: ReportImport = {
      id: randomUUID(),
      reportId: input.reportId,
      role: input.role,
      restaurantId: input.restaurantId ?? null,
      sourceLabel: restaurant?.name ?? importResult.files[0]?.restaurantName ?? 'Import WhatsApp',
      importedAtIso,
      fileCount: importResult.files.length,
      messageCount: importResult.messages.length,
      availabilityMessageCount: importResult.availabilityMessages.length,
      issueCount: importResult.issues.length,
      importResult,
    };

    this.run(
      `insert into report_imports
        (id, report_id, role, restaurant_id, source_label, imported_at_iso, file_count, message_count, availability_count, issue_count, import_result_json)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reportImport.id,
        reportImport.reportId,
        reportImport.role,
        reportImport.restaurantId,
        reportImport.sourceLabel,
        reportImport.importedAtIso,
        reportImport.fileCount,
        reportImport.messageCount,
        reportImport.availabilityMessageCount,
        reportImport.issueCount,
        JSON.stringify(reportImport.importResult),
      ],
    );
    await this.save();
    return reportImport;
  }

  async markReportScanned(reportId: string, options: ScanOptions): Promise<void> {
    this.run(
      `update reports
       set status = 'scanned', scan_options_json = ?, parser_version = ?, scanned_at_iso = ?, updated_at_iso = ?
       where id = ?`,
      [
        JSON.stringify(options),
        PARSER_VERSION,
        new Date().toISOString(),
        new Date().toISOString(),
        reportId,
      ],
    );
    await this.save();
  }

  getReport(reportId: string): Report | null {
    return this.queryOne('select * from reports where id = ?', [reportId], rowToReport);
  }

  getRestaurant(restaurantId: string): Restaurant | null {
    return this.queryOne('select * from restaurants where id = ?', [restaurantId], rowToRestaurant);
  }

  getCourier(courierId: string): Courier | null {
    return this.queryOne('select * from couriers where id = ?', [courierId], rowToCourier);
  }

  listRestaurants(): Restaurant[] {
    return this.queryAll('select * from restaurants order by is_active desc, name collate nocase', [], rowToRestaurant);
  }

  listCouriers(): Courier[] {
    return this.queryAll('select * from couriers order by is_active desc, name collate nocase', [], rowToCourier);
  }

  listReports(): Report[] {
    return this.queryAll('select * from reports order by created_at_iso desc', [], rowToReport);
  }

  listReportImports(reportId?: string): ReportImport[] {
    if (reportId) {
      return this.queryAll(
        'select * from report_imports where report_id = ? order by imported_at_iso desc',
        [reportId],
        rowToReportImport,
      );
    }
    return this.queryAll('select * from report_imports order by imported_at_iso desc', [], rowToReportImport);
  }

  getAliasMap(): AliasMap {
    const aliases: AliasMap = {};
    // Inactive courier records are historical only. Their identities must not
    // continue grouping fresh report rows under an old display name.
    for (const courier of this.listCouriers().filter((item) => item.isActive)) {
      for (const alias of courier.aliases) {
        aliases[alias] = courier.name;
      }
      if (courier.phone) {
        aliases[courier.phone] = courier.name;
      }
    }
    return aliases;
  }

  async saveAliasMap(aliases: AliasMap): Promise<AliasMap> {
    for (const [sender, displayName] of Object.entries(aliases)) {
      const cleanSender = sender.trim();
      const cleanDisplayName = displayName.trim();
      if (!cleanSender || !cleanDisplayName) {
        continue;
      }

      const existing = this
        .listCouriers()
        .find((courier) => courier.name === cleanDisplayName || courier.aliases.includes(cleanSender));
      await this.saveCourier({
        id: existing?.id,
        name: cleanDisplayName,
        phone: existing?.phone ?? '',
        aliases: cleanList([...(existing?.aliases ?? []), cleanSender]),
        isActive: existing?.isActive ?? true,
        notes: existing?.notes ?? '',
      });
    }

    return this.getAliasMap();
  }

  async migrateLegacyAliases(aliases: AliasMap): Promise<{ imported: number; conflicts: string[]; skipped: boolean }> {
    if (this.getSetting<boolean>('legacyCourierAliasesMigrationV1', false)) {
      return { imported: 0, conflicts: [], skipped: true };
    }

    const conflicts: string[] = [];
    let imported = 0;
    const identityOwners = new Map<string, string>();
    for (const [alias, displayName] of Object.entries(this.getAliasMap())) {
      const identity = normalizeCourierIdentity(alias);
      if (identity) identityOwners.set(identity, displayName);
    }

    for (const [sender, displayName] of Object.entries(aliases)) {
      const cleanSender = sender.trim();
      const cleanDisplayName = displayName.trim();
      const identity = normalizeCourierIdentity(cleanSender);
      if (!cleanSender || !cleanDisplayName || !identity) continue;

      const currentOwner = identityOwners.get(identity);
      if (currentOwner) {
        if (currentOwner.toLocaleLowerCase('ro-RO') !== cleanDisplayName.toLocaleLowerCase('ro-RO')) {
          conflicts.push(`${cleanSender}: ${currentOwner} / ${cleanDisplayName}`);
        }
        continue;
      }

      const existing = this.listCouriers().find(
        (courier) => courier.name.toLocaleLowerCase('ro-RO') === cleanDisplayName.toLocaleLowerCase('ro-RO'),
      );
      await this.saveCourier({
        id: existing?.id,
        name: cleanDisplayName,
        phone: existing?.phone ?? '',
        aliases: cleanList([...(existing?.aliases ?? []), cleanSender]),
        isActive: existing?.isActive ?? true,
        notes: existing?.notes ?? 'Migrat automat din aliasurile versiunii anterioare.',
      });
      identityOwners.set(identity, cleanDisplayName);
      imported += 1;
    }

    if (conflicts.length === 0) this.setSetting('legacyCourierAliasesMigrationV1', true);
    await this.save();
    return { imported, conflicts, skipped: false };
  }

  private migrate(): void {
    this.run(
      `create table if not exists restaurants (
        id text primary key,
        name text not null,
        aliases_json text not null,
        schedule_json text,
        is_active integer not null,
        notes text not null,
        created_at_iso text not null,
        updated_at_iso text not null
      )`,
    );
    this.run(
      `create table if not exists couriers (
        id text primary key,
        name text not null,
        phone text not null,
        aliases_json text not null,
        is_active integer not null,
        notes text not null,
        created_at_iso text not null,
        updated_at_iso text not null
      )`,
    );

    this.ensureColumn('restaurants', 'schedule_json', 'text');
    this.run(
      `create table if not exists reports (
        id text primary key,
        name text not null,
        from_iso text not null,
        to_iso text not null,
        status text not null,
        scan_options_json text not null,
        parser_version text not null,
        created_at_iso text not null,
        updated_at_iso text not null,
        scanned_at_iso text
      )`,
    );
    this.run(
      `create table if not exists report_imports (
        id text primary key,
        report_id text not null,
        role text not null,
        restaurant_id text,
        source_label text not null,
        imported_at_iso text not null,
        file_count integer not null,
        message_count integer not null,
        availability_count integer not null,
        issue_count integer not null,
        import_result_json text not null,
        foreign key(report_id) references reports(id) on delete cascade
      )`,
    );
    this.run(
      `create table if not exists app_settings (
        key text primary key,
        value_json text not null
      )`,
    );

    if (!this.getSetting<AppSettings | null>('settings', null)) {
      this.setSetting('settings', defaultSettings);
    }
  }

  private ensureColumn(table: 'restaurants', column: 'schedule_json', definition: string): void {
    const columns = this.queryAll<{ name: string }, string>(
      `pragma table_info(${table})`,
      [],
      (row) => String(row.name),
    );
    if (!columns.includes(column)) {
      this.run(`alter table ${table} add column ${column} ${definition}`);
    }
  }

  private getSetting<T>(key: string, fallback: T): T {
    const row = this.queryOne<{ value_json: string }, T>(
      'select value_json from app_settings where key = ?',
      [key],
      (value) => JSON.parse(value.value_json) as T,
    );
    return row ?? fallback;
  }

  private setSetting(key: string, value: unknown): void {
    this.run('insert or replace into app_settings (key, value_json) values (?, ?)', [
      key,
      JSON.stringify(value),
    ]);
  }

  private run(sql: string, params: SqlValue[] = []): void {
    const statement = this.requireDb().prepare(sql);
    try {
      statement.bind(params);
      statement.step();
    } finally {
      statement.free();
    }
  }

  private queryAll<Row extends Record<string, unknown>, Result>(
    sql: string,
    params: SqlValue[],
    mapper: (row: Row) => Result,
  ): Result[] {
    const statement = this.requireDb().prepare(sql);
    const rows: Result[] = [];
    try {
      statement.bind(params);
      while (statement.step()) {
        rows.push(mapper(statement.getAsObject() as Row));
      }
    } finally {
      statement.free();
    }
    return rows;
  }

  private queryOne<Row extends Record<string, unknown>, Result>(
    sql: string,
    params: SqlValue[],
    mapper: (row: Row) => Result,
  ): Result | null {
    return this.queryAll(sql, params, mapper)[0] ?? null;
  }

  private requireDb(): Database {
    if (!this.db) {
      throw new Error('Workspace database is not initialized.');
    }
    return this.db;
  }

  private dbPath(): string {
    return path.join(this.userDataPath, workspaceDbFileName);
  }

  private async backupBrokenDb(): Promise<string> {
    const sourcePath = this.dbPath();
    const backupPath = path.join(
      this.userDataPath,
      `workspace-${new Date().toISOString().replace(/[:.]/g, '-')}.broken.sqlite`,
    );
    try {
      await fs.copyFile(sourcePath, backupPath);
      return backupPath;
    } catch (error) {
      console.warn('[workspace] Could not create broken DB backup.', error);
      return sourcePath;
    }
  }

  private async backupCurrentBeforeRestore(): Promise<void> {
    try {
      await fs.copyFile(
        this.dbPath(),
        path.join(
          this.userDataPath,
          `workspace-before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
        ),
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.warn('[workspace] Could not backup current DB before restore.', error);
      }
    }
  }

  private async tryRecoverLastGoodDb(): Promise<Database | null> {
    if (!this.sql) {
      return null;
    }
    const backupPath = path.join(this.userDataPath, 'workspace.last-good.sqlite');
    try {
      const raw = await fs.readFile(backupPath);
      const recovered = new this.sql.Database(raw);
      await fs.copyFile(backupPath, this.dbPath());
      return recovered;
    } catch (error) {
      console.warn('[workspace] Last-good recovery failed.', error);
      return null;
    }
  }

  private async save(): Promise<void> {
    const db = this.requireDb();
    const data = db.export();
    const dbPath = this.dbPath();
    const backupPath = path.join(this.userDataPath, 'workspace.last-good.sqlite');
    const tempPath = path.join(this.userDataPath, 'workspace.sqlite.tmp');
    try {
      await fs.copyFile(dbPath, backupPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.warn('[workspace] Could not refresh last-good backup before save.', error);
      }
    }
    await fs.writeFile(tempPath, Buffer.from(data));
    await fs.rename(tempPath, dbPath);
  }

  private findDuplicateReportImport(
    input: ReportImportInput,
    importResult: ReportImport['importResult'],
  ): string | null {
    const fingerprint = importFingerprint(input, importResult);
    const existingImports = this.listReportImports(input.reportId);
    for (const existing of existingImports) {
      if (importFingerprint(existing, existing.importResult) === fingerprint) {
        return existing.sourceLabel;
      }
    }
    return null;
  }
}

function importFingerprint(
  input: Pick<ReportImportInput, 'role' | 'restaurantId'>,
  importResult: ReportImport['importResult'],
): string {
  const sourceFiles = importResult.files
    .map((file) => `${file.sourceFile}:${file.bytes}:${file.rawLineCount}`)
    .sort()
    .join('|');
  const messageIds = [
    ...importResult.messages.map((message) => message.id),
    ...importResult.availabilityMessages.map((message) => message.id),
  ]
    .sort()
    .slice(0, 50)
    .join('|');
  return [
    input.role,
    input.restaurantId ?? '',
    importResult.files.length,
    importResult.messages.length,
    importResult.availabilityMessages.length,
    sourceFiles,
    messageIds,
  ].join('::');
}

function rowToRestaurant(row: Record<string, unknown>): Restaurant {
  return {
    id: String(row.id),
    name: String(row.name),
    aliases: parseJsonList(row.aliases_json),
    schedule: parseRestaurantSchedule(row.schedule_json),
    isActive: Number(row.is_active) === 1,
    notes: String(row.notes ?? ''),
    createdAtIso: String(row.created_at_iso),
    updatedAtIso: String(row.updated_at_iso),
  };
}

function rowToCourier(row: Record<string, unknown>): Courier {
  return {
    id: String(row.id),
    name: String(row.name),
    phone: String(row.phone ?? ''),
    aliases: parseJsonList(row.aliases_json),
    isActive: Number(row.is_active) === 1,
    notes: String(row.notes ?? ''),
    createdAtIso: String(row.created_at_iso),
    updatedAtIso: String(row.updated_at_iso),
  };
}

function rowToReport(row: Record<string, unknown>): Report {
  return {
    id: String(row.id),
    name: String(row.name),
    fromIso: String(row.from_iso),
    toIso: String(row.to_iso),
    status: row.status === 'verified' || row.status === 'exported' || row.status === 'scanned' ? row.status : 'draft',
    scanOptions: parseScanOptions(row.scan_options_json),
    parserVersion: String(row.parser_version ?? PARSER_VERSION),
    createdAtIso: String(row.created_at_iso),
    updatedAtIso: String(row.updated_at_iso),
    scannedAtIso: row.scanned_at_iso ? String(row.scanned_at_iso) : null,
  };
}

function rowToReportImport(row: Record<string, unknown>): ReportImport {
  const role = String(row.role);
  return {
    id: String(row.id),
    reportId: String(row.report_id),
    role: role === 'workHours' || role === 'mixed' ? role : 'restaurant',
    restaurantId: row.restaurant_id ? String(row.restaurant_id) : null,
    sourceLabel: String(row.source_label),
    importedAtIso: String(row.imported_at_iso),
    fileCount: Number(row.file_count),
    messageCount: Number(row.message_count),
    availabilityMessageCount: Number(row.availability_count),
    issueCount: Number(row.issue_count),
    importResult: JSON.parse(String(row.import_result_json)) as ReportImport['importResult'],
  };
}

function parseJsonList(value: unknown): string[] {
  try {
    return cleanList(JSON.parse(String(value)) as string[]);
  } catch {
    return [];
  }
}

function parseRestaurantSchedule(value: unknown): Restaurant['schedule'] {
  try {
    return sanitizeRestaurantSchedule(JSON.parse(String(value)) as Partial<Restaurant['schedule']>);
  } catch {
    return { ...defaultRestaurantSchedule };
  }
}

function sanitizeRestaurantSchedule(
  input?: Partial<Restaurant['schedule']>,
  fallback?: Restaurant['schedule'],
): Restaurant['schedule'] {
  const base = fallback ?? defaultRestaurantSchedule;
  return {
    openingTime: sanitizeScheduleTime(input?.openingTime, base.openingTime),
    closingTime: sanitizeScheduleTime(input?.closingTime, base.closingTime),
    closesNextDay: input?.closesNextDay ?? base.closesNextDay,
    usesRestaurantOrderTimeForNightTariff:
      input?.usesRestaurantOrderTimeForNightTariff ?? base.usesRestaurantOrderTimeForNightTariff,
  };
}

function sanitizeScheduleTime(value: string | undefined, fallback: string): string {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return fallback;
  }
  return value;
}

function parseScanOptions(value: unknown): ScanOptions {
  try {
    const parsed = JSON.parse(String(value)) as Partial<ScanOptions>;
    return {
      ...defaultScanOptions,
      ...parsed,
    };
  } catch {
    return defaultScanOptions;
  }
}

function sanitizeRequired(value: string, message: string): string {
  const clean = value.trim();
  if (!clean) {
    throw new Error(message);
  }
  return clean;
}

function sanitizeIso(value: string, message: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(message);
  }
  return new Date(parsed).toISOString();
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitizePayrollSettings(input: AppSettings['payroll'] | undefined): AppSettings['payroll'] {
  const merged = mergePayrollSettings(input);
  const sanitizeZone = (zone: typeof merged.zoneRates.zone1) => ({
    dayCash: clampNumber(zone.dayCash, 0, 10_000, 0),
    dayInvoiced: clampNumber(zone.dayInvoiced, 0, 10_000, 0),
    nightCash: clampNumber(zone.nightCash, 0, 10_000, 0),
    nightInvoiced: clampNumber(zone.nightInvoiced, 0, 10_000, 0),
  });
  return {
    ...merged,
    enabled: Boolean(merged.enabled),
    zoneRates: {
      zone1: sanitizeZone(merged.zoneRates.zone1),
      zone2: sanitizeZone(merged.zoneRates.zone2),
      zone3: sanitizeZone(merged.zoneRates.zone3),
    },
    restaurantMethods: Object.fromEntries(
      Object.entries(merged.restaurantMethods).filter(([, method]) =>
        method === 'cash' || method === 'cashPaid' || method === 'invoiced'),
    ),
    courierRules: Object.fromEntries(Object.entries(merged.courierRules).map(([courierId, rule]) => [
      courierId,
      {
        calculationMode: rule.calculationMode === 'cashOnly' ? 'cashOnly' : 'all',
        commissionPerOrder: clampNumber(rule.commissionPerOrder, 0, 10_000, 0),
        taxRate: clampNumber(rule.taxRate, 0, 1, 0),
        invoiceCommissionPerOrder: clampNumber(rule.invoiceCommissionPerOrder, 0, 10_000, 0),
      },
    ])),
    restaurantCourierOverrides: Object.fromEntries(
      Object.entries(merged.restaurantCourierOverrides).filter(([, method]) =>
        method === 'cash' || method === 'cashPaid' || method === 'invoiced'),
    ),
    commissionAdjustmentLei: clampNumber(merged.commissionAdjustmentLei, 0, 100_000, 80),
  };
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function cleanList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

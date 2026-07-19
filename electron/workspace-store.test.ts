import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from './workspace-store';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function createStore(): Promise<WorkspaceStore> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'whatsapp-counter-store-'));
  tempDirectories.push(directory);
  const store = new WorkspaceStore(directory);
  await store.init();
  return store;
}

describe('WorkspaceStore legacy courier aliases', () => {
  it('keeps the salary report disabled until the operator explicitly configures it', async () => {
    const store = await createStore();

    expect(store.getSettings().payroll.enabled).toBe(false);
    expect(store.getSettings().payroll.zoneRates.zone1.dayCash).toBe(14);
  });

  it('migrates legacy phone aliases into SQLite once and keeps Romanian phone matching available', async () => {
    const store = await createStore();

    const firstMigration = await store.migrateLegacyAliases({ '0745 123 456': 'Robert Ifrim' });
    const secondMigration = await store.migrateLegacyAliases({ '0745 123 456': 'Robert Ifrim' });

    expect(firstMigration).toMatchObject({ imported: 1, conflicts: [], skipped: false });
    expect(secondMigration).toMatchObject({ imported: 0, conflicts: [], skipped: true });
    expect(store.listCouriers()).toHaveLength(1);
    expect(store.getAliasMap()).toEqual({ '0745 123 456': 'Robert Ifrim' });
  });

  it('does not overwrite a current courier when a legacy identity points to another name', async () => {
    const store = await createStore();
    await store.saveCourier({ name: 'Robert Actual', phone: '+40 745 123 456', aliases: [] });

    const migration = await store.migrateLegacyAliases({ '0745 123 456': 'Robert Vechi' });

    expect(migration.imported).toBe(0);
    expect(migration.conflicts).toHaveLength(1);
    expect(store.listCouriers().map((courier) => courier.name)).toEqual(['Robert Actual']);
  });
});

describe('WorkspaceStore courier identity ownership', () => {
  it('excludes inactive courier aliases from new report scans', async () => {
    const store = await createStore();
    const activeCourier = await store.saveCourier({ name: 'Ana', phone: '', aliases: ['Ana WhatsApp'] });
    const inactiveCourier = await store.saveCourier({ name: 'Bogdan vechi', phone: '', aliases: ['Bogdan WhatsApp'] });

    await store.saveCourier({
      id: inactiveCourier.id,
      name: inactiveCourier.name,
      phone: inactiveCourier.phone,
      aliases: inactiveCourier.aliases,
      isActive: false,
      notes: inactiveCourier.notes,
    });

    expect(store.getAliasMap()).toEqual({
      'Ana WhatsApp': activeCourier.name,
    });
  });

  it('rejects equivalent Romanian phone formats assigned to different couriers', async () => {
    const store = await createStore();
    await store.saveCourier({ name: 'Ana', phone: '0745 123 456', aliases: [] });

    await expect(
      store.saveCourier({ name: 'Bogdan', phone: '+40 745 123 456', aliases: [] }),
    ).rejects.toThrow('Telefonul sau aliasul este deja asociat curierului Ana.');
    expect(store.listCouriers().map((courier) => courier.name)).toEqual(['Ana']);
  });

  it('allows a courier to update its own equivalent phone format', async () => {
    const store = await createStore();
    const courier = await store.saveCourier({ name: 'Ana', phone: '0745 123 456', aliases: [] });

    await store.saveCourier({ id: courier.id, name: 'Ana Ifrim', phone: '0040 745 123 456', aliases: [] });

    expect(store.listCouriers()).toMatchObject([{ name: 'Ana Ifrim', phone: '0040 745 123 456' }]);
    expect(store.getAliasMap()).toEqual({
      '0040 745 123 456': 'Ana Ifrim',
      Ana: 'Ana Ifrim',
    });
  });

  it('marks scanned reports as draft after a courier identity changes', async () => {
    const store = await createStore();
    const courier = await store.saveCourier({ name: 'Ana', phone: '', aliases: ['Ana WhatsApp'] });
    const report = await store.saveReport({
      name: 'Raport test',
      fromIso: '2026-06-15T07:00:00.000Z',
      toIso: '2026-06-22T01:00:00.000Z',
    });
    await store.markReportScanned(report.id, report.scanOptions);

    await store.saveCourier({
      id: courier.id,
      name: 'Ana Ifrim',
      phone: '',
      aliases: ['Ana WhatsApp'],
    });

    expect(store.getReport(report.id)).toMatchObject({ status: 'draft', scannedAtIso: null });
    expect(store.getAliasMap()).toEqual({
      'Ana WhatsApp': 'Ana Ifrim',
      Ana: 'Ana Ifrim',
    });
  });

  it('marks identity-dependent reports as draft after deleting a courier identity', async () => {
    const store = await createStore();
    const courier = await store.saveCourier({ name: 'Ana', phone: '', aliases: ['Ana WhatsApp'] });
    const reports = await Promise.all((['scanned', 'verified', 'exported'] as const).map((status) =>
      store.saveReport({
        name: `Raport ${status}`,
        fromIso: '2026-06-15T07:00:00.000Z',
        toIso: '2026-06-22T01:00:00.000Z',
        status,
      }),
    ));

    await store.deleteCourier(courier.id);

    for (const report of reports) {
      expect(store.getReport(report.id)).toMatchObject({ status: 'draft', scannedAtIso: null });
    }
    expect(store.getAliasMap()).toEqual({});
  });

  it('keeps scanned reports intact when only courier notes change', async () => {
    const store = await createStore();
    const courier = await store.saveCourier({ name: 'Ana', phone: '', aliases: ['Ana WhatsApp'] });
    const report = await store.saveReport({
      name: 'Raport test',
      fromIso: '2026-06-15T07:00:00.000Z',
      toIso: '2026-06-22T01:00:00.000Z',
    });
    await store.markReportScanned(report.id, report.scanOptions);

    await store.saveCourier({
      id: courier.id,
      name: courier.name,
      phone: courier.phone,
      aliases: courier.aliases,
      notes: 'Observatie noua, fara efect asupra aliasurilor.',
    });

    expect(store.getReport(report.id)).toMatchObject({ status: 'scanned' });
    expect(store.getReport(report.id)?.scannedAtIso).not.toBeNull();
  });

  it('invalidates scanned reports when a newly created courier introduces an alias', async () => {
    const store = await createStore();
    const report = await store.saveReport({
      name: 'Raport test',
      fromIso: '2026-06-15T07:00:00.000Z',
      toIso: '2026-06-22T01:00:00.000Z',
    });
    await store.markReportScanned(report.id, report.scanOptions);

    await store.saveCourier({ name: 'Ana', phone: '', aliases: ['Ana WhatsApp'] });

    expect(store.getReport(report.id)).toMatchObject({ status: 'draft', scannedAtIso: null });
  });
});

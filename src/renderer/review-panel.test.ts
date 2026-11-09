import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewPanel } from './App';

describe('source context in balanced reports', () => {
  it('opens the selected source even when the report has zero review errors', () => {
    const html = renderToStaticMarkup(createElement(ReviewPanel, {
      rows: [], imports: [], onSelect: () => {},
      activeRow: { kind: 'metric-source', id: 'order', severity: 'warning', restaurantName: 'Test', courierName: 'Cosmin',
        sourceMessageIds: ['pickup'], reason: '', sourceAnchors: [] },
    }));
    expect(html).toContain('Context pentru comanda selectata');
    expect(html).not.toContain('Nu exista randuri de review.');
  });

  it('shows the empty review state only when no source is selected', () => {
    const html = renderToStaticMarkup(createElement(ReviewPanel, { rows: [], imports: [], activeRow: null, onSelect: () => {} }));
    expect(html).toContain('Nu exista randuri de review.');
  });
});

import { describe, expect, it } from 'vitest';
import { PDF_PARSERS } from '../../src/parsers';
import { MAPPERS } from '../../src/services/importPipeline';
import { SOURCE_LABELS } from '../../src/ui/useImportHistory';

// SOURCE_LABELS and MAPPERS are typed Record<SourceId, ...>, so the compiler already forces them to cover
// every source. These tests guard the parts the type system cannot see: the PDF registry.
describe('source registry', () => {
  const sourceIds = Object.keys(SOURCE_LABELS).sort();

  it('registers every PDF source exactly once, and the only non-PDF source is the XLSX one', () => {
    const pdfSources = PDF_PARSERS.map((p) => p.source);
    expect(new Set(pdfSources).size).toBe(pdfSources.length);
    expect([...pdfSources, 'etrade-xlsx'].sort()).toEqual(sourceIds);
  });

  it('has a mapper for every source', () => {
    expect(Object.keys(MAPPERS).sort()).toEqual(sourceIds);
    for (const mapper of Object.values(MAPPERS)) expect(typeof mapper).toBe('function');
  });

  it('has a non-empty label for every source', () => {
    for (const label of Object.values(SOURCE_LABELS)) expect(label.trim()).not.toBe('');
  });
});

// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../../src/domain/categorise';
import { CatTile, categoryIcon } from '../../src/ui/common/CatTile';
import { payeeLabel } from '../../src/ui/common/TxnItem';

afterEach(cleanup);

describe('CatTile', () => {
  it('draws an icon for every built-in category and for transfers', () => {
    for (const name of [...DEFAULT_CATEGORIES, 'Transfer']) {
      expect(categoryIcon(name), name).not.toBeNull();
      const { container } = render(<CatTile name={name} />);
      expect(container.querySelector('svg'), name).not.toBeNull();
      cleanup();
    }
  });

  it('tells Transport and Travel apart, which shared the TR letters', () => {
    expect(categoryIcon('Transport')).not.toBe(categoryIcon('Travel'));
  });

  it('falls back to two letters for a category the user made', () => {
    const { container } = render(<CatTile name="Pet care" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('PC');
  });
});

describe('payeeLabel', () => {
  it.each([
    ['UPIOUT/512345678901/netflixupi.payu@hdfcbank/4899', 'Netflix'],
    ['WDL TFR UPI/DR/512345678901/M/S. ACME TOYS/ICIC/x/Paym', 'Acme Toys'],
    ['TO ECM/791999/ACME AI \\1450 Page Mil', 'Acme AI'],
    ['WDL TFR UPI/DR/512345678901/B74 RATN/YESB/x/Paym', 'B74 Ratn'],
    ['UPIOUT/512345678901/9876543210@axl/Payment f/0000', '9876543210@axl'],
  ])('%s', (description, label) => {
    expect(payeeLabel(description)).toBe(label);
  });
});

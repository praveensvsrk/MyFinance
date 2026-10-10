// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../../src/domain/categorise';
import { CatTile, categoryIcon } from '../../src/ui/common/CatTile';

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

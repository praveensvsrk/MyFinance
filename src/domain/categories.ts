import { DEFAULT_CATEGORIES } from './categorise';

/**
 * The user's category setup: extra categories they created, and which categories (built-in or
 * custom) are left out of income and spending, such as money sent to family.
 */
export interface CategoryConfig {
  custom: string[];
  excluded: string[];
}

export const DEFAULT_CATEGORY_CONFIG: CategoryConfig = { custom: [], excluded: ['Family'] };

/** The built-in categories followed by the custom ones. */
export function allCategories(config: CategoryConfig): string[] {
  return [...DEFAULT_CATEGORIES, ...config.custom];
}

export function excludedSet(config: CategoryConfig): Set<string> {
  return new Set(config.excluded);
}

/** A category name tidied for storage, or null when it is empty or already taken (any case). */
export function cleanCategoryName(name: string, config: CategoryConfig): string | null {
  const cleaned = name.replace(/\s+/g, ' ').trim();
  if (cleaned === '') return null;
  const taken = allCategories(config).some((existing) => existing.toLowerCase() === cleaned.toLowerCase());
  return taken ? null : cleaned;
}

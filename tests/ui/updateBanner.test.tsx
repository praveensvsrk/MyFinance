// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The real hook needs the PWA plugin's virtual module, which exists only in a Vite build.
vi.mock('../../src/pwa/useUpdatePrompt', () => ({ useUpdatePrompt: () => ({}) }));

import { UpdateBannerView } from '../../src/ui/shell/UpdateBanner';

afterEach(cleanup);

describe('UpdateBannerView', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(
      <UpdateBannerView needRefresh={false} offlineReady={false} onUpdate={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container.textContent).toBe('');
  });

  it('offers a reload when an update is waiting', () => {
    const onUpdate = vi.fn();
    render(<UpdateBannerView needRefresh offlineReady={false} onUpdate={onUpdate} onDismiss={vi.fn()} />);
    expect(screen.getByText('Update available')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('says when the app is ready offline and can be dismissed', () => {
    const onDismiss = vi.fn();
    render(<UpdateBannerView needRefresh={false} offlineReady onUpdate={vi.fn()} onDismiss={onDismiss} />);
    expect(screen.getByText('Ready to work offline')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

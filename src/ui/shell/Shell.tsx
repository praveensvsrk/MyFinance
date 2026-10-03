import { Link, Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { TabBar } from './TabBar';

/** Header (Import, Settings), the routed screen and the bottom tab bar. */
export function Shell() {
  const { pathname } = useLocation();
  return (
    <div className="app">
      <header className="app-header">
        <strong>MyFinance</strong>
        <span>
          <Link to="/import">Import</Link>
          <Link to="/settings">Settings</Link>
        </span>
      </header>
      <main className="app-main">
        {/* Keyed by route so a crashed screen recovers when the user navigates away. */}
        <ErrorBoundary key={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <TabBar />
    </div>
  );
}

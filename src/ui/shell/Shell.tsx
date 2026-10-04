import { Link, Outlet, useLocation } from 'react-router-dom';
import { SampleBanner } from '../home/SampleBanner';
import { useSampleData } from '../hooks';
import { Icon } from '../Icon';
import { ErrorBoundary } from './ErrorBoundary';
import { NotificationsBell } from './Notifications';
import { TabBar } from './TabBar';

interface Header {
  title: string;
  /** Where the back arrow goes; top-level screens have none and show Import (some) and the Notifications bell instead. */
  back?: string;
}

function headerFor(pathname: string): Header {
  if (pathname === '/import') return { title: 'Import', back: '/' };
  if (pathname === '/settings') return { title: 'Settings' };
  if (pathname.startsWith('/accounts/')) return { title: 'Account', back: '/accounts' };
  if (pathname === '/cash-flow/year') return { title: 'Financial year', back: '/cash-flow' };
  if (pathname === '/cash-flow') return { title: 'Cash flow' };
  if (pathname === '/accounts') return { title: 'Accounts' };
  if (pathname === '/plan') return { title: 'Plan' };
  return { title: 'Home' };
}

/** Header (title, Import, Notifications bell), the routed screen and the bottom tab bar. */
export function Shell() {
  const { pathname } = useLocation();
  const { title, back } = headerFor(pathname);
  const sample = useSampleData();
  return (
    <div className="app">
      <header className={back === undefined ? 'hdr' : 'hdr has-back'}>
        {back !== undefined && (
          <Link className="ib" to={back} aria-label="Back">
            <Icon name="back" size={20} />
          </Link>
        )}
        <h1>{title}</h1>
        <span className="grow" />
        {back === undefined && (
          <>
            <Link className="ib" to="/import" aria-label="Import">
              <Icon name="import" size={20} />
            </Link>
            <NotificationsBell />
          </>
        )}
      </header>
      {/* Keyed by route so a crashed screen recovers when the user navigates away. */}
      <ErrorBoundary key={pathname}>
        <main className="screen">
          {sample.data === true && <SampleBanner />}
          <Outlet />
        </main>
      </ErrorBoundary>
      <TabBar />
    </div>
  );
}

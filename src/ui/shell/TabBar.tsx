import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from '../Icon';

const TABS: { to: string; label: string; end: boolean; icon: IconName; activeIcon?: IconName }[] = [
  { to: '/', label: 'Home', end: true, icon: 'home', activeIcon: 'homeFill' },
  { to: '/cash-flow', label: 'Cash flow', end: false, icon: 'flow' },
  { to: '/accounts', label: 'Accounts', end: false, icon: 'bank' },
  { to: '/plan', label: 'Plan', end: false, icon: 'plan' },
  { to: '/settings', label: 'Settings', end: false, icon: 'settings' },
];

/** The bottom tab bar. `/accounts/:id` keeps Accounts active because that link is not `end`. */
export function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => (isActive ? 'tab on' : 'tab')}>
          {({ isActive }) => (
            <>
              <span className="pill">
                <Icon name={isActive && tab.activeIcon !== undefined ? tab.activeIcon : tab.icon} />
              </span>
              {tab.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

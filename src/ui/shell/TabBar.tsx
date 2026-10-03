import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Home', end: true },
  { to: '/cash-flow', label: 'Cash flow', end: false },
  { to: '/accounts', label: 'Accounts', end: false },
  { to: '/plan', label: 'Plan', end: false },
];

/** The bottom tab bar. `/accounts/:id` keeps Accounts active because that link is not `end`. */
export function TabBar() {
  return (
    <nav className="tab-bar" aria-label="Main">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppProvider } from './ui/AppContext';
import { AccountDetail } from './ui/pages/AccountDetail';
import { Accounts } from './ui/pages/Accounts';
import { CashFlow } from './ui/pages/CashFlow';
import { FinancialYear } from './ui/pages/FinancialYear';
import { Home } from './ui/pages/Home';
import { Import } from './ui/pages/Import';
import { Plan } from './ui/pages/Plan';
import { Settings } from './ui/pages/Settings';
import { Shell } from './ui/shell/Shell';

/** The route table, separate from the router so tests can mount it in a memory router. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="cash-flow" element={<CashFlow />} />
        <Route path="cash-flow/year" element={<FinancialYear />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="accounts/:id" element={<AccountDetail />} />
        <Route path="plan" element={<Plan />} />
        <Route path="import" element={<Import />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/** HashRouter keeps routing client-side, so deep links and reloads work on static hosting. */
export function App({ children }: { children?: ReactNode }) {
  return (
    <AppProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
      {children}
    </AppProvider>
  );
}

import { usePlanInputs } from '../hooks';
import { Debug } from './Debug';

export function Plan() {
  return <Debug title="Plan" query={usePlanInputs()} />;
}

import { useImports } from '../hooks';
import { Debug } from './Debug';

export function Import() {
  return <Debug title="Import" query={useImports()} />;
}

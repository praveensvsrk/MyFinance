import { useStorageStatus } from '../hooks';
import { Debug } from './Debug';

export function Settings() {
  return <Debug title="Settings" query={useStorageStatus()} />;
}

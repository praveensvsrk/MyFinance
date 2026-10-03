import { useHome } from '../hooks';
import { Debug } from './Debug';

export function Home() {
  return <Debug title="Home" query={useHome()} />;
}

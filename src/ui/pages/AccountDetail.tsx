import { useParams } from 'react-router-dom';
import { useAccountDetail } from '../hooks';
import { Debug } from './Debug';

export function AccountDetail() {
  const { id = '' } = useParams();
  return <Debug title="Account" query={useAccountDetail(id, { limit: 50 })} />;
}

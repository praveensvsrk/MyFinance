import { useApp } from '../AppContext';
import { DisplayCard } from '../settings/DisplayCard';
import { CategoriesCard } from '../settings/CategoriesCard';
import { BackupCard } from '../settings/BackupCard';
import { PricesCard } from '../settings/PricesCard';
import { SavedCard } from '../settings/SavedCard';
import { StorageCard } from '../settings/StorageCard';

/** Privacy, share prices, backup, storage and what the app remembers. */
export function Settings() {
  const { hideAmounts, setHideAmounts } = useApp();
  return (
    <>
      <section className="card" aria-labelledby="privacy-h">
        <h2 id="privacy-h" className="t-title">
          Privacy
        </h2>
        <div className="setrow">
          <span className="mid">
            <span className="ttl" id="hide-label">
              Hide amounts
            </span>
            <span className="sub">Shows •••• in place of every value.</span>
          </span>
          <span className="sw">
            <input type="checkbox" role="switch" aria-labelledby="hide-label" checked={hideAmounts} onChange={(event) => setHideAmounts(event.target.checked)} />
            <span className="track" />
          </span>
        </div>
      </section>
      <DisplayCard />
      <PricesCard />
      <BackupCard />
      <StorageCard />
      <CategoriesCard />
      <SavedCard />
    </>
  );
}

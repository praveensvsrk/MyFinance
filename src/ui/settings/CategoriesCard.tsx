import { allCategories } from '../../domain/categories';
import { useActions } from '../actions';
import { Icon } from '../Icon';
import { useCategoryConfig } from '../hooks';

/** Every category, with a switch for the ones that should not count as spending. */
export function CategoriesCard() {
  const actions = useActions();
  const config = useCategoryConfig();

  return (
    <section className="card flat" aria-labelledby="cats-h">
      <h2 id="cats-h" className="t-title" style={{ padding: '16px 16px 0' }}>
        Categories
      </h2>
      <p className="muted" style={{ padding: '4px 16px 8px' }}>
        Switch on “Not spending” for money you send on, such as family. It is left out of spending and income
        everywhere. Create new categories when you change a transaction’s category.
      </p>
      <ul className="list">
        {allCategories(config).map((name) => {
          const custom = config.custom.includes(name);
          const id = `cat-${name.replace(/\W+/g, '-')}`;
          return (
            <li key={name} className="row" style={{ minHeight: 56 }}>
              <span className="mid">
                <span className="ttl" id={id}>
                  {name}
                </span>
                <span className="sub">Not spending</span>
              </span>
              <span className="sw">
                <input
                  type="checkbox"
                  role="switch"
                  aria-labelledby={id}
                  checked={config.excluded.includes(name)}
                  onChange={(event) => void actions.setCategoryExcluded(name, event.target.checked)}
                />
                <span className="track" />
              </span>
              {custom && (
                <button
                  type="button"
                  className="ib sm"
                  aria-label={`Delete the ${name} category`}
                  onClick={() => void actions.deleteCategory(name)}
                >
                  <Icon name="trash" size={20} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

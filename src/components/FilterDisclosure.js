export default function FilterDisclosure({active, children}) {
  return <details className="filter-disclosure">
    <summary className="inventory-filters-heading">
      <div>
        <h2><i className="bi bi-funnel me-2" />Filtros de productos</h2>
        <p>Tipo de plancha, medida y color{active ? ' · Hay filtros activos' : ''}</p>
      </div>
      <span className="filter-disclosure-toggle"><span className="filter-show-label">Mostrar</span><span className="filter-hide-label">Ocultar</span><i className="bi bi-chevron-down" /></span>
    </summary>
    {children}
  </details>;
}

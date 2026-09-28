export function MonthlyRoiControl() {
  return <article className="admin-card admin-card-full admin-monthly-roi">
    <div className="card-heading"><div><p className="admin-kicker">POLÍTICA DE RENDIMIENTOS</p><h2>Pago mínimo del rango</h2></div><span className="card-status">POLÍTICA FIJA</span></div>
    <p className="config-note">Los próximos rendimientos usan siempre el mínimo configurado para cada plan. Los pagos históricos permanecen intactos y la configuración mensual queda sustituida por esta política.</p>
    <div className="admin-monthly-preview"><span>TASAS APLICADAS</span><strong>Nodo Diario 1% · Nodo 7 días 2% · Nodo 14 días 3% · Nodo 21 días 4%</strong><small>Se aplica a nodos activos y nuevos cuando generen su próximo rendimiento.</small></div>
  </article>;
}

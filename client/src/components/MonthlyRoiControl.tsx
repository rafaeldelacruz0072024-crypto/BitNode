export function MonthlyRoiControl() {
  const temporaryPolicyActive = Date.now() < Date.parse("2026-10-03T00:00:00-04:00");

  return <article className="admin-card admin-card-full admin-monthly-roi">
    <div className="card-heading"><div><p className="admin-kicker">POLÍTICA DE RENDIMIENTOS</p><h2>{temporaryPolicyActive ? "Variación reducida esta semana" : "Variación normal restaurada"}</h2></div><span className="card-status">{temporaryPolicyActive ? "28 SEP — 2 OCT" : "RANGO NORMAL"}</span></div>
    <p className="config-note">{temporaryPolicyActive ? "De lunes a viernes, los próximos rendimientos varían únicamente dentro de la mitad inferior del rango. Al finalizar el viernes, el motor restaura automáticamente el rango normal." : "La ventana temporal finalizó y los rendimientos volvieron automáticamente al rango completo configurado para cada nodo."}</p>
    <div className="admin-monthly-preview"><span>{temporaryPolicyActive ? "RANGOS TEMPORALES" : "RANGOS RESTAURADOS"}</span><strong>{temporaryPolicyActive ? "Diario 1%–1.25% · 7 días 2%–2.5% · 14 días 3%–3.5% · 21 días 4%–4.5%" : "Diario 1%–1.5% · 7 días 2%–3% · 14 días 3%–4% · 21 días 4%–5%"}</strong><small>No se generan rendimientos sábado ni domingo. Los pagos históricos permanecen intactos.</small></div>
  </article>;
}

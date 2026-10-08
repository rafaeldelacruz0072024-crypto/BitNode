import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import "./admin-sara-sales.css";

type Payment = { order_id: string; user_id: string; username: string; price_amount: number | string; status: string; provider_status: string; pay_currency: string; provider_payment_id: string | null; actually_paid: number | string | null; created_at: string; completed_at: string | null };
type Subscription = { user_id: string; username: string; paid_through_at: string; hasActive21DayNode: boolean };
type Sales = { payments: Payment[]; subscriptions: Subscription[]; generatedAt: string };
const labels: Record<string, string> = { completed: "Confirmado", pending: "Pendiente", failed: "Fallido", review: "En revisión" };
const day = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const date = (value: string | null) => value ? new Date(value).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" }) : "—";
const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
export function AdminSaraSales() {
  const [data, setData] = useState<Sales | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [page, setPage] = useState(0);
  async function load() {
    setLoading(true); setError("");
    try {
      const session = (await supabase?.auth.getSession())?.data.session;
      if (!session) throw new Error("Sesión administrativa requerida.");
      const response = await fetch("/api/admin/sara-sales", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudieron cargar las ventas.");
      setData(body); setPage(0);
    } catch (e) { setData(null); setError(e instanceof Error ? e.message : "Error de conexión."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { setPage(0); }, [query, status, start, end]);
  const invalid = Boolean(start && end && start > end);
  const payments = (data?.payments || []).filter(p => {
    const paymentDay = day(p.status === "completed" && p.completed_at ? p.completed_at : p.created_at);
    return !invalid && (!status || p.status === status) && (!start || paymentDay >= start) && (!end || paymentDay <= end)
      && `${p.username} ${p.user_id} ${p.order_id} ${p.provider_payment_id || ""}`.toLowerCase().includes(query.toLowerCase().trim());
  }).sort((a, b) => Date.parse(b.completed_at || b.created_at) - Date.parse(a.completed_at || a.created_at));
  const confirmed = payments.filter(p => p.status === "completed");
  const now = Date.now();
  const subscriptions = data?.subscriptions || [];
  const paid = subscriptions.filter(s => Date.parse(s.paid_through_at) > now);
  const active = paid.filter(s => s.hasActive21DayNode);
  return <article className="admin-card admin-card-full sara-sales">
    <div className="card-heading"><div><p className="admin-kicker">SARA IA / CONTROL COMERCIAL</p><h2>Ventas de SARA IA</h2></div>
      <button type="button" className="admin-refresh" disabled={loading} onClick={() => void load()}>{loading ? "Cargando…" : "Actualizar"}</button></div>
    <p>Plan de $25 USD por 30 días calendarios. Solo los pagos confirmados cuentan como ventas. No se modifican pagos ni suscripciones desde este apartado.</p>
    {error && <p role="alert">{error}</p>}
    {data && <>
      <div className="sara-sales-filters">
        <label>Buscar usuario u orden<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Usuario, ID u orden" /></label>
        <label>Estado<select value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Desde<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label>Hasta<input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
      </div>
      {invalid && <p role="alert">La fecha inicial debe ser anterior o igual a la final.</p>}
      <p>Fechas de Santo Domingo: confirmación para ventas; creación para otros estados. Totales del filtro:</p>
      <div className="sara-sales-metrics">
        <div><span>Ventas confirmadas</span><strong>{confirmed.length}</strong></div>
        <div><span>Importe vendido (USD bruto)</span><strong>{money(confirmed.reduce((sum, p) => sum + Number(p.price_amount), 0))}</strong></div>
        <div><span>Compradores únicos</span><strong>{new Set(confirmed.map(p => p.user_id)).size}</strong></div>
        <div><span>Pendientes / en revisión</span><strong>{payments.filter(p => p.status === "pending").length} / {payments.filter(p => p.status === "review").length}</strong></div>
      </div>
      <p>Importe del plan vendido, antes de comisiones del procesador; no representa el neto recibido.</p>
      <div className="sara-sales-table"><table><thead><tr><th>Usuario</th><th>Orden / proveedor</th><th>Estado</th><th>Plan USD</th><th>Pagado USDT</th><th>Red</th><th>Creado</th><th>Confirmado</th></tr></thead><tbody>
        {payments.slice(page * 25, (page + 1) * 25).map(p => <tr key={p.order_id}><td>{p.username}</td><td>{p.order_id}<small>{p.provider_payment_id || "—"}</small></td><td><span className={`sara-sale-status ${p.status}`}>{labels[p.status] || p.status}</span><small>{p.provider_status}</small></td><td>{money(Number(p.price_amount))}</td><td>{p.actually_paid == null ? "—" : Number(p.actually_paid).toFixed(6)}</td><td>{p.pay_currency === "usdtbsc" ? "BEP20" : "TRC20"}</td><td>{date(p.created_at)}</td><td>{date(p.completed_at)}</td></tr>)}
      </tbody></table></div>
      {!payments.length && <p>No hay pagos que coincidan con los filtros.</p>}
      <div className="admin-toolbar"><button className="admin-refresh" disabled={!page} onClick={() => setPage(p => p - 1)}>Anterior</button><span>Página {page + 1} · {payments.length} registros</span><button className="admin-refresh" disabled={(page + 1) * 25 >= payments.length} onClick={() => setPage(p => p + 1)}>Siguiente</button></div>
      <h3>Suscripciones actuales (global, sin filtros de ventas)</h3>
      <p>{paid.length} vigentes · {active.length} habilitadas con nodo de 21 días · {subscriptions.length - paid.length} vencidas. Vigente no garantiza que la tarea de hoy ya se haya ejecutado.</p>
      <div className="sara-sales-table"><table><thead><tr><th>Usuario</th><th>Vence</th><th>Días restantes</th><th>Estado actual</th></tr></thead><tbody>{subscriptions.map(s => {
        const remaining = Math.max(0, Math.ceil((Date.parse(s.paid_through_at) - now) / 86400000));
        return <tr key={s.user_id}><td>{s.username}</td><td>{date(s.paid_through_at)}</td><td>{remaining}</td><td>{remaining === 0 ? "Vencida · tareas manuales" : s.hasActive21DayNode ? "Habilitada · lunes a viernes" : "Suspendida · sin nodo de 21 días"}</td></tr>;
      })}</tbody></table></div>
      {!subscriptions.length && <p>Sin suscripciones registradas.</p>}
      <small>Última consulta: {date(data.generatedAt)}</small>
    </>}
  </article>;
}

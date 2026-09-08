import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { businessDaysInMonth, monthlyRatesSchema, type MonthlyRates } from "@shared/monthlyRoi";

const plans = [["daily", "Nodo Diario"], ["seven", "Nodo 7 Días"], ["fourteen", "Nodo 14 Días"], ["twentyOne", "Nodo 21 Días"]] as const;
const emptyRates = { daily: "", seven: "", fourteen: "", twentyOne: "" };
type Saved = { month: string; rates: MonthlyRates | null; version: number; updatedAt: string | null };

async function request(month: string, signal?: AbortSignal, body?: unknown): Promise<Saved> {
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session) throw new Error("Sesión administrativa requerida.");
  const response = await fetch(`/api/admin/monthly-roi?month=${encodeURIComponent(month)}`, {
    method: body ? "PUT" : "GET", signal,
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "No se pudo consultar el servidor.");
  if (result.month !== month || !Number.isInteger(result.version) || (result.rates !== null && !monthlyRatesSchema.safeParse(result.rates).success)) {
    throw new Error("El servidor devolvió una configuración inválida.");
  }
  return result;
}

export function MonthlyRoiControl() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rates, setRates] = useState(emptyRates);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const days = businessDaysInMonth(month);
  const valid = Object.values(rates).every(value => value.trim() !== "") && monthlyRatesSchema.safeParse(Object.fromEntries(Object.entries(rates).map(([key, value]) => [key, Number(value)]))).success;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setSaved(null); setRates(emptyRates); setError(""); setMessage("");
    void request(month, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setSaved(result);
      setRates(result.rates ? Object.fromEntries(Object.entries(result.rates).map(([key, value]) => [key, String(value)])) as typeof emptyRates : emptyRates);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudo cargar el mes.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month, reload]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!valid || !saved || saved.month !== month || saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await request(month, undefined, {
        month, version: saved.version,
        rates: Object.fromEntries(Object.entries(rates).map(([key, value]) => [key, Number(value)])),
      });
      setSaved(result);
      setMessage(`Porcentajes guardados para ${month}. Se aplican a los próximos rendimientos de ese mes.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  }

  return <article className="admin-card admin-card-full admin-monthly-roi">
    <div className="card-heading"><div><p className="admin-kicker">RENDIMIENTOS MENSUALES</p><h2>Configuración manual de pagos</h2></div>
      <span className="card-status">{loading ? "Cargando…" : saved?.rates ? "Mes configurado" : "Sin configuración"}</span></div>
    <p className="config-note">Define el porcentaje mensual de cada nodo. Se reparte entre los días de lunes a viernes del mes, sujeto a las tareas y reglas del ciclo. Los cambios afectan los próximos rendimientos de nodos activos y nuevos; los pagos ya registrados se conservan.</p>
    <label className="admin-month-selector">Mes de aplicación<input type="month" min="2000-01" max="2099-12" required value={month} disabled={saving} onChange={event => { setSaved(null); setMonth(event.target.value); }} /></label>
    <form onSubmit={save}>
      <div className="admin-roi-grid">{plans.map(([key, name]) => <label key={key}>{name} · % mensual
        <div className="admin-roi-input"><input type="number" required min="0" max="1000" step="0.01" disabled={loading || saving || !saved} value={rates[key]} onChange={event => { setRates(current => ({ ...current, [key]: event.target.value })); setMessage(""); }} /><span>%</span></div>
        <small>{rates[key] !== "" && days ? `Tasa diaria: ${(Number(rates[key]) / days).toFixed(4)}% · ${days} días de lunes a viernes` : "Introduce el porcentaje mensual"}</small>
      </label>)}</div>
      <div className="admin-monthly-preview"><span>MES · {month || "Selecciona un mes"}</span>
        <strong>{saved?.rates ? `Último guardado: ${new Date(saved.updatedAt!).toLocaleString("es-DO")}` : "Sin ajuste mensual: se mantienen las tasas actuales del plan hasta guardar."}</strong>
        <small>0% pausa los rendimientos futuros del nodo durante ese mes. No recupera ni recalcula pagos anteriores. El capital y las comisiones mantienen sus reglas.</small></div>
      <button className="admin-user-save" type="submit" disabled={loading || saving || !saved || !valid}>{saving ? "Guardando…" : "Guardar porcentajes del mes"}</button>
      <button className="admin-user-save" type="button" disabled={saving || loading} onClick={() => setReload(value => value + 1)}>Recargar mes</button>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
    </form>
  </article>;
}

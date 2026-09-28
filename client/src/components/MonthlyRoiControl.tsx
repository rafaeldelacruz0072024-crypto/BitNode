import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { businessDaysInMonth, monthlyRatesSchema, type MonthlyRates } from "@shared/monthlyRoi";

const plans = [["daily", "Nodo Diario"], ["seven", "Nodo 7 Días"], ["fourteen", "Nodo 14 Días"], ["twentyOne", "Nodo 21 Días"]] as const;
const emptyRates = { daily: "", seven: "", fourteen: "", twentyOne: "" };
const defaultMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit" }).format(new Date());
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
  const [month, setMonth] = useState(defaultMonth);
  const [rates, setRates] = useState(emptyRates);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const days = businessDaysInMonth(month);
  const parsedRates = Object.fromEntries(Object.entries(rates).map(([key, value]) => [key, Number(value)]));
  const valid = Object.values(rates).every(value => value.trim() !== "") && monthlyRatesSchema.safeParse(parsedRates).success;

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
      const result = await request(month, undefined, { month, version: saved.version, rates: parsedRates });
      setSaved(result);
      setMessage(`Porcentajes guardados para ${month}. Se aplicarán únicamente a los próximos rendimientos.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  }

  return <article className="admin-card admin-card-full admin-monthly-roi">
    <div className="card-heading"><div><p className="admin-kicker">CONTROL MANUAL DE RENDIMIENTOS</p><h2>Porcentajes de los nodos</h2></div>
      <span className="card-status">{loading ? "Cargando…" : saved?.rates ? "Mes configurado" : "Sin configuración"}</span></div>
    <p className="config-note">Define manualmente cuánto pagará cada nodo durante el mes. El porcentaje mensual se divide entre los días de lunes a viernes. Solo modifica pagos futuros; no recalcula pagos anteriores ni altera el capital.</p>
    <label className="admin-month-selector">Mes de aplicación<input type="month" min="2000-01" max="2099-12" required value={month} disabled={saving} onChange={event => { setSaved(null); setMonth(event.target.value); }} /></label>
    <form onSubmit={save}>
      <div className="admin-roi-grid">{plans.map(([key, name]) => <label key={key}>{name} · % total del mes
        <div className="admin-roi-input"><input type="number" required min="0" max="1000" step="0.01" disabled={loading || saving || !saved} value={rates[key]} onChange={event => { setRates(current => ({ ...current, [key]: event.target.value })); setMessage(""); }} /><span>%</span></div>
        <small>{rates[key] !== "" && days ? `Pago por día hábil: ${(Number(rates[key]) / days).toFixed(4)}% · ${days} días` : "Introduce el porcentaje mensual"}</small>
      </label>)}</div>
      <div className="admin-monthly-preview"><span>MES · {month || "Selecciona un mes"}</span>
        <strong>{saved?.rates ? `Última actualización: ${new Date(saved.updatedAt!).toLocaleString("es-DO")}` : "Sin configuración manual: el nodo utiliza su rango normal."}</strong>
        <small>Usa 0% para pausar los próximos rendimientos durante el mes. La operación queda identificada en la auditoría administrativa.</small></div>
      <button className="admin-user-save" type="submit" disabled={loading || saving || !saved || !valid}>{saving ? "Guardando…" : "Guardar porcentajes"}</button>
      <button className="admin-user-save" type="button" disabled={saving || loading} onClick={() => setReload(value => value + 1)}>Recargar configuración</button>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
    </form>
  </article>;
}

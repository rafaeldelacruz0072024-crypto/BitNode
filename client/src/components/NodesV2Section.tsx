import { useEffect, useState } from "react";
import { ArrowUpRight, CalendarDays, Layers3, LockKeyhole } from "lucide-react";
import { FOUNDER_PLAN_ID, NODES_V2, nodePercent, nodeCycleProjection, isNodeV2 } from "@shared/nodesV2";
import { supabase } from "@/lib/supabaseClient";
import { money, type LocalUserState } from "@/lib/localUserStore";
import { NodeCycleProgress } from "./NodeCycleProgress";
import "./nodes-v2.css";

export type NodeV2Catalog = { preview: boolean; plans: Array<(typeof NODES_V2)[number] & { enabled: boolean; eligible?: boolean }> };
export function useNodeV2Catalog(userId?: string) {
  const [data, setData] = useState<NodeV2Catalog | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setData(null); setError("");
    if (!userId) return;
    void (async () => {
      try {
        const session = (await supabase?.auth.getSession())?.data.session;
        if (!session) return;
        const response = await fetch("/api/nodes/v2", { headers: { Authorization: `Bearer ${session.access_token}` } });
        const body = await response.json();
        if (response.status === 404) return;
        if (!response.ok) throw new Error(body.error || "No se pudo cargar Nodos 2.0.");
        if (!cancelled) setData(body);
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudo cargar Nodos 2.0."); }
    })();
    return () => { cancelled = true; };
  }, [userId]);
  return { data, error };
}

export function NodesV2Section({ user, catalog, error, activate, busy, refresh }: {
  user: LocalUserState; catalog: NodeV2Catalog | null; error: string; busy: boolean;
  activate: (item: { id: string; name: string; rate: string; duration: string; min: number }, amount: number) => void;
  refresh: () => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [capitalBusy, setCapitalBusy] = useState(false);
  const contracts = user.contracts.filter(c => isNodeV2(c.planId));
  const active = contracts.filter(c => c.status === "active");
  async function chooseCapital(id: string, action: "claim" | "reinvest") {
    if (!window.confirm(action === "claim" ? "¿Solicitar el retiro de este capital? Se aplica el fee habitual y la espera de 24 horas." : "¿Reinvertir el capital de este nodo en un nuevo ciclo del mismo plan?")) return;
    setCapitalBusy(true); setMessage("");
    try {
      const session = (await supabase?.auth.getSession())?.data.session;
      if (!session) throw new Error("Sesión requerida.");
      const response = await fetch("/api/nodes/capital-choice", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ contractId: id, action }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo asignar el capital.");
      setMessage(action === "claim" ? "Solicitud de capital registrada." : "Capital reinvertido.");
      refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "No se pudo asignar el capital."); }
    finally { setCapitalBusy(false); }
  }
  if (!catalog) return <div className="generic-panel"><h2>Nodos 2.0</h2><p role="status">{error || "Los Nodos 2.0 todavía no están disponibles para esta cuenta."}</p></div>;
  return <section className="nodes-v2" aria-label="Nodos 2.0">
    <header className="nodes-v2-hero"><div><span className="dash-eyebrow">UNA NUEVA GENERACIÓN</span><h2>Nodos <em>2.0</em></h2><p>Tres plazos y un plan especial Founder. Un ciclo a tu medida.</p></div><Layers3 size={70} aria-hidden="true" /></header>
    {catalog.preview && <p className="nodes-v2-preview"><LockKeyhole size={17} /> Vista previa para administración · compras deshabilitadas hasta el lanzamiento.</p>}
    <div className="nodes-v2-metrics"><div><span>NODOS 2.0 ACTIVOS</span><strong>{active.length}</strong></div><div><span>CAPITAL ACTIVO</span><strong>{money(active.reduce((sum, c) => sum + c.amount, 0))}</strong></div><div><span>BALANCE DISPONIBLE</span><strong>{money(user.balance)}</strong></div></div>
    <div className="nodes-v2-grid">{catalog.plans.map(plan => {
      const isFounder = plan.id === FOUNDER_PLAN_ID;
      const raw = amounts[plan.id] ?? (isFounder ? "2500" : "1000");
      const amount = Number(raw);
      const projection = nodeCycleProjection(plan, amount);
      return <article className={`nodes-v2-card${isFounder ? " nodes-v2-founder" : ""}`} key={plan.id}>
        <span className="nodes-v2-term"><CalendarDays size={16} /> {plan.days} DÍAS HÁBILES</span>
        <h3>{isFounder ? "Nodo Founder" : `Nodo ${plan.days}`}</h3><strong className="nodes-v2-rate">{isFounder ? "2% fijo" : `${nodePercent(plan.rateMin)}%–${nodePercent(plan.rateMax)}%`}<small>diario · lunes a viernes</small></strong>
        {isFounder && <p className="nodes-v2-founder-note">Exclusivo para socios ya registrados antes de incorporar Founder. Inversión mayor de 2,000 USDT. No disponible para nuevos registros.</p>}
        <div className="nodes-v2-cycle"><span>Rendimiento por ciclo</span><b>{isFounder ? `${nodePercent(plan.rateMin * plan.days)}%` : `${nodePercent(plan.rateMin * plan.days)}%–${nodePercent(plan.rateMax * plan.days)}%`}</b></div>
        <label>Monto del nodo (USDT)<input type="number" min={plan.min} step="0.01" inputMode="decimal" value={raw} onChange={event => setAmounts(current => ({ ...current, [plan.id]: event.target.value }))} /></label>
        <p className="nodes-v2-projection">Rendimiento estimado del ciclo<strong>{isFounder ? money(projection.min) : `${money(projection.min)}–${money(projection.max)}`}</strong><small>Capital base {money(Number.isFinite(amount) ? Math.max(0, amount) : 0)} · sin capitalización.</small></p>
        <button className="dash-primary" disabled={!plan.enabled || busy || !Number.isFinite(amount) || amount < plan.min || amount > user.balance} onClick={() => activate({ id: plan.id, name: plan.name, rate: isFounder ? "2% fijo" : `${nodePercent(plan.rateMin)}% – ${nodePercent(plan.rateMax)}%`, duration: `${plan.days} días hábiles + capital de vuelta`, min: plan.min }, amount)}>{plan.eligible === false ? "Exclusivo para socios anteriores" : !plan.enabled ? "Próximamente" : busy ? "Procesando…" : "Crear nodo con mi balance"}<ArrowUpRight size={17} /></button>
      </article>;
    })}</div>
    <p className="nodes-v2-rules">Los días avanzan al completar las cuatro tareas en días hábiles, hora de Ciudad de México. El capital se libera al completar el ciclo. El ROI conserva la ventana de retiro del miércoles. Si incumples las tareas, aplican las reglas de reinicio vigentes. Las proyecciones son rangos de cálculo, no una garantía de rendimiento.</p>
    <div className="nodes-v2-holdings"><h3>Mis nodos 2.0 <span>{active.length} activos</span></h3>{message && <p role="status">{message}</p>}{!contracts.length ? <p>Aún no tienes nodos de esta generación. Tus Nodos 1.0 permanecen en «Mis nodos».</p> : contracts.map(contract => <article key={contract.id} className="dash-card"><div className="nodes-v2-contract"><div><h4>{contract.name}</h4><small>{contract.id} · {contract.status === "active" ? "Activo" : contract.status === "completed" ? "Ciclo finalizado" : contract.status}</small></div><strong>{money(contract.amount)}</strong></div>{contract.status === "active" && <NodeCycleProgress id={contract.id} name={contract.name} duration={contract.duration} />}{contract.status === "completed" && contract.capitalChoiceReady && !contract.capitalChoice && <div className="nodes-v2-actions"><button className="dash-secondary" disabled={capitalBusy} onClick={() => void chooseCapital(contract.id, "claim")}>Reclamar capital</button><button className="dash-secondary" disabled={capitalBusy || catalog.preview} onClick={() => void chooseCapital(contract.id, "reinvest")}>Reinvertir</button></div>}{contract.capitalChoice && <p>{contract.capitalChoice.action === "reinvest" ? "Capital reinvertido" : `Retiro de capital: ${contract.capitalChoice.status}`}</p>}</article>)}</div>
  </section>;
}

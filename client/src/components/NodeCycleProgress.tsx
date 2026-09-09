import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabaseClient";
import { nodeProgress, type CycleReward } from "@/lib/nodeProgress";

type State = { rows: CycleReward[]; cycleDay: number; resetAt: string | null; loading: boolean; error: boolean };
const initial: State = { rows: [], cycleDay: 0, resetAt: null, loading: true, error: false };
const ProgressContext = createContext<State>(initial);

export function NodeCycleProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [state, setState] = useState(initial);
  useEffect(() => {
    if (!supabase) { setState({ ...initial, loading: false, error: true }); return; }
    const client = supabase;
    let disposed = false, busy = false;
    const refresh = async () => {
      if (busy || disposed) return;
      busy = true;
      try {
        const cycle = await client.rpc("get_daily_task_cycle");
        if (cycle.error) throw cycle.error;
        const reset = await client.from("user_notifications").select("created_at")
          .eq("user_id", userId).eq("kind", "cycle_reset").order("created_at", { ascending: false }).limit(1);
        if (reset.error) throw reset.error;
        const resetAt = reset.data?.[0]?.created_at || null;
        const rows: CycleReward[] = [];
        for (let offset = 0; ; offset += 1000) {
          let query = client.from("contract_cycle_rewards").select("contract_id,amount,status,created_at")
            .eq("user_id", userId).in("status", ["pending", "completed"])
            .order("created_at", { ascending: false }).order("id").range(offset, offset + 999);
          if (resetAt) query = query.gt("created_at", resetAt);
          const result = await query;
          if (result.error) throw result.error;
          rows.push(...(result.data || []));
          if (!result.data || result.data.length < 1000) break;
        }
        if (!disposed) setState({ rows, resetAt, cycleDay: cycle.data?.cycle_day || 0, loading: false, error: false });
      } catch { if (!disposed) setState({ ...initial, loading: false, error: true }); }
      finally { busy = false; }
    };
    void refresh();
    const listener = () => { void refresh(); };
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
    window.addEventListener("focus", listener);
    window.addEventListener("bitnode:tasks-updated", listener);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("focus", listener); window.removeEventListener("bitnode:tasks-updated", listener); };
  }, [userId]);
  return <ProgressContext.Provider value={state}>{children}</ProgressContext.Provider>;
}

export function NodeCycleProgress({ id, name, duration }: { id: string; name: string; duration: string }) {
  const state = useContext(ProgressContext);
  const target = name === "Nodo Diario" ? null : Number(duration.match(/\d+/)?.[0]) || null;
  if (state.loading || state.error) return <div className="node-cycle-progress" role="status">{state.error ? "No se pudo cargar el progreso. Reintentando…" : "Cargando progreso del ciclo…"}</div>;
  const { days, earnings } = nodeProgress(state.rows, id, target, state.cycleDay, state.resetAt);
  const percent = target ? Math.min(100, days / target * 100) : days ? 100 : 0;
  return <div className="node-cycle-progress" aria-label={`Progreso de ${name}`}>
    <div className="node-cycle-metrics"><div><span>DÍAS PROCESADOS</span><strong>{days}{target ? ` / ${target}` : ""}</strong></div>
      <div><span>GANANCIAS DEL CICLO</span><strong>{earnings.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} <small>USDT</small></strong></div></div>
    <div className="node-cycle-track" role="progressbar" aria-label={`Días procesados de ${name}`} aria-valuemin={0} aria-valuemax={target || Math.max(1, days)} aria-valuenow={target ? Math.min(days, target) : days} aria-valuetext={target ? `${days} de ${target} días procesados` : `${days} días procesados, sin plazo fijo`}><i style={{ width: `${percent}%` }} /></div>
    <p>{target ? `${Math.max(0, target - days)} días con rendimiento pendientes · ganancias provisionales` : "Sin plazo fijo · ganancias del ciclo ya acreditadas"}</p>
    <p>Si incumples las tareas en 24 horas, estos indicadores vuelven a cero. Tu capital y los pagos liberados se conservan.</p>
  </div>;
}

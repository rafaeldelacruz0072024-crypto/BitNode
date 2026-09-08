import { useCallback, useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

type Notice = { id: string; created_at: string; read_at: string | null };
const message = "El ciclo de tus nodos se reinició por no completar las tareas dentro del plazo de 24 horas. Se anularon las ganancias provisionales del ciclo. Tu capital y las ganancias ya liberadas permanecen intactos. Retoma las tareas para iniciar un nuevo ciclo.";

export function useCycleNotifications(userId: string | undefined) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setNotices([]); setOpen(false); setError(""); setLoading(true);
    if (!userId || !supabase) return;
    const client = supabase;
    let disposed = false;
    let busy = false;
    async function refresh() {
      if (busy || disposed) return;
      busy = true;
      try {
        // The existing RPC decides expiration on the server, never the browser clock.
        const cycle = await client.rpc("get_daily_task_cycle");
        if (cycle.error) throw cycle.error;
        const result = await client.from("user_notifications")
          .select("id,created_at,read_at").eq("user_id", userId!)
          .is("read_at", null).order("created_at", { ascending: false });
        if (result.error) throw result.error;
        if (!disposed) { setNotices(result.data || []); setError(""); }
      } catch {
        if (!disposed) setError("No se pudieron actualizar las notificaciones. Se volverá a intentar automáticamente.");
      } finally { busy = false; if (!disposed) setLoading(false); }
    }
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [userId]);

  const markRead = useCallback(async (id: string) => {
    if (!supabase || !userId || saving) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.from("user_notifications")
        .update({ read_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId)
        .select("id").single();
      if (error || !data) throw error;
      setNotices(items => items.filter(item => item.id !== id));
      setError("");
    } catch { setError("No se pudo marcar el aviso como leído. Inténtalo de nuevo."); }
    finally { setSaving(false); }
  }, [userId, saving]);

  return {
    bell: <button onClick={() => setOpen(value => !value)} aria-label={`Notificaciones${notices.length ? `: ${notices.length} sin leer` : ""}`} aria-expanded={open} aria-controls="cycle-notifications" style={{ position: "relative" }}>
      <Bell size={19} />{notices.length > 0 && <span className="cycle-notification-dot" />}
    </button>,
    panel: (open || notices.length > 0) && <section id="cycle-notifications" className="cycle-notifications" aria-label="Notificaciones del ciclo">
      <div className="cycle-notification-heading"><strong>{notices.length ? "Reinicio del ciclo de tus nodos" : "Notificaciones"}</strong>
        {open && <button aria-label="Cerrar notificaciones" onClick={() => setOpen(false)}><X size={18} /></button>}
      </div>
      {error && <p role="alert">{error}</p>}
      {!notices.length && !error && <p>{loading ? "Cargando notificaciones…" : "No tienes notificaciones pendientes."}</p>}
      {notices.map(notice => <article key={notice.id}>
        <p>{message}</p><time dateTime={notice.created_at}>{new Date(notice.created_at).toLocaleString("es-DO")}</time>
        <button disabled={saving} onClick={() => void markRead(notice.id)}>Marcar como leído</button>
      </article>)}
    </section>,
  };
}

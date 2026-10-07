import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { BinaryTree } from "./BinaryTree";

type Snapshot = {
  profile: { id: string; username: string; sponsor_id: string | null };
  nodes: Array<{ user_id: string; username?: string; parent_id: string | null; leg: "left" | "right" | null }>;
  directs: Array<{ id: string; username: string }>;
  contracts: Array<{ id: string; plan_id: string; amount: number; status: string }>;
  operator: string;
};

export function AdminAccountView({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    void (async () => {
      try {
        const session = (await supabase?.auth.getSession())?.data.session;
        if (!session) throw new Error("Sesión administrativa requerida.");
        const response = await fetch("/api/admin/account-view", {
          method: "POST", signal: controller.signal,
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo abrir la cuenta.");
        if (!controller.signal.aborted) setData(body);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Error de conexión."); }
    })();
    return () => controller.abort();
  }, [userId]);
  return <section className="admin-user-manager" aria-label="Vista de soporte de cuenta" aria-live="polite">
    <div className="card-heading"><div><p className="admin-kicker">VISTA DE SOPORTE · SOLO LECTURA</p>
      <h2>{data?.profile.username || "Cuenta del usuario"}</h2></div>
      <button type="button" className="admin-refresh" onClick={onClose}>Salir de la cuenta</button></div>
    <p>No se cambia tu sesión ni se permiten operaciones en nombre del usuario.</p>
    {error ? <p role="alert">{error}</p> : !data ? <p>Cargando cuenta…</p> : <>
      <p>Administrador: {data.operator} · Acceso registrado en auditoría.</p>
      <BinaryTree key={userId} nodes={data.nodes} currentUserId={userId} ownerName={data.profile.username} />
      <p>El árbol carga hasta 25 niveles. Referidos y nodos: hasta 1,000 registros por lista.</p>
      <h3>Referidos directos por patrocinio ({data.directs.length})</h3>
      {data.directs.length ? <ul>{data.directs.map(user => <li key={user.id}>{user.username}</li>)}</ul> : <p>Sin referidos directos.</p>}
      <h3>Nodos del usuario ({data.contracts.length})</h3>
      {data.contracts.length ? <ul>{data.contracts.map(node => <li key={node.id}>{node.id} · {Number(node.amount).toFixed(2)} USDT · {node.status}</li>)}</ul> : <p>Sin nodos.</p>}
    </>}
  </section>;
}

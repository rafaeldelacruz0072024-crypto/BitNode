import { useEffect, useRef, useState } from "react";
import "./sara-support.css";

type CrispWindow = Window & {
  $crisp?: { push: (command: unknown[]) => void };
  CRISP_WEBSITE_ID?: string;
  CRISP_RUNTIME_CONFIG?: Record<string, unknown>;
};
const websiteId = "2402a470-7a76-4ae2-a9d1-60cb472f8039";
let loading: Promise<void> | null = null;
function loadCrisp() {
  const target = window as CrispWindow;
  const crisp = target.$crisp ?? (target.$crisp = [] as unknown[][]);
  target.CRISP_WEBSITE_ID = websiteId;
  target.CRISP_RUNTIME_CONFIG = { locale: "es" };
  crisp.push(["do", "chat:hide"]);
  if (!loading) loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://client.crisp.chat/l.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); loading = null; reject(new Error("No se pudo conectar con soporte. Intenta nuevamente.")); };
    document.head.appendChild(script);
  });
  return loading;
}

export function SaraSupport({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chatActive, setChatActive] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setOpen(false); setError("");
    return () => {
      generation.current += 1;
      const crisp = (window as CrispWindow).$crisp;
      crisp?.push(["off", "chat:closed"]);
      crisp?.push(["do", "chat:close"]);
      crisp?.push(["do", "chat:hide"]);
      // Never share a support conversation across account switches/logout.
      crisp?.push(["do", "session:reset"]);
    };
  }, [userId]);
  async function connect() {
    const requestGeneration = generation.current;
    setBusy(true); setError("");
    try {
      await loadCrisp();
      if (requestGeneration !== generation.current) return;
      const crisp = (window as CrispWindow).$crisp!;
      crisp.push(["on", "chat:closed", () => { crisp.push(["do", "chat:hide"]); setChatActive(false); }]);
      crisp.push(["do", "chat:show"]);
      crisp.push(["do", "chat:open"]);
      setOpen(false);
      setChatActive(true);
    } catch (e) { if (requestGeneration === generation.current) setError(e instanceof Error ? e.message : "No se pudo abrir soporte."); }
    finally { if (requestGeneration === generation.current) setBusy(false); }
  }
  return <div className="sara-support" hidden={chatActive}>
    {!chatActive && <style>{".crisp-client { display: none !important; }"}</style>}
    {open && <section className="sara-support-panel" aria-label="SARA IA Soporte">
      <header><img src="/sara-ia-official-avatar.png" alt="" /><div><strong>SARA IA</strong><small>Soporte de BitNode</small></div><button aria-label="Cerrar soporte" onClick={() => setOpen(false)}>×</button></header>
      <p>¿Necesitas ayuda con BitNode? Abre el chat para contactar al equipo de soporte.</p>
      <small>El chat es gestionado mediante Crisp. No compartas contraseñas, códigos de verificación ni frases de recuperación.</small>
      <button className="sara-support-connect" disabled={busy} onClick={() => void connect()}>{busy ? "Conectando…" : "Abrir chat de soporte"}</button>
      {error && <p role="alert">{error}</p>}
    </section>}
    <button className="sara-support-launcher" aria-expanded={open} aria-label="SARA IA Soporte" onClick={() => setOpen(value => !value)}><img src="/sara-ia-official-avatar.png" alt="" /><span>SARA IA<small>Soporte</small></span></button>
  </div>;
}

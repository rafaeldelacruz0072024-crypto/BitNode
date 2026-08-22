import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { Link } from "wouter";
import { ArrowLeft, BarChart3, CheckCircle2, CircleDollarSign, LayoutDashboard, LockKeyhole, Menu, Server, ShieldCheck, Users, X } from "lucide-react";

type ApiState = "checking" | "ready" | "locked" | "offline";

const metrics = [
  { label: "Usuarios registrados", value: "—", change: "Conecta Supabase para ver datos", icon: Users },
  { label: "Volumen de contratos", value: "$0.00", change: "Sin datos financieros cargados", icon: CircleDollarSign },
  { label: "Comisiones pendientes", value: "$0.00", change: "Sin ledger administrativo", icon: BarChart3 },
  { label: "Estado de la red", value: "Operativa", change: "15,017 nodos publicados", icon: Server },
];

const sections = ["Resumen", "Usuarios", "Contratos", "Transacciones", "Comisiones", "Configuración"];

export default function Admin() {
  const [open, setOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("Resumen");
  const [apiState, setApiState] = useState<ApiState>("locked");
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState("");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (!supabase) { setApiState("offline"); setAuthError("Faltan las variables públicas de Supabase."); return; }
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted && session) validateSession(session.access_token);
      else if (mounted) setApiState("locked");
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) validateSession(session.access_token);
      else { setIsAuthorized(false); setApiState("locked"); }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  async function validateSession(accessToken: string) {
    setApiState("checking");
    try {
      const response = await fetch("/api/admin", { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } });
      const body = await response.json().catch(() => ({}));
      if (response.ok) { setIsAuthorized(true); setUserEmail(body.user?.email ?? ""); setUserRole(body.user?.role ?? "admin"); setApiState("ready"); }
      else { setIsAuthorized(false); setApiState(response.status === 401 || response.status === 403 ? "locked" : "offline"); setAuthError(body.error ?? "La sesión no tiene permisos administrativos."); }
    } catch { setIsAuthorized(false); setApiState("offline"); setAuthError("No se pudo conectar con la función nativa."); }
  }

  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    if (!supabase) { setAuthError("Supabase no está configurado en este entorno."); return; }
    setApiState("checking");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) { setApiState("locked"); setAuthError(error?.message ?? "No se pudo iniciar sesión."); return; }
    await validateSession(data.session.access_token);
  }

  async function signOut() { await supabase?.auth.signOut(); setIsAuthorized(false); setUserEmail(""); setUserRole(""); setApiState("locked"); }

  const apiLabel = apiState === "checking" ? "Verificando función" : apiState === "ready" ? "Función protegida activa" : apiState === "locked" ? "API protegida · credencial requerida" : "API no disponible";

  if (!isAuthorized) return (
    <main className="admin-shell admin-gate-shell">
      <section className="admin-gate">
        <div className="admin-brand-mark">B<span>·</span></div>
        <p className="admin-kicker">BITNODE / PRIVATE OPERATIONS</p>
        <h1>Acceso administrativo</h1>
        <p>Inicia sesión con Supabase. La función server-side verificará el token y consultará el rol administrativo en `profiles`.</p>
        <form onSubmit={authorize} className="admin-gate-form">
          <label htmlFor="admin-email">Correo administrativo</label>
          <input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@bitnode.space" autoComplete="username" required />
          <label htmlFor="admin-password">Contraseña</label>
          <input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Contraseña de Supabase" autoComplete="current-password" required />
          <button type="submit" disabled={apiState === "checking"}>{apiState === "checking" ? "Verificando sesión…" : "Entrar a la consola"}</button>
        </form>
        {authError && <p className="admin-auth-error" role="alert">{authError}</p>}
        <Link href="/" className="admin-back"><ArrowLeft size={15} /> Volver a BitNode</Link>
      </section>
    </main>
  );

  return (
    <main className="admin-shell">
      <aside className={`admin-sidebar ${open ? "is-open" : ""}`}>
        <div className="admin-brand-row">
          <div className="admin-brand-mark">B<span>·</span></div>
          <div><strong>bitnode.</strong><small>OPERATIONS CONSOLE</small></div>
          <button className="admin-close" aria-label="Cerrar menú" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        <div className="admin-env"><i /> EXPERIMENTAL / VERCEL NATIVE</div>
        <nav className="admin-nav" aria-label="Secciones administrativas">
          {sections.map((section) => (
            <button key={section} className={activeSection === section ? "active" : ""} onClick={() => { setActiveSection(section); setOpen(false); }}>
              <span>{section === "Resumen" ? <LayoutDashboard size={16} /> : section === "Usuarios" ? <Users size={16} /> : section === "Comisiones" ? <BarChart3 size={16} /> : section === "Configuración" ? <ShieldCheck size={16} /> : <CircleDollarSign size={16} />}</span>{section}
            </button>
          ))}
        </nav>
        <div className="admin-side-note"><LockKeyhole size={16} /><p>Las operaciones financieras permanecen bloqueadas hasta conectar una sesión administrativa verificable.</p></div>
        <Link href="/" className="admin-back"><ArrowLeft size={15} /> Volver a BitNode</Link>
      </aside>

      <section className="admin-content">
        <header className="admin-header">
          <button className="admin-menu" aria-label="Abrir menú" onClick={() => setOpen(true)}><Menu size={20} /></button>
          <div><p className="admin-kicker">ADMIN / {activeSection.toUpperCase()}</p><h1>Panel de administración</h1></div>
          <div className="admin-header-right"><span className={`api-badge ${apiState}`}><i />{apiLabel}</span><span className="admin-user">{userEmail} · {userRole}</span><button className="admin-logout" onClick={signOut}>Salir</button><div className="admin-avatar">OP</div></div>
        </header>

        <div className="admin-warning"><ShieldCheck size={17} /><span><strong>Modo seguro de prueba.</strong> Esta rama no muta balances, contratos ni comisiones. Las funciones nativas devuelven datos únicamente después de validar la credencial administrativa.</span></div>

        <div className="admin-grid">
          {metrics.map(({ label, value, change, icon: Icon }) => <article className="admin-metric" key={label}><div className="metric-icon"><Icon size={18} /></div><p>{label}</p><strong>{value}</strong><small>{change}</small></article>)}
        </div>

        <div className="admin-columns">
          <article className="admin-card admin-card-large"><div className="card-heading"><div><p className="admin-kicker">CONTROL CENTER</p><h2>{activeSection}</h2></div><span className="card-status"><CheckCircle2 size={15} /> Sin acciones pendientes</span></div><div className="empty-admin"><div className="empty-orbit"><LockKeyhole size={24} /></div><h3>Conexión administrativa pendiente</h3><p>El panel visual está listo. La lectura de usuarios y operaciones se habilitará en la siguiente iteración, después de configurar la identidad de administrador y Supabase server-side.</p><button onClick={() => setActiveSection("Configuración")}>Revisar configuración <ArrowLeft size={15} /></button></div></article>
          <article className="admin-card"><div className="card-heading"><div><p className="admin-kicker">RUNTIME</p><h2>Funciones Vercel</h2></div></div><div className="runtime-row"><span><i className="runtime-dot ready" />Frontend estático</span><b>OK</b></div><div className="runtime-row"><span><i className={`runtime-dot ${apiState === "ready" ? "ready" : "idle"}`} />API nativa /api/admin</span><b>{apiState === "ready" ? "OK" : "LOCKED"}</b></div><div className="runtime-row"><span><i className="runtime-dot idle" />Supabase admin data</span><b>PENDING</b></div><code>export default function handler(req, res)</code></article>
        </div>
      </section>
    </main>
  );
}

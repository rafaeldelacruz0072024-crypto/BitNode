import { useEffect, useState } from "react";
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
  const [adminKey, setAdminKey] = useState("");
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => { setApiState("locked"); }, []);

  async function authorize(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    setApiState("checking");
    try {
      const response = await fetch("/api/admin", { headers: { Accept: "application/json", Authorization: `Bearer ${adminKey}` } });
      if (response.ok) { setIsAuthorized(true); setApiState("ready"); }
      else { setApiState(response.status === 401 || response.status === 503 ? "locked" : "offline"); setAuthError(response.status === 503 ? "ADMIN_API_KEY todavía no está configurada en Vercel." : "La credencial no fue aceptada."); }
    } catch { setApiState("offline"); setAuthError("No se pudo conectar con la función nativa."); }
  }

  const apiLabel = apiState === "checking" ? "Verificando función" : apiState === "ready" ? "Función protegida activa" : apiState === "locked" ? "API protegida · credencial requerida" : "API no disponible";

  if (!isAuthorized) return (
    <main className="admin-shell admin-gate-shell">
      <section className="admin-gate">
        <div className="admin-brand-mark">B<span>·</span></div>
        <p className="admin-kicker">BITNODE / PRIVATE OPERATIONS</p>
        <h1>Acceso administrativo</h1>
        <p>Esta consola experimental usa una función nativa de Vercel. Introduce la credencial configurada como <code>ADMIN_API_KEY</code> para abrirla.</p>
        <form onSubmit={authorize} className="admin-gate-form">
          <label htmlFor="admin-key">Credencial administrativa</label>
          <input id="admin-key" type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} placeholder="Bearer secret" autoComplete="off" required />
          <button type="submit" disabled={apiState === "checking"}>{apiState === "checking" ? "Verificando…" : "Entrar a la consola"}</button>
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
          <div className="admin-header-right"><span className={`api-badge ${apiState}`}><i />{apiLabel}</span><div className="admin-avatar">OP</div></div>
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

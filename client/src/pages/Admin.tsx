import React, { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { hasRows, matchesAdminSearch, userStatusLabel } from "./adminUtils";
import { Link } from "wouter";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  FileClock,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Users,
  WalletCards,
  X,
} from "lucide-react";

type ApiState = "checking" | "ready" | "locked" | "offline";
type SectionName = "Resumen" | "Usuarios" | "Contratos" | "Transacciones" | "Comisiones" | "Configuración";

type AdminUser = {
  id: string;
  username: string | null;
  displayName: string | null;
  email: string | null;
  role: string;
  sponsorId: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  bannedUntil: string | null;
  status: string;
};

type AdminTransaction = {
  id: string;
  userId: string | null;
  username: string | null;
  type: string;
  label: string | null;
  amount: number;
  status: string;
  network: string | null;
  wallet: string | null;
  fee: number;
  netAmount: number;
  providerStatus: string | null;
  cycle: string | null;
  startAt: string | null;
  endAt: string | null;
  createdAt: string | null;
};

type AdminCommission = {
  id: string | null;
  beneficiaryId: string | null;
  sourceUserId: string | null;
  sourceEventId: string | null;
  type: string;
  amount: number;
  rate: number;
  leg: string | null;
  status: string;
  createdAt: string | null;
};

type AdminData = {
  status: "ready";
  readOnly: boolean;
  lastUpdated: string;
  metrics: {
    users: number;
    contracts: number;
    contractVolume: number;
    transactions: number;
    pendingTransactions: number;
    pendingCommissions: number;
    creditedCommissions: number;
    networkVolumes: number;
  };
  users: AdminUser[];
  contracts: AdminTransaction[];
  transactions: AdminTransaction[];
  commissions: {
    configuredDirectRate: number;
    configuredBinaryRate: number;
    direct: number;
    binary: number;
    total: number;
    pending: number;
    entries: AdminCommission[];
  };
  binaryVolume: { left: number; right: number; matched: number; status: string };
};

type ApiError = { error?: string; status?: string };

const sections: SectionName[] = ["Resumen", "Usuarios", "Contratos", "Transacciones", "Comisiones", "Configuración"];
const sectionIcons: Record<SectionName, typeof LayoutDashboard> = {
  Resumen: LayoutDashboard,
  Usuarios: Users,
  Contratos: FileClock,
  Transacciones: WalletCards,
  Comisiones: BarChart3,
  Configuración: Settings2,
};

const money = (value: number | null | undefined) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number.isFinite(Number(value)) ? Number(value) : 0);

const compactNumber = (value: number | null | undefined) => new Intl.NumberFormat("es-419", { maximumFractionDigits: 0 }).format(Number(value || 0));

const dateLabel = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("es-419", { dateStyle: "medium", timeStyle: "short" });
};

const statusLabel = (value: string | null | undefined) => {
  const labels: Record<string, string> = {
    completed: "Completada",
    confirmed: "Confirmado",
    credited: "Acreditada",
    pending: "Pendiente",
    failed: "Fallida",
    user: "Usuario",
    admin: "Admin",
    deposit: "Depósito",
    withdraw: "Retiro",
    contract: "Contrato",
    yield: "Rendimiento",
    direct: "Directa",
    binary: "Binaria",
  };
  return labels[value || ""] || value || "—";
};

function StatusPill({ value }: { value: string | null | undefined }) {
  const normalized = value || "unknown";
  return <span className={`data-status data-status-${normalized.replace(/[^a-z0-9_-]/gi, "-")}`}>{statusLabel(normalized)}</span>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="admin-empty-state"><div className="empty-orbit"><LockKeyhole size={22} /></div><h3>{title}</h3><p>{detail}</p></div>;
}

function LoadingState() {
  return <div className="admin-loading-state" role="status"><RefreshCw size={18} className="spin" /> Consultando datos seguros…</div>;
}

function DataTable({ children, label }: { children: React.ReactNode; label: string }) {
  return <div className="admin-table-wrap" role="region" aria-label={label} tabIndex={0}><table className="admin-data-table">{children}</table></div>;
}

function SummarySection({ data }: { data: AdminData | null }) {
  if (!data) return <LoadingState />;
  const recentTransactions = data.transactions.slice(0, 5);
  const recentCommissions = data.commissions.entries.slice(0, 5);
  return <>
    <div className="admin-grid">
      <article className="admin-metric"><div className="metric-icon"><Users size={18} /></div><p>Usuarios registrados</p><strong>{compactNumber(data.metrics.users)}</strong><small>Perfiles sincronizados</small></article>
      <article className="admin-metric"><div className="metric-icon"><CircleDollarSign size={18} /></div><p>Volumen de contratos</p><strong>{money(data.metrics.contractVolume)}</strong><small>{compactNumber(data.metrics.contracts)} contratos registrados</small></article>
      <article className="admin-metric"><div className="metric-icon"><WalletCards size={18} /></div><p>Transacciones pendientes</p><strong>{compactNumber(data.metrics.pendingTransactions)}</strong><small>Sin acreditar automáticamente</small></article>
      <article className="admin-metric"><div className="metric-icon"><BarChart3 size={18} /></div><p>Comisiones acreditadas</p><strong>{money(data.metrics.creditedCommissions)}</strong><small>{money(data.metrics.pendingCommissions)} pendientes en ledger</small></article>
    </div>
    <div className="admin-binary-card"><div><p className="admin-kicker">BINARY BONUS / 10%</p><h2>Volumen emparejado</h2><p>Lectura agregada de `network_volume`; este panel no ejecuta créditos ni mutaciones.</p></div><div className="binary-stats"><div><span>Izquierda</span><strong>{money(data.binaryVolume.left)}</strong></div><div><span>Derecha</span><strong>{money(data.binaryVolume.right)}</strong></div><div><span>Emparejado</span><strong>{money(data.binaryVolume.matched)}</strong></div><div><span>Bono binario</span><strong>{money(data.commissions.binary)}</strong></div></div><span className="binary-status">{data.binaryVolume.status === "paired" ? "Emparejamiento activo" : data.binaryVolume.status === "awaiting_pair" ? "Esperando volumen opuesto" : "Sin volumen registrado"}</span></div>
    <div className="admin-columns">
      <article className="admin-card admin-card-large"><div className="card-heading"><div><p className="admin-kicker">LATEST ACTIVITY</p><h2>Últimas transacciones</h2></div><span className="card-status"><CheckCircle2 size={15} /> Solo lectura</span></div>{recentTransactions.length === 0 ? <EmptyState title="Sin transacciones" detail="Aún no hay registros disponibles en la tabla transactions." /> : <DataTable label="Últimas transacciones"><thead><tr><th>Usuario</th><th>Tipo</th><th>Monto</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>{recentTransactions.map((row) => <tr key={row.id}><td>{row.username || row.userId?.slice(0, 8) || "—"}</td><td>{statusLabel(row.type)}</td><td>{money(row.amount)}</td><td><StatusPill value={row.status} /></td><td>{dateLabel(row.createdAt)}</td></tr>)}</tbody></DataTable>}</article>
      <article className="admin-card"><div className="card-heading"><div><p className="admin-kicker">COMMISSION LEDGER</p><h2>Red</h2></div></div><div className="runtime-row"><span>Bono directo</span><b>{money(data.commissions.direct)}</b></div><div className="runtime-row"><span>Bono binario</span><b>{money(data.commissions.binary)}</b></div><div className="runtime-row"><span>Total acreditado</span><b>{money(data.commissions.total)}</b></div><div className="runtime-row"><span>Entradas pendientes</span><b>{money(data.commissions.pending)}</b></div><code>direct_rate = 10% · binary_rate = 10%</code></article>
    </div>
    <article className="admin-card admin-card-full"><div className="card-heading"><div><p className="admin-kicker">RECENT COMMISSIONS</p><h2>Ledger reciente</h2></div><span className="card-status"><CheckCircle2 size={15} /> Idempotencia server-side</span></div>{recentCommissions.length === 0 ? <EmptyState title="Ledger vacío" detail="Las comisiones aparecerán aquí cuando existan eventos procesados." /> : <DataTable label="Ledger reciente"><thead><tr><th>Tipo</th><th>Monto</th><th>Tasa</th><th>Estado</th><th>Evento</th><th>Fecha</th></tr></thead><tbody>{recentCommissions.map((row) => <tr key={row.id || row.sourceEventId}><td>{statusLabel(row.type)}</td><td>{money(row.amount)}</td><td>{row.rate ? `${row.rate * 100}%` : "—"}</td><td><StatusPill value={row.status} /></td><td className="mono-cell">{row.sourceEventId?.slice(0, 18) || "—"}</td><td>{dateLabel(row.createdAt)}</td></tr>)}</tbody></DataTable>}</article>
  </>;
}

export function UsersSection({ users }: { users: AdminUser[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => users.filter((user) => matchesAdminSearch([user.username, user.displayName, user.email, user.role, user.status], query)), [query, users]);
  return <article className="admin-card admin-card-full"><div className="card-heading"><div><p className="admin-kicker">IDENTITY / PROFILES</p><h2>Usuarios registrados</h2></div><span className="card-status"><CheckCircle2 size={15} /> {users.length} perfiles</span></div><div className="admin-toolbar"><label className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por correo, usuario, estado o rol" aria-label="Buscar usuarios" /></label><span className="admin-toolbar-note">{filtered.length} resultado{filtered.length === 1 ? "" : "s"}</span></div>{!hasRows(users) ? <EmptyState title="Sin usuarios" detail="No existen perfiles disponibles para mostrar." /> : filtered.length === 0 ? <EmptyState title="Sin coincidencias" detail="Prueba con otro correo, usuario, estado o rol." /> : <DataTable label="Usuarios registrados"><thead><tr><th>Usuario</th><th>Correo</th><th>Estado</th><th>Rol</th><th>Patrocinador</th><th>Registro</th><th>Último acceso</th></tr></thead><tbody>{filtered.map((user) => <tr key={user.id}><td><strong>{user.username || "Sin username"}</strong><small>{user.displayName || user.id.slice(0, 12)}</small></td><td>{user.email || "—"}</td><td><StatusPill value={userStatusLabel(user)} /></td><td><StatusPill value={user.role} /></td><td className="mono-cell">{user.sponsorId?.slice(0, 12) || "—"}</td><td>{dateLabel(user.createdAt)}</td><td>{dateLabel(user.lastSignInAt)}</td></tr>)}</tbody></DataTable>}</article>;
}

function TransactionsSection({ rows, contractsOnly = false }: { rows: AdminTransaction[]; contractsOnly?: boolean }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => rows.filter((row) => matchesAdminSearch([row.id, row.username, row.type, row.status, row.network, row.providerStatus, row.cycle], query)), [query, rows]);
  const title = contractsOnly ? "Contratos" : "Transacciones";
  return <article className="admin-card admin-card-full"><div className="card-heading"><div><p className="admin-kicker">{contractsOnly ? "CONTRACTS / LIFECYCLE" : "TRANSACTIONS / HISTORY"}</p><h2>{title}</h2></div><span className="card-status"><CheckCircle2 size={15} /> Solo lectura</span></div><div className="admin-toolbar"><label className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Buscar ${contractsOnly ? "contratos" : "transacciones"}`} aria-label={`Buscar ${title.toLowerCase()}`} /></label><span className="admin-toolbar-note">{filtered.length} registro{filtered.length === 1 ? "" : "s"}</span></div>{!hasRows(rows) ? <EmptyState title={`Sin ${title.toLowerCase()}`} detail={`No existen registros en ${contractsOnly ? "transactions con tipo contract" : "transactions"}.`} /> : filtered.length === 0 ? <EmptyState title="Sin coincidencias" detail="Prueba con otro identificador, usuario, tipo o estado." /> : <DataTable label={title}><thead><tr>{contractsOnly ? <><th>ID</th><th>Usuario</th><th>Ciclo</th><th>Monto</th><th>Estado</th><th>Fechas</th></> : <><th>ID</th><th>Usuario</th><th>Tipo</th><th>Monto</th><th>Estado</th><th>Red / wallet</th><th>Fecha</th></>}</tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td className="mono-cell">{row.id.slice(0, 18)}</td><td>{row.username || row.userId?.slice(0, 12) || "—"}</td>{contractsOnly ? <><td>{row.cycle || row.label || "Ciclo no registrado"}</td><td><strong>{money(row.amount)}</strong><small>{row.fee ? `Fee ${money(row.fee)}` : ""}</small></td><td><StatusPill value={row.status} /></td><td><span>Inicio {dateLabel(row.startAt)}</span><small>Fin {dateLabel(row.endAt)}</small></td></> : <><td>{statusLabel(row.type)}</td><td><strong>{money(row.amount)}</strong><small>{row.fee ? `Fee ${money(row.fee)}` : row.netAmount ? `Neto ${money(row.netAmount)}` : row.label || ""}</small></td><td><StatusPill value={row.status} /></td><td><span>{row.network || "—"}</span><small className="mono-cell">{row.wallet || "Wallet no registrada"}</small></td><td>{dateLabel(row.createdAt)}</td></>}</tr>)}</tbody></DataTable>}</article>;
}

function CommissionsSection({ data }: { data: AdminData }) {
  return <>
    <div className="admin-grid"><article className="admin-metric"><div className="metric-icon"><CircleDollarSign size={18} /></div><p>Bono directo / 10%</p><strong>{money(data.commissions.direct)}</strong><small>Fuente: commission_ledger</small></article><article className="admin-metric"><div className="metric-icon"><BarChart3 size={18} /></div><p>Bono binario / 10%</p><strong>{money(data.commissions.binary)}</strong><small>Volumen emparejado server-side</small></article><article className="admin-metric"><div className="metric-icon"><WalletCards size={18} /></div><p>Total acreditado</p><strong>{money(data.commissions.total)}</strong><small>Entradas con estado credited</small></article><article className="admin-metric"><div className="metric-icon"><FileClock size={18} /></div><p>Pendiente de revisión</p><strong>{money(data.commissions.pending)}</strong><small>No se procesa desde el navegador</small></article></div>
    <div className="admin-binary-card"><div><p className="admin-kicker">NETWORK VOLUME</p><h2>Balance de piernas</h2><p>El emparejamiento usa el menor volumen disponible de izquierda y derecha.</p></div><div className="binary-stats"><div><span>Izquierda</span><strong>{money(data.binaryVolume.left)}</strong></div><div><span>Derecha</span><strong>{money(data.binaryVolume.right)}</strong></div><div><span>Matched</span><strong>{money(data.binaryVolume.matched)}</strong></div><div><span>Rate</span><strong>10%</strong></div></div><span className="binary-status">{statusLabel(data.binaryVolume.status)}</span></div>
    <article className="admin-card admin-card-full"><div className="card-heading"><div><p className="admin-kicker">COMMISSION LEDGER / READ ONLY</p><h2>Detalle de comisiones</h2></div><span className="card-status"><CheckCircle2 size={15} /> Sin acciones de crédito</span></div>{data.commissions.entries.length === 0 ? <EmptyState title="Sin comisiones" detail="No hay entradas de ledger para mostrar." /> : <DataTable label="Detalle de comisiones"><thead><tr><th>Tipo</th><th>Beneficiario</th><th>Monto</th><th>Pierna</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>{data.commissions.entries.map((row) => <tr key={row.id || row.sourceEventId}><td>{statusLabel(row.type)}</td><td className="mono-cell">{row.beneficiaryId?.slice(0, 12) || "—"}</td><td><strong>{money(row.amount)}</strong><small>{row.rate ? `${row.rate * 100}%` : "Tasa no registrada"}</small></td><td>{row.leg || "—"}</td><td><StatusPill value={row.status} /></td><td>{dateLabel(row.createdAt)}</td></tr>)}</tbody></DataTable>}</article>
  </>;
}

function ConfigurationSection({ apiState, data }: { apiState: ApiState; data: AdminData | null }) {
  return <div className="admin-columns"><article className="admin-card admin-card-large"><div className="card-heading"><div><p className="admin-kicker">SECURITY / ACCESS</p><h2>Configuración activa</h2></div><span className="card-status"><CheckCircle2 size={15} /> Protegida</span></div><div className="runtime-row"><span><i className="runtime-dot ready" />Supabase Auth + perfil admin</span><b>ACTIVO</b></div><div className="runtime-row"><span><i className={`runtime-dot ${apiState === "ready" ? "ready" : "idle"}`} />Funciones nativas Vercel</span><b>{apiState === "ready" ? "ACTIVO" : "BLOQUEADO"}</b></div><div className="runtime-row"><span><i className="runtime-dot ready" />Modo de escritura administrativa</span><b>DESACTIVADO</b></div><div className="runtime-row"><span><i className="runtime-dot ready" />Bono directo / binario</span><b>10% / 10%</b></div><p className="config-note">Las acciones de crédito financiero y procesamiento de contratos permanecen fuera de esta consola. Este bloque únicamente lee datos agregados y registros existentes.</p></article><article className="admin-card"><div className="card-heading"><div><p className="admin-kicker">DATA FRESHNESS</p><h2>Estado de datos</h2></div></div><div className="runtime-row"><span>Última consulta</span><b>{data ? dateLabel(data.lastUpdated) : "—"}</b></div><div className="runtime-row"><span>Tablas consultadas</span><b>5</b></div><div className="runtime-row"><span>Filas de red</span><b>{compactNumber(data?.metrics.networkVolumes)}</b></div><code>Cache-Control: no-store</code></article></div>;
}

export default function Admin() {
  const [open, setOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionName>("Resumen");
  const [apiState, setApiState] = useState<ApiState>("locked");
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState("");
  const [authError, setAuthError] = useState("");
  const [dataError, setDataError] = useState("");
  const [adminData, setAdminData] = useState<AdminData | null>(null);

  useEffect(() => {
    if (!supabase) { setApiState("offline"); setAuthError("Faltan las variables públicas de Supabase."); return; }
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted && session) validateSession(session.access_token);
      else if (mounted) setApiState("locked");
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) validateSession(session.access_token);
      else { setIsAuthorized(false); setAdminData(null); setApiState("locked"); }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  async function loadAdminData(accessToken: string) {
    setDataError("");
    const response = await fetch("/api/admin/data", { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } });
    const body = await response.json().catch(() => ({})) as AdminData & ApiError;
    if (!response.ok) throw new Error(body.error || "No se pudieron cargar los datos administrativos.");
    setAdminData(body);
  }

  async function validateSession(accessToken: string) {
    setApiState("checking");
    setAuthError("");
    try {
      const response = await fetch("/api/admin", { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } });
      const body = await response.json().catch(() => ({})) as ApiError & { user?: { email?: string; role?: string } };
      if (!response.ok) { setIsAuthorized(false); setApiState(response.status === 401 || response.status === 403 ? "locked" : "offline"); setAuthError(body.error ?? "La sesión no tiene permisos administrativos."); return; }
      setIsAuthorized(true); setUserEmail(body.user?.email ?? ""); setUserRole(body.user?.role ?? "admin"); setApiState("ready");
      try { await loadAdminData(accessToken); } catch (error) { setDataError(error instanceof Error ? error.message : "No se pudieron cargar los datos administrativos."); }
    } catch { setIsAuthorized(false); setApiState("offline"); setAuthError("No se pudo conectar con la función nativa."); }
  }

  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    if (!supabase) { setAuthError("Supabase no está configurado en este entorno."); return; }
    setApiState("checking");
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setPassword("");
    if (error || !data.session) { setApiState("locked"); setAuthError(error?.message ?? "No se pudo iniciar sesión."); return; }
    await validateSession(data.session.access_token);
  }

  async function refreshData() {
    const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } };
    if (session) await loadAdminData(session.access_token).catch((error) => setDataError(error instanceof Error ? error.message : "No se pudieron actualizar los datos."));
  }

  async function signOut() { await supabase?.auth.signOut(); setIsAuthorized(false); setUserEmail(""); setUserRole(""); setAdminData(null); setApiState("locked"); }

  const apiLabel = apiState === "checking" ? "Verificando función" : apiState === "ready" ? "Función protegida activa" : apiState === "locked" ? "API protegida · credencial requerida" : "API no disponible";
  const ActiveIcon = sectionIcons[activeSection];

  if (!isAuthorized) return <main className="admin-shell admin-gate-shell"><section className="admin-gate"><div className="admin-brand-mark">B<span>·</span></div><p className="admin-kicker">BITNODE / PRIVATE OPERATIONS</p><h1>Acceso administrativo</h1><p>Inicia sesión con Supabase. La función server-side verificará el token y consultará el rol administrativo en <code>profiles</code>.</p><form onSubmit={authorize} className="admin-gate-form"><label htmlFor="admin-email">Correo administrativo</label><input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@bitnode.space" autoComplete="username" required /><label htmlFor="admin-password">Contraseña</label><input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Contraseña de Supabase" autoComplete="current-password" required /><button type="submit" disabled={apiState === "checking"}>{apiState === "checking" ? "Verificando sesión…" : "Entrar a la consola"}</button></form>{authError && <p className="admin-auth-error" role="alert">{authError}</p>}<Link href="/" className="admin-back"><ArrowLeft size={15} /> Volver a BitNode</Link></section></main>;

  return <main className="admin-shell"><aside className={`admin-sidebar ${open ? "is-open" : ""}`}><div className="admin-brand-row"><div className="admin-brand-mark">B<span>·</span></div><div><strong>bitnode.</strong><small>OPERATIONS CONSOLE</small></div><button className="admin-close" aria-label="Cerrar menú" onClick={() => setOpen(false)}><X size={18} /></button></div><div className="admin-env"><i /> PRODUCTION / READ ONLY</div><nav className="admin-nav" aria-label="Secciones administrativas">{sections.map((section) => { const Icon = sectionIcons[section]; return <button key={section} className={activeSection === section ? "active" : ""} onClick={() => { setActiveSection(section); setOpen(false); }}><span><Icon size={16} /></span>{section}</button>; })}</nav><div className="admin-side-note"><LockKeyhole size={16} /><p>Las operaciones financieras permanecen bloqueadas. Esta consola consulta datos reales sin modificarlos.</p></div><Link href="/" className="admin-back"><ArrowLeft size={15} /> Volver a BitNode</Link></aside><section className="admin-content"><header className="admin-header"><button className="admin-menu" aria-label="Abrir menú" onClick={() => setOpen(true)}><Menu size={20} /></button><div><p className="admin-kicker">ADMIN / {activeSection.toUpperCase()}</p><h1><ActiveIcon size={24} /> {activeSection}</h1></div><div className="admin-header-right"><span className={`api-badge ${apiState}`}><i />{apiLabel}</span><span className="admin-user">{userEmail} · {userRole}</span><button className="admin-logout" onClick={signOut}>Salir</button><div className="admin-avatar">OP</div></div></header><div className="admin-warning"><ShieldCheck size={17} /><span><strong>Consola protegida y de solo lectura.</strong> La tasa directa es 10% y la binaria es 10%; los créditos siguen en funciones server-side separadas.</span><button className="admin-refresh" onClick={refreshData} aria-label="Actualizar datos"><RefreshCw size={15} /></button></div>{dataError && <div className="admin-data-error" role="alert">{dataError}<button onClick={refreshData}>Reintentar</button></div>}{activeSection === "Resumen" && <SummarySection data={adminData} />}{activeSection === "Usuarios" && (adminData ? <UsersSection users={adminData.users} /> : <LoadingState />)}{activeSection === "Contratos" && (adminData ? <TransactionsSection rows={adminData.contracts} contractsOnly /> : <LoadingState />)}{activeSection === "Transacciones" && (adminData ? <TransactionsSection rows={adminData.transactions} /> : <LoadingState />)}{activeSection === "Comisiones" && (adminData ? <CommissionsSection data={adminData} /> : <LoadingState />)}{activeSection === "Configuración" && <ConfigurationSection apiState={apiState} data={adminData} />}</section></main>;
}

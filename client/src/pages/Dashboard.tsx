/**
 * Estilo BitNode dashboard: consola nocturna de validación; sidebar persistente,
 * métricas compactas, índigo para navegación activa y verde solo para estado vivo.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Bell, Box, CircleDollarSign, ChevronDown, Clock3, Copy, Gem, Home, LogOut, Menu, Plus, Settings, Users, Wallet, X, Zap } from "lucide-react";

const nav = [
  ["Inicio", "/dashboard", Home], ["Activar nodos", "/dashboard/activate", Gem], ["Mis nodos", "/dashboard/nodes", Box], ["Mi red", "/dashboard/network", Users], ["Depositar", "/dashboard/deposit", Plus], ["Retirar", "/dashboard/withdraw", Wallet], ["Historial", "/dashboard/history", Clock3], ["Perfil", "/dashboard/profile", Settings],
] as const;

const liveRows = [["BN-Y9F4UG", "Ethereum", "2,501 ops", "+$2.0430"], ["BN-8DX8W6", "Solana", "3,264 ops", "+$0.2208"], ["BN-4SDMIE", "Arbitrum", "3,232 ops", "+$1.6028"], ["BN-5WHG14", "Bitcoin", "4,165 ops", "+$1.0476"]];

function Metric({ label, value, tone = "neutral", note }: { label: string; value: string; tone?: string; note?: string }) {
  return <article className={`dash-metric ${tone}`}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>;
}

export default function Dashboard() {
  const [location, navigate] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveNodes, setLiveNodes] = useState(15014);
  const section = useMemo(() => location.split("/")[2] || "home", [location]);
  const isHome = section === "home";

  useEffect(() => { const timer = window.setInterval(() => setLiveNodes((value) => value + (Math.random() > .5 ? 1 : 0)), 5000); return () => window.clearInterval(timer); }, []);
  const showNotice = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(null), 3000); };
  const activeLabel = nav.find((item) => item[1] === location)?.[0] || (isHome ? "Inicio" : "Panel");

  const content = () => {
    if (isHome) return <HomePanel liveNodes={liveNodes} showNotice={showNotice} navigate={navigate} />;
    const labels: Record<string, { eyebrow: string; title: string; copy: string }> = {
      activate: { eyebrow: "CONTRATOS DISPONIBLES", title: "Activar nodos", copy: "Elige el ritmo de generación que mejor encaja con tu estrategia." },
      nodes: { eyebrow: "INFRAESTRUCTURA ASIGNADA", title: "Mis nodos", copy: "Consulta el estado y el rendimiento de tus contratos activos." },
      network: { eyebrow: "PROGRAMA DE RED", title: "Mi red", copy: "Revisa tu organización, bonos y evolución de rangos." },
      deposit: { eyebrow: "BALANCE DE CUENTA", title: "Depositar", copy: "Fondea tu balance para activar capacidad de validación." },
      withdraw: { eyebrow: "BALANCE DISPONIBLE", title: "Retirar", copy: "Solicita una transferencia desde tu balance disponible." },
      history: { eyebrow: "REGISTRO DE ACTIVIDAD", title: "Historial", copy: "Movimientos, acreditaciones y operaciones de tu cuenta." },
      profile: { eyebrow: "CONFIGURACIÓN", title: "Perfil", copy: "Administra tus datos y preferencias de cuenta." },
    };
    const current = labels[section] || labels.activate;
    return <GenericPanel {...current} showNotice={showNotice} />;
  };

  return <div className="dashboard-shell">
    {notice && <div className="notice dash-notice" role="status">{notice}</div>}
    <aside className={`dashboard-sidebar ${mobileOpen ? "is-open" : ""}`}>
      <div className="dash-brand"><img src="/manus-storage/bitnode-isotipo_1381181d.png" alt="" /><span>bitnode<span>.</span></span></div>
      <div className="dash-nav">{nav.map(([label, href, Icon]) => <Link key={href} href={href} className={location === href ? "active" : ""} onClick={() => setMobileOpen(false)}><Icon size={19} /><span>{label}</span></Link>)}</div>
      <button className="logout" onClick={() => { showNotice("Sesión demostrativa cerrada."); navigate("/"); }}><LogOut size={19} /><span>Cerrar sesión</span></button>
    </aside>
    <div className="dashboard-main">
      <header className="dash-topbar"><button className="dash-mobile-toggle" onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X /> : <Menu />}</button><h1>{activeLabel}</h1><div className="dash-tools"><button className="dash-locale" onClick={() => showNotice("Idioma activo: Español")}>ES <ChevronDown size={14} /></button><button onClick={() => showNotice("No tienes notificaciones nuevas.")} aria-label="Notificaciones"><Bell size={19} /></button><button className="dash-balance" onClick={() => navigate("/dashboard/deposit")}><span>BALANCE</span><strong>$0.00</strong></button></div></header>
      <main className="dash-content">{content()}</main>
    </div>
  </div>;
}

function HomePanel({ liveNodes, showNotice, navigate }: { liveNodes: number; showNotice: (message: string) => void; navigate: (path: string) => void }) {
  return <>
    <div className="dash-intro"><div><span className="dash-eyebrow">PANEL DE CONTROL</span><h2>Hola, gentecash</h2><p>Esto es lo que están generando tus nodos.</p></div><div className="dash-date">MIÉRCOLES · 20 AGO 2026</div></div>
    <section className="dash-metrics-grid"><Metric label="BALANCE DISPONIBLE" value="$0.00" tone="green" /><Metric label="INVERTIDO EN NODOS" value="$0.00" /><Metric label="RENDIMIENTO TOTAL" value="$0.00" tone="blue" /><Metric label="GANANCIA DIARIA EST." value="$0.00" tone="violet" note="lunes a viernes" /></section>
    <section className="dash-mini-grid"><Metric label="INICIO RÁPIDO" value="$0.00" /><Metric label="BINARIO" value="$0.00" /><Metric label="RANGOS" value="$0.00" /></section>
    <div className="dash-section-heading"><h3>Mis contratos</h3><button onClick={() => navigate("/dashboard/activate")}>Activar nodo <span>→</span></button></div>
    <div className="dash-columns"><section className="empty-contracts"><img src="/manus-storage/bitnode-isotipo_1381181d.png" alt="" /><h4>Aún no tienes contratos activos</h4><p>Activa tu primer nodo para comenzar a participar en la infraestructura.</p><button className="dash-primary" onClick={() => navigate("/dashboard/activate")}>Ver contratos <Zap size={15} /></button></section><LiveFarm liveNodes={liveNodes} /></div>
    <div className="dash-lower-grid"><section className="dash-card referral-card"><div className="dash-card-head"><div><span className="dash-eyebrow">ENLACE DE REFERIDO</span><h3>Construye tu red</h3></div><Users size={20} /></div><p>Comparte tu enlace y recibe bonos cuando tu red active contratos.</p><div className="referral-code">bitnode.space/r/<strong>gentecash</strong><button onClick={() => showNotice("Enlace copiado al portapapeles.")}><Copy size={14} /></button></div></section><section className="dash-card progress-card"><div className="dash-card-head"><div><span className="dash-eyebrow">PRÓXIMO RANGO</span><h3>Bronce</h3></div><span className="rank-value">$50</span></div><div className="progress-track"><span /></div><div className="progress-labels"><span>$0 invertidos</span><span>$50 objetivo</span></div></section></div>
  </>;
}

function LiveFarm({ liveNodes }: { liveNodes: number }) {
  return <section className="live-farm"><div className="live-farm-title"><h3><i /> Granja en vivo</h3><span>UPTIME <strong>99.77%</strong></span></div><div className="farm-summary"><strong>{liveNodes.toLocaleString("en-US")}</strong><span>NODOS</span><strong>99.77%</strong><span>UPTIME</span></div>{liveRows.map((row) => <div className="farm-row" key={row[0]}><div><b>{row[0]}</b><span>{row[1]} · {row[2]}</span></div><strong>{row[3]}</strong></div>)}</section>;
}

function GenericPanel({ eyebrow, title, copy, showNotice }: { eyebrow: string; title: string; copy: string; showNotice: (message: string) => void }) {
  return <div className="generic-panel"><span className="dash-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{copy}</p><div className="generic-grid"><section className="dash-card"><div className="dash-card-head"><h3>Estado de cuenta</h3><CircleDollarSign size={20} /></div><strong className="generic-value">$0.00</strong><span className="generic-muted">Sin movimientos pendientes</span><button className="dash-primary" onClick={() => showNotice("Esta acción es demostrativa en la réplica.")}>Continuar <Zap size={15} /></button></section><section className="dash-card ledger-card"><div className="dash-card-head"><h3>Actividad reciente</h3><Activity size={20} /></div><div className="empty-ledger"><Activity size={26} /><span>Aún no hay movimientos</span><small>Las operaciones aparecerán aquí cuando actives un nodo.</small></div></section></div></div>;
}

/**
 * Estilo BitNode: infraestructura nocturna editorial; azul índigo eléctrico,
 * datos monoespaciados, numeración de secciones y movimiento orbital contenido.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { useEffect, useState } from "react";
import { Link as WouterLink } from "wouter";
import { ArrowRight, ChevronDown, Menu, X, Zap, Activity, ShieldCheck, Cpu, CircleDollarSign } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";

const networks = ["Bitcoin", "Ethereum", "BNB Chain", "Solana", "Polygon", "Avalanche", "Arbitrum", "Tron", "Optimism", "Base"];

const plans = [
  { tag: "SIN PLAZO FIJO", name: "Nodo Diario", rate: "1% – 1.5%", cadence: "diario, lunes a viernes", copy: "Rendimiento variable acreditado cada día hábil, disponible de inmediato.", min: "$10 USDT", duration: "Indefinida", action: "Activar nodo diario" },
  { tag: "PLAZO DE 7 DÍAS", name: "Nodo 7 Días", rate: "2% – 3%", cadence: "diario, lunes a viernes", copy: "Rendimiento variable durante 7 días. La ganancia acumulada y el capital se liberan al vencer.", min: "$10 USDT", duration: "7 días + capital de vuelta", action: "Activar nodo 7 días", featured: true },
  { tag: "PLAZO DE 14 DÍAS", name: "Nodo 14 Días", rate: "3% – 4%", cadence: "diario, lunes a viernes", copy: "Rendimiento variable durante 14 días. La ganancia acumulada y el capital se liberan al vencer.", min: "$10 USDT", duration: "14 días + capital de vuelta", action: "Activar nodo 14 días" },
  { tag: "PLAZO DE 21 DÍAS", name: "Nodo 21 Días", rate: "4% – 5%", cadence: "diario, lunes a viernes", copy: "Rendimiento variable durante 21 días. La ganancia acumulada y el capital se liberan al vencer.", min: "$10 USDT", duration: "21 días + capital de vuelta", action: "Activar nodo 21 días" },
];

const rows = [
  ["BN-ZU3JZL", "Ethereum · 0x4529dc4b…415b6e", "3,092 ops", "+$3.3430"],
  ["BN-8DX8W6", "Solana · 0x38b74349…f7c427", "3,264 ops", "+$0.2208"],
  ["BN-4SDMIE", "Arbitrum · 0x1564b219…79abfc", "3,232 ops", "+$1.6028"],
  ["BN-5WHG14", "Bitcoin · 0x68d6ccff…391f63", "4,165 ops", "+$1.0476"],
  ["BN-VAMVDK", "Bitcoin · 0x050f49a8…6480a3", "2,164 ops", "+$0.8668"],
  ["BN-RCYYRY", "Avalanche · 0xcb9b88a4…e39b55", "1,465 ops", "+$1.3221"],
  ["BN-V9R3GD", "Arbitrum · 0xbd75aa11…daf0f7", "4,393 ops", "+$1.0278"],
  ["BN-AMG0HW", "BNB Chain · 0xfc94bbff…11f573", "1,812 ops", "+$0.2556"],
];

const faqs = [
  ["¿Qué es exactamente un nodo de validación?", "Es un equipo que participa en la verificación y ordenamiento de operaciones dentro de una red blockchain. BitNode concentra la operación técnica para que el usuario pueda participar sin administrar hardware."],
  ["¿Por qué los rendimientos se generan solo de lunes a viernes?", "Los contratos siguen el calendario operativo de liquidación de la granja. La actividad y la acreditación se contabilizan en días hábiles."],
  ["¿Cómo deposito y cómo retiro?", "El sitio de referencia indica que el fondeo se realiza en USDT y que los retiros dependen de la frecuencia de cada contrato. En esta réplica las acciones son demostrativas."],
  ["¿Necesito conocimientos técnicos?", "No. La propuesta está pensada para que la operación de nodos, servidores y mantenimiento quede a cargo de la granja."],
  ["¿Cómo funcionan los bonos de red?", "El programa contempla un bono de inicio rápido, un bono binario y recompensas por rango, mostrados de forma ilustrativa en la sección correspondiente."],
];

function Action({ children, secondary = false, onClick }: { children: React.ReactNode; secondary?: boolean; onClick?: () => void }) {
  return <button onClick={onClick} className={`action ${secondary ? "action-secondary" : "action-primary"}`}>{children}<ArrowRight size={15} /></button>;
}

export default function Home() {
  // The useAuth hook provides authentication state.
  // To implement login/logout, call logout(), or start login from an event
  // handler: onClick={() => startLogin()} (imported from "@/const"). Never call
  // startLogin() during render (no href={startLogin()}) — it mints a one-time
  // nonce cookie and must run only at the moment of navigation.
  let { user, loading, error, isAuthenticated, logout } = useAuth();

  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [live, setLive] = useState(15017);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setLive((value) => value + Math.floor(Math.random() * 3)), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3200);
  };

  return (
    <div className="site-shell">
      {notice && <div className="notice" role="status">{notice}</div>}
      <header className="topbar">
        <a className="brand" href="#top" aria-label="BitNode inicio"><BrandMark className="brand-mark" /><span>bitnode<span className="brand-dot">.</span></span></a>
        <nav className={menuOpen ? "nav-links open" : "nav-links"}>
          <a href="#contratos" onClick={() => setMenuOpen(false)}>Contratos</a>
          <a href="#red" onClick={() => setMenuOpen(false)}>Programa de red</a>
          <a href="#actividad" onClick={() => setMenuOpen(false)}>Actividad</a>
          <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
          <button className="locale" onClick={() => showNotice("Selector de idioma: Español")}>ES <ChevronDown size={14} /></button>
          <WouterLink className="panel-link" href="/auth">Mi panel</WouterLink>
        </nav>
        <button className="menu-toggle" aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-art" aria-hidden="true" />
          <div className="hero-inner">
            <div className="status-pill"><span className="live-dot" /> LIVE <strong>{live.toLocaleString("en-US")}</strong> nodos validando ahora</div>
            <p className="eyebrow">INFRAESTRUCTURA DE VALIDACIÓN · 2026</p>
            <h1>La infraestructura<br />trabaja. <em>Tú cobras.</em></h1>
            <p className="hero-copy">BitNode opera una granja de nodos de validación en las principales redes blockchain. Adquiere un contrato de nodo y recibe tu parte de las comisiones que la granja cobra por validar operaciones, cada día hábil.</p>
            <div className="hero-actions"><WouterLink className="action action-primary" href="/auth">Activar un nodo <ArrowRight size={15} /></WouterLink><Action secondary onClick={() => document.querySelector("#contratos")?.scrollIntoView({ behavior: "smooth" })}>Comparar contratos</Action></div>
          </div>
          <div className="hero-grid" aria-hidden="true"><span>01 / NODES</span><span>VALIDATION LAYER</span><span>UPTIME 99.81%</span></div>
        </section>

        <section className="stats-bar container"><div><strong>15,017</strong><span>NODOS ACTIVOS</span></div><div><strong>2.8M</strong><span>OPERACIONES VALIDADAS</span></div><div><strong>$1.37M</strong><span>COMISIONES COBRADAS</span></div><div><strong>99.81%</strong><span>UPTIME DE RED</span></div></section>
        <div className="network-strip">{[...networks, ...networks].map((network, i) => <span key={`${network}-${i}`}><i />{network}</span>)}</div>

        <section className="section process container" id="como-funciona">
          <div className="section-head"><div className="section-index">01 — CÓMO FUNCIONA</div><div className="section-rule" /></div>
          <div className="split-heading"><h2>Un nodo,<br /><span>tres pasos.</span></h2><p>No necesitas hardware, ni configurar servidores, ni saber de blockchain. La granja se encarga de la operación; tú eliges el contrato.</p></div>
          <div className="steps">{[["01", "Crea tu cuenta y deposita", "Regístrate en un minuto y fondea tu cuenta con USDT. El equipo verifica y acredita tu depósito."], ["02", "Elige tu contrato de nodo", "Diario, semanal o mensual. Cada contrato asigna capacidad de validación de la granja a tu cuenta."], ["03", "Cobra los rendimientos", "De lunes a viernes tu nodo genera comisiones por operaciones validadas. Las retiras según la frecuencia de tu contrato."]].map(([number, title, copy]) => <article className="step-card" key={number}><span className="step-number">{number}</span><Cpu size={20} /><h3>{title}</h3><p>{copy}</p></article>)}</div>
        </section>

        <section className="section contracts container" id="contratos">
          <div className="section-head"><div className="section-index">02 — CONTRATOS DE NODO</div><div className="section-rule" /></div>
          <div className="split-heading"><h2>Cuatro ciclos,<br /><span>tú decides el ritmo.</span></h2><p>Todos los contratos generan de lunes a viernes, los días en que la granja liquida comisiones. La tasa del día varía según el rendimiento real de los nodos.</p></div>
          <div className="plan-grid">{plans.map((plan) => <article className={`plan-card ${plan.featured ? "featured" : ""}`} key={plan.name}>{plan.featured && <div className="featured-label">MÁS ELEGIDO</div>}<div className="plan-tag">{plan.tag}</div><h3>{plan.name}</h3><div className="rate">{plan.rate}</div><div className="cadence">{plan.cadence}</div><p>{plan.copy}</p><dl><div><dt>Inversión mínima</dt><dd>{plan.min}</dd></div><div><dt>Generación</dt><dd>Lunes a viernes</dd></div><div><dt>Duración</dt><dd>{plan.duration}</dd></div></dl><button className="plan-action" onClick={() => showNotice("Acción demostrativa: el registro estará disponible al conectar una cuenta.")}>{plan.action}<ArrowRight size={15} /></button></article>)}</div>
          <div className="contract-note"><Zap size={16} /> Bono inicio rápido 10% <span>·</span> Bono binario 10% <span>·</span> Sistema de rangos con recompensas</div>
        </section>

        <section className="section network-section" id="red"><div className="network-art" aria-hidden="true" /><div className="container"><div className="section-head"><div className="section-index">03 — PROGRAMA DE RED</div><div className="section-rule" /></div><div className="split-heading"><h2>Tu red<br /><span>también genera.</span></h2><p>Construye una organización que se mueve con la infraestructura. El volumen se reconoce con reglas visibles y recompensas definidas.</p></div><div className="bonus-layout"><div className="bonus-column"><article className="bonus-card"><div><span>BONO INICIO RÁPIDO</span><strong>10%</strong><small>INSTANTÁNEO</small></div><p>Por cada contrato que active un referido directo tuyo, recibes el 10% del monto en tu balance, al momento.</p><code>referido activa contrato $1,000<br /><b>→ tu bono +$100.00</b> // acreditado al instante</code></article><article className="bonus-card"><div><span>BONO BINARIO</span><strong>10%</strong><small>DIARIO</small></div><p>Tu organización se construye en dos equipos. Cada día, el sistema empareja el volumen de ambas piernas.</p><code>pierna A $5,000 · pierna B $3,000<br /><b>→ emparejado $3,000</b> · tu bono +$300.00</code></article></div><div className="ranks-card"><div className="plan-tag">SISTEMA DE RANGOS</div><p>Recompensas únicas al crecer tu inversión y el volumen de tu equipo.</p><button className="text-action" onClick={() => showNotice("Empieza con un contrato para desbloquear tu red.")}>Empezar a construir <ArrowRight size={15} /></button><div className="ranks">{[["01", "Bronce", "$50"], ["02", "Plata", "$250"], ["03", "Oro", "$1,000"], ["04", "Validador", "$2,500"], ["05", "Master Node", "$10,000"]].map(([n, name, value]) => <div key={n}><span>RANGO {n}</span><strong>{name}</strong><b>{value}</b></div>)}</div></div></div></div></section>

        <section className="section activity container" id="actividad"><div className="section-head"><div className="section-index">04 — ACTIVIDAD DE LA GRANJA</div><div className="section-rule" /></div><div className="activity-heading"><div><h2>Operaciones validadas,<br /><span>en directo.</span></h2><p className="live-refresh"><i /> actualiza cada 30s</p></div><div className="activity-total"><span>total acumulado</span><strong>$1,378,422.73 <small>USDT</small></strong></div></div><div className="activity-table"><div className="table-row table-head"><span>NODO</span><span>RED / TX</span><span>OPS</span><span>COMISIÓN</span></div>{rows.map((row, index) => <div className="table-row" key={row[0]}><span className="node-id"><i />{row[0]}</span><span>{row[1]}</span><span>{row[2]}</span><span className="commission">{row[3]}</span></div>)}</div></section>

        <section className="section faq-section container" id="faq"><div className="section-head"><div className="section-index">05 — FAQ</div><div className="section-rule" /></div><div className="split-heading"><h2>Preguntas<br /><span>frecuentes.</span></h2><p>¿Algo más? Escríbenos desde tu panel una vez registrado.</p></div><div className="faq-list">{faqs.map(([question, answer], index) => <div className={`faq-item ${openFaq === index ? "is-open" : ""}`} key={question}><button onClick={() => setOpenFaq(openFaq === index ? null : index)}><span>{question}</span><ChevronDown size={18} /></button>{openFaq === index && <p>{answer}</p>}</div>)}</div></section>

        <section className="closing"><div className="closing-orbit" aria-hidden="true" /><div className="container closing-inner"><div className="status-pill"><span className="live-dot" /> REGISTRO GRATUITO</div><h2>Pon un nodo a trabajar<br /><em>para ti hoy.</em></h2><p>Registro gratuito. Contratos desde $10 USDT. Rendimientos de lunes a viernes.</p><div className="hero-actions"><WouterLink className="action action-primary" href="/auth">Crear cuenta gratis <ArrowRight size={15} /></WouterLink><WouterLink className="action action-secondary" href="/auth">Ya tengo cuenta <ArrowRight size={15} /></WouterLink></div></div></section>
      </main>
      <footer className="footer container"><a className="brand" href="#top"><BrandMark className="brand-mark" /><span>bitnode<span className="brand-dot">.</span></span></a><span>Infraestructura que trabaja.</span><span>© 2026 BitNode</span></footer>
    </div>
  );
}

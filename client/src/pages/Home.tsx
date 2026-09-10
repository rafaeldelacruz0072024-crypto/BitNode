import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight, BadgePercent, BarChart3, Bot, BrainCircuit, CalendarDays, Check,
  ChevronDown, Clock3, GitBranch, Globe2, LineChart, Menu, Megaphone,
  RefreshCcw, ShieldCheck, Sparkles, TrendingUp, UsersRound, WalletCards, X,
} from "lucide-react";

const pillars = [
  { icon: BrainCircuit, label: "Inteligencia artificial" },
  { icon: TrendingUp, label: "Trading de divisas" },
  { icon: Megaphone, label: "Marketing digital" },
  { icon: BarChart3, label: "Mercados de predicción" },
];

const plans = [
  { name: "Nodo diario", duration: "Flexible", rate: "1% – 1.5%", accent: "cyan", note: "Participación por tiempo indefinido" },
  { name: "Nodo 7 días", duration: "7 días", rate: "2% – 3%", accent: "blue", note: "Capital devuelto al finalizar" },
  { name: "Nodo 14 días", duration: "14 días", rate: "3% – 4%", accent: "violet", note: "Capital devuelto al finalizar" },
  { name: "Nodo 21 días", duration: "21 días", rate: "4% – 5%", accent: "lime", note: "Capital devuelto al finalizar" },
];

const benefits = [
  { icon: WalletCards, kicker: "Rendimiento pasivo", value: "Según tu nodo", text: "Completa cuatro tareas dentro de cada periodo de 24 horas para mantener el avance del ciclo." },
  { icon: UsersRound, kicker: "Bono directo", value: "10%", text: "Recibe el diez por ciento cuando una persona referida directamente activa un nodo." },
  { icon: GitBranch, kicker: "Bono binario", value: "8%", text: "Se calcula sobre el nuevo volumen emparejado entre las ramas izquierda y derecha." },
];

const rules = [
  { icon: WalletCards, title: "Desde $10", text: "Monto mínimo para activar un nodo." },
  { icon: CalendarDays, title: "Lunes a viernes", text: "Los rendimientos se generan en días laborables." },
  { icon: Clock3, title: "4 tareas cada 24 h", text: "La continuidad mantiene el progreso del ciclo." },
  { icon: RefreshCcw, title: "Reinicio por inactividad", text: "Si faltan tareas, avance y días vuelven a cero; el capital del nodo se conserva." },
  { icon: BadgePercent, title: "Retiro con 5%", text: "Ventana: miércoles de 8:00 AM a 2:00 PM, hora de México (GMT-6)." },
  { icon: ShieldCheck, title: "Registro verificable", text: "Cada bono guarda nodo, usuario origen, rama, tasa y monto." },
];

const faqs = [
  ["¿Cómo se elige el rendimiento?", "El porcentaje se selecciona dentro del rango del nodo cuando concluye cada ciclo."],
  ["¿Qué pasa si no completo las tareas?", "El avance y los días procesados reinician a cero. El capital colocado en el nodo se mantiene."],
  ["¿Cuándo puedo solicitar un retiro?", "Los miércoles, de 8:00 AM a 2:00 PM, hora de México (GMT-6). El retiro aplica un fee de 5%."],
];

function BrandMark() {
  return <span className="bn-brand"><img src="/bitnode-logo.png" alt="BitNode" /></span>;
}

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const closeMenu = () => setMenuOpen(false);

  return (
    <main className="bn-site">
      <header className="bn-header">
        <div className="bn-container bn-nav">
          <a href="#inicio" onClick={closeMenu}><BrandMark /></a>
          <nav className={menuOpen ? "bn-navlinks is-open" : "bn-navlinks"} aria-label="Navegación principal">
            <a href="#ecosistema" onClick={closeMenu}>Ecosistema</a><a href="#nodos" onClick={closeMenu}>Nodos</a>
            <a href="#beneficios" onClick={closeMenu}>Beneficios</a><a href="#reglas" onClick={closeMenu}>Reglas</a>
            <Link href="/auth" className="bn-login" onClick={closeMenu}>Ingresar <ArrowRight size={16} /></Link>
          </nav>
          <button className="bn-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}>{menuOpen ? <X /> : <Menu />}</button>
        </div>
      </header>

      <section className="bn-hero" id="inicio">
        <div className="bn-hero-grid" aria-hidden="true" />
        <div className="bn-container bn-hero-inner">
          <div className="bn-hero-copy">
            <span className="bn-eyebrow"><Sparkles size={15} /> Tecnología para una nueva economía digital</span>
            <h1>Inteligencia que<br /><em>genera oportunidades.</em></h1>
            <p>BitNode conecta inteligencia artificial, mercados financieros, marketing digital y predicción en un ecosistema diseñado para participar, aprender y crecer.</p>
            <div className="bn-actions"><a href="#ecosistema" className="bn-button bn-button-primary">Conocer el ecosistema <ArrowRight size={18} /></a><Link href="/auth?mode=register" className="bn-button bn-button-ghost">Crear cuenta</Link></div>
            <div className="bn-trust"><ShieldCheck size={18} /><span>Reglas claras, ciclos visibles y movimientos registrados.</span></div>
          </div>
          <div className="bn-hero-art"><div className="bn-orbit bn-orbit-one" /><div className="bn-orbit bn-orbit-two" /><img src="/bitnode-hero-robot-hq.webp" alt="Robot futurista de BitNode" width={1217} height={1293} fetchPriority="high" decoding="async" /><div className="bn-signal"><span /> Infraestructura conectada</div></div>
        </div>
        <div className="bn-container bn-pillar-rail">{pillars.map(({ icon: Icon, label }) => <div key={label}><Icon /><span>{label}</span></div>)}</div>
      </section>

      <section className="bn-section bn-intro" id="ecosistema">
        <div className="bn-container bn-split-heading">
          <div><span className="bn-section-index">01 / Ecosistema</span><h2>Un grupo de soluciones impulsadas por datos e IA.</h2></div>
          <div className="bn-intro-copy"><p>BitNode reúne compañías innovadoras que usan el lenguaje de la inteligencia artificial para operar en sectores tecnológicos de alto crecimiento.</p><div className="bn-mini-grid"><span><Bot /> Automatización</span><span><Globe2 /> Alcance global</span><span><LineChart /> Análisis de mercado</span><span><BrainCircuit /> Inteligencia aplicada</span></div></div>
        </div>
      </section>

      <section className="bn-section bn-nodes" id="nodos">
        <div className="bn-container">
          <div className="bn-section-head"><div><span className="bn-section-index">02 / Nodos</span><h2>Elige el ciclo que se adapta a ti.</h2></div><p>Activa desde $10. El rendimiento se acredita de lunes a viernes y el porcentaje se elige dentro del rango al completar cada ciclo.</p></div>
          <div className="bn-plan-grid">{plans.map((plan, index) => <article className={`bn-plan bn-plan-${plan.accent}`} key={plan.name}><div className="bn-plan-top"><span>0{index + 1}</span><span>{plan.duration}</span></div><h3>{plan.name}</h3><strong>{plan.rate}</strong><small>rango de rendimiento</small><div className="bn-plan-rule" /><p><Check /> {plan.note}</p><p><Check /> Generación de lunes a viernes</p></article>)}</div>
          <p className="bn-disclaimer">Los porcentajes se aplican según las reglas y la configuración vigente de cada ciclo. Revisa los términos dentro de tu cuenta antes de activar.</p>
        </div>
      </section>

      <section className="bn-section bn-benefits" id="beneficios">
        <div className="bn-container">
          <div className="bn-section-head"><div><span className="bn-section-index">03 / Plan de compensación</span><h2>Tres formas de generar.</h2></div><p>Participación personal, crecimiento por recomendación y desarrollo de una estructura binaria.</p></div>
          <div className="bn-benefit-grid">{benefits.map(({ icon: Icon, kicker, value, text }) => <article key={kicker} className="bn-benefit-card"><Icon /><span>{kicker}</span><strong>{value}</strong><p>{text}</p></article>)}</div>
          <div className="bn-binary-note"><GitBranch /><div><strong>Balance binario cada 60 días</strong><span>Los puntos acumulados en la pierna de mayor volumen se reinician al completar cada periodo de 60 días.</span></div></div>
        </div>
      </section>

      <section className="bn-products" id="productos">
        <div className="bn-container">
          <div className="bn-section-head bn-section-head-dark"><div><span className="bn-section-index">04 / Productos</span><h2>Tecnología aplicada a mercados reales.</h2></div><p>Dos líneas de producto para analizar, interpretar y actuar frente a mercados globales.</p></div>
          <div className="bn-product-grid">
            <article className="bn-product-card bn-product-fx"><div className="bn-product-number">01</div><TrendingUp /><span>BitnodeFX</span><h3>Algoritmos para mercados financieros.</h3><p>Software especializado para Forex, CFDs, futuros, índices y criptomonedas, con sistemas automatizados de alta frecuencia y arbitraje.</p><div className="bn-tag-row"><span>Forex</span><span>CFDs</span><span>Futuros</span><span>Cripto</span></div></article>
            <article className="bn-product-card bn-product-predict"><div className="bn-product-number">02</div><Globe2 /><span>Bitnode Predicción</span><h3>Probabilidades en tiempo real.</h3><p>Plataforma para interpretar eventos globales, visualizar escenarios y operar contratos con inteligencia de mercado.</p><div className="bn-tag-row"><span>Eventos</span><span>Probabilidades</span><span>Contratos</span></div></article>
          </div>
        </div>
      </section>

      <section className="bn-section bn-rules" id="reglas">
        <div className="bn-container"><div className="bn-section-head"><div><span className="bn-section-index">05 / Reglas importantes</span><h2>Control claro en cada etapa.</h2></div><p>Conoce las condiciones de participación, continuidad y retiro antes de comenzar.</p></div><div className="bn-rule-grid">{rules.map(({ icon: Icon, title, text }, index) => <article key={title}><span>0{index + 1}</span><Icon /><h3>{title}</h3><p>{text}</p></article>)}</div></div>
      </section>

      <section className="bn-section bn-faq">
        <div className="bn-container bn-faq-layout"><div><span className="bn-section-index">06 / Preguntas frecuentes</span><h2>Lo esencial, antes de activar.</h2><p>Consulta los detalles operativos desde tu panel y mantén el seguimiento de cada nodo.</p></div><div className="bn-faq-list">{faqs.map(([question, answer], index) => <button key={question} className={openFaq === index ? "is-open" : ""} onClick={() => setOpenFaq(openFaq === index ? null : index)}><span>{question}</span><ChevronDown />{openFaq === index && <p>{answer}</p>}</button>)}</div></div>
      </section>

      <section className="bn-cta"><div className="bn-container bn-cta-inner"><div><span className="bn-eyebrow"><Sparkles size={15} /> Tu próxima decisión empieza aquí</span><h2>Conecta con el futuro de los mercados digitales.</h2></div><Link href="/auth?mode=register" className="bn-button bn-button-light">Crear mi cuenta <ArrowRight /></Link></div></section>
      <footer className="bn-footer"><div className="bn-container"><BrandMark /><p>Inteligencia artificial · Mercados financieros · Predicción</p><span>© {new Date().getFullYear()} BitNode</span></div></footer>
    </main>
  );
}

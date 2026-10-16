import { Link } from "wouter";
import { ArrowRight, Bot, CalendarDays, Gift, MessageCircle, FolderOpen, RefreshCcw } from "lucide-react";
import "./landing-updates.css";

export function LandingUpdates() {
  const promotionOpen = Date.now() >= Date.parse("2026-10-16T00:00:00-06:00") && Date.now() < Date.parse("2026-11-26T00:00:00-06:00");
  return <section className="bn-section bn-updates" id="novedades" aria-labelledby="updates-title">
    <div className="bn-container">
      <div className="bn-section-head"><div><span className="bn-section-index">Novedades / Tu backoffice evoluciona</span><h2 id="updates-title">Más herramientas.<br />Más tiempo para ti.</h2></div><p>Conoce SARA IA y las nuevas funciones disponibles dentro de tu cuenta BitNode.</p></div>
      <article className="bn-sara-feature">
        <div className="bn-sara-copy"><span className="bn-update-label"><Bot size={16} /> SARA IA · Automatización de tareas</span><h3>Tus tareas, en automático.</h3><p>SARA IA completa tus cuatro tareas diarias de lunes a viernes mientras tu suscripción esté vigente y tengas un nodo de 21 días activo.</p><div className="bn-sara-price"><strong>25 USDT</strong><span>/ 30 días calendario</span></div><ul><li><CalendarDays size={17} /> Los 30 días incluyen sábados y domingos.</li><li>Pago en USDT mediante NOWPayments y renovación manual.</li><li>Al vencer, vuelves a realizar las tareas manualmente.</li></ul><Link className="bn-button bn-button-primary" href="/dashboard/sara-ia">Conocer SARA IA <ArrowRight size={18} /></Link><small>Requiere iniciar sesión. Automatiza tareas; no garantiza rendimientos ni modifica las reglas de tu nodo.</small></div>
        <div className="bn-sara-portrait"><img src="/sara-ia-official-avatar.png" alt="SARA IA, asistente de BitNode" width={1200} height={1200} loading="lazy" decoding="async" /><span>Tu asistente en BitNode</span></div>
      </article>
      <div className="bn-update-grid">
        <article><MessageCircle /><span>Asistencia</span><h3>SARA IA Soporte</h3><p>Resuelve dudas generales sobre el plan y el uso de la plataforma. Solicita atención del personal cuando necesites ayuda con tu caso.</p><Link href="/dashboard">Entrar y abrir soporte <ArrowRight size={16} /></Link><small>El chat de soporte es distinto de la suscripción para automatizar tareas. Nunca compartas contraseñas ni códigos.</small></article>
        <article><FolderOpen /><span>Recursos oficiales</span><h3>Marketing y materiales</h3><p>Encuentra las imágenes, PDF y presentaciones que publique el equipo. Visualiza y descarga recursos desde tu backoffice.</p><Link href="/dashboard/marketing">Explorar materiales <ArrowRight size={16} /></Link></article>
        <article><RefreshCcw /><span>Capital y continuidad</span><h3>Reinversión desde tu cuenta</h3><p>Crea un nodo nuevo con tu balance disponible. Consulta también la promoción de capital adicional del 5% para reinversiones elegibles al finalizar un ciclo.</p><Link href="/dashboard/nodes">Consultar condiciones <ArrowRight size={16} /></Link><small>No todas las compras con balance reciben el 5%. La reinversión promocional no genera comisión al patrocinador.</small></article>
      </div>
      <article className="bn-latam-feature"><div><span className="bn-update-label"><Gift size={16} /> {promotionOpen ? "Promoción vigente" : "Consulta la vigencia"} · Pre-posicionamiento LATAM</span><h3>Tu esfuerzo te lleva a Cartagena.</h3><p><strong>15,000 USDT de facturación directa elegible:</strong> solo viaje al Bootcamp Cartagena para los primeros 10 socios.</p><p><strong>Desde 10,000 y menos de 15,000 USDT al cierre:</strong> participación en el sorteo de 3 iPhone 18 Pro, uno por ganador. Los premios no se acumulan.</p><small>16 de octubre al 25 de noviembre de 2026, hasta las 23:59:59, America/Mexico_City. Solo inversiones nuevas elegibles y validadas; no reinversiones, bonos binarios ni operaciones canceladas o revertidas. Sorteo y entrega sujetos a verificación final.</small><Link className="bn-button bn-button-ghost" href="/dashboard/promotions">Ver progreso y reglas <ArrowRight size={18} /></Link></div><img src="/promotions/slider-cartagena-v1.webp" alt="Cartagena, destino del Bootcamp BitNode" width={768} height={768} loading="lazy" decoding="async" /></article>
    </div>
  </section>;
}

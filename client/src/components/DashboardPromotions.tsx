import { useEffect, useRef, useState } from "react";
import { Bot, ChevronLeft, ChevronRight, Gift, Image, Pause, Play } from "lucide-react";
import "./dashboard-promotions.css";

const slides = [
  { key: "support", label: "SOPORTE BITNODE", title: "Habla con SARA IA", description: "Resuelve tus dudas o solicita atención humana.", note: "Nunca compartas contraseñas ni códigos.", action: "Abrir chat de soporte", Icon: Bot },
  { key: "sara", label: "TU ASISTENTE INTELIGENTE", title: "SARA IA trabaja por ti", description: "Tus 4 tareas en automático, de lunes a viernes.", note: "25 USD / 30 días calendario · Requiere nodo de 21 días activo", action: "SARA IA", Icon: Bot },
  { key: "reinvestment", label: "PROMOCIÓN DE REINVERSIÓN", title: "Tu próximo ciclo, con +5%", description: "Reinvierte tu capital y recibe un 5% de capital adicional.", note: "La reinversión promocional no genera comisiones para el patrocinador.", action: "Ver promoción", Icon: Gift },
  { key: "marketing", label: "NOVEDADES · BITNODE", title: "Todo para compartir BitNode", description: "Encuentra imágenes, PDF y materiales en un solo lugar.", note: "Explora los recursos disponibles en Marketing y materiales.", action: "Explorar materiales", Icon: Image },
] as const;

export function DashboardPromotions({ onSelect }: { onSelect: (key: "support" | "sara" | "reinvestment" | "marketing") => void }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (paused || interacting || reducedMotion) return;
    const timer = window.setInterval(() => setIndex(value => (value + 1) % slides.length), 7000);
    return () => window.clearInterval(timer);
  }, [paused, interacting, reducedMotion, index]);
  const slide = slides[index];
  const choose = (next: number) => { setIndex((next + slides.length) % slides.length); setPaused(true); };
  return <section className={`dashboard-promotions theme-${slide.key}`} aria-label="Promociones y novedades" aria-roledescription="carrusel"
    onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)}
    onFocusCapture={() => setInteracting(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInteracting(false); }}>
    <div className="promotion-viewport" onTouchStart={event => { touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }} onTouchEnd={event => {
      const start = touchStart.current; touchStart.current = null;
      if (!start) return;
      const dx = event.changedTouches[0].clientX - start.x;
      const dy = event.changedTouches[0].clientY - start.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) choose(index + (dx < 0 ? 1 : -1));
    }}>
      <div className="promotion-track" style={{ transform: `translateX(-${index * 100}%)` }}>
        {slides.map((item, position) => <div key={item.key} className={`promotion-slide ${item.key === "support" ? "promotion-image-slide" : ""}`} role="group" aria-roledescription="diapositiva" aria-label={`${position + 1} de ${slides.length}`} aria-hidden={position !== index} inert={position !== index}>
          {item.key === "support" ? <button className="promotion-image-link" aria-label="Abrir chat de soporte SARA IA" onClick={() => onSelect("support")}>
            <picture><source media="(max-width: 600px)" srcSet="/sara-support-mobile.png" /><img src="/sara-support-desktop.png" alt="¿Necesitas ayuda? Habla con SARA IA. Resuelve tus dudas o solicita atención humana. Abrir chat de soporte. Nunca compartas contraseñas ni códigos." /></picture>
          </button> : <>
            <div className="promotion-copy">
              {item.key === "sara" && <img className="promotion-brand" src="/bitnode-logo.png" alt="BitNode" />}
              <span className="promotion-kicker">{item.label}</span>
              <h2>{item.title}</h2><p>{item.description}</p><small>{item.note}</small>
              <button className="promotion-cta" onClick={() => onSelect(item.key)}>{item.action}<ChevronRight size={18} /></button>
            </div>
            <div className="promotion-art" aria-hidden="true">{item.key === "sara" ? <img src="/sara-ia-official-avatar.png" alt="" /> : <item.Icon strokeWidth={1.2} />}</div>
          </>}
        </div>)}
      </div>
    </div>
    <div className="promotion-controls">
      <span className="promotion-count">0{index + 1} / 0{slides.length}</span>
      <div className="promotion-dots">{slides.map((item, position) => <button key={item.key} aria-label={`Mostrar ${item.action}`} aria-pressed={position === index} onClick={() => choose(position)} />)}</div>
      <div className="promotion-arrows">
        {!reducedMotion && <button aria-label={paused ? "Reanudar promociones" : "Pausar promociones"} onClick={() => setPaused(value => !value)}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>}
        <button aria-label="Promoción anterior" onClick={() => choose(index - 1)}><ChevronLeft size={18} /></button>
        <button aria-label="Promoción siguiente" onClick={() => choose(index + 1)}><ChevronRight size={18} /></button>
      </div>
    </div>
  </section>;
}

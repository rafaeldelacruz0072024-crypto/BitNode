import { useEffect, useState } from "react";
import { Bot, ChevronLeft, ChevronRight, Gift, Image, Pause, Play } from "lucide-react";
import "./dashboard-promotions.css";

const slides = [
  { key: "sara", label: "TU ASISTENTE INTELIGENTE", title: "SARA IA trabaja por ti", description: "Tus 4 tareas en automático, de lunes a viernes.", note: "25 USD / 30 días calendario · Requiere nodo de 21 días activo", action: "SARA IA", Icon: Bot },
  { key: "reinvestment", label: "PROMOCIÓN DE REINVERSIÓN", title: "Tu próximo ciclo, con +5%", description: "Reinvierte tu capital y recibe un 5% de capital adicional.", note: "La reinversión promocional no genera comisiones para el patrocinador.", action: "Ver promoción", Icon: Gift },
  { key: "marketing", label: "NOVEDADES · BITNODE", title: "Todo para compartir BitNode", description: "Encuentra imágenes, PDF y materiales en un solo lugar.", note: "Explora los recursos disponibles en Marketing y materiales.", action: "Explorar materiales", Icon: Image },
] as const;

export function DashboardPromotions({ onSelect }: { onSelect: (key: "sara" | "reinvestment" | "marketing") => void }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
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
    <div className="promotion-slide" role="group" aria-roledescription="diapositiva" aria-label={`${index + 1} de ${slides.length}`}>
      <div className="promotion-copy" aria-live={paused ? "polite" : "off"}>
        <span className="promotion-kicker">{slide.label}</span>
        <h2>{slide.title}</h2><p>{slide.description}</p><small>{slide.note}</small>
        <button className="promotion-cta" onClick={() => onSelect(slide.key)}>{slide.action}<ChevronRight size={18} /></button>
      </div>
      <div className="promotion-art" aria-hidden="true">{slide.key === "sara" ? <img src="/sara-ia-official-avatar.png" alt="" /> : <slide.Icon strokeWidth={1.2} />}</div>
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

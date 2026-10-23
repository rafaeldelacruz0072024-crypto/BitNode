import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, Camera, CheckCircle2, Clock3, Instagram, Megaphone, ShieldCheck, Upload } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import "@/influencers.css";

type Package = { id:string; status:string; price:number; reward_rate:number; weekly_cap:number; reward_cap:number; earned_total:number; verified_views:number; starts_at:string|null; ends_at:string|null };
type Submission = { id:string; platform:string; story_url:string; campaign_code:string; submitted_at:string; status:string; reported_views:number; verified_views:number|null; reward_amount:number; review_note:string|null };
type StatusData = { package:Package|null; submissions:Submission[]; weeklyReward:number; weekStart:string };

async function token() {
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session) throw new Error("Inicia sesión para continuar.");
  return session.access_token;
}

async function api(path:string, init?:RequestInit) {
  const response = await fetch(path, { ...init, headers:{ "Content-Type":"application/json", Authorization:`Bearer ${await token()}`, ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "No se pudo completar la operación.");
  return body;
}

const usd = (value:number) => new Intl.NumberFormat("en-US", { style:"currency", currency:"USD" }).format(value || 0);

const previewData:StatusData={package:{id:"preview",status:"active",price:100,reward_rate:.01,weekly_cap:25,reward_cap:200,earned_total:64.8,verified_views:6480,starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+100*86400000).toISOString()},weeklyReward:18.4,weekStart:"2026-10-19",submissions:[{id:"one",platform:"instagram",story_url:"#",campaign_code:"BITNODE-HOY",submitted_at:new Date().toISOString(),status:"approved",reported_views:860,verified_views:840,reward_amount:8.4,review_note:"Evidencia y métricas verificadas."},{id:"two",platform:"facebook",story_url:"#",campaign_code:"BITNODE-HOY",submitted_at:new Date(Date.now()-3600000).toISOString(),status:"pending",reported_views:610,verified_views:null,reward_amount:0,review_note:null}]};

export function InfluencerSection({preview=false}:{preview?:boolean}) {
  const [data,setData] = useState<StatusData|null>(preview?previewData:null);
  const [loading,setLoading] = useState(!preview);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [platform,setPlatform] = useState("instagram");
  const [storyUrl,setStoryUrl] = useState("");
  const [campaignCode,setCampaignCode] = useState("BITNODE-HOY");
  const [publishedAt,setPublishedAt] = useState(() => new Date(Date.now()-15*60000).toISOString().slice(0,16));
  const [reportedViews,setReportedViews] = useState("0");
  const [file,setFile] = useState<File|null>(null);

  const load = async () => {
    setLoading(true);
    try { setData(await api("/api/influencers/status")); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo cargar el programa."); }
    finally { setLoading(false); }
  };
  useEffect(() => { if(!preview) void load(); }, [preview]);
  const pkg = data?.package;
  const progress = pkg ? Math.min(100, Number(pkg.earned_total)/Number(pkg.reward_cap)*100) : 0;
  const todayCount = useMemo(() => (data?.submissions || []).filter(row => Date.now()-new Date(row.submitted_at).getTime() < 24*3600000).length, [data]);

  async function requestPackage() {
    setBusy(true); setMessage("");
    try { await api("/api/influencers/request", { method:"POST", body:"{}" }); setMessage("Solicitud registrada. Administración verificará el pago y activará el paquete."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo solicitar."); }
    finally { setBusy(false); }
  }

  async function submit(event:FormEvent) {
    event.preventDefault();
    if (!file || !supabase) return setMessage("Adjunta la captura de Insights.");
    setBusy(true); setMessage("");
    try {
      const prepared = await api("/api/influencers/evidence-url", { method:"POST", body:JSON.stringify({ fileName:file.name, mimeType:file.type, size:file.size }) });
      const uploaded = await supabase.storage.from("influencer-evidence").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType:file.type });
      if (uploaded.error) throw uploaded.error;
      await api("/api/influencers/submissions", { method:"POST", body:JSON.stringify({ platform, storyUrl, evidencePath:prepared.path, campaignCode, publishedAt:new Date(publishedAt).toISOString(), reportedViews:Number(reportedViews) }) });
      setStoryUrl(""); setReportedViews("0"); setFile(null); setMessage("Evidencia enviada. Quedó pendiente de auditoría."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo enviar la evidencia."); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="generic-panel"><span className="dash-eyebrow">INFLUENCERS</span><h2>Cargando programa…</h2></div>;
  return <div className="generic-panel influencer-page">
    <div className="influencer-hero">
      <div><span className="dash-eyebrow">BITNODE CREATORS · CONTENIDO AUDITADO</span><h2>Convierte tu alcance en recompensas</h2><p>Publica hasta 3 historias al día, documenta sus Insights antes de que desaparezcan y recibe una recompensa solo por vistas verificadas.</p></div>
      <div className="influencer-orb"><Megaphone size={42}/><span>CREA</span><b>COMPARTE</b></div>
    </div>
    <div className="influencer-rule-strip"><ShieldCheck size={18}/><span>No es una inversión ni garantiza ganancias. Las publicaciones deben indicar claramente <b>“Publicidad”</b> o <b>“Patrocinado”</b>.</span></div>
    {!pkg && <section className="influencer-package-card"><div><span>PAQUETE INFLUENCER</span><strong>100 USDT</strong><p>Vigencia de 120 días · recompensa máxima acumulada de 200 USDT.</p></div><button className="dash-primary" disabled={busy} onClick={requestPackage}>Solicitar activación <ArrowRight size={16}/></button></section>}
    {pkg?.status === "pending" && <section className="influencer-package-card is-pending"><div><span>SOLICITUD RECIBIDA</span><strong>Activación pendiente</strong><p>La administración debe verificar el pago del paquete. No se reciben evidencias hasta entonces.</p></div><Clock3 size={34}/></section>}
    {pkg && pkg.status !== "pending" && <>
      <div className="influencer-stats">
        <article><span>RECOMPENSA ACUMULADA</span><strong>{usd(Number(pkg.earned_total))}</strong><small>de {usd(Number(pkg.reward_cap))}</small></article>
        <article><span>ESTA SEMANA</span><strong>{usd(Number(data?.weeklyReward || 0))}</strong><small>tope {usd(Number(pkg.weekly_cap))}</small></article>
        <article><span>VISTAS VERIFICADAS</span><strong>{Number(pkg.verified_views).toLocaleString("es-419")}</strong><small>{todayCount}/3 evidencias en 24 h</small></article>
      </div>
      <div className="influencer-progress"><div><span>Progreso del paquete</span><b>{progress.toFixed(0)}%</b></div><i><em style={{width:`${progress}%`}}/></i><small>Tarifa vigente: {usd(Number(pkg.reward_rate))} por vista auditada. Los topes prevalecen.</small></div>
      <div className="influencer-workspace">
        <form className="influencer-upload" onSubmit={submit}>
          <div className="section-heading"><div className="feature-icon"><Upload size={18}/></div><div><span>NUEVA EVIDENCIA</span><h3>Registra una historia</h3></div></div>
          <div className="influencer-form-grid"><label>Red social<select value={platform} onChange={e=>setPlatform(e.target.value)}><option value="instagram">Instagram</option><option value="facebook">Facebook</option></select></label><label>Vistas reportadas<input type="number" min="0" value={reportedViews} onChange={e=>setReportedViews(e.target.value)}/></label></div>
          <label>Enlace de la historia<input type="url" required value={storyUrl} onChange={e=>setStoryUrl(e.target.value)} placeholder="https://instagram.com/stories/..."/></label>
          <div className="influencer-form-grid"><label>Código de campaña<input required value={campaignCode} onChange={e=>setCampaignCode(e.target.value)}/></label><label>Fecha y hora de publicación<input type="datetime-local" required value={publishedAt} onChange={e=>setPublishedAt(e.target.value)}/></label></div>
          <label className="influencer-file"><Camera size={22}/><span>{file ? file.name : "Captura de Insights (JPG, PNG, WEBP o PDF · 10 MB)"}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e=>setFile(e.target.files?.[0] || null)}/></label>
          <button className="dash-primary" disabled={busy || todayCount>=3}>{busy ? "Enviando…" : todayCount>=3 ? "Límite diario alcanzado" : "Enviar a auditoría"}</button>
        </form>
        <section className="influencer-history"><div className="section-heading"><div className="feature-icon"><Instagram size={18}/></div><div><span>ÚLTIMOS ENVÍOS</span><h3>Estado de auditoría</h3></div></div>
          {(data?.submissions || []).length===0 ? <p className="empty-copy">Todavía no has enviado evidencias.</p> : data!.submissions.map(row=><article key={row.id} className={`influencer-submission ${row.status}`}><div><b>{row.platform === "instagram" ? "Instagram" : "Facebook"} · {row.campaign_code}</b><small>{new Date(row.submitted_at).toLocaleString("es-419")}</small></div><span>{row.status === "approved" ? <><CheckCircle2 size={14}/> Aprobada</> : row.status === "rejected" ? "Rechazada" : <><Clock3 size={14}/> En revisión</>}</span><strong>{row.status === "approved" ? usd(Number(row.reward_amount)) : `${row.reported_views} vistas reportadas`}</strong>{row.review_note && <small>{row.review_note}</small>}</article>)}
        </section>
      </div>
    </>}
    {message && <div className="form-success" role="status">{message}</div>}
  </div>;
}

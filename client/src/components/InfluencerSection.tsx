import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, Camera, CheckCircle2, Clock3, Copy, Facebook, Info, Instagram, Megaphone, Send, Upload } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import "@/influencers.css";

type Package = { id:string; plan_code?:string; status:string; price:number; reward_rate:number; weekly_cap:number; reward_cap:number; earned_total:number; verified_views:number; starts_at:string|null; ends_at:string|null };
type Plan = { code:string; name:string; price:number; reward_cap:number; weekly_cap:number; reward_rate:number; duration_days:number };
type Submission = { id:string; platform:string; story_url:string; campaign_code:string; submitted_at:string; status:string; reported_views:number; verified_views:number|null; reward_amount:number; review_note:string|null };
type StatusData = { package:Package|null; plans:Plan[]; submissions:Submission[]; weeklyReward:number; weekStart:string };

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

const demoPlans:Plan[]=[{code:"starter",name:"Starter",price:50,reward_cap:100,weekly_cap:20,reward_rate:.01,duration_days:120},{code:"creator",name:"Creator",price:100,reward_cap:200,weekly_cap:40,reward_rate:.01,duration_days:120},{code:"pro",name:"Pro",price:250,reward_cap:500,weekly_cap:100,reward_rate:.01,duration_days:120}];
const previewData:StatusData={package:{id:"preview",plan_code:"creator",status:"active",price:100,reward_rate:.01,weekly_cap:40,reward_cap:200,earned_total:46.8,verified_views:4680,starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+100*86400000).toISOString()},plans:demoPlans,weeklyReward:18.4,weekStart:"2026-10-19",submissions:[{id:"one",platform:"instagram",story_url:"#",campaign_code:"BN-CR827K",submitted_at:new Date().toISOString(),status:"approved",reported_views:892,verified_views:892,reward_amount:8.92,review_note:"Evidencia y métricas verificadas."},{id:"two",platform:"facebook",story_url:"#",campaign_code:"BN-CR827K",submitted_at:new Date(Date.now()-3600000).toISOString(),status:"pending",reported_views:614,verified_views:null,reward_amount:0,review_note:null}]};

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
  const [selectedPlan,setSelectedPlan] = useState("creator");

  const load = async () => {
    setLoading(true);
    try { setData(await api("/api/influencers/status")); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo cargar el programa."); }
    finally { setLoading(false); }
  };
  useEffect(() => { if(!preview) void load(); }, [preview]);
  const pkg = data?.package;
  const progress = pkg ? Math.min(100, Number(pkg.earned_total)/Number(pkg.reward_cap)*100) : 0;
  const campaign = pkg ? `BN-${pkg.id.replace(/-/g,"").slice(0,6).toUpperCase()}` : "";
  useEffect(() => { if(campaign) setCampaignCode(campaign); }, [campaign]);
  const todayCount = useMemo(() => (data?.submissions || []).filter(row => Date.now()-new Date(row.submitted_at).getTime() < 24*3600000).length, [data]);
  const weeklyViews = useMemo(() => (data?.submissions || []).filter(row => new Date(row.submitted_at) >= new Date(`${data?.weekStart || "1970-01-01"}T00:00:00`)).reduce((sum,row)=>sum+Number(row.verified_views || 0),0), [data]);

  async function requestPackage() {
    setBusy(true); setMessage("");
    try { await api("/api/influencers/request", { method:"POST", body:JSON.stringify({planCode:selectedPlan}) }); setMessage("Solicitud registrada. Administración verificará el pago y activará el paquete."); await load(); }
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
    <div className="influencer-titlebar"><div><h2>INFLUENCERS</h2><p>Convierte tu alcance <b>en recompensas</b></p></div>{pkg&&<><button className="campaign-code" onClick={()=>navigator.clipboard.writeText(campaign)}><span>Código de campaña</span><b>{campaign}</b><Copy size={17}/></button><div className="influencer-rate"><Info size={17}/><span>Publicidad / Patrocinado obligatorio<br/><b>{usd(Number(pkg.reward_rate))}</b> por vista verificada</span></div></>}</div>
    {!pkg && <><div className="plan-picker">{(data?.plans?.length?data.plans:demoPlans).map(plan=><button key={plan.code} className={selectedPlan===plan.code?"active":""} onClick={()=>setSelectedPlan(plan.code)}><span>{plan.name}</span><strong>{plan.price} USDT</strong><small>Meta {plan.reward_cap} · semanal {plan.weekly_cap} USDT</small></button>)}</div><section className="influencer-package-card"><div><span>PAQUETE SELECCIONADO</span><strong>{(data?.plans?.find(p=>p.code===selectedPlan)||demoPlans[1]).price} USDT</strong><p>Vigencia de 120 días · la recompensa depende únicamente de vistas verificadas.</p></div><button className="dash-primary" disabled={busy} onClick={requestPackage}>Solicitar activación <ArrowRight size={16}/></button></section></>}
    {pkg?.status === "pending" && <section className="influencer-package-card is-pending"><div><span>SOLICITUD RECIBIDA</span><strong>Activación pendiente</strong><p>La administración debe verificar el pago del paquete. No se reciben evidencias hasta entonces.</p></div><Clock3 size={34}/></section>}
    {pkg && pkg.status !== "pending" && <>
      <div className="influencer-overview"><article className="active-package"><div><span>Paquete activo · {pkg.plan_code || "creator"}</span><strong>{Number(pkg.price)} USDT</strong><small>Meta máxima {Number(pkg.reward_cap)} USDT</small></div><div className="influencer-progress"><i><em style={{width:`${progress}%`}}/></i><b>{progress.toFixed(1)}%</b></div><div className="package-amounts"><span>Ganado <b>{usd(Number(pkg.earned_total))}</b></span><span>Disponible <b>{usd(Math.max(0,Number(pkg.reward_cap)-Number(pkg.earned_total)))}</b></span></div></article><article className="weekly-chart"><div><span>Esta semana <Info size={14}/></span><strong>{weeklyViews.toLocaleString("es-419")}</strong><small>vistas verificadas</small><b>{usd(Number(data?.weeklyReward||0))}</b><small>Máximo semanal {Number(pkg.weekly_cap)} USDT</small></div><svg viewBox="0 0 420 120" role="img" aria-label="Vistas verificadas por día"><path d="M12 96 C70 94 72 80 126 78 S180 46 230 60 S292 82 340 52 S380 32 408 20" fill="none" stroke="#5667ff" strokeWidth="4"/><path d="M12 96 C70 94 72 80 126 78 S180 46 230 60 S292 82 340 52 S380 32 408 20 L408 112 L12 112Z" fill="url(#chartFade)"/><defs><linearGradient id="chartFade" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#743cff" stopOpacity=".5"/><stop offset="1" stopColor="#743cff" stopOpacity="0"/></linearGradient></defs></svg><div className="chart-days"><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span></div></article></div>
      <section className="today-stories"><h3>Historias de hoy <small>{todayCount} / 3</small></h3><div>{[0,1,2].map((slot)=>{const row=data?.submissions?.filter(s=>Date.now()-new Date(s.submitted_at).getTime()<86400000)[slot];return <article key={slot} className={!row?"empty":""}><div className="story-art"><Megaphone size={24}/><b>{row?`Historia ${slot+1}`:"Únete a BitNode"}</b><span>{slot+1}/3</span></div><div><b>{row?`Historia ${slot+1}`:`Historia ${slot+1}`}</b><p>{row?row.platform==="instagram"?"Presentación de BitNode y sus funciones":"Mostrando la plataforma en acción":"Invitación final a la comunidad"}</p><span className={`story-status ${row?.status||"empty"}`}>{row?.status==="approved"?<><CheckCircle2 size={14}/> Aprobada</>:row?<><Clock3 size={14}/> En revisión</>:"Pendiente"}</span><small>{row?.verified_views??row?.reported_views??"—"} vistas verificadas</small><strong>{row?.reward_amount?usd(Number(row.reward_amount)):"— USDT"}</strong></div></article>})}</div></section>
      <div className="influencer-workspace">
        <form className="influencer-upload" onSubmit={submit}>
          <div className="section-heading"><div className="feature-icon"><Upload size={18}/></div><div><span>SUBIR EVIDENCIA</span><h3>Registra una historia</h3></div></div>
          <div className="social-platforms" role="group" aria-label="Red social"><button type="button" className={platform==="instagram"?"active instagram":"instagram"} onClick={()=>setPlatform("instagram")}><Instagram size={17}/> Instagram</button><button type="button" className={platform==="facebook"?"active facebook":"facebook"} onClick={()=>setPlatform("facebook")}><Facebook size={17}/> Facebook</button></div>
          <label>Vistas reportadas<input type="number" min="0" value={reportedViews} onChange={e=>setReportedViews(e.target.value)}/></label>
          <label>Enlace de la historia<input type="url" required value={storyUrl} onChange={e=>setStoryUrl(e.target.value)} placeholder="https://instagram.com/stories/..."/></label>
          <div className="influencer-form-grid"><label>Código de campaña<input required readOnly value={campaignCode}/></label><label>Fecha y hora de publicación<input type="datetime-local" required value={publishedAt} onChange={e=>setPublishedAt(e.target.value)}/></label></div>
          <label className="influencer-file"><Camera size={22}/><span>{file ? file.name : "Captura de Insights (JPG, PNG, WEBP o PDF · 10 MB)"}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e=>setFile(e.target.files?.[0] || null)}/></label>
          <button className="dash-primary influencer-send" disabled={busy || todayCount>=3}>{busy ? "Enviando…" : todayCount>=3 ? "Límite diario alcanzado" : <><Send size={16}/> Enviar a revisión</>}</button>
        </form>
        <section className="influencer-history"><div className="section-heading"><div className="feature-icon"><Instagram size={18}/></div><div><span>ÚLTIMOS ENVÍOS</span><h3>Estado de auditoría</h3></div></div>
          {(data?.submissions || []).length===0 ? <p className="empty-copy">Todavía no has enviado evidencias.</p> : data!.submissions.map(row=><article key={row.id} className={`influencer-submission ${row.status}`}><div><b>{row.platform === "instagram" ? "Instagram" : "Facebook"} · {row.campaign_code}</b><small>{new Date(row.submitted_at).toLocaleString("es-419")}</small></div><span>{row.status === "approved" ? <><CheckCircle2 size={14}/> Aprobada</> : row.status === "rejected" ? "Rechazada" : <><Clock3 size={14}/> En revisión</>}</span><strong>{row.status === "approved" ? usd(Number(row.reward_amount)) : `${row.reported_views} vistas reportadas`}</strong>{row.review_note && <small>{row.review_note}</small>}</article>)}
        </section>
      </div>
    </>}
    {message && <div className="form-success" role="status">{message}</div>}
  </div>;
}

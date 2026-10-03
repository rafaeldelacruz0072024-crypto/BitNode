import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { MATERIAL_CATEGORIES, validateMaterial } from "@/lib/marketingMaterials";
import "@/marketing-materials.css";

type Material = { id: string; title: string; description: string; category: string; file_path: string; file_name: string; mime_type: string; size_bytes: number; published: boolean; created_at: string; url?: string };
const BUCKET = "marketing-materials";
export function MarketingMaterials({ admin = false }: { admin?: boolean }) {
  const [items, setItems] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Todas");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("Flyers");
  const fileInput = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (!supabase) throw new Error("Supabase no está configurado.");
      let query = supabase.from("marketing_materials").select("*").order("created_at", { ascending: false });
      if (!admin) query = query.eq("published", true);
      const { data, error: failure } = await query.limit(100);
      if (failure) throw new Error("No se pudo cargar la biblioteca. Verifica que se haya aplicado el SQL de Marketing y materiales.");
      const rows = await Promise.all((data as Material[]).map(async item => {
        const { data: link } = await supabase!.storage.from(BUCKET).createSignedUrl(item.file_path, 3600);
        return { ...item, url: link?.signedUrl };
      }));
      setItems(rows);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudieron cargar los materiales."); }
    finally { setLoading(false); }
  }, [admin]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function upload(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setNotice("");
    let uploadedPath: string | null = null;
    let saved = false;
    try {
      if (!supabase) throw new Error("Supabase no está configurado.");
      const file = fileInput.current?.files?.[0];
      if (!file) throw new Error("Selecciona un archivo.");
      if (!title.trim()) throw new Error("Escribe un título.");
      const extension = validateMaterial(file);
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Inicia sesión como administrador.");
      const path = `${auth.user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: storageError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (storageError) throw new Error("No se pudo subir el archivo. Verifica tu rol administrador y el bucket de Marketing.");
      uploadedPath = path;
      const { error: metadataError } = await supabase.from("marketing_materials").insert({ title: title.trim(), description: description.trim(), category, file_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size, uploaded_by: auth.user.id });
      if (metadataError) throw new Error("No se pudo registrar el material en la biblioteca.");
      saved = true;
      setTitle(""); setDescription(""); if (fileInput.current) fileInput.current.value = "";
      await refresh(); setNotice("Material publicado. Los usuarios ya pueden verlo y descargarlo.");
    } catch (cause) {
      if (uploadedPath && !saved) await supabase?.storage.from(BUCKET).remove([uploadedPath]);
      setError(cause instanceof Error ? cause.message : "No se pudo publicar el material.");
    } finally { setBusy(false); }
  }
  async function toggle(item: Material) {
    if (!supabase || busy) return;
    setBusy(true); setError("");
    const { error: failure } = await supabase.from("marketing_materials").update({ published: !item.published }).eq("id", item.id).select("id").single();
    if (failure) setError("No se pudo cambiar la publicación del material.");
    else { await refresh(); setNotice(item.published ? "Material oculto; el archivo se conserva." : "Material publicado."); }
    setBusy(false);
  }
  const visible = items.filter(item => (filter === "Todas" || item.category === filter) && `${item.title} ${item.description} ${item.file_name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="marketing-library">
    <header><h2>Marketing y materiales</h2><p>{admin ? "Publica recursos para tu comunidad. Tu usuario queda registrado como autor de cada carga." : "Imágenes, presentaciones y recursos oficiales de BitNode para compartir."}</p></header>
    {admin && <form onSubmit={upload} className="marketing-upload">
      <label>Título<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label>Categoría<select value={category} onChange={e => setCategory(e.target.value)}>{MATERIAL_CATEGORIES.map(name => <option key={name}>{name}</option>)}</select></label>
      <label className="marketing-wide">Descripción<textarea maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <label className="marketing-wide">Archivo · máximo 20 MB<input ref={fileInput} type="file" required accept=".jpg,.jpeg,.png,.webp,.pdf,.pptx,.docx,.zip,.mp4" /></label>
      <button disabled={busy} type="submit">{busy ? "Procesando…" : "Subir y publicar material"}</button>
      <small>JPG, PNG, WEBP, PDF, PPTX, DOCX, ZIP o MP4. No se permiten archivos ejecutables.</small>
    </form>}
    <div className="marketing-filters"><label>Buscar<input placeholder="Título o descripción" value={search} onChange={e => setSearch(e.target.value)} /></label><label>Categoría<select value={filter} onChange={e => setFilter(e.target.value)}>{["Todas", ...MATERIAL_CATEGORIES].map(name => <option key={name}>{name}</option>)}</select></label><button onClick={() => void refresh()} disabled={loading || busy}>Actualizar</button></div>
    {error && <p className="marketing-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading ? <p>Cargando materiales…</p> : !error && visible.length === 0 ? <p>No hay materiales para estos filtros.</p> : null}
    <div className="marketing-grid">{visible.map(item => <article key={item.id}>
      {item.mime_type.startsWith("image/") && item.url ? <img src={item.url} alt={item.title} loading="lazy" /> : <div className="marketing-file-icon">{item.file_name.split(".").pop()?.toUpperCase()}</div>}
      <span>{item.category}{!item.published ? " · Oculto" : ""}</span><h3>{item.title}</h3><p>{item.description}</p><small>{item.file_name} · {(item.size_bytes / 1048576).toFixed(2)} MB</small>
      <div className="marketing-actions">{item.url ? <><a href={item.url} target="_blank" rel="noopener noreferrer">Ver archivo</a><button onClick={async () => {
        const { data, error: failure } = await supabase!.storage.from(BUCKET).createSignedUrl(item.file_path, 60, { download: item.file_name });
        if (failure || !data) setError("No se pudo descargar el archivo. Actualiza la biblioteca.");
        else window.location.assign(data.signedUrl);
      }}>Descargar</button></> : <small>Archivo no disponible. Actualiza la biblioteca.</small>}{admin && <button disabled={busy} onClick={() => void toggle(item)}>{item.published ? "Ocultar" : "Publicar"}</button>}</div>
    </article>)}</div>
  </section>;
}

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import "./promotions-section.css";

type Snapshot = {
  rulesVersion: "latam-trip-raffle-v2";
  total: number;
  raffleEligible: boolean;
  raffleParticipantCount: number;
  raffleDrawStatus: "pending";
  raffleParticipants: { userId: string; username: string; total: number }[];
  winners: { position: number; username: string; qualifiedAt: string }[];
  validations: {
    id: string;
    contract_id: string;
    deposit_id: string;
    amount: number;
    revoked_at: string | null;
  }[];
};
const format = (value: number) =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 }).format(value);
async function request(path: string, body?: object) {
  if (!supabase)
    throw new Error("Supabase no está configurado. Progreso no disponible.");
  const { data } = await supabase!.auth.getSession();
  if (!data.session)
    throw new Error("Inicia sesión para consultar la promoción.");
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "No se pudo consultar la promoción.");
  return result;
}

export function PromotionsSection({ admin = false }: { admin?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await request(
        `/api/promotions/latam${admin ? "?admin=1" : ""}`
      );
      if (result.rulesVersion !== "latam-trip-raffle-v2") {
        throw new Error(
          "La configuración actualizada de premios todavía no está disponible. Intenta actualizar de nuevo."
        );
      }
      setSnapshot(result);
    } catch (cause) {
      setSnapshot(null);
      setError(
        cause instanceof Error ? cause.message : "Progreso no disponible."
      );
    } finally {
      setLoading(false);
    }
  }, [admin]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(Date.now());
      void refresh();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const phase =
    clock < Date.parse("2026-10-16T06:00:00Z")
      ? "Comienza el 16 de octubre"
      : clock < Date.parse("2026-11-26T06:00:00Z")
        ? "Promoción en curso"
        : "Período de facturación finalizado";
  async function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/api/admin/promotions/latam/validate", {
        contractId: String(data.get("contractId")).trim(),
        depositId: String(data.get("depositId")).trim(),
        amount: Number(data.get("amount")),
        reason: String(data.get("reason")),
        realSale: data.get("realSale") === "on",
        revoke: data.get("action") === "revoke",
      });
      form.reset();
      await refresh();
      setNotice(
        "Operación registrada con trazabilidad administrativa. No se modificó ningún balance."
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="latam-promotions">
      <header className="latam-hero">
        <div>
          <img
            className="latam-logo"
            src="/promotions/bitnode-official.png"
            alt="BitNode"
          />
          <p className="latam-eyebrow">
            PROMOCIONES Y NOVEDADES · CUPO LIMITADO
          </p>
          <h2>
            Pre-posicionamiento <span>LATAM</span>
          </h2>
          <p>BitNode recompensa tu esfuerzo.</p>
          <div className="latam-tags">
            <span>{phase}</span>
            <span>10 socios · Meta: 15,000 USDT</span>
          </div>
          <p className="latam-date">
            16 de octubre — 25 de noviembre de 2026
            <br />
            Cierre: 23:59:59 · Hora de Ciudad de México
          </p>
        </div>
        <div className="latam-trip">
          <span>DESTINO DE TU PRÓXIMO LOGRO</span>
          <strong>CARTAGENA</strong>
          <p>Viaje · Bootcamp</p>
          <small>Los 10 primeros socios que cumplan la meta.</small>
        </div>
      </header>
      <div className="latam-rewards">
        <article className="latam-phone">
          <div>
            <p className="latam-eyebrow">SORTEO · 3 EQUIPOS</p>
            <h3>
              iPhone 18 Pro
              <br />
              <span>Desde 10,000 y menos de 15,000 USDT</span>
            </h3>
            <p>
              Quienes al cierre alcancen 10,000 USDT de facturación directa
              elegible y no lleguen a 15,000 participan en el sorteo de tres
              iPhone 18 Pro: uno por ganador. No es un premio automático.
            </p>
          </div>
          <img
            src="/promotions/iphone-reference.png"
            alt="Imagen de referencia de los teléfonos; modelo y apariencia final sujetos a disponibilidad"
          />
          <small>
            Imagen proporcionada como referencia; no representa una
            especificación oficial del modelo.
          </small>
        </article>
        <article>
          <p className="latam-eyebrow">PRIMEROS 10 SOCIOS · SOLO VIAJE</p>
          <h3>
            Tu lugar en el
            <br />
            <span>Bootcamp Cartagena</span>
          </h3>
          <p>
            Los primeros 10 socios que alcancen{" "}
            <strong>15,000 USDT de facturación directa elegible</strong>{" "}
            obtienen solo el viaje. Al alcanzar esta meta ya no participan en el
            sorteo de iPhone.
          </p>
          <div className="latam-ticket">
            10{" "}
            <span>
              VIAJES
              <br />
              PARA LOS PRIMEROS EN CUMPLIR LA META
            </span>
          </div>
        </article>
      </div>
      <article className="latam-progress">
        <div>
          <h3>Tu progreso</h3>
          <button onClick={() => void refresh()} disabled={loading || busy}>
            {loading ? "Actualizando…" : "Actualizar progreso"}
          </button>
        </div>
        {snapshot && !error ? (
          <>
            <strong>
              {format(Number(snapshot.total))} <small>/ 15,000 USDT</small>
            </strong>
            <progress
              aria-label="Facturación directa validada"
              max={15000}
              value={Math.min(Number(snapshot.total), 15000)}
            />
            <p>
              {Number(snapshot.total) >= 15000
                ? "Meta alcanzada. Consulta la clasificación provisional."
                : `Faltan ${format(Math.max(15000 - Number(snapshot.total), 0))} USDT de facturación validada.`}
            </p>
          </>
        ) : (
          <p>
            {loading
              ? "Consultando facturación validada…"
              : "El progreso no está disponible; no se mostrarán cifras sin verificar."}
          </p>
        )}
      </article>
      {error && (
        <p className="latam-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <article className="latam-progress">
        <h3>Tu participación en el sorteo de iPhone</h3>
        <p>
          Tres iPhone 18 Pro, uno por ganador, entre quienes terminen la
          promoción con 10,000 a menos de 15,000 USDT de facturación directa
          elegible.
        </p>
        {snapshot && !error ? (
          <>
            <progress
              aria-label="Progreso hacia el mínimo del sorteo"
              max={10000}
              value={Math.min(Number(snapshot.total), 10000)}
            />
            <p>
              {snapshot.raffleEligible
                ? "Cumples provisionalmente el rango del sorteo. Si alcanzas 15,000 USDT, dejas de participar y compites por uno de los 10 viajes."
                : Number(snapshot.total) >= 15000
                  ? "Alcanzaste 15,000 USDT: solo clasificas para el viaje según los cupos disponibles; no participas en el sorteo."
                  : `Faltan ${format(Math.max(10000 - Number(snapshot.total), 0))} USDT para alcanzar el mínimo del sorteo.`}
            </p>
            <p>
              Participantes provisionales:{" "}
              <strong>{format(snapshot.raffleParticipantCount)}</strong>.
            </p>
          </>
        ) : (
          <p>
            Participación pendiente de consulta; no se muestran datos sin
            verificar.
          </p>
        )}
        <p>
          El sorteo está pendiente de realizarse después del cierre y la
          verificación final de los participantes. La elegibilidad se recalcula
          si cambia o se revoca una venta.
        </p>
      </article>
      <article>
        <p className="latam-eyebrow">COMPETENCIA INTERNA</p>
        <h3>Los 10 lugares para el viaje a Cartagena</h3>
        <p>
          Orden por momento de alcanzar la meta con ventas validadas.
          Clasificación provisional: una revocación puede cambiar los lugares.
        </p>
        <ol className="latam-slots">
          {Array.from({ length: 10 }, (_, i) => {
            const winner = snapshot?.winners.find(
              item => item.position === i + 1
            );
            return (
              <li key={i}>
                <span className="latam-position">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>
                    {winner?.username ||
                      (snapshot ? "Lugar disponible" : "Pendiente de consulta")}
                  </strong>
                  <small>Solo viaje Bootcamp Cartagena</small>
                </div>
                <span>{winner ? "META CUMPLIDA" : "15,000 USDT"}</span>
              </li>
            );
          })}
        </ol>
      </article>
      <article className="latam-rules">
        <h3>Condiciones de la promoción</h3>
        <p>
          Acumula{" "}
          <strong>
            15,000 USDT en inversiones nuevas de tus referidos directos
          </strong>{" "}
          durante la promoción.
        </p>
        <p>Participan inversiones pagadas con crypto confirmado.</p>
        <p>
          No cuentan reinversiones, bonos binarios ni operaciones canceladas o
          revertidas.
        </p>
        <p>
          Tu progreso se actualizará después de validar las inversiones
          elegibles.
        </p>
        <p>
          <strong>Viaje:</strong> los primeros 10 socios que alcancen 15,000
          USDT de facturación directa elegible reciben solo el viaje al Bootcamp
          Cartagena.
        </p>
        <p>
          <strong>Sorteo:</strong> quienes al cierre lleguen a 10,000 USDT y no
          alcancen 15,000 USDT participan por tres iPhone 18 Pro, uno por
          ganador.
        </p>
        <p>
          Al alcanzar 15,000 USDT se deja de participar en el sorteo de iPhone.
          No se acumulan ambos premios.
        </p>
        <p>
          Vigencia:{" "}
          <strong>del 16 de octubre al 25 de noviembre de 2026</strong>, hasta
          las 11:59:59 p. m., hora de Ciudad de México.
        </p>
        <p>
          Cupo limitado a <strong>10 viajes</strong> y{" "}
          <strong>3 iPhone 18 Pro por sorteo</strong>.
        </p>
        <p>
          La clasificación y entrega de premios están sujetas a verificación
          final.
        </p>
      </article>
      {admin && (
        <article>
          <h3>Participantes provisionales del sorteo</h3>
          <p>
            Rango: desde 10,000 y menos de 15,000 USDT. La lista cambia con las
            validaciones y revocaciones; no representa ganadores.
          </p>
          <div className="latam-history">
            {snapshot?.raffleParticipants.map(item => (
              <p key={item.userId}>
                <strong>{item.username}</strong> · {format(Number(item.total))}{" "}
                USDT
              </p>
            ))}
          </div>
          {snapshot?.raffleParticipants.length === 0 && (
            <p>No hay participantes elegibles registrados.</p>
          )}
          <p>
            Sorteo pendiente. No se han seleccionado ni asignado ganadores de
            iPhone.
          </p>
        </article>
      )}
      {admin && (
        <article>
          <h3>Validar una venta real</h3>
          <p>
            Revisa el nodo y su depósito en Activaciones y Transacciones.
            Confirma que son fondos nuevos realmente cobrados, no saldo de
            rendimientos ni bonos. Puedes distribuir un depósito entre nodos sin
            exceder su importe.
          </p>
          <form className="latam-admin" onSubmit={validate}>
            <label>
              ID del nodo
              <input
                name="contractId"
                required
                maxLength={160}
                placeholder="NODE-…"
              />
            </label>
            <label>
              ID del depósito confirmado
              <input
                name="depositId"
                required
                maxLength={160}
                placeholder="NP-… o ADMIN-…"
              />
            </label>
            <label>
              Importe elegible (USDT)
              <input
                name="amount"
                type="number"
                required
                min="0.01"
                step="0.01"
              />
            </label>
            <label>
              Operación
              <select name="action">
                <option value="validate">Validar facturación</option>
                <option value="revoke">Revocar validación</option>
              </select>
            </label>
            <label className="latam-wide">
              Evidencia / motivo
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={500}
                placeholder="Referencia del pago real y revisión del origen de fondos"
              />
            </label>
            <label className="latam-wide latam-check">
              <input name="realSale" type="checkbox" required /> Confirmo la
              revisión: activación real elegible para promoción (o su revocación
              justificada).
            </label>
            <button disabled={busy || loading} type="submit">
              {busy ? "Guardando…" : "Guardar validación auditada"}
            </button>
          </form>
          <h3>Historial de validaciones</h3>
          <div className="latam-history">
            {snapshot?.validations.map(item => (
              <p key={item.id}>
                <strong>{item.contract_id}</strong> · {item.deposit_id} ·{" "}
                {format(Number(item.amount))} USDT ·{" "}
                {item.revoked_at
                  ? "Revocada"
                  : "Registrada (sujeta al estado de la operación)"}
              </p>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}

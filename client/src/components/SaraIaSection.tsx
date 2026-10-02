import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Copy,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import "@/sara-ia.css";

const SARA_LAUNCH_AT = Date.parse("2026-10-05T00:00:00-04:00");

type SaraStatus = {
  launched: boolean;
  launchAt: string;
  active: boolean;
  subscriptionPaid: boolean;
  paidThroughAt: string | null;
  hasActive21DayNode: boolean;
  payments: Array<{
    order_id: string;
    status: string;
    provider_status: string;
    pay_currency: string;
    created_at: string;
    completed_at: string | null;
  }>;
};
type PaymentDetails = {
  orderId: string;
  payAddress: string;
  payAmount: string;
  payCurrency: string;
};

async function authHeaders() {
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session?.access_token)
    throw new Error("Inicia sesión para gestionar SARA IA.");
  return {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

export function SaraIaSection() {
  const [launchTimeReached, setLaunchTimeReached] = useState(() => Date.now() >= SARA_LAUNCH_AT);
  const [status, setStatus] = useState<SaraStatus | null>(null);
  const [payCurrency, setPayCurrency] = useState("usdtbsc");
  const [payment, setPayment] = useState<PaymentDetails | null>(null);
  const [qrData, setQrData] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/sara-ia/status", { headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          String(payload.error || "No se pudo consultar SARA IA.")
        );
      setStatus(payload as SaraStatus);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No se pudo consultar SARA IA."
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setLaunchTimeReached(Date.now() >= SARA_LAUNCH_AT);
      void refresh();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!payment) {
      setQrData("");
      return;
    }
    void QRCode.toDataURL(payment.payAddress, {
      width: 220,
      margin: 1,
      color: { dark: "#dff7ff", light: "#071225" },
    }).then(setQrData);
  }, [payment]);

  async function createPayment() {
    if (Date.now() < SARA_LAUNCH_AT || !status?.launched || !status?.hasActive21DayNode || busy) return;
    setBusy(true);
    setError("");
    setPayment(null);
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/payments/nowpayments/sara-ia", {
        method: "POST",
        headers,
        body: JSON.stringify({ payCurrency }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(String(payload.error || "No se pudo generar el pago."));
      setPayment(payload as PaymentDetails);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No se pudo generar el pago."
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyAddress() {
    if (!payment) return;
    await navigator.clipboard.writeText(payment.payAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const isActive = Boolean(status?.active);
  const latestPayment = status?.payments?.[0];

  return (
    <main className="sara-page">
      <section className="sara-hero">
        <div className="sara-copy">
          <div className="sara-badge">
            <span /> ASISTENTE DE TAREAS BITNODE
          </div>
          <h1>
            SARA <span>IA</span>
          </h1>
          <h2>Las cuatro tareas de tus nodos, de lunes a viernes.</h2>
          <p>
            SARA IA completa automáticamente las tareas diarias mientras tu
            suscripción esté pagada y tengas un nodo de 21 días activo. Se
            aplica el mismo ciclo y las mismas reglas del sistema.
          </p>
          <div className="sara-points">
            <span>
              <CalendarDays /> Lunes a viernes
            </span>
            <span>
              <CheckCircle2 /> 4 tareas diarias
            </span>
            <span>
              <ShieldCheck /> Respeta el ciclo vigente
            </span>
          </div>
        </div>
        <div className="sara-avatar-wrap">
          <img
            src="/sara-ia-avatar.png"
            alt="Avatar de SARA IA, asistente BitNode"
          />
        </div>
      </section>

      <section className="sara-grid">
        <article className="sara-card sara-plan">
          <div className="sara-card-heading">
            <WalletCards />
            <h3>Plan mensual</h3>
          </div>
          <div className="sara-price">
            $25 <small>USD / mes</small>
          </div>
          <div className={`sara-state ${isActive ? "is-active" : ""}`}>
            <span />
            {isActive
              ? "SARA IA activa"
              : status?.subscriptionPaid
                ? "Servicio suspendido · requiere nodo de 21 días"
                : "No activa"}
          </div>
          {status?.subscriptionPaid && status?.paidThroughAt && (
            <p className="sara-expiry">
              Vigente hasta{" "}
              {new Date(status.paidThroughAt).toLocaleString("es-DO", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          )}
          {status && !status.hasActive21DayNode && (
            <p className="sara-warning">
              Regla de oro: SARA IA está disponible únicamente con un nodo de 21
              días activo. Si ese nodo termina o se desactiva, SARA suspende las
              tareas hasta que tengas otro nodo de 21 días activo.
            </p>
          )}
          {!launchTimeReached && <p id="sara-launch-notice" className="sara-warning">Disponible el lunes 5 de octubre de 2026 a las 12:00 a. m., hora de Santo Domingo. La compra permanece desactivada hasta entonces.</p>}
          {(
            <>
              <label className="sara-field-label" htmlFor="sara-network">
                Red de pago USDT
              </label>
              <select
                id="sara-network"
                className="sara-select"
                value={payCurrency}
                disabled={!launchTimeReached || busy}
                onChange={event => setPayCurrency(event.target.value)}
              >
                <option value="usdtbsc">USDT · BEP20</option>
                <option value="usdttrc20">USDT · TRC20</option>
              </select>
              <button
                className="sara-primary"
                type="button"
                disabled={!launchTimeReached || busy || !status?.hasActive21DayNode || !status?.launched}
                aria-describedby={!launchTimeReached ? "sara-launch-notice" : undefined}
                onClick={() => void createPayment()}
              >
                {busy ? <LoaderCircle className="sara-spin" /> : <Sparkles />}
                {!launchTimeReached ? "Comprar SARA IA · Disponible el lunes" : busy ? "Preparando pago…" : status?.subscriptionPaid ? "Renovar SARA IA · $25/mes" : "Comprar SARA IA · $25/mes"}
              </button>
            </>
          )}
          {isActive && (
            <p className="sara-manual-renew">
              <Clock3 /> Renovación manual mensual con USDT por NOWPayments.
            </p>
          )}
          <p className="sara-note">
            La cuota paga el servicio de automatización y no es un depósito ni
            una garantía de rendimiento.
          </p>
        </article>

        <article className="sara-card sara-tasks">
          <div className="sara-card-heading">
            <Bot />
            <h3>Tareas gestionadas</h3>
            <span className="sara-weekdays">LUN–VIE</span>
          </div>
          {[
            ["Sincronizar nodo", "sync_node"],
            ["Validar bloque", "validate_block"],
            ["Auditar mempool", "audit_mempool"],
            ["Firmar checkpoint", "sign_checkpoint"],
          ].map(([label, key], index) => (
            <div className="sara-task-row" key={key}>
              <span className="sara-task-number">0{index + 1}</span>
              <div>
                <strong>{label}</strong>
                <small>Se registra en el ciclo de tareas existente</small>
              </div>
              <CheckCircle2 />
            </div>
          ))}
          {latestPayment && (
            <div className="sara-last-payment">
              Último pago:{" "}
              {latestPayment.status === "completed"
                ? "confirmado"
                : latestPayment.status === "pending"
                  ? "pendiente"
                  : latestPayment.status}
            </div>
          )}
        </article>
      </section>

      {payment && (
        <section className="sara-card sara-payment" aria-live="polite">
          <div>
            <span className="sara-eyebrow">PAGO MANUAL · NOWPAYMENTS</span>
            <h3>
              Envía exactamente {payment.payAmount}{" "}
              {payment.payCurrency.toUpperCase()}
            </h3>
            <p>
              Confirma que tu billetera use la red{" "}
              {payment.payCurrency === "usdtbsc" ? "BEP20" : "TRC20"}. La
              suscripción se activa al confirmarse el pago.
            </p>
          </div>
          {qrData && (
            <img
              className="sara-qr"
              src={qrData}
              alt="Código QR de la dirección de pago SARA IA"
            />
          )}
          <div className="sara-address">
            <code>{payment.payAddress}</code>
            <button type="button" onClick={() => void copyAddress()}>
              <Copy />
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
          <small>
            Orden {payment.orderId} · No envíes fondos desde otra red o token.
          </small>
        </section>
      )}

      {error && (
        <p className="sara-error" role="alert">
          {error}
        </p>
      )}
      <p className="sara-footnote">
        La primera tarea continúa sujeta a la espera inicial de 24 horas. Si el
        ciclo no está disponible o no hay nodo de 21 días activo, SARA IA no
        ejecutará tareas fuera de las reglas vigentes.
      </p>
    </main>
  );
}

/**
 * BitNode dashboard local: misma consola nocturna de la referencia, con estado
 * persistente en localStorage y adaptadores listos para backend posterior.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { NodeCycleProvider, NodeCycleProgress } from "@/components/NodeCycleProgress";
import MarketPredictions from "@/components/MarketPredictions";
import { useCycleNotifications } from "@/components/CycleNotifications";
import { Link, useLocation } from "wouter";
import {
  Activity,
  ArrowRight,
  Box,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Copy,
  Gem,
  Home,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { BinaryTree } from "@/components/BinaryTree";
import {
  Contract,
  LocalUserState,
  loadLocalUser,
  money,
  newId,
  saveLocalUser,
} from "@/lib/localUserStore";
import {
  fetchAccountSummary,
  fetchWithdrawalAvailability,
  type WithdrawalAvailability,
} from "@/lib/supabaseAdapter";
import { displayAuthName, supabase } from "@/lib/supabaseClient";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { createNowPaymentsPayment } from "@/lib/nowpaymentsClient";
import { requestWithdrawal } from "@/lib/withdrawalClient";
import "@/task-interactions.css";
import "@/dashboard-visual.css";
import { WITHDRAW_FEE_RATE, withdrawalFee } from "@shared/withdrawalFee";
import { depositCashback } from "@shared/depositCashback";
import {
  emptyPrivateUserDetails,
  fetchPrivateUserDetails,
  savePrivateUserDetails,
  saveWithdrawalWallet,
  type PrivateUserDetails,
} from "@/lib/profileClient";
import {
  activateContractAndCommissions,
  completeDailyTask,
  fetchDailyTaskProgress,
  fetchCommissionSummary,
  fetchNetworkSummary,
  withdrawDailyNodeCapital,
  type CommissionSummary,
  type DailyNodeReward,
  type NetworkSummary,
} from "@/lib/commissionsClient";

const DAILY_TASKS = [
  ["sync_node", "Sincronizar nodo", "Conecta con los peers de la red."],
  ["validate_block", "Validar bloque", "Verifica hash, firmas y merkle root."],
  ["audit_mempool", "Auditar mempool", "Revisa transacciones pendientes."],
  ["sign_checkpoint", "Firmar checkpoint", "Confirma tu participación diaria."],
] as const;

const CASHBACK_PROMO_SESSION_KEY = "bitnode:cashback-promo-seen";

function binaryReferralUrl(code: string, side: "izquierda" | "derecha") {
  const configuredUrl = import.meta.env.VITE_APP_URL as string | undefined;
  const origin =
    configuredUrl ||
    (typeof window !== "undefined" && window.location.hostname === "localhost"
      ? window.location.origin
      : "https://bit-node.vercel.app");
  return `${origin.replace(/\/$/, "")}/r/${encodeURIComponent(code)}/${side}`;
}

function DailyTasksPanel({
  user,
  onRewards,
}: {
  user: LocalUserState;
  onRewards: (
    rewards: DailyNodeReward[],
    fallback?: { amount: number; transactionId?: string }
  ) => void;
}) {
  const [completed, setCompleted] = useState<string[]>([]);
  const [cycleDay, setCycleDay] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deadline, setDeadline] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState("Listo para iniciar");
  const [nodeRewards, setNodeRewards] = useState<DailyNodeReward[]>([]);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [cycleCelebration, setCycleCelebration] = useState(false);
  const [tasksAvailable, setTasksAvailable] = useState(true);
  const [tasksAvailableAt, setTasksAvailableAt] = useState<number | null>(null);
  const hasActiveContracts = user.contracts.some(
    contract => contract.status === "active"
  );

  useEffect(() => {
    if (!hasActiveContracts) {
      setCompleted([]);
      setCycleDay(0);
      setDeadline(null);
      return;
    }
    fetchDailyTaskProgress()
      .then(async progress => {
        if (!progress) return;
        const authUser = (await supabase?.auth.getUser())?.data.user;
        const firstNodeAt = progress.first_node_purchased_at || progress.registered_at || null;
        const fallbackAvailableAt = firstNodeAt
          ? new Date(new Date(firstNodeAt).getTime() + 24 * 60 * 60 * 1000)
          : null;
        const availableAt = progress.tasks_available_at
          ? new Date(progress.tasks_available_at)
          : fallbackAvailableAt;
        const available = progress.tasks_available === false
          ? false
          : availableAt
            ? Date.now() >= availableAt.getTime()
            : true;
        setCompleted(progress.completed_tasks || []);
        setCycleDay(progress.cycle_day || 0);
        setTasksAvailable(available);
        setTasksAvailableAt(
          availableAt && !available
            ? availableAt.getTime()
            : null
        );
        setDeadline(
          progress.deadline_at
            ? new Date(progress.deadline_at).getTime()
            : null
        );
        if (progress.cycle_reset) {
          setMessage(
            "El plazo de 24 horas venció y se reinició el progreso del ciclo. El ROI ya acreditado permanece en tu historial y balance; el capital sigue bloqueado hasta completar el plazo."
          );
        }
      })
      .catch(() => undefined);
  }, [hasActiveContracts]);

  useEffect(() => {
    const tick = () => {
      const target = !tasksAvailable && tasksAvailableAt ? tasksAvailableAt : deadline;
      if (!target) return setTimeLeft("Listo para iniciar");
      const remaining = Math.max(0, target - Date.now());
      if (remaining === 0) {
        if (!tasksAvailable && tasksAvailableAt) {
          setTasksAvailable(true);
          setTimeLeft("00:00:00");
        } else {
          setTimeLeft("Ciclo vencido");
        }
        return;
      }
      const totalSeconds = Math.floor(remaining / 1000);
      const hours = Math.floor(totalSeconds / 3600)
        .toString()
        .padStart(2, "0");
      const minutes = Math.floor((totalSeconds % 3600) / 60)
        .toString()
        .padStart(2, "0");
      const seconds = (totalSeconds % 60).toString().padStart(2, "0");
      setTimeLeft(`${hours}:${minutes}:${seconds}`);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [deadline, tasksAvailable, tasksAvailableAt]);

  useEffect(() => {
    if (!cycleCelebration) return;
    const timeout = window.setTimeout(() => setCycleCelebration(false), 4200);
    return () => window.clearTimeout(timeout);
  }, [cycleCelebration]);

  async function complete(taskKey: string) {
    if (!tasksAvailable) {
      setMessage("Las tareas se habilitan 24 horas después del registro de la cuenta.");
      return;
    }
    setBusy(taskKey);
    setLastAction(taskKey);
    setMessage("");
    try {
      const result = await completeDailyTask(taskKey);
      setCompleted(current =>
        Array.from(new Set([...(result.completed_tasks || current), taskKey]))
      );
      setCycleDay(result.cycle_day || 0);
      setDeadline(
        result.deadline_at ? new Date(result.deadline_at).getTime() : null
      );
      if (result.status === "credited") {
        setCycleCelebration(true);
        const rewards = Array.isArray(result.rewards) ? result.rewards : [];
        setNodeRewards(rewards);
        // Refresca el balance desde el ledger para mostrar solo ROI acreditado.
        onRewards([], undefined);
        const available = Number(result.available_reward || 0);
        const pending = Number(result.pending_reward || 0);
        const principal = Number(result.principal_returned || 0);
        setMessage(
          available || principal
            ? `Acreditado al balance: ${money(available + principal)}. ${pending ? `${money(pending)} queda pendiente.` : "El capital se libera al completar el plazo del nodo; el ROI se retira los miércoles si alcanza el mínimo."}`
            : pending
              ? `${money(pending)} queda pendiente. El capital sigue bloqueado hasta completar el plazo del nodo.`
              : "Tareas registradas. Hoy no hay liquidación por no ser día laborable."
        );
      } else if (result.status === "already_completed") {
        setMessage("Esta tarea ya fue realizada durante el período actual.");
      } else {
        setMessage(`Tarea completada. Faltan ${result.remaining_tasks ?? 0}.`);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo completar la tarea."
      );
    } finally {
      setBusy(null);
    }
  }

  if (!hasActiveContracts)
    return (
      <div className="generic-panel">
        <span className="dash-eyebrow">TAREAS DIARIAS</span>
        <h2>Activa un nodo primero</h2>
        <p>
          Necesitas un contrato activo para realizar las cuatro tareas y recibir
          el pasivo.
        </p>
      </div>
    );

  if (!tasksAvailable && tasksAvailableAt)
    return (
      <div className="generic-panel tasks-locked-panel">
        <span className="dash-eyebrow">REGLA DE ORO · PERÍODO DE ESPERA</span>
        <h2>Tareas disponibles en</h2>
        <strong className="task-unlock-clock">{timeLeft}</strong>
        <p>
          Tus tareas se habilitan 24 horas después de tu primera compra de nodo: {new Date(tasksAvailableAt).toLocaleString("es-DO")}.
        </p>
        <div className="task-unlock-orbit" aria-hidden="true"><Clock3 size={28} /></div>
      </div>
    );

  return (
    <div className="generic-panel">
      {cycleCelebration && (
        <div className="task-celebration" role="status" aria-live="polite">
          <span className="task-celebration-orbit task-celebration-orbit-a" />
          <span className="task-celebration-orbit task-celebration-orbit-b" />
          <Sparkles size={22} aria-hidden="true" />
          <div>
            <strong>Jornada completada</strong>
            <span>Las 4 tareas fueron verificadas.</span>
          </div>
        </div>
      )}
      <span className="dash-eyebrow">ACTIVACIÓN DIARIA · DÍA {cycleDay}</span>
      <h2>Activa tu nodo hoy</h2>
      <p>
        Completa las cuatro tareas una vez cada 24 horas. La primera inicia el
        contador y la cuarta acredita automáticamente el pasivo variable del
        ciclo.
      </p>
      <div className="dash-card" style={{ marginBottom: 18 }}>
        <div className="task-cycle-head">
          <span className="dash-eyebrow">TIEMPO RESTANTE DEL CICLO</span>
          <span className="task-cycle-count" aria-live="polite">
            {completed.length}/4 TAREAS
          </span>
        </div>
        <strong className="task-clock">{timeLeft}</strong>
        <div className="task-progress" aria-label={`${completed.length} de 4 tareas completadas`}>
          <span style={{ width: `${completed.length * 25}%` }} />
        </div>
        <p>
          Si llega a cero sin completar las cuatro tareas, el progreso y los
          días vuelven a cero. Tu capital permanece intacto.
        </p>
      </div>
      <div className="local-plan-grid">
        {DAILY_TASKS.map(([key, name, description], index) => {
          const done = completed.includes(key);
          const processing = busy === key;
          return (
            <article
              className={`dash-card local-plan task-card${done ? " is-complete" : ""}${lastAction === key ? " is-active" : ""}`}
              key={key}
            >
              <span className="task-sequence-badge" aria-hidden="true">
                {done ? <CheckCircle2 size={16} /> : index + 1}
              </span>
              <span className="dash-eyebrow task-state">
                {done ? "COMPLETADA" : processing ? "VERIFICANDO…" : "PENDIENTE"}
              </span>
              <h3>{name}</h3>
              <p>{description}</p>
              <button
                className={`dash-primary task-button${processing ? " is-processing" : ""}`}
                disabled={!tasksAvailable || done || busy !== null}
                aria-busy={processing}
                onClick={() => complete(key)}
              >
                {processing
                  ? "Procesando…"
                  : done
                    ? "Completada"
                    : "Realizar tarea"}{" "}
                {done ? <CheckCircle2 size={15} /> : <RefreshCw className={processing ? "spin" : undefined} size={15} />}
              </button>
            </article>
          );
        })}
      </div>
      {message && (
        <div className="form-success" role="status">
          {message}
        </div>
      )}
      {nodeRewards.length > 0 && (
        <div
          className="dash-card local-ledger"
          aria-label="ROI acreditado por nodo"
        >
          <span className="dash-eyebrow">RESULTADO POR NODO</span>
          {nodeRewards.map(node => (
            <div
              className="movement-row"
              key={node.transaction_id || node.contract_id}
            >
              <div>
                <b>{node.plan_name}</b>
                <span>
                  {node.contract_id} · CAPITAL {money(Number(node.capital))}
                </span>
              </div>
              <div style={{ textAlign: "right" }}>
                <strong className={node.status === "completed" ? "positive" : undefined}>
                  +{money(Number(node.reward))}
                </strong>
                <span>
                  {node.status === "pending" ? "PROVISIONAL" : "ACREDITADO"} · Rendimiento del nodo
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const nav = [
  ["Inicio", "/dashboard", Home],
  ["Activar nodos", "/dashboard/activate", Gem],
  ["Tareas diarias", "/dashboard/tasks", CheckCircle2],
  ["Mis nodos", "/dashboard/nodes", Box],
  ["Predicciones de mercado", "/dashboard/predictions", Activity],
  ["Mi red", "/dashboard/network", Users],
  ["Depositar", "/dashboard/deposit", Plus],
  ["Retirar", "/dashboard/withdraw", Wallet],
  ["Historial", "/dashboard/history", Clock3],
  ["Perfil", "/dashboard/profile", Settings],
] as const;
type LiveFarmEvent = {
  id: string;
  node: string;
  network: string;
  operations: number;
  commission: number;
};

const liveRows: LiveFarmEvent[] = [
  { id: "seed-1", node: "BN-Y9F4UG", network: "Ethereum", operations: 2501, commission: 2.043 },
  { id: "seed-2", node: "BN-8DX8W6", network: "Solana", operations: 3264, commission: 0.2208 },
  { id: "seed-3", node: "BN-4SDMIE", network: "Arbitrum", operations: 3232, commission: 1.6028 },
  { id: "seed-4", node: "BN-5WHG14", network: "Bitcoin", operations: 4165, commission: 1.0476 },
];
const liveNetworks = ["Ethereum", "Solana", "Arbitrum", "Bitcoin", "BNB Chain", "Polygon"];

function nextLiveFarmEvent(): LiveFarmEvent {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const node = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return {
    id: `${Date.now()}-${node}`,
    node: `BN-${node}`,
    network: liveNetworks[Math.floor(Math.random() * liveNetworks.length)],
    operations: 350 + Math.floor(Math.random() * 9450),
    commission: Number((0.035 + Math.random() * 8.715).toFixed(4)),
  };
}
const catalog = [
  {
    id: "daily",
    name: "Nodo Diario",
    rate: "1% – 1.5%",
    duration: "Indefinida",
    min: 10,
  },
  {
    id: "7d",
    name: "Nodo 7 Días",
    rate: "2% – 3%",
    duration: "7 días + capital de vuelta",
    min: 10,
  },
  {
    id: "14d",
    name: "Nodo 14 Días",
    rate: "3% – 4%",
    duration: "14 días + capital de vuelta",
    min: 10,
  },
  {
    id: "21d",
    name: "Nodo 21 Días",
    rate: "4% – 5%",
    duration: "21 días + capital de vuelta",
    min: 10,
  },
];
const WITHDRAW_DAILY_LIMIT = 1000;
const NETWORKS = ["BNB Chain"];
const WALLET_RULES: Record<string, { placeholder: string; test: RegExp }> = {
  "BNB Chain": {
    placeholder: "0x + 40 caracteres hexadecimales",
    test: /^0x[a-fA-F0-9]{40}$/,
  },
  Polygon: {
    placeholder: "0x + 40 caracteres hexadecimales",
    test: /^0x[a-fA-F0-9]{40}$/,
  },
  Arbitrum: {
    placeholder: "0x + 40 caracteres hexadecimales",
    test: /^0x[a-fA-F0-9]{40}$/,
  },
  Solana: {
    placeholder: "Dirección Base58 de Solana",
    test: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  },
  Bitcoin: {
    placeholder: "bc1..., 1... o 3...",
    test: /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,90}$/,
  },
};

function Metric({
  label,
  value,
  tone = "neutral",
  note,
}: {
  label: string;
  value: string;
  tone?: string;
  note?: string;
}) {
  return (
    <article className={`dash-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </article>
  );
}

export default function Dashboard() {
  const [location, navigate] = useLocation();
  const {
    user: authUser,
    loading: authLoading,
    configured: authConfigured,
  } = useSupabaseSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cashbackPromoOpen, setCashbackPromoOpen] = useState(false);
  const [liveNodes, setLiveNodes] = useState(15014);
  const [now, setNow] = useState(() => Date.now());
  const [user, setUser] = useState<LocalUserState>(() => loadLocalUser());
  const hydratedUserId = useRef<string | null>(null);
  const [commissionSummary, setCommissionSummary] =
    useState<CommissionSummary | null>(null);
  const [commissionLoading, setCommissionLoading] = useState(false);
  const [commissionError, setCommissionError] = useState<string | null>(null);
  const [networkSummary, setNetworkSummary] = useState<NetworkSummary | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [supportWhatsapp, setSupportWhatsapp] = useState("");
  const section = useMemo(() => location.split("/")[2] || "home", [location]);
  useEffect(() => {
    fetch("/api/support/whatsapp")
      .then(response => response.ok ? response.json() : { number: "" })
      .then(body => setSupportWhatsapp(String(body.number || "").replace(/\D/g, "")))
      .catch(() => setSupportWhatsapp(""));
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const authUserId = authUser?.id;
  const cycleNotifications = useCycleNotifications(authUserId);
  useEffect(() => {
    if (!authUserId) return;
    const key = `${CASHBACK_PROMO_SESSION_KEY}:${authUserId}`;
    if (window.sessionStorage.getItem(key) !== "1") {
      setCashbackPromoOpen(true);
    }
  }, [authUserId]);
  useEffect(() => {
    if (!cashbackPromoOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCashbackPromoOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [cashbackPromoOpen]);
  const closeCashbackPromo = () => {
    if (authUserId) {
      window.sessionStorage.setItem(
        `${CASHBACK_PROMO_SESSION_KEY}:${authUserId}`,
        "1"
      );
    }
    setCashbackPromoOpen(false);
  };
  useEffect(() => {
    if (!authLoading && (!authConfigured || !authUser)) navigate("/auth");
  }, [authLoading, authConfigured, authUser, navigate]);
  useEffect(() => {
    if (!authUserId || !authUser) return;
    const stored = loadLocalUser(authUserId);
    setUser({
      ...stored,
      username: displayAuthName(authUser),
      email: authUser.email || stored.email,
    });
  }, [authUserId, authUser]);
  useEffect(() => {
    let active = true;
    if (!authUserId)
      return () => {
        active = false;
      };
    setCommissionLoading(true);
    setCommissionError(null);
    fetchCommissionSummary()
      .then(summary => {
        if (!active) return;
        setCommissionSummary(summary);
      })
      .catch(error => {
        if (active)
          setCommissionError(
            error instanceof Error
              ? error.message
              : "No se pudo cargar el ledger de comisiones."
          );
      })
      .finally(() => {
        if (active) setCommissionLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authUserId]);
  useEffect(() => {
    let active = true;
    if (!authUserId) return () => { active = false; };
    setNetworkLoading(true);
    setNetworkError(null);
    fetchNetworkSummary()
      .then(summary => { if (active) setNetworkSummary(summary); })
      .catch(error => {
        if (active) setNetworkError(error instanceof Error ? error.message : "No se pudo cargar la red binaria.");
      })
      .finally(() => { if (active) setNetworkLoading(false); });
    return () => { active = false; };
  }, [authUserId]);
  useEffect(() => {
    if (!authUserId || !supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session?.access_token) return;
      fetch("/api/email/welcome", { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` } }).catch(() => undefined);
    });
  }, [authUserId]);
  const isHome = section === "home";
  useEffect(() => {
    if (!authUserId) return;
    if (hydratedUserId.current !== authUserId) {
      hydratedUserId.current = authUserId;
      return;
    }
    saveLocalUser(user, authUserId);
  }, [user, authUserId]);
  useEffect(() => {
    let active = true;
    if (!authUserId)
      return () => {
        active = false;
      };
    fetchAccountSummary()
      .then(summary => {
        if (!active || summary === null) return;
        const ledger = summary.ledger;
        setUser(prev => ({
          ...prev,
          balance: ledger.balance,
          totalInvested: ledger.totalInvested,
          totalYield: ledger.totalYield,
          contracts: summary.contracts,
          movements: summary.movements,
        }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [authUserId]);
  useEffect(() => {
    const timer = window.setInterval(
      () => setLiveNodes(value => Math.max(14800, value + Math.floor(Math.random() * 13) - 4)),
      2800
    );
    return () => window.clearInterval(timer);
  }, []);
  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3000);
  };
  const activeLabel =
    nav.find(item => item[1] === location)?.[0] ||
    (isHome ? "Inicio" : "Panel");
  const mutateWithdraw = async (
    amount: number,
    network: string,
    wallet: string,
    fee: number,
    result: { id: string; fee: number; netAmount: number; balance: number }
  ) => {
    try {
      const movement = {
        id: result.id,
        type: "withdraw" as const,
        label: `Solicitud de retiro · ${network}`,
        amount: -amount,
        status: "pending" as const,
        date: new Date().toISOString(),
        network,
        wallet,
        fee: result.fee ?? fee,
        netAmount: result.netAmount ?? amount - fee,
      };
      setUser(prev => ({ ...prev, balance: result.balance, movements: [movement, ...prev.movements.filter(item => item.id !== result.id)] }));
      showNotice(
        `Solicitud registrada: recibirás ${money(result.netAmount)}. El monto solicitado ya está reservado y se libera si el retiro es rechazado.`
      );
    } catch (cause) {
      showNotice(
        cause instanceof Error
          ? cause.message
          : "No se pudo registrar la solicitud."
      );
    }
  };
  const activate = async (item: (typeof catalog)[number], amount: number) => {
    if (!Number.isFinite(amount) || amount < item.min)
      return showNotice(`El monto mínimo es ${money(item.min)}.`);
    if (user.balance < amount)
      return showNotice(
        `No tienes suficiente balance para activar ${money(amount)}.`
      );
    const contract: Contract = {
      id: newId("NODE"),
      name: item.name,
      rate: item.rate,
      amount,
      status: "active",
      createdAt: new Date().toLocaleDateString("es-MX"),
      duration: item.duration,
    };
    const movement = {
      id: contract.id,
      type: "contract" as const,
      label: `Activación ${item.name}`,
      amount: -amount,
      status: "completed" as const,
      date: new Date().toISOString(),
    };
    try {
      const result = await activateContractAndCommissions({
        contractId: contract.id,
        planId: item.id,
        amount,
      });
      setUser(prev => ({
        ...prev,
        balance: prev.balance - amount,
        totalInvested: prev.totalInvested + amount,
        contracts: [contract, ...prev.contracts],
        movements: [movement, ...prev.movements],
      }));
      fetchCommissionSummary()
        .then(summary => {
          if (summary) setCommissionSummary(summary);
        })
        .catch(() => undefined);
      showNotice(
        result.status === "duplicate"
          ? `${item.name} ya estaba activado.`
          : `${item.name} activado y comisión liquidada.`
      );
      navigate("/dashboard/nodes");
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "No se pudo activar el contrato."
      );
    }
  };
  const reward = (
    rewards: DailyNodeReward[],
    fallback?: { amount: number; transactionId?: string }
  ) => {
    const now = new Date().toISOString();
    const movements = rewards.length
      ? rewards.map(node => ({
          id: node.transaction_id || newId("YIELD"),
          type: "yield" as const,
          label: `Pasivo ${node.plan_name}`,
          amount: Number(node.reward),
          status: "completed" as const,
          date: now,
        }))
      : fallback?.amount
        ? [
            {
              id: fallback.transactionId || newId("YIELD"),
              type: "yield" as const,
              label: "Pasivo diario acreditado",
              amount: fallback.amount,
              status: "completed" as const,
              date: now,
            },
          ]
        : [];
    const total = movements.reduce((sum, movement) => sum + movement.amount, 0);
    setUser(prev => ({
      ...prev,
      balance: prev.balance + total,
      totalYield: prev.totalYield + total,
      movements: [...movements, ...prev.movements],
    }));
    if (authUserId) {
      fetchAccountSummary()
        .then(summary => {
          if (summary === null) return;
          setUser(prev => ({ ...prev, ...summary.ledger, movements: summary.movements }));
        })
        .catch(() => undefined);
    }
  };

  if (authLoading)
    return <div className="auth-loading">Verificando sesión…</div>;
  if (!authUserId) return null;
  const content = section === "predictions" ? <MarketPredictions /> : isHome ? (
    <HomePanel
      user={user}
      commissionSummary={commissionSummary}
      liveNodes={liveNodes}
      showNotice={showNotice}
      navigate={navigate}
    />
  ) : (
    <SectionPanel
      section={section}
      user={user}
      now={now}
      currentUserId={authUserId}
      commissionSummary={commissionSummary}
      networkSummary={networkSummary}
      networkLoading={networkLoading}
      networkError={networkError}
      commissionLoading={commissionLoading}
      commissionError={commissionError}
      showNotice={showNotice}
      withdraw={mutateWithdraw}
      activate={activate}
      reward={reward}
    />
  );
  return (
    <div className="dashboard-shell dashboard-future">
      {cashbackPromoOpen && (
        <div
          className="cashback-login-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Promoción de cashback por depósito"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeCashbackPromo();
          }}
        >
          <div className="cashback-login-modal">
            <button
              className="cashback-login-close"
              type="button"
              aria-label="Cerrar promoción"
              onClick={closeCashbackPromo}
            >
              <X aria-hidden="true" />
            </button>
            <img
              src="/deposit-cashback-giveaway.png"
              alt="Giveaway BitNode: cashback de 10% para depósitos de 500 USDT o más y 20% para depósitos de 1,000 USDT o más"
            />
          </div>
        </div>
      )}
      {notice && (
        <div className="notice dash-notice" role="status">
          {notice}
        </div>
      )}
      <aside className={`dashboard-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="dash-brand">
          <BrandMark className="brand-mark" />
        </div>
        <div className="dash-nav" id="dashboard-navigation">
          {nav.map(([label, href, Icon]) => (
            <Link
              key={href}
              href={href}
              className={`${location === href ? "active" : ""}${href === "/dashboard/tasks" ? " daily-tasks-link" : ""}`.trim()}
              onClick={() => setMobileOpen(false)}
            >
              <Icon size={19} />
              <span>{label}</span>
            </Link>
          ))}
        </div>
        <button
          className="logout"
          onClick={async () => {
            window.sessionStorage.removeItem(
              `${CASHBACK_PROMO_SESSION_KEY}:${authUserId}`
            );
            await supabase?.auth.signOut();
            showNotice("Sesión cerrada.");
            navigate("/");
          }}
        >
          <LogOut size={19} />
          <span>Cerrar sesión</span>
        </button>
      </aside>
      <div className="dashboard-main">
        <header className="dash-topbar">
          <button
            className="dash-mobile-toggle"
            type="button"
            aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={mobileOpen}
            aria-controls="dashboard-navigation"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X /> : <Menu />}
          </button>
          <h1>{activeLabel}</h1>
          <div className="dash-tools">
            <button
              className="dash-locale"
              onClick={() => showNotice("Idioma activo: Español")}
            >
              ES <ChevronDown size={14} />
            </button>
            {cycleNotifications.bell}
            <button
              className="dash-balance"
              onClick={() => navigate("/dashboard/deposit")}
            >
              <span>BALANCE</span>
              <strong>{money(user.balance)}</strong>
            </button>
          </div>
        </header>
        <main className="dash-content"><NodeCycleProvider key={authUserId} userId={authUserId}>{cycleNotifications.panel}{content}</NodeCycleProvider></main>
      </div>
      {supportWhatsapp && (
        <a
          className="dashboard-whatsapp"
          href={`https://wa.me/${supportWhatsapp}?text=${encodeURIComponent("Hola, necesito soporte con mi cuenta de BitNode.")}`}
          target="_blank"
          rel="noreferrer"
          aria-label="Contactar soporte por WhatsApp"
        >
          <MessageCircle size={23} />
          <span>Soporte</span>
        </a>
      )}
    </div>
  );
}

function HomePanel({
  user,
  commissionSummary,
  liveNodes,
  showNotice,
  navigate,
}: {
  user: LocalUserState;
  commissionSummary: CommissionSummary | null;
  liveNodes: number;
  showNotice: (message: string) => void;
  navigate: (path: string) => void;
}) {
  return (
    <>
      <div className="dash-intro">
        <div>
          <span className="dash-eyebrow">PANEL DE CONTROL</span>
          <h2>Hola, {user.username}</h2>
          <p>Esto es lo que están generando tus nodos.</p>
        </div>
        <div className="dash-date">MIÉRCOLES · 20 AGO 2026</div>
      </div>
      <section className="dash-metrics-grid">
        <Metric
          label="BALANCE DISPONIBLE"
          value={money(user.balance)}
          tone="green"
        />
        <Metric label="INVERTIDO EN NODOS" value={money(user.totalInvested)} />
        <Metric
          label="RENDIMIENTO TOTAL"
          value={money(user.totalYield)}
          tone="blue"
        />
        <Metric
          label="GANANCIA DIARIA EST."
          value={money(user.contracts.length * 0.04)}
          tone="violet"
          note="lunes a viernes"
        />
      </section>
      <section className="dash-mini-grid">
        <Metric
          label="INICIO RÁPIDO"
          value={money(commissionSummary?.direct ?? user.quickBonus)}
          note={commissionSummary ? "registro verificado" : "estado local"}
        />
        <Metric
          label="BINARIO"
          value={money(commissionSummary?.binary ?? user.binaryBonus)}
          note={commissionSummary ? "registro verificado" : "estado local"}
        />
        <Metric
          label="RANGOS"
          value={money(user.rankBonus)}
          note="pendiente de motor"
        />
      </section>
      <div className="dash-section-heading">
        <h3>Mis contratos</h3>
        <button onClick={() => navigate("/dashboard/activate")}>
          Activar nodo <span>→</span>
        </button>
      </div>
      <div className="dash-columns">
        <section className="empty-contracts">
          {user.contracts.length ? (
            <div className="contract-list">
              {user.contracts.filter(c => c.status === "active").slice(0, 3).map(contract => (
                <div className="local-contract" key={contract.id}>
                  <div>
                    <span>{contract.id} · ACTIVO</span>
                    <h4>{contract.name}</h4>
                    <small>
                      Rendimiento variable · {contract.duration}
                    </small>
                    <NodeCycleProgress id={contract.id} name={contract.name} duration={contract.duration} />
                  </div>
                  <strong>{money(contract.amount)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <>
              <BrandMark className="brand-mark" />
              <h4>Aún no tienes contratos activos</h4>
              <p>
                Activa tu primer nodo para comenzar a participar en la
                infraestructura.
              </p>
              <button
                className="dash-primary"
                onClick={() => navigate("/dashboard/activate")}
              >
                Ver contratos <Zap size={15} />
              </button>
            </>
          )}
        </section>
        <LiveFarm liveNodes={liveNodes} />
      </div>
      <div className="dash-lower-grid">
        <section className="dash-card referral-card">
          <div className="dash-card-head">
            <div>
              <span className="dash-eyebrow">ENLACES BINARIOS</span>
              <h3>Controla tus piernas</h3>
            </div>
            <Users size={20} />
          </div>
          <p>Comparte únicamente el enlace izquierdo o derecho desde tu red.</p>
          <button
            className="dash-primary"
            onClick={() => navigate("/dashboard/network")}
          >
            Ver enlaces binarios <ArrowRight size={15} />
          </button>
        </section>
        <section className="dash-card progress-card">
          <div className="dash-card-head">
            <div>
              <span className="dash-eyebrow">PRÓXIMO RANGO</span>
              <h3>{user.totalInvested >= 50 ? "Plata" : "Bronce"}</h3>
            </div>
            <span className="rank-value">
              {user.totalInvested >= 50 ? "$250" : "$50"}
            </span>
          </div>
          <div className="progress-track">
            <span
              style={{ width: `${Math.min(100, user.totalInvested * 2)}%` }}
            />
          </div>
          <div className="progress-labels">
            <span>{money(user.totalInvested)} invertidos</span>
            <span>{user.totalInvested >= 50 ? "$250" : "$50"} objetivo</span>
          </div>
        </section>
      </div>
    </>
  );
}

function LiveFarm({ liveNodes }: { liveNodes: number }) {
  const [events, setEvents] = useState(liveRows);
  const [latestEventId, setLatestEventId] = useState(liveRows[0].id);
  const [uptime, setUptime] = useState(99.77);

  useEffect(() => {
    let timer = 0;
    const refresh = () => {
      const next = nextLiveFarmEvent();
      setLatestEventId(next.id);
      setEvents(current => [next, ...current].slice(0, 4));
      setUptime(Number((99.61 + Math.random() * 0.38).toFixed(2)));
      timer = window.setTimeout(refresh, 2400 + Math.random() * 3200);
    };
    timer = window.setTimeout(refresh, 1800);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section className="live-farm">
      <div className="live-farm-title">
        <h3>
          <i /> Granja en vivo
        </h3>
        <div className="farm-live-status">
          <span className="farm-signal" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            UPTIME <strong>{uptime.toFixed(2)}%</strong>
          </span>
        </div>
      </div>
      <div className="farm-summary">
        <strong>{liveNodes.toLocaleString("en-US")}</strong>
        <span>NODOS</span>
        <strong>{uptime.toFixed(2)}%</strong>
        <span>UPTIME</span>
      </div>
      {events.map(row => (
        <div className={`farm-row${row.id === latestEventId ? " is-new" : ""}`} key={row.id}>
          <div>
            <b>{row.node}</b>
            <span>
              {row.network} · {row.operations.toLocaleString("en-US")} ops
            </span>
          </div>
          <strong>+${row.commission.toFixed(4)}</strong>
        </div>
      ))}
    </section>
  );
}

function SectionPanel({
  section,
  user,
  now,
  currentUserId,
  commissionSummary,
  networkSummary,
  networkLoading,
  networkError,
  commissionLoading,
  commissionError,
  showNotice,
  withdraw,
  activate,
  reward,
}: {
  section: string;
  user: LocalUserState;
  now: number;
  currentUserId?: string;
  commissionSummary: CommissionSummary | null;
  networkSummary: NetworkSummary | null;
  networkLoading: boolean;
  networkError: string | null;
  commissionLoading: boolean;
  commissionError: string | null;
  showNotice: (message: string) => void;
  withdraw: (
    amount: number,
    network: string,
    wallet: string,
    fee: number,
    result: { id: string; fee: number; netAmount: number; balance: number }
  ) => void;
  activate: (item: (typeof catalog)[number], amount: number) => void;
  reward: (
    rewards: DailyNodeReward[],
    fallback?: { amount: number; transactionId?: string }
  ) => void;
}) {
  const [activationAmounts, setActivationAmounts] = useState<
    Record<string, string>
  >(() => Object.fromEntries(catalog.map(item => [item.id, String(item.min)])));
  const labels: Record<string, [string, string, string]> = {
    activate: [
      "CONTRATOS DISPONIBLES",
      "Activar nodos",
      "Elige el ritmo de generación que mejor encaja con tu estrategia.",
    ],
    tasks: [
      "ACTIVACIÓN DIARIA",
      "Tareas diarias",
      "Completa las cuatro tareas para activar el pasivo del día.",
    ],
    nodes: [
      "INFRAESTRUCTURA ASIGNADA",
      "Mis nodos",
      "Consulta el estado y el rendimiento de tus contratos activos.",
    ],
    network: [
      "PROGRAMA DE RED",
      "Mi red",
      "Revisa tu organización, bonos y evolución de rangos.",
    ],
    deposit: [
      "BALANCE DE CUENTA",
      "Depositar",
      "Fondea tu balance local para activar capacidad de validación.",
    ],
    withdraw: [
      "BALANCE DISPONIBLE",
      "Retirar",
      "Solicita una transferencia desde tu balance local disponible.",
    ],
    history: [
      "REGISTRO DE ACTIVIDAD",
      "Historial",
      "Movimientos, acreditaciones y operaciones de tu cuenta.",
    ],
    profile: [
      "CONFIGURACIÓN",
      "Perfil",
      "Administra tus datos y preferencias de cuenta.",
    ],
  };
  const [eyebrow, title, copy] = labels[section] || labels.activate;
  const commissionMovements = (commissionSummary?.entries || []).map(entry => ({
    id: `commission-${entry.id}`,
    label:
      entry.commission_type === "binary"
        ? `Comisión binaria · ${entry.leg === "left" ? "Pierna izquierda" : entry.leg === "right" ? "Pierna derecha" : "Volumen emparejado"}`
        : entry.commission_type === "direct"
          ? `Comisión directa · ${entry.source_username || "Usuario referido"}`
          : "Ajuste de comisión",
    detail: `${entry.node_name || "Nodo no identificado"}${entry.commission_type === "binary" ? ` · origen: ${entry.source_username || "Usuario referido"}` : ""}`,
    date: new Date(entry.created_at).toLocaleString("es-MX"),
    amount: Number(entry.amount || 0),
    status: entry.status,
  }));
  if (section === "activate")
    return (
      <div className="generic-panel">
        <span className="dash-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{copy}</p>
        <div className="local-plan-grid">
          {catalog.map(item => {
            const rawAmount = activationAmounts[item.id] ?? String(item.min);
            const amount = Number(rawAmount);
            const valid =
              Number.isFinite(amount) &&
              amount >= item.min &&
              amount <= user.balance;
            return (
              <article className="dash-card local-plan" key={item.name}>
                <span className="dash-eyebrow">{item.duration}</span>
                <h3>{item.name}</h3>
                <strong className="rate-private">Rendimiento variable</strong>
                <p>
                  Generación de lunes a viernes. Mínimo local: {money(item.min)}
                  .
                </p>
                <label className="activation-amount">
                  <span>Monto a activar (USD)</span>
                  <input
                    type="number"
                    min={item.min}
                    max={user.balance}
                    step="0.01"
                    inputMode="decimal"
                    value={rawAmount}
                    aria-invalid={!valid}
                    onChange={event =>
                      setActivationAmounts(current => ({
                        ...current,
                        [item.id]: event.target.value,
                      }))
                    }
                  />
                  <small>Disponible: {money(user.balance)}</small>
                </label>
                <button
                  className="dash-primary"
                  disabled={!valid}
                  onClick={() => activate(item, amount)}
                >
                  {amount >= item.min && Number.isFinite(amount)
                    ? `Activar por ${money(amount)}`
                    : `Mínimo ${money(item.min)}`}{" "}
                  <Zap size={15} />
                </button>
              </article>
            );
          })}
        </div>
      </div>
    );
  if (section === "tasks")
    return <DailyTasksPanel user={user} onRewards={reward} />;
  if (section === "deposit")
    return <DepositPanel title={title} copy={copy} />;
  if (section === "withdraw")
    return (
      <WithdrawalForm
        title={title}
        copy={copy}
        user={user}
        onSubmit={withdraw}
      />
    );
  if (section === "nodes")
    return (() => {
      const activeContracts = user.contracts.filter(c => c.status === "active");
      const pendingContracts = user.contracts.filter(c => c.status === "pending");
      const archivedContracts = user.contracts.filter(c => c.status !== "active" && c.status !== "pending");
      const orderedContracts = [...activeContracts, ...pendingContracts, ...archivedContracts];
      const flexibleCapital = activeContracts
        .filter(c => c.name === "Nodo Diario")
        .reduce((sum, c) => sum + c.amount, 0);
      const lockedCapital = activeContracts
        .filter(c => c.name !== "Nodo Diario")
        .reduce((sum, c) => sum + c.amount, 0);
      return (
      <div className="generic-panel">
        <span className="dash-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{copy}</p>
        <div className="node-capital-summary" aria-label="Resumen de capital por disponibilidad">
          <div className="node-capital-summary-item is-available">
            <span>CAPITAL RETIRABLE</span>
            <strong>{money(flexibleCapital)}</strong>
            <small>Nodos diarios · sujeto a tareas validadas</small>
          </div>
          <div className="node-capital-summary-item is-locked">
            <span>CAPITAL BLOQUEADO</span>
            <strong>{money(lockedCapital)}</strong>
            <small>Nodos 7, 14 y 21 días · hasta cerrar ciclo</small>
          </div>
        </div>
        <div className="dash-card local-ledger">
          {user.contracts.length ? (
            orderedContracts.map((c, index) => (
              (() => {
                const archived = c.status !== "active" && c.status !== "pending";
                const statusLabel = c.status === "completed" ? (c.name === "Nodo Diario" ? "CAPITAL RETIRADO" : "CICLO FINALIZADO") : ({ active: "ACTIVO", pending: "PENDIENTE", cancelled: "CANCELADO", expired: "VENCIDO", reversed: "ANULADO" }[c.status] || c.status);
                return <Fragment key={c.id}>
                {index === 0 && !archived && <h3 className="node-history-heading">{activeContracts.length ? "Nodos activos" : "Nodos pendientes"}</h3>}
                {archived && index === activeContracts.length + pendingContracts.length && <div className="node-history-heading"><h3>Historial de nodos</h3><p>Nodos finalizados o cerrados · {archivedContracts.length} registros</p></div>}
                <div className={`local-contract${archived ? " node-archived" : ""}`}>
                <div>
                  <span>
                    {c.id} · {statusLabel}
                  </span>
                  <h4>{c.name}</h4>
                  <small>
                    Rendimiento variable · activado {c.createdAt}
                  </small>
                  {c.status === "active" && <NodeCycleProgress id={c.id} name={c.name} duration={c.duration} />}
                  {archived ? <span className="node-archive-badge">{statusLabel} · CONSERVADO EN HISTORIAL</span> : c.status === "pending" ? <span className="node-archive-badge">PENDIENTE DE ACTIVACIÓN</span> : <span className={`node-availability ${c.name === "Nodo Diario" ? "is-available" : "is-locked"}`}>
                    {c.name === "Nodo Diario"
                      ? "CAPITAL RETIRABLE · completa las 4 tareas"
                      : `CAPITAL BLOQUEADO · ${c.duration}`}
                  </span>}
                </div>
                <div className="node-capital-actions">
                  {archived && <small>Capital del nodo</small>}
                  <strong>{money(c.amount)}</strong>
                  {c.name === "Nodo Diario" && c.status === "active" && (
                    <button
                      className="node-capital-withdraw"
                      type="button"
                      onClick={async () => {
                        if (!window.confirm("¿Retirar el capital y cerrar este Nodo Diario? Debes tener las 4 tareas validadas.")) return;
                        try {
                          const result = await withdrawDailyNodeCapital(c.id);
                          showNotice(`Capital retirado: ${money(Number(result.capital_returned))}. El Nodo Diario fue cerrado.`);
                          window.location.reload();
                        } catch (error) {
                          showNotice(error instanceof Error ? error.message : "No se pudo retirar el capital.");
                        }
                      }}
                    >
                      Retirar capital
                    </button>
                  )}
                </div>
                </div></Fragment>;
              })()
            ))
          ) : (
            <EmptyState text="Aún no hay nodos activos." />
          )}
        </div>
      </div>
      );
    })();
  if (section === "history")
    return (
      <div className="generic-panel">
        <span className="dash-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{copy}</p>
        <div className="dash-card local-ledger">
          {user.movements.length || commissionMovements.length ? (
            (() => {
              const entries = [
              ...user.movements.map(m => ({
                id: m.id,
                label:
                  m.type === "yield" && !/comisi[oó]n|bono/i.test(m.label)
                    ? `Rendimiento de nodo · ${m.label.replace(/\s*·\s*ROI\s*[0-9.,]+%?/i, "")}`
                    : m.label,
                detail:
                  m.type === "yield" && !/comisi[oó]n|bono/i.test(m.label)
                    ? "Rendimiento generado por un nodo propio"
                    : m.type === "contract"
                      ? "Activación de nodo · capital invertido"
                      : undefined,
                date: m.date,
                amount: m.amount,
                status: m.status,
              })),
              ...commissionMovements,
              ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
              const dayLabel = (date: string) => new Date(date).toLocaleDateString("es-419", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
              return entries.map((m, index) => {
                const dateKey = (value: string) => Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString().slice(0, 10) : "Sin fecha";
                const day = dateKey(m.date);
                const previousDay = index ? dateKey(entries[index - 1].date) : "";
                const lowerLabel = m.label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const tone = lowerLabel.includes("retiro") || m.status === "reversed"
                  ? "movement-withdraw"
                  : /(?:comision|bono).*direct/.test(lowerLabel)
                    ? "movement-direct"
                    : /(?:comision|bono).*binari/.test(lowerLabel)
                      ? "movement-binary"
                      : /comision|bono/.test(lowerLabel)
                        ? "movement-commission"
                        : /rendimiento|pasivo|roi/.test(lowerLabel)
                          ? "movement-yield"
                          : lowerLabel.includes("activacion") ? "movement-contract" : "";
                return <Fragment key={m.id}>
                {day !== previousDay && <div className="history-day-heading"><span>{day === "Sin fecha" ? day : dayLabel(m.date)}</span><i /></div>}
              <div className={`movement-row ${tone}`}>
                <div>
                  <b>{m.label}</b>
                  {"detail" in m && m.detail && <span className={`history-origin ${m.label.startsWith("ROI") ? "history-roi" : ""}`}>{m.detail}</span>}
                  <span>
                    {m.date} ·{" "}
                    {({ pending: "Pendiente", approved: "Aprobado", rejected: "Rechazado", failed: "Fallido", reversed: "Anulado", credited: "Acreditado", completed: "Completado" } as Record<string, string>)[m.status] || m.status}
                  </span>
                </div>
                <strong className={m.amount >= 0 ? "positive" : "negative"}>
                  {m.amount >= 0 ? "+" : "−"}
                  {money(Math.abs(m.amount))}
                </strong>
              </div>
              </Fragment>;
              })
            })()
          ) : (
            <EmptyState text="Aún no hay movimientos." />
          )}
        </div>
      </div>
    );
  if (section === "profile")
    return (
      <ProfilePanel
        user={user}
        eyebrow={eyebrow}
        title={title}
        copy={copy}
        showNotice={showNotice}
      />
    );
  if (section === "network") {
    const directEntries = (commissionSummary?.entries || []).filter(
      entry => entry.commission_type === "direct" && entry.status === "credited"
    );
    const binaryEntries = (commissionSummary?.entries || []).filter(
      entry => entry.commission_type === "binary" && entry.status === "credited"
    );
    const pendingEntries = (commissionSummary?.entries || []).filter(
      entry => entry.status !== "credited"
    );
    const binaryVolume = commissionSummary?.binaryVolume;
    const leftPoints = Number(binaryVolume?.left || 0);
    const rightPoints = Number(binaryVolume?.right || 0);
    const matchedPoints = Number(binaryVolume?.matched || 0);
    const leftPendingPoints = Math.max(leftPoints - matchedPoints, 0);
    const rightPendingPoints = Math.max(rightPoints - matchedPoints, 0);
    const nextMatchPoints = Math.min(leftPendingPoints, rightPendingPoints);
    const pointLabel = (value: number) => `${value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pts`;
    const pairingLabel =
      binaryVolume?.status === "paired"
        ? "Emparejado"
        : binaryVolume?.status === "awaiting_pair"
          ? "Esperando volumen opuesto"
          : "Sin volumen binario";
    return (
      <div className="generic-panel">
        <span className="dash-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{copy}</p>
        {commissionLoading && (
          <div className="commission-state" role="status">
            Consultando movimientos y volumen binario…
          </div>
        )}
        {commissionError && (
          <div className="commission-state error" role="alert">
            {commissionError}
          </div>
        )}
        <div className="commission-detail-grid binary-invite-links">
          {(
            [
              ["izquierda", "PIERNA IZQUIERDA", "←"],
              ["derecha", "PIERNA DERECHA", "→"],
            ] as const
          ).map(([side, label, arrow]) => {
            const referralCode = networkSummary?.referralCode?.trim();
            const link = referralCode
              ? binaryReferralUrl(referralCode, side)
              : "";
            return (
              <div
                className={`commission-detail-card ${side === "izquierda" ? "direct" : "binary"}`}
                key={side}
              >
                <div>
                  <span className="dash-eyebrow">
                    {arrow} {label}
                  </span>
                  <strong>{link || "Enlace no disponible"}</strong>
                </div>
                <button
                  className="dash-primary"
                  disabled={!link}
                  onClick={() => {
                    if (!link) return;
                    navigator.clipboard?.writeText(link);
                    showNotice(`Enlace de pierna ${side} copiado.`);
                  }}
                >
                  Copiar <Copy size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <section className="binary-points-board dash-card">
          <div className="dash-card-head">
            <div>
              <span className="dash-eyebrow">VOLUMEN BINARIO EN VIVO</span>
              <h3>Puntos de tus piernas</h3>
            </div>
            <span className="ledger-status">1 USDT = 1 PUNTO</span>
          </div>
          <div className="binary-points-grid">
            <article className="binary-point-card left"><span>Pierna izquierda</span><strong>{pointLabel(leftPoints)}</strong><small>Pendientes: {pointLabel(leftPendingPoints)}</small></article>
            <article className="binary-point-card right"><span>Pierna derecha</span><strong>{pointLabel(rightPoints)}</strong><small>Pendientes: {pointLabel(rightPendingPoints)}</small></article>
            <article className="binary-point-card matched"><span>Match histórico</span><strong>{pointLabel(matchedPoints)}</strong><small>Volumen ya emparejado</small></article>
            <article className="binary-point-card next"><span>Match disponible</span><strong>{pointLabel(nextMatchPoints)}</strong><small>Puntos listos para cruzar</small></article>
          </div>
          <div className="binary-pending-bars">
            <div><span>Izquierda disponible <b>{pointLabel(leftPendingPoints)}</b></span><i><em style={{ width: `${Math.min(100, leftPendingPoints / Math.max(leftPendingPoints, rightPendingPoints, 1) * 100)}%` }} /></i></div>
            <div><span>Derecha disponible <b>{pointLabel(rightPendingPoints)}</b></span><i><em style={{ width: `${Math.min(100, rightPendingPoints / Math.max(leftPendingPoints, rightPendingPoints, 1) * 100)}%` }} /></i></div>
          </div>
          {binaryVolume?.updatedAt && <p className="binary-points-updated">Última actualización: {new Date(binaryVolume.updatedAt).toLocaleString("es-MX")}</p>}
        </section>
        <BinaryTree
          nodes={networkSummary?.networkNodes || []}
          currentUserId={currentUserId}
          ownerName={networkSummary?.ownerUsername || user.username}
        />
        <section className="binary-match-history dash-card">
          <div className="dash-card-head">
            <div><span className="dash-eyebrow">HISTÓRICO BINARIO</span><h3>Historial de match</h3></div>
            <span className="ledger-status">{binaryEntries.length} MATCH{binaryEntries.length === 1 ? "" : "ES"}</span>
          </div>
          {binaryEntries.length ? (
            <div className="binary-match-list">
              {binaryEntries.map(entry => {
                const metadata = entry.metadata || {};
                const matched = Number(metadata.matched_volume || 0);
                const left = Number(metadata.left_volume || 0);
                const right = Number(metadata.right_volume || 0);
                return <article className="binary-match-row" key={entry.id}>
                  <div><b>+{pointLabel(matched)} en match</b><span>{new Date(entry.created_at).toLocaleString("es-MX")} · Origen: {entry.source_username || "Usuario referido"}</span><small>Izquierda {pointLabel(left)} · Derecha {pointLabel(right)}</small></div>
                  <strong>+{money(Number(entry.amount || 0))}</strong>
                </article>;
              })}
            </div>
          ) : <EmptyState text="Todavía no hay puntos emparejados. El historial aparecerá al existir volumen en ambas piernas." />}
        </section>
        <section className="direct-referrals-card dash-card">
          <div className="dash-card-head">
            <div>
              <span className="dash-eyebrow">TUS INDICACIONES DIRECTAS</span>
              <h3>Mis directos</h3>
            </div>
            <span className="ledger-status">
              {networkSummary ? `${networkSummary.directReferrals?.length || 0} TOTAL` : networkLoading ? "CARGANDO" : "SIN DATOS"}
            </span>
          </div>
          <p className="direct-referrals-copy">
            Personas registradas directamente con tu enlace. Solo tú puedes ver esta información.
          </p>
          {networkSummary?.directReferrals?.length ? (
            <div className="direct-referral-list">
              {networkSummary.directReferrals.map(referral => (
                <div className="direct-referral-row" key={referral.user_id}>
                  <div className="direct-referral-avatar" aria-hidden="true">
                    {referral.username.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <b>{referral.username}</b>
                    <span>
                      {referral.leg
                        ? `Pierna ${referral.leg === "left" ? "izquierda" : "derecha"}`
                        : "Ubicación en red pendiente"}
                    </span>
                  </div>
                  <span className={referral.active_nodes > 0 ? "direct-referral-status active" : "direct-referral-status"}>
                    {referral.active_nodes > 0
                      ? `${referral.active_nodes} nodo${referral.active_nodes === 1 ? "" : "s"} activo${referral.active_nodes === 1 ? "" : "s"}`
                      : "Sin nodo activo"}
                  </span>
                </div>
              ))}
            </div>
          ) : networkSummary ? (
            <EmptyState text="Aún no tienes usuarios directos. Comparte uno de tus enlaces binarios para comenzar." />
          ) : networkError ? (
            <div className="commission-state error" role="alert">{networkError}</div>
          ) : (
            <div className="commission-state" role="status">Consultando tus indicaciones directas…</div>
          )}
        </section>
        <div className="commission-detail-grid">
          <section className="commission-detail-card direct">
            <div className="commission-detail-heading">
              <div>
                <span className="dash-eyebrow">INDICACIÓN DIRECTA</span>
                <h3>Bono directo</h3>
              </div>
              <Users size={20} />
            </div>
            <strong>
              {commissionSummary ? money(commissionSummary.direct) : "—"}
            </strong>
            <p>
              10% sobre la activación elegible de un referido directo.
              {!commissionSummary && " Datos remotos no disponibles."}
            </p>
            <div className="commission-detail-meta">
              <span>{directEntries.length} eventos acreditados</span>
              <span>Rate 10%</span>
            </div>
            <CommissionEntryDetails
              entries={directEntries}
              empty="Aún no hay bonos directos."
            />
          </section>
          <section className="commission-detail-card binary">
            <div className="commission-detail-heading">
              <div>
                <span className="dash-eyebrow">ESTRUCTURA BINARIA</span>
                <h3>Bono binario</h3>
              </div>
              <Zap size={20} />
            </div>
            <strong>
              {commissionSummary ? money(commissionSummary.binary) : "—"}
            </strong>
            <p>
              8% sobre el volumen emparejado entre las piernas izquierda y
              derecha.{!commissionSummary && " Datos remotos no disponibles."}
            </p>
            <div className="binary-volume-grid">
              <span>
                Izquierda <b>{money(binaryVolume?.left ?? 0)}</b>
              </span>
              <span>
                Derecha <b>{money(binaryVolume?.right ?? 0)}</b>
              </span>
              <span>
                Emparejado <b>{money(binaryVolume?.matched ?? 0)}</b>
              </span>
              <span>
                Estado <b>{pairingLabel}</b>
              </span>
            </div>
            <div className="commission-detail-meta">
              <span>{binaryEntries.length} eventos acreditados</span>
              <span>Rate 8%</span>
            </div>
            <CommissionEntryDetails
              entries={binaryEntries}
              empty="Aún no hay bonos binarios."
            />
          </section>
        </div>
        <section className="network-ledger-card dash-card">
          <div className="dash-card-head">
            <div>
              <span className="dash-eyebrow">LEDGER DE COMISIONES</span>
              <h3>Actividad reciente</h3>
            </div>
            <span className="ledger-status">
              {commissionSummary ? "VERIFICADO" : "SIN CONEXIÓN"}
            </span>
          </div>
          {commissionSummary?.entries.length ? (
            commissionSummary.entries.slice(0, 5).map(entry => (
              <div className="commission-ledger-row" key={entry.id}>
                <div>
                  <b>
                    {entry.commission_type === "binary"
                      ? "Bono binario"
                      : "Bono directo"}
                  </b>
                  <span>
                    {new Date(entry.created_at).toLocaleString("es-MX")} ·{" "}
                    {entry.status === "credited" ? "Acreditado" : "Pendiente"}
                    {entry.leg ? ` · Pierna ${entry.leg}` : ""}
                    {entry.node_name ? ` · ${entry.node_name}` : ""}
                  </span>
                </div>
                <strong>{money(Number(entry.amount || 0))}</strong>
              </div>
            ))
          ) : (
            <EmptyState text="Aún no hay comisiones acreditadas." />
          )}
          <div className="commission-ledger-foot">
            <span>
              {commissionSummary
                ? `${pendingEntries.length} pendientes o reversadas`
                : "Ledger remoto no disponible"}
            </span>
            <span>
              Total acumulado:{" "}
              <b>{commissionSummary ? money(commissionSummary.total) : "—"}</b>
            </span>
          </div>
        </section>
        <div className="dash-lower-grid local-network-grid">
          <section className="dash-card">
            <span className="dash-eyebrow">PRÓXIMO RANGO</span>
            <h3>{user.totalInvested >= 50 ? "Plata" : "Bronce"}</h3>
            <p>Volumen personal actual: {money(user.totalInvested)}</p>
          </section>
        </div>
      </div>
    );
  }
  return null;
}

function ProfilePanel({
  user,
  eyebrow,
  title,
  copy,
  showNotice,
}: {
  user: LocalUserState;
  eyebrow: string;
  title: string;
  copy: string;
  showNotice: (message: string) => void;
}) {
  const [details, setDetails] = useState<PrivateUserDetails>(
    emptyPrivateUserDetails
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [originalWallet, setOriginalWallet] = useState("");

  useEffect(() => {
    let active = true;
    fetchPrivateUserDetails()
      .then(value => {
        if (active) { setDetails(value); setOriginalWallet(value.wallet_bep20); }
      })
      .catch(cause => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "No se pudo cargar el perfil."
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const update = (field: keyof PrivateUserDetails, value: string) =>
    setDetails(current => ({ ...current, [field]: value }));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const bep20 = details.wallet_bep20.trim();
    if (bep20 && !/^0x[0-9a-fA-F]{40}$/.test(bep20))
      return setError("La wallet BEP20 no tiene un formato válido.");
    setSaving(true);
    try {
      await savePrivateUserDetails(details);
      if (bep20 !== originalWallet) {
        await saveWithdrawalWallet(bep20);
        setOriginalWallet(bep20);
        showNotice("Wallet guardada correctamente.");
      } else showNotice("Perfil guardado correctamente.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No se pudo guardar el perfil."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="generic-panel">
      <span className="dash-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{copy}</p>
      <form className="profile-form" onSubmit={submit}>
        <section className="dash-card profile-section">
          <span className="dash-eyebrow">DATOS PERSONALES</span>
          <div className="profile-fields">
            <label>
              <span>Usuario</span>
              <input value={user.username} disabled />
            </label>
            <label>
              <span>Correo</span>
              <input type="email" value={user.email} disabled />
            </label>
            <label>
              <span>Nombre completo</span>
              <input
                value={details.full_name}
                maxLength={120}
                onChange={event => update("full_name", event.target.value)}
                placeholder="Nombre y apellido"
              />
            </label>
            <label>
              <span>Teléfono</span>
              <input
                type="tel"
                value={details.phone}
                maxLength={30}
                onChange={event => update("phone", event.target.value)}
                placeholder="+1 809 000 0000"
              />
            </label>
            <label>
              <span>País</span>
              <input
                value={details.country}
                maxLength={80}
                onChange={event => update("country", event.target.value)}
                placeholder="República Dominicana"
              />
            </label>
            <label>
              <span>Ciudad</span>
              <input
                value={details.city}
                maxLength={80}
                onChange={event => update("city", event.target.value)}
                placeholder="Santo Domingo"
              />
            </label>
          </div>
        </section>
        <section className="dash-card profile-section">
          <span className="dash-eyebrow">WALLET DE RETIRO · USDT BEP20</span>
          <p>
            Guarda tu wallet de retiro. Solo se procesan pagos en la red BEP20.
          </p>
          <div className="profile-wallets">
            <label>
              <span>USDT BEP20</span>
              <input
                value={details.wallet_bep20}
                maxLength={42}
                disabled={Boolean(originalWallet)}
                onChange={event => update("wallet_bep20", event.target.value)}
                placeholder="0x…"
                spellCheck={false}
              />
            </label>
            <button
              type="submit"
              className="dash-primary wallet-save"
              disabled={
                loading ||
                saving ||
                !/^0x[0-9a-fA-F]{40}$/.test(details.wallet_bep20.trim()) ||
                details.wallet_bep20.trim() === originalWallet
              }
            >
              {saving
                ? "Guardando…"
                : details.wallet_bep20.trim() === originalWallet && originalWallet
                  ? "Wallet guardada"
                  : "Guardar wallet"}{" "}
              <Wallet size={15} />
            </button>
          </div>
          {originalWallet && <p className="wallet-lock-note">Wallet bloqueada por seguridad. Para cambiarla, contacta a soporte.</p>}
        </section>
        {loading && (
          <div className="form-success" role="status">
            Cargando perfil…
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button
          className="dash-primary profile-save"
          disabled={loading || saving}
        >
          {saving ? "Guardando…" : "Guardar cambios"} <Zap size={15} />
        </button>
      </form>
    </div>
  );
}

export function DepositPanel({
  title,
  copy,
}: {
  title: string;
  copy: string;
}) {
  const [amount, setAmount] = useState(10);
  const [payCurrency, setPayCurrency] = useState("usdtbsc");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [payment, setPayment] = useState<{
    transactionId: string;
    paymentId: string;
    payAddress: string;
    payAmount: string;
    payCurrency: string;
  } | null>(null);
  const [qrImage, setQrImage] = useState("");
  const cashback = depositCashback(amount);
  useEffect(() => {
    if (!payment?.payAddress) {
      setQrImage("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(payment.payAddress, {
      width: 220,
      margin: 1,
      color: { dark: "#060812", light: "#ffffff" },
    })
      .then(image => {
        if (!cancelled) setQrImage(image);
      })
      .catch(() => {
        if (!cancelled) setQrImage("");
      });
    return () => {
      cancelled = true;
    };
  }, [payment?.payAddress]);
  const submit = async () => {
    if (!Number.isFinite(amount) || amount < 10)
      return setError("El depósito mínimo es de $10.00 USDT.");
    setError("");
    setLoading(true);
    try {
      const result = await createNowPaymentsPayment(amount, payCurrency);
      setPayment({
        transactionId: result.transactionId,
        paymentId: result.paymentId,
        payAddress: result.payAddress,
        payAmount: result.payAmount,
        payCurrency: result.payCurrency,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo crear el depósito."
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="generic-panel">
      <span className="dash-eyebrow">BALANCE DE CUENTA</span>
      <h2>{title}</h2>
      <p>{copy}</p>
      <section className="deposit-cashback-promo" aria-label="Promoción Giveaway Deposit Cashback">
        <div><span className="dash-eyebrow">PROMOCIÓN ESPECIAL · GIVEAWAY</span><h3>Deposit Cashback</h3><p>Más depósitos, más oportunidades.</p></div>
        <div className="cashback-tiers">
          <span><b>+500 USDT</b><strong>10%</strong><small>CASHBACK</small></span>
          <span><b>+1,000 USDT</b><strong>20%</strong><small>CASHBACK</small></span>
        </div>
        <small>El cashback se acredita automáticamente después de confirmar el depósito. Una bonificación por transacción válida.</small>
      </section>
      <section className="dash-card money-form payment-form">
        <label>
          Monto del depósito
          <input
            type="number"
            min="10"
            step="0.01"
            value={amount}
            onChange={event => {
              setAmount(Number(event.target.value));
              setError("");
            }}
          />
        </label>
        <label>
          Moneda de pago
          <select
            value={payCurrency}
            onChange={event => setPayCurrency(event.target.value)}
          >
            <option value="usdttrc20">USDT TRC20</option>
            <option value="usdtbsc">USDT BEP20</option>
          </select>
        </label>
        <small>
          Redes disponibles: TRC20 y BEP20. El balance se acredita
          automáticamente cuando recibimos la confirmación IPN válida.
        </small>
        {cashback.rate > 0 && <div className="cashback-estimate" role="status"><span>Cashback estimado ({cashback.rate * 100}%)</span><strong>+{money(cashback.amount)}</strong><small>Total después de confirmar: {money(amount + cashback.amount)}</small></div>}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {payment && (
          <div className="direct-payment" role="status">
            <div>
              <span className="dash-eyebrow">DEPÓSITO DIRECTO</span>
              <h3>
                Envía exactamente {payment.payAmount} {payment.payCurrency.toUpperCase()}
              </h3>
              <p>
                Red: {payment.payCurrency === "usdttrc20" ? "TRC20" : "BEP20"}. Envía
                únicamente por esta red.
              </p>
              <code>{payment.payAddress}</code>
              <button
                type="button"
                className="inline-link"
                onClick={() => navigator.clipboard?.writeText(payment.payAddress)}
              >
                Copiar dirección
              </button>
              <small>
                Referencia: {payment.transactionId}. El balance se acredita al confirmarse
                el pago.
              </small>
            </div>
            {qrImage ? (
              <img className="payment-qr" src={qrImage} alt="Código QR de depósito" />
            ) : (
              <div className="payment-qr-loading">Generando QR…</div>
            )}
          </div>
        )}
        <button
          className="dash-primary"
          disabled={loading || !Number.isFinite(amount) || amount < 10}
          onClick={submit}
        >
          {loading ? "Generando depósito…" : "Generar QR de depósito"}{" "}
          <Zap size={15} />
        </button>
      </section>
    </div>
  );
}

function WithdrawalForm({
  title,
  copy,
  user,
  onSubmit,
}: {
  title: string;
  copy: string;
  user: LocalUserState;
  onSubmit: (
    amount: number,
    network: string,
    wallet: string,
    fee: number,
    result: { id: string; fee: number; netAmount: number; balance: number }
  ) => void;
}) {
  const [amount, setAmount] = useState(10);
  const [network, setNetwork] = useState("BNB Chain");
  const [wallet, setWallet] = useState("");
  const [walletLoading, setWalletLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [availability, setAvailability] = useState<WithdrawalAvailability | null>(null);
  const [availabilityError, setAvailabilityError] = useState("");
  const [countdownNow, setCountdownNow] = useState(Date.now());
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void fetchWithdrawalAvailability()
        .then(result => { if (active) { setAvailability(result); setAvailabilityError(""); } })
        .catch(cause => { if (active) { setAvailability(null); setAvailabilityError(cause instanceof Error ? cause.message : "No se pudo cargar el contador."); } });
    };
    refresh();
    const refreshTimer = window.setInterval(refresh, 15_000);
    const clockTimer = window.setInterval(() => setCountdownNow(Date.now()), 1_000);
    return () => { active = false; window.clearInterval(refreshTimer); window.clearInterval(clockTimer); };
  }, []);
  const nextDirectAt = availability?.nextDirectAvailableAt ? Date.parse(availability.nextDirectAvailableAt) : null;
  const directSecondsLeft = nextDirectAt === null ? 0 : Math.max(0, Math.ceil((nextDirectAt - countdownNow) / 1000));
  const directCountdown = `${String(Math.floor(directSecondsLeft / 3600)).padStart(2, "0")}:${String(Math.floor((directSecondsLeft % 3600) / 60)).padStart(2, "0")}:${String(directSecondsLeft % 60).padStart(2, "0")}`;
  const weeklyTarget = availability?.weeklyWindowOpen ? availability.weeklyWindowClosesAt : availability?.nextWeeklyWindowAt;
  const weeklyTargetAt = weeklyTarget ? Date.parse(weeklyTarget) : null;
  const weeklySecondsLeft = weeklyTargetAt === null ? 0 : Math.max(0, Math.ceil((weeklyTargetAt - countdownNow) / 1000));
  const weeklyCountdown = `${String(Math.floor(weeklySecondsLeft / 3600)).padStart(2, "0")}:${String(Math.floor((weeklySecondsLeft % 3600) / 60)).padStart(2, "0")}:${String(weeklySecondsLeft % 60).padStart(2, "0")}`;
  useEffect(() => {
    let active = true;
    fetchPrivateUserDetails()
      .then(details => {
        if (active) setWallet(details.wallet_bep20.trim());
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : "No se pudo cargar la wallet registrada.");
      })
      .finally(() => {
        if (active) setWalletLoading(false);
      });
    return () => { active = false; };
  }, []);
  const last24Hours = Date.now() - 24 * 60 * 60 * 1000;
  const usedToday = user.movements
    .filter(
      movement =>
        movement.type === "withdraw" &&
        Number.isFinite(new Date(movement.date).getTime()) &&
        new Date(movement.date).getTime() >= last24Hours
    )
    .reduce((sum, movement) => sum + Math.abs(movement.amount), 0);
  const fee = withdrawalFee(amount);
  const net = Math.max(0, amount - fee);
  const validate = () => {
    if (!Number.isFinite(amount) || amount < 10)
      return "El monto mínimo de retiro es de $10.00 USDT.";
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8)
      return "El monto debe tener hasta dos decimales.";
    if (amount > user.balance)
      return `No puedes retirar más de ${money(user.balance)} disponibles.`;
    if (availability?.migrationReady && !availability.globalWindowEnabled)
      return "La ventana global de retiros está cerrada por administración.";
    if (availability && amount > availability.withdrawableBalance)
      return `Solo ${money(availability.withdrawableBalance)} está disponible para retiro ahora. Revisa las comisiones y el contador semanal.`;
    if (usedToday + amount > WITHDRAW_DAILY_LIMIT)
      return `Superas el límite diario de ${money(WITHDRAW_DAILY_LIMIT)}. Ya solicitaste ${money(usedToday)} hoy.`;
    if (!wallet.trim()) return "Introduce la dirección de la wallet.";
    if (!WALLET_RULES[network].test.test(wallet.trim()))
      return `La dirección no coincide con el formato esperado para ${network}.`;
    if (net <= 0) return "El monto neto debe ser mayor que cero.";
    return "";
  };
  const requestConfirmation = () => {
    const nextError = validate();
    setError(nextError);
    if (!nextError) setConfirming(true);
  };
  return (
    <div className="generic-panel">
      <span className="dash-eyebrow">BALANCE LOCAL</span>
      <h2>{title}</h2>
      <p>{copy}</p>
      <section className="dash-card money-form withdrawal-form">
        <label>
          Monto a retirar
          <input
            type="number"
            min="10"
            max={user.balance}
            step="0.01"
            value={Number.isFinite(amount) ? amount : ""}
            aria-invalid={Boolean(error)}
            onChange={event => {
              setAmount(Number(event.target.value));
              setError("");
            }}
          />
        </label>
        <div className="form-grid">
          <label>
            Red
            <select
              value={network}
              onChange={event => {
                setNetwork(event.target.value);
                setError("");
              }}
            >
              {NETWORKS.map(item => (
                <option key={item} value={item}>{item === "BNB Chain" ? "USDT BEP20" : item}</option>
              ))}
            </select>
          </label>
          <label>
            Dirección de wallet
            <input
              type="text"
              value={wallet}
              placeholder={walletLoading ? "Cargando wallet registrada…" : "Registra tu wallet en Perfil"}
              aria-invalid={Boolean(error && wallet)}
              disabled
            />
            <small className="withdrawal-wallet-lock">{walletLoading ? "Consultando la wallet de tu perfil…" : wallet ? "Wallet registrada y bloqueada. Solo soporte puede cambiarla." : "No tienes una wallet registrada. Guárdala primero en Perfil."}</small>
          </label>
        </div>
        <small>
          Balance total: {money(user.balance)} · Límite por 24 horas:{" "}
          {money(WITHDRAW_DAILY_LIMIT)} · Usado: {money(usedToday)}
        </small>
        {availability && <div className="withdrawal-schedule-note" role="timer">
          <strong>Comisión directa</strong>
          <div>{availability.migrationReady ? `Disponible tras 24 horas: ${money(availability.directAvailable)} · ` : ""}Retenida: {money(availability.lockedDirect)}</div>
          {availability.lockedDirect > 0 && nextDirectAt !== null ? (
            <div>{directSecondsLeft > 0 ? `Próxima comisión disponible en ${directCountdown}` : "Plazo cumplido; actualizando disponibilidad…"}</div>
          ) : <div>Sin comisión directa pendiente de las 24 horas.</div>}
          {availability.migrationReady ? <>
            <strong>Ventana de bonos y ROI · miércoles 8:00–15:00 (Ciudad de México)</strong>
            <div>{availability.weeklyWindowOpen ? "ABIERTA" : "CERRADA"} · {weeklySecondsLeft > 0 ? `${availability.weeklyWindowOpen ? "Cierra" : "Abre"} en ${weeklyCountdown}` : "Actualizando horario…"}</div>
            <div>Bono binario/rango: {money(availability.weeklyBonusUnspent)} · ROI nodos 7/14/21: {money(availability.finiteNodeRoiUnspent)}</div>
            <div>ROI Nodo Diario acreditado históricamente: {money(availability.dailyNodeRoiCredited)} · No exige miércoles.</div>
            {!availability.globalWindowEnabled && <div>Retiro global suspendido por administración.</div>}
          </> : <div>La ventana 8:00–15:00 de Ciudad de México está pendiente de aplicar en Supabase. Sigue vigente la regla anterior hasta entonces.</div>}
          <div>Disponible para retiro ahora: {money(availability.migrationReady && !availability.globalWindowEnabled ? 0 : availability.withdrawableBalance)}</div>
        </div>}
        {!availability && !availabilityError && <small className="withdrawal-schedule-note">Consultando la comisión directa…</small>}
        {!availability && availabilityError && <small className="withdrawal-schedule-note">{availabilityError}</small>}
        <p className="withdrawal-schedule-note">
          {availability?.migrationReady
            ? "Comisión directa: disponible 24 horas después de acreditarse, sin esperar al miércoles. Bonos binario/rango y ROI de nodos 7/14/21: miércoles de 8:00 a 15:00, hora de Ciudad de México. El ROI del Nodo Diario se puede retirar al acreditarse. Retiro mínimo: 10 USDT. El capital de los nodos de plazo fijo se libera al completar sus días."
            : "La actualización de retiros a horario de Ciudad de México aún no está confirmada en Supabase. El backend conserva las reglas anteriores hasta aplicar la migración."}
        </p>
        <p className="withdrawal-processing-note">Método único: USDT BEP20. Al confirmar la solicitud, el monto queda reservado. Si el retiro es rechazado, vuelve a estar disponible. Procesamiento manual de hasta 48 horas.</p>
        <div className="fee-summary">
          <span>
            Comisión ({(WITHDRAW_FEE_RATE * 100).toFixed(0)}% · mínimo 1 USDT){" "}
            <strong>{money(fee)}</strong>
          </span>
          <span>
            Recibirás <strong>{money(net)} USDT</strong>
          </span>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button
          className="dash-primary"
          disabled={walletLoading || !wallet || Boolean(error)}
          onClick={requestConfirmation}
        >
          Revisar retiro <Zap size={15} />
        </button>
      </section>
      {confirming && (
        <div className="confirm-backdrop">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdraw-confirm-title"
          >
            <span className="dash-eyebrow">CONFIRMACIÓN REQUERIDA</span>
            <h3 id="withdraw-confirm-title">¿Confirmar retiro?</h3>
            <p>
              Red: <strong>{network === "BNB Chain" ? "USDT BEP20" : network}</strong>
              <br />
              Wallet: <strong className="wallet-preview">{wallet}</strong>
              <br />
              Monto: <strong>{money(amount)} USDT</strong>
              <br />
              Comisión: <strong>{money(fee)}</strong>
              <br />
              Recibirás: <strong>{money(net)} USDT</strong>
            </p>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="confirm-actions">
              <button
                className="confirm-cancel"
                onClick={() => setConfirming(false)}
              >
                Cancelar
              </button>
              <button
                className="dash-primary"
                disabled={verifying}
                onClick={async () => { setVerifying(true); setError(""); try { const result=await requestWithdrawal(amount,network,wallet.trim()); setConfirming(false); onSubmit(amount, network, wallet.trim(), fee, result); } catch(cause) { setError(cause instanceof Error?cause.message:"No se pudo confirmar el retiro."); } finally { setVerifying(false); } }}
              >
                {verifying ? "Procesando…" : "Confirmar retiro"} <Zap size={15} />
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function MoneyForm({
  title,
  copy,
  label,
  button,
  onSubmit,
  max,
}: {
  title: string;
  copy: string;
  label: string;
  button: string;
  onSubmit: (amount: number) => void;
  max?: number;
}) {
  const [amount, setAmount] = useState(10);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const validate = (value: number) => {
    if (!Number.isFinite(value) || value <= 0)
      return "Introduce un monto válido mayor que cero.";
    if (value < 10) return "El monto mínimo es de $10.00 USDT.";
    if (max !== undefined && value > max)
      return `No puedes retirar más de ${money(max)} disponibles.`;
    return "";
  };
  const handleChange = (value: number) => {
    setAmount(value);
    setError(validate(value));
  };
  const requestConfirmation = () => {
    const nextError = validate(amount);
    setError(nextError);
    if (!nextError) setConfirming(true);
  };
  return (
    <div className="generic-panel">
      <span className="dash-eyebrow">BALANCE LOCAL</span>
      <h2>{title}</h2>
      <p>{copy}</p>
      <section className="dash-card money-form">
        <label>
          {label}
          <input
            type="number"
            min="10"
            max={max}
            step="0.01"
            value={Number.isFinite(amount) ? amount : ""}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "money-error" : undefined}
            onChange={e => handleChange(Number(e.target.value))}
          />
        </label>
        {max !== undefined && <small>Disponible: {money(max)}</small>}
        {error && (
          <div className="form-error" id="money-error" role="alert">
            {error}
          </div>
        )}
        <button
          className="dash-primary"
          disabled={Boolean(error) || !amount}
          onClick={requestConfirmation}
        >
          {" "}
          {button} <Zap size={15} />
        </button>
      </section>
      {confirming && (
        <div className="confirm-backdrop" role="presentation">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <span className="dash-eyebrow">CONFIRMACIÓN REQUERIDA</span>
            <h3 id="confirm-title">¿Confirmar {title.toLowerCase()}?</h3>
            <p>
              Vas a procesar <strong>{money(amount)} USDT</strong> en el modo
              local. Revisa el monto antes de continuar.
            </p>
            <div className="confirm-actions">
              <button
                className="confirm-cancel"
                onClick={() => setConfirming(false)}
              >
                Cancelar
              </button>
              <button
                className="dash-primary"
                onClick={() => {
                  setConfirming(false);
                  onSubmit(amount);
                }}
              >
                Confirmar operación <Zap size={15} />
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-ledger">
      <Activity size={26} />
      <span>{text}</span>
      <small>Esta vista estará disponible en la siguiente etapa.</small>
    </div>
  );
}

function CommissionEntryDetails({
  entries,
  empty,
}: {
  entries: CommissionSummary["entries"];
  empty: string;
}) {
  if (!entries.length) return <p className="commission-entry-empty">{empty}</p>;
  return (
    <div className="commission-entry-list">
      {entries.slice(0, 6).map(entry => {
        const matchedVolume = Number(entry.metadata?.matched_volume || 0);
        return (
          <div className="commission-entry-item" key={entry.id}>
            <div>
              <b>{entry.node_name || "Nodo no identificado"}</b>
              <span>
                Origen: {entry.source_username || "Usuario referido"}
                {entry.contract_amount
                  ? ` · Capital ${money(entry.contract_amount)}`
                  : ""}
                {matchedVolume ? ` · Emparejado ${money(matchedVolume)}` : ""}
              </span>
              <span>
                {new Date(entry.created_at).toLocaleString("es-MX")} · Comisión registrada
                {entry.leg ? ` · Pierna ${entry.leg}` : ""}
              </span>
            </div>
            <strong>{money(Number(entry.amount || 0))}</strong>
          </div>
        );
      })}
    </div>
  );
}

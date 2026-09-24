import React, { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { hasRows, matchesAdminSearch, userStatusLabel } from "./adminUtils";
import { Link } from "wouter";
import { BrandMark } from "@/components/BrandMark";
import { MonthlyRoiControl } from "@/components/MonthlyRoiControl";
import { withdrawalSource, withdrawalSourceLabel } from "@shared/withdrawalSource";
import "@/admin-operations.css";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  FileClock,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Users,
  WalletCards,
  X,
} from "lucide-react";

type ApiState = "checking" | "ready" | "locked" | "offline";
type SectionName =
  | "Resumen"
  | "Usuarios"
  | "Operaciones"
  | "Retiros"
  | "Contratos"
  | "Activaciones"
  | "Cuadre diario"
  | "Control de nodos"
  | "Transacciones"
  | "Comisiones"
  | "Configuración";

type AdminUser = {
  id: string;
  username: string | null;
  displayName: string | null;
  email: string | null;
  role: string;
  corporate: boolean;
  classifications?: string[];
  withdrawalBlocked: boolean;
  withdrawalBlockReason: string | null;
  withdrawalBlockedAt: string | null;
  sponsorId: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  bannedUntil: string | null;
  status: string;
  details: {
    fullName: string;
    phone: string;
    country: string;
    city: string;
    walletBep20: string;
    walletTrc20: string;
  };
};

type AdminTransaction = {
  id: string;
  userId: string | null;
  username: string | null;
  type: string;
  label: string | null;
  amount: number;
  status: string;
  network: string | null;
  wallet: string | null;
  fee: number;
  netAmount: number;
  providerStatus: string | null;
  cycle: string | null;
  startAt: string | null;
  endAt: string | null;
  createdAt: string | null;
};

type AdminCommission = {
  id: string | null;
  beneficiaryId: string | null;
  sourceUserId: string | null;
  sourceEventId: string | null;
  type: string;
  amount: number;
  rate: number;
  leg: string | null;
  status: string;
  createdAt: string | null;
};

type AdminNetworkMetric = {
  userId: string;
  directCount: number;
  indirectCount: number;
  networkCount: number;
  personalVolume: number;
  networkVolume: number;
  organizationVolume: number;
};

type NodeControlRow = {
  id?: string;
  contract_id?: string;
  username: string;
  plan_name: string;
  amount?: number;
  cycle_day?: number;
  cycle_day_before?: number;
  completed_tasks?: number;
  completed_tasks_before?: string[];
  deadline_at?: string | null;
  reset_at?: string;
  ends_at?: string | null;
  reason?: string;
};

type NodeControlData = {
  pendingReset: NodeControlRow[];
  resetLastWeek: NodeControlRow[];
  complying: NodeControlRow[];
  completed: NodeControlRow[];
  period: { days: number; started_at: string; ended_at: string };
  historyAvailable: boolean;
  totals: { pendingReset: number; resetLastWeek: number; complying: number; completed: number };
};

type AdminData = {
  status: "ready";
  readOnly: boolean;
  lastUpdated: string;
  metrics: {
    users: number;
    contracts: number;
    contractVolume: number;
    transactions: number;
    pendingTransactions: number;
    pendingCommissions: number;
    creditedCommissions: number;
    networkVolumes: number;
  };
  users: AdminUser[];
  contracts: AdminTransaction[];
  transactions: AdminTransaction[];
  commissions: {
    configuredDirectRate: number;
    configuredBinaryRate: number;
    direct: number;
    binary: number;
    total: number;
    pending: number;
    entries: AdminCommission[];
    networkMetrics: AdminNetworkMetric[];
  };
  binaryVolume: {
    left: number;
    right: number;
    matched: number;
    status: string;
  };
};

type ApiError = { error?: string; status?: string };

const sections: SectionName[] = [
  "Resumen",
  "Usuarios",
  "Operaciones",
  "Retiros",
  "Contratos",
  "Activaciones",
  "Cuadre diario",
  "Control de nodos",
  "Transacciones",
  "Comisiones",
  "Configuración",
];
const sectionIcons: Record<SectionName, typeof LayoutDashboard> = {
  Resumen: LayoutDashboard,
  Usuarios: Users,
  Operaciones: CircleDollarSign,
  Retiros: WalletCards,
  Contratos: FileClock,
  Activaciones: BarChart3,
  "Cuadre diario": CircleDollarSign,
  "Control de nodos": Server,
  Transacciones: WalletCards,
  Comisiones: BarChart3,
  Configuración: Settings2,
};

const money = (value: number | null | undefined) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(Number(value)) ? Number(value) : 0);

const compactNumber = (value: number | null | undefined) =>
  new Intl.NumberFormat("es-419", { maximumFractionDigits: 0 }).format(
    Number(value || 0)
  );

const dateLabel = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("es-419", {
        dateStyle: "medium",
        timeStyle: "short",
      });
};

const statusLabel = (value: string | null | undefined) => {
  const labels: Record<string, string> = {
    completed: "Completada",
    confirmed: "Confirmado",
    credited: "Acreditada",
    pending: "Pendiente",
    approved: "Aprobada",
    rejected: "Rechazada",
    failed: "Fallida",
    user: "Usuario",
    admin: "Admin",
    deposit: "Depósito",
    withdraw: "Retiro",
    contract: "Contrato",
    yield: "Rendimiento",
    direct: "Directa",
    binary: "Binaria",
  };
  return labels[value || ""] || value || "—";
};

function StatusPill({ value }: { value: string | null | undefined }) {
  const normalized = value || "unknown";
  return (
    <span
      className={`data-status data-status-${normalized.replace(/[^a-z0-9_-]/gi, "-")}`}
    >
      {statusLabel(normalized)}
    </span>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="admin-empty-state">
      <div className="empty-orbit">
        <LockKeyhole size={22} />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="admin-loading-state" role="status">
      <RefreshCw size={18} className="spin" /> Consultando datos seguros…
    </div>
  );
}

function DataTable({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const move = (direction: -1 | 1) => {
    const region = viewport.current;
    if (!region) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    region.scrollBy({ left: direction * Math.max(220, region.clientWidth * 0.75), behavior: reducedMotion ? "auto" : "smooth" });
  };
  return (
    <div className="admin-table-container">
      <div className="admin-table-controls" aria-label={`Desplazar ${label}`}>
        <span>Desliza para ver más columnas</span>
        <button type="button" aria-label={`Desplazar ${label} a la izquierda`} onClick={() => move(-1)}>←</button>
        <button type="button" aria-label={`Desplazar ${label} a la derecha`} onClick={() => move(1)}>→</button>
      </div>
      <div ref={viewport} className="admin-table-wrap" role="region" aria-label={label} tabIndex={0}>
        <table className="admin-data-table">{children}</table>
      </div>
    </div>
  );
}

function SummarySection({ data }: { data: AdminData | null }) {
  if (!data) return <LoadingState />;
  const recentTransactions = data.transactions.slice(0, 5);
  const recentCommissions = data.commissions.entries.slice(0, 5);
  return (
    <>
      <div className="admin-grid">
        <article className="admin-metric">
          <div className="metric-icon">
            <Users size={18} />
          </div>
          <p>Usuarios registrados</p>
          <strong>{compactNumber(data.metrics.users)}</strong>
          <small>Perfiles sincronizados</small>
        </article>
        <article className="admin-metric">
          <div className="metric-icon">
            <CircleDollarSign size={18} />
          </div>
          <p>Volumen de contratos</p>
          <strong>{money(data.metrics.contractVolume)}</strong>
          <small>
            {compactNumber(data.metrics.contracts)} contratos registrados
          </small>
        </article>
        <article className="admin-metric">
          <div className="metric-icon">
            <WalletCards size={18} />
          </div>
          <p>Transacciones pendientes</p>
          <strong>{compactNumber(data.metrics.pendingTransactions)}</strong>
          <small>Sin acreditar automáticamente</small>
        </article>
        <article className="admin-metric">
          <div className="metric-icon">
            <BarChart3 size={18} />
          </div>
          <p>Comisiones acreditadas</p>
          <strong>{money(data.metrics.creditedCommissions)}</strong>
          <small>
            {money(data.metrics.pendingCommissions)} pendientes en ledger
          </small>
        </article>
      </div>
      <div className="admin-binary-card">
        <div>
          <p className="admin-kicker">BINARY BONUS / 8%</p>
          <h2>Volumen emparejado</h2>
          <p>
            Lectura agregada de `network_volume`; este panel no ejecuta créditos
            ni mutaciones.
          </p>
        </div>
        <div className="binary-stats">
          <div>
            <span>Izquierda</span>
            <strong>{money(data.binaryVolume.left)}</strong>
          </div>
          <div>
            <span>Derecha</span>
            <strong>{money(data.binaryVolume.right)}</strong>
          </div>
          <div>
            <span>Emparejado</span>
            <strong>{money(data.binaryVolume.matched)}</strong>
          </div>
          <div>
            <span>Bono binario</span>
            <strong>{money(data.commissions.binary)}</strong>
          </div>
        </div>
        <span className="binary-status">
          {data.binaryVolume.status === "paired"
            ? "Emparejamiento activo"
            : data.binaryVolume.status === "awaiting_pair"
              ? "Esperando volumen opuesto"
              : "Sin volumen registrado"}
        </span>
      </div>
      <div className="admin-columns">
        <article className="admin-card admin-card-large">
          <div className="card-heading">
            <div>
              <p className="admin-kicker">LATEST ACTIVITY</p>
              <h2>Últimas transacciones</h2>
            </div>
            <span className="card-status">
              <CheckCircle2 size={15} /> Solo lectura
            </span>
          </div>
          {recentTransactions.length === 0 ? (
            <EmptyState
              title="Sin transacciones"
              detail="Aún no hay registros disponibles en la tabla transactions."
            />
          ) : (
            <DataTable label="Últimas transacciones">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Tipo</th>
                  <th>Monto</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map(row => (
                  <tr key={row.id}>
                    <td>{row.username || row.userId?.slice(0, 8) || "—"}</td>
                    <td>{statusLabel(row.type)}</td>
                    <td>{money(row.amount)}</td>
                    <td>
                      <StatusPill value={row.status} />
                    </td>
                    <td>{dateLabel(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </article>
        <article className="admin-card">
          <div className="card-heading">
            <div>
              <p className="admin-kicker">COMMISSION LEDGER</p>
              <h2>Red</h2>
            </div>
          </div>
          <div className="runtime-row">
            <span>Bono directo</span>
            <b>{money(data.commissions.direct)}</b>
          </div>
          <div className="runtime-row">
            <span>Bono binario</span>
            <b>{money(data.commissions.binary)}</b>
          </div>
          <div className="runtime-row">
            <span>Total acreditado</span>
            <b>{money(data.commissions.total)}</b>
          </div>
          <div className="runtime-row">
            <span>Entradas pendientes</span>
            <b>{money(data.commissions.pending)}</b>
          </div>
          <code>direct_rate = 10% · binary_rate = 8%</code>
        </article>
      </div>
      <article className="admin-card admin-card-full">
        <div className="card-heading">
          <div>
            <p className="admin-kicker">RECENT COMMISSIONS</p>
            <h2>Ledger reciente</h2>
          </div>
          <span className="card-status">
            <CheckCircle2 size={15} /> Idempotencia server-side
          </span>
        </div>
        {recentCommissions.length === 0 ? (
          <EmptyState
            title="Ledger vacío"
            detail="Las comisiones aparecerán aquí cuando existan eventos procesados."
          />
        ) : (
          <DataTable label="Ledger reciente">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Monto</th>
                <th>Tasa</th>
                <th>Estado</th>
                <th>Evento</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {recentCommissions.map(row => (
                <tr key={row.id || row.sourceEventId}>
                  <td>{statusLabel(row.type)}</td>
                  <td>{money(row.amount)}</td>
                  <td>{row.rate ? `${row.rate * 100}%` : "—"}</td>
                  <td>
                    <StatusPill value={row.status} />
                  </td>
                  <td className="mono-cell">
                    {row.sourceEventId?.slice(0, 18) || "—"}
                  </td>
                  <td>{dateLabel(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </article>
    </>
  );
}

export function UsersSection({
  data,
  onUpdated,
}: {
  data: AdminData;
  onUpdated: () => Promise<void>;
}) {
  const { users } = data;
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [monitorId, setMonitorId] = useState("");
  const [saving, setSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [message, setMessage] = useState("");
  const [withdrawalBusy, setWithdrawalBusy] = useState(false);
  const [withdrawalReason, setWithdrawalReason] = useState("Bloqueado por administración");
  const [withdrawalMessage, setWithdrawalMessage] = useState("");
  const filtered = useMemo(
    () =>
      users.filter(user =>
        matchesAdminSearch(
          [user.username, user.displayName, user.email, user.role, user.status, ...(user.classifications ?? []), user.corporate ? "corporativa" : "", user.withdrawalBlocked ? "retiros bloqueados" : ""],
          query
        )
      ),
    [query, users]
  );
  const selected = users.find(user => user.id === selectedId) || null;
  const monitored = users.find(user => user.id === monitorId) || null;
  const accountTransactions = monitored ? data.transactions.filter(row => row.userId === monitored.id) : [];
  const accountContracts = monitored ? data.contracts.filter(row => row.userId === monitored.id) : [];
  const accountCommissions = monitored ? data.commissions.entries.filter(row => row.beneficiaryId === monitored.id || row.sourceUserId === monitored.id) : [];
  const [editor, setEditor] = useState<Record<string, string>>({});

  function selectUser(user: AdminUser) {
    setSelectedId(user.id);
    setMessage("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMessage("");
    setWithdrawalMessage("");
    setWithdrawalReason(user.withdrawalBlockReason || "Bloqueado por administración");
    setEditor({
      username: user.username || "",
      displayName: user.displayName || "",
      email: user.email || "",
      fullName: user.details.fullName || "",
      phone: user.details.phone || "",
      country: user.details.country || "",
      city: user.details.city || "",
      walletBep20: user.details.walletBep20 || "",
      walletTrc20: user.details.walletTrc20 || "",
    });
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setMessage("");
    try {
      const session = (await supabase?.auth.getSession())?.data.session;
      if (!session) throw new Error("Sesión administrativa requerida.");
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId: selected.id, ...editor }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "No se pudo actualizar el usuario.");
      setMessage("Datos del usuario actualizados correctamente.");
      await onUpdated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar el usuario.");
    } finally {
      setSaving(false);
    }
  }

  async function changeUserPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    if (newPassword.length < 12 || newPassword.length > 128) { setPasswordMessage("La contraseña debe tener entre 12 y 128 caracteres."); return; }
    if (newPassword !== confirmPassword) { setPasswordMessage("Las contraseñas no coinciden."); return; }
    setPasswordSaving(true);
    setPasswordMessage("");
    try {
      const session = (await supabase?.auth.getSession())?.data.session;
      if (!session) throw new Error("Sesión administrativa requerida.");
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selected.id, password: newPassword }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "No se pudo cambiar la contraseña.");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Contraseña actualizada. Comunica la nueva clave al usuario por un medio privado.");
    } catch (error) { setPasswordMessage(error instanceof Error ? error.message : "No se pudo cambiar la contraseña."); }
    finally { setPasswordSaving(false); }
  }

  async function toggleUserWithdrawals() {
    if (!selected || selected.role === "admin") return;
    setWithdrawalBusy(true);
    setWithdrawalMessage("");
    try {
      const session = (await supabase?.auth.getSession())?.data.session;
      if (!session) throw new Error("Sesión administrativa requerida.");
      const response = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selected.id, withdrawalBlocked: !selected.withdrawalBlocked, reason: withdrawalReason }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "No se pudo actualizar el bloqueo de retiros.");
      setWithdrawalMessage(selected.withdrawalBlocked ? "Retiros habilitados para este usuario." : "Retiros bloqueados para este usuario.");
      await onUpdated();
    } catch (error) {
      setWithdrawalMessage(error instanceof Error ? error.message : "No se pudo actualizar el bloqueo de retiros.");
    } finally { setWithdrawalBusy(false); }
  }

  return (
    <article className="admin-card admin-card-full">
      <div className="card-heading">
        <div>
          <p className="admin-kicker">IDENTITY / PROFILES</p>
          <h2>Usuarios registrados</h2>
        </div>
        <span className="card-status">
          <CheckCircle2 size={15} /> {users.length} perfiles
        </span>
      </div>
      <div className="admin-toolbar">
        <label className="admin-search">
          <Search size={16} />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Buscar por correo, usuario, estado o rol"
            aria-label="Buscar usuarios"
          />
        </label>
        <span className="admin-toolbar-note">
          {filtered.length} resultado{filtered.length === 1 ? "" : "s"}
        </span>
      </div>
      {!hasRows(users) ? (
        <EmptyState
          title="Sin usuarios"
          detail="No existen perfiles disponibles para mostrar."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Sin coincidencias"
          detail="Prueba con otro correo, usuario, estado o rol."
        />
      ) : (
        <DataTable label="Usuarios registrados">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Correo</th>
              <th>Estado</th>
              <th>Rol</th>
              <th>Patrocinador</th>
              <th>Registro</th>
              <th>Último acceso</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map(user => (
              <tr key={user.id} className={user.corporate ? "admin-corporate-row" : undefined}>
                <td>
                  <strong>{user.username || "Sin username"}</strong>
                  <small>{user.displayName || user.id.slice(0, 12)}</small>
                  <div className="admin-user-labels">{(user.classifications?.length ? user.classifications : ["Sin clasificar"]).map(label => <span key={label} className={`admin-user-label admin-user-label--${label === "CRYPTO" ? "crypto" : label === "REALES MANUAL" ? "manual" : label === "ADM (CORPORATIVA)" ? "corporate" : "unknown"}`}>{label}</span>)}</div>
                  {user.withdrawalBlocked && <span className="admin-withdrawal-blocked-badge">RETIROS BLOQUEADOS</span>}
                </td>
                <td>{user.email || "—"}</td>
                <td>
                  <StatusPill value={userStatusLabel(user)} />
                </td>
                <td>
                  <StatusPill value={user.role} />
                </td>
                <td className="mono-cell">
                  {user.sponsorId?.slice(0, 12) || "—"}
                </td>
                <td>{dateLabel(user.createdAt)}</td>
                <td>{dateLabel(user.lastSignInAt)}</td>
                <td>
                  <button className="admin-refresh" type="button" onClick={() => { setMonitorId(user.id); setSelectedId(""); }}>
                    Monitorear cuenta
                  </button>
                  <button className="admin-refresh" type="button" onClick={() => selectUser(user)}>
                    Gestionar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {monitored && (
        <section className="admin-user-manager" aria-label={`Monitoreo de ${monitored.username || monitored.email || monitored.id}`}>
          <div className="card-heading">
            <div>
              <p className="admin-kicker">MONITOREO DE CUENTA</p>
              <h2>{monitored.username || monitored.email || monitored.id}</h2>
            </div>
            <button className="admin-refresh" type="button" onClick={() => setMonitorId("")}>Cerrar</button>
          </div>
          <p className="config-note">Estado: {userStatusLabel(monitored)} · Último acceso: {dateLabel(monitored.lastSignInAt)} · Wallet BEP20: {monitored.details.walletBep20 || "Sin registrar"}</p>
          <div className="admin-account-metrics">
            <div><span>Contratos en el registro</span><strong>{accountContracts.length}</strong></div>
            <div><span>Movimientos en el registro</span><strong>{accountTransactions.length}</strong></div>
            <div><span>Comisiones relacionadas</span><strong>{accountCommissions.length}</strong></div>
          </div>
          <h3>Movimientos recientes</h3>
          {accountTransactions.length ? (
            <DataTable label={`Movimientos de ${monitored.username || monitored.id}`}>
              <thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th><th>Estado</th></tr></thead>
              <tbody>{accountTransactions.slice(0, 20).map(row => (
                <tr key={row.id}><td>{dateLabel(row.createdAt)}</td><td>{row.label || row.type}</td><td>{money(row.amount)}</td><td><StatusPill value={row.status} /></td></tr>
              ))}</tbody>
            </DataTable>
          ) : <p className="config-note">No hay movimientos en los registros cargados.</p>}
          <p className="config-note">Datos de consulta del panel administrativo, actualizados: {dateLabel(data.lastUpdated)}. Los registros están limitados por la carga del panel.</p>
        </section>
      )}
      {selected && (
        <form className="admin-user-manager" onSubmit={saveUser}>
          <div className="card-heading">
            <div>
              <p className="admin-kicker">USER MANAGER</p>
              <h2>Editar {selected.username || selected.email}</h2>
            </div>
            <button className="admin-refresh" type="button" onClick={() => setSelectedId("")}>Cerrar</button>
          </div>
          <div className="admin-user-fields">
            {[
              ["username", "Usuario"], ["displayName", "Nombre visible"], ["email", "Correo electrónico"],
              ["fullName", "Nombre completo"], ["phone", "Teléfono"], ["country", "País"],
              ["city", "Ciudad"], ["walletBep20", "Wallet USDT BEP20"], ["walletTrc20", "Wallet USDT TRC20"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type={key === "email" ? "email" : "text"}
                  value={editor[key] || ""}
                  onChange={event => setEditor(current => ({ ...current, [key]: event.target.value }))}
                  required={key === "username" || key === "email"}
                />
              </label>
            ))}
          </div>
          <p className="config-note">El correo se actualiza directamente en el acceso del usuario. Rol y patrocinador no se modifican desde este módulo.</p>
          <button className="admin-user-save" type="submit" disabled={saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
          {message && <p className="config-note" role="status">{message}</p>}
        </form>
      )}
      {selected && selected.role !== "admin" && (
        <section className="admin-user-manager admin-withdrawal-restriction" aria-label={`Control de retiros de ${selected.username || selected.email}`}>
          <div className="card-heading">
            <div><p className="admin-kicker">CONTROL DE RETIROS</p><h2>{selected.withdrawalBlocked ? "Retiros bloqueados" : "Retiros habilitados"}</h2></div>
            <span className={`card-status ${selected.withdrawalBlocked ? "is-blocked" : "is-open"}`}>{selected.withdrawalBlocked ? "BLOQUEADO" : "HABILITADO"}</span>
          </div>
          <p className="config-note">Este control bloquea nuevas solicitudes normales y reclamaciones de capital. No modifica solicitudes ya creadas.</p>
          <label className="admin-withdrawal-reason">Motivo<input value={withdrawalReason} maxLength={160} onChange={event => setWithdrawalReason(event.target.value)} disabled={selected.withdrawalBlocked} placeholder="Motivo que verá el usuario al intentar retirar" /></label>
          {selected.withdrawalBlocked && <p className="config-note">Motivo actual: {selected.withdrawalBlockReason || "Bloqueado por administración"} · Desde: {dateLabel(selected.withdrawalBlockedAt)}</p>}
          <button className={selected.withdrawalBlocked ? "admin-user-save" : "admin-block-withdrawals"} type="button" onClick={() => void toggleUserWithdrawals()} disabled={withdrawalBusy || (!selected.withdrawalBlocked && !withdrawalReason.trim())}>
            {withdrawalBusy ? "Actualizando…" : selected.withdrawalBlocked ? "Desbloquear retiros" : "Bloquear retiros"}
          </button>
          {withdrawalMessage && <p className="config-note" role="status">{withdrawalMessage}</p>}
        </section>
      )}
      {selected && selected.role !== "admin" && (
        <form className="admin-user-manager" onSubmit={changeUserPassword}>
          <div className="card-heading"><div><p className="admin-kicker">SEGURIDAD DE ACCESO</p><h2>Cambiar contraseña de {selected.username || selected.email}</h2></div></div>
          <div className="admin-user-fields">
            <label>Nueva contraseña<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} required /></label>
            <label>Confirmar contraseña<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required /></label>
          </div>
          <p className="config-note">Mínimo 12 caracteres. La contraseña no se mostrará de nuevo después de guardarla.</p>
          <button className="admin-user-save" type="submit" disabled={passwordSaving}>{passwordSaving ? "Actualizando…" : "Cambiar contraseña"}</button>
          {passwordMessage && <p className="config-note" role="status">{passwordMessage}</p>}
        </form>
      )}
    </article>
  );
}

function NodeControlSection() {
  const [data, setData] = useState<NodeControlData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setError("");
    try {
      const session = (await supabase?.auth.getSession())?.data.session;
      if (!session) throw new Error("Sesión administrativa requerida.");
      const response = await fetch("/api/admin/node-control", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "No se pudo cargar el control de nodos.");
      setData(body as NodeControlData);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cargar el control de nodos."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  if (loading) return <LoadingState />;
  if (error) return <div className="admin-data-error" role="alert">{error}<button onClick={() => void load()}>Reintentar</button></div>;
  if (!data) return null;

  const groups: Array<[string, string, NodeControlRow[], string]> = [
    ["Pendientes de reinicio", "El plazo de 24 horas venció con menos de 4 tareas. Se reiniciarán al procesarse el ciclo.", data.pendingReset, "pending"],
    ["Reiniciados en los últimos 7 días", `Reinicios registrados desde ${dateLabel(data.period.started_at)} por incumplimiento de tareas diarias.`, data.resetLastWeek, "reset"],
    ["Cumpliendo tareas", "Jornada activa con tareas completadas y plazo vigente", data.complying, "active"],
    ["Nodos completados", "Ciclos finalizados conservados en el historial", data.completed, "completed"],
  ];
  return <div className="node-control-grid">
    <article className="admin-card admin-card-full node-reset-weekly-summary">
      <div className="card-heading">
        <div><p className="admin-kicker">ÚLTIMOS 7 DÍAS</p><h2>Reinicios por tareas diarias incumplidas</h2><p className="config-note">Vista semanal del historial real y de los ciclos vencidos que esperan reinicio.</p></div>
        <button className="admin-refresh" type="button" onClick={() => void load()}>Actualizar</button>
      </div>
      {!data.historyAvailable && <p className="admin-warning" role="status">El historial semanal todavía no está habilitado en Supabase. Los ciclos pendientes, en cumplimiento y completados sí se muestran con datos actuales.</p>}
    </article>
    <div className="node-control-metrics">
      <article className="node-control-metric-alert"><span>PENDIENTES DE REINICIO</span><strong>{data.totals.pendingReset}</strong></article>
      <article className="node-control-metric-reset"><span>REINICIADOS · 7 DÍAS</span><strong>{data.totals.resetLastWeek}</strong></article>
      <article><span>EN CUMPLIMIENTO</span><strong>{data.totals.complying}</strong></article>
      <article><span>COMPLETADOS</span><strong>{data.totals.completed}</strong></article>
    </div>
    {groups.map(([title, copy, rows, kind]) => <article className="admin-card admin-card-full" key={title}>
      <div className="card-heading"><div><p className="admin-kicker">TASK CONTROL / {kind.toUpperCase()}</p><h2>{title}</h2><p className="config-note">{copy}</p></div><span className="card-status">{rows.length} registros</span></div>
      {!rows.length ? <EmptyState title="Sin registros" detail="No hay nodos en este estado." /> : <DataTable label={title}><thead><tr><th>Usuario</th><th>Nodo</th><th>Capital</th><th>Jornada</th><th>Tareas</th><th>Fecha límite / evento</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || `${row.contract_id}-${index}`}><td><strong>{row.username}</strong>{row.reason === "missed_24h_window" && <small>Incumplió ventana de 24 h</small>}</td><td>{row.plan_name}<small>{row.contract_id || row.id}</small></td><td>{row.amount == null ? "—" : money(row.amount)}</td><td>{row.cycle_day ?? row.cycle_day_before ?? 0}</td><td>{row.completed_tasks ?? row.completed_tasks_before?.length ?? 0} / 4</td><td>{dateLabel(row.reset_at || row.deadline_at || row.ends_at)}</td></tr>)}</tbody></DataTable>}
    </article>)}
  </div>;
}

function OperationsSection({
  users,
  onCompleted,
}: {
  users: AdminUser[];
  onCompleted: () => Promise<void>;
}) {
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState(10);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [reason, setReason] = useState("Ajuste manual de balance");
  const filteredUsers = useMemo(
    () => users.filter(user => matchesAdminSearch(
      [user.email, user.username, user.displayName, user.details.fullName],
      userQuery
    )),
    [users, userQuery]
  );
  useEffect(() => {
    if (userId && !filteredUsers.some(user => user.id === userId)) setUserId("");
  }, [filteredUsers, userId]);
  const selectedUser = users.find(user => user.id === userId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const action = submitter?.value || "add";
    const corporateDeposit = action === "corporate";
    const operation = action === "remove" ? "remove" : "add";
    setLoading(true);
    setMessage("");
    try {
      const session = (await supabase?.auth.getSession())?.data.session;
      if (!session) throw new Error("Sesión administrativa requerida.");
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          amount,
          operation,
          corporate: corporateDeposit,
          reason,
          requestId: crypto.randomUUID(),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
        corporate?: boolean;
        balance?: number;
      };
      if (!response.ok)
        throw new Error(body.error || "No se pudo acreditar el balance.");
      setMessage(`${operation === "remove" ? "Balance debitado" : "Balance acreditado"}: ${body.id}${Number.isFinite(body.balance) ? ` · Nuevo balance ${money(body.balance)}` : ""}${body.corporate ? " · Cuenta corporativa sin comisiones de patrocinio" : ""}`);
      await onCompleted();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo acreditar el balance."
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <article className="admin-card admin-card-full">
      <div className="card-heading">
        <div>
          <p className="admin-kicker">BALANCE / OPERACIÓN REAL</p>
          <h2>Agregar y quitar balance al usuario</h2>
        </div>
        <span className="card-status">
          <ShieldCheck size={15} /> Admin protegido
        </span>
      </div>
      <form className="admin-gate-form" onSubmit={submit}>
        <label>
          Buscar usuario
          <span className="admin-operation-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={userQuery}
              onChange={event => setUserQuery(event.target.value)}
              placeholder="Correo o nombre de usuario"
              autoComplete="off"
            />
            {userQuery && (
              <button type="button" onClick={() => setUserQuery("")} aria-label="Limpiar búsqueda">
                <X size={15} />
              </button>
            )}
          </span>
          <small className="admin-operation-results">
            {filteredUsers.length} usuario{filteredUsers.length === 1 ? "" : "s"} encontrado{filteredUsers.length === 1 ? "" : "s"}
          </small>
        </label>
        <label>
          Usuario
          <select
            value={userId}
            onChange={event => setUserId(event.target.value)}
            required
          >
            <option value="">Selecciona un usuario</option>
            {filteredUsers.map(user => (
              <option value={user.id} key={user.id}>
                {user.email || "Sin correo"}{user.username ? ` · @${user.username}` : ""}
              </option>
            ))}
            {filteredUsers.length === 0 && <option value="" disabled>Sin coincidencias</option>}
          </select>
        </label>
        <label>
          Monto USDT
          <input
            type="number"
            min="0.01"
            max="1000000"
            step="0.01"
            value={amount}
            onChange={event => setAmount(Number(event.target.value))}
            required
          />
        </label>
        <label>
          Motivo del ajuste
          <input value={reason} maxLength={160} onChange={event => setReason(event.target.value)} required placeholder="Motivo visible en el historial" />
        </label>
        {selectedUser?.corporate && <p className="admin-corporate-choice">Esta cuenta ya es corporativa. Sus activaciones no generan comisión directa ni binaria.</p>}
        <div className="admin-deposit-actions">
          <button type="submit" name="balanceAction" value="add" disabled={loading || !userId}>
            {loading ? "Procesando…" : "Agregar balance"}
          </button>
          <button className="admin-balance-remove" type="submit" name="balanceAction" value="remove" disabled={loading || !userId}>
            {loading ? "Procesando…" : "Quitar balance"}
          </button>
          <button className="admin-corporate-activation" type="submit" name="balanceAction" value="corporate"
            disabled={loading || !userId || Boolean(selectedUser?.corporate)}>
            {selectedUser?.corporate ? "Cuenta corporativa activa" : "Activar sin subir comisiones"}
          </button>
        </div>
        <p className="config-note">Quitar balance nunca puede dejar la cuenta en negativo. La activación corporativa agrega el monto y evita que sus futuras activaciones generen comisión directa o volumen binario.</p>
      </form>
      {message && (
        <p className="config-note" role="status">
          {message}
        </p>
      )}
    </article>
  );
}

type AdminWithdrawal = {
  id: string;
  user_id: string | null;
  username: string | null;
  amount: number | string;
  status: string;
  network: string | null;
  wallet: string | null;
  fee: number | string | null;
  net_amount: number | string | null;
  provider_status: string | null;
  created_at: string | null;
  payable_at?: string | null;
  direct_commission_spent?: number | string | null;
  weekly_bonus_spent?: number | string | null;
  node_roi_spent?: number | string | null;
};

function WithdrawalsSection({ onCompleted }: { onCompleted: () => Promise<void> }) {
  const [rows, setRows] = useState<AdminWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState("");
  const [message, setMessage] = useState("");
  const [reference, setReference] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState("");

  async function copyWallet(row: AdminWithdrawal) {
    const wallet = String(row.wallet || "").trim();
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet);
    } catch {
      const field = document.createElement("textarea");
      field.value = wallet;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopiedId(row.id);
    setMessage("Wallet copiada completa. Verifica los últimos caracteres antes de enviar.");
    window.setTimeout(() => setCopiedId(current => current === row.id ? "" : current), 2500);
  }

  async function load() {
    setLoading(true);
    try {
      const session = (await supabase?.auth.getSession())?.data.session;
      if (!session) throw new Error("Sesión administrativa requerida.");
      const response = await fetch("/api/admin/withdrawals", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error || "No se pudo cargar la cola de retiros."));
      setRows(Array.isArray(body.withdrawals) ? body.withdrawals : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar la cola de retiros.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function act(row: AdminWithdrawal, action: "approve" | "mark_paid" | "reject") {
    const descriptions = {
      approve: "aprobar esta solicitud para pago manual",
      mark_paid: "marcar este retiro como pagado después de enviar los fondos externamente",
      reject: "rechazar esta solicitud",
    };
    if (!window.confirm(`¿Confirmas ${descriptions[action]}?`)) return;
    setActingId(row.id);
    setMessage("");
    try {
      const session = (await supabase?.auth.getSession())?.data.session;
      if (!session) throw new Error("Sesión administrativa requerida.");
      const response = await fetch("/api/admin/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ id: row.id, action, reference: reference[row.id] || "" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error || "No se pudo actualizar el retiro."));
      setMessage(`Retiro ${row.id} actualizado a ${statusLabel(body.status)}.`);
      await Promise.all([load(), onCompleted()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar el retiro.");
    } finally {
      setActingId("");
    }
  }

  return (
    <article className="admin-card admin-card-full">
      <div className="card-heading">
        <div>
          <p className="admin-kicker">MANUAL PAYOUT QUEUE</p>
          <h2>Retiros y capital de nodos</h2>
        </div>
        <button className="admin-refresh" type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spin" : ""} /> Actualizar
        </button>
      </div>
      <p className="config-note">Aprueba la solicitud, realiza el envío desde tu wallet externa y luego marca el retiro como pagado. El panel no transfiere criptomonedas automáticamente.</p>
      {message && <p className="config-note" role="status">{message}</p>}
      {loading ? <LoadingState /> : rows.length === 0 ? (
        <EmptyState title="Sin retiros" detail="No hay solicitudes de retiro para revisar." />
      ) : (
        <DataTable label="Cola de retiros manuales">
          <thead><tr><th>Usuario</th><th>Envío</th><th>Wallet destino</th><th>Estado</th><th>Referencia / acciones</th></tr></thead>
          <tbody>{rows.map(row => {
            const amount = Math.abs(Number(row.amount) || 0);
            const net = Number(row.net_amount) || amount - (Number(row.fee) || 0);
            const busy = actingId === row.id;
            const origin = row.id.startsWith("CAPITAL-CLAIM-")
              ? null
              : withdrawalSource({
                directCommissionSpent: row.direct_commission_spent,
                weeklyBonusSpent: row.weekly_bonus_spent,
                nodeRoiSpent: row.node_roi_spent,
              });
            return <tr key={row.id}>
              <td><strong>{row.username || row.user_id?.slice(0, 12) || "—"}</strong><small>{dateLabel(row.created_at)}</small><span className={`withdrawal-source-badge source-${origin?.source || "capital"}`}>{origin ? withdrawalSourceLabel[origin.source] : "Capital de nodo"}{origin?.source === "mixed" && <small>Directa {money(origin.direct)} · Miércoles {money(origin.wednesday)}</small>}</span></td>
              <td><strong>{money(net)}</strong><small>Solicitado {money(amount)} · Fee {money(Number(row.fee) || 0)}</small></td>
              <td>
                <span>{row.network || "—"}</span>
                <small className="mono-cell admin-wallet" title={row.wallet || undefined}>{row.wallet || "Wallet no registrada"}</small>
                {row.wallet && <button type="button" className="admin-copy-wallet" onClick={() => void copyWallet(row)}><Copy size={13} /> {copiedId === row.id ? "Copiada" : "Copiar wallet"}</button>}
              </td>
              <td><StatusPill value={row.status} /><small>{row.provider_status || "manual_review"}</small>{row.payable_at && <small>Pago desde {dateLabel(row.payable_at)}</small>}</td>
              <td className="admin-withdrawal-actions">
                {(row.status === "pending" || row.status === "approved") && <input value={reference[row.id] || ""} onChange={event => setReference(current => ({ ...current, [row.id]: event.target.value }))} placeholder={row.status === "approved" ? "TXID / referencia" : "Nota opcional"} aria-label={`Referencia para ${row.id}`} />}
                <div>
                  {row.status === "pending" && <button type="button" className="withdrawal-approve" disabled={busy} onClick={() => void act(row, "approve")}>Aprobar</button>}
                  {row.status === "approved" && <button type="button" className="withdrawal-paid" disabled={busy || !!(row.payable_at && Date.parse(row.payable_at) > Date.now())} onClick={() => void act(row, "mark_paid")}>{busy ? "Guardando…" : "Marcar pagado"}</button>}
                  {(row.status === "pending" || row.status === "approved") && <button type="button" className="withdrawal-reject" disabled={busy} onClick={() => void act(row, "reject")}>Rechazar</button>}
                </div>
              </td>
            </tr>;
          })}</tbody>
        </DataTable>
      )}
    </article>
  );
}

function TransactionsSection({
  rows,
  contractsOnly = false,
}: {
  rows: AdminTransaction[];
  contractsOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () =>
      rows.filter(row =>
        matchesAdminSearch(
          [
            row.id,
            row.username,
            row.type,
            row.status,
            row.network,
            row.providerStatus,
            row.cycle,
          ],
          query
        )
      ),
    [query, rows]
  );
  const title = contractsOnly ? "Contratos" : "Transacciones";
  return (
    <article className="admin-card admin-card-full">
      <div className="card-heading">
        <div>
          <p className="admin-kicker">
            {contractsOnly ? "CONTRACTS / LIFECYCLE" : "TRANSACTIONS / HISTORY"}
          </p>
          <h2>{title}</h2>
        </div>
        <span className="card-status">
          <CheckCircle2 size={15} /> Solo lectura
        </span>
      </div>
      <div className="admin-toolbar">
        <label className="admin-search">
          <Search size={16} />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={`Buscar ${contractsOnly ? "contratos" : "transacciones"}`}
            aria-label={`Buscar ${title.toLowerCase()}`}
          />
        </label>
        <span className="admin-toolbar-note">
          {filtered.length} registro{filtered.length === 1 ? "" : "s"}
        </span>
      </div>
      {!hasRows(rows) ? (
        <EmptyState
          title={`Sin ${title.toLowerCase()}`}
          detail={`No existen registros en ${contractsOnly ? "transactions con tipo contract" : "transactions"}.`}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Sin coincidencias"
          detail="Prueba con otro identificador, usuario, tipo o estado."
        />
      ) : (
        <DataTable label={title}>
          <thead>
            <tr>
              {contractsOnly ? (
                <>
                  <th>ID</th>
                  <th>Usuario</th>
                  <th>Ciclo</th>
                  <th>Monto</th>
                  <th>Estado</th>
                  <th>Fechas</th>
                </>
              ) : (
                <>
                  <th>ID</th>
                  <th>Usuario</th>
                  <th>Tipo</th>
                  <th>Monto</th>
                  <th>Estado</th>
                  <th>Red / wallet</th>
                  <th>Fecha</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.id}>
                <td className="mono-cell">{row.id.slice(0, 18)}</td>
                <td>{row.username || row.userId?.slice(0, 12) || "—"}</td>
                {contractsOnly ? (
                  <>
                    <td>{row.cycle || row.label || "Ciclo no registrado"}</td>
                    <td>
                      <strong>{money(row.amount)}</strong>
                      <small>{row.fee ? `Fee ${money(row.fee)}` : ""}</small>
                    </td>
                    <td>
                      <StatusPill value={row.status} />
                    </td>
                    <td>
                      <span>Inicio {dateLabel(row.startAt)}</span>
                      <small>Fin {dateLabel(row.endAt)}</small>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{statusLabel(row.type)}</td>
                    <td>
                      <strong>{money(row.amount)}</strong>
                      <small>
                        {row.fee
                          ? `Fee ${money(row.fee)}`
                          : row.netAmount
                            ? `Neto ${money(row.netAmount)}`
                            : row.label || ""}
                      </small>
                    </td>
                    <td>
                      <StatusPill value={row.status} />
                    </td>
                    <td>
                      <span>{row.network || "—"}</span>
                      <small className="mono-cell">
                        {row.wallet || "Wallet no registrada"}
                      </small>
                    </td>
                    <td>{dateLabel(row.createdAt)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </article>
  );
}

type ActivationAccount = {
  userId: string; username: string | null; firstActivation: string;
  contracts: number; activatedAmount: number; cryptoDeposits: number;
  manualDeposits: number; otherDeposits: number;
  origin: "crypto" | "manual" | "mixed" | "unverified";
};

function ActivationsSection({ users }: { users: AdminUser[] }) {
  const [accounts, setAccounts] = useState<ActivationAccount[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const session = (await supabase?.auth.getSession())?.data.session;
        if (!session) throw new Error("Sesión administrativa requerida.");
        const response = await fetch("/api/admin/activation-report", { headers: { Authorization: `Bearer ${session.access_token}` } });
        const result = await response.json() as { accounts?: ActivationAccount[]; error?: string };
        if (!response.ok) throw new Error(result.error || "No se pudo consultar el reporte.");
        if (active) { setAccounts(result.accounts ?? []); setError(""); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "No se pudo consultar el reporte.");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [revision]);
  const labels: Record<ActivationAccount["origin"], string> = {
    crypto: "Cripto confirmado", manual: "Crédito manual", mixed: "Origen mixto", unverified: "Sin origen comprobable",
  };
  const visible = filter === "all" ? accounts : accounts.filter(account => account.origin === filter);
  const corporateIds = new Set(users.filter(user => user.corporate).map(user => user.id));
  return <article className="admin-card admin-card-full">
    <div className="card-heading"><div><p className="admin-kicker">ACTIVACIONES / SOLO LECTURA</p><h2>Origen de cuentas activadas</h2></div><button className="admin-refresh" onClick={() => setRevision(value => value + 1)} aria-label="Actualizar activaciones"><RefreshCw size={16} /></button></div>
    <p>Se consideran cuentas con al menos un contrato completado. El origen muestra los depósitos registrados antes de la primera activación; el saldo también puede incluir ganancias o comisiones y no permite atribuir con certeza qué fondos pagaron cada nodo.</p>
    <div className="activation-legend" aria-label="Colores del origen registrado">{(Object.keys(labels) as ActivationAccount["origin"][]).map(origin => <span key={origin} className={`activation-origin-badge activation-origin-badge--${origin}`}>{labels[origin]}</span>)}</div>
    <div className="admin-toolbar"><label>Mostrar: <select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todas ({accounts.length})</option>{(Object.keys(labels) as ActivationAccount["origin"][]).map(key => <option key={key} value={key}>{labels[key]} ({accounts.filter(account => account.origin === key).length})</option>)}</select></label><span className="admin-toolbar-note">{visible.length} cuentas</span></div>
    {error && <div className="admin-data-error" role="alert">{error}</div>}
    {loading ? <LoadingState /> : !error && visible.length === 0 ? <EmptyState title="Sin activaciones" detail="No hay cuentas activadas para este filtro." /> : !error && <DataTable label="Origen de cuentas activadas"><thead><tr><th>Cuenta</th><th>Origen registrado</th><th>Primer nodo</th><th>Nodos</th><th>Total activado</th><th>Cripto confirmado</th><th>Crédito manual</th></tr></thead><tbody>{visible.map(account => <tr key={account.userId} className={`activation-row activation-row--${account.origin}${corporateIds.has(account.userId) ? " admin-corporate-row" : ""}`}><td><strong className="activation-user">{account.username || account.userId.slice(0, 12)}</strong>{corporateIds.has(account.userId) && <span className="admin-corporate-badge">CUENTA CORPORATIVA</span>}</td><td><span className={`activation-origin-badge activation-origin-badge--${account.origin}`}>{labels[account.origin]}</span></td><td>{dateLabel(account.firstActivation)}</td><td>{account.contracts}</td><td>{money(account.activatedAmount)}</td><td>{money(account.cryptoDeposits)}</td><td>{money(account.manualDeposits)}</td></tr>)}</tbody></DataTable>}
  </article>;
}

type DailyReconciliation = {
  date: string; isWednesday: boolean;
  incoming: { crypto: number; cryptoCount: number; manual: number; manualCount: number; capitalReturned: number; capitalCount: number; other: number; otherCount: number };
  withdrawalRequests: { count: number; gross: number };
  outstanding: { count: number; gross: number; net: number; direct: number; weekly: number; nodeRoi: number; unallocated: number };
  commissions: { direct: number; other: number }; cancelledNodes: number;
};

function DailyReconciliationSection() {
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const [from, setFrom] = useState(() => { const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); const start = new Date(`${day}T12:00:00Z`); start.setUTCDate(start.getUTCDate() - 6); return start.toISOString().slice(0, 10); });
  const [to, setTo] = useState(date);
  const [weekday, setWeekday] = useState("all");
  const [days, setDays] = useState<Array<Omit<DailyReconciliation, "outstanding">>>([]);
  const [daysLoading, setDaysLoading] = useState(true);
  const [daysError, setDaysError] = useState("");
  const [report, setReport] = useState<DailyReconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true);
    void (async () => {
      try {
        const session = (await supabase?.auth.getSession())?.data.session;
        if (!session) throw new Error("Sesión administrativa requerida.");
        const response = await fetch(`/api/admin/daily-reconciliation?date=${encodeURIComponent(date)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
        const body = await response.json() as DailyReconciliation & { error?: string };
        if (!response.ok) throw new Error(body.error || "No se pudo cargar el cuadre.");
        if (active) { setReport(body); setError(""); }
      } catch (cause) { if (active) { setReport(null); setError(cause instanceof Error ? cause.message : "No se pudo cargar el cuadre."); } }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [date, revision]);
  useEffect(() => {
    let active = true;
    if (!from || !to || from > to) { setDaysError("La fecha inicial debe ser anterior o igual a la final."); setDays([]); setDaysLoading(false); return; }
    const span = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
    if (span > 30) { setDaysError("Selecciona un máximo de 31 días."); setDays([]); setDaysLoading(false); return; }
    setDaysLoading(true);
    void (async () => {
      try {
        const session = (await supabase?.auth.getSession())?.data.session;
        if (!session) throw new Error("Sesión administrativa requerida.");
        const response = await fetch(`/api/admin/daily-reconciliation?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
        const body = await response.json() as { days?: Array<Omit<DailyReconciliation, "outstanding">>; error?: string };
        if (!response.ok) throw new Error(body.error || "No se pudieron cargar los días.");
        if (active) { setDays(body.days ?? []); setDaysError(""); }
      } catch (cause) { if (active) { setDays([]); setDaysError(cause instanceof Error ? cause.message : "No se pudieron cargar los días."); } }
      finally { if (active) setDaysLoading(false); }
    })();
    return () => { active = false; };
  }, [from, to, revision]);
  const weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const visibleDays = weekday === "all" ? days : days.filter(day => new Date(`${day.date}T12:00:00Z`).getUTCDay() === Number(weekday));
  return <article className="admin-card admin-card-full">
    <div className="card-heading"><div><p className="admin-kicker">CONTABILIDAD / HORA DE CIUDAD DE MÉXICO</p><h2>Cuadre diario</h2></div><button className="admin-refresh" onClick={() => setRevision(value => value + 1)} aria-label="Actualizar cuadre"><RefreshCw size={16} /></button></div>
    <div className="admin-toolbar"><label>Fecha <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>{report?.isWednesday && <span className="card-status">Miércoles · ventana semanal 08:00–15:00</span>}</div>
    <p>Entradas externas, créditos internos, comisiones y retiros se muestran separados para evitar sumar dos veces el mismo dinero.</p>
    <div className="admin-toolbar admin-day-filters"><label>Desde <input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>Hasta <input type="date" value={to} onChange={event => setTo(event.target.value)} /></label><label>Día <select value={weekday} onChange={event => setWeekday(event.target.value)}><option value="all">Todos los días</option>{weekdays.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label></div>
    {daysError && <div className="admin-data-error" role="alert">{daysError}</div>}
    {daysLoading ? <p className="config-note">Cargando días…</p> : !daysError && <><p className="config-note">{visibleDays.length} días mostrados · selecciona una fecha para ver su detalle.</p><DataTable label="Cuadre por día"><thead><tr><th>Fecha</th><th>Cripto</th><th>Manual</th><th>Capital devuelto</th><th>Comisiones</th><th>Retiros solicitados</th><th>Nodos cancelados</th><th /></tr></thead><tbody>{visibleDays.map(day => <tr key={day.date}><td>{day.date} · {weekdays[new Date(`${day.date}T12:00:00Z`).getUTCDay()]}</td><td>{money(day.incoming.crypto)}</td><td>{money(day.incoming.manual)}</td><td>{money(day.incoming.capitalReturned)}</td><td>{money(day.commissions.direct + day.commissions.other)}</td><td>{money(day.withdrawalRequests.gross)}</td><td>{day.cancelledNodes}</td><td><button className="admin-refresh" type="button" onClick={() => setDate(day.date)}>Ver detalle</button></td></tr>)}</tbody></DataTable></>}
    {error && <div className="admin-data-error" role="alert">{error}</div>}
    {loading ? <LoadingState /> : report && <>
      <div className="admin-grid">
        <article className="admin-metric admin-income-total">
          <div className="metric-icon"><CircleDollarSign size={24} /></div>
          <p>Total de ingresos</p>
          <strong>{money(report.incoming.crypto + report.incoming.manual + report.incoming.other)}</strong>
          <small>{report.date} · Cripto + créditos manuales + otros depósitos. Excluye capital devuelto, cashback y comisiones.</small>
        </article>
        <article className="admin-metric"><p>Entró por cripto confirmado</p><strong>{money(report.incoming.crypto)}</strong><small>{report.incoming.cryptoCount} depósitos</small></article>
        <article className="admin-metric"><p>Créditos manuales</p><strong>{money(report.incoming.manual)}</strong><small>{report.incoming.manualCount} movimientos</small></article>
        <article className="admin-metric"><p>Capital devuelto de nodos</p><strong>{money(report.incoming.capitalReturned)}</strong><small>{report.incoming.capitalCount} créditos internos · {report.cancelledNodes} nodos cancelados</small></article>
        <article className="admin-metric"><p>Otros depósitos</p><strong>{money(report.incoming.other)}</strong><small>{report.incoming.otherCount} movimientos sin origen confirmado</small></article>
        <article className="admin-metric"><p>Comisiones acreditadas</p><strong>{money(report.commissions.direct + report.commissions.other)}</strong><small>Directa {money(report.commissions.direct)} · demás {money(report.commissions.other)}</small></article>
        <article className="admin-metric"><p>Retiros solicitados en la fecha</p><strong>{money(report.withdrawalRequests.gross)}</strong><small>{report.withdrawalRequests.count} solicitudes, cualquier estado actual</small></article>
        <article className="admin-metric"><p>Retiros pendientes actuales</p><strong>{money(report.outstanding.gross)}</strong><small>{report.outstanding.count} pendientes o aprobados · neto {money(report.outstanding.net)}</small></article>
      </div>
      <div className="admin-binary-card"><div><p className="admin-kicker">DESGLOSE DE RETIROS PENDIENTES ACTUALES</p><h2>Reservas por origen</h2><p>La fecha de solicitud puede ser anterior al día consultado. Los retiros históricos sin atribución quedan en «Sin clasificar».</p></div><div className="binary-stats"><div><span>Comisión directa</span><strong>{money(report.outstanding.direct)}</strong></div><div><span>Bonos semanales</span><strong>{money(report.outstanding.weekly)}</strong></div><div><span>Rendimiento de nodos</span><strong>{money(report.outstanding.nodeRoi)}</strong></div><div><span>Sin clasificar</span><strong>{money(report.outstanding.unallocated)}</strong></div></div></div>
      <p>Los retiros pagados no tienen una fecha de pago independiente en el registro actual; por eso este cuadre muestra solicitudes por fecha y reservas pendientes al momento de consultar.</p>
    </>}
  </article>;
}

function CommissionsSection({ data }: { data: AdminData }) {
  const [userId, setUserId] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const usersById = useMemo(() => new Map(data.users.map(user => [user.id, user])), [data.users]);
  const networkMetrics = data.commissions.networkMetrics ?? [];
  const networkMetricsById = useMemo(() => new Map(networkMetrics.map(row => [row.userId, row])), [networkMetrics]);
  const filtered = useMemo(() => data.commissions.entries.filter(row => {
    const beneficiary = row.beneficiaryId ? usersById.get(row.beneficiaryId) : undefined;
    const source = row.sourceUserId ? usersById.get(row.sourceUserId) : undefined;
    const haystack = [beneficiary?.username, beneficiary?.email, source?.username, source?.email, row.sourceEventId]
      .filter(Boolean).join(" ").toLocaleLowerCase();
    const created = row.createdAt ? new Date(row.createdAt).getTime() : 0;
    return (!userId || row.beneficiaryId === userId)
      && (!type || row.type === type)
      && (!status || row.status === status)
      && (!from || created >= new Date(`${from}T00:00:00`).getTime())
      && (!to || created <= new Date(`${to}T23:59:59.999`).getTime())
      && (!query.trim() || haystack.includes(query.trim().toLocaleLowerCase()));
  }), [data.commissions.entries, from, query, status, to, type, userId, usersById]);
  const filteredTotal = filtered.reduce((sum, row) => sum + row.amount, 0);
  const visibleNetworkMetrics = useMemo(() => networkMetrics.filter(row => {
    if (userId && row.userId !== userId) return false;
    if (!query.trim()) return true;
    const user = usersById.get(row.userId);
    return [user?.username, user?.email, user?.displayName]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }).sort((a, b) => b.networkVolume - a.networkVolume), [networkMetrics, query, userId, usersById]);
  const selectedNetwork = userId ? networkMetricsById.get(userId) : undefined;
  const clearFilters = () => { setUserId(""); setType(""); setStatus(""); setFrom(""); setTo(""); setQuery(""); };
  return (
    <>
      <div className="admin-grid">
        <article className="admin-metric">
          <div className="metric-icon">
            <CircleDollarSign size={18} />
          </div>
          <p>Bono directo / 10%</p>
          <strong>{money(data.commissions.direct)}</strong>
          <small>Fuente: commission_ledger</small>
        </article>
        <article className="admin-metric">
          <div className="metric-icon">
            <BarChart3 size={18} />
          </div>
          <p>Bono binario / 8%</p>
          <strong>{money(data.commissions.binary)}</strong>
          <small>Volumen emparejado server-side</small>
        </article>
        <article className="admin-metric">
          <div className="metric-icon">
            <WalletCards size={18} />
          </div>
          <p>Total acreditado</p>
          <strong>{money(data.commissions.total)}</strong>
          <small>Entradas con estado credited</small>
        </article>
        <article className="admin-metric">
          <div className="metric-icon">
            <FileClock size={18} />
          </div>
          <p>Pendiente de revisión</p>
          <strong>{money(data.commissions.pending)}</strong>
          <small>No se procesa desde el navegador</small>
        </article>
      </div>
      <div className="admin-binary-card">
        <div>
          <p className="admin-kicker">NETWORK VOLUME</p>
          <h2>Balance de piernas</h2>
          <p>
            El emparejamiento usa el menor volumen disponible de izquierda y
            derecha.
          </p>
        </div>
        <div className="binary-stats">
          <div>
            <span>Izquierda</span>
            <strong>{money(data.binaryVolume.left)}</strong>
          </div>
          <div>
            <span>Derecha</span>
            <strong>{money(data.binaryVolume.right)}</strong>
          </div>
          <div>
            <span>Matched</span>
            <strong>{money(data.binaryVolume.matched)}</strong>
          </div>
          <div>
            <span>Rate</span>
            <strong>8%</strong>
          </div>
        </div>
        <span className="binary-status">
          {statusLabel(data.binaryVolume.status)}
        </span>
      </div>
      <article className="admin-card admin-card-full">
        <div className="card-heading">
          <div>
            <p className="admin-kicker">COMMISSION LEDGER / READ ONLY</p>
            <h2>Detalle de comisiones</h2>
          </div>
          <span className="card-status">
            <CheckCircle2 size={15} /> Sin acciones de crédito
          </span>
        </div>
        <div className="commission-filter-summary">
          <strong>{filtered.length} comisiones</strong>
          <span>{money(filteredTotal)} en el resultado filtrado</span>
        </div>
        <div className="admin-commission-filters">
          <label>Buscar<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Usuario, correo o evento" /></label>
          <label>Beneficiario<select value={userId} onChange={event => setUserId(event.target.value)}><option value="">Todos</option>{data.users.map(user => <option key={user.id} value={user.id}>{user.username || user.email || user.id.slice(0, 8)}</option>)}</select></label>
          <label>Tipo<select value={type} onChange={event => setType(event.target.value)}><option value="">Todos</option><option value="direct">Directa</option><option value="binary">Binaria</option></select></label>
          <label>Estado<select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos</option><option value="credited">Acreditada</option><option value="pending">Pendiente</option></select></label>
          <label>Desde<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
          <label>Hasta<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
          <button type="button" className="admin-refresh" onClick={clearFilters}>Limpiar filtros</button>
        </div>
        {selectedNetwork && (
          <div className="admin-network-summary">
            <div><span>Directos</span><strong>{selectedNetwork.directCount}</strong></div>
            <div><span>Indirectos</span><strong>{selectedNetwork.indirectCount}</strong></div>
            <div><span>Volumen de la red</span><strong>{money(selectedNetwork.networkVolume)}</strong></div>
            <div><span>Total organización</span><strong>{money(selectedNetwork.organizationVolume)}</strong></div>
          </div>
        )}
        <DataTable label="Volumen movido por usuario y su red">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Directos</th>
              <th>Indirectos</th>
              <th>Total red</th>
              <th>Volumen personal</th>
              <th>Volumen de su red</th>
              <th>Total organización</th>
            </tr>
          </thead>
          <tbody>
            {visibleNetworkMetrics.map(row => {
              const user = usersById.get(row.userId);
              return (
                <tr key={row.userId}>
                  <td><strong>{user?.username || user?.displayName || "Sin usuario"}</strong><small>{user?.email || row.userId.slice(0, 12)}</small></td>
                  <td>{row.directCount}</td>
                  <td>{row.indirectCount}</td>
                  <td>{row.networkCount}</td>
                  <td>{money(row.personalVolume)}</td>
                  <td><strong>{money(row.networkVolume)}</strong></td>
                  <td>{money(row.organizationVolume)}</td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
        <p className="config-note admin-network-note">El volumen de la red suma contratos y activaciones no fallidas de todos los referidos directos e indirectos según profiles.sponsor_id. El total organización agrega el volumen personal del usuario.</p>
        {filtered.length === 0 ? (
          <EmptyState
            title="Sin comisiones"
            detail="No hay entradas que coincidan con los filtros seleccionados."
          />
        ) : (
          <DataTable label="Detalle de comisiones">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Beneficiario</th>
                <th>Usuario origen</th>
                <th>Monto</th>
                <th>Pierna</th>
                <th>Estado</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => {
                const beneficiary = row.beneficiaryId ? usersById.get(row.beneficiaryId) : undefined;
                const source = row.sourceUserId ? usersById.get(row.sourceUserId) : undefined;
                return (
                <tr key={row.id || row.sourceEventId}>
                  <td>{statusLabel(row.type)}</td>
                  <td><strong>{beneficiary?.username || "Sin usuario"}</strong><small>{beneficiary?.email || row.beneficiaryId?.slice(0, 12) || "—"}</small></td>
                  <td><strong>{source?.username || "Sin usuario"}</strong><small>{source?.email || row.sourceUserId?.slice(0, 12) || "—"}</small></td>
                  <td>
                    <strong>{money(row.amount)}</strong>
                    <small>
                      {row.rate ? `${row.rate * 100}%` : "Tasa no registrada"}
                    </small>
                  </td>
                  <td>{row.leg || "—"}</td>
                  <td>
                    <StatusPill value={row.status} />
                  </td>
                  <td>{dateLabel(row.createdAt)}</td>
                </tr>
              );})}
            </tbody>
          </DataTable>
        )}
      </article>
    </>
  );
}

function ConfigurationSection({
  apiState,
  data,
}: {
  apiState: ApiState;
  data: AdminData | null;
}) {
  const [withdrawalWindow, setWithdrawalWindow] = useState(false);
  const [windowBusy, setWindowBusy] = useState(false);
  const [windowMessage, setWindowMessage] = useState("");
  const [supportWhatsapp, setSupportWhatsapp] = useState("");
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportMessage, setSupportMessage] = useState("");
  useEffect(() => {
    void (async () => {
      const session = (await supabase?.auth.getSession())?.data.session;
      if (!session) return;
      const response = await fetch("/api/admin/withdrawal-window", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const body = await response.json().catch(() => ({})) as { enabled?: boolean };
      if (response.ok) setWithdrawalWindow(body.enabled === true);
    })();
  }, []);
  useEffect(() => {
    void (async () => {
      const session = (await supabase?.auth.getSession())?.data.session;
      if (!session) return;
      const response = await fetch("/api/admin/support-whatsapp", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const body = await response.json().catch(() => ({})) as { number?: string };
      if (response.ok) setSupportWhatsapp(String(body.number || ""));
    })();
  }, []);
  async function saveSupportWhatsapp() {
    setSupportBusy(true); setSupportMessage("");
    try {
      const session = (await supabase?.auth.getSession())?.data.session;
      if (!session) throw new Error("Sesión administrativa requerida.");
      const response = await fetch("/api/admin/support-whatsapp", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ number: supportWhatsapp }) });
      const body = await response.json().catch(() => ({})) as { number?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "No se pudo guardar el número.");
      setSupportWhatsapp(String(body.number || "")); setSupportMessage("WhatsApp de soporte actualizado.");
    } catch (error) { setSupportMessage(error instanceof Error ? error.message : "No se pudo guardar el número."); }
    finally { setSupportBusy(false); }
  }
  async function toggleWithdrawalWindow() {
    setWindowBusy(true); setWindowMessage("");
    try {
      const session = (await supabase?.auth.getSession())?.data.session;
      if (!session) throw new Error("Sesión administrativa requerida.");
      const enabled = !withdrawalWindow;
      const response = await fetch("/api/admin/withdrawal-window", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ enabled }) });
      const body = await response.json().catch(() => ({})) as { enabled?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || "No se pudo actualizar la ventana.");
      setWithdrawalWindow(body.enabled === true);
      setWindowMessage(body.enabled ? "Control global activo: comisión directa tras 24 horas; bonos y ROI de plazo fijo, miércoles 8:00–15:00 de Ciudad de México." : "Control global suspendido: las nuevas solicitudes están bloqueadas.");
    } catch (error) { setWindowMessage(error instanceof Error ? error.message : "No se pudo actualizar la ventana."); }
    finally { setWindowBusy(false); }
  }
  return (
    <div>
      <MonthlyRoiControl />
      <article className="admin-card admin-card-full admin-support-whatsapp">
        <div className="card-heading"><div><p className="admin-kicker">USER SUPPORT</p><h2>WhatsApp de soporte</h2></div></div>
        <p className="config-note">Este número aparece en el botón flotante del dashboard. Escríbelo con código de país.</p>
        <div className="admin-support-row">
          <input value={supportWhatsapp} onChange={event => setSupportWhatsapp(event.target.value)} placeholder="18095551234" inputMode="tel" aria-label="Número de WhatsApp de soporte" />
          <button className="admin-user-save" type="button" onClick={() => void saveSupportWhatsapp()} disabled={supportBusy}>{supportBusy ? "Guardando…" : "Guardar WhatsApp"}</button>
        </div>
        {supportMessage && <p className="config-note" role="status">{supportMessage}</p>}
      </article>
      <article className="admin-card admin-card-full admin-withdrawal-window">
        <div className="card-heading">
          <div><p className="admin-kicker">WITHDRAWAL CONTROL</p><h2>Control global de retiros</h2></div>
          <span className={`card-status ${withdrawalWindow ? "is-open" : ""}`}><i className={`runtime-dot ${withdrawalWindow ? "ready" : "idle"}`} /> {withdrawalWindow ? "ACTIVO" : "SUSPENDIDO"}</span>
        </div>
        <p className="config-note">Este control puede suspender todas las solicitudes. Con el control activo, comisión directa: tras 24 horas; bonos binario/rango y ROI de nodos de plazo fijo: miércoles 8:00–15:00 de Ciudad de México. El pago se procesa manualmente hasta en 48 horas.</p>
        <button className="admin-user-save" type="button" onClick={() => void toggleWithdrawalWindow()} disabled={windowBusy}>{windowBusy ? "Actualizando…" : withdrawalWindow ? "Suspender retiros" : "Activar retiros"}</button>
        {windowMessage && <p className="config-note" role="status">{windowMessage}</p>}
      </article>
      <div className="admin-columns">
      <article className="admin-card admin-card-large">
        <div className="card-heading">
          <div>
            <p className="admin-kicker">SECURITY / ACCESS</p>
            <h2>Configuración activa</h2>
          </div>
          <span className="card-status">
            <CheckCircle2 size={15} /> Protegida
          </span>
        </div>
        <div className="runtime-row">
          <span>
            <i className="runtime-dot ready" />
            Acceso seguro + perfil admin
          </span>
          <b>ACTIVO</b>
        </div>
        <div className="runtime-row">
          <span>
            <i
              className={`runtime-dot ${apiState === "ready" ? "ready" : "idle"}`}
            />
            Funciones nativas Vercel
          </span>
          <b>{apiState === "ready" ? "ACTIVO" : "BLOQUEADO"}</b>
        </div>
        <div className="runtime-row">
          <span>
            <i className="runtime-dot ready" />
            Modo de escritura administrativa
          </span>
          <b>DESACTIVADO</b>
        </div>
        <div className="runtime-row">
          <span>
            <i className="runtime-dot ready" />
            Bono directo / binario
          </span>
          <b>10% / 8%</b>
        </div>
        <p className="config-note">
          Las acciones de crédito financiero y procesamiento de contratos
          permanecen fuera de esta consola. Este bloque únicamente lee datos
          agregados y registros existentes.
        </p>
      </article>
      <article className="admin-card">
        <div className="card-heading">
          <div>
            <p className="admin-kicker">DATA FRESHNESS</p>
            <h2>Estado de datos</h2>
          </div>
        </div>
        <div className="runtime-row">
          <span>Última consulta</span>
          <b>{data ? dateLabel(data.lastUpdated) : "—"}</b>
        </div>
        <div className="runtime-row">
          <span>Tablas consultadas</span>
          <b>5</b>
        </div>
        <div className="runtime-row">
          <span>Filas de red</span>
          <b>{compactNumber(data?.metrics.networkVolumes)}</b>
        </div>
        <code>Cache-Control: no-store</code>
      </article>
      </div>
    </div>
  );
}

export default function Admin() {
  const [open, setOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionName>("Resumen");
  const [apiState, setApiState] = useState<ApiState>("locked");
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState("");
  const [authError, setAuthError] = useState("");
  const [dataError, setDataError] = useState("");
  const [adminData, setAdminData] = useState<AdminData | null>(null);

  useEffect(() => {
    if (!supabase) {
      setApiState("offline");
      setAuthError("Falta la configuración pública del servicio de acceso.");
      return;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted && session) validateSession(session.access_token);
      else if (mounted) setApiState("locked");
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) validateSession(session.access_token);
      else {
        setIsAuthorized(false);
        setAdminData(null);
        setApiState("locked");
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function loadAdminData(accessToken: string) {
    setDataError("");
    const response = await fetch("/api/admin/data", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const body = (await response.json().catch(() => ({}))) as AdminData &
      ApiError;
    if (!response.ok)
      throw new Error(
        body.error || "No se pudieron cargar los datos administrativos."
      );
    setAdminData(body);
  }

  async function validateSession(accessToken: string) {
    setApiState("checking");
    setAuthError("");
    try {
      const response = await fetch("/api/admin", {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const body = (await response.json().catch(() => ({}))) as ApiError & {
        user?: { email?: string; role?: string };
      };
      if (!response.ok) {
        setIsAuthorized(false);
        setApiState(
          response.status === 401 || response.status === 403
            ? "locked"
            : "offline"
        );
        setAuthError(
          body.error ?? "La sesión no tiene permisos administrativos."
        );
        return;
      }
      setIsAuthorized(true);
      setUserEmail(body.user?.email ?? "");
      setUserRole(body.user?.role ?? "admin");
      setApiState("ready");
      try {
        await loadAdminData(accessToken);
      } catch (error) {
        setDataError(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los datos administrativos."
        );
      }
    } catch {
      setIsAuthorized(false);
      setApiState("offline");
      setAuthError("No se pudo conectar con la función nativa.");
    }
  }

  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    if (!supabase) {
      setAuthError("El servicio de acceso no está configurado en este entorno.");
      return;
    }
    setApiState("checking");
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setPassword("");
    if (error || !data.session) {
      setApiState("locked");
      setAuthError(error?.message ?? "No se pudo iniciar sesión.");
      return;
    }
    await validateSession(data.session.access_token);
  }

  async function refreshData() {
    const {
      data: { session },
    } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    if (session)
      await loadAdminData(session.access_token).catch(error =>
        setDataError(
          error instanceof Error
            ? error.message
            : "No se pudieron actualizar los datos."
        )
      );
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setIsAuthorized(false);
    setUserEmail("");
    setUserRole("");
    setAdminData(null);
    setApiState("locked");
  }

  const apiLabel =
    apiState === "checking"
      ? "Verificando función"
      : apiState === "ready"
        ? "Función protegida activa"
        : apiState === "locked"
          ? "API protegida · credencial requerida"
          : "API no disponible";
  const ActiveIcon = sectionIcons[activeSection];

  if (!isAuthorized)
    return (
      <main className="admin-shell admin-gate-shell">
        <section className="admin-gate">
          <BrandMark className="admin-official-logo admin-gate-logo" />
          <p className="admin-kicker">BITNODE / PRIVATE OPERATIONS</p>
          <h1>Acceso administrativo</h1>
          <p>
              Inicia sesión con tu cuenta. La función server-side verificará el
            token y consultará el rol administrativo en <code>profiles</code>.
          </p>
          <form onSubmit={authorize} className="admin-gate-form">
            <label htmlFor="admin-email">Correo administrativo</label>
            <input
              id="admin-email"
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="admin@bitnode.space"
              autoComplete="username"
              required
            />
            <label htmlFor="admin-password">Contraseña</label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="Contraseña"
              autoComplete="current-password"
              required
            />
            <button type="submit" disabled={apiState === "checking"}>
              {apiState === "checking"
                ? "Verificando sesión…"
                : "Entrar a la consola"}
            </button>
          </form>
          {authError && (
            <p className="admin-auth-error" role="alert">
              {authError}
            </p>
          )}
          <Link href="/" className="admin-back">
            <ArrowLeft size={15} /> Volver a BitNode
          </Link>
        </section>
      </main>
    );

  return (
    <main className="admin-shell">
      {open && <button type="button" className="admin-sidebar-backdrop" aria-label="Cerrar menú lateral" onClick={() => setOpen(false)} />}
      <aside className={`admin-sidebar ${open ? "is-open" : ""}`}>
        <div className="admin-brand-row">
          <BrandMark className="admin-official-logo" />
          <div>
            <small>OPERATIONS CONSOLE</small>
          </div>
          <button
            className="admin-close"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="admin-env">
          <i /> PRODUCTION / CONTROLLED WRITES
        </div>
        <nav className="admin-nav" aria-label="Secciones administrativas">
          {sections.map(section => {
            const Icon = sectionIcons[section];
            return (
              <button
                key={section}
                className={activeSection === section ? "active" : ""}
                onClick={() => {
                  setActiveSection(section);
                  setOpen(false);
                  window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
                }}
              >
                <span>
                  <Icon size={16} />
                </span>
                {section}
              </button>
            );
          })}
        </nav>
        <div className="admin-side-note">
          <LockKeyhole size={16} />
          <p>
            Los depósitos administrativos están habilitados y quedan registrados
            como transacciones completadas.
          </p>
        </div>
        <Link href="/" className="admin-back">
          <ArrowLeft size={15} /> Volver a BitNode
        </Link>
      </aside>
      <section className="admin-content">
        <header className="admin-header">
          <button
            className="admin-menu"
            aria-label="Abrir menú"
            onClick={() => setOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div>
            <p className="admin-kicker">
              ADMIN / {activeSection.toUpperCase()}
            </p>
            <h1>
              <ActiveIcon size={24} /> {activeSection}
            </h1>
          </div>
          <div className="admin-header-right">
            <span className={`api-badge ${apiState}`}>
              <i />
              {apiLabel}
            </span>
            <span className="admin-user">
              {userEmail} · {userRole}
            </span>
            <button className="admin-logout" onClick={signOut}>
              Salir
            </button>
            <div className="admin-avatar">OP</div>
          </div>
        </header>
        <div className="admin-warning">
          <ShieldCheck size={17} />
          <span>
            <strong>Consola protegida con escritura controlada.</strong> Los depósitos
            se procesan server-side; la tasa directa es 10% y la binaria es 8%.
          </span>
          <button
            className="admin-refresh"
            onClick={refreshData}
            aria-label="Actualizar datos"
          >
            <RefreshCw size={15} />
          </button>
        </div>
        {dataError && (
          <div className="admin-data-error" role="alert">
            {dataError}
            <button onClick={refreshData}>Reintentar</button>
          </div>
        )}
        {activeSection === "Resumen" && <SummarySection data={adminData} />}
        {activeSection === "Usuarios" &&
          (adminData ? (
            <UsersSection data={adminData} onUpdated={refreshData} />
          ) : (
            <LoadingState />
          ))}
        {activeSection === "Operaciones" &&
          (adminData ? (
            <OperationsSection users={adminData.users} onCompleted={refreshData} />
          ) : (
            <LoadingState />
          ))}
        {activeSection === "Retiros" &&
          (adminData ? <WithdrawalsSection onCompleted={refreshData} /> : <LoadingState />)}
        {activeSection === "Contratos" &&
          (adminData ? (
            <TransactionsSection rows={adminData.contracts} contractsOnly />
          ) : (
            <LoadingState />
          ))}
        {activeSection === "Activaciones" && <ActivationsSection users={adminData?.users ?? []} />}
        {activeSection === "Cuadre diario" && <DailyReconciliationSection />}
        {activeSection === "Control de nodos" && <NodeControlSection />}
        {activeSection === "Transacciones" &&
          (adminData ? (
            <TransactionsSection rows={adminData.transactions} />
          ) : (
            <LoadingState />
          ))}
        {activeSection === "Comisiones" &&
          (adminData ? (
            <CommissionsSection data={adminData} />
          ) : (
            <LoadingState />
          ))}
        {activeSection === "Configuración" && (
          <ConfigurationSection apiState={apiState} data={adminData} />
        )}
      </section>
    </main>
  );
}

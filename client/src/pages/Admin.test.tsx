// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Admin, { UsersSection } from "./Admin";

const mocks = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({ supabase: mocks }));

const baseData = {
  status: "ready" as const,
  readOnly: true,
  lastUpdated: "2026-08-22T12:00:00Z",
  metrics: { users: 1, contracts: 1, contractVolume: 100, transactions: 1, pendingTransactions: 0, pendingCommissions: 0, creditedCommissions: 10, networkVolumes: 2 },
  users: [{ id: "user-1", username: "admin", displayName: "Admin", email: "admin@example.com", role: "admin", sponsorId: null, createdAt: "2026-08-20T00:00:00Z", lastSignInAt: "2026-08-22T11:00:00Z", emailConfirmedAt: "2026-08-20T00:00:00Z", bannedUntil: null, status: "activo" }],
  contracts: [{ id: "contract-1", userId: "user-1", username: "admin", type: "contract", label: "Nodo 7 Días", cycle: "Nodo 7 Días", amount: 100, status: "confirmed", network: null, wallet: null, fee: 0, netAmount: 100, providerStatus: null, startAt: "2026-08-22T00:00:00Z", endAt: null, createdAt: "2026-08-22T00:00:00Z" }],
  transactions: [{ id: "tx-1", userId: "user-1", username: "admin", type: "deposit", label: "Depósito", amount: 100, status: "completed", network: "TRC20", wallet: "TAbc…xyz", fee: 0, netAmount: 100, providerStatus: "confirmed", cycle: null, startAt: null, endAt: null, createdAt: "2026-08-22T00:00:00Z" }],
  commissions: { configuredDirectRate: 0.1, configuredBinaryRate: 0.1, direct: 10, binary: 0, total: 10, pending: 0, entries: [] },
  binaryVolume: { left: 100, right: 60, matched: 60, status: "paired" },
};

function okResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function prepareAuthorized(fetchMock: ReturnType<typeof vi.fn>, data: unknown = baseData) {
  mocks.auth.getSession.mockResolvedValue({ data: { session: { access_token: "admin-token" } } });
  mocks.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  fetchMock.mockResolvedValueOnce(okResponse({ user: { email: "admin@example.com", role: "admin" } }));
  fetchMock.mockResolvedValueOnce(okResponse(data));
  vi.stubGlobal("fetch", fetchMock);
}

describe("Admin panel UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.signOut.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders real sections and filters users in the UI", async () => {
    const fetchMock = vi.fn();
    prepareAuthorized(fetchMock);
    render(<Admin />);

    expect(await screen.findByRole("heading", { name: "Resumen" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Usuarios" })[0]);
    expect(await screen.findByRole("heading", { name: "Usuarios registrados" })).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Buscar usuarios" }), { target: { value: "nobody" } });
    expect(screen.getByText("Sin coincidencias")).toBeInTheDocument();
  });

  it("renders the empty state for a section with no rows", () => {
    render(<UsersSection users={[]} />);
    expect(screen.getByText("0 perfiles")).toBeInTheDocument();
    expect(screen.getByText("Sin usuarios")).toBeInTheDocument();
  });

  it("renders the server error state without exposing implementation details", async () => {
    const fetchMock = vi.fn();
    mocks.auth.getSession.mockResolvedValue({ data: { session: { access_token: "admin-token" } } });
    mocks.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    fetchMock.mockResolvedValueOnce(okResponse({ user: { email: "admin@example.com", role: "admin" } }));
    fetchMock.mockResolvedValueOnce(okResponse({ error: "No se pudieron cargar los datos administrativos.", status: "unavailable" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    render(<Admin />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar los datos administrativos.");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

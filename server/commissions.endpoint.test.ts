import { describe, expect, it, vi } from "vitest";
import { processContractCommissionsWithClient, summarizeCommissionRows, validateCommissionEventInput } from "./commissions";

describe("commission endpoint contract", () => {
  it("accepts only a positive, fully identified commission event", () => {
    expect(validateCommissionEventInput({
      sourceEventId: "contract:c-100:confirmed",
      contractId: "c-100",
      userId: "00000000-0000-0000-0000-000000000001",
      amount: 100,
    })).toBe(true);

    expect(validateCommissionEventInput({
      sourceEventId: "contract:c-100:confirmed",
      contractId: "c-100",
      userId: "00000000-0000-0000-0000-000000000001",
      amount: 0,
    })).toBe(false);
  });

  it("sends trusted identifiers and amount to the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: "processed", direct: 10, binary: 30 },
      error: null,
    });
    const result = await processContractCommissionsWithClient({ rpc }, {
      sourceEventId: "contract:c-100:confirmed",
      contractId: "c-100",
      userId: "00000000-0000-0000-0000-000000000001",
      amount: 100,
    });

    expect(result).toEqual({ status: "processed", direct: 10, binary: 30 });
    expect(rpc).toHaveBeenCalledWith("process_contract_commissions", {
      p_source_event_id: "contract:c-100:confirmed",
      p_contract_id: "c-100",
      p_user_id: "00000000-0000-0000-0000-000000000001",
      p_amount: 100,
      p_event_type: "contract_confirmed",
    });
  });

  it("preserves the duplicate response from the database", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: "duplicate", direct: 0, binary: 0 },
      error: null,
    });
    await expect(processContractCommissionsWithClient({ rpc }, {
      sourceEventId: "contract:c-100:confirmed",
      contractId: "c-100",
      userId: "00000000-0000-0000-0000-000000000001",
      amount: 100,
    })).resolves.toEqual({ status: "duplicate", direct: 0, binary: 0 });
  });

  it("summarizes only credited direct and binary ledger rows", () => {
    expect(summarizeCommissionRows([
      { commission_type: "direct", amount: "10.00", status: "credited" },
      { commission_type: "binary", amount: "30.00", status: "credited" },
      { commission_type: "direct", amount: "99.00", status: "pending" },
      { commission_type: "reversal", amount: "-10.00", status: "credited" },
    ])).toEqual({ direct: 10, binary: 30, total: 40 });
  });
});

/*
  Prueba de integración recomendada en un proyecto Supabase de staging:

  1. Crear un sponsor raíz, un padre binario y un referido con posiciones
     left/right en network_nodes.
  2. Ejecutar process_contract_commissions para un contrato de 100.
  3. Verificar una fila direct de 10 para el sponsor inmediato.
  4. Ejecutar contratos en ambas piernas, por ejemplo 300 en left y 200 en
     right; verificar binary = 20 sobre el volumen emparejado de 200.
  5. Repetir el mismo source_event_id; verificar status = duplicate y que
     commission_ledger no tenga filas adicionales.
  6. Ejecutar dos eventos concurrentes y comprobar que matched_volume y el
     ledger no dupliquen el pago.

  Estas verificaciones deben ejecutarse contra staging, no contra producción.
*/

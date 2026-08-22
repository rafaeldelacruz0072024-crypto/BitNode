import { processContractCommissions } from "./commissions";

export type ContractActivation = {
  sourceEventId: string;
  contractId: string;
  userId: string;
  amount: number;
  status: "pending" | "confirmed" | "failed";
};

/** Server-only contract flow. Commission processing starts only after confirmation. */
export async function activateConfirmedContract(contract: ContractActivation) {
  if (contract.status !== "confirmed") return { status: "skipped", reason: "contract is not confirmed" } as const;
  return processContractCommissions({ sourceEventId: contract.sourceEventId, contractId: contract.contractId, userId: contract.userId, amount: contract.amount });
}

import type { Express } from "express";
import { authenticatedAdmin } from "./adminWithdrawals.js";

type ContractRow = { id: string; user_id: string; plan_id: string; amount: number; status: string; starts_at: string; ends_at: string | null; created_at: string };
type CycleRow = { user_id: string; cycle_day: number; completed_tasks: string[] | null; window_started_at: string | null; deadline_at: string | null; last_completed_at: string | null };
type ResetRow = { id: string; user_id: string; contract_id: string; reason: string; reset_at: string; cycle_day_before: number; completed_tasks_before: string[] | null };

export function registerAdminNodeControlRoutes(app: Express) {
  app.get("/api/admin/node-control", async (req, res) => {
    const admin = await authenticatedAdmin(req);
    if ("error" in admin) return res.status(admin.status ?? 500).json({ error: admin.error });
    const [contractsResult, cyclesResult, resetsResult, profilesResult, plansResult] = await Promise.all([
      admin.client.from("contracts").select("id,user_id,plan_id,amount,status,starts_at,ends_at,created_at").order("created_at", { ascending: false }).limit(1000),
      admin.client.from("daily_task_cycles").select("user_id,cycle_day,completed_tasks,window_started_at,deadline_at,last_completed_at"),
      admin.client.from("node_task_reset_log").select("id,user_id,contract_id,reason,reset_at,cycle_day_before,completed_tasks_before").order("reset_at", { ascending: false }).limit(500),
      admin.client.from("profiles").select("id,username"),
      admin.client.from("plans").select("id,name"),
    ]);
    const error = contractsResult.error || cyclesResult.error || resetsResult.error || profilesResult.error || plansResult.error;
    if (error) return res.status(500).json({ error: "No se pudo cargar el control de nodos.", details: error.message });

    const cycles = new Map((cyclesResult.data as CycleRow[] || []).map(row => [row.user_id, row]));
    const usernames = new Map((profilesResult.data || []).map(row => [row.id, row.username || row.id.slice(0, 8)]));
    const plans = new Map((plansResult.data || []).map(row => [row.id, row.name]));
    const now = Date.now();
    const format = (contract: ContractRow) => {
      const cycle = cycles.get(contract.user_id);
      return {
        ...contract,
        username: usernames.get(contract.user_id) || contract.user_id.slice(0, 8),
        plan_name: plans.get(contract.plan_id) || contract.plan_id,
        cycle_day: cycle?.cycle_day || 0,
        completed_tasks: cycle?.completed_tasks?.length || 0,
        deadline_at: cycle?.deadline_at || null,
      };
    };
    const contracts = (contractsResult.data as ContractRow[] || []);
    const complying = contracts.filter(contract => {
      if (contract.status !== "active") return false;
      const cycle = cycles.get(contract.user_id);
      return Boolean(cycle?.window_started_at && cycle.deadline_at && new Date(cycle.deadline_at).getTime() > now && (cycle.completed_tasks?.length || 0) > 0);
    }).map(format);
    const completed = contracts.filter(contract => ["completed", "expired"].includes(contract.status)).map(format);
    const resetRows = (resetsResult.data as ResetRow[] || []).map(row => ({
      ...row,
      username: usernames.get(row.user_id) || row.user_id.slice(0, 8),
      plan_name: plans.get(contracts.find(contract => contract.id === row.contract_id)?.plan_id || "") || "Nodo",
    }));
    return res.json({ reset: resetRows, complying, completed, totals: { reset: resetRows.length, complying: complying.length, completed: completed.length } });
  });
}

const { useEffect, useMemo, useRef, useState } = React;

const STORAGE_KEY = "finance_goals_app_state_v1";
const STATE_VERSION = 1;

const HoldingType = {
  BANK: "BANK",
  MF: "MF",
  FD: "FD",
  STOCK: "STOCK",
};

const holdingTypeLabels = {
  [HoldingType.BANK]: "Bank balance",
  [HoldingType.MF]: "MF / Mutual fund",
  [HoldingType.FD]: "FD",
  [HoldingType.STOCK]: "Stocks",
};

// 0.0 (stable) -> 1.0 (highly volatile). MVP heuristic.
const volatilityByType = {
  [HoldingType.BANK]: 0.12,
  [HoldingType.FD]: 0.25,
  [HoldingType.MF]: 0.55,
  [HoldingType.STOCK]: 0.72,
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeNumber(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function formatINR(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "₹0";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(x);
  } catch {
    return `₹${Math.round(x).toLocaleString("en-IN")}`;
  }
}

function todayLocalISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISODate(iso) {
  // yyyy-mm-dd
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const da = Number(m[3]);
  const dt = new Date(y, mo, da);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function monthIndex(d) {
  return d.getFullYear() * 12 + d.getMonth();
}

function diffMonths(isoStart, isoEnd) {
  const a = parseISODate(isoStart);
  const b = parseISODate(isoEnd);
  if (!a || !b) return 0;
  return monthIndex(b) - monthIndex(a);
}

function addMonthsISO(isoDate, months) {
  const d = parseISODate(isoDate);
  if (!d) return isoDate;
  const y = d.getFullYear();
  const m = d.getMonth() + months;
  const target = new Date(y, m, d.getDate());
  const y2 = target.getFullYear();
  const m2 = String(target.getMonth() + 1).padStart(2, "0");
  const day2 = String(target.getDate()).padStart(2, "0");
  return `${y2}-${m2}-${day2}`;
}

function generateId() {
  try {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function downloadText(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function normalizeAllocations(allocations) {
  const out = {};
  const src = allocations || {};
  Object.keys(src).forEach((k) => {
    const v = clamp(safeNumber(src[k]), 0, 100);
    if (v > 0) out[k] = v;
  });
  return out;
}

function computeHoldingAllocatedAmount(h, goalId) {
  const pct = clamp(safeNumber(h?.allocations?.[goalId]), 0, 100);
  return (safeNumber(h.amount) * pct) / 100;
}

function computeHoldingAllocatedTotal(h) {
  // Total allocated percentage sum <= 100 enforced by UI, but clamp for safety.
  const amount = safeNumber(h.amount);
  const alloc = normalizeAllocations(h.allocations);
  let total = 0;
  for (const goalId of Object.keys(alloc)) {
    const pct = clamp(safeNumber(alloc[goalId]), 0, 100);
    total += (amount * pct) / 100;
  }
  return total;
}

function getAllocatedPctSumForHolding(h) {
  const alloc = normalizeAllocations(h.allocations);
  let sum = 0;
  for (const k of Object.keys(alloc)) sum += safeNumber(alloc[k]);
  return sum;
}

function buildDefaultState() {
  const today = todayLocalISODate();
  const emergencyId = generateId();
  return {
    version: STATE_VERSION,
    goals: [
      {
        id: emergencyId,
        name: "Emergency Fund",
        targetAmount: 0,
        targetDate: addMonthsISO(today, 12),
        startDate: today,
        isEmergencyFund: true,
        createdAt: today,
      },
    ],
    holdings: [],
    updatedAt: Date.now(),
  };
}

function validateAndCoerceState(unknown) {
  if (!unknown || typeof unknown !== "object") return null;
  if (unknown.version !== STATE_VERSION) return null;
  if (!Array.isArray(unknown.goals) || !Array.isArray(unknown.holdings)) return null;

  const goals = unknown.goals
    .filter((g) => g && typeof g === "object" && typeof g.id === "string")
    .map((g) => ({
      id: String(g.id),
      name: String(g.name || ""),
      targetAmount: safeNumber(g.targetAmount),
      targetDate: String(g.targetDate || ""),
      startDate: String(g.startDate || g.createdAt || todayLocalISODate()),
      isEmergencyFund: Boolean(g.isEmergencyFund),
      createdAt: String(g.createdAt || g.startDate || todayLocalISODate()),
    }));

  // Ensure mandatory emergency fund exists
  let hasEmergency = goals.some((g) => g.isEmergencyFund);
  if (!hasEmergency) {
    const today = todayLocalISODate();
    goals.unshift({
      id: generateId(),
      name: "Emergency Fund",
      targetAmount: 0,
      targetDate: addMonthsISO(today, 12),
      startDate: today,
      isEmergencyFund: true,
      createdAt: today,
    });
  }

  const goalIdSet = new Set(goals.map((g) => g.id));
  const holdings = unknown.holdings
    .filter((h) => h && typeof h === "object" && typeof h.id === "string")
    .map((h) => {
      const type = Object.values(HoldingType).includes(h.type) ? h.type : HoldingType.BANK;
      const allocations = normalizeAllocations(h.allocations);
      // Drop allocations to non-existing goals
      const filteredAllocations = {};
      for (const k of Object.keys(allocations)) {
        if (goalIdSet.has(k)) filteredAllocations[k] = allocations[k];
      }
      return {
        id: String(h.id),
        type,
        name: String(h.name || ""),
        amount: safeNumber(h.amount),
        allocations: filteredAllocations,
      };
    });

  return { version: STATE_VERSION, goals, holdings, updatedAt: Date.now() };
}

function GoalCard({ goal, allocationsSummary }) {
  const { allocatedAmount, allocatedPct, monthlySipNeeded, warnings } = allocationsSummary;
  const pctComplete = goal.targetAmount > 0 ? allocatedAmount / goal.targetAmount : 0;
  const pctCompleteDisplay = goal.targetAmount > 0 ? `${Math.round(pctComplete * 100)}%` : "—";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">{goal.name}</h3>
            {goal.isEmergencyFund ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                Mandatory
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-sm text-slate-600">
            Target: <span className="font-medium">{formatINR(goal.targetAmount)}</span> •{" "}
            <span className="font-medium">{goal.targetDate}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-slate-600">Allocated</div>
          <div className="text-lg font-semibold">{formatINR(allocatedAmount)}</div>
          <div className="mt-1 text-sm text-slate-600">Complete</div>
          <div className="text-lg font-semibold">{pctCompleteDisplay}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="text-sm text-slate-600">Monthly SIP needed</div>
          <div className="text-lg font-semibold">
            {monthlySipNeeded > 0 ? formatINR(monthlySipNeeded) : monthlySipNeeded === 0 ? "₹0" : "—"}
          </div>
        </div>
        <div>
          <div className="text-sm text-slate-600">Allocation weight</div>
          <div className="text-lg font-semibold">{allocatedPct > 0 ? `${Math.round(allocatedPct)}%` : "0%"}</div>
          <div className="text-xs text-slate-500">Share of your total allocated corpus</div>
        </div>
      </div>

      {warnings.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {warnings.map((w, idx) => (
            <span
              key={`${goal.id}_w_${idx}`}
              className={
                w.kind === "danger"
                  ? "rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800"
                  : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
              }
            >
              {w.label}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-4 text-sm text-emerald-700">No warnings</div>
      )}
    </div>
  );
}

function ConfirmDialog({ open, title, description, confirmText, cancelText, onConfirm, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
        <div className="text-lg font-semibold">{title}</div>
        {description ? <div className="mt-2 text-sm text-slate-700">{description}</div> : null}
        <div className="mt-4 flex gap-2 justify-end">
          <button
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            {cancelText || "Cancel"}
          </button>
          <button
            className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
            onClick={onConfirm}
          >
            {confirmText || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Modal({ open, title, children, onClose, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="text-lg font-semibold">{title}</div>
          <button
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
        {footer ? <div className="mt-4">{footer}</div> : null}
      </div>
    </div>
  );
}

function parseNumberInput(s) {
  const n = Number(String(s).trim());
  return Number.isFinite(n) ? n : 0;
}

function App() {
  const [state, setState] = useState(buildDefaultState());
  const [activeTab, setActiveTab] = useState("dashboard"); // dashboard | goals | portfolio

  const [goalEditorId, setGoalEditorId] = useState("new"); // id or "new"
  const [holdingEditor, setHoldingEditor] = useState(null); // {mode:'add'|'edit', holdingId?}

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [confirmDeleteGoalOpen, setConfirmDeleteGoalOpen] = useState(false);
  const [goalToDeleteId, setGoalToDeleteId] = useState(null);

  const fileInputRef = useRef(null);

  // Load state once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const coerced = validateAndCoerceState(parsed);
      if (coerced) setState(coerced);
    } catch (_) {
      // ignore
    }
  }, []);

  // Persist on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      // ignore quota errors
    }
  }, [state]);

  const goals = state.goals;
  const holdings = state.holdings;

  const emergencyGoal = useMemo(() => goals.find((g) => g.isEmergencyFund) || goals[0], [goals]);
  const totalAllocatedCorpus = useMemo(() => {
    let sum = 0;
    const todayGoals = new Set(goals.map((g) => g.id));
    for (const h of holdings) {
      if (!h) continue;
      // allocated portion = sum(amount * pct/100) for existing goals
      for (const gid of Object.keys(h.allocations || {})) {
        if (!todayGoals.has(gid)) continue;
        sum += computeHoldingAllocatedAmount(h, gid);
      }
    }
    return sum;
  }, [holdings, goals]);

  const allocationsByGoal = useMemo(() => {
    // current corpus allocated and weighted volatility
    const byGoal = {};
    for (const g of goals) {
      byGoal[g.id] = {
        allocatedAmount: 0,
        weightedVolatility: 0,
        allocatedWeightTotal: 0,
      };
    }

    for (const h of holdings) {
      if (!h) continue;
      const vol = volatilityByType[h.type] ?? 0.5;
      for (const gid of Object.keys(h.allocations || {})) {
        if (!byGoal[gid]) continue;
        const allocated = computeHoldingAllocatedAmount(h, gid);
        byGoal[gid].allocatedAmount += allocated;
        byGoal[gid].weightedVolatility += vol * allocated;
        byGoal[gid].allocatedWeightTotal += allocated;
      }
    }

    for (const gid of Object.keys(byGoal)) {
      const a = byGoal[gid];
      a.weightedVolatility = a.allocatedWeightTotal > 0 ? a.weightedVolatility / a.allocatedWeightTotal : 0;
    }
    return byGoal;
  }, [holdings, goals]);

  const dashboardSummaries = useMemo(() => {
    const today = todayLocalISODate();
    const byGoal = {};

    for (const g of goals) {
      const allocated = allocationsByGoal[g.id]?.allocatedAmount ?? 0;
      const pctComplete = g.targetAmount > 0 ? allocated / g.targetAmount : 0;

      // Monthly SIP needed (no growth MVP)
      const monthsUntil = diffMonths(today, g.targetDate);
      const monthsUntilClamped = Math.max(0, monthsUntil);
      let monthlySipNeeded = null;
      if (g.targetAmount > 0 && monthsUntilClamped > 0) {
        const remaining = Math.max(0, g.targetAmount - allocated);
        monthlySipNeeded = remaining / monthsUntilClamped;
      } else if (g.targetAmount > 0 && monthsUntilClamped === 0) {
        monthlySipNeeded = 0;
      } else {
        monthlySipNeeded = -1;
      }

      // Warnings
      const warnings = [];

      if (allocated <= 0.0001) {
        warnings.push({ kind: "danger", label: "No allocation yet" });
      }

      // Underfunded heuristic: compare current % with expected % based on elapsed time since goal start.
      const start = g.startDate || g.createdAt || today;
      const monthsElapsed = Math.max(0, diffMonths(start, today));
      const monthsTotal = Math.max(1, diffMonths(start, g.targetDate));
      const expectedPct = clamp(monthsElapsed / monthsTotal, 0, 1);
      const tolerance = 0.08;
      if (g.targetAmount > 0 && allocated > 0 && pctComplete + tolerance < expectedPct && expectedPct < 1) {
        warnings.push({ kind: "danger", label: "Underfunded" });
      }

      // Too volatile: based on weighted volatility and remaining horizon
      const horizonMonths = Math.max(0, diffMonths(today, g.targetDate));
      if (allocated > 0 && horizonMonths > 0) {
        const weightedVol = allocationsByGoal[g.id]?.weightedVolatility ?? 0;
        let allowedMax = 0.75;
        if (horizonMonths <= 12) allowedMax = 0.35;
        else if (horizonMonths <= 36) allowedMax = 0.6;
        else allowedMax = 0.75;
        if (weightedVol > allowedMax + 0.02) {
          warnings.push({ kind: "danger", label: "Too volatile" });
        }
      }

      const allocatedPctOfTotal = totalAllocatedCorpus > 0 ? (allocated / totalAllocatedCorpus) * 100 : 0;

      byGoal[g.id] = {
        allocatedAmount: allocated,
        allocatedPct: allocatedPctOfTotal,
        monthlySipNeeded: monthlySipNeeded,
        warnings,
      };
    }

    return byGoal;
  }, [goals, allocationsByGoal, totalAllocatedCorpus]);

  function setStateAndBump(updater) {
    setState((prev) => {
      const next = updater(prev);
      return { ...next, updatedAt: Date.now() };
    });
  }

  function exportData() {
    const payload = JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
    downloadText("finance-goals-backup.json", payload, "application/json");
  }

  function importDataFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        const coerced = validateAndCoerceState(parsed);
        if (!coerced) {
          alert("Import failed: unsupported or corrupted JSON.");
          return;
        }
        setState(coerced);
        setActiveTab("dashboard");
        setGoalEditorId("new");
        setHoldingEditor(null);
      } catch (_) {
        alert("Import failed: invalid JSON file.");
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    const next = buildDefaultState();
    setState(next);
    setActiveTab("dashboard");
    setGoalEditorId("new");
    setHoldingEditor(null);
    setConfirmResetOpen(false);
  }

  function upsertGoal(goalDraft) {
    if (goalEditorId === "new") {
      const newId = generateId();
      const today = todayLocalISODate();
      setGoalEditorId(newId);
      setStateAndBump((prev) => {
        const newGoal = {
          id: newId,
          name: String(goalDraft.name || "").trim(),
          targetAmount: safeNumber(goalDraft.targetAmount),
          targetDate: String(goalDraft.targetDate || ""),
          startDate: String(goalDraft.startDate || today),
          createdAt: String(goalDraft.startDate || today),
          isEmergencyFund: Boolean(goalDraft.isEmergencyFund),
        };
        const nextGoals = [...prev.goals, newGoal];
        return { ...prev, goals: sortGoals(nextGoals) };
      });
      return;
    }

    setStateAndBump((prev) => {
      const nextGoals = prev.goals.map((g) => {
        if (g.id !== goalEditorId) return g;
        return {
          ...g,
          name: String(goalDraft.name || "").trim(),
          targetAmount: safeNumber(goalDraft.targetAmount),
          targetDate: String(goalDraft.targetDate || ""),
          // Keep existing startDate
        };
      });
      return { ...prev, goals: sortGoals(nextGoals) };
    });
  }

  function deleteGoal(goalId) {
    setStateAndBump((prev) => {
      const nextGoals = prev.goals.filter((g) => g.id !== goalId);
      const nextHoldings = prev.holdings.map((h) => {
        const nextAlloc = { ...(h.allocations || {}) };
        delete nextAlloc[goalId];
        return { ...h, allocations: nextAlloc };
      });
      // Ensure emergency fund exists
      const hasEmergency = nextGoals.some((g) => g.isEmergencyFund);
      if (!hasEmergency) return prev;
      return { ...prev, goals: sortGoals(nextGoals), holdings: nextHoldings };
    });
    setConfirmDeleteGoalOpen(false);
    setGoalToDeleteId(null);
    setGoalEditorId("new");
  }

  function sortGoals(arr) {
    return [...arr].sort((a, b) => {
      if (Boolean(a.isEmergencyFund) !== Boolean(b.isEmergencyFund)) {
        return a.isEmergencyFund ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  function setHoldingAllocation(goalId, holdingId, percent) {
    setStateAndBump((prev) => {
      const nextHoldings = prev.holdings.map((h) => {
        if (h.id !== holdingId) return h;
        const allocations = normalizeAllocations(h.allocations);
        const otherSum = Object.keys(allocations)
          .filter((gid) => gid !== goalId)
          .reduce((acc, gid) => acc + safeNumber(allocations[gid]), 0);
        const maxAllowed = clamp(100 - otherSum, 0, 100);
        const nextPct = clamp(safeNumber(percent), 0, maxAllowed);
        const nextAllocations = { ...allocations };
        if (nextPct <= 0.0001) delete nextAllocations[goalId];
        else nextAllocations[goalId] = nextPct;
        return { ...h, allocations: nextAllocations };
      });
      return { ...prev, holdings: nextHoldings };
    });
  }

  function deleteHolding(holdingId) {
    setStateAndBump((prev) => {
      const next = prev.holdings.filter((h) => h.id !== holdingId);
      return { ...prev, holdings: next };
    });
    setHoldingEditor(null);
  }

  function upsertHolding(draft) {
    setStateAndBump((prev) => {
      const normalizedAlloc = {};
      const alloc = draft.allocations || {};
      const goalIdSet = new Set(prev.goals.map((g) => g.id));
      for (const gid of Object.keys(alloc)) {
        if (!goalIdSet.has(gid)) continue;
        const pct = clamp(safeNumber(alloc[gid]), 0, 100);
        if (pct > 0) normalizedAlloc[gid] = pct;
      }
      const totalPct = Object.keys(normalizedAlloc).reduce((acc, gid) => acc + safeNumber(normalizedAlloc[gid]), 0);
      // UI typically enforces <= 100; clamp for safety by scaling proportionally.
      let finalAlloc = normalizedAlloc;
      if (totalPct > 100.0001) {
        const scale = 100 / totalPct;
        finalAlloc = {};
        for (const gid of Object.keys(normalizedAlloc)) finalAlloc[gid] = normalizedAlloc[gid] * scale;
      }

      if (draft.mode === "add") {
        const holding = {
          id: generateId(),
          type: draft.type,
          name: String(draft.name || "").trim(),
          amount: safeNumber(draft.amount),
          allocations: normalizeAllocations(finalAlloc),
        };
        return { ...prev, holdings: [...prev.holdings, holding] };
      } else {
        const nextHoldings = prev.holdings.map((h) => {
          if (h.id !== draft.id) return h;
          return {
            ...h,
            type: draft.type,
            name: String(draft.name || "").trim(),
            amount: safeNumber(draft.amount),
            allocations: normalizeAllocations(finalAlloc),
          };
        });
        return { ...prev, holdings: nextHoldings };
      }
    });
    setHoldingEditor(null);
  }

  const orderedGoals = useMemo(() => sortGoals(goals), [goals]);

  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xl font-extrabold leading-tight">Goals Portfolio Planner</div>
              <div className="text-sm text-slate-600">Client-side • localStorage • export/import backup</div>
            </div>

            <div className="flex items-center gap-2">
              <button
                className={
                  "rounded-lg border px-3 py-2 text-sm font-medium " +
                  (activeTab === "dashboard"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50")
                }
                onClick={() => setActiveTab("dashboard")}
              >
                Goals
              </button>
              <button
                className={
                  "rounded-lg border px-3 py-2 text-sm font-medium " +
                  (activeTab === "goals"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50")
                }
                onClick={() => {
                  setActiveTab("goals");
                  if (goalEditorId === "new") setGoalEditorId("new");
                }}
              >
                Add/Edit Goals
              </button>
              <button
                className={
                  "rounded-lg border px-3 py-2 text-sm font-medium " +
                  (activeTab === "portfolio"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50")
                }
                onClick={() => setActiveTab("portfolio")}
              >
                Portfolio
              </button>

              <div className="hidden sm:block h-8 w-px bg-slate-200" />
              <button
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                onClick={exportData}
                title="Download JSON backup"
              >
                Export
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  importDataFromFile(file);
                  e.target.value = "";
                }}
              />
              <button
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                onClick={() => fileInputRef.current?.click()}
                title="Import JSON backup"
              >
                Import
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="text-sm text-slate-600">
              Total allocated corpus (all goals):{" "}
              <span className="font-semibold text-slate-900">{formatINR(totalAllocatedCorpus)}</span>
            </div>
            <div className="ml-auto">
              <button
                className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
                onClick={() => setConfirmResetOpen(true)}
                title="Clear all locally saved data"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {activeTab === "dashboard" ? (
          <div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-extrabold">Goals Dashboard</h2>
                <div className="mt-1 text-slate-600">
                  Update your portfolio holdings in the <span className="font-medium">Portfolio</span> tab, then allocate
                  them to goals.
                </div>
              </div>
              <div className="hidden md:block text-right">
                <div className="text-sm text-slate-600">Emergency fund is mandatory</div>
                <div className="text-sm font-semibold text-amber-900">
                  {emergencyGoal ? emergencyGoal.name : "—"}
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              {orderedGoals.map((g) => (
                <GoalCard key={g.id} goal={g} allocationsSummary={dashboardSummaries[g.id]} />
              ))}
            </div>
          </div>
        ) : null}

        {activeTab === "goals" ? (
          <GoalsScreen
            goals={orderedGoals}
            holdings={holdings}
            goalEditorId={goalEditorId}
            setGoalEditorId={setGoalEditorId}
            emergencyGoalId={emergencyGoal?.id}
            onSaveGoal={(draft) => {
              // Start date stays on existing goals; for new, it will default to today in upsertGoal.
              upsertGoal(draft);
            }}
            onDeleteGoal={(goalId) => {
              setGoalToDeleteId(goalId);
              setConfirmDeleteGoalOpen(true);
            }}
            onSetHoldingAllocation={(goalId, holdingId, pct) => setHoldingAllocation(goalId, holdingId, pct)}
            dashboardSummaries={dashboardSummaries}
            onOpenNewHoldingEditor={() => setHoldingEditor(null)}
          />
        ) : null}

        {activeTab === "portfolio" ? (
          <PortfolioScreen
            goals={orderedGoals}
            holdings={holdings}
            onAddHolding={() => setHoldingEditor({ mode: "add" })}
            onEditHolding={(holdingId) => setHoldingEditor({ mode: "edit", id: holdingId })}
            onDeleteHolding={(holdingId) => deleteHolding(holdingId)}
          />
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmResetOpen}
        title="Reset all data?"
        description="This clears goals, holdings, allocations, and backups saved in localStorage."
        confirmText="Reset"
        cancelText="Cancel"
        onConfirm={resetAll}
        onClose={() => setConfirmResetOpen(false)}
      />

      <ConfirmDialog
        open={confirmDeleteGoalOpen}
        title="Delete this goal?"
        description="Allocations to this goal will be removed from all holdings."
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={() => {
          if (!goalToDeleteId) return;
          const g = goals.find((x) => x.id === goalToDeleteId);
          if (g?.isEmergencyFund) {
            alert("Emergency Fund is mandatory and cannot be deleted.");
            setConfirmDeleteGoalOpen(false);
            setGoalToDeleteId(null);
            return;
          }
          deleteGoal(goalToDeleteId);
        }}
        onClose={() => {
          setConfirmDeleteGoalOpen(false);
          setGoalToDeleteId(null);
        }}
      />

      <HoldingEditorModal
        open={Boolean(holdingEditor)}
        mode={holdingEditor?.mode}
        goalList={orderedGoals}
        holding={holdings.find((h) => h.id === holdingEditor?.id)}
        onClose={() => setHoldingEditor(null)}
        onSave={(draft) => upsertHolding(draft)}
      />
    </div>
  );
}

function GoalsScreen({
  goals,
  holdings,
  goalEditorId,
  setGoalEditorId,
  emergencyGoalId,
  onSaveGoal,
  onDeleteGoal,
  onSetHoldingAllocation,
  dashboardSummaries,
}) {
  const isNew = goalEditorId === "new";
  const selectedGoal = isNew ? null : goals.find((g) => g.id === goalEditorId);

  const today = todayLocalISODate();

  const [draftName, setDraftName] = useState("");
  const [draftTargetAmount, setDraftTargetAmount] = useState(0);
  const [draftTargetDate, setDraftTargetDate] = useState(addMonthsISO(today, 12));

  useEffect(() => {
    if (isNew) {
      setDraftName("");
      setDraftTargetAmount(0);
      setDraftTargetDate(addMonthsISO(today, 24));
      return;
    }
    if (!selectedGoal) return;
    setDraftName(selectedGoal.name || "");
    setDraftTargetAmount(safeNumber(selectedGoal.targetAmount));
    setDraftTargetDate(selectedGoal.targetDate || addMonthsISO(today, 12));
  }, [goalEditorId]); // eslint-disable-line react-hooks/exhaustive-deps

  const allocateGoalId = isNew ? null : selectedGoal?.id;

  function allocatedByHoldings(goalId) {
    let sum = 0;
    for (const h of holdings) {
      sum += computeHoldingAllocatedAmount(h, goalId);
    }
    return sum;
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg font-semibold">Your Goals</div>
            <button
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              onClick={() => setGoalEditorId("new")}
            >
              + New
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {goals.map((g) => {
              const isActive = g.id === goalEditorId;
              return (
                <button
                  key={g.id}
                  className={
                    "w-full rounded-lg border px-3 py-2 text-left " +
                    (isActive ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:bg-slate-50")
                  }
                  onClick={() => setGoalEditorId(g.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{g.name}</div>
                    {g.isEmergencyFund ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                        EF
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs opacity-90">
                    Target: {g.targetDate} • {formatINR(g.targetAmount)}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-4 text-xs text-slate-500">
            Tip: allocate holdings to goals using the “Link investments to this goal” section.
          </div>
        </div>
      </div>

      <div className="lg:col-span-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">{isNew ? "Add a Goal" : "Edit Goal"}</div>
              <div className="mt-1 text-sm text-slate-600">
                {isNew
                  ? "Create a new financial goal and then allocate existing holdings to it."
                  : "Update goal details and link investments (holdings) to this goal via allocations."}
              </div>
            </div>
            {!isNew ? (
              <button
                className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                disabled={selectedGoal?.id === emergencyGoalId}
                onClick={() => onDeleteGoal(selectedGoal.id)}
                title={selectedGoal?.id === emergencyGoalId ? "Emergency Fund cannot be deleted" : "Delete goal"}
              >
                Delete
              </button>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-slate-700">Goal name</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="e.g., Retirement"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Target date</label>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                value={draftTargetDate}
                onChange={(e) => setDraftTargetDate(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-slate-700">Target amount (INR)</label>
              <input
                type="number"
                step="1"
                min="0"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                value={draftTargetAmount}
                onChange={(e) => setDraftTargetAmount(parseNumberInput(e.target.value))}
                placeholder="e.g., 5000000"
              />
              <div className="mt-1 text-xs text-slate-500">
                SIP needed is computed as: <span className="font-medium">(Target - Allocated) / Months</span> (no growth MVP).
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => {
                if (isNew) setGoalEditorId("new");
                else setGoalEditorId(selectedGoal?.id);
              }}
              title="Revert changes"
              disabled={isNew}
            >
              Revert
            </button>
            <button
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              onClick={() => {
                const nameOk = String(draftName || "").trim().length > 0;
                if (!nameOk) {
                  alert("Please enter a goal name.");
                  return;
                }
                const dateOk = Boolean(parseISODate(draftTargetDate));
                if (!dateOk) {
                  alert("Please select a valid target date.");
                  return;
                }
                if (draftTargetAmount < 0) {
                  alert("Target amount must be >= 0.");
                  return;
                }
                onSaveGoal({
                  name: draftName,
                  targetAmount: safeNumber(draftTargetAmount),
                  targetDate: draftTargetDate,
                  startDate: today,
                  isEmergencyFund: false,
                });
              }}
            >
              {isNew ? "Create Goal" : "Save Changes"}
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">Link investments to this goal</div>
              <div className="mt-1 text-sm text-slate-600">
                Choose how much of each holding (bank/MF/FD/stock) goes to this goal using percentages.
              </div>
            </div>
            {!allocateGoalId ? (
              <div className="text-sm text-slate-500">Create/select a goal to enable allocations.</div>
            ) : (
              <div className="text-right">
                <div className="text-sm text-slate-600">Allocated corpus</div>
                <div className="text-lg font-semibold">{formatINR(allocatedByHoldings(allocateGoalId))}</div>
              </div>
            )}
          </div>

          {allocateGoalId ? (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[720px] w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-600">
                    <th className="px-2 py-2 font-semibold">Holding</th>
                    <th className="px-2 py-2 font-semibold">Type</th>
                    <th className="px-2 py-2 font-semibold">Balance / Value</th>
                    <th className="px-2 py-2 font-semibold">% to this goal</th>
                    <th className="px-2 py-2 font-semibold">Allocated amount</th>
                    <th className="px-2 py-2 font-semibold">Total allocated % (holding)</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="px-2 py-3 text-slate-500">
                        No holdings yet. Add your bank accounts / MF / FD / stocks in the Portfolio tab.
                      </td>
                    </tr>
                  ) : (
                    holdings.map((h) => {
                      const currentPct = clamp(safeNumber(h.allocations?.[allocateGoalId]), 0, 100);
                      const allocSumOther = getAllocatedPctSumForHolding(h) - currentPct;
                      const maxForThis = clamp(100 - allocSumOther, 0, 100);
                      const allocatedAmt = computeHoldingAllocatedAmount(h, allocateGoalId);
                      return (
                        <tr key={h.id} className="border-t border-slate-200">
                          <td className="px-2 py-3 font-semibold">{h.name || "Untitled"}</td>
                          <td className="px-2 py-3 text-slate-700">{holdingTypeLabels[h.type] || h.type}</td>
                          <td className="px-2 py-3 text-slate-700">{formatINR(h.amount)}</td>
                          <td className="px-2 py-3">
                            <input
                              type="number"
                              min="0"
                              max={Math.round(maxForThis)}
                              step="0.5"
                              className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                              value={currentPct}
                              onChange={(e) => {
                                const nextPct = parseNumberInput(e.target.value);
                                onSetHoldingAllocation(allocateGoalId, h.id, nextPct);
                              }}
                            />
                            <div className="mt-1 text-xs text-slate-500">Max {Math.round(maxForThis)}%</div>
                          </td>
                          <td className="px-2 py-3 text-slate-700">{formatINR(allocatedAmt)}</td>
                          <td className="px-2 py-3 text-slate-700">{Math.round(getAllocatedPctSumForHolding(h))}%</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <div className="mt-3 text-xs text-slate-500">
                If you set a higher % here, it will be limited so the total allocation on that holding stays <= 100%.
              </div>
            </div>
          ) : null}

          {allocateGoalId ? (
            <div className="mt-4">
              <GoalInsightsBar goal={goals.find((g) => g.id === allocateGoalId)} summary={dashboardSummaries[allocateGoalId]} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function GoalInsightsBar({ goal, summary }) {
  if (!goal) return null;
  const pctComplete = goal.targetAmount > 0 ? (summary?.allocatedAmount || 0) / goal.targetAmount : 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm text-slate-600">Progress</div>
          <div className="text-lg font-semibold">{goal.targetAmount > 0 ? `${Math.round(pctComplete * 100)}%` : "—"} complete</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-slate-600">Monthly SIP needed</div>
          <div className="text-lg font-semibold">
            {summary?.monthlySipNeeded > 0 ? formatINR(summary.monthlySipNeeded) : summary?.monthlySipNeeded === 0 ? "₹0" : "—"}
          </div>
        </div>
      </div>
      {summary?.warnings?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {summary.warnings.map((w, idx) => (
            <span
              key={`g_w_${idx}`}
              className={
                w.kind === "danger"
                  ? "rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-800"
                  : "rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
              }
            >
              {w.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PortfolioScreen({ goals, holdings, onAddHolding, onEditHolding, onDeleteHolding }) {
  const [viewMode, setViewMode] = useState("byAsset"); // byAsset | byGoal

  const totalsByType = useMemo(() => {
    const by = {};
    for (const g of Object.values(HoldingType)) by[g] = { totalAmount: 0, count: 0 };
    for (const h of holdings) {
      by[h.type] = by[h.type] || { totalAmount: 0, count: 0 };
      by[h.type].totalAmount += safeNumber(h.amount);
      by[h.type].count += 1;
    }
    return by;
  }, [holdings]);

  const allocatedByGoal = useMemo(() => {
    const by = {};
    for (const g of goals) by[g.id] = { allocated: 0 };
    for (const h of holdings) {
      for (const gid of Object.keys(h.allocations || {})) {
        if (!by[gid]) continue;
        by[gid].allocated += computeHoldingAllocatedAmount(h, gid);
      }
    }
    return by;
  }, [holdings, goals]);

  const unallocatedTotal = useMemo(() => {
    let sum = 0;
    for (const h of holdings) {
      sum += Math.max(0, safeNumber(h.amount) - computeHoldingAllocatedTotal(h));
    }
    return sum;
  }, [holdings]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold">Portfolio View</h2>
          <div className="mt-1 text-slate-600">Manual entry. Periodically update values and allocations.</div>
        </div>
        <div className="flex gap-2">
          <button
            className={
              "rounded-lg border px-3 py-2 text-sm font-semibold " +
              (viewMode === "byAsset" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50")
            }
            onClick={() => setViewMode("byAsset")}
          >
            By asset type
          </button>
          <button
            className={
              "rounded-lg border px-3 py-2 text-sm font-semibold " +
              (viewMode === "byGoal" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50")
            }
            onClick={() => setViewMode("byGoal")}
          >
            By goal allocation
          </button>
          <button
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            onClick={onAddHolding}
          >
            + Add holding
          </button>
        </div>
      </div>

      <div className="mt-4">
        {viewMode === "byAsset" ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Totals by asset type</div>
                <div className="text-sm text-slate-600">This is your raw holding values (not goal allocations).</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-slate-600">Unallocated portion</div>
                <div className="text-lg font-semibold">{formatINR(unallocatedTotal)}</div>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[520px] w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-600">
                    <th className="px-2 py-2 font-semibold">Asset type</th>
                    <th className="px-2 py-2 font-semibold">Count</th>
                    <th className="px-2 py-2 font-semibold">Total value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(totalsByType).map((t) => {
                    const row = totalsByType[t];
                    if (!row || row.count === 0) return null;
                    return (
                      <tr key={t} className="border-t border-slate-200">
                        <td className="px-2 py-3 font-semibold">{holdingTypeLabels[t] || t}</td>
                        <td className="px-2 py-3 text-slate-700">{row.count}</td>
                        <td className="px-2 py-3 text-slate-700">{formatINR(row.totalAmount)}</td>
                      </tr>
                    );
                  })}
                  {holdings.length === 0 ? (
                    <tr>
                      <td colSpan="3" className="px-2 py-3 text-slate-500">
                        No holdings yet. Click “Add holding”.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {viewMode === "byGoal" ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Totals by goal allocation</div>
                <div className="text-sm text-slate-600">Allocated corpus flows into each goal based on your holding allocations.</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-slate-600">Unallocated portion</div>
                <div className="text-lg font-semibold">{formatINR(unallocatedTotal)}</div>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[720px] w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-600">
                    <th className="px-2 py-2 font-semibold">Goal</th>
                    <th className="px-2 py-2 font-semibold">Target</th>
                    <th className="px-2 py-2 font-semibold">Allocated corpus</th>
                    <th className="px-2 py-2 font-semibold">% complete</th>
                  </tr>
                </thead>
                <tbody>
                  {goals.map((g) => {
                    const allocated = allocatedByGoal[g.id]?.allocated || 0;
                    const pct = g.targetAmount > 0 ? allocated / g.targetAmount : 0;
                    return (
                      <tr key={g.id} className="border-t border-slate-200">
                        <td className="px-2 py-3">
                          <div className="font-semibold">{g.name}</div>
                          {g.isEmergencyFund ? (
                            <div className="text-xs text-amber-800 font-semibold">Mandatory</div>
                          ) : null}
                        </td>
                        <td className="px-2 py-3 text-slate-700">{formatINR(g.targetAmount)}</td>
                        <td className="px-2 py-3 text-slate-700">{formatINR(allocated)}</td>
                        <td className="px-2 py-3 text-slate-700">{g.targetAmount > 0 ? `${Math.round(pct * 100)}%` : "—"}</td>
                      </tr>
                    );
                  })}
                  {holdings.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="px-2 py-3 text-slate-500">
                        No holdings yet. Click “Add holding”.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Holdings</div>
            <div className="text-sm text-slate-600">Edit values and allocations for each holding.</div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600">
                <th className="px-2 py-2 font-semibold">Name</th>
                <th className="px-2 py-2 font-semibold">Type</th>
                <th className="px-2 py-2 font-semibold">Value</th>
                <th className="px-2 py-2 font-semibold">Allocations</th>
                <th className="px-2 py-2 font-semibold">Unallocated</th>
                <th className="px-2 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {holdings.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-2 py-4 text-slate-500">
                    No holdings yet.
                  </td>
                </tr>
              ) : (
                holdings.map((h) => {
                  const allocated = computeHoldingAllocatedTotal(h);
                  const unallocated = Math.max(0, safeNumber(h.amount) - allocated);
                  const allocs = Object.entries(normalizeAllocations(h.allocations || {}));
                  const allocText =
                    allocs.length === 0
                      ? "None"
                      : allocs
                          .map(([gid, pct]) => {
                            const goal = goals.find((g) => g.id === gid);
                            return `${goal ? goal.name : "Unknown"}: ${Math.round(pct)}%`;
                          })
                          .join(", ");

                  return (
                    <tr key={h.id} className="border-t border-slate-200">
                      <td className="px-2 py-3 font-semibold">{h.name || "Untitled"}</td>
                      <td className="px-2 py-3 text-slate-700">{holdingTypeLabels[h.type] || h.type}</td>
                      <td className="px-2 py-3 text-slate-700">{formatINR(h.amount)}</td>
                      <td className="px-2 py-3 text-slate-700">{allocText}</td>
                      <td className="px-2 py-3 text-slate-700">{formatINR(unallocated)}</td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={() => onEditHolding(h.id)}
                          >
                            Edit
                          </button>
                          <button
                            className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                            onClick={() => {
                              const ok = confirm("Delete this holding?");
                              if (ok) onDeleteHolding(h.id);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HoldingEditorModal({ open, mode, goalList, holding, onClose, onSave }) {
  const isEdit = mode === "edit";
  const today = todayLocalISODate();

  const [type, setType] = useState(HoldingType.BANK);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState(0);
  const [allocations, setAllocations] = useState({});

  useEffect(() => {
    if (!open) return;
    if (isEdit && holding) {
      setType(holding.type);
      setName(holding.name || "");
      setAmount(safeNumber(holding.amount));
      setAllocations(normalizeAllocations(holding.allocations || {}));
    } else {
      setType(HoldingType.BANK);
      setName("");
      setAmount(0);
      setAllocations({});
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const allocatedPctSum = useMemo(() => getAllocatedPctSumForHolding({ amount, allocations }), [amount, allocations]);

  const unallocated = Math.max(0, safeNumber(amount) - computeHoldingAllocatedTotal({ amount, allocations }));

  const goals = goalList || [];

  return (
    <Modal
      open={open}
      title={isEdit ? "Edit Holding" : "Add Holding"}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            Unallocated portion: <span className="font-semibold text-slate-900">{formatINR(unallocated)}</span>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              onClick={() => {
                const nameOk = String(name || "").trim().length > 0;
                if (!nameOk) return alert("Please enter a name for this holding.");
                if (safeNumber(amount) <= 0) return alert("Amount/value must be > 0.");
                // Clamp allocations to keep sum <= 100
                const allocClean = normalizeAllocations(allocations);
                const sumPct = Object.keys(allocClean).reduce((acc, gid) => acc + safeNumber(allocClean[gid]), 0);
                if (sumPct > 100.001) return alert("Total allocation % for this holding must be <= 100.");

                onSave({
                  mode: isEdit ? "edit" : "add",
                  id: holding?.id,
                  type,
                  name,
                  amount: safeNumber(amount),
                  allocations: allocClean,
                });
              }}
            >
              {isEdit ? "Save Holding" : "Add Holding"}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="text-sm font-medium text-slate-700">Holding type</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {Object.values(HoldingType).map((t) => (
              <option key={t} value={t}>
                {holdingTypeLabels[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">Name</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === HoldingType.BANK ? "e.g., HDFC Savings" : "e.g., SBI FD / Zerodha"}
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-sm font-medium text-slate-700">Amount / current value (INR)</label>
          <input
            type="number"
            min="0"
            step="1"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            value={amount}
            onChange={(e) => setAmount(parseNumberInput(e.target.value))}
          />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Allocate this holding across goals</div>
            <div className="mt-1 text-xs text-slate-600">
              Total allocation must be <= 100%. Any remainder stays unallocated.
            </div>
          </div>
          <div className="text-sm text-slate-700">
            Total allocated: <span className="font-semibold">{Math.round(allocatedPctSum)}%</span>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[680px] w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600">
                <th className="px-2 py-2 font-semibold">Goal</th>
                <th className="px-2 py-2 font-semibold">Target</th>
                <th className="px-2 py-2 font-semibold">% of this holding</th>
                <th className="px-2 py-2 font-semibold">Allocated amount</th>
              </tr>
            </thead>
            <tbody>
              {goals.map((g) => {
                const pct = clamp(safeNumber(allocations?.[g.id]), 0, 100);
                const allocatedAmt = (safeNumber(amount) * pct) / 100;
                const currentTotalExcept = Object.keys(allocations || {})
                  .filter((gid) => gid !== g.id)
                  .reduce((acc, gid) => acc + safeNumber(allocations[gid]), 0);
                const maxForThis = clamp(100 - currentTotalExcept, 0, 100);
                return (
                  <tr key={g.id} className="border-t border-slate-200">
                    <td className="px-2 py-3">
                      <div className="font-semibold">{g.name}</div>
                      {g.isEmergencyFund ? <div className="text-xs text-amber-800 font-semibold">Mandatory</div> : null}
                    </td>
                    <td className="px-2 py-3 text-slate-700">{formatINR(g.targetAmount || 0)}</td>
                    <td className="px-2 py-3">
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max={Math.round(maxForThis)}
                        className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                        value={pct}
                        onChange={(e) => {
                          const nextPct = parseNumberInput(e.target.value);
                          const clamped = clamp(nextPct, 0, maxForThis);
                          setAllocations((prev) => {
                            const next = { ...(prev || {}) };
                            if (clamped <= 0.0001) delete next[g.id];
                            else next[g.id] = clamped;
                            return next;
                          });
                        }}
                      />
                      <div className="mt-1 text-xs text-slate-500">Max {Math.round(maxForThis)}%</div>
                    </td>
                    <td className="px-2 py-3 text-slate-700">{formatINR(allocatedAmt)}</td>
                  </tr>
                );
              })}
              {goals.length === 0 ? (
                <tr>
                  <td colSpan="4" className="px-2 py-3 text-slate-500">
                    Please create at least one goal first.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

// Mount app
function start() {
  const root = document.getElementById("root");
  if (!root) return;
  const AppComponent = App;
  ReactDOM.createRoot(root).render(<AppComponent />);
}

start();


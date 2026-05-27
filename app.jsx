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

// ─── UI helpers ───────────────────────────────────────────────────────────────

const GOAL_THEMES = [
  { icon: "🛡", iconBg: "bg-amber-500/15", bar: "bg-amber-400" },
  { icon: "🏠", iconBg: "bg-emerald-500/15", bar: "bg-emerald-400" },
  { icon: "☀", iconBg: "bg-sky-500/15", bar: "bg-sky-400" },
  { icon: "✈", iconBg: "bg-orange-500/15", bar: "bg-orange-400" },
  { icon: "🎓", iconBg: "bg-violet-500/15", bar: "bg-violet-400" },
  { icon: "💰", iconBg: "bg-teal-500/15", bar: "bg-teal-400" },
];

function getGoalTheme(goal, index) {
  if (goal.isEmergencyFund) return GOAL_THEMES[0];
  const name = (goal.name || "").toLowerCase();
  if (name.includes("home") || name.includes("house")) return GOAL_THEMES[1];
  if (name.includes("retire")) return GOAL_THEMES[2];
  if (name.includes("trip") || name.includes("vacation") || name.includes("travel")) return GOAL_THEMES[3];
  if (name.includes("child") || name.includes("education") || name.includes("school")) return GOAL_THEMES[4];
  return GOAL_THEMES[(index + 1) % GOAL_THEMES.length];
}

function formatCompactINR(n) {
  const x = safeNumber(n);
  if (x >= 10000000) return `₹${(x / 10000000).toFixed(1)}Cr`;
  if (x >= 100000) return `₹${(x / 100000).toFixed(1)}L`;
  if (x >= 1000) return `₹${(x / 1000).toFixed(1)}K`;
  return formatINR(x);
}

function formatTargetDate(iso) {
  const d = parseISODate(iso);
  if (!d) return iso || "—";
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function getGoalStatus(summary) {
  if (!summary?.warnings?.length) return { label: "On track", tone: "good" };
  return { label: "Needs attention", tone: "warn" };
}

function parseNumberInput(s) {
  const n = Number(String(s).trim());
  return Number.isFinite(n) ? n : 0;
}

function sortGoals(arr) {
  return [...arr].sort((a, b) => {
    if (Boolean(a.isEmergencyFund) !== Boolean(b.isEmergencyFund)) {
      return a.isEmergencyFund ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

const cls = {
  page: "mx-auto max-w-5xl px-4 sm:px-6",
  card: "rounded-2xl border border-white/10 bg-[#111111]",
  label: "text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500",
  heading: "text-2xl font-semibold tracking-tight text-white sm:text-3xl",
  subtext: "mt-1 text-sm leading-relaxed text-slate-400",
  input:
    "mt-2 w-full rounded-xl border border-white/10 bg-[#1a1a1a] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-white/25 focus:outline-none focus:ring-2 focus:ring-white/10",
  inputSm:
    "w-24 rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-sm text-white focus:border-white/25 focus:outline-none focus:ring-2 focus:ring-white/10",
  select:
    "mt-2 w-full rounded-xl border border-white/10 bg-[#1a1a1a] px-4 py-3 text-sm text-white focus:border-white/25 focus:outline-none focus:ring-2 focus:ring-white/10",
  btnPrimary:
    "rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-slate-200",
  btnSecondary:
    "rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/5",
  btnGhost: "rounded-full px-4 py-2 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white",
  btnDanger:
    "rounded-full border border-rose-500/30 px-4 py-2 text-sm text-rose-400 transition hover:bg-rose-500/10",
  navTab: (active) =>
    active
      ? "rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white"
      : "rounded-full px-4 py-2 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white",
  th: "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500",
  td: "border-t border-white/5 px-4 py-4 text-sm text-slate-300",
};

function ProgressBar({ pct, barClass }) {
  const width = clamp(pct, 0, 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className={`h-full rounded-full transition-all duration-500 ${barClass}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function StatusBadge({ status }) {
  const good = status.tone === "good";
  return (
    <span
      className={
        good
          ? "rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300"
          : "rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300"
      }
    >
      {status.label}
    </span>
  );
}

function GoalProgressCard({ goal, summary, index }) {
  const theme = getGoalTheme(goal, index);
  const allocated = summary?.allocatedAmount ?? 0;
  const pct = goal.targetAmount > 0 ? clamp((allocated / goal.targetAmount) * 100, 0, 100) : 0;
  const status = getGoalStatus(summary);

  return (
    <div className={`${cls.card} p-5 transition hover:border-white/20`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl text-lg ${theme.iconBg}`}>
          {theme.icon}
        </div>
        <StatusBadge status={status} />
      </div>

      <h3 className="mt-5 text-lg font-semibold text-white">{goal.name}</h3>
      <p className="mt-1 text-sm text-slate-500">
        Target · {formatTargetDate(goal.targetDate)}
        {goal.targetAmount > 0 ? ` · ${formatCompactINR(goal.targetAmount)}` : ""}
      </p>

      <div className="mt-5">
        <ProgressBar pct={pct} barClass={theme.bar} />
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-slate-500">{formatCompactINR(allocated)} saved</span>
        <span className="font-semibold text-white">{Math.round(pct)}%</span>
      </div>

      {summary?.warnings?.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {summary.warnings.map((w, idx) => (
            <span
              key={`${goal.id}_w_${idx}`}
              className="rounded-full bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-medium text-rose-300"
            >
              {w.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ConfirmDialog({ open, title, description, confirmText, cancelText, onConfirm, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className={`${cls.card} w-full max-w-md p-6`}>
        <div className="text-lg font-semibold text-white">{title}</div>
        {description ? <div className="mt-2 text-sm text-slate-400">{description}</div> : null}
        <div className="mt-6 flex justify-end gap-3">
          <button className={cls.btnGhost} onClick={onClose}>
            {cancelText || "Cancel"}
          </button>
          <button className={cls.btnDanger} onClick={onConfirm}>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
      <div className={`${cls.card} flex max-h-[90vh] w-full max-w-2xl flex-col`}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-6 py-5">
          <div className="text-lg font-semibold text-white">{title}</div>
          <button className={cls.btnGhost} onClick={onClose}>
            Close
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <div className="border-t border-white/10 px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}

function AppHeader({
  activeTab,
  setActiveTab,
  totalAllocatedCorpus,
  onExport,
  onImport,
  onReset,
  fileInputRef,
  onImportFile,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "goals", label: "Goals" },
    { id: "portfolio", label: "Financial Data" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#050505]/90 backdrop-blur-xl">
      <div className={`${cls.page} py-4`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-sm font-semibold text-white">
              ₹
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-white">Goals Portfolio Planner</div>
              <div className="text-xs text-slate-500">Private · stored in your browser</div>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
            {tabs.map((tab) => (
              <button key={tab.id} className={cls.navTab(activeTab === tab.id)} onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="relative flex items-center gap-2">
            <button className={cls.btnGhost} onClick={() => setMenuOpen((v) => !v)}>
              ···
            </button>
            {menuOpen ? (
              <div className={`${cls.card} absolute right-0 top-11 z-50 min-w-[180px] p-2 shadow-2xl`}>
                <button
                  className="block w-full rounded-xl px-4 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5"
                  onClick={() => {
                    onExport();
                    setMenuOpen(false);
                  }}
                >
                  Export backup
                </button>
                <button
                  className="block w-full rounded-xl px-4 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setMenuOpen(false);
                  }}
                >
                  Import backup
                </button>
                <button
                  className="block w-full rounded-xl px-4 py-2.5 text-left text-sm text-rose-400 hover:bg-rose-500/10"
                  onClick={() => {
                    onReset();
                    setMenuOpen(false);
                  }}
                >
                  Reset all data
                </button>
              </div>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={onImportFile}
            />
          </div>
        </div>

        {activeTab === "dashboard" ? (
          <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-4">
            <div className={cls.label}>Total allocated corpus</div>
            <div className="text-lg font-semibold text-white">{formatINR(totalAllocatedCorpus)}</div>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function DashboardScreen({ goals, summaries }) {
  return (
    <div className={`${cls.page} py-8`}>
      <div>
        <p className={cls.label}>Goal progress</p>
        <h1 className={cls.heading}>Your financial goals</h1>
        <p className={cls.subtext}>
          Track how close you are to each goal. Add holdings in Financial Data to update progress.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {goals.map((g, idx) => (
          <GoalProgressCard key={g.id} goal={g} summary={summaries[g.id]} index={idx} />
        ))}
      </div>

      {goals.length === 1 && goals[0]?.isEmergencyFund ? (
        <div className={`${cls.card} mt-6 p-6 text-center`}>
          <p className="text-sm text-slate-400">
            Start by adding your goals, then enter your bank accounts and investments in{" "}
            <span className="text-white">Financial Data</span>.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function GoalsScreen({
  goals,
  goalEditorId,
  setGoalEditorId,
  emergencyGoalId,
  onSaveGoal,
  onDeleteGoal,
}) {
  const isNew = goalEditorId === "new";
  const selectedGoal = isNew ? null : goals.find((g) => g.id === goalEditorId);
  const today = todayLocalISODate();

  const [draftName, setDraftName] = useState("");
  const [draftTargetAmount, setDraftTargetAmount] = useState("");
  const [draftTargetDate, setDraftTargetDate] = useState(addMonthsISO(today, 24));

  useEffect(() => {
    if (isNew) {
      setDraftName("");
      setDraftTargetAmount("");
      setDraftTargetDate(addMonthsISO(today, 24));
      return;
    }
    if (!selectedGoal) return;
    setDraftName(selectedGoal.name || "");
    setDraftTargetAmount(selectedGoal.targetAmount ? String(selectedGoal.targetAmount) : "");
    setDraftTargetDate(selectedGoal.targetDate || addMonthsISO(today, 12));
  }, [goalEditorId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`${cls.page} py-8`}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full lg:w-72 lg:shrink-0">
          <div className={`${cls.card} p-4`}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-white">Your goals</div>
              <button
                className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15"
                onClick={() => setGoalEditorId("new")}
              >
                + New
              </button>
            </div>
            <div className="mt-3 space-y-1">
              {goals.map((g) => {
                const active = g.id === goalEditorId;
                return (
                  <button
                    key={g.id}
                    className={
                      "w-full rounded-xl px-3 py-3 text-left transition " +
                      (active ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white")
                    }
                    onClick={() => setGoalEditorId(g.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{g.name}</span>
                      {g.isEmergencyFund ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                          Required
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatTargetDate(g.targetDate)} · {formatCompactINR(g.targetAmount)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <div className={`${cls.card} p-6`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={cls.label}>{isNew ? "Create" : "Edit"}</p>
                <h2 className="mt-1 text-xl font-semibold text-white">{isNew ? "Add a goal" : selectedGoal?.name}</h2>
                <p className={cls.subtext}>
                  Set a target amount and date. Allocate your holdings to this goal in Financial Data.
                </p>
              </div>
              {!isNew && selectedGoal?.id !== emergencyGoalId ? (
                <button className={cls.btnDanger} onClick={() => onDeleteGoal(selectedGoal.id)}>
                  Delete
                </button>
              ) : null}
            </div>

            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={cls.label}>Goal name</label>
                <input
                  className={cls.input}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="e.g. Retirement, Home purchase"
                />
              </div>
              <div>
                <label className={cls.label}>Target date</label>
                <input
                  type="date"
                  className={cls.input}
                  value={draftTargetDate}
                  onChange={(e) => setDraftTargetDate(e.target.value)}
                />
              </div>
              <div>
                <label className={cls.label}>Target amount (INR)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className={cls.input}
                  value={draftTargetAmount}
                  onChange={(e) => setDraftTargetAmount(e.target.value)}
                  placeholder="5000000"
                />
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-3">
              <button className={cls.btnSecondary} onClick={() => setGoalEditorId(isNew ? "new" : selectedGoal?.id)}>
                Reset
              </button>
              <button
                className={cls.btnPrimary}
                onClick={() => {
                  if (!String(draftName || "").trim()) return alert("Please enter a goal name.");
                  if (!parseISODate(draftTargetDate)) return alert("Please select a valid target date.");
                  if (safeNumber(draftTargetAmount) < 0) return alert("Target amount must be 0 or more.");
                  onSaveGoal({
                    name: draftName,
                    targetAmount: safeNumber(draftTargetAmount),
                    targetDate: draftTargetDate,
                    startDate: today,
                    isEmergencyFund: false,
                  });
                }}
              >
                {isNew ? "Create goal" : "Save changes"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function PortfolioScreen({ goals, holdings, onAddHolding, onEditHolding, onDeleteHolding }) {
  const [viewMode, setViewMode] = useState("holdings");

  const totalsByType = useMemo(() => {
    const by = {};
    for (const t of Object.values(HoldingType)) by[t] = { totalAmount: 0, count: 0 };
    for (const h of holdings) {
      by[h.type].totalAmount += safeNumber(h.amount);
      by[h.type].count += 1;
    }
    return by;
  }, [holdings]);

  const totalPortfolio = useMemo(() => holdings.reduce((s, h) => s + safeNumber(h.amount), 0), [holdings]);

  const unallocatedTotal = useMemo(() => {
    let sum = 0;
    for (const h of holdings) sum += Math.max(0, safeNumber(h.amount) - computeHoldingAllocatedTotal(h));
    return sum;
  }, [holdings]);

  return (
    <div className={`${cls.page} py-8`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={cls.label}>Portfolio</p>
          <h1 className={cls.heading}>Financial data</h1>
          <p className={cls.subtext}>
            Add your bank accounts, mutual funds, FDs and stocks. Allocate each holding across your goals.
          </p>
        </div>
        <button className={cls.btnPrimary} onClick={onAddHolding}>
          + Add holding
        </button>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={`${cls.card} p-5`}>
          <div className={cls.label}>Total portfolio</div>
          <div className="mt-2 text-2xl font-semibold text-white">{formatINR(totalPortfolio)}</div>
        </div>
        <div className={`${cls.card} p-5`}>
          <div className={cls.label}>Unallocated</div>
          <div className="mt-2 text-2xl font-semibold text-white">{formatINR(unallocatedTotal)}</div>
        </div>
        <div className={`${cls.card} p-5`}>
          <div className={cls.label}>Holdings</div>
          <div className="mt-2 text-2xl font-semibold text-white">{holdings.length}</div>
        </div>
      </div>

      <div className="mt-6 flex gap-2">
        <button className={cls.navTab(viewMode === "holdings")} onClick={() => setViewMode("holdings")}>
          All holdings
        </button>
        <button className={cls.navTab(viewMode === "byAsset")} onClick={() => setViewMode("byAsset")}>
          By asset type
        </button>
      </div>

      {viewMode === "holdings" ? (
        <div className={`${cls.card} mt-4 overflow-hidden`}>
          {holdings.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm text-slate-400">No holdings yet.</p>
              <button className={`${cls.btnPrimary} mt-4`} onClick={onAddHolding}>
                Add your first holding
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[640px] w-full">
                <thead>
                  <tr>
                    <th className={cls.th}>Name</th>
                    <th className={cls.th}>Type</th>
                    <th className={cls.th}>Value</th>
                    <th className={cls.th}>Allocated to goals</th>
                    <th className={cls.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => {
                    const allocs = Object.entries(normalizeAllocations(h.allocations || {}));
                    const allocText =
                      allocs.length === 0
                        ? "Not allocated"
                        : allocs
                            .map(([gid, pct]) => {
                              const goal = goals.find((g) => g.id === gid);
                              return `${goal ? goal.name : "?"} ${Math.round(pct)}%`;
                            })
                            .join(" · ");
                    return (
                      <tr key={h.id}>
                        <td className={cls.td}>
                          <div className="font-medium text-white">{h.name || "Untitled"}</div>
                        </td>
                        <td className={cls.td}>{holdingTypeLabels[h.type]}</td>
                        <td className={cls.td}>{formatINR(h.amount)}</td>
                        <td className={`${cls.td} max-w-xs truncate text-slate-500`}>{allocText}</td>
                        <td className={cls.td}>
                          <div className="flex gap-2">
                            <button className={cls.btnGhost} onClick={() => onEditHolding(h.id)}>
                              Edit
                            </button>
                            <button
                              className={cls.btnDanger}
                              onClick={() => {
                                if (confirm("Delete this holding?")) onDeleteHolding(h.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {viewMode === "byAsset" ? (
        <div className={`${cls.card} mt-4 overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="min-w-[400px] w-full">
              <thead>
                <tr>
                  <th className={cls.th}>Asset type</th>
                  <th className={cls.th}>Count</th>
                  <th className={cls.th}>Total value</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(totalsByType).map((t) => {
                  const row = totalsByType[t];
                  if (!row.count) return null;
                  return (
                    <tr key={t}>
                      <td className={cls.td}>{holdingTypeLabels[t]}</td>
                      <td className={cls.td}>{row.count}</td>
                      <td className={cls.td}>{formatINR(row.totalAmount)}</td>
                    </tr>
                  );
                })}
                {holdings.length === 0 ? (
                  <tr>
                    <td colSpan="3" className={`${cls.td} text-center text-slate-500`}>
                      No holdings yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HoldingEditorModal({ open, mode, goalList, holding, onClose, onSave }) {
  const isEdit = mode === "edit";
  const [type, setType] = useState(HoldingType.BANK);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [allocations, setAllocations] = useState({});

  useEffect(() => {
    if (!open) return;
    if (isEdit && holding) {
      setType(holding.type);
      setName(holding.name || "");
      setAmount(holding.amount ? String(holding.amount) : "");
      setAllocations(normalizeAllocations(holding.allocations || {}));
    } else {
      setType(HoldingType.BANK);
      setName("");
      setAmount("");
      setAllocations({});
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const allocatedPctSum = useMemo(
    () => getAllocatedPctSumForHolding({ amount: safeNumber(amount), allocations }),
    [amount, allocations]
  );
  const unallocated = Math.max(
    0,
    safeNumber(amount) - computeHoldingAllocatedTotal({ amount: safeNumber(amount), allocations })
  );
  const goals = goalList || [];

  return (
    <Modal
      open={open}
      title={isEdit ? "Edit holding" : "Add holding"}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-500">
            Unallocated: <span className="font-semibold text-white">{formatINR(unallocated)}</span>
          </div>
          <div className="flex gap-3">
            <button className={cls.btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button
              className={cls.btnPrimary}
              onClick={() => {
                if (!String(name || "").trim()) return alert("Please enter a name.");
                if (safeNumber(amount) <= 0) return alert("Amount must be greater than 0.");
                const allocClean = normalizeAllocations(allocations);
                const sumPct = Object.values(allocClean).reduce((a, v) => a + safeNumber(v), 0);
                if (sumPct > 100.001) return alert("Total allocation must be 100% or less.");
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
              {isEdit ? "Save" : "Add holding"}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className={cls.label}>Type</label>
          <select className={cls.select} value={type} onChange={(e) => setType(e.target.value)}>
            {Object.values(HoldingType).map((t) => (
              <option key={t} value={t}>
                {holdingTypeLabels[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={cls.label}>Name</label>
          <input
            className={cls.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === HoldingType.BANK ? "HDFC Savings" : "e.g. SBI Bluechip"}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={cls.label}>Current value (INR)</label>
          <input
            type="number"
            min="0"
            className={cls.input}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="100000"
          />
        </div>
      </div>

      <div className={`${cls.card} mt-6 p-4`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">Allocate to goals</div>
            <div className="mt-1 text-xs text-slate-500">Total must be {"≤"} 100%</div>
          </div>
          <div className="text-sm text-slate-400">
            Allocated: <span className="font-semibold text-white">{Math.round(allocatedPctSum)}%</span>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {goals.map((g) => {
            const pct = clamp(safeNumber(allocations?.[g.id]), 0, 100);
            const otherSum = Object.keys(allocations || {})
              .filter((gid) => gid !== g.id)
              .reduce((acc, gid) => acc + safeNumber(allocations[gid]), 0);
            const maxForThis = clamp(100 - otherSum, 0, 100);
            const allocatedAmt = (safeNumber(amount) * pct) / 100;

            return (
              <div key={g.id} className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-white">{g.name}</div>
                  <div className="text-xs text-slate-500">{formatCompactINR(allocatedAmt)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max={Math.round(maxForThis)}
                    step="1"
                    className={cls.inputSm}
                    value={pct || ""}
                    onChange={(e) => {
                      const next = clamp(parseNumberInput(e.target.value), 0, maxForThis);
                      setAllocations((prev) => {
                        const n = { ...(prev || {}) };
                        if (next <= 0) delete n[g.id];
                        else n[g.id] = next;
                        return n;
                      });
                    }}
                  />
                  <span className="text-sm text-slate-500">%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
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
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.12),transparent_55%),radial-gradient(circle_at_bottom,_rgba(0,0,0,0.95),#050505)]" />

      <AppHeader
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          if (tab === "goals" && goalEditorId === "new") setGoalEditorId("new");
        }}
        totalAllocatedCorpus={totalAllocatedCorpus}
        onExport={exportData}
        onImport={() => fileInputRef.current?.click()}
        onReset={() => setConfirmResetOpen(true)}
        fileInputRef={fileInputRef}
        onImportFile={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          importDataFromFile(file);
          e.target.value = "";
        }}
      />

      {activeTab === "dashboard" ? <DashboardScreen goals={orderedGoals} summaries={dashboardSummaries} /> : null}

      {activeTab === "goals" ? (
        <GoalsScreen
          goals={orderedGoals}
          goalEditorId={goalEditorId}
          setGoalEditorId={setGoalEditorId}
          emergencyGoalId={orderedGoals.find((g) => g.isEmergencyFund)?.id}
          onSaveGoal={(draft) => upsertGoal(draft)}
          onDeleteGoal={(goalId) => {
            setGoalToDeleteId(goalId);
            setConfirmDeleteGoalOpen(true);
          }}
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

      <ConfirmDialog
        open={confirmResetOpen}
        title="Reset all data?"
        description="This clears everything stored in localStorage for this app."
        confirmText="Reset"
        cancelText="Cancel"
        onConfirm={resetAll}
        onClose={() => setConfirmResetOpen(false)}
      />

      <ConfirmDialog
        open={confirmDeleteGoalOpen}
        title="Delete this goal?"
        description="Holdings allocated to this goal will keep their value, but this goal allocation will be removed."
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

// Mount app
function start() {
  const root = document.getElementById("root");
  if (!root) return;
  const AppComponent = App;
  ReactDOM.createRoot(root).render(<AppComponent />);
}

start();


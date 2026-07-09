const { useEffect, useMemo, useRef, useState } = React;

const STORAGE_KEY = "finance_goals_app_state_v1";
const STATE_VERSION = 3;

const InvestmentType = {
  MF: "MF",
  STOCK: "STOCK",
  FD: "FD",
  RD: "RD",
  POLICY: "POLICY",
};

const investmentTypeLabels = {
  [InvestmentType.MF]: "Mutual Fund",
  [InvestmentType.STOCK]: "Stocks",
  [InvestmentType.FD]: "FD",
  [InvestmentType.RD]: "RD",
  [InvestmentType.POLICY]: "Policy",
};

const BANK_NAMES = [
  "Allahabad Bank",
  "Andhra Bank",
  "Axis Bank",
  "Bank of Bahrain and Kuwait",
  "Bank of Baroda - Corporate Banking",
  "Bank of Baroda - Retail Banking",
  "Bank of India",
  "Bank of Maharashtra",
  "Canara Bank",
  "Central Bank of India",
  "City Union Bank",
  "Corporation Bank",
  "Deutsche Bank",
  "Development Credit Bank",
  "Dhanlaxmi Bank",
  "Federal Bank",
  "HDFC Bank",
  "ICICI Bank",
  "IDBI Bank",
  "Indian Bank",
  "Indian Overseas Bank",
  "IndusInd Bank",
  "ING Vysya Bank",
  "Jammu and Kashmir Bank",
  "Karnataka Bank Ltd",
  "Karur Vysya Bank",
  "Kotak Bank",
  "Laxmi Vilas Bank",
  "Oriental Bank of Commerce",
  "Punjab National Bank - Corporate Banking",
  "Punjab National Bank - Retail Banking",
  "Punjab & Sind Bank",
  "Shamrao Vitthal Co-operative Bank",
  "South Indian Bank",
  "State Bank of Bikaner & Jaipur",
  "State Bank of Hyderabad",
  "State Bank of India",
  "State Bank of Mysore",
  "State Bank of Patiala",
  "State Bank of Travancore",
  "Syndicate Bank",
  "Tamilnad Mercantile Bank Ltd.",
  "UCO Bank",
  "Union Bank of India",
  "United Bank of India",
  "Vijaya Bank",
  "Yes Bank Ltd",
];

// 0.0 (stable) -> 1.0 (highly volatile). MVP heuristic.
const volatilityByType = {
  BANK: 0.12,
  [InvestmentType.FD]: 0.25,
  [InvestmentType.RD]: 0.3,
  [InvestmentType.POLICY]: 0.45,
  [InvestmentType.MF]: 0.55,
  [InvestmentType.STOCK]: 0.72,
};

const EMERGENCY_FUND_MONTHS = 6;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeNumber(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function formatINR(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "Rs. 0";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(x);
  } catch {
    return "Rs. " + Math.round(x).toLocaleString("en-IN");
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

function emergencyFundTarget(monthlyExpenses, monthlyCommitments) {
  return EMERGENCY_FUND_MONTHS * (safeNumber(monthlyExpenses) + safeNumber(monthlyCommitments));
}

function applyEmergencyFundTarget(goals, monthlyExpenses, monthlyCommitments) {
  const target = emergencyFundTarget(monthlyExpenses, monthlyCommitments);
  return goals.map((g) => (g.isEmergencyFund ? { ...g, targetAmount: target } : g));
}

function filterAllocationsForGoals(allocations, goalIdSet) {
  const src = normalizeAllocations(allocations);
  const out = {};
  for (const k of Object.keys(src)) {
    if (goalIdSet.has(k)) out[k] = src[k];
  }
  return out;
}

function getFundSources(state) {
  const sources = [];
  for (const b of state.bankAccounts || []) {
    sources.push({
      id: b.id,
      kind: "bank",
      label: b.bankName || "Bank account",
      amount: safeNumber(b.balance),
      allocations: b.allocations || {},
      volatility: volatilityByType.BANK,
    });
  }
  for (const inv of state.investments || []) {
    sources.push({
      id: inv.id,
      kind: "investment",
      label:
        inv.type === InvestmentType.FD || inv.type === InvestmentType.RD
          ? inv.bankName || investmentTypeLabels[inv.type] || "Investment"
          : inv.name || investmentTypeLabels[inv.type] || "Investment",
      amount: safeNumber(inv.outstandingAmount),
      allocations: inv.allocations || {},
      volatility: volatilityByType[inv.type] ?? 0.5,
    });
  }
  return sources;
}

function computeNetWorth(state) {
  let sum = 0;
  for (const b of state.bankAccounts || []) sum += safeNumber(b.balance);
  for (const inv of state.investments || []) sum += safeNumber(inv.outstandingAmount);
  return sum;
}

function computeTotalEmi(state) {
  return (state.commitments || []).reduce((s, c) => s + safeNumber(c.monthlyEmi), 0);
}

function computeInvestableSurplus(state) {
  return safeNumber(state.monthlyIncome) - computeTotalEmi(state) - safeNumber(state.monthlyExpenses);
}

function computeTotalDebt(state) {
  return (state.commitments || []).reduce((s, c) => s + safeNumber(c.outstandingAmount), 0);
}

function computeNetWorthWithDebt(state, includeDebt) {
  const gross = computeNetWorth(state);
  return includeDebt ? gross - computeTotalDebt(state) : gross;
}

function computeGoalExistingAllocation(goalId, state) {
  let sum = 0;
  for (const src of getFundSources(state)) {
    sum += computeHoldingAllocatedAmount(src, goalId);
  }
  return sum;
}

function computeGoalProjectedAllocation(goal, state) {
  const today = todayLocalISODate();
  let projected = computeGoalExistingAllocation(goal.id, state);

  for (const inv of state.investments || []) {
    const pct = clamp(safeNumber(normalizeAllocations(inv.allocations || {})[goal.id]), 0, 100);
    if (pct <= 0 || !inv.isRecurring) continue;

    const mode = inv.recurringAllocationMode || "monthly";
    if (mode === "maturity") {
      const matDate = inv.maturityDate;
      const matAmt = safeNumber(inv.maturityAmount);
      const goalDate = parseISODate(goal.targetDate);
      const maturity = parseISODate(matDate);
      if (matAmt > 0 && goalDate && maturity && monthIndex(maturity) <= monthIndex(goalDate)) {
        projected += (matAmt * pct) / 100;
      }
      continue;
    }

    const monthly = safeNumber(inv.monthlyContribution);
    if (monthly <= 0) continue;
    let periods = Math.max(0, diffMonths(today, goal.targetDate));
    if (inv.maturityDate && parseISODate(inv.maturityDate)) {
      periods = Math.min(periods, Math.max(0, diffMonths(today, inv.maturityDate)));
    }
    if ((inv.frequency || "monthly") === "yearly") {
      periods = Math.floor(periods / 12);
    }
    projected += ((monthly * pct) / 100) * periods;
  }

  return projected;
}

function computeRequiredMonthlyInvestment(goal, state) {
  const target = safeNumber(goal.targetAmount);
  if (target <= 0) return 0;
  const maturityCredit = computeMaturityCreditForGoal(goal.id, goal, state);
  const effectiveTarget = Math.max(0, target - maturityCredit);
  const today = todayLocalISODate();
  const months = Math.max(0, diffMonths(today, goal.targetDate));
  const allocated = computeGoalExistingAllocation(goal.id, state);
  const remaining = Math.max(0, effectiveTarget - allocated);
  if (months <= 0) return remaining;
  return remaining / months;
}

function computeMaturityCreditForGoal(goalId, goal, state) {
  let credit = 0;
  const goalDate = parseISODate(goal.targetDate);
  if (!goalDate) return 0;
  for (const inv of state.investments || []) {
    if (!inv.isRecurring || inv.recurringAllocationMode !== "maturity") continue;
    const matDate = parseISODate(inv.maturityDate);
    const matAmt = safeNumber(inv.maturityAmount);
    if (!matDate || matAmt <= 0) continue;
    if (monthIndex(goalDate) <= monthIndex(matDate)) continue;
    const pct = clamp(safeNumber(normalizeAllocations(inv.allocations || {})[goalId]), 0, 100);
    if (pct > 0) credit += (matAmt * pct) / 100;
  }
  return credit;
}

function computeGoalMonthlyRecurringAllocation(goalId, state) {
  let sum = 0;
  for (const inv of state.investments || []) {
    if (!inv.isRecurring || inv.recurringAllocationMode === "maturity") continue;
    const pct = clamp(safeNumber(normalizeAllocations(inv.allocations || {})[goalId]), 0, 100);
    if (pct <= 0) continue;
    const contrib = safeNumber(inv.monthlyContribution);
    if ((inv.frequency || "monthly") === "yearly") sum += ((contrib * pct) / 100) / 12;
    else sum += (contrib * pct) / 100;
  }
  return sum;
}

function getGoalAttentionReason(goal, state, summary) {
  const status = summary?.status || getGoalStatusFromProjection(goal, state);
  if (status.tone !== "warn") return null;
  const monthlyRequired = summary?.monthlyRequired ?? computeRequiredMonthlyInvestment(goal, state);
  const monthlyAllocated = computeGoalMonthlyRecurringAllocation(goal.id, state);
  if (monthlyRequired > monthlyAllocated + 1) return "Falling behind of schedule";
  if (status.label === "Needs attention") return "Falling behind of schedule";
  return null;
}

function isPortfolioEmpty(state) {
  const hasExtraGoals = (state.goals || []).some((g) => !g.isEmergencyFund);
  const hasMoney =
    safeNumber(state.monthlyIncome) > 0 ||
    safeNumber(state.monthlyExpenses) > 0 ||
    (state.commitments || []).some((c) => safeNumber(c.outstandingAmount) > 0 || safeNumber(c.monthlyEmi) > 0) ||
    (state.bankAccounts || []).some((b) => safeNumber(b.balance) > 0) ||
    (state.investments || []).length > 0;
  const hasAllocations =
    (state.bankAccounts || []).some((b) => Object.keys(normalizeAllocations(b.allocations)).length > 0) ||
    (state.investments || []).some((inv) => Object.keys(normalizeAllocations(inv.allocations)).length > 0);
  return !hasExtraGoals && !hasMoney && !hasAllocations;
}

function computeTotalRequiredMonthlyInvestment(goals, state) {
  return goals.reduce((sum, g) => sum + computeRequiredMonthlyInvestment(g, state), 0);
}

function getGoalStatusFromProjection(goal, state) {
  const target = safeNumber(goal.targetAmount);
  if (target <= 0) return { label: "On track", tone: "good" };
  const projected = computeGoalProjectedAllocation(goal, state);
  const ratio = projected / target;
  if (ratio > 1.2) return { label: "Ahead of schedule", tone: "ahead" };
  if (ratio >= 0.98) return { label: "On track", tone: "good" };
  if (ratio >= 0.9) return { label: "Slightly behind", tone: "slight" };
  return { label: "Needs attention", tone: "warn" };
}

function validateMaturityGoalAllocations(inv, goals) {
  if (!inv.isRecurring || inv.recurringAllocationMode !== "maturity" || !inv.maturityDate) return null;
  const maturity = parseISODate(inv.maturityDate);
  if (!maturity) return null;
  const allocs = normalizeAllocations(inv.allocations || {});
  for (const gid of Object.keys(allocs)) {
    if (safeNumber(allocs[gid]) <= 0) continue;
    const goal = goals.find((g) => g.id === gid);
    if (!goal) continue;
    const goalDate = parseISODate(goal.targetDate);
    if (!goalDate) continue;
    if (monthIndex(goalDate) < monthIndex(maturity)) {
      return `Cannot allocate maturity to "${goal.name}" because its target date (${formatTargetDate(goal.targetDate)}) is before this investment matures (${inv.maturityDate}).`;
    }
  }
  return null;
}

function getInvestmentDisplayName(inv) {
  if (inv.type === InvestmentType.FD || inv.type === InvestmentType.RD) {
    return inv.bankName || investmentTypeLabels[inv.type] || "Investment";
  }
  return inv.name || investmentTypeLabels[inv.type] || "Investment";
}

function getGoalAllocatedSources(goalId, state) {
  const sources = [];
  for (const b of state.bankAccounts || []) {
    const pct = clamp(safeNumber(normalizeAllocations(b.allocations || {})[goalId]), 0, 100);
    if (pct <= 0) continue;
    sources.push({
      id: b.id,
      kind: "bank",
      name: b.bankName || "Bank account",
      typeLabel: "Bank account",
      allocationPct: pct,
      allocatedAmount: (safeNumber(b.balance) * pct) / 100,
      basisAmount: safeNumber(b.balance),
      basisLabel: "Balance",
      note: "",
    });
  }
  for (const inv of state.investments || []) {
    const pct = clamp(safeNumber(normalizeAllocations(inv.allocations || {})[goalId]), 0, 100);
    if (pct <= 0) continue;
    const name = getInvestmentDisplayName(inv);
    if (inv.isRecurring && inv.recurringAllocationMode === "maturity") {
      const matAmt = safeNumber(inv.maturityAmount);
      sources.push({
        id: inv.id,
        kind: "investment",
        name,
        typeLabel: investmentTypeLabels[inv.type] || "Investment",
        allocationPct: pct,
        allocatedAmount: (matAmt * pct) / 100,
        basisAmount: matAmt,
        basisLabel: "Maturity amount",
        note: inv.maturityDate ? `Matures ${inv.maturityDate}` : "",
      });
    } else if (inv.isRecurring && (inv.recurringAllocationMode || "monthly") === "monthly") {
      const monthly = safeNumber(inv.monthlyContribution);
      sources.push({
        id: inv.id,
        kind: "investment",
        name,
        typeLabel: investmentTypeLabels[inv.type] || "Investment",
        allocationPct: pct,
        allocatedAmount: (monthly * pct) / 100,
        basisAmount: monthly,
        basisLabel: "Recurring contribution",
        note: `${inv.frequency || "monthly"} recurring${inv.maturityDate ? `, ends ${inv.maturityDate}` : ""}`,
      });
      if (safeNumber(inv.outstandingAmount) > 0) {
        sources.push({
          id: `${inv.id}_outstanding`,
          kind: "investment",
          name,
          typeLabel: investmentTypeLabels[inv.type] || "Investment",
          allocationPct: pct,
          allocatedAmount: (safeNumber(inv.outstandingAmount) * pct) / 100,
          basisAmount: safeNumber(inv.outstandingAmount),
          basisLabel: "Current value",
          note: "Existing holding",
        });
      }
    } else {
      sources.push({
        id: inv.id,
        kind: "investment",
        name,
        typeLabel: investmentTypeLabels[inv.type] || "Investment",
        allocationPct: pct,
        allocatedAmount: (safeNumber(inv.outstandingAmount) * pct) / 100,
        basisAmount: safeNumber(inv.outstandingAmount),
        basisLabel: "Current value",
        note: "",
      });
    }
  }
  return sources;
}

function quarterEndISOFromDate(d) {
  const y = d.getFullYear();
  const m = d.getMonth();
  const qEndMonth = m <= 2 ? 2 : m <= 5 ? 5 : m <= 8 ? 8 : 11;
  const lastDay = new Date(y, qEndMonth + 1, 0).getDate();
  const mo = String(qEndMonth + 1).padStart(2, "0");
  const day = String(lastDay).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function nextQuarterEndISO(isoDate) {
  const d = parseISODate(isoDate);
  if (!d) return isoDate;
  let y = d.getFullYear();
  let m = d.getMonth();
  let qEndMonth = m <= 2 ? 2 : m <= 5 ? 5 : m <= 8 ? 8 : 11;
  let end = new Date(y, qEndMonth + 1, 0);
  if (monthIndex(end) <= monthIndex(d)) {
    qEndMonth += 3;
    if (qEndMonth > 11) {
      qEndMonth -= 12;
      y += 1;
    }
    end = new Date(y, qEndMonth + 1, 0);
  }
  const mo = String(end.getMonth() + 1).padStart(2, "0");
  const day = String(end.getDate()).padStart(2, "0");
  return `${end.getFullYear()}-${mo}-${day}`;
}

function addQuartersISO(isoDate, quarters) {
  return addMonthsISO(isoDate, quarters * 3);
}

function formatQuarterLabel(isoDate) {
  const d = parseISODate(isoDate);
  if (!d) return isoDate;
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}

function formatChartXLabel(isoDate, spanYears) {
  const d = parseISODate(isoDate);
  if (!d) return isoDate;
  if (spanYears > 6) return String(d.getFullYear());
  if (spanYears > 3) return `Q${Math.floor(d.getMonth() / 3) + 1} '${String(d.getFullYear()).slice(-2)}`;
  return formatQuarterLabel(isoDate);
}

function getChartLabelStride(pointCount, spanYears) {
  if (pointCount <= 8) return 1;
  if (spanYears > 8) return Math.max(1, Math.ceil(pointCount / 6));
  if (spanYears > 4) return Math.max(1, Math.ceil(pointCount / 8));
  return Math.max(1, Math.ceil(pointCount / 10));
}

function buildQuarterlyTimeline(startISO, endISO) {
  const out = [];
  let cursor = nextQuarterEndISO(startISO);
  const endIdx = monthIndex(parseISODate(endISO) || new Date());
  let guard = 0;
  while (guard < 80) {
    const idx = monthIndex(parseISODate(cursor));
    if (idx > endIdx) break;
    out.push(cursor);
    cursor = addQuartersISO(cursor, 1);
    guard += 1;
  }
  if (out.length === 0) out.push(quarterEndISOFromDate(parseISODate(startISO) || new Date()));
  return out;
}

function computeRequiredCorpusAtDate(state, goals, isoDate) {
  const d = parseISODate(isoDate);
  if (!d) return 0;
  const emi = computeTotalEmi(state);
  const expenses = safeNumber(state.monthlyExpenses);
  const emergencyNeed = emergencyFundTarget(expenses, emi);
  let goalsDue = 0;
  for (const g of goals || []) {
    if (g.isEmergencyFund) continue;
    const td = parseISODate(g.targetDate);
    if (!td) continue;
    if (monthIndex(td) <= monthIndex(d)) goalsDue += safeNumber(g.targetAmount);
  }
  const efGoal = (goals || []).find((g) => g.isEmergencyFund);
  const efDue =
    efGoal && parseISODate(efGoal.targetDate) && monthIndex(parseISODate(efGoal.targetDate)) <= monthIndex(d)
      ? safeNumber(efGoal.targetAmount)
      : emergencyNeed;
  const outstandingCommitments = computeTotalDebt(state);
  return Math.max(emergencyNeed, efDue) + outstandingCommitments + goalsDue;
}

function computeAvailableCorpusAtDate(state, isoDate) {
  const today = todayLocalISODate();
  const target = parseISODate(isoDate);
  const todayD = parseISODate(today);
  if (!target || !todayD) return computeNetWorth(state);
  if (monthIndex(target) <= monthIndex(todayD)) return computeNetWorth(state);

  let total = computeNetWorth(state);
  const months = Math.max(0, diffMonths(today, isoDate));

  for (const inv of state.investments || []) {
    if (!inv.isRecurring) continue;
    const contrib = safeNumber(inv.monthlyContribution);
    if (contrib <= 0) continue;
    let periods = months;
    if (inv.maturityDate && parseISODate(inv.maturityDate)) {
      periods = Math.min(periods, Math.max(0, diffMonths(today, inv.maturityDate)));
    }
    if ((inv.frequency || "monthly") === "yearly") periods = Math.floor(periods / 12);
    total += contrib * periods;
  }

  for (const inv of state.investments || []) {
    const matAmt = safeNumber(inv.maturityAmount);
    const matDate = inv.maturityDate;
    if (matAmt <= 0 || !matDate) continue;
    const maturity = parseISODate(matDate);
    if (maturity && monthIndex(maturity) <= monthIndex(target)) total += matAmt;
  }

  return total;
}

function computeOutlookChartData(state, goals) {
  const today = todayLocalISODate();
  let endISO = today;
  for (const g of goals || []) {
    if (g.targetDate && g.targetDate > endISO) endISO = g.targetDate;
  }
  endISO = addMonthsISO(endISO, 12);
  const quarters = buildQuarterlyTimeline(today, endISO);
  return quarters.map((iso) => {
    const required = computeRequiredCorpusAtDate(state, goals, iso);
    const available = computeAvailableCorpusAtDate(state, iso);
    return {
      iso,
      label: formatQuarterLabel(iso),
      required,
      available,
      shortfall: Math.max(0, required - available),
    };
  });
}

function computeOutlookInsights(chartData, goals) {
  const insights = [];
  for (const pt of chartData || []) {
    if (pt.shortfall <= 0) continue;
    const year = (parseISODate(pt.iso) || new Date()).getFullYear();
    const crunch = goals.find((g) => {
      const td = parseISODate(g.targetDate);
      return td && td.getFullYear() === year && !g.isEmergencyFund;
    });
    insights.push({
      tone: "warn",
      label: `${year} — funding gap ${formatCompactINR(pt.shortfall)}`,
      detail: crunch ? `${crunch.name} target falls in this period` : "Goals exceed projected corpus",
    });
  }
  const last = chartData?.[chartData.length - 1];
  if (last && last.available > last.required) {
    insights.push({
      tone: "good",
      label: `${formatQuarterLabel(last.iso)} — corpus ahead`,
      detail: "Projected wealth exceeds total requirements",
    });
  }
  return insights.slice(0, 4);
}

function computeGoalFundingRatio(goals, allocationsByGoal) {
  let totalTarget = 0;
  let totalAllocated = 0;
  for (const g of goals) {
    const target = safeNumber(g.targetAmount);
    if (target <= 0) continue;
    totalTarget += target;
    totalAllocated += Math.min(safeNumber(allocationsByGoal[g.id]?.allocatedAmount), target);
  }
  if (totalTarget <= 0) return 0;
  return (totalAllocated / totalTarget) * 100;
}

function migrateV1Holdings(holdings, goalIdSet) {
  const bankAccounts = [];
  const investments = [];
  for (const h of holdings || []) {
    if (!h || typeof h.id !== "string") continue;
    const allocations = filterAllocationsForGoals(h.allocations, goalIdSet);
    if (h.type === "BANK") {
      bankAccounts.push({
        id: String(h.id),
        bankName: String(h.name || "State Bank of India"),
        balance: safeNumber(h.amount),
        allocations,
      });
    } else {
      const typeMap = { MF: InvestmentType.MF, FD: InvestmentType.FD, STOCK: InvestmentType.STOCK };
      investments.push({
        id: String(h.id),
        type: typeMap[h.type] || InvestmentType.MF,
        name: String(h.name || ""),
        bankName: "",
        outstandingAmount: safeNumber(h.amount),
        isRecurring: false,
        frequency: "",
        maturityAmount: 0,
        maturityDate: "",
        recurringAllocationMode: "monthly",
        monthlyContribution: 0,
        allocations,
      });
    }
  }
  return { bankAccounts, investments };
}

function buildDefaultState() {
  const today = todayLocalISODate();
  const emergencyId = generateId();
  const monthlyExpenses = 0;
  return {
    version: STATE_VERSION,
    monthlyIncome: 0,
    monthlyExpenses,
    commitments: [],
    bankAccounts: [],
    investments: [],
    goals: applyEmergencyFundTarget(
      [
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
      monthlyExpenses,
      0
    ),
    updatedAt: Date.now(),
  };
}

function coerceGoals(rawGoals, monthlyExpenses, monthlyCommitments) {
  const goals = (rawGoals || [])
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
  return applyEmergencyFundTarget(goals, monthlyExpenses, monthlyCommitments);
}

function validateAndCoerceState(unknown) {
  if (!unknown || typeof unknown !== "object") return null;
  if (!Array.isArray(unknown.goals)) return null;

  const version = unknown.version || 1;
  const monthlyIncome = safeNumber(unknown.monthlyIncome);
  const monthlyExpenses = safeNumber(unknown.monthlyExpenses);
  const rawCommitments = version >= 2 ? unknown.commitments || [] : [];
  const monthlyCommitments = (rawCommitments || []).reduce((s, c) => s + safeNumber(c?.monthlyEmi), 0);
  let goals = coerceGoals(unknown.goals, monthlyExpenses, monthlyCommitments);
  const goalIdSet = new Set(goals.map((g) => g.id));

  let bankAccounts = [];
  let investments = [];
  let commitments = [];

  if (version === 1) {
    const migrated = migrateV1Holdings(unknown.holdings || [], goalIdSet);
    bankAccounts = migrated.bankAccounts;
    investments = migrated.investments;
  } else if (version >= 2) {
    bankAccounts = (unknown.bankAccounts || [])
      .filter((b) => b && typeof b.id === "string")
      .map((b) => ({
        id: String(b.id),
        bankName: String(b.bankName || BANK_NAMES[0]),
        balance: safeNumber(b.balance),
        allocations: filterAllocationsForGoals(b.allocations, goalIdSet),
      }));

    investments = (unknown.investments || [])
      .filter((inv) => inv && typeof inv.id === "string")
      .map((inv) => {
        const type = Object.values(InvestmentType).includes(inv.type) ? inv.type : InvestmentType.MF;
        let outstandingAmount = safeNumber(inv.outstandingAmount);
        if (type === InvestmentType.POLICY || type === InvestmentType.RD) {
          outstandingAmount = safeNumber(inv.outstandingAmount);
        }
        const isRecurring = Boolean(inv.isRecurring);
        const recurringAllocationMode =
          inv.recurringAllocationMode === "maturity" ? "maturity" : "monthly";
        return {
          id: String(inv.id),
          type,
          name: String(inv.name || ""),
          bankName: String(inv.bankName || ""),
          outstandingAmount,
          isRecurring,
          frequency: isRecurring ? String(inv.frequency || "monthly") : "",
          maturityAmount: safeNumber(inv.maturityAmount),
          maturityDate: String(inv.maturityDate || ""),
          recurringAllocationMode: isRecurring ? recurringAllocationMode : "monthly",
          monthlyContribution: isRecurring ? safeNumber(inv.monthlyContribution) : 0,
          allocations: filterAllocationsForGoals(inv.allocations, goalIdSet),
        };
      });

    commitments = (unknown.commitments || [])
      .filter((c) => c && typeof c.id === "string")
      .map((c) => ({
        id: String(c.id),
        description: String(c.description || c.name || ""),
        bankName: String(c.bankName || BANK_NAMES[0]),
        outstandingAmount: safeNumber(c.outstandingAmount),
        monthlyEmi: safeNumber(c.monthlyEmi),
      }));
  } else {
    return null;
  }

  goals = applyEmergencyFundTarget(goals, monthlyExpenses, monthlyCommitments);

  return {
    version: STATE_VERSION,
    monthlyIncome,
    monthlyExpenses,
    commitments,
    bankAccounts,
    investments,
    goals,
    updatedAt: Date.now(),
  };
}

// --- UI helpers ---

const GOAL_THEMES = [
  { icon: "EF", iconBg: "bg-amber-500/15", bar: "bg-amber-400" },
  { icon: "H", iconBg: "bg-emerald-500/15", bar: "bg-emerald-400" },
  { icon: "R", iconBg: "bg-sky-500/15", bar: "bg-sky-400" },
  { icon: "T", iconBg: "bg-orange-500/15", bar: "bg-orange-400" },
  { icon: "E", iconBg: "bg-violet-500/15", bar: "bg-violet-400" },
  { icon: "G", iconBg: "bg-teal-500/15", bar: "bg-teal-400" },
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
  if (x >= 10000000) return "Rs. " + (x / 10000000).toFixed(1) + "Cr";
  if (x >= 100000) return "Rs. " + (x / 100000).toFixed(1) + "L";
  if (x >= 1000) return "Rs. " + (x / 1000).toFixed(1) + "K";
  return formatINR(x);
}

function formatTargetDate(iso) {
  const d = parseISODate(iso);
  if (!d) return iso || "-";
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function getGoalStatus(summary) {
  if (summary?.status) return summary.status;
  return { label: "On track", tone: "good" };
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

function StatusBadge({ status, reason }) {
  const toneClass = {
    ahead: "rounded-full bg-sky-500/15 px-3 py-1 text-xs font-medium text-sky-300",
    good: "rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300",
    slight: "rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300",
    warn: "rounded-full bg-rose-500/15 px-3 py-1 text-xs font-medium text-rose-300",
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={toneClass[status.tone] || toneClass.good}>{status.label}</span>
      {reason ? <span className="text-[10px] text-rose-300/90">{reason}</span> : null}
    </div>
  );
}

function GoalAllocationsPanel({ goalId, state }) {
  const sources = getGoalAllocatedSources(goalId, state);
  return (
    <div>
      <div className={cls.label}>Allocations</div>
      {sources.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No holdings allocated to this goal yet.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {sources.map((src) => (
            <div key={src.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-white">{src.name}</div>
                  <div className="text-xs text-slate-500">
                    {src.typeLabel} | {src.basisLabel}: {formatINR(src.basisAmount)}
                    {src.note ? ` | ${src.note}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-white">{formatINR(src.allocatedAmount)}</div>
                  <div className="text-xs text-slate-500">{Math.round(src.allocationPct)}%</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GoalDetailContent({ goal, summary, index, state }) {
  const theme = getGoalTheme(goal, index);
  const allocated = summary?.allocatedAmount ?? computeGoalExistingAllocation(goal.id, state);
  const pct = goal.targetAmount > 0 ? clamp((allocated / goal.targetAmount) * 100, 0, 100) : 0;
  const status = getGoalStatus(summary);
  const attentionReason = summary?.attentionReason ?? getGoalAttentionReason(goal, state, summary);
  const monthlyRequired = summary?.monthlyRequired ?? 0;
  const sources = getGoalAllocatedSources(goal.id, state);

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl text-sm font-semibold text-white ${theme.iconBg}`}>
          {theme.icon}
        </div>
        <StatusBadge status={status} reason={attentionReason} />
      </div>

      <h3 className="mt-5 text-lg font-semibold text-white">{goal.name}</h3>
      <p className="mt-1 text-sm text-slate-500">
        Target | {formatTargetDate(goal.targetDate)}
        {goal.targetAmount > 0 ? ` | ${formatCompactINR(goal.targetAmount)}` : ""}
      </p>

      <div className="mt-5">
        <ProgressBar pct={pct} barClass={theme.bar} />
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-slate-500">{formatCompactINR(allocated)} invested so far</span>
        <span className="font-semibold text-white">{Math.round(pct)}%</span>
      </div>

      {goal.targetAmount > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">
            Target {formatINR(goal.targetAmount)}
          </span>
          {monthlyRequired > 0 ? (
            <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              Need {formatINR(monthlyRequired)}/month
            </span>
          ) : (
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              Fully funded on plan
            </span>
          )}
        </div>
      ) : null}

      <div className="mt-6">
        <div className={cls.label}>Allocated investments</div>
        {sources.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No holdings allocated to this goal yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {sources.map((src) => (
              <div key={src.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-white">{src.name}</div>
                    <div className="text-xs text-slate-500">
                      {src.typeLabel} | {src.basisLabel}: {formatINR(src.basisAmount)}
                      {src.note ? ` | ${src.note}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-white">{formatINR(src.allocatedAmount)}</div>
                    <div className="text-xs text-slate-500">{Math.round(src.allocationPct)}%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
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

function GoalProgressCard({ goal, summary, index, state, onClick, demo }) {
  const theme = getGoalTheme(goal, index);
  const allocated = summary?.allocatedAmount ?? 0;
  const pct = goal.targetAmount > 0 ? clamp((allocated / goal.targetAmount) * 100, 0, 100) : 0;
  const status = getGoalStatus(summary);
  const monthlyRequired = summary?.monthlyRequired ?? 0;
  const attentionReason = summary?.attentionReason ?? null;

  const cardBody = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl text-sm font-semibold text-white ${theme.iconBg}`}>
          {theme.icon}
        </div>
        <StatusBadge status={status} reason={attentionReason} />
      </div>

      <h3 className="mt-5 text-lg font-semibold text-white">{goal.name}</h3>
      <p className="mt-1 text-sm text-slate-500">
        Target | {formatTargetDate(goal.targetDate)}
        {goal.targetAmount > 0 ? ` | ${formatCompactINR(goal.targetAmount)}` : ""}
      </p>

      <div className="mt-5">
        <ProgressBar pct={pct} barClass={theme.bar} />
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-slate-500">{formatCompactINR(allocated)} invested</span>
        <span className="font-semibold text-white">{Math.round(pct)}%</span>
      </div>

      {goal.targetAmount > 0 ? (
        <div className="mt-4">
          <span
            className={
              monthlyRequired > 0
                ? "rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300"
                : "rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300"
            }
          >
            {monthlyRequired > 0 ? `Need ${formatINR(monthlyRequired)}/month` : "Fully funded on plan"}
          </span>
        </div>
      ) : null}

      {!demo ? <p className="mt-4 text-xs text-slate-500">Click for full details</p> : null}
    </>
  );

  if (demo || !onClick) {
    return <div className={`${cls.card} p-5`}>{cardBody}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${cls.card} w-full p-5 text-left transition hover:border-white/25 hover:bg-white/[0.02]`}
    >
      {cardBody}
    </button>
  );
}

function GoalDetailModal({ open, goal, summary, index, state, onClose }) {
  if (!open || !goal) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className={`${cls.card} max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <p className={cls.label}>Goal details</p>
          <button className={cls.btnGhost} onClick={onClose}>
            Close
          </button>
        </div>
        <GoalDetailContent goal={goal} summary={summary} index={index} state={state} />
      </div>
    </div>
  );
}

function TabNavFooter({ label, buttonText, onNext }) {
  return (
    <div className={`${cls.card} mt-10 flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center`}>
      <p className="text-sm text-slate-400">{label}</p>
      <button className={cls.btnPrimary} onClick={onNext}>
        {buttonText}
      </button>
    </div>
  );
}

function OutlookChart({ data }) {
  const width = 900;
  const height = 320;
  const pad = { top: 24, right: 24, bottom: 56, left: 72 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  if (!data || data.length === 0) {
    return <p className="text-sm text-slate-500">Add goals and financial data to see your outlook.</p>;
  }

  const maxVal = Math.max(...data.flatMap((d) => [d.required, d.available]), 1);
  const yMax = Math.ceil(maxVal / 100000) * 100000 || 100000;
  const ticks = 5;

  const firstYear = (parseISODate(data[0].iso) || new Date()).getFullYear();
  const lastYear = (parseISODate(data[data.length - 1].iso) || new Date()).getFullYear();
  const spanYears = Math.max(1, lastYear - firstYear + 1);
  const labelStride = getChartLabelStride(data.length, spanYears);

  const xAt = (i) => pad.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const yAt = (v) => pad.top + innerH - (v / yMax) * innerH;

  const linePath = (key) =>
    data
      .map((d, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(d[key]).toFixed(1)}`)
      .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Financial outlook chart">
      {[...Array(ticks + 1)].map((_, i) => {
        const v = (yMax / ticks) * i;
        const y = yAt(v);
        return (
          <g key={`grid_${i}`}>
            <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" />
            <text x={pad.left - 8} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="11">
              {formatCompactINR(v)}
            </text>
          </g>
        );
      })}

      {data.map((d, i) =>
        d.required > d.available ? (
          <rect
            key={`gap_${i}`}
            x={xAt(i) - 12}
            y={yAt(d.required)}
            width={24}
            height={Math.max(0, yAt(d.available) - yAt(d.required))}
            fill="rgba(244,63,94,0.18)"
          />
        ) : null
      )}

      <path d={linePath("available")} fill="none" stroke="#38bdf8" strokeWidth="2.5" />
      <path d={linePath("required")} fill="none" stroke="#fb7185" strokeWidth="2.5" strokeDasharray="8 6" />

      {data.map((d, i) => (
        <g key={d.iso}>
          <circle cx={xAt(i)} cy={yAt(d.available)} r="4" fill="#38bdf8" />
          <circle cx={xAt(i)} cy={yAt(d.required)} r="4" fill="#fb7185" />
          {i % labelStride === 0 || i === data.length - 1 ? (
            <text
              x={xAt(i)}
              y={height - 12}
              textAnchor="middle"
              fill="#94a3b8"
              fontSize={spanYears > 6 ? 10 : 11}
              transform={spanYears > 6 ? undefined : `rotate(-20 ${xAt(i)} ${height - 12})`}
            >
              {formatChartXLabel(d.iso, spanYears)}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

function OutlookScreen({ state, goals, chartData, insights }) {
  return (
    <div className={`${cls.page} py-8`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={cls.label}>Outlook</p>
          <h1 className={cls.heading}>Financial outlook</h1>
          <p className={cls.subtext}>Your projected wealth vs total goal requirements over time.</p>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-400" /> Projected corpus
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-400" /> Total required corpus
          </span>
        </div>
      </div>

      {insights?.length > 0 ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {insights.map((item, idx) => (
            <span
              key={`ins_${idx}`}
              className={
                item.tone === "good"
                  ? "rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300"
                  : item.tone === "warn"
                    ? "rounded-full bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300"
                    : "rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300"
              }
              title={item.detail}
            >
              {item.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className={`${cls.card} mt-6 p-4 sm:p-6`}>
        <OutlookChart data={chartData} />
      </div>

      <div className={`${cls.card} mt-4 p-4 text-sm leading-relaxed text-slate-400`}>
        <span className="font-semibold text-white">Reading this chart</span> — when the red dashed line is above the
        blue line, your goals exceed projected wealth at that point. The shaded gap is your funding shortfall. When blue
        overtakes red, you are ahead.
      </div>
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

const LANDING_DEMO = {
  netWorth: 2732000,
  goalFundingRatio: 71,
  goalFundingSurplus: 137000,
  goalFundingRequired: 110000,
  fundingScore: 71,
  allocatedCorpus: 840000,
  goalCount: 5,
};

const ONBOARDING_DEMO_GOALS = [
  {
    id: "demo_ef",
    name: "Emergency Fund",
    targetDate: "2027-06-01",
    targetAmount: 690000,
    icon: "EF",
    iconBg: "bg-amber-500/15",
    bar: "bg-amber-400",
    allocated: 300000,
    monthlyRequired: 35864,
    status: { label: "Needs attention", tone: "warn" },
    attentionReason: "Falling behind of schedule",
  },
  {
    id: "demo_car",
    name: "Car downpayment",
    targetDate: "2029-01-01",
    targetAmount: 1500000,
    icon: "T",
    iconBg: "bg-orange-500/15",
    bar: "bg-orange-400",
    allocated: 220000,
    monthlyRequired: 42800,
    status: { label: "Ahead of schedule", tone: "ahead" },
    attentionReason: null,
  },
  {
    id: "demo_trip",
    name: "Europe Family Trip",
    targetDate: "2027-11-01",
    targetAmount: 450000,
    icon: "T",
    iconBg: "bg-orange-500/15",
    bar: "bg-orange-400",
    allocated: 110000,
    monthlyRequired: 21375,
    status: { label: "Ahead of schedule", tone: "ahead" },
    attentionReason: null,
  },
  {
    id: "demo_fire",
    name: "Retire Early",
    targetDate: "2036-06-01",
    targetAmount: 20000000,
    icon: "R",
    iconBg: "bg-sky-500/15",
    bar: "bg-sky-400",
    allocated: 4380000,
    monthlyRequired: 131294,
    status: { label: "Needs attention", tone: "warn" },
    attentionReason: "Falling behind of schedule",
  },
];

function OnboardingNav({ step, onBack, onNext, nextLabel }) {
  return (
    <div className="mt-10 flex items-center justify-between">
      {step > 0 ? (
        <button type="button" className={cls.btnGhost} onClick={onBack} aria-label="Previous">
          ← Back
        </button>
      ) : (
        <div />
      )}
      <button type="button" className={cls.btnPrimary} onClick={onNext}>
        {nextLabel || "Next →"}
      </button>
    </div>
  );
}

function OnboardingScreen({ step, setStep, onFinish }) {
  if (step === 0) {
    return (
      <div className="min-h-screen">
        <header className={`${cls.page} py-6`}>
          <div className="text-lg font-semibold tracking-tight text-white">
            Arth<span className="text-emerald-400">a</span>
          </div>
        </header>
        <main className={`${cls.page} pb-16`}>
          <p className={cls.label}>Step 1 of 3</p>
          <h1 className={cls.heading}>Set your goals</h1>
          <p className={cls.subtext}>Define what you are saving for and when you need the money.</p>

          <div className={`${cls.card} mt-8 p-6`}>
            <p className={cls.label}>Edit</p>
            <h2 className="mt-1 text-xl font-semibold text-white">FIRE</h2>
            <p className={cls.subtext}>Set a target amount and date. Allocate your holdings to this goal in Financial Data.</p>

            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={cls.label}>Goal name</label>
                <div className={`${cls.input} bg-white/[0.03] text-slate-300`}>FIRE</div>
              </div>
              <div>
                <label className={cls.label}>Target date</label>
                <div className={`${cls.input} bg-white/[0.03] text-slate-300`}>01-06-2036</div>
              </div>
              <div>
                <label className={cls.label}>Target amount (INR)</label>
                <div className={`${cls.input} bg-white/[0.03] text-slate-300`}>30000000</div>
              </div>
            </div>
          </div>

          <OnboardingNav step={0} onBack={() => {}} onNext={() => setStep(1)} />
        </main>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="min-h-screen">
        <header className={`${cls.page} py-6`}>
          <div className="text-lg font-semibold tracking-tight text-white">
            Arth<span className="text-emerald-400">a</span>
          </div>
        </header>
        <main className={`${cls.page} pb-16`}>
          <p className={cls.label}>Step 2 of 3</p>
          <h1 className={cls.heading}>Map your investments</h1>
          <p className={cls.subtext}>Link bank balances and investments to your goals.</p>

          <section className={`${cls.card} mt-8 p-6`}>
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">4</span>
              <div>
                <h2 className="text-lg font-semibold text-white">Bank accounts</h2>
                <p className="text-sm text-slate-500">Savings balances allocated to goals</p>
              </div>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-[640px] w-full">
                <thead>
                  <tr>
                    <th className={cls.th}>Bank</th>
                    <th className={cls.th}>Balance</th>
                    <th className={cls.th}>Goal allocation</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={cls.td}>Central Bank of India</td>
                    <td className={cls.td}>{formatINR(281000)}</td>
                    <td className={cls.td}>Emergency Fund 50%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className={`${cls.card} mt-6 p-6`}>
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">5</span>
              <div>
                <h2 className="text-lg font-semibold text-white">Investments</h2>
                <p className="text-sm text-slate-500">MFs, stocks, FDs, RDs, policies - allocate to goals</p>
              </div>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-[760px] w-full">
                <thead>
                  <tr>
                    <th className={cls.th}>Name</th>
                    <th className={cls.th}>Type</th>
                    <th className={cls.th}>Bank</th>
                    <th className={cls.th}>Outstanding</th>
                    <th className={cls.th}>Recurring</th>
                    <th className={cls.th}>Recurring amount</th>
                    <th className={cls.th}>Goals</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={cls.td}>HDFC Bank</td>
                    <td className={cls.td}>FD</td>
                    <td className={cls.td}>HDFC Bank</td>
                    <td className={cls.td}>{formatINR(1200000)}</td>
                    <td className={cls.td}>No</td>
                    <td className={cls.td}>-</td>
                    <td className={cls.td}>Emergency Fund 80%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <OnboardingNav step={1} onBack={() => setStep(0)} onNext={() => setStep(2)} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className={`${cls.page} py-6`}>
        <div className="text-lg font-semibold tracking-tight text-white">
          Arth<span className="text-emerald-400">a</span>
        </div>
      </header>
      <main className={`${cls.page} pb-16`}>
        <p className={cls.label}>Step 3 of 3</p>
        <h1 className={cls.heading}>See where you stand</h1>
        <p className={cls.subtext}>Track progress across goals and spot what needs attention.</p>

        <p className={`${cls.label} mt-10`}>Goal progress</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {ONBOARDING_DEMO_GOALS.map((g) => {
            const pct = g.targetAmount > 0 ? clamp((g.allocated / g.targetAmount) * 100, 0, 100) : 0;
            return (
              <div key={g.id} className={`${cls.card} p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl text-sm font-semibold text-white ${g.iconBg}`}>
                    {g.icon}
                  </div>
                  <StatusBadge status={g.status} reason={g.attentionReason} />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-white">{g.name}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Target | {formatTargetDate(g.targetDate)} | {formatCompactINR(g.targetAmount)}
                </p>
                <div className="mt-5">
                  <ProgressBar pct={pct} barClass={g.bar} />
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-slate-500">{formatCompactINR(g.allocated)} invested</span>
                  <span className="font-semibold text-white">{Math.round(pct)}%</span>
                </div>
                <div className="mt-4">
                  <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
                    Need {formatINR(g.monthlyRequired)}/month
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <OnboardingNav step={2} onBack={() => setStep(1)} onNext={onFinish} nextLabel="Get started" />
      </main>
    </div>
  );
}

function LandingScreen({ isEmpty, onEnterApp, onStartTour }) {
  return (
    <div className="min-h-screen">
      <header className={`${cls.page} flex items-center justify-between py-6`}>
        <div className="text-lg font-semibold tracking-tight text-white">
          Arth<span className="text-emerald-400">a</span>
        </div>
        <button className={cls.btnSecondary} onClick={isEmpty ? onStartTour : onEnterApp}>
          Get started free
        </button>
      </header>

      <main className={`${cls.page} pb-16 pt-8`}>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
          Your financial clarity starts here
        </p>
        <h1 className="font-serif mt-4 max-w-3xl text-4xl font-semibold leading-tight text-white sm:text-5xl">
          Your future, mapped.
        </h1>
        <p className={cls.subtext + " mt-4 max-w-2xl"}>
          Set your goals. Map your investments. See exactly where you stand, and what to do next.
        </p>

        <div className={`${cls.card} mt-10 p-6`}>
          <div className="text-sm text-slate-500">Goal funding score</div>
          <div className="mt-2 text-5xl font-semibold text-emerald-400">{LANDING_DEMO.fundingScore}%</div>
          <div className="mt-4">
            <ProgressBar pct={LANDING_DEMO.fundingScore} barClass="bg-emerald-400" />
          </div>
          <p className="mt-4 text-sm text-slate-500">
            {formatCompactINR(LANDING_DEMO.allocatedCorpus)} allocated across {LANDING_DEMO.goalCount} goals
          </p>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          {isEmpty ? (
            <button className={cls.btnPrimary} onClick={onStartTour}>
              See how it works
            </button>
          ) : (
            <button className={cls.btnPrimary} onClick={onEnterApp}>
              Map my goals
            </button>
          )}
        </div>
        <p className="mt-6 text-xs text-slate-500">No account needed. Your data stays on your device.</p>

        <section className="mt-16 border-t border-white/10 pt-10">
          <p className={cls.label}>Financial position</p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className={`${cls.card} p-5`}>
              <div className={cls.label}>Net worth</div>
              <div className="mt-2 text-2xl font-semibold text-white">{formatINR(LANDING_DEMO.netWorth)}</div>
            </div>
            <div className={`${cls.card} p-5`}>
              <div className={cls.label}>Goal funding ratio</div>
              <div className="mt-2 text-2xl font-semibold text-white">{LANDING_DEMO.goalFundingRatio}%</div>
              <div className="mt-1 text-xs text-slate-500">Across {LANDING_DEMO.goalCount} goals</div>
            </div>
            <div className={`${cls.card} p-5`}>
              <div className={cls.label}>Goal funding rate</div>
              <div className="mt-2 text-2xl font-semibold text-emerald-400">
                {formatINR(LANDING_DEMO.goalFundingSurplus)} / {formatINR(LANDING_DEMO.goalFundingRequired)}
              </div>
              <div className="mt-1 text-xs text-slate-500">Surplus vs required monthly</div>
            </div>
          </div>
        </section>
      </main>

      <footer className={`${cls.page} flex flex-col gap-3 border-t border-white/10 py-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between`}>
        <div className="font-semibold text-white">
          Arth<span className="text-emerald-400">a</span>
        </div>
        <div>Privacy by default - no data leaves your browser</div>
      </footer>
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
  onLogoClick,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const tabs = [
    { id: "goals", label: "Goals" },
    { id: "portfolio", label: "Financial Data" },
    { id: "dashboard", label: "Dashboard" },
    { id: "outlook", label: "Outlook" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#050505]/90 backdrop-blur-xl">
      <div className={`${cls.page} py-4`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <button type="button" className="flex items-center gap-3 text-left" onClick={onLogoClick}>
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-sm font-semibold text-white">
              A
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight text-white">
                Arth<span className="text-emerald-400">a</span>
              </div>
            </div>
          </button>

          <nav className="flex flex-wrap items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
            {tabs.map((tab) => (
              <button key={tab.id} className={cls.navTab(activeTab === tab.id)} onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="relative flex items-center gap-2">
            <button className={cls.btnGhost} onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
              ...
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

function DashboardScreen({ goals, summaries, metrics, includeDebt, setIncludeDebt, state, onOpenGoal, onGoToOutlook }) {
  const surplus = metrics.investableSurplus;
  const required = metrics.totalRequiredMonthly;
  const fundingOk = surplus >= required;

  return (
    <div className={`${cls.page} py-8`}>
      <div>
        <p className={cls.label}>Overview</p>
        <h1 className={cls.heading}>Your financial goals</h1>
        <p className={cls.subtext}>Track progress across goals. Update numbers in Financial Data.</p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={`${cls.card} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div className={cls.label}>Net worth</div>
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-500">
              <span>Include debt</span>
                <button
                  type="button"
                  onClick={() => setIncludeDebt(!includeDebt)}
                  className={`relative h-5 w-9 rounded-full transition-colors duration-200 ${
                    includeDebt ? "bg-emerald-500" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-200 ${
                      includeDebt ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
          </label>
          </div>
          <div className={`mt-2 text-2xl font-semibold ${metrics.netWorth < 0 ? "text-rose-400" : "text-white"}`}>
            {formatINR(metrics.netWorth)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {includeDebt
              ? "Bank balances + investments - debt"
              : "Bank balances + investments"}
          </div>
        </div>
        <div className={`${cls.card} p-5`}>
          <div className={cls.label}>Goal funding ratio</div>
          <div className="mt-2 text-2xl font-semibold text-white">{Math.round(metrics.goalFundingRatio)}%</div>
          <div className="mt-1 text-xs text-slate-500">Allocated vs total goal targets</div>
        </div>
        <div className={`${cls.card} p-5`}>
          <div className={cls.label}>Goal funding rate</div>
          <div className={`mt-2 text-2xl font-semibold ${fundingOk ? "text-emerald-400" : "text-rose-400"}`}>
            {formatINR(surplus)} / {formatINR(required)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Monthly surplus vs total monthly required for goals</div>
        </div>
      </div>

      <div className="mt-10">
        <p className={cls.label}>Goal progress</p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {goals.map((g, idx) => (
          <GoalProgressCard
            key={g.id}
            goal={g}
            summary={summaries[g.id]}
            index={idx}
            state={state}
            onClick={() => onOpenGoal(g.id)}
          />
        ))}
      </div>

      {goals.length === 1 && goals[0]?.isEmergencyFund ? (
        <div className={`${cls.card} mt-6 p-6 text-center`}>
          <p className="text-sm text-slate-400">
            Add your income, expenses, and investments in <span className="text-white">Financial Data</span>, then create
            more goals.
          </p>
        </div>
      ) : null}

      <TabNavFooter
        label="See how your corpus tracks against future requirements."
        buttonText="View outlook"
        onNext={onGoToOutlook}
      />
    </div>
  );
}

function GoalsScreen({
  goals,
  goalSummaries,
  goalEditorId,
  setGoalEditorId,
  emergencyGoalId,
  emergencyFundTargetAmount,
  state,
  onSaveGoal,
  onDeleteGoal,
  onGoToFinancialData,
}) {
  const isNew = goalEditorId === "new";
  const selectedGoal = isNew ? null : goals.find((g) => g.id === goalEditorId);
  const isEmergency = !isNew && selectedGoal?.id === emergencyGoalId;
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
                      {formatTargetDate(g.targetDate)} | {formatCompactINR(g.targetAmount)}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {formatCompactINR(goalSummaries?.[g.id]?.allocatedAmount ?? 0)} invested
                    </div>
                    {goalSummaries?.[g.id]?.attentionReason ? (
                      <div className="mt-1 text-xs text-rose-300">{goalSummaries[g.id].attentionReason}</div>
                    ) : null}
                    {goalSummaries?.[g.id]?.monthlyRequired > 0 ? (
                      <div className="mt-1 text-xs font-medium text-amber-300">
                        Need {formatINR(goalSummaries[g.id].monthlyRequired)}/month
                      </div>
                    ) : g.targetAmount > 0 ? (
                      <div className="mt-1 text-xs text-emerald-400">On plan</div>
                    ) : null}
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
                {isEmergency ? (
                  <div className={`${cls.input} flex items-center justify-between bg-white/[0.03] text-slate-300`}>
                    <span>{formatINR(emergencyFundTargetAmount)}</span>
                    <span className="text-xs text-amber-300">Auto: 6x (expenses + EMIs)</span>
                  </div>
                ) : (
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className={cls.input}
                    value={draftTargetAmount}
                    onChange={(e) => setDraftTargetAmount(e.target.value)}
                    placeholder="5000000"
                  />
                )}
              </div>
            </div>

            {!isNew && selectedGoal?.targetAmount > 0 ? (
              <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className={cls.label}>Required monthly investment</div>
                <div className="mt-2 text-lg font-semibold text-white">
                  {goalSummaries?.[selectedGoal.id]?.monthlyRequired > 0
                    ? formatINR(goalSummaries[selectedGoal.id].monthlyRequired)
                    : formatINR(0)}
                  <span className="text-sm font-normal text-slate-500"> / month</span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Based on target amount, target date, and current allocated holdings (not including future SIPs).
                </p>
              </div>
            ) : null}

            {!isNew && selectedGoal ? (
              <div className="mt-8 border-t border-white/10 pt-8">
                <GoalAllocationsPanel goalId={selectedGoal.id} state={state} />
              </div>
            ) : null}

            <div className="mt-8 flex justify-end gap-3">
              <button className={cls.btnSecondary} onClick={() => setGoalEditorId(isNew ? "new" : selectedGoal?.id)}>
                Reset
              </button>
              <button
                className={cls.btnPrimary}
                onClick={() => {
                  if (!String(draftName || "").trim()) return alert("Please enter a goal name.");
                  if (!parseISODate(draftTargetDate)) return alert("Please select a valid target date.");
                  if (!isEmergency && safeNumber(draftTargetAmount) < 0) return alert("Target amount must be 0 or more.");
                  onSaveGoal({
                    name: draftName,
                    targetAmount: isEmergency ? emergencyFundTargetAmount : safeNumber(draftTargetAmount),
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

      <TabNavFooter
        label="Allocate bank balances and investments to your goals."
        buttonText="Go to financial data"
        onNext={onGoToFinancialData}
      />
    </div>
  );
}

function AllocationEditor({ goals, amount, allocations, setAllocations, allocationHint }) {
  const allocatedPctSum = useMemo(
    () => getAllocatedPctSumForHolding({ amount: safeNumber(amount), allocations }),
    [amount, allocations]
  );

  return (
    <div className={`${cls.card} mt-6 p-4`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">Allocate to goals</div>
          <div className="mt-1 text-xs text-slate-500">
            Total must be {"<="} 100%{allocationHint ? ` (${allocationHint})` : ""}
          </div>
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
  );
}

function BankSelect({ value, onChange, className }) {
  return (
    <select className={className || cls.select} value={value} onChange={(e) => onChange(e.target.value)}>
      {BANK_NAMES.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

function FinancialDataScreen({
  goals,
  monthlyIncome,
  monthlyExpenses,
  commitments,
  bankAccounts,
  investments,
  onUpdateIncome,
  onUpdateExpenses,
  onAddCommitment,
  onUpdateCommitment,
  onDeleteCommitment,
  onAddBankAccount,
  onEditBankAccount,
  onDeleteBankAccount,
  onAddInvestment,
  onEditInvestment,
  onDeleteInvestment,
  onGoToDashboard,
}) {
  const totalEmi = commitments.reduce((s, c) => s + safeNumber(c.monthlyEmi), 0);
  const emergencyNote = `Emergency fund target auto-updates to ${EMERGENCY_FUND_MONTHS}x your monthly expenses plus commitments (${formatINR(emergencyFundTarget(monthlyExpenses, totalEmi))}).`;

  return (
    <div className={`${cls.page} py-8`}>
      <div>
        <p className={cls.label}>Financial data</p>
        <h1 className={cls.heading}>Your finances</h1>
        <p className={cls.subtext}>Enter income, commitments, expenses, bank accounts and investments.</p>
      </div>

      {/* Section 1 - Income */}
      <section className={`${cls.card} mt-8 p-6`}>
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">1</span>
          <div>
            <h2 className="text-lg font-semibold text-white">Income</h2>
            <p className="text-sm text-slate-500">Your total monthly take-home income</p>
          </div>
        </div>
        <div className="mt-5 max-w-md">
          <label className={cls.label}>Monthly income (INR)</label>
          <input
            type="number"
            min="0"
            className={cls.input}
            value={monthlyIncome || ""}
            onChange={(e) => onUpdateIncome(parseNumberInput(e.target.value))}
            placeholder="150000"
          />
        </div>
      </section>

      {/* Section 2 - Commitments */}
      <section className={`${cls.card} mt-6 p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">2</span>
            <div>
              <h2 className="text-lg font-semibold text-white">Commitments</h2>
              <p className="text-sm text-slate-500">Outstanding loans and monthly EMIs</p>
            </div>
          </div>
          <button className={cls.btnSecondary} onClick={onAddCommitment}>
            + Add loan
          </button>
        </div>
        {commitments.length === 0 ? (
          <p className="mt-5 text-sm text-slate-500">No loans added yet.</p>
        ) : (
          <div className="mt-5 space-y-4">
            {commitments.map((c) => (
              <div key={c.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className={cls.label}>Description</label>
                    <input
                      className={cls.input}
                      value={c.description || ""}
                      onChange={(e) => onUpdateCommitment(c.id, { description: e.target.value })}
                      placeholder="Home loan"
                    />
                  </div>
                  <div>
                    <label className={cls.label}>Bank</label>
                    <BankSelect
                      value={c.bankName || BANK_NAMES[0]}
                      onChange={(v) => onUpdateCommitment(c.id, { bankName: v })}
                      className={cls.input}
                    />
                  </div>
                  <div>
                    <label className={cls.label}>Outstanding amount</label>
                    <input
                      type="number"
                      min="0"
                      className={cls.input}
                      value={c.outstandingAmount || ""}
                      onChange={(e) => onUpdateCommitment(c.id, { outstandingAmount: parseNumberInput(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className={cls.label}>Monthly EMI</label>
                    <input
                      type="number"
                      min="0"
                      className={cls.input}
                      value={c.monthlyEmi || ""}
                      onChange={(e) => onUpdateCommitment(c.id, { monthlyEmi: parseNumberInput(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <button className={cls.btnDanger} onClick={() => onDeleteCommitment(c.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 3 - Expenses */}
      <section className={`${cls.card} mt-6 p-6`}>
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">3</span>
          <div>
            <h2 className="text-lg font-semibold text-white">Expenses</h2>
            <p className="text-sm text-slate-500">Monthly living expenses, excluding loan EMIs above</p>
          </div>
        </div>
        <div className="mt-5 max-w-md">
          <label className={cls.label}>Monthly expenses (INR)</label>
          <input
            type="number"
            min="0"
            className={cls.input}
            value={monthlyExpenses || ""}
            onChange={(e) => onUpdateExpenses(parseNumberInput(e.target.value))}
            placeholder="50000"
          />
          <p className="mt-2 text-xs text-slate-500">{emergencyNote}</p>
        </div>
      </section>

      {/* Section 4 - Bank Accounts */}
      <section className={`${cls.card} mt-6 p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">4</span>
            <div>
              <h2 className="text-lg font-semibold text-white">Bank accounts</h2>
              <p className="text-sm text-slate-500">Savings balances allocated to goals</p>
            </div>
          </div>
          <button className={cls.btnPrimary} onClick={onAddBankAccount}>
            + Add account
          </button>
        </div>
        {bankAccounts.length === 0 ? (
          <p className="mt-5 text-sm text-slate-500">No bank accounts yet.</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-[640px] w-full">
              <thead>
                <tr>
                  <th className={cls.th}>Bank</th>
                  <th className={cls.th}>Balance</th>
                  <th className={cls.th}>Goal allocation</th>
                  <th className={cls.th}></th>
                </tr>
              </thead>
              <tbody>
                {bankAccounts.map((b) => {
                  const allocs = Object.entries(normalizeAllocations(b.allocations || {}));
                  const allocText =
                    allocs.length === 0
                      ? "Not allocated"
                      : allocs
                          .map(([gid, pct]) => {
                            const goal = goals.find((g) => g.id === gid);
                            return `${goal ? goal.name : "?"} ${Math.round(pct)}%`;
                          })
                          .join("  |  ");
                  return (
                    <tr key={b.id}>
                      <td className={cls.td}>{b.bankName}</td>
                      <td className={cls.td}>{formatINR(b.balance)}</td>
                      <td className={`${cls.td} max-w-xs truncate text-slate-500`}>{allocText}</td>
                      <td className={cls.td}>
                        <div className="flex gap-2">
                          <button className={cls.btnGhost} onClick={() => onEditBankAccount(b.id)}>
                            Edit
                          </button>
                          <button className={cls.btnDanger} onClick={() => onDeleteBankAccount(b.id)}>
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
      </section>

      {/* Section 5 - Investments */}
      <section className={`${cls.card} mt-6 p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">5</span>
            <div>
              <h2 className="text-lg font-semibold text-white">Investments</h2>
              <p className="text-sm text-slate-500">MFs, stocks, FDs, RDs, policies - allocate to goals</p>
            </div>
          </div>
          <button className={cls.btnPrimary} onClick={onAddInvestment}>
            + Add investment
          </button>
        </div>
        {investments.length === 0 ? (
          <p className="mt-5 text-sm text-slate-500">No investments yet.</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-[760px] w-full">
              <thead>
                <tr>
                  <th className={cls.th}>Name</th>
                  <th className={cls.th}>Type</th>
                  <th className={cls.th}>Bank</th>
                  <th className={cls.th}>Outstanding</th>
                  <th className={cls.th}>Recurring</th>
                  <th className={cls.th}>Recurring amount</th>
                  <th className={cls.th}>Goals</th>
                  <th className={cls.th}></th>
                </tr>
              </thead>
              <tbody>
                {investments.map((inv) => {
                  const allocs = Object.entries(normalizeAllocations(inv.allocations || {}));
                  const allocText =
                    allocs.length === 0
                      ? "-"
                      : allocs
                          .map(([gid, pct]) => {
                            const goal = goals.find((g) => g.id === gid);
                            return `${goal ? goal.name : "?"} ${Math.round(pct)}%`;
                          })
                          .join("  |  ");
                  return (
                    <tr key={inv.id}>
                      <td className={cls.td}>
                        {inv.type === InvestmentType.FD || inv.type === InvestmentType.RD
                          ? inv.bankName || "-"
                          : inv.name || "-"}
                      </td>
                      <td className={cls.td}>{investmentTypeLabels[inv.type]}</td>
                      <td className={cls.td}>
                        {inv.type === InvestmentType.FD || inv.type === InvestmentType.RD ? inv.bankName || "-" : "-"}
                      </td>
                      <td className={cls.td}>{formatINR(inv.outstandingAmount)}</td>
                      <td className={cls.td}>{inv.isRecurring ? "Yes" : "No"}</td>
                      <td className={cls.td}>
                        {inv.isRecurring && inv.recurringAllocationMode !== "maturity"
                          ? formatINR(inv.monthlyContribution)
                          : "-"}
                      </td>
                      <td className={`${cls.td} max-w-xs truncate text-slate-500`}>{allocText}</td>
                      <td className={cls.td}>
                        <div className="flex gap-2">
                          <button className={cls.btnGhost} onClick={() => onEditInvestment(inv.id)}>
                            Edit
                          </button>
                          <button className={cls.btnDanger} onClick={() => onDeleteInvestment(inv.id)}>
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
      </section>

      <TabNavFooter
        label="Review goal progress and funding status on your dashboard."
        buttonText="Go to dashboard"
        onNext={onGoToDashboard}
      />
    </div>
  );
}

function BankAccountModal({ open, mode, account, goalList, onClose, onSave }) {
  const isEdit = mode === "edit";
  const [bankName, setBankName] = useState(BANK_NAMES[0]);
  const [balance, setBalance] = useState("");
  const [allocations, setAllocations] = useState({});

  useEffect(() => {
    if (!open) return;
    if (isEdit && account) {
      setBankName(account.bankName || BANK_NAMES[0]);
      setBalance(account.balance ? String(account.balance) : "");
      setAllocations(normalizeAllocations(account.allocations || {}));
    } else {
      setBankName(BANK_NAMES[0]);
      setBalance("");
      setAllocations({});
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const unallocated = Math.max(
    0,
    safeNumber(balance) - computeHoldingAllocatedTotal({ amount: safeNumber(balance), allocations })
  );

  return (
    <Modal
      open={open}
      title={isEdit ? "Edit bank account" : "Add bank account"}
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
                if (safeNumber(balance) < 0) return alert("Balance cannot be negative.");
                const allocClean = normalizeAllocations(allocations);
                const sumPct = Object.values(allocClean).reduce((a, v) => a + safeNumber(v), 0);
                if (sumPct > 100.001) return alert("Total allocation must be 100% or less.");
                onSave({
                  mode: isEdit ? "edit" : "add",
                  id: account?.id,
                  bankName,
                  balance: safeNumber(balance),
                  allocations: allocClean,
                });
              }}
            >
              {isEdit ? "Save" : "Add account"}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={cls.label}>Bank</label>
          <BankSelect value={bankName} onChange={setBankName} />
        </div>
        <div className="sm:col-span-2">
          <label className={cls.label}>Current balance (INR)</label>
          <input
            type="number"
            min="0"
            className={cls.input}
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="250000"
          />
        </div>
      </div>
      <AllocationEditor goals={goalList || []} amount={balance} allocations={allocations} setAllocations={setAllocations} />
    </Modal>
  );
}

function InvestmentModal({ open, mode, investment, goalList, onClose, onSave }) {
  const isEdit = mode === "edit";
  const [type, setType] = useState(InvestmentType.MF);
  const [name, setName] = useState("");
  const [bankName, setBankName] = useState(BANK_NAMES[0]);
  const [outstandingAmount, setOutstandingAmount] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringAllocationMode, setRecurringAllocationMode] = useState("monthly");
  const [monthlyContribution, setMonthlyContribution] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [maturityAmount, setMaturityAmount] = useState("");
  const [maturityDate, setMaturityDate] = useState("");
  const [allocations, setAllocations] = useState({});

  const isBankType = type === InvestmentType.FD || type === InvestmentType.RD;
  const isRecurringMode = isRecurring && recurringAllocationMode !== "maturity";
  const isMaturityMode = isRecurring && recurringAllocationMode === "maturity";

  useEffect(() => {
    if (!open) return;
    if (isEdit && investment) {
      setType(investment.type || InvestmentType.MF);
      setName(investment.name || "");
      setBankName(investment.bankName || BANK_NAMES[0]);
      setOutstandingAmount(String(investment.outstandingAmount ?? ""));
      setIsRecurring(Boolean(investment.isRecurring));
      setRecurringAllocationMode(investment.recurringAllocationMode === "maturity" ? "maturity" : "monthly");
      setMonthlyContribution(
        investment.monthlyContribution ? String(investment.monthlyContribution) : ""
      );
      setFrequency(investment.frequency || "monthly");
      setMaturityAmount(investment.maturityAmount ? String(investment.maturityAmount) : "");
      setMaturityDate(investment.maturityDate || "");
      setAllocations(normalizeAllocations(investment.allocations || {}));
    } else {
      setType(InvestmentType.MF);
      setName("");
      setBankName(BANK_NAMES[0]);
      setOutstandingAmount("");
      setIsRecurring(false);
      setRecurringAllocationMode("monthly");
      setMonthlyContribution("");
      setFrequency("monthly");
      setMaturityAmount("");
      setMaturityDate("");
      setAllocations({});
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const allocationBaseAmount = useMemo(() => {
    if (isRecurring) {
      if (recurringAllocationMode === "maturity") return safeNumber(maturityAmount);
      return safeNumber(monthlyContribution);
    }
    return safeNumber(outstandingAmount);
  }, [isRecurring, recurringAllocationMode, maturityAmount, monthlyContribution, outstandingAmount]);

  const unallocated = Math.max(
    0,
    allocationBaseAmount - computeHoldingAllocatedTotal({ amount: allocationBaseAmount, allocations })
  );

  function buildDraft() {
    return {
      type,
      name: isBankType ? String(bankName || "").trim() : String(name || "").trim(),
      bankName: isBankType ? String(bankName || "").trim() : "",
      outstandingAmount: safeNumber(outstandingAmount),
      isRecurring,
      recurringAllocationMode: isRecurring ? recurringAllocationMode : "monthly",
      monthlyContribution: isRecurring && isRecurringMode ? safeNumber(monthlyContribution) : 0,
      frequency: isRecurring && isRecurringMode ? frequency : "",
      maturityAmount: isMaturityMode ? safeNumber(maturityAmount) : 0,
      maturityDate: isRecurring ? maturityDate : "",
      allocations: normalizeAllocations(allocations),
    };
  }

  return (
    <Modal
      open={open}
      title={isEdit ? "Edit investment" : "Add investment"}
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
                if (isBankType && !String(bankName || "").trim()) return alert("Please select a bank.");
                if (!isBankType && !String(name || "").trim()) return alert("Please enter a name or folio.");
                if (isRecurringMode && !frequency) return alert("Please select a frequency.");
                if (isRecurringMode && safeNumber(monthlyContribution) <= 0) {
                  return alert("Please enter the recurring contribution amount.");
                }
                if (isMaturityMode) {
                  if (safeNumber(maturityAmount) <= 0) return alert("Please enter the maturity amount.");
                  if (!parseISODate(maturityDate)) return alert("Please enter the maturity date.");
                }
                const amt = safeNumber(outstandingAmount);
                if (!isRecurring && amt <= 0) return alert("Outstanding amount must be greater than 0.");
                const draft = buildDraft();
                const maturityError = validateMaturityGoalAllocations(draft, goalList || []);
                if (maturityError) return alert(maturityError);
                const allocClean = normalizeAllocations(allocations);
                const sumPct = Object.values(allocClean).reduce((a, v) => a + safeNumber(v), 0);
                if (sumPct > 100.001) return alert("Total allocation must be 100% or less.");
                onSave({
                  mode: isEdit ? "edit" : "add",
                  id: investment?.id,
                  ...draft,
                  allocations: allocClean,
                });
              }}
            >
              {isEdit ? "Save" : "Add investment"}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className={isBankType ? "sm:col-span-2" : ""}>
          <label className={cls.label}>Type</label>
          <select className={cls.select} value={type} onChange={(e) => setType(e.target.value)}>
            {Object.values(InvestmentType).map((t) => (
              <option key={t} value={t}>
                {investmentTypeLabels[t]}
              </option>
            ))}
          </select>
        </div>
        {isBankType ? (
          <div className="sm:col-span-2">
            <label className={cls.label}>Bank</label>
            <BankSelect value={bankName} onChange={setBankName} />
          </div>
        ) : (
          <div className="sm:col-span-2">
            <label className={cls.label}>Name / folio</label>
            <input
              className={cls.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="SBI Bluechip / LIC policy"
            />
          </div>
        )}
        <div className="sm:col-span-2">
          <label className={cls.label}>Outstanding amount (INR)</label>
          <input
            type="number"
            min="0"
            className={cls.input}
            value={outstandingAmount}
            onChange={(e) => setOutstandingAmount(e.target.value)}
            placeholder="500000"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-white/20 bg-[#1a1a1a]"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
            />
            Recurring investment (SIP, RD, etc.)
          </label>
        </div>
        {isRecurring ? (
          <>
            <div className="sm:col-span-2">
              <label className={cls.label}>Allocate to goals using</label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={isRecurringMode ? cls.navTab(true) : cls.navTab(false)}
                  onClick={() => setRecurringAllocationMode("monthly")}
                >
                  Recurring contribution
                </button>
                <button
                  type="button"
                  className={isMaturityMode ? cls.navTab(true) : cls.navTab(false)}
                  onClick={() => setRecurringAllocationMode("maturity")}
                >
                  Maturity amount
                </button>
              </div>
            </div>
            {isRecurringMode ? (
              <>
                <div className="sm:col-span-2">
                  <label className={cls.label}>Recurring contribution (INR)</label>
                  <input
                    type="number"
                    min="0"
                    className={cls.input}
                    value={monthlyContribution}
                    onChange={(e) => setMonthlyContribution(e.target.value)}
                    placeholder="5000"
                  />
                </div>
                <div>
                  <label className={cls.label}>Frequency</label>
                  <select className={cls.select} value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div>
                  <label className={cls.label}>End date of investment</label>
                  <input type="date" className={cls.input} value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} />
                </div>
              </>
            ) : null}
            {isMaturityMode ? (
              <>
                <div>
                  <label className={cls.label}>Maturity amount (INR)</label>
                  <input
                    type="number"
                    min="0"
                    className={cls.input}
                    value={maturityAmount}
                    onChange={(e) => setMaturityAmount(e.target.value)}
                    placeholder="1000000"
                  />
                </div>
                <div>
                  <label className={cls.label}>Maturity date</label>
                  <input type="date" className={cls.input} value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} />
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>
      <AllocationEditor
        goals={goalList || []}
        amount={allocationBaseAmount}
        allocations={allocations}
        setAllocations={(updater) => {
          setAllocations((prev) => {
            const next = typeof updater === "function" ? updater(prev) : updater;
            if (isRecurring && recurringAllocationMode === "maturity") {
              const draft = {
                ...buildDraft(),
                allocations: normalizeAllocations(next),
              };
              const maturityError = validateMaturityGoalAllocations(draft, goalList || []);
              if (maturityError) {
                alert(maturityError);
                return prev;
              }
            }
            return next;
          });
        }}
        allocationHint={
          isRecurring
            ? recurringAllocationMode === "maturity"
              ? "% of maturity amount"
              : "% of recurring contribution"
            : "% of outstanding amount"
        }
      />
    </Modal>
  );
}

function App() {
  const [state, setState] = useState(buildDefaultState());
  const [view, setView] = useState("landing");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [activeTab, setActiveTab] = useState("goals");
  const [includeDebt, setIncludeDebt] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState(null);

  const [goalEditorId, setGoalEditorId] = useState("new");
  const [bankEditor, setBankEditor] = useState(null);
  const [investmentEditor, setInvestmentEditor] = useState(null);

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

  const fundSources = useMemo(() => getFundSources(state), [state.bankAccounts, state.investments, state]);

  const totalAllocatedCorpus = useMemo(() => {
    let sum = 0;
    const goalIds = new Set(goals.map((g) => g.id));
    for (const src of fundSources) {
      for (const gid of Object.keys(src.allocations || {})) {
        if (!goalIds.has(gid)) continue;
        sum += computeHoldingAllocatedAmount(src, gid);
      }
    }
    return sum;
  }, [fundSources, goals]);

  const allocationsByGoal = useMemo(() => {
    const byGoal = {};
    for (const g of goals) {
      byGoal[g.id] = { allocatedAmount: 0, weightedVolatility: 0, allocatedWeightTotal: 0 };
    }
    for (const src of fundSources) {
      for (const gid of Object.keys(src.allocations || {})) {
        if (!byGoal[gid]) continue;
        const allocated = computeHoldingAllocatedAmount(src, gid);
        byGoal[gid].allocatedAmount += allocated;
        byGoal[gid].weightedVolatility += src.volatility * allocated;
        byGoal[gid].allocatedWeightTotal += allocated;
      }
    }
    for (const gid of Object.keys(byGoal)) {
      const a = byGoal[gid];
      a.weightedVolatility = a.allocatedWeightTotal > 0 ? a.weightedVolatility / a.allocatedWeightTotal : 0;
    }
    return byGoal;
  }, [fundSources, goals]);

  const dashboardMetrics = useMemo(
    () => ({
      netWorth: computeNetWorthWithDebt(state, includeDebt),
      goalFundingRatio: computeGoalFundingRatio(goals, allocationsByGoal),
      investableSurplus: computeInvestableSurplus(state),
      totalRequiredMonthly: computeTotalRequiredMonthlyInvestment(goals, state),
    }),
    [state, goals, allocationsByGoal, includeDebt]
  );

  const emergencyFundTargetAmount = useMemo(
    () => emergencyFundTarget(state.monthlyExpenses, computeTotalEmi(state)),
    [state.monthlyExpenses, state.commitments]
  );

  const outlookChartData = useMemo(
    () => computeOutlookChartData(state, goals),
    [state, goals]
  );

  const outlookInsights = useMemo(() => computeOutlookInsights(outlookChartData, goals), [outlookChartData, goals]);

  const dashboardSummaries = useMemo(() => {
    const today = todayLocalISODate();
    const byGoal = {};

    for (const g of goals) {
      const allocated = allocationsByGoal[g.id]?.allocatedAmount ?? 0;
      const monthlyRequired = computeRequiredMonthlyInvestment(g, state);
      const status = getGoalStatusFromProjection(g, state);
      const warnings = [];

      if (allocated <= 0.0001 && g.targetAmount > 0) {
        warnings.push({ kind: "danger", label: "No allocation yet" });
      }

      const horizonMonths = Math.max(0, diffMonths(today, g.targetDate));
      if (allocated > 0 && horizonMonths > 0) {
        const weightedVol = allocationsByGoal[g.id]?.weightedVolatility ?? 0;
        let allowedMax = 0.75;
        if (horizonMonths <= 12) allowedMax = 0.35;
        else if (horizonMonths <= 36) allowedMax = 0.6;
        if (weightedVol > allowedMax + 0.02) {
          warnings.push({ kind: "danger", label: "Too volatile" });
        }
      }

      const attentionReason = getGoalAttentionReason(g, state, { status, monthlyRequired });

      const allocatedPctOfTotal = totalAllocatedCorpus > 0 ? (allocated / totalAllocatedCorpus) * 100 : 0;

      byGoal[g.id] = {
        allocatedAmount: allocated,
        allocatedPct: allocatedPctOfTotal,
        monthlyRequired,
        projectedAmount: computeGoalProjectedAllocation(g, state),
        status,
        attentionReason,
        warnings,
      };
    }

    return byGoal;
  }, [goals, allocationsByGoal, totalAllocatedCorpus, state]);

  function finalizeState(next) {
    const emi = computeTotalEmi(next);
    const withEmergency = {
      ...next,
      goals: applyEmergencyFundTarget(next.goals, next.monthlyExpenses, emi),
    };
    return { ...withEmergency, updatedAt: Date.now() };
  }

  function setStateAndBump(updater) {
    setState((prev) => finalizeState(updater(prev)));
  }

  function normalizeAllocationsForGoals(alloc, goalIdSet) {
    const normalized = {};
    for (const gid of Object.keys(normalizeAllocations(alloc))) {
      if (!goalIdSet.has(gid)) continue;
      normalized[gid] = normalizeAllocations(alloc)[gid];
    }
    const totalPct = Object.values(normalized).reduce((a, v) => a + safeNumber(v), 0);
    if (totalPct <= 100.0001) return normalized;
    const scale = 100 / totalPct;
    const scaled = {};
    for (const gid of Object.keys(normalized)) scaled[gid] = normalized[gid] * scale;
    return scaled;
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
        setView("app");
        setActiveTab("dashboard");
        setGoalEditorId("new");
        setBankEditor(null);
        setInvestmentEditor(null);
      } catch (_) {
        alert("Import failed: invalid JSON file.");
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    const next = buildDefaultState();
    setState(next);
    setView("landing");
    setOnboardingStep(0);
    setActiveTab("goals");
    setGoalEditorId("new");
    setBankEditor(null);
    setInvestmentEditor(null);
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
        return { ...prev, goals: sortGoals([...prev.goals, newGoal]) };
      });
      return;
    }

    setStateAndBump((prev) => {
      const nextGoals = prev.goals.map((g) => {
        if (g.id !== goalEditorId) return g;
        if (g.isEmergencyFund) {
          return { ...g, name: String(goalDraft.name || "").trim(), targetDate: String(goalDraft.targetDate || "") };
        }
        return {
          ...g,
          name: String(goalDraft.name || "").trim(),
          targetAmount: safeNumber(goalDraft.targetAmount),
          targetDate: String(goalDraft.targetDate || ""),
        };
      });
      return { ...prev, goals: sortGoals(nextGoals) };
    });
  }

  function deleteGoal(goalId) {
    setStateAndBump((prev) => {
      const nextGoals = prev.goals.filter((g) => g.id !== goalId);
      const hasEmergency = nextGoals.some((g) => g.isEmergencyFund);
      if (!hasEmergency) return prev;
      const strip = (alloc) => {
        const next = { ...(alloc || {}) };
        delete next[goalId];
        return next;
      };
      return {
        ...prev,
        goals: sortGoals(nextGoals),
        bankAccounts: prev.bankAccounts.map((b) => ({ ...b, allocations: strip(b.allocations) })),
        investments: prev.investments.map((inv) => ({ ...inv, allocations: strip(inv.allocations) })),
      };
    });
    setConfirmDeleteGoalOpen(false);
    setGoalToDeleteId(null);
    setGoalEditorId("new");
  }

  function upsertBankAccount(draft) {
    setStateAndBump((prev) => {
      const goalIdSet = new Set(prev.goals.map((g) => g.id));
      const allocations = normalizeAllocationsForGoals(draft.allocations, goalIdSet);
      if (draft.mode === "add") {
        return {
          ...prev,
          bankAccounts: [
            ...prev.bankAccounts,
            { id: generateId(), bankName: String(draft.bankName), balance: safeNumber(draft.balance), allocations },
          ],
        };
      }
      return {
        ...prev,
        bankAccounts: prev.bankAccounts.map((b) =>
          b.id !== draft.id
            ? b
            : { ...b, bankName: String(draft.bankName), balance: safeNumber(draft.balance), allocations }
        ),
      };
    });
    setBankEditor(null);
  }

  function deleteBankAccount(id) {
    setStateAndBump((prev) => ({ ...prev, bankAccounts: prev.bankAccounts.filter((b) => b.id !== id) }));
    setBankEditor(null);
  }

  function upsertInvestment(draft) {
    setStateAndBump((prev) => {
      const goalIdSet = new Set(prev.goals.map((g) => g.id));
      const allocations = normalizeAllocationsForGoals(draft.allocations, goalIdSet);
      const payload = {
        type: draft.type,
        name: String(draft.name || "").trim(),
        bankName: String(draft.bankName || ""),
        outstandingAmount: safeNumber(draft.outstandingAmount),
        isRecurring: Boolean(draft.isRecurring),
        recurringAllocationMode: draft.isRecurring
          ? draft.recurringAllocationMode === "maturity"
            ? "maturity"
            : "monthly"
          : "monthly",
        monthlyContribution:
          draft.isRecurring && draft.recurringAllocationMode !== "maturity"
            ? safeNumber(draft.monthlyContribution)
            : 0,
        frequency:
          draft.isRecurring && draft.recurringAllocationMode !== "maturity"
            ? String(draft.frequency || "monthly")
            : "",
        maturityAmount:
          draft.isRecurring && draft.recurringAllocationMode === "maturity"
            ? safeNumber(draft.maturityAmount)
            : 0,
        maturityDate: draft.isRecurring ? String(draft.maturityDate || "") : "",
        allocations,
      };
      if (draft.mode === "add") {
        return { ...prev, investments: [...prev.investments, { id: generateId(), ...payload }] };
      }
      return {
        ...prev,
        investments: prev.investments.map((inv) => (inv.id !== draft.id ? inv : { ...inv, ...payload })),
      };
    });
    setInvestmentEditor(null);
  }

  function deleteInvestment(id) {
    setStateAndBump((prev) => ({ ...prev, investments: prev.investments.filter((inv) => inv.id !== id) }));
    setInvestmentEditor(null);
  }

  const orderedGoals = useMemo(() => sortGoals(goals), [goals]);
  const portfolioEmpty = useMemo(() => isPortfolioEmpty(state), [state]);

  return (
    <div className="min-h-screen">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.12),transparent_55%),radial-gradient(circle_at_bottom,_rgba(0,0,0,0.95),#050505)]" />

      {view === "landing" ? (
        <LandingScreen
          isEmpty={portfolioEmpty}
          onEnterApp={() => {
            setView("app");
            setActiveTab("goals");
          }}
          onStartTour={() => {
            setView("onboarding");
            setOnboardingStep(0);
          }}
        />
      ) : view === "onboarding" ? (
        <OnboardingScreen
          step={onboardingStep}
          setStep={setOnboardingStep}
          onFinish={() => {
            setView("app");
            setActiveTab("goals");
            setOnboardingStep(0);
          }}
        />
      ) : (
        <>
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
            onLogoClick={() => setView("landing")}
            onImportFile={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              importDataFromFile(file);
              e.target.value = "";
            }}
          />

          {activeTab === "dashboard" ? (
            <DashboardScreen
              goals={orderedGoals}
              summaries={dashboardSummaries}
              metrics={dashboardMetrics}
              includeDebt={includeDebt}
              setIncludeDebt={setIncludeDebt}
              state={state}
              onOpenGoal={(goalId) => setSelectedGoalId(goalId)}
              onGoToOutlook={() => setActiveTab("outlook")}
            />
          ) : null}

          {activeTab === "goals" ? (
            <GoalsScreen
              goals={orderedGoals}
              goalSummaries={dashboardSummaries}
              goalEditorId={goalEditorId}
              setGoalEditorId={setGoalEditorId}
              emergencyGoalId={orderedGoals.find((g) => g.isEmergencyFund)?.id}
              emergencyFundTargetAmount={emergencyFundTargetAmount}
              state={state}
              onSaveGoal={(draft) => upsertGoal(draft)}
              onDeleteGoal={(goalId) => {
                setGoalToDeleteId(goalId);
                setConfirmDeleteGoalOpen(true);
              }}
              onGoToFinancialData={() => setActiveTab("portfolio")}
            />
          ) : null}

          {activeTab === "portfolio" ? (
            <FinancialDataScreen
              goals={orderedGoals}
              monthlyIncome={state.monthlyIncome}
              monthlyExpenses={state.monthlyExpenses}
              commitments={state.commitments}
              bankAccounts={state.bankAccounts}
              investments={state.investments}
              onUpdateIncome={(v) => setStateAndBump((prev) => ({ ...prev, monthlyIncome: safeNumber(v) }))}
              onUpdateExpenses={(v) => setStateAndBump((prev) => ({ ...prev, monthlyExpenses: safeNumber(v) }))}
              onAddCommitment={() =>
                setStateAndBump((prev) => ({
                  ...prev,
                  commitments: [
                    ...prev.commitments,
                    { id: generateId(), description: "", bankName: BANK_NAMES[0], outstandingAmount: 0, monthlyEmi: 0 },
                  ],
                }))
              }
              onUpdateCommitment={(id, patch) =>
                setStateAndBump((prev) => ({
                  ...prev,
                  commitments: prev.commitments.map((c) => (c.id !== id ? c : { ...c, ...patch })),
                }))
              }
              onDeleteCommitment={(id) =>
                setStateAndBump((prev) => ({ ...prev, commitments: prev.commitments.filter((c) => c.id !== id) }))
              }
              onAddBankAccount={() => setBankEditor({ mode: "add" })}
              onEditBankAccount={(id) => setBankEditor({ mode: "edit", id })}
              onDeleteBankAccount={(id) => {
                if (confirm("Delete this bank account?")) deleteBankAccount(id);
              }}
              onAddInvestment={() => setInvestmentEditor({ mode: "add" })}
              onEditInvestment={(id) => setInvestmentEditor({ mode: "edit", id })}
              onDeleteInvestment={(id) => {
                if (confirm("Delete this investment?")) deleteInvestment(id);
              }}
              onGoToDashboard={() => setActiveTab("dashboard")}
            />
          ) : null}

          {activeTab === "outlook" ? (
            <OutlookScreen
              state={state}
              goals={orderedGoals}
              chartData={outlookChartData}
              insights={outlookInsights}
            />
          ) : null}

          <GoalDetailModal
            open={Boolean(selectedGoalId)}
            goal={orderedGoals.find((g) => g.id === selectedGoalId)}
            summary={selectedGoalId ? dashboardSummaries[selectedGoalId] : null}
            index={Math.max(0, orderedGoals.findIndex((g) => g.id === selectedGoalId))}
            state={state}
            onClose={() => setSelectedGoalId(null)}
          />
        </>
      )}

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

      <BankAccountModal
        open={Boolean(bankEditor)}
        mode={bankEditor?.mode}
        account={state.bankAccounts.find((b) => b.id === bankEditor?.id)}
        goalList={orderedGoals}
        onClose={() => setBankEditor(null)}
        onSave={(draft) => upsertBankAccount(draft)}
      />

      <InvestmentModal
        open={Boolean(investmentEditor)}
        mode={investmentEditor?.mode}
        investment={state.investments.find((inv) => inv.id === investmentEditor?.id)}
        goalList={orderedGoals}
        onClose={() => setInvestmentEditor(null)}
        onSave={(draft) => upsertInvestment(draft)}
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


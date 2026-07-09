const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "app.jsx");
let s = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");

const pairs = [
  ["\u00e2\u201a\u00b9", ""],
  ["\u00c2\u00b7", " | "],
  ["\u00e2\u20ac\u201d", "-"],
  ["\u00e2\u02c6\u2019", "-"],
  ["\u00e2\u2030\u00a4", "<="],
  ["\u00c3\u2014", "x"],
  ["\u00e2\u201d\u20ac", "-"],
];

for (const [from, to] of pairs) {
  while (s.includes(from)) s = s.split(from).join(to);
}

s = s.replace(/const GOAL_THEMES = \[[\s\S]*?\];/, `const GOAL_THEMES = [
  { icon: "EF", iconBg: "bg-amber-500/15", bar: "bg-amber-400" },
  { icon: "H", iconBg: "bg-emerald-500/15", bar: "bg-emerald-400" },
  { icon: "R", iconBg: "bg-sky-500/15", bar: "bg-sky-400" },
  { icon: "T", iconBg: "bg-orange-500/15", bar: "bg-orange-400" },
  { icon: "E", iconBg: "bg-violet-500/15", bar: "bg-violet-400" },
  { icon: "G", iconBg: "bg-teal-500/15", bar: "bg-teal-400" },
];`);

s = s.replace(/\/\/[^\n]*UI helpers[^\n]*/g, "// --- UI helpers ---");

s = s.replace(
  /function formatCompactINR\(n\) \{[\s\S]*?\n\}/,
  `function formatCompactINR(n) {
  const x = safeNumber(n);
  if (x >= 10000000) return "Rs. " + (x / 10000000).toFixed(1) + "Cr";
  if (x >= 100000) return "Rs. " + (x / 100000).toFixed(1) + "L";
  if (x >= 1000) return "Rs. " + (x / 1000).toFixed(1) + "K";
  return formatINR(x);
}`
);

s = s.replace(/return iso \|\| "[^"]*";/, 'return iso || "-";');

// Remove leftover emoji/icon mojibake in GOAL_THEMES if any remain
s = s.replace(/\{ icon: "[^"]{1,8}", iconBg:/g, (m) => {
  if (m.includes("EF") || m.includes('"H"') || m.includes('"R"')) return m;
  return m;
});

fs.writeFileSync(file, s, "utf8");
console.log("encoding fix done");

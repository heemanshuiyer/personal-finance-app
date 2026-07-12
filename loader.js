/* Loads app.jsx on hosts that won't execute .jsx directly (e.g., GitHub Pages). */
(async function () {
  try {
    const res = await fetch("./app.jsx", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load app.jsx");
    const source = await res.text();

    if (!window.Babel) throw new Error("Babel not loaded");
    // Classic runtime emits React.createElement (no ESM imports).
    // Automatic runtime would inject `import ... from "react/jsx-runtime"`,
    // which fails when run as a classic <script> on GitHub Pages.
    const transformed = window.Babel.transform(source, {
      presets: [["react", { runtime: "classic" }]],
    }).code;

    // Execute transformed code in page context
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.text = transformed;
    document.head.appendChild(script);
  } catch (err) {
    const el = document.createElement("div");
    el.style.cssText =
      "margin:2rem auto;max-width:40rem;padding:1rem 1.25rem;border-radius:1rem;border:1px solid #fda4af;background:#4c0519;color:#fecdd3;font:14px/1.5 system-ui,sans-serif;";
    el.innerHTML =
      "<div style='font-weight:600'>App failed to load</div>" +
      "<div style='margin-top:0.35rem;opacity:0.9'>Open DevTools → Console to see the error.</div>" +
      "<pre style='margin-top:0.75rem;white-space:pre-wrap;word-break:break-word;opacity:0.85'></pre>";
    el.querySelector("pre").textContent = String(err && err.message ? err.message : err);
    document.getElementById("root")?.appendChild(el);
    // eslint-disable-next-line no-console
    console.error(err);
  }
})();


/* Loads app.jsx on hosts that won't execute .jsx directly (e.g., GitHub Pages). */
(async function () {
  try {
    const res = await fetch("./app.jsx", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load app.jsx");
    const source = await res.text();

    if (!window.Babel) throw new Error("Babel not loaded");
    const transformed = window.Babel.transform(source, {
      presets: ["react"],
    }).code;

    // Execute transformed code in page context
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.text = transformed;
    document.head.appendChild(script);
  } catch (err) {
    const el = document.createElement("div");
    el.className =
      "mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900";
    el.innerHTML =
      "<div class='font-semibold'>App failed to load</div>" +
      "<div class='mt-1 text-rose-800'>Open DevTools → Console to see the error.</div>";
    document.getElementById("root")?.appendChild(el);
    // eslint-disable-next-line no-console
    console.error(err);
  }
})();


# Goals Portfolio Planner (Local-only)

This is a fully client-side React app (no backend). Your data is stored in `localStorage` inside the browser.

## Run it

### Option A: Open directly
Double-click `index.html` and open it in your browser.

### Option B: Serve locally (recommended)
In this folder, run a tiny local server:

```powershell
node -e "require('http').createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});const fs=require('fs');const p=req.url==='/'?'index.html':req.url;res.end(fs.readFileSync(p));}).listen(5173);console.log('http://localhost:5173')"
```

Then open: `http://localhost:5173`

## Hosting notes (GitHub Pages)

This project uses `loader.js` to load and compile `app.jsx` in the browser. This avoids the common GitHub Pages issue where `.jsx` files are served with a non-JS MIME type and the app area stays blank.

## Backup / Restore

- **Export** downloads a JSON file containing all goals + holdings + allocations.
- **Import** lets you load that JSON back.
- **Reset** clears everything stored in `localStorage` for this app.


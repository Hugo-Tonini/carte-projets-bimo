const map = L.map('map').setView([46.8, 2.5], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

const clusters = L.markerClusterGroup();

function colorByType(t){
  if(!t) return "blue";
  t = String(t).toLowerCase();
  if(t.includes("amo")) return "red";
  if(t.includes("mom")) return "blue";
  if(t.includes("exp")) return "green";
  return "orange";
}

// --- Panneau : ouvrir / fermer ---
function openPanel(html){
  const panel = document.getElementById("panel");
  panel.innerHTML = html;
  panel.classList.add("open");
}

function closePanel(){
  const panel = document.getElementById("panel");
  panel.classList.remove("open");
  panel.innerHTML = "";
}

// Fermer en cliquant sur la carte
map.on("click", () => closePanel());

// Charger les projets
fetch("export_projets_web.json")
  .then(r => r.json())
  .then(data => {

    (data.projets || []).forEach(p => {
      if(!p.latitude || !p.longitude) return;

      const icon = L.circleMarker(
        [parseFloat(p.latitude), parseFloat(p.longitude)],
        { radius: 8, color: colorByType(p.type || p["Type de projet"] || "") }
      );

      // Ouvrir panneau au clic pin
      icon.on("click", (e) => {
        // Empêche le clic sur la carte de fermer immédiatement
        if (e && e.originalEvent) e.originalEvent.stopPropagation();
        showPanel(p);
      });

      clusters.addLayer(icon);
    });

    map.addLayer(clusters);
  })
  .catch(err => {
    console.error("Erreur chargement JSON:", err);
  });

function showPanel(p){
  const title = p.nom || p["Nom de projet"] || "Projet";

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <h2 style="margin:0;">${escapeHtml(title)}</h2>
      <button id="panelClose" style="cursor:pointer;font-size:16px;line-height:16px;">✕</button>
    </div>
    <hr/>
  `;

  Object.keys(p).forEach(k => {
    const v = (p[k] ?? "");
    html += `<div><b>${escapeHtml(k)}</b> : ${escapeHtml(String(v))}</div>`;
  });

  openPanel(html);

  const btn = document.getElementById("panelClose");
  if (btn) btn.onclick = closePanel;
}

// Petite sécurité pour éviter d'injecter du HTML si un champ contient < >
function escapeHtml(s){
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Au chargement, s'assurer que le panneau est fermé
closePanel();

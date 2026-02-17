const map = L.map('map').setView([46.8, 2.5], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

const clusters = L.markerClusterGroup();
let allProjects = [];

/* --- Couleur pins selon type --- */
function colorByType(t){
  if(!t) return "blue";
  t = String(t).toLowerCase();
  if(t.includes("amo")) return "red";
  if(t.includes("mom")) return "blue";
  if(t.includes("exp")) return "green";
  return "orange";
}

/* --- Panneau --- */
function openPanel(html){
  const panel = document.getElementById("panel");
  if(!panel) return;
  panel.innerHTML = html;
  panel.classList.add("open");
}

function closePanel(){
  const panel = document.getElementById("panel");
  if(!panel) return;
  panel.classList.remove("open");
  panel.innerHTML = "";
}

/* Fermer quand on clique sur la carte (hors pin) */
map.on("click", closePanel);

/* --- Utils --- */
function escapeHtml(s){
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getActiveTypes(){
  return Array.from(document.querySelectorAll(".typeFilter:checked"))
    .map(x => x.value.toLowerCase());
}

function matchesFilters(p){
  const qEl = document.getElementById("q");
  const q = (qEl ? qEl.value : "").toLowerCase().trim();
  const types = getActiveTypes();

  const type = String(p.type || p["Type de projet"] || "").toLowerCase();

  // filtre type
  if(types.length){
    if(!types.some(t => type.includes(t))) return false;
  }

  // recherche full-text simple
  if(q){
    const blob = Object.values(p).join(" ").toLowerCase();
    if(!blob.includes(q)) return false;
  }

  return true;
}

/* --- Rendu pins selon filtres --- */
function renderProjects(){
  clusters.clearLayers();

  allProjects.forEach(p => {
    if(!matchesFilters(p)) return;

    const lat = parseFloat(p.latitude);
    const lon = parseFloat(p.longitude);
    if(Number.isNaN(lat) || Number.isNaN(lon)) return;

    const col = colorByType(p.type || p["Type de projet"] || "");

    const marker = L.marker([lat, lon], {
      icon: L.divIcon({
        className: "pin-dot",
        html: '<div class="pin-dot-inner" style="border-color:' + col + '"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      })
    });

    marker.on("click", function(e){
      // empêche la fermeture immédiate via click sur la carte
      L.DomEvent.stopPropagation(e);
      showPanel(p);
    });

    clusters.addLayer(marker);
  });

  if(!map.hasLayer(clusters)) map.addLayer(clusters);
}

/* --- Fiche projet (sans lat/lon) --- */
function showPanel(p){
  const title = p.nom || p["Nom de projet"] || "Projet";

  const fields = [
    ["Département", p["Département"] || p.departement],
    ["Antenne", p["Antenne"] || p.antenne],
    ["Ville", p["Ville"] || p.ville],
    ["Type de projet", p["Type de projet"] || p.type],
    ["Montant", p["Montant"] || p.montant],
    ["Client", p["Client"] || p.client],
    ["Thématique", p["Thématique"] || p.thematique],
    ["Résumé", p["Résumé"] || p.resume],
    ["Adresse", p["Adresse"] || p.adresse],
    ["Programme", p["Programme"] || p.programme],
    ["Code projet", p["Code projet"] || p["Code projet "] || p.code || p["Code_Projet"]]
  ];

  let html = '';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">';
  html +=   '<h2 style="margin:0;">' + escapeHtml(title) + '</h2>';
  html +=   '<button id="panelClose" type="button" style="cursor:pointer;font-size:16px;line-height:16px;">✕</button>';
  html += '</div><hr/>';

  fields.forEach(([label, value]) => {
    if(value === undefined || value === null) return;
    const s = String(value).trim();
    if(!s) return;
    html += '<div><b>' + escapeHtml(label) + '</b> : ' + escapeHtml(s) + '</div>';
  });

  openPanel(html);

  const btn = document.getElementById("panelClose");
  if(btn) btn.onclick = closePanel;
}

/* --- Chargement données --- */
fetch("export_projets_web.json")
  .then(function(r){
    if(!r.ok) throw new Error("HTTP " + r.status + " sur export_projets_web.json");
    return r.json();
  })
  .then(function(data){
    allProjects = (data.projets || []);
    renderProjects();
  })
  .catch(function(err){
    console.error("Erreur chargement JSON:", err);
  });

/* --- UI toolbar --- */
const q = document.getElementById("q");
if(q) q.addEventListener("input", renderProjects);

document.querySelectorAll(".typeFilter").forEach(cb => {
  cb.addEventListener("change", renderProjects);
});

const clearBtn = document.getElementById("clear");
if(clearBtn){
  clearBtn.addEventListener("click", () => {
    if(q) q.value = "";
    document.querySelectorAll(".typeFilter").forEach(cb => cb.checked = true);
    closePanel();
    renderProjects();
  });
}

/* panneau fermé au chargement */
closePanel();

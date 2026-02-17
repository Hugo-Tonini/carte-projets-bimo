const map = L.map('map').setView([46.8, 2.5], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

const clusters = L.markerClusterGroup();
let allProjects = [];

/* --- Départements (GeoJSON) --- */
let deptLayer = null;
let selectedDeptCode = null; // optionnel : filtre par clic dept (voir plus bas)

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

  // optionnel : filtre sur département sélectionné
  if(selectedDeptCode){
    const dep = normalizeDeptCode(getDeptCodeFromProject(p));
    if(dep !== selectedDeptCode) return false;
  }

  return true;
}

/* --- Département depuis projet --- */
function getDeptCodeFromProject(p){
  // adapte si besoin : c'est ici que tu relies tes projets à un code département
  return String(p["Département"] || p.departement || "").trim();
}

function normalizeDeptCode(code){
  // Harmonise "1" -> "01", garde "2A/2B" etc.
  const c = String(code || "").trim().toUpperCase();
  if(!c) return "";
  if(c === "2A" || c === "2B") return c;
  // si numérique sur 1 ou 2 chiffres -> pad à 2
  if(/^\d{1,2}$/.test(c)) return c.padStart(2, "0");
  // si déjà 3 chiffres (DOM) : 971, 972...
  if(/^\d{3}$/.test(c)) return c;
  return c;
}

/* --- Comptage projets par département (après filtres) --- */
function buildDeptCounts(){
  const counts = {};
  allProjects.forEach(p => {
    if(!matchesFilters(p)) return;
    const dep = normalizeDeptCode(getDeptCodeFromProject(p));
    if(!dep) return;
    counts[dep] = (counts[dep] || 0) + 1;
  });
  return counts;
}

function colorByCount(n){
  if(!n) return "#ffffff";
  if(n <= 2) return "#e8f0fe";
  if(n <= 5) return "#c6dafc";
  if(n <= 10) return "#8ab4f8";
  return "#1a73e8";
}

function styleDept(feature){
  const props = feature.properties || {};
  const codeRaw = props.code || props.CODE || props.dep || props.DEP || props.insee || props.INSEE;
  const code = normalizeDeptCode(codeRaw);

  const counts = buildDeptCounts();
  const n = counts[code] || 0;

  return {
    weight: (selectedDeptCode && code === selectedDeptCode) ? 2 : 1,
    color: (selectedDeptCode && code === selectedDeptCode) ? "#111" : "#666",
    fillColor: colorByCount(n),
    fillOpacity: 0.55
  };
}

function highlightDept(e){
  const layer = e.target;
  layer.setStyle({ weight: 2, color: "#111", fillOpacity: 0.75 });
  if(!L.Browser.ie && !L.Browser.opera && !L.Browser.edge){
    layer.bringToFront();
  }
}

function resetHighlight(e){
  if(!deptLayer) return;
  deptLayer.resetStyle(e.target);
}

function onEachDept(feature, layer){
  const props = feature.properties || {};
  const name = props.nom || props.NOM || props.name || props.NAME || "";
  const code = normalizeDeptCode(props.code || props.CODE || props.dep || props.DEP || "");

  layer.on({
    mouseover: highlightDept,
    mouseout: resetHighlight,
    click: () => {
      // zoom sur le département
      map.fitBounds(layer.getBounds());

      // Optionnel : activer filtre par département au clic (toggle)
      // Décommente les 3 lignes ci-dessous si tu veux que cliquer un département filtre les pins.
      // selectedDeptCode = (selectedDeptCode === code) ? null : code;
      // closePanel();
      // renderProjects();

      // tooltip
      if(name && code){
        layer.bindTooltip(name + " (" + code + ")", { sticky: true }).openTooltip();
      }
    }
  });
}

function loadDepartements(){
  fetch("departements.geojson")
    .then(r => {
      if(!r.ok) throw new Error("HTTP " + r.status + " sur departements.geojson");
      return r.json();
    })
    .then(geo => {
      deptLayer = L.geoJSON(geo, {
        style: styleDept,
        onEachFeature: onEachDept
      }).addTo(map);

      // Départements derrière les pins
      deptLayer.bringToBack();
    })
    .catch(err => console.error("Erreur chargement GeoJSON départements:", err));
}

function updateDeptStyle(){
  if(!deptLayer) return;
  deptLayer.setStyle(styleDept);
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

  // MAJ couleurs départements selon filtres
  updateDeptStyle();
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
    selectedDeptCode = null; // reset filtre dept optionnel
    closePanel();
    renderProjects();
  });
}

/* Charger la couche départements */
loadDepartements();

/* panneau fermé au chargement */
closePanel();

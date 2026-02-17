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

// fermer quand on clique sur la carte
map.on("click", closePanel);

function escapeHtml(s){
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showPanel(p){
  const title = p.nom || p["Nom de projet"] || "Projet";

  let html = '';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">';
  html +=   '<h2 style="margin:0;">' + escapeHtml(title) + '</h2>';
  html +=   '<button id="panelClose" style="cursor:pointer;font-size:16px;line-height:16px;">✕</button>';
  html += '</div>';
  html += '<hr/>';

  Object.keys(p).forEach(function(k){
    const v = (p[k] ?? "");
    html += '<div><b>' + escapeHtml(k) + '</b> : ' + escapeHtml(String(v)) + '</div>';
  });

  openPanel(html);

  const btn = document.getElementById("panelClose");
  if(btn) btn.onclick = closePanel;
}

fetch("export_projets_web.json")
  .then(function(r){
    if(!r.ok) throw new Error("HTTP " + r.status + " sur export_projets_web.json");
    return r.json();
  })
  .then(function(data){
    (data.projets || []).forEach(function(p){
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
        L.DomEvent.stopPropagation(e); // évite fermeture immédiate
        showPanel(p);
      });

      clusters.addLayer(marker);
    });

    map.addLayer(clusters);
  })
  .catch(function(err){
    console.error("Erreur chargement JSON:", err);
  });

// panneau fermé au chargement
closePanel();

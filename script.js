const map = L.map('map').setView([46.8, 2.5], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

const clusters = L.markerClusterGroup();

function colorByType(t){
  if(!t) return "blue";
  t = t.toLowerCase();
  if(t.includes("amo")) return "red";
  if(t.includes("mom")) return "blue";
  if(t.includes("exp")) return "green";
  return "orange";
}

fetch("export_projets_web.json")
.then(r => r.json())
.then(data => {

  data.projets.forEach(p => {
    if(!p.latitude || !p.longitude) return;

    const icon = L.circleMarker(
      [parseFloat(p.latitude), parseFloat(p.longitude)],
      { radius:8, color: colorByType(p.type || "") }
    );

    icon.on("click", () => showPanel(p));
    clusters.addLayer(icon);
  });

  map.addLayer(clusters);
});

function showPanel(p){
  const panel = document.getElementById("panel");
  let html = "<h2>" + (p.nom || "Projet") + "</h2>";
  Object.keys(p).forEach(k => {
    html += "<b>" + k + "</b> : " + p[k] + "<br>";
  });
  panel.innerHTML = html;
}

// Carte Projets — Leaflet + clustering + départements colorés par antenne
(() => {
  "use strict";

  // Affiche les erreurs JS dans la bannière (pratique sur GitHub Pages)
  window.addEventListener("error", (e) => {
    const el = document.getElementById("status");
    if (!el) return;
    el.textContent = `Erreur JS: ${e.message}`;
    el.hidden = false;
  });

  // ---- Configuration ----
  const DATA_VERSION = "2026-02-17b";
  const PROJECTS_URL = `export_projets_web.json?v=${encodeURIComponent(DATA_VERSION)}`;
  const DEPTS_URL = `departements.geojson?v=${encodeURIComponent(DATA_VERSION)}`;

  // ---- DOM ----
  const elQ = document.getElementById("q");
  const elClear = document.getElementById("clear");
  const elPanel = document.getElementById("panel");
  const elStatus = document.getElementById("status");
  const elLegend = document.getElementById("legend");
  const elCount = document.getElementById("statCount");
  const elStatDept = document.getElementById("statDept");
  const elDeptClickFilter = document.getElementById("deptClickFilter");
  const elProjListBtn = document.getElementById("projListBtn");
  const elProjListMenu = document.getElementById("projListMenu");
  const elProjListSearch = document.getElementById("projListSearch");
  const elProjListSort = document.getElementById("projListSort");
  const elProjListItems = document.getElementById("projListItems");


  // ---- State ----
  let allProjects = [];
  let deptLayer = null;
  let deptNameToCode = new Map(); // "haute savoie" -> "74"
  let deptCodeToAntenna = {}; // "74" -> "Alpes Centre-Est"
  let selectedDeptCode = null;
  let filteredCounts = {}; // "74" -> nb projets filtrés (tooltip)
  let filterByDeptEnabled = false;

  // Focus antenne (pour foncer les départements de l’antenne sélectionnée)
  let selectedAntenna = null;

  // Pin sélectionné (pour surligner/agrandir)
  let selectedMarker = null;
  let projectIdToMarker = new Map(); // "Code projet" -> Leaflet marker
  let projectIdToName = new Map();  // "Code projet" -> Nom du projet (tooltips clusters)
  function clearSelectedMarker() {
    if (selectedMarker) selectedMarker.getElement()?.classList.remove("selected");
    selectedMarker = null;
  }
  function setSelectedMarker(marker) {
    clearSelectedMarker();
    selectedMarker = marker;
    marker.getElement()?.classList.add("selected");
  }

  function clearAntennaFocus() {
    selectedAntenna = null;
    updateDeptStyle();
  }

  // ---- Antennes / Couleurs ----
  const ANTENNA_COLORS = {
    "Atlantique Grand-Ouest": "#9ED3FF",
    "Nord-Est": "#D6B48C",
    "Grand Sud-Ouest": "#FFB099",
    "Alpes Centre-Est": "#C0A3FF",
    "Méditerranée Grand-Sud": "#76D6E8",
    "Nord-Ouest Île-de-France": "#FF9FD6"
};

  // Table “corrigée” : département (nom) -> antenne
  const DEPT_TO_ANTENNA_BY_NAME = new Map(Object.entries({
    // Alpes Centre-Est
    "ain": "Alpes Centre-Est",
    "allier": "Alpes Centre-Est",
    "ardeche": "Alpes Centre-Est",
    "cantal": "Alpes Centre-Est",
    "cote d or": "Alpes Centre-Est",
    "drome": "Alpes Centre-Est",
    "haute loire": "Alpes Centre-Est",
    "haute savoie": "Alpes Centre-Est",
    "isere": "Alpes Centre-Est",
    "jura": "Alpes Centre-Est",
    "loire": "Alpes Centre-Est",
    "nievre": "Alpes Centre-Est",
    "puy de dome": "Alpes Centre-Est",
    "rhone": "Alpes Centre-Est",
    "saone et loire": "Alpes Centre-Est",
    "savoie": "Alpes Centre-Est",
    "yonne": "Alpes Centre-Est",

    // Atlantique Grand-Ouest
    "charente": "Atlantique Grand-Ouest",
    "charente maritime": "Atlantique Grand-Ouest",
    "cotes d armor": "Atlantique Grand-Ouest",
    "deux sevres": "Atlantique Grand-Ouest",
    "finistere": "Atlantique Grand-Ouest",
    "ille et vilaine": "Atlantique Grand-Ouest",
    "indre": "Atlantique Grand-Ouest",
    "indre et loire": "Atlantique Grand-Ouest",
    "loire atlantique": "Atlantique Grand-Ouest",
    "loir et cher": "Atlantique Grand-Ouest",
    "maine et loire": "Atlantique Grand-Ouest",
    "mayenne": "Atlantique Grand-Ouest",
    "morbihan": "Atlantique Grand-Ouest",
    "sarthe": "Atlantique Grand-Ouest",
    "vendee": "Atlantique Grand-Ouest",
    "vienne": "Atlantique Grand-Ouest",

    // Grand Sud-Ouest
    "ariege": "Grand Sud-Ouest",
    "aude": "Grand Sud-Ouest",
    "aveyron": "Grand Sud-Ouest",
    "correze": "Grand Sud-Ouest",
    "creuse": "Grand Sud-Ouest",
    "dordogne": "Grand Sud-Ouest",
    "gers": "Grand Sud-Ouest",
    "gironde": "Grand Sud-Ouest",
    "haute garonne": "Grand Sud-Ouest",
    "hautes pyrenees": "Grand Sud-Ouest",
    "haute vienne": "Grand Sud-Ouest",
    "landes": "Grand Sud-Ouest",
    "lot": "Grand Sud-Ouest",
    "lot et garonne": "Grand Sud-Ouest",
    "pyrenees atlantiques": "Grand Sud-Ouest",
    "pyrenees orientales": "Grand Sud-Ouest",
    "tarn": "Grand Sud-Ouest",
    "tarn et garonne": "Grand Sud-Ouest",

    // Méditerranée Grand-Sud
    "alpes de haute provence": "Méditerranée Grand-Sud",
    "alpes maritimes": "Méditerranée Grand-Sud",
    "bouches du rhone": "Méditerranée Grand-Sud",
    "corse du sud": "Méditerranée Grand-Sud",
    "gard": "Méditerranée Grand-Sud",
    "haute corse": "Méditerranée Grand-Sud",
    "hautes alpes": "Méditerranée Grand-Sud",
    "herault": "Méditerranée Grand-Sud",
    "lozere": "Méditerranée Grand-Sud",
    "var": "Méditerranée Grand-Sud",
    "vaucluse": "Méditerranée Grand-Sud",

    // Nord-Est
    "ardennes": "Nord-Est",
    "aube": "Nord-Est",
    "bas rhin": "Nord-Est",
    "doubs": "Nord-Est",
    "haute marne": "Nord-Est",
    "haute saone": "Nord-Est",
    "haut rhin": "Nord-Est",
    "marne": "Nord-Est",
    "meurthe et moselle": "Nord-Est",
    "meuse": "Nord-Est",
    "moselle": "Nord-Est",
    "territoire de belfort": "Nord-Est",
    "vosges": "Nord-Est",

    // Nord-Ouest Île-de-France
    "aisne": "Nord-Ouest Île-de-France",
    "calvados": "Nord-Ouest Île-de-France",
    "cher": "Nord-Ouest Île-de-France",
    "essonne": "Nord-Ouest Île-de-France",
    "eure": "Nord-Ouest Île-de-France",
    "eure et loir": "Nord-Ouest Île-de-France",
    "hauts de seine": "Nord-Ouest Île-de-France",
    "loiret": "Nord-Ouest Île-de-France",
    "manche": "Nord-Ouest Île-de-France",
    "nord": "Nord-Ouest Île-de-France",
    "oise": "Nord-Ouest Île-de-France",
    "orne": "Nord-Ouest Île-de-France",
    "paris": "Nord-Ouest Île-de-France",
    "pas de calais": "Nord-Ouest Île-de-France",
    "seine et marne": "Nord-Ouest Île-de-France",
    "seine maritime": "Nord-Ouest Île-de-France",
    "seine saint denis": "Nord-Ouest Île-de-France",
    "somme": "Nord-Ouest Île-de-France",
    "val de marne": "Nord-Ouest Île-de-France",
    "val d oise": "Nord-Ouest Île-de-France",
    "yvelines": "Nord-Ouest Île-de-France"
  }));

  // ---- Map ----
  const map = L.map("map", { preferCanvas: true }).setView([46.8, 2.5], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19
  }).addTo(map);

  const clusters = L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 10,
    spiderfyOnMaxZoom: true,
    maxClusterRadius: 10,
    iconCreateFunction: (cluster) => {
      const children = cluster.getAllChildMarkers();
      const types = new Set(children.map(m => (m.options && m.options.__bimoType) ? m.options.__bimoType : ""));
      const count = cluster.getChildCount();

      // Si plusieurs types => jaune, sinon couleur du type
      let col = "yellow";
      if (types.size === 1) {
        const only = types.values().next().value;
        col = only || "yellow";
      }

      return L.divIcon({
        className: "pin-dot pin-dot-cluster-wrap",
        html: `<div class="pin-dot-inner pin-dot-cluster" style="border-color:${col};"><span class="pin-dot-count">${count}</span></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
    }
  });

  map.addLayer(clusters);

// Tooltip (survol) : liste des projets dans un cluster
clusters.on("clustermouseover", (a) => {
  const cl = a.layer;
  const kids = cl.getAllChildMarkers();
  const names = [];
  for (const m of kids) {
    const pid = m?.options?.__projId;
    const nm = pid ? (projectIdToName.get(pid) || "") : "";
    if (nm) names.push(nm);
  }
  names.sort((x, y) => x.localeCompare(y, "fr"));
  const max = 25;
  // 1 ligne = 1 projet (pas de retour à la ligne automatique à l'intérieur d'un nom)
  let html = names
    .slice(0, max)
    .map((n) => `<div class="ttLine">${escapeHtml(n)}</div>`)
    .join("");
  if (names.length > max) html += `<div class="ttMore">+${names.length - max} autres</div>`;
  if (!html) html = `${kids.length} projets`;
  if (!cl.getTooltip()) {
    cl.bindTooltip(html, { className: "projTooltip projTooltip--cluster", direction: "top", offset: [0, -10], opacity: 0.95, sticky: true });
  } else {
    cl.setTooltipContent(html);
  }
  cl.openTooltip();
});
clusters.on("clustermouseout", (a) => {
  a.layer.closeTooltip();
});


  // ---- Pins fixes : Siège & Antennes ----
  const OFFICES = [
    { type_lieu: "antenne", nom: "Alpes Centre-Est", antenne: "Alpes Centre-Est", adresse: "10 rue Stella, 69002 Lyon", latitude: 45.76061, longitude: 4.83664 },
    { type_lieu: "antenne", nom: "Nord-Ouest Île-de-France", antenne: "Nord-Ouest Île-de-France", adresse: "10 rue du Centre, 93196 Noisy-le-Grand Cedex", latitude: 48.838387, longitude: 2.545001 },
    { type_lieu: "antenne", nom: "Méditerranée Grand-Sud", antenne: "Méditerranée Grand-Sud", adresse: "52 rue Liandier, 13008 Marseille", latitude: 43.2780891, longitude: 5.3913314 },
    { type_lieu: "antenne", nom: "Nord-Est", antenne: "Nord-Est", adresse: "14 rue du Maréchal Juin, 67000 Strasbourg", latitude: 48.577957, longitude: 7.762085 },
    { type_lieu: "antenne", nom: "Grand Sud-Ouest", antenne: "Grand Sud-Ouest", adresse: "1 Place Émile Blouin, 31952 Toulouse", latitude: 43.61456, longitude: 1.466043 },
    { type_lieu: "antenne", nom: "Atlantique Grand-Ouest", antenne: "Atlantique Grand-Ouest", adresse: "10 boulevard Gaston Doumergue, 44964 Nantes Cedex 9", latitude: 47.20811, longitude: -1.544726 },
    { type_lieu: "siege", nom: "Siège", antenne: "Siège", adresse: "120 rue de Bercy, 75012 Paris", latitude: 48.841095, longitude: 2.3778439 }
  ];

  const officesLayer = L.layerGroup().addTo(map);
  let officesEnabled = true;

  function showOfficePanel(o) {
    const title = o.nom || (o.type_lieu === "siege" ? "Siège" : "Antenne");
    const fields = [
      ["Type", o.type_lieu === "siege" ? "Siège" : "Antenne"],
      ["Antenne", o.antenne],
      ["Adresse", o.adresse]
    ];

    let html = "";
    html += `<div class="panelHeader">`;
    html += `<h2 class="panelTitle">${escapeHtml(title)}</h2>`;
    html += `<button id="panelClose" class="panelClose" aria-label="Fermer">✕</button>`;
    html += `</div>`;
    html += buildKv(fields);

    // NOTE: les objets OFFICES (siège/antennes) ne portent pas de champ photos.
    // On n'affiche donc pas de galerie ici.

    openPanel(html);

    // Click sur une miniature => ouverture en grand
    const imgs = elPanel ? elPanel.querySelectorAll('.projPhoto') : [];
    imgs.forEach((img) => {
      img.addEventListener('click', () => openLightbox(img.getAttribute('src') || '', img.getAttribute('alt') || 'Photo'));
    });

    const btn = document.getElementById("panelClose");
    if (btn) btn.addEventListener("click", closePanel);
  }

  function renderOffices() {
    officesLayer.clearLayers();
    if (!officesEnabled) return;

    for (const o of OFFICES) {
      const ll = [Number(o.latitude), Number(o.longitude)];
      if (!Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) continue;

      const isHQ = o.type_lieu === "siege";

      const officeSvg = `
        <svg class="pin-office-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 22h16v-2H4v2zm2-4h12V4H6v14zm2-2V6h2v10H8zm4 0V6h2v10h-2z"/>
        </svg>
      `;

      const marker = L.marker(ll, {
        icon: L.divIcon({
          className: "pin-dot",
          html: `<div class="pin-office-wrap">${officeSvg}${isHQ ? `<div class="pin-office-badge">★</div>` : ``}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        })
      });

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        setSelectedMarker(marker);

        // Focus antenne => départements plus foncés + filtrage des projets de cette antenne
        if (o.type_lieu === "antenne" && o.antenne) {
          selectedAntenna = o.antenne;
          updateDeptStyle();
          renderMarkers(); // n'afficher que les projets de l'antenne
        } else {
          clearAntennaFocus();
          renderMarkers(); // ré-afficher tous les projets
        }

        showOfficePanel(o);
      });

      officesLayer.addLayer(marker);
    }
  }

  function initOfficesToggle() {
    // On insère un toggle à côté des filtres de type (MOM/AMO/EXP) si possible
    const typeFilters = Array.from(document.querySelectorAll(".typeFilter"));
    if (!typeFilters.length) {
      renderOffices();
      return;
    }
    const last = typeFilters[typeFilters.length - 1];
    const host = last.closest("label")?.parentElement || last.parentElement || last;

    // Eviter de doubler si le script est chargé deux fois
    if (document.getElementById("officesToggle")) {
      renderOffices();
      return;
    }

    const wrap = document.createElement("label");
    wrap.className = "toggle officesToggle";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = "officesToggle";
    cb.checked = true;

    const span = document.createElement("span");
    span.textContent = "Siège & antennes";

    wrap.appendChild(cb);
    wrap.appendChild(span);
    host.insertAdjacentElement("afterend", wrap);

    cb.addEventListener("change", () => {
      officesEnabled = !!cb.checked;
      renderOffices();
    });

    renderOffices();
  }

  map.on("click", () => closePanel());

  // ---- Helpers ----
  function showStatus(msg) {
    if (!elStatus) return;
    elStatus.textContent = msg;
    elStatus.hidden = !msg;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatEuro(v) {
    const s = String(v ?? "").trim();
    if (!s) return "";
    // enlève espaces / symbole €, accepte virgule
    const cleaned = s.replace(/\s/g, "").replace(/€/g, "").replace(",", ".");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return s;
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
  }



function amountNumber(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!s) return NaN;
  // enlève espaces (dont insécables), symbole €, et normalise virgule
  const cleaned = s
    .replace(/[\s\u00A0\u202F]/g, "")
    .replace(/€/g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.+-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

  function projectId(p) {
    return String(p["Code projet"] ?? p.code_projet ?? p.codeProjet ?? p.id ?? "").trim();
  }

  function projectListLabel(p) {
    const nom = String(p["Nom de projet"] ?? p.nom ?? "").trim();
    const typ = String(p["Type de projet"] ?? p.type ?? "").trim();
    const ant = String(p["Antenne"] ?? p.antenne ?? "").trim();
    const mnt = formatEuro(p["Montant"] ?? p.montant);
    return { nom, typ, mnt, ant };
  }

  function buildProjectList() {
    if (!elProjListItems) return;
    const q = String(elProjListSearch?.value ?? "").toLowerCase().trim();

    // On liste les projets actuellement filtrés (recherche + types + dept si activé)
    const arr = filteredProjects();
    const rows = [];

    for (const p of arr) {
      const pid = projectId(p);
      if (!pid) continue;
      const { nom, typ, mnt, ant } = projectListLabel(p);
      const blob = `${nom} ${typ} ${mnt} ${ant}`.toLowerCase();
      if (q && !blob.includes(q)) continue;
      rows.push({ pid, nom, typ, mnt, ant, amountNum: amountNumber(p["Montant"] ?? p.montant) });
    }

    const sortMode = String(elProjListSort?.value ?? "name_asc");

    const coll = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

    rows.sort((a, b) => {
      switch (sortMode) {
        case "name_desc":
          return coll.compare(b.nom, a.nom);
        case "amount_desc": {
          const av = Number.isFinite(a.amountNum) ? a.amountNum : -Infinity;
          const bv = Number.isFinite(b.amountNum) ? b.amountNum : -Infinity;
          return bv - av || coll.compare(a.nom, b.nom);
        }
        case "amount_asc": {
          const av = Number.isFinite(a.amountNum) ? a.amountNum : Infinity;
          const bv = Number.isFinite(b.amountNum) ? b.amountNum : Infinity;
          return av - bv || coll.compare(a.nom, b.nom);
        }
        case "type_asc":
          return coll.compare(a.typ, b.typ) || coll.compare(a.nom, b.nom);
        case "antenna_asc":
          return coll.compare(a.ant, b.ant) || coll.compare(a.nom, b.nom);
        case "name_asc":
        default:
          return coll.compare(a.nom, b.nom);
      }
    });

    if (!rows.length) {
      elProjListItems.innerHTML = `<div class="projListEmpty">Aucun projet.</div>`;
      return;
    }

    elProjListItems.innerHTML = rows.map(r => `
      <div class="projListRow" data-pid="${escapeAttr(r.pid)}">
        <div class="projListName">${escapeHtml(r.nom || "(sans nom)")}</div>
        <div>${escapeHtml(r.typ)}</div>
        <div>${escapeHtml(r.mnt)}</div>
        <div>${escapeHtml(r.ant)}</div>
      </div>
    `).join("");
  }

  function openProjectFromList(pid) {
    const marker = projectIdToMarker.get(pid);
    if (!marker) return;

    const ll = marker.getLatLng();
    setSelectedMarker(marker);

    const targetZoom = Math.max(map.getZoom(), 14);
    map.flyTo([ll.lat, ll.lng], targetZoom, { duration: 0.6 });

    const p = allProjects.find(x => projectId(x) === pid);
    if (p) showPanel(p);

    if (elProjListMenu) elProjListMenu.hidden = true;
  }

  function normalizeForLookup(s) {
    const str = String(s || "").trim().toLowerCase();
    if (!str) return "";
    const noAccents = str.normalize("NFD").replace(/\p{Diacritic}/gu, "");
    return noAccents
      .replace(/[’']/g, " ")
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeDeptCode(code) {
    const c = String(code || "").trim().toUpperCase();
    if (!c) return "";
    if (c === "2A" || c === "2B") return c;
    if (/^\d{1,2}$/.test(c)) return c.padStart(2, "0");
    if (/^\d{3}$/.test(c)) return c;
    return c;
  }

  function getActiveTypes() {
    return Array.from(document.querySelectorAll(".typeFilter:checked"))
      .map((x) => String(x.value || "").toLowerCase().trim())
      .filter(Boolean);
  }

  function projectType(p) {
    return String(p["Type de projet"] ?? p.type ?? "").toLowerCase().trim();
  }

  function projectLatLon(p) {
    const lat = parseFloat(String(p.latitude ?? p.lat ?? "").replace(",", "."));
    const lon = parseFloat(String(p.longitude ?? p.lon ?? "").replace(",", "."));
    if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
    return null;
  }

  function deptCodeFromProject(p) {
    const raw = String(p["Département"] ?? p.departement ?? "").trim();
    if (!raw) return "";
    const maybeCode = normalizeDeptCode(raw);
    if (/^(\d{2}|\d{3}|2A|2B)$/.test(maybeCode)) return maybeCode;
    const key = normalizeForLookup(raw);
    return deptNameToCode.get(key) || "";
  }

  function matchesFilters(p) {
    const q = (elQ?.value || "").toLowerCase().trim();
    const types = getActiveTypes();
    const t = projectType(p);

    if (types.length && !types.some((x) => t.includes(x))) return false;

    if (q) {
      const blob = Object.values(p).join(" ").toLowerCase();
      if (!blob.includes(q)) return false;
    }

    if (filterByDeptEnabled && selectedDeptCode) {
      const dep = deptCodeFromProject(p);
      if (dep !== selectedDeptCode) return false;
    }

    return true;
  }

  function filteredProjects() {
    const base = allProjects.filter(matchesFilters);

    // Si une antenne est sélectionnée (clic sur pin antenne),
    // on n'affiche que les projets appartenant à cette antenne.
    if (!selectedAntenna) return base;

    const a = normalizeForLookup(selectedAntenna);
    return base.filter((p) => normalizeForLookup(p["Antenne"] ?? p.antenne) === a);
  }

function computeFilteredCounts() {
    const counts = {};
    for (const p of filteredProjects()) {
      const code = deptCodeFromProject(p);
      if (!code) continue;
      counts[code] = (counts[code] || 0) + 1;
    }
    return counts;
  }

// ---- Pins projets ----
  function colorByType(t) {
    if (!t) return "blue";
    const x = String(t).toLowerCase();
    if (x.includes("amo")) return "red";
    if (x.includes("mom")) return "blue";
    if (x.includes("exp")) return "green";
    return "orange";
  }

  function renderMarkers() {
    clusters.clearLayers();
    projectIdToMarker = new Map();
    clearSelectedMarker();

    const list = filteredProjects();

    for (const p of list) {
      const ll = projectLatLon(p);
      if (!ll) continue;

      const col = colorByType(p["Type de projet"] ?? p.type ?? "");
      const marker = L.marker(ll, {
        icon: L.divIcon({
          className: "pin-dot",
          html: `<div class="pin-dot-inner" style="border-color:${col};"></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        })
      });

      const pid = projectId(p);
      if (pid) {
        projectIdToMarker.set(pid, marker);
        marker.options.__projId = pid;
      }

      marker.options.__bimoType = col;

      // Tooltip (survol) : nom du projet
      const pName = String(p["Nom de projet"] ?? p.nom ?? "").trim();
      if (pName) {
        marker.bindTooltip(escapeHtml(pName), {
          className: "projTooltip projTooltip--single",
          direction: "top",
          offset: [0, -10],
          opacity: 0.95,
          sticky: true
        });
      }
marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        setSelectedMarker(marker);

        // En cliquant sur un projet, on enlève le focus antenne (si présent)
        selectedAntenna = null;
        updateDeptStyle();

        // Zoom/centrage sur le pin cliqué
        const targetZoom = Math.max(map.getZoom(), 14);
        map.flyTo(ll, targetZoom, { duration: 0.6 });

        showPanel(p);
      });

      clusters.addLayer(marker);
    }

    if (elCount) elCount.textContent = String(list.length);
    filteredCounts = computeFilteredCounts();
    buildProjectList();
    updateDeptStyle();
  }

  // ---- Panel ----

  // ---- Photos (panel) ----
  function renderPhotosHtml(photos, title) {
    if (!Array.isArray(photos) || photos.length === 0) return "";
    const safeTitle = title ? escapeHtml(String(title)) : "Photo";
    const items = photos
      .filter((x) => typeof x === "string" && x.trim().length > 0)
      .map((src, i) => {
        const s = src.trim();
        const alt = `${safeTitle} — ${i + 1}`;
        // onerror: cache l’image si le fichier n’existe pas (suppression côté repo)
        return `<img class="projPhoto" src="${escapeAttr(s)}" alt="${escapeAttr(alt)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`;
      })
      .join("");
    if (!items) return "";
    return `
      <div class="projPhotos">
        <div class="projPhotosTitle">Photos</div>
        <div class="projPhotosGrid">
          ${items}
        </div>
      </div>
    `;
  }

  let lightboxEl = null;
  function openLightbox(src, alt) {
    if (!src) return;
    closeLightbox();
    lightboxEl = document.createElement("div");
    lightboxEl.className = "lightbox";
    lightboxEl.innerHTML = `
      <div class="lightboxBackdrop" data-close="1"></div>
      <div class="lightboxContent" role="dialog" aria-modal="true">
        <button class="lightboxClose" aria-label="Fermer" data-close="1">✕</button>
        <img class="lightboxImg" src="${escapeAttr(src)}" alt="${escapeAttr(alt || "Photo")}" loading="eager">
      </div>
    `;
    document.body.appendChild(lightboxEl);

    lightboxEl.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute("data-close") === "1") closeLightbox();
    });

    const onKey = (e) => {
      if (e.key === "Escape") closeLightbox();
    };
    document.addEventListener("keydown", onKey, { once: true });

    const img = lightboxEl.querySelector(".lightboxImg");
    if (img) img.onerror = () => closeLightbox();
  }

  function closeLightbox() {
    if (lightboxEl && lightboxEl.parentNode) lightboxEl.parentNode.removeChild(lightboxEl);
    lightboxEl = null;
  }

  function openPanel(html) {
    if (!elPanel) return;
    elPanel.innerHTML = html;
    elPanel.classList.add("open");
  }

  function closePanel() {
    if (!elPanel) return;
    elPanel.classList.remove("open");
    elPanel.innerHTML = "";
    clearSelectedMarker();

    // Fermer le panneau retire le focus antenne (retour à la coloration normale)
    selectedAntenna = null;
    updateDeptStyle();
  }

  function showPanel(p) {
    const title = p["Nom de projet"] ?? p.nom ?? "Projet";
    const fields = [
      ["Antenne", p["Antenne"] ?? p.antenne],
      ["Ville", p["Ville"] ?? p.ville],
      ["Type de projet", p["Type de projet"] ?? p.type],
      ["Montant", formatEuro(p["Montant"] ?? p.montant)],
      ["Client", p["Client"] ?? p.client],
      ["Thématique", p["Thématique"] ?? p.thematique],
      ["Résumé", p["Résumé"] ?? p.resume],
      ["Adresse", p["Adresse"] ?? p.adresse],
      ["Programme", p["Programme"] ?? p.programme]
    ];

    let html = "";
    html += `<div class="panelHeader">`;
    html += `<h2 class="panelTitle">${escapeHtml(title)}</h2>`;
    html += `<button id="panelClose" class="panelClose" aria-label="Fermer">✕</button>`;
    html += `</div>`;
    html += buildKv(fields);

    // Bouton : ouvrir la fiche A4 (nouvel onglet) via "Code projet"
    const codeProjet = String(p["Code projet"] ?? p.code_projet ?? p.codeProjet ?? "").trim();
    if (codeProjet) {
      const href = `fiche.html?code=${encodeURIComponent(codeProjet)}`;
      html += `
        <div class="panelActions">
          <a class="panelActionBtn" href="${escapeHtml(href)}" target="_blank" rel="noopener">📄 Fiche A4</a>
        </div>`;
    }

    const photos = getProjectPhotos(p);
    html += renderPhotosSection(photos);

    openPanel(html);

    // clic sur miniatures -> lightbox
    const grid = elPanel?.querySelector(".projPhotosGrid");
    if (grid) {
      grid.addEventListener("click", (ev) => {
        const btn = ev.target?.closest?.(".projPhotoBtn");
        if (!btn) return;
        const src = btn.getAttribute("data-src");
        if (src) openLightbox(src);
      });
    }
    const btn = document.getElementById("panelClose");
    if (btn) btn.addEventListener("click", closePanel, { once: true });
  }

  // Génère le bloc d'infos du panneau avec les classes attendues par le CSS (kv/kvRow/kvKey/kvVal)
  function buildKv(fields) {
    let html = `<div class="kv" style="color:#000;">`;
    for (const [label, value] of fields) {
      if (value === undefined || value === null) continue;
      const s = String(value).trim();
      if (!s) continue;
      // On garde le ":" dans le libellé comme avant (et le CSS le met en gras)
      html += `<div class="kvRow"><div class="kvKey" style="color:#000;">${escapeHtml(label)} :</div><div class="kvVal" style="color:#000;">${escapeHtml(s)}</div></div>`;
    }
    html += `</div>`;
    return html;
  }

  // ---- Photos (dans le panneau projet) ----
  function getProjectPhotos(p) {
    const v = (p && (p.photos ?? p["photos"])) ?? [];
    return Array.isArray(v) ? v.filter(Boolean) : [];
  }

  function renderPhotosSection(photos) {
    if (!photos || photos.length === 0) return "";
    const items = photos
      .map((src, i) => {
        const safe = String(src);
        const alt = `Photo ${i + 1}`;
        return `
          <button class="projPhotoBtn" type="button" data-src="${escapeHtml(safe)}" aria-label="${escapeHtml(alt)}">
            <img class="projPhoto" src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}" loading="lazy"
                 onerror="this.closest('.projPhotoBtn') && (this.closest('.projPhotoBtn').style.display='none')">
          </button>`;
      })
      .join("");
    return `
      <div class="projPhotos">
        <div class="projPhotosTitle">Photos</div>
        <div class="projPhotosGrid">
          ${items}
        </div>
      </div>`;
  }

  function openLightbox(src) {
    const existing = document.getElementById("photoLightbox");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "photoLightbox";
    overlay.className = "photoLightbox";
    overlay.innerHTML = `
      <div class="photoLightboxBackdrop" data-close="1"></div>
      <div class="photoLightboxBox" role="dialog" aria-modal="true">
        <button class="photoLightboxClose" type="button" aria-label="Fermer" data-close="1">✕</button>
        <img class="photoLightboxImg" src="${escapeHtml(String(src))}" alt="Photo projet"
             onerror="this.alt='Image introuvable';">
      </div>`;
    document.body.appendChild(overlay);

    const onClose = (e) => {
      if (e.target && e.target.getAttribute("data-close") === "1") {
        overlay.remove();
        document.removeEventListener("keydown", onEsc);
      }
    };
    const onEsc = (e) => {
      if (e.key === "Escape") {
        overlay.remove();
        document.removeEventListener("keydown", onEsc);
      }
    };

    overlay.addEventListener("click", onClose);
    document.addEventListener("keydown", onEsc);
  }


  // ---- Départements ----
  function colorByAntenna(a) {
    return ANTENNA_COLORS[a] || "#FFFFFF";
  }

  function styleDept(feature) {
    const props = feature?.properties || {};
    const codeRaw =
      props.code ??
      props.CODE ??
      props.dep ??
      props.DEP ??
      props.insee ??
      props.INSEE ??
      props.code_dept ??
      props.CODE_DEPT ??
      "";
    const code = normalizeDeptCode(codeRaw);
    const antenna = deptCodeToAntenna[code] || "";

    const isDeptSelected = !!(filterByDeptEnabled && selectedDeptCode && code === selectedDeptCode);
    const isAntennaFocused = !!(selectedAntenna && antenna && antenna === selectedAntenna);

    // On "fonce" l’antenne sélectionnée via opacité/contour
    const weight = isDeptSelected || isAntennaFocused ? 2 : 1;
    const color = isDeptSelected || isAntennaFocused ? "#111" : "#666";
    const fillOpacity = isDeptSelected ? 0.88 : (isAntennaFocused ? 0.70 : (antenna ? 0.45 : 0.14));

    return {
      weight,
      color,
      fillColor: colorByAntenna(antenna),
      fillOpacity
    };
  }

  function highlightDept(e) {
    const layer = e.target;
    layer.setStyle({ weight: 2, color: "#111", fillOpacity: 0.85 });
    if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) layer.bringToFront();
  }

  function resetDeptHighlight(e) {
    if (!deptLayer) return;
    deptLayer.resetStyle(e.target);
  }

  function onEachDept(feature, layer) {
    const props = feature?.properties || {};
    const name = props.nom ?? props.NOM ?? props.name ?? props.NAME ?? "";
    const codeRaw =
      props.code ??
      props.CODE ??
      props.dep ??
      props.DEP ??
      props.insee ??
      props.INSEE ??
      props.code_dept ??
      props.CODE_DEPT ??
      "";
    const code = normalizeDeptCode(codeRaw);

    layer.on({
      mouseover: highlightDept,
      mouseout: resetDeptHighlight,
      click: () => {
        map.fitBounds(layer.getBounds(), { padding: [20, 20] });
        if (filterByDeptEnabled && code) {
          selectedDeptCode = selectedDeptCode === code ? null : code;
          // En cliquant sur un département, on enlève le focus antenne
          selectedAntenna = null;
          closePanel();
          renderMarkers();
          updateDeptSelectedStat();
        }
      }
    });

    layer.bindTooltip(
      () => {
        const tail = code ? ` (${code})` : "";
        const a = deptCodeToAntenna[code] || "";
        const aTxt = a ? ` — ${escapeHtml(a)}` : "";
        const n = filteredCounts[code] || 0;
        return `${escapeHtml(name)}${tail}${aTxt} — ${n} projet(s)`;
      },
      { sticky: true }
    );
  }

  function buildDeptMaps(geo) {
    deptNameToCode = new Map();
    deptCodeToAntenna = {};

    const features = geo?.features || [];
    for (const f of features) {
      const props = f?.properties || {};
      const codeRaw =
        props.code ??
        props.CODE ??
        props.dep ??
        props.DEP ??
        props.insee ??
        props.INSEE ??
        props.code_dept ??
        props.CODE_DEPT ??
        "";
      const nameRaw = props.nom ?? props.NOM ?? props.name ?? props.NAME ?? props.libelle ?? props.LIBELLE ?? "";

      const code = normalizeDeptCode(codeRaw);
      const key = normalizeForLookup(nameRaw);

      if (code && key) {
        deptNameToCode.set(key, code);
        const antenna = DEPT_TO_ANTENNA_BY_NAME.get(key) || "";
        if (antenna) deptCodeToAntenna[code] = antenna;
      }
    }
  }

  async function loadDepartements() {
    const geo = await fetchJson(DEPTS_URL);
    buildDeptMaps(geo);

    deptLayer = L.geoJSON(geo, { style: styleDept, onEachFeature: onEachDept }).addTo(map);
    deptLayer.bringToBack();
    if (elLegend) elLegend.hidden = false;
  }

  function updateDeptStyle() {
    if (!deptLayer) return;
    deptLayer.setStyle(styleDept);
  }

  function updateDeptSelectedStat() {
    if (!elStatDept) return;
    if (filterByDeptEnabled && selectedDeptCode) elStatDept.textContent = `— département: ${selectedDeptCode}`;
    else elStatDept.textContent = "";
  }

  // ---- Fetch robuste ----
  async function fetchJson(url, { timeoutMs = 15000 } = {}) {
    showStatus("");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort("timeout"), timeoutMs);

    try {
      const r = await fetch(url, {
        cache: "no-cache",
        headers: { Accept: "application/json" },
        signal: ctrl.signal
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
      const txt = await r.text();
      const clean = txt.replace(/^\uFEFF/, "");
      return JSON.parse(clean);
    } finally {
      clearTimeout(t);
    }
  }

  // ---- Debounce ----
  function debounce(fn, waitMs) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), waitMs);
    };
  }

  // ---- Init UI ----
  const rerenderDebounced = debounce(renderMarkers, 200);
  if (elQ) elQ.addEventListener("input", rerenderDebounced);
  document.querySelectorAll(".typeFilter").forEach((cb) => cb.addEventListener("change", renderMarkers));
  initOfficesToggle();

  if (elDeptClickFilter) {
    elDeptClickFilter.addEventListener("change", () => {
      filterByDeptEnabled = !!elDeptClickFilter.checked;
      if (!filterByDeptEnabled) selectedDeptCode = null;
      updateDeptSelectedStat();
      renderMarkers();
    });
  }

  if (elClear) {
    elClear.addEventListener("click", () => {
      if (elQ) elQ.value = "";
      document.querySelectorAll(".typeFilter").forEach((cb) => (cb.checked = true));
      selectedDeptCode = null;
      filterByDeptEnabled = false;
      if (elDeptClickFilter) elDeptClickFilter.checked = false;
      closePanel();
      updateDeptSelectedStat();
      renderMarkers();
    });
  }

  // ---- Liste projets ----
  if (elProjListBtn && elProjListMenu) {
    elProjListBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      elProjListMenu.hidden = !elProjListMenu.hidden;
      if (!elProjListMenu.hidden) {
        buildProjectList();
        elProjListSearch?.focus();
      }
    });

    elProjListSearch?.addEventListener("input", buildProjectList);
    elProjListSort?.addEventListener("change", buildProjectList);

    elProjListItems?.addEventListener("click", (e) => {
      const row = e.target?.closest?.(".projListRow");
      const pid = row?.getAttribute?.("data-pid");
      if (pid) openProjectFromList(pid);
    });

    document.addEventListener("click", () => { elProjListMenu.hidden = true; });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") elProjListMenu.hidden = true;
    });
    elProjListMenu.addEventListener("click", (e) => e.stopPropagation());
  }


  // ---- Load data ----
  (async () => {
    try {
      await loadDepartements();
      const data = await fetchJson(PROJECTS_URL);
      allProjects = Array.isArray(data?.projets) ? data.projets : Array.isArray(data) ? data : [];
      projectIdToName = new Map();
      for (const p of allProjects){
        const pid = projectId(p);
        const nm = String(p["Nom de projet"] ?? p.nom ?? "").trim();
        if (pid) projectIdToName.set(pid, nm);
      }
      renderMarkers();
    } catch (err) {
      console.error(err);
      showStatus(String(err?.message || err));
    }
  })();

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }
})();

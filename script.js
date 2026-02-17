// Carte Projets — base propre (Leaflet + clustering + départements choroplèthe)
//
// Fichiers attendus à la racine du site (GitHub Pages) :
// - export_projets_web.json
// - departements.geojson

(() => {
  "use strict";

  // ---- Configuration ----
  const DATA_VERSION = "2026-02-17"; // Incrémentez pour forcer un rafraîchissement du cache navigateur si besoin.
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

  // ---- State ----
  let allProjects = [];
  let deptGeo = null;
  let deptLayer = null;
  let deptNameToCode = new Map(); // "haute savoie" -> "74"
  let selectedDeptCode = null;
  let lastCounts = {}; // { "75": 12, ... }
  let filterByDeptEnabled = false;

  // ---- Antennes (couleur par appartenance) ----
  const ANTENNA_COLORS = {
    "Atlantique Grand-Ouest": "rgba(255,105,180,0.40)",      // rose
    "Nord-Est": "rgba(135,206,250,0.40)",                    // bleu clair
    "Grand Sud-Ouest": "rgba(30,144,255,0.35)",              // bleu foncé
    "Alpes Centre-Est": "rgba(60,179,113,0.35)",             // vert
    "Méditerranée Grand-Sud": "rgba(255,215,0,0.35)",        // jaune
    "Nord-Ouest Île-de-France": "rgba(138,43,226,0.30)"      // violet
  };

  // Table d'affectation département -> antenne (par NOM, normalisé)
  const DEPT_TO_ANTENNA_BY_NAME = new Map(Object.entries({
    "ain": "Alpes Centre-Est",
    "aisne": "Nord-Ouest Île-de-France",
    "allier": "Alpes Centre-Est",
    "alpes de haute provence": "Méditerranée Grand-Sud",
    "hautes alpes": "Méditerranée Grand-Sud",
    "alpes maritimes": "Méditerranée Grand-Sud",
    "ardeche": "Alpes Centre-Est",
    "ardennes": "Nord-Est",
    "ariege": "Grand Sud-Ouest",
    "aube": "Nord-Est",
    "aude": "Grand Sud-Ouest",
    "aveyron": "Grand Sud-Ouest",
    "bouches du rhone": "Méditerranée Grand-Sud",
    "calvados": "Nord-Ouest Île-de-France",
    "cantal": "Alpes Centre-Est",
    "charente": "Atlantique Grand-Ouest",
    "charente maritime": "Atlantique Grand-Ouest",
    "cher": "Nord-Ouest Île-de-France",
    "correze": "Atlantique Grand-Ouest",
    "cote d or": "Alpes Centre-Est",
    "cotes d armor": "Atlantique Grand-Ouest",
    "creuse": "Atlantique Grand-Ouest",
    "dordogne": "Atlantique Grand-Ouest",
    "doubs": "Alpes Centre-Est",
    "drome": "Alpes Centre-Est",
    "eure": "Nord-Ouest Île-de-France",
    "eure et loir": "Nord-Ouest Île-de-France",
    "finistere": "Atlantique Grand-Ouest",
    "corse du sud": "Méditerranée Grand-Sud",
    "haute corse": "Méditerranée Grand-Sud",
    "gard": "Grand Sud-Ouest",
    "haute garonne": "Grand Sud-Ouest",
    "gers": "Grand Sud-Ouest",
    "gironde": "Atlantique Grand-Ouest",
    "herault": "Grand Sud-Ouest",
    "ille et vilaine": "Atlantique Grand-Ouest",
    "indre": "Nord-Ouest Île-de-France",
    "indre et loire": "Nord-Ouest Île-de-France",
    "isere": "Alpes Centre-Est",
    "jura": "Alpes Centre-Est",
    "landes": "Atlantique Grand-Ouest",
    "loir et cher": "Nord-Ouest Île-de-France",
    "loire": "Alpes Centre-Est",
    "haute loire": "Alpes Centre-Est",
    "loire atlantique": "Atlantique Grand-Ouest",
    "loiret": "Nord-Ouest Île-de-France",
    "lot": "Grand Sud-Ouest",
    "lot et garonne": "Atlantique Grand-Ouest",
    "lozere": "Grand Sud-Ouest",
    "maine et loire": "Atlantique Grand-Ouest",
    "manche": "Nord-Ouest Île-de-France",
    "marne": "Nord-Est",
    "haute marne": "Nord-Est",
    "mayenne": "Atlantique Grand-Ouest",
    "meurthe et moselle": "Nord-Est",
    "meuse": "Nord-Est",
    "morbihan": "Atlantique Grand-Ouest",
    "moselle": "Nord-Est",
    "nievre": "Alpes Centre-Est",
    "nord": "Nord-Ouest Île-de-France",
    "oise": "Nord-Ouest Île-de-France",
    "orne": "Nord-Ouest Île-de-France",
    "pas de calais": "Nord-Ouest Île-de-France",
    "puy de dome": "Alpes Centre-Est",
    "pyrenees atlantiques": "Atlantique Grand-Ouest",
    "hautes pyrenees": "Grand Sud-Ouest",
    "pyrenees orientales": "Grand Sud-Ouest",
    "bas rhin": "Nord-Est",
    "haut rhin": "Nord-Est",
    "rhone": "Alpes Centre-Est",
    "haute saone": "Alpes Centre-Est",
    "saone et loire": "Alpes Centre-Est",
    "sarthe": "Atlantique Grand-Ouest",
    "savoie": "Alpes Centre-Est",
    "haute savoie": "Alpes Centre-Est",
    "paris": "Nord-Ouest Île-de-France",
    "seine maritime": "Nord-Ouest Île-de-France",
    "seine et marne": "Nord-Ouest Île-de-France",
    "yvelines": "Nord-Ouest Île-de-France",
    "deux sevres": "Atlantique Grand-Ouest",
    "somme": "Nord-Ouest Île-de-France",
    "tarn": "Grand Sud-Ouest",
    "tarn et garonne": "Grand Sud-Ouest",
    "var": "Méditerranée Grand-Sud",
    "vaucluse": "Méditerranée Grand-Sud",
    "vendee": "Atlantique Grand-Ouest",
    "vienne": "Atlantique Grand-Ouest",
    "haute vienne": "Atlantique Grand-Ouest",
    "vosges": "Nord-Est",
    "yonne": "Alpes Centre-Est",
    "territoire de belfort": "Alpes Centre-Est",
    "essonne": "Nord-Ouest Île-de-France",
    "hauts de seine": "Nord-Ouest Île-de-France",
    "seine saint denis": "Nord-Ouest Île-de-France",
    "val de marne": "Nord-Ouest Île-de-France",
    "val d oise": "Nord-Ouest Île-de-France"
  }));

  // Une fois qu'on connaît le code INSEE du département (GeoJSON), on met aussi une table code -> antenne.
  let deptCodeToAntenna = {};


  // ---- Map ----
  const map = L.map("map", { preferCanvas: true }).setView([46.8, 2.5], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19
  }).addTo(map);

  const clusters = L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 30,
    spiderfyOnMaxZoom: true
    maxClusterRadius: 10
  });

  map.addLayer(clusters);

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

  function normalizeForLookup(s) {
    // lower-case + remove accents + normalize spaces/dashes/apostrophes
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
    if (/^\d{3}$/.test(c)) return c; // DOM: 971, 972...
    return c;
  }

  function getActiveTypes() {
    return Array.from(document.querySelectorAll(".typeFilter:checked"))
      .map(x => String(x.value || "").toLowerCase().trim())
      .filter(Boolean);
  }

  function projectType(p) {
    return String(p["Type de projet"] ?? p.type ?? "").toLowerCase().trim();
  }

  function projectLatLon(p) {
    // Données actuelles : latitude/longitude en texte
    const lat = parseFloat(String(p.latitude ?? p.lat ?? "").replace(",", "."));
    const lon = parseFloat(String(p.longitude ?? p.lon ?? "").replace(",", "."));
    if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
    return null;
  }

  function deptCodeFromProject(p) {
    // Le JSON projets contient "Département" = nom (ex: "Haute-Savoie")
    const raw = String(p["Département"] ?? p.departement ?? "").trim();
    if (!raw) return "";
    // Si jamais on a déjà un code (ex: "74"), on le garde
    const maybeCode = normalizeDeptCode(raw);
    if (/^(\d{2}|\d{3}|2A|2B)$/.test(maybeCode)) return maybeCode;

    const key = normalizeForLookup(raw);
    return deptNameToCode.get(key) || "";
  }

  function matchesFilters(p) {
    const q = (elQ?.value || "").toLowerCase().trim();
    const types = getActiveTypes();
    const t = projectType(p);

    if (types.length && !types.some(x => t.includes(x))) return false;

    if (q) {
      // Recherche full-text simple sur toutes les valeurs du projet
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
    return allProjects.filter(matchesFilters);
  }

  // ---- Pins ----
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

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        showPanel(p);
      });

      clusters.addLayer(marker);
    }

    elCount && (elCount.textContent = String(list.length));
    lastCounts = computeFilteredCounts();
    updateDeptCountsAndStyle();
  }

  // ---- Panel ----
  function openPanel(html) {
    if (!elPanel) return;
    elPanel.innerHTML = html;
    elPanel.classList.add("open");
  }

  function closePanel() {
    if (!elPanel) return;
    elPanel.classList.remove("open");
    elPanel.innerHTML = "";
  }

  function showPanel(p) {
    const title = p["Nom de projet"] ?? p.nom ?? "Projet";

    // NB: on n'affiche volontairement PAS latitude/longitude
    const fields = [
      ["Département", p["Département"] ?? p.departement],
      ["Antenne", p["Antenne"] ?? p.antenne],
      ["Ville", p["Ville"] ?? p.ville],
      ["Type de projet", p["Type de projet"] ?? p.type],
      ["Montant", p["Montant"] ?? p.montant],
      ["Client", p["Client"] ?? p.client],
      ["Thématique", p["Thématique"] ?? p.thematique],
      ["Résumé", p["Résumé"] ?? p.resume],
      ["Adresse", p["Adresse"] ?? p.adresse],
      ["Programme", p["Programme"] ?? p.programme],
      ["Code projet", p["Code projet"] ?? p["Code projet "] ?? p.code ?? p["Code_Projet"]]
    ];

    let html = "";
    html += `<div class="panelHeader">`;
    html += `<h2 class="panelTitle">${escapeHtml(title)}</h2>`;
    html += `<button class="panelClose" id="panelClose" type="button" aria-label="Fermer">✕</button>`;
    html += `</div>`;

    html += `<div class="kv">`;
    for (const [label, value] of fields) {
      if (value === undefined || value === null) continue;
      const s = String(value).trim();
      if (!s) continue;
      html += `<div class="kvRow"><div class="kvKey">${escapeHtml(label)}</div><div class="kvVal">${escapeHtml(s)}</div></div>`;
    }
    html += `</div>`;

    openPanel(html);

    const btn = document.getElementById("panelClose");
    if (btn) btn.addEventListener("click", closePanel, { once: true });
  }

  // ---- Départements (choroplèthe) ----
  function colorByAntenna(antenna) {
    return ANTENNA_COLORS[antenna] || "rgba(255,255,255,0.00)";
  }

  function buildDeptNameMap(geo) {
    const mapNameToCode = new Map();
    const features = geo?.features || [];
    for (const f of features) {
      const props = f?.properties || {};
      const codeRaw =
        props.code ?? props.CODE ?? props.dep ?? props.DEP ??
        props.insee ?? props.INSEE ?? props.code_dept ?? props.CODE_DEPT ?? "";
      const nameRaw =
        props.nom ?? props.NOM ?? props.name ?? props.NAME ?? props.libelle ?? props.LIBELLE ?? "";
      const code = normalizeDeptCode(codeRaw);
      const key = normalizeForLookup(nameRaw);
      if (code && key) {
        mapNameToCode.set(key, code);
        const antenna = DEPT_TO_ANTENNA_BY_NAME.get(key) || "";
        if (antenna) deptCodeToAntenna[code] = antenna;
      }
    }
    deptNameToCode = mapNameToCode;
  }

  function computeDeptCounts(){ return {}; }

  // Comptage des projets FILTRÉS par département (utile pour tooltips)
  function computeFilteredCounts() {
    const counts = {};
    for (const p of allProjects) {
      if (!matchesFilters(p)) continue;
      const code = deptCodeFromProject(p);
      if (!code) continue;
      counts[code] = (counts[code] || 0) + 1;
    }
    return counts;
  }

  function styleDept(feature) {
    const props = feature?.properties || {};
    const codeRaw =
      props.code ?? props.CODE ?? props.dep ?? props.DEP ??
      props.insee ?? props.INSEE ?? props.code_dept ?? props.CODE_DEPT ?? "";
    const code = normalizeDeptCode(codeRaw);

    const antenna = deptCodeToAntenna[code] || "";

    const isSelected = !!(filterByDeptEnabled && selectedDeptCode && code === selectedDeptCode);

    return {
      weight: isSelected ? 2 : 1,
      color: isSelected ? "#111" : "#666",
      fillColor: colorByAntenna(antenna),
      fillOpacity: antenna ? 0.55 : 0.08
    };
  }

  function highlightDept(e) {
    const layer = e.target;
    layer.setStyle({ weight: 2, color: "#111", fillOpacity: 0.75 });
    if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) layer.bringToFront();
  }

  function resetDeptHighlight(e) {
    if (!deptLayer) return;
    deptLayer.resetStyle(e.target);
  }

  function onEachDept(feature, layer) {
    const props = feature?.properties || {};
    const name =
      props.nom ?? props.NOM ?? props.name ?? props.NAME ?? "";
    const codeRaw =
      props.code ?? props.CODE ?? props.dep ?? props.DEP ??
      props.insee ?? props.INSEE ?? props.code_dept ?? props.CODE_DEPT ?? "";
    const code = normalizeDeptCode(codeRaw);

    layer.on({
      mouseover: highlightDept,
      mouseout: resetDeptHighlight,
      click: () => {
        map.fitBounds(layer.getBounds(), { padding: [20, 20] });

        if (filterByDeptEnabled && code) {
          selectedDeptCode = (selectedDeptCode === code) ? null : code;
          closePanel();
          renderMarkers();
          updateDeptSelectedStat();
        }
      }
    });

    // Tooltip dynamique : nom + code + antenne + nb de projets filtrés
    const n = () => (lastCounts[code] || 0);
    const antenna = () => (deptCodeToAntenna[code] || "");
    layer.bindTooltip(() => {
      const tail = code ? ` (${code})` : "";
      const a = antenna();
      const aTxt = a ? ` — ${escapeHtml(a)}` : "";
      return `${escapeHtml(name)}${tail}${aTxt} — ${n()} projet(s)`;
    }, { sticky: true });
  }

  function loadDepartements() {
    return fetchJson(DEPTS_URL)
      .then((geo) => {
        deptGeo = geo;
        buildDeptNameMap(geo);

        deptLayer = L.geoJSON(geo, { style: styleDept, onEachFeature: onEachDept }).addTo(map);
        deptLayer.bringToBack();

        if (elLegend) elLegend.hidden = false;
      })
      .catch((err) => {
        console.error("Erreur chargement GeoJSON départements:", err);
        showStatus("Impossible de charger departements.geojson. Vérifiez le nom du fichier et son emplacement.");
      });
  }

  function updateDeptCountsAndStyle() {
    if (!deptLayer) return;
    deptLayer.setStyle(styleDept);
  }

  function updateDeptSelectedStat() {
    if (!elStatDept) return;
    if (filterByDeptEnabled && selectedDeptCode) {
      elStatDept.textContent = `— département: ${selectedDeptCode}`;
    } else {
      elStatDept.textContent = "";
    }
  }

  // ---- Fetch robuste ----
  async function fetchJson(url, { timeoutMs = 15000 } = {}) {
    showStatus(""); // clear
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort("timeout"), timeoutMs);

    try {
      const r = await fetch(url, {
        cache: "no-cache",
        headers: { "Accept": "application/json" },
        signal: ctrl.signal
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
      // GitHub raw peut contenir un BOM UTF-8 : JSON.parse le gère souvent, mais on sécurise.
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

  document.querySelectorAll(".typeFilter").forEach(cb => {
    cb.addEventListener("change", renderMarkers);
  });

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
      document.querySelectorAll(".typeFilter").forEach(cb => (cb.checked = true));
      selectedDeptCode = null;
      filterByDeptEnabled = false;
      if (elDeptClickFilter) elDeptClickFilter.checked = false;
      closePanel();
      updateDeptSelectedStat();
      renderMarkers();
    });
  }

  // ---- Load data ----
  (async () => {
    try {
      // départements d'abord (pour la map nom -> code)
      await loadDepartements();

      const data = await fetchJson(PROJECTS_URL);
      allProjects = Array.isArray(data?.projets) ? data.projets : (Array.isArray(data) ? data : []);
      renderMarkers();
    } catch (err) {
      console.error("Erreur chargement données:", err);
      showStatus("Impossible de charger export_projets_web.json. Vérifiez le nom du fichier et son emplacement.");
    }
  })();
})();

// Carte Projets — Leaflet + clustering + départements colorés par antenne
(() => {
  "use strict";

  // Affiche une erreur générique dans l'interface et garde le détail en console.
  window.addEventListener("error", (e) => {
    console.error("[BIMO] Erreur JavaScript", e.error || e.message || e);
    const el = document.getElementById("status");
    if (!el) return;
    el.textContent = "Une erreur est survenue pendant l’affichage de la carte. Consultez la console pour le détail technique.";
    el.hidden = false;
  });

  window.addEventListener("unhandledrejection", (e) => {
    console.error("[BIMO] Promesse rejetée", e.reason || e);
    const el = document.getElementById("status");
    if (!el) return;
    el.textContent = "Une erreur est survenue pendant le chargement des données. Consultez la console pour le détail technique.";
    el.hidden = false;
  });

  // ---- Configuration ----
  const DATA_VERSION = "2026-05-21b";
  const CURRENT_PROJECTS_URL = `export_projets_web.json?v=${encodeURIComponent(DATA_VERSION)}`;
  const COMPLETED_PROJECTS_URL = `export_projets_finis_web.json?v=${encodeURIComponent(DATA_VERSION)}`;
  const DEPTS_URL = `departements.geojson?v=${encodeURIComponent(DATA_VERSION)}`;

  const PROJECT_MODES = {
    current: {
      key: "current",
      title: "Carte des projets en cours du BIMO"
    },
    completed: {
      key: "completed",
      title: "Carte des projets finis du BIMO"
    }
  };
  let COMPLETED_YEAR_MIN = 2008;
  let COMPLETED_YEAR_MAX = 2024;

  // ---- DOM ----
  const elPageTitle = document.getElementById("pageTitle");
  const elQ = document.getElementById("q");
  const elClear = document.getElementById("clear");
  const elPanel = document.getElementById("panel");
  const elAntennaSummaryBtn = document.getElementById("antennaSummaryBtn");
  const elAntennaSummaryOverlay = document.getElementById("antennaSummaryOverlay");
  const elStatus = document.getElementById("status");
  const elLegend = document.getElementById("legend");
  const elLegendAntennas = document.getElementById("legendAntennas");
  const elCount = document.getElementById("statCount");
  const elStatLocated = document.getElementById("statLocated");
  const elStatDept = document.getElementById("statDept");
  const elProjListBtn = document.getElementById("projListBtn");
  const elProjectModeSwitch = document.getElementById("projectModeSwitch");
  const elProjectModeButtons = Array.from(document.querySelectorAll("[data-project-mode]"));
  const elProjListMenu = document.getElementById("projListMenu");
  const elProjListSearch = document.getElementById("projListSearch");
  const elProjListSort = document.getElementById("projListSort");
  const elProjListItems = document.getElementById("projListItems");
  const elAdvancedFiltersBtn = document.getElementById("advancedFiltersBtn");
  const elAdvancedFiltersPanel = document.getElementById("advancedFiltersPanel");
  const elAmountMin = document.getElementById("amountMin");
  const elAmountMax = document.getElementById("amountMax");
  const elPhaseFilter = document.getElementById("phaseFilter");
  const elClientFilter = document.getElementById("clientFilter");
  const elProgrammeFilter = document.getElementById("programmeFilter");
  const elThemeFilter = document.getElementById("themeFilter");
  const elDeptFilter = document.getElementById("deptFilter");
  const elPhotosFilter = document.getElementById("photosFilter");
  const elEnergyFilter = document.getElementById("energyFilter");
  let elCompletedYearFilter = null;
  let elCompletedYearRange = null;
  let elCompletedYearValue = null;
  let elCompletedShowAll = null;
  let elCompletedPlayBtn = null;
  let elCompletedYearStats = null;
  let elCompletedYearHistogram = null;


  // ---- State ----
  let allProjects = [];
  let projectsByMode = { current: [], completed: [] };
  let currentProjectMode = PROJECT_MODES.current.key;
  let completedYearFilter = COMPLETED_YEAR_MIN;
  let showAllCompletedProjects = false;
  let completedYearPlaybackTimer = null;
  let completedYearPlaybackActive = false;
  const COMPLETED_YEAR_PLAYBACK_STEP_MS = 2000;
  let deptLayer = null;
  let deptNameToCode = new Map(); // "haute savoie" -> "74"
  let deptCodeToAntenna = {}; // "74" -> "Alpes Centre-Est"
  let deptCodeToName = {}; // "74" -> "Haute-Savoie"
  let deptSpatialIndex = [];
  let filteredCounts = {}; // "74" -> nb projets filtrés (tooltip)
  let antennaSummaryEnabled = false;
  let cityLabelsEnabled = false;

  // Focus antenne (pour foncer les départements de l’antenne sélectionnée)
  let selectedAntenna = null;

  // Pin sélectionné (pour surligner/agrandir)
  let selectedMarker = null;
  let projectIdToMarker = new Map(); // "Code projet" -> Leaflet marker
  let projectIdToName = new Map();  // "Code projet" -> Nom du projet (tooltips clusters)
  let projectListDirty = true;
  let completedProjectsLoadFailed = false;
  let completedProjectsLoaded = false;
  let completedProjectsLoadPromise = null;
  let suppressProjectUrlUpdate = false;
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
    updateDeptSelectedStat();
  }

  function hasActiveFilters() {
    const hasSearch = !!(elQ && elQ.value.trim());
    const typeFilters = Array.from(document.querySelectorAll(".typeFilter"));
    const hasTypeFilter = typeFilters.some((cb) => !cb.checked);
    const hasAntennaFilter = !!selectedAntenna;
    const hasAdvancedFilter = hasActiveAdvancedFilters();
    const hasCompletedYearFilter = currentProjectMode === PROJECT_MODES.completed.key && !showAllCompletedProjects && completedYearFilter !== COMPLETED_YEAR_MIN;
    return hasSearch || hasTypeFilter || hasAntennaFilter || hasAdvancedFilter || hasCompletedYearFilter;
  }

  function updateClearButtonState() {
    if (!elClear) return;
    const active = hasActiveFilters();
    elClear.classList.toggle("is-active", active);
    elClear.setAttribute("aria-pressed", active ? "true" : "false");
    elClear.title = active ? "Des filtres sont actifs" : "Aucun filtre actif";
  }

  function clampCompletedYear(year) {
    const value = Number(year);
    if (!Number.isFinite(value)) return COMPLETED_YEAR_MIN;
    return Math.max(COMPLETED_YEAR_MIN, Math.min(COMPLETED_YEAR_MAX, Math.round(value)));
  }

  function updateCompletedPlaybackButtonUi() {
    if (!elCompletedPlayBtn) return;
    const label = completedYearPlaybackActive ? "Pause" : "Lecture automatique";
    elCompletedPlayBtn.classList.toggle("is-playing", completedYearPlaybackActive);
    elCompletedPlayBtn.setAttribute("aria-pressed", completedYearPlaybackActive ? "true" : "false");
    elCompletedPlayBtn.setAttribute("aria-label", label);
    elCompletedPlayBtn.setAttribute("title", label);
    elCompletedPlayBtn.innerHTML = completedYearPlaybackActive
      ? '<span class="playToggleIcon playToggleIcon--pause" aria-hidden="true"></span>'
      : '<span class="playToggleIcon playToggleIcon--play" aria-hidden="true"></span>';
  }

  function stopCompletedYearPlayback() {
    if (completedYearPlaybackTimer) {
      clearTimeout(completedYearPlaybackTimer);
      completedYearPlaybackTimer = null;
    }
    completedYearPlaybackActive = false;
    updateCompletedPlaybackButtonUi();
  }

  function queueCompletedYearPlaybackStep() {
    if (!completedYearPlaybackActive || currentProjectMode !== PROJECT_MODES.completed.key) return;

    if (completedYearFilter >= COMPLETED_YEAR_MAX) {
      stopCompletedYearPlayback();
      return;
    }

    completedYearPlaybackTimer = window.setTimeout(() => {
      completedYearPlaybackTimer = null;
      if (!completedYearPlaybackActive || currentProjectMode !== PROJECT_MODES.completed.key) return;

      const nextYear = Math.min(COMPLETED_YEAR_MAX, completedYearFilter + 1);
      setCompletedYearFilter(nextYear);

      if (nextYear >= COMPLETED_YEAR_MAX) {
        stopCompletedYearPlayback();
        return;
      }

      queueCompletedYearPlaybackStep();
    }, COMPLETED_YEAR_PLAYBACK_STEP_MS);
  }

  function startCompletedYearPlayback() {
    stopCompletedYearPlayback();

    if (currentProjectMode !== PROJECT_MODES.completed.key) return;

    if (showAllCompletedProjects) {
      setCompletedShowAll(false, { rerender: false });
    }

    completedYearPlaybackActive = true;
    updateCompletedPlaybackButtonUi();
    setCompletedYearFilter(COMPLETED_YEAR_MIN);

    if (COMPLETED_YEAR_MIN >= COMPLETED_YEAR_MAX) {
      stopCompletedYearPlayback();
      return;
    }

    queueCompletedYearPlaybackStep();
  }

  function toggleCompletedYearPlayback() {
    if (completedYearPlaybackActive) {
      stopCompletedYearPlayback();
      return;
    }

    startCompletedYearPlayback();
  }

  function createCompletedYearFilterUi() {
    if (!elProjectModeSwitch || elCompletedYearFilter) return;

    const wrap = document.createElement("div");
    wrap.id = "completedYearFilter";
    wrap.className = "completedYearFilter";
    wrap.hidden = true;
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML = `
      <div class="completedTimelineMain">
        <span class="completedYearFilterLabel">Présents en <strong id="completedYearValue" class="completedYearValue">${completedYearFilter}</strong></span>
        <div class="completedYearRangeWrap">
          <span class="completedYearBound" data-completed-bound="min">${COMPLETED_YEAR_MIN}</span>
          <input id="completedYearRange" class="completedYearRange" type="range" min="${COMPLETED_YEAR_MIN}" max="${COMPLETED_YEAR_MAX}" step="1" value="${completedYearFilter}" aria-label="Afficher les projets finis présents pendant cette année" />
          <span class="completedYearBound" data-completed-bound="max">${COMPLETED_YEAR_MAX}</span>
        </div>
        <label class="completedShowAll" for="completedShowAll">
          <input id="completedShowAll" class="completedShowAllInput" type="checkbox" />
          <span>Tout afficher</span>
        </label>
        <button id="completedYearPlayBtn" class="completedYearPlayBtn" type="button" aria-label="Lecture automatique" title="Lecture automatique">
          <span class="playToggleIcon playToggleIcon--play" aria-hidden="true"></span>
        </button>
      </div>
      <div id="completedYearStats" class="completedYearStats" aria-live="polite"></div>
      <div id="completedYearHistogram" class="completedYearHistogram" role="list" aria-label="Histogramme des projets finis par année"></div>
    `;

    elProjectModeSwitch.insertAdjacentElement("afterend", wrap);

    elCompletedYearFilter = wrap;
    elCompletedYearRange = wrap.querySelector("#completedYearRange");
    elCompletedYearValue = wrap.querySelector("#completedYearValue");
    elCompletedShowAll = wrap.querySelector("#completedShowAll");
    elCompletedPlayBtn = wrap.querySelector("#completedYearPlayBtn");
    elCompletedYearStats = wrap.querySelector("#completedYearStats");
    elCompletedYearHistogram = wrap.querySelector("#completedYearHistogram");

    elCompletedYearRange?.addEventListener("input", () => {
      setCompletedYearFilter(elCompletedYearRange.value);
    });

    elCompletedShowAll?.addEventListener("change", () => {
      setCompletedShowAll(elCompletedShowAll.checked);
    });

    elCompletedPlayBtn?.addEventListener("click", () => {
      toggleCompletedYearPlayback();
    });

    elCompletedYearHistogram?.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-year]");
      if (!btn) return;
      stopCompletedYearPlayback();
      if (showAllCompletedProjects) setCompletedShowAll(false, { rerender: false });
      setCompletedYearFilter(btn.getAttribute("data-year"));
    });

    updateCompletedPlaybackButtonUi();
  }

  function updateCompletedYearFilterUi() {
    const isCompletedMode = currentProjectMode === PROJECT_MODES.completed.key;

    if (elCompletedYearFilter) {
      elCompletedYearFilter.hidden = !isCompletedMode;
      elCompletedYearFilter.classList.toggle("is-visible", isCompletedMode);
      elCompletedYearFilter.classList.toggle("is-show-all", !!showAllCompletedProjects);
      elCompletedYearFilter.setAttribute("aria-hidden", isCompletedMode ? "false" : "true");
    }

    if (elCompletedYearRange) {
      elCompletedYearRange.min = String(COMPLETED_YEAR_MIN);
      elCompletedYearRange.max = String(COMPLETED_YEAR_MAX);
      elCompletedYearRange.value = String(completedYearFilter);
      elCompletedYearRange.disabled = !!showAllCompletedProjects;
    }

    if (elCompletedYearFilter) {
      const minBound = elCompletedYearFilter.querySelector('[data-completed-bound="min"]');
      const maxBound = elCompletedYearFilter.querySelector('[data-completed-bound="max"]');
      if (minBound) minBound.textContent = String(COMPLETED_YEAR_MIN);
      if (maxBound) maxBound.textContent = String(COMPLETED_YEAR_MAX);
    }

    if (elCompletedYearValue) {
      elCompletedYearValue.textContent = String(completedYearFilter);
    }

    if (elCompletedShowAll) {
      elCompletedShowAll.checked = !!showAllCompletedProjects;
      elCompletedShowAll.setAttribute("aria-checked", showAllCompletedProjects ? "true" : "false");
    }

    if (elCompletedPlayBtn) {
      elCompletedPlayBtn.disabled = !isCompletedMode;
    }

    updateCompletedPlaybackButtonUi();
    updateCompletedTimelineUi();
    syncToolbarControlHeights();
  }

  function syncToolbarControlHeights() {
    if (!elProjectModeSwitch) return;

    const referenceButton = elClear || elProjListBtn;
    const referenceHeight = Math.round(referenceButton?.getBoundingClientRect?.().height || 0);
    if (!referenceHeight) return;

    elProjectModeSwitch.style.height = `${referenceHeight}px`;
    elProjectModeSwitch.style.minHeight = `${referenceHeight}px`;
    elProjectModeSwitch.style.display = 'inline-grid';
    elProjectModeSwitch.style.gridTemplateColumns = '1fr 1fr';
    elProjectModeSwitch.style.alignItems = 'stretch';
    elProjectModeSwitch.style.justifyItems = 'stretch';
    elProjectModeSwitch.style.boxSizing = 'border-box';
    elProjectModeSwitch.style.overflow = 'hidden';

    const modeButtons = elProjectModeSwitch.querySelectorAll('.projectModeBtn');
    modeButtons.forEach((btn) => {
      btn.style.display = 'flex';
      btn.style.alignItems = 'center';
      btn.style.justifyContent = 'center';
      btn.style.alignSelf = 'stretch';
      btn.style.justifySelf = 'stretch';
      btn.style.width = '100%';
      btn.style.height = '100%';
      btn.style.minHeight = '100%';
      btn.style.margin = '0';
      btn.style.padding = '0 14px';
      btn.style.lineHeight = '1';
      btn.style.textAlign = 'center';
      btn.style.verticalAlign = 'middle';
      btn.style.boxSizing = 'border-box';
    });

    if (elCompletedYearFilter) {
      elCompletedYearFilter.style.height = "auto";
      elCompletedYearFilter.style.minHeight = `${referenceHeight}px`;
    }

    if (elCompletedPlayBtn) {
      const playButtonSize = Math.max(Math.round(referenceHeight * 0.9), 28);
      elCompletedPlayBtn.style.width = `${playButtonSize}px`;
      elCompletedPlayBtn.style.minWidth = `${playButtonSize}px`;
      elCompletedPlayBtn.style.height = `${playButtonSize}px`;
      elCompletedPlayBtn.style.minHeight = `${playButtonSize}px`;
    }
  }

  function setCompletedYearFilter(year, { rerender = true } = {}) {
    const nextYear = clampCompletedYear(year);
    const changed = nextYear !== completedYearFilter;
    completedYearFilter = nextYear;
    updateCompletedYearFilterUi();
    updateClearButtonState();

    if (!changed || !rerender || currentProjectMode !== PROJECT_MODES.completed.key || showAllCompletedProjects) return;

    closePanel();
    renderMarkers();
  }

  function setCompletedShowAll(value, { rerender = true } = {}) {
    const nextValue = !!value;
    const changed = nextValue !== showAllCompletedProjects;
    if (nextValue) stopCompletedYearPlayback();
    showAllCompletedProjects = nextValue;
    updateCompletedYearFilterUi();
    updateClearButtonState();

    if (!changed || !rerender || currentProjectMode !== PROJECT_MODES.completed.key) return;

    closePanel();
    renderMarkers();
  }


  function projectModeMeta(modeKey = currentProjectMode) {
    return PROJECT_MODES[modeKey] || PROJECT_MODES.current;
  }

  function updateProjectModeUi() {
    const meta = projectModeMeta();
    if (elPageTitle) elPageTitle.textContent = meta.title;
    document.title = meta.title;

    elProjectModeButtons.forEach((btn) => {
      const modeKey = btn.getAttribute("data-project-mode");
      const isActive = modeKey === currentProjectMode;
      const isCompleted = modeKey === PROJECT_MODES.completed.key;
      const isUnavailable = isCompleted && completedProjectsLoadFailed;
      const isLoading = isCompleted && !!completedProjectsLoadPromise;

      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      btn.disabled = isUnavailable || isLoading;
      btn.title = isUnavailable
        ? "Les projets finis n’ont pas pu être chargés."
        : (isLoading ? "Chargement des projets finis…" : "");
    });

    updateCompletedYearFilterUi();
  }

  function normalizeProjectsPayload(data) {
    if (Array.isArray(data?.projets)) return data.projets;
    if (Array.isArray(data)) return data;
    console.warn("[BIMO] Format de données projets inattendu :", data);
    return [];
  }

  function ensureProjectIds(projects, modeKey) {
    return projects.map((project, index) => {
      const source = project && typeof project === "object" ? project : {};
      const existingId = String(source["Code projet"] ?? source["ID"] ?? source.code_projet ?? source.codeProjet ?? source.id ?? "").trim();
      return {
        ...source,
        __projectMode: modeKey,
        __projectId: existingId || `${modeKey}-${index + 1}`
      };
    });
  }

  function reportProjectDataQuality(projects, modeKey) {
    if (!Array.isArray(projects) || !projects.length) return;

    const seenIds = new Set();
    const duplicateIds = new Set();
    let missingNames = 0;
    let missingCoordinates = 0;
    let completedWithoutDates = 0;

    for (const project of projects) {
      const pid = projectId(project);
      if (pid) {
        if (seenIds.has(pid)) duplicateIds.add(pid);
        seenIds.add(pid);
      }

      const name = String(project["Nom de projet"] ?? project.nom ?? "").trim();
      if (!name) missingNames += 1;
      if (!projectLatLon(project)) missingCoordinates += 1;
      if (modeKey === PROJECT_MODES.completed.key && projectStartYear(project) == null && projectEndYear(project) == null) {
        completedWithoutDates += 1;
      }
    }

    if (duplicateIds.size) {
      console.warn(`[BIMO] ${duplicateIds.size} identifiant(s) projet en doublon (${modeKey}) :`, Array.from(duplicateIds));
    }
    if (missingNames || missingCoordinates || completedWithoutDates) {
      console.info(`[BIMO] Qualité des données (${modeKey})`, {
        projets: projects.length,
        sansNom: missingNames,
        sansCoordonnees: missingCoordinates,
        finisSansDates: completedWithoutDates
      });
    }
  }

  function setActiveProjectsForMode(modeKey) {
    allProjects = Array.isArray(projectsByMode[modeKey]) ? projectsByMode[modeKey] : [];
    projectIdToName = new Map();
    for (const p of allProjects) {
      const pid = projectId(p);
      const nm = String(p["Nom de projet"] ?? p.nom ?? "").trim();
      if (pid) projectIdToName.set(pid, nm);
    }
  }

  async function ensureCompletedProjectsLoaded({ silent = false } = {}) {
    if (completedProjectsLoaded) return true;
    if (completedProjectsLoadFailed) return false;

    if (!completedProjectsLoadPromise) {
      if (!silent) showStatus("Chargement des projets finis…");

      completedProjectsLoadPromise = fetchJson(COMPLETED_PROJECTS_URL)
        .then((data) => {
          projectsByMode.completed = ensureProjectIds(normalizeProjectsPayload(data), PROJECT_MODES.completed.key);
          completedProjectsLoaded = true;
          completedProjectsLoadFailed = false;

          reportProjectDataQuality(projectsByMode.completed, PROJECT_MODES.completed.key);
          updateCompletedYearBounds();
          enrichProjectsWithDepartments(projectsByMode.completed);
          if (!silent) showStatus("");
          return true;
        })
        .catch((err) => {
          completedProjectsLoadFailed = true;
          projectsByMode.completed = [];
          console.warn("Impossible de charger les projets finis :", err);
          showStatus(`Les projets finis n’ont pas pu être chargés (${describeLoadError(err)}). Les projets en cours restent disponibles.`);
          return false;
        })
        .finally(() => {
          completedProjectsLoadPromise = null;
          updateProjectModeUi();
          window.setTimeout(() => {
            refreshAdvancedFilterOptions();
          }, 0);
        });

      updateProjectModeUi();
    }

    return completedProjectsLoadPromise;
  }

  async function setProjectMode(modeKey) {
    if (!PROJECT_MODES[modeKey] || modeKey === currentProjectMode) return;
    if (modeKey === PROJECT_MODES.completed.key) {
      const loaded = await ensureCompletedProjectsLoaded();
      if (!loaded || completedProjectsLoadFailed) {
        showStatus("Les projets finis sont indisponibles pour le moment.");
        updateProjectModeUi();
        return;
      }
    }

    stopCompletedYearPlayback();
    currentProjectMode = modeKey;
    selectedAntenna = null;
    updateDeptStyle();
    updateDeptSelectedStat();

    setProjectListOpen(false);

    closePanel();
    setActiveProjectsForMode(modeKey);
    updateProjectModeUi();
    renderMarkers();
    window.setTimeout(() => {
      refreshAdvancedFilterOptions();
    }, 0);
    updateClearButtonState();
  }

  // ---- Antennes / Couleurs ----
  const ANTENNA_COLORS = {
    "Atlantique Grand-Ouest": "#3B82F6",
    "Nord-Est": "#10B981",
    "Grand Sud-Ouest": "#F59E0B",
    "Alpes Centre-Est": "#8B5CF6",
    "Méditerranée Grand-Sud": "#36540e",
    "Nord-Ouest Île-de-France": "#EF4444"
  };

  const ANTENNA_LEGEND_ORDER = [
    "Alpes Centre-Est",
    "Atlantique Grand-Ouest",
    "Grand Sud-Ouest",
    "Méditerranée Grand-Sud",
    "Nord-Est",
    "Nord-Ouest Île-de-France"
  ];

  function renderLegendAntennas() {
    if (!elLegendAntennas) return;

    elLegendAntennas.innerHTML = ANTENNA_LEGEND_ORDER.map((antenna) => {
      const color = ANTENNA_COLORS[antenna] || "#FFFFFF";
      return `
        <div class="legend-row">
          <span class="swatch" style="background:${escapeAttr(color)};"></span>
          <span>${escapeHtml(antenna)}</span>
        </div>
      `;
    }).join("");
  }

  const PROJECT_TYPE_COLORS = {
    mom: "blue",
    amo: "red",
    exp: "green",
    other: "#09e6ed"
  };

  const ANTENNA_SUMMARY_PLACEMENTS = {
    // Chaque point sert de point d'accroche géographique Leaflet.
    // La classe "outside-*" fait partir l'encart vers l'extérieur de la France,
    // pour éviter qu'il recouvre les départements de son antenne.
    "Nord-Ouest Île-de-France": { point: [49.72, -1.95], align: "outside-west" },
    "Nord-Est": { point: [48.95, 8.15], align: "outside-east" },
    "Atlantique Grand-Ouest": { point: [47.05, -4.75], align: "outside-west" },
    "Alpes Centre-Est": { point: [45.35, 7.75], align: "outside-east" },
    "Grand Sud-Ouest": { point: [44.05, -2.55], align: "outside-west" },
    "Méditerranée Grand-Sud": { point: [42.85, 6.30], align: "outside-south" }
  };

  function syncProjectTypeLegendColors() {
    if (!elLegend) return;

    const rows = Array.from(elLegend.querySelectorAll(".legend-row"));
    for (const row of rows) {
      const swatch = row.querySelector(".pin-swatch");
      if (!swatch) continue;

      const text = normalizeForLookup(row.textContent || "");
      let color = "";
      if (text.includes("mom")) color = PROJECT_TYPE_COLORS.mom;
      else if (text.includes("amo")) color = PROJECT_TYPE_COLORS.amo;
      else if (text.includes("exp")) color = PROJECT_TYPE_COLORS.exp;
      else if (text.includes("autre")) color = PROJECT_TYPE_COLORS.other;

      if (color) swatch.style.borderColor = color;
    }
  }

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

  const DEPT_TO_ANTENNA_BY_CODE = {
    "01": "Alpes Centre-Est", "03": "Alpes Centre-Est", "07": "Alpes Centre-Est", "15": "Alpes Centre-Est", "21": "Alpes Centre-Est", "26": "Alpes Centre-Est", "38": "Alpes Centre-Est", "39": "Alpes Centre-Est", "42": "Alpes Centre-Est", "43": "Alpes Centre-Est", "58": "Alpes Centre-Est", "63": "Alpes Centre-Est", "69": "Alpes Centre-Est", "71": "Alpes Centre-Est", "73": "Alpes Centre-Est", "74": "Alpes Centre-Est", "89": "Alpes Centre-Est",
    "16": "Atlantique Grand-Ouest", "17": "Atlantique Grand-Ouest", "22": "Atlantique Grand-Ouest", "29": "Atlantique Grand-Ouest", "35": "Atlantique Grand-Ouest", "36": "Atlantique Grand-Ouest", "37": "Atlantique Grand-Ouest", "41": "Atlantique Grand-Ouest", "44": "Atlantique Grand-Ouest", "49": "Atlantique Grand-Ouest", "53": "Atlantique Grand-Ouest", "56": "Atlantique Grand-Ouest", "72": "Atlantique Grand-Ouest", "79": "Atlantique Grand-Ouest", "85": "Atlantique Grand-Ouest", "86": "Atlantique Grand-Ouest",
    "09": "Grand Sud-Ouest", "11": "Grand Sud-Ouest", "12": "Grand Sud-Ouest", "19": "Grand Sud-Ouest", "23": "Grand Sud-Ouest", "24": "Grand Sud-Ouest", "31": "Grand Sud-Ouest", "32": "Grand Sud-Ouest", "33": "Grand Sud-Ouest", "40": "Grand Sud-Ouest", "46": "Grand Sud-Ouest", "47": "Grand Sud-Ouest", "64": "Grand Sud-Ouest", "65": "Grand Sud-Ouest", "66": "Grand Sud-Ouest", "81": "Grand Sud-Ouest", "82": "Grand Sud-Ouest", "87": "Grand Sud-Ouest",
    "04": "Méditerranée Grand-Sud", "05": "Méditerranée Grand-Sud", "06": "Méditerranée Grand-Sud", "13": "Méditerranée Grand-Sud", "2A": "Méditerranée Grand-Sud", "2B": "Méditerranée Grand-Sud", "30": "Méditerranée Grand-Sud", "34": "Méditerranée Grand-Sud", "48": "Méditerranée Grand-Sud", "83": "Méditerranée Grand-Sud", "84": "Méditerranée Grand-Sud",
    "08": "Nord-Est", "10": "Nord-Est", "25": "Nord-Est", "51": "Nord-Est", "52": "Nord-Est", "54": "Nord-Est", "55": "Nord-Est", "57": "Nord-Est", "67": "Nord-Est", "68": "Nord-Est", "70": "Nord-Est", "88": "Nord-Est", "90": "Nord-Est",
    "02": "Nord-Ouest Île-de-France", "14": "Nord-Ouest Île-de-France", "18": "Nord-Ouest Île-de-France", "27": "Nord-Ouest Île-de-France", "28": "Nord-Ouest Île-de-France", "45": "Nord-Ouest Île-de-France", "50": "Nord-Ouest Île-de-France", "59": "Nord-Ouest Île-de-France", "60": "Nord-Ouest Île-de-France", "61": "Nord-Ouest Île-de-France", "62": "Nord-Ouest Île-de-France", "75": "Nord-Ouest Île-de-France", "76": "Nord-Ouest Île-de-France", "77": "Nord-Ouest Île-de-France", "78": "Nord-Ouest Île-de-France", "80": "Nord-Ouest Île-de-France", "91": "Nord-Ouest Île-de-France", "92": "Nord-Ouest Île-de-France", "93": "Nord-Ouest Île-de-France", "94": "Nord-Ouest Île-de-France", "95": "Nord-Ouest Île-de-France"
  };

  const OVERSEAS_AREA_RULES = [
    {
      code: "971",
      name: "Guadeloupe",
      matches: ({ cityBlob, allBlob, lat, lon }) =>
        cityBlob.includes("guadeloupe") || allBlob.includes("guadeloupe") ||
        (lat >= 15.75 && lat <= 16.55 && lon >= -61.9 && lon <= -60.95)
    },
    {
      code: "972",
      name: "Martinique",
      matches: ({ cityBlob, allBlob, lat, lon }) =>
        cityBlob.includes("martinique") || allBlob.includes("martinique") ||
        (lat >= 14.25 && lat <= 15.05 && lon >= -61.35 && lon <= -60.75)
    },
    {
      code: "973",
      name: "Guyane",
      matches: ({ cityBlob, allBlob, lat, lon }) =>
        cityBlob.includes("guyane") || allBlob.includes("guyane") ||
        (lat >= 1.8 && lat <= 6.1 && lon >= -54.75 && lon <= -51.4)
    },
    {
      code: "974",
      name: "La Réunion",
      matches: ({ cityBlob, allBlob, lat, lon }) =>
        cityBlob.includes("reunion") || cityBlob.includes("la reunion") || allBlob.includes("reunion") ||
        (lat >= -21.45 && lat <= -20.8 && lon >= 55.15 && lon <= 55.95)
    },
    {
      code: "975",
      name: "Saint-Pierre-et-Miquelon",
      matches: ({ cityBlob, allBlob, lat, lon }) =>
        cityBlob.includes("saint pierre et miquelon") || allBlob.includes("saint pierre et miquelon") ||
        (lat >= 46.7 && lat <= 47.25 && lon >= -56.55 && lon <= -56.05)
    },
    {
      code: "976",
      name: "Mayotte",
      matches: ({ cityBlob, allBlob, lat, lon }) =>
        cityBlob.includes("mayotte") || allBlob.includes("mayotte") ||
        (lat >= -13.2 && lat <= -12.45 && lon >= 45.0 && lon <= 45.35)
    }
  ];

  // ---- Map ----
  if (!window.L || typeof L.map !== "function" || typeof L.markerClusterGroup !== "function") {
    showStatus("Erreur : Leaflet ou MarkerCluster n’est pas chargé. Vérifiez la connexion ou les dépendances CDN.");
    return;
  }

  const mapEl = document.getElementById("map");
  if (!mapEl) {
    showStatus("Erreur : conteneur de carte introuvable.");
    return;
  }

  const map = L.map(mapEl, {
    preferCanvas: true,
    zoomControl: false,
    zoomSnap: 0.1,
    zoomDelta: 0.25,
    wheelPxPerZoomLevel: 120
  }).setView([46.8, 2.5], 6);

  // Bounds France métropolitaine (approx.) — utilisé pour "dézoomer" à la fermeture du panneau
  const FRANCE_BOUNDS = L.latLngBounds([[41.0, -5.5], [51.6, 9.8]]);

  // Vue dédiée au mode Synthèse : un peu plus large que la France,
  // pour laisser les encarts visibles autour des antennes comme dans la maquette.
  const ANTENNA_SUMMARY_BOUNDS = L.latLngBounds([[41.0, -6.15], [51.55, 10.35]]);

  function zoomToFrance() {
    // Animation douce (au lieu d'une "téléportation")
    if (typeof map.flyToBounds === "function") {
      map.flyToBounds(FRANCE_BOUNDS, { padding: [20, 20], duration: 0.6 });
    } else {
      map.fitBounds(FRANCE_BOUNDS, { padding: [20, 20] });
    }
  }

  function zoomToAntennaSummaryView() {
    if (typeof map.flyToBounds === "function") {
      map.flyToBounds(ANTENNA_SUMMARY_BOUNDS, { padding: [18, 18], duration: 0.7 });
    } else {
      map.fitBounds(ANTENNA_SUMMARY_BOUNDS, { padding: [18, 18] });
    }
  }
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19
  }).addTo(map);

  if (map.attributionControl && typeof map.attributionControl.setPrefix === "function") {
    map.attributionControl.setPrefix("Carte créée par Hugo TONINI");
  }

  function createZoomSliderControl() {
    const zoomSliderControl = L.control({ position: "topleft" });

    zoomSliderControl.onAdd = () => {
      const container = L.DomUtil.create("div", "bimoZoomSlider leaflet-bar");
      container.setAttribute("aria-label", "Contrôle de zoom");

      const zoomIn = L.DomUtil.create("button", "bimoZoomSliderBtn bimoZoomSliderBtn--plus", container);
      zoomIn.type = "button";
      zoomIn.textContent = "+";
      zoomIn.setAttribute("aria-label", "Zoomer");

      const range = L.DomUtil.create("input", "bimoZoomSliderRange", container);
      range.type = "range";
      range.min = String(map.getMinZoom());
      range.max = String(map.getMaxZoom());
      range.step = "0.1";
      range.value = String(map.getZoom());
      range.setAttribute("aria-label", "Niveau de zoom de la carte");

      const zoomOut = L.DomUtil.create("button", "bimoZoomSliderBtn bimoZoomSliderBtn--minus", container);
      zoomOut.type = "button";
      zoomOut.textContent = "−";
      zoomOut.setAttribute("aria-label", "Dézoomer");

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      const clampZoom = (zoom) => {
        const minZoom = map.getMinZoom();
        const maxZoom = map.getMaxZoom();
        return Math.max(minZoom, Math.min(maxZoom, zoom));
      };

      const setPreciseZoom = (zoom) => {
        const nextZoom = clampZoom(Number(zoom));
        if (!Number.isFinite(nextZoom)) return;
        map.setZoom(nextZoom);
        range.value = String(nextZoom);
      };

      const stepZoom = (delta) => {
        setPreciseZoom(map.getZoom() + delta);
      };

      const syncRange = () => {
        range.min = String(map.getMinZoom());
        range.max = String(map.getMaxZoom());
        range.value = String(map.getZoom());
      };

      range.addEventListener("input", () => {
        setPreciseZoom(range.value);
      });

      zoomIn.addEventListener("click", () => stepZoom(0.25));
      zoomOut.addEventListener("click", () => stepZoom(-0.25));

      map.on("zoomend zoomlevelschange", syncRange);
      map.whenReady(syncRange);

      return container;
    };

    zoomSliderControl.addTo(map);
  }

  createZoomSliderControl();

  const clusters = L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 10,
    spiderfyOnMaxZoom: true,
    maxClusterRadius: 10,
    spiderfyDistanceMultiplier: 3.5,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    iconCreateFunction: (cluster) => {
      const children = cluster.getAllChildMarkers();
      const types = new Set(children.map(m => (m.options && m.options.__bimoType) ? m.options.__bimoType : ""));
      const count = cluster.getChildCount();

      // Si plusieurs types => couleur "Autres", sinon couleur du type
      let col = PROJECT_TYPE_COLORS.other;
      if (types.size === 1) {
        const only = types.values().next().value;
        col = only || PROJECT_TYPE_COLORS.other;
      }

      return L.divIcon({
        className: "pin-dot pin-dot-cluster-wrap",
        html: `<div class="pin-dot-inner pin-dot-cluster" style="border-color:${col};"><span class="pin-dot-count">${count}</span></div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });
    }
  });

  map.addLayer(clusters);

  const antennaSummaryLayer = L.layerGroup().addTo(map);

  const cityLabelsOverlay = document.createElement("div");
  cityLabelsOverlay.id = "cityLabelsOverlay";
  cityLabelsOverlay.className = "cityLabelsOverlay";
  cityLabelsOverlay.setAttribute("aria-hidden", "true");
  mapEl.appendChild(cityLabelsOverlay);

  const cityLabelsSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  cityLabelsSvg.classList.add("cityLabelsSvg");
  cityLabelsSvg.setAttribute("aria-hidden", "true");
  cityLabelsOverlay.appendChild(cityLabelsSvg);

  const cityLabelsHtml = document.createElement("div");
  cityLabelsHtml.className = "cityLabelsHtml";
  cityLabelsOverlay.appendChild(cityLabelsHtml);

  function ensureCityLabelStyles() {
    if (document.getElementById("bimoCityLabelStyles")) return;

    const style = document.createElement("style");
    style.id = "bimoCityLabelStyles";
    style.textContent = `
      .cityLabelsOverlay {
        position: absolute;
        inset: 0;
        z-index: 675;
        pointer-events: none;
        overflow: hidden;
      }
      .cityLabelsSvg,
      .cityLabelsHtml {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
      .cityLabelsSvg {
        overflow: hidden;
      }
      .cityLabelsSvg line {
        stroke: rgba(15, 23, 42, 0.62);
        stroke-width: 1.5;
        stroke-linecap: round;
        stroke-dasharray: 3 3;
        vector-effect: non-scaling-stroke;
      }
      .officesToggle,
      .cityLabelsToggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin: 0;
        padding: 0;
        vertical-align: middle;
        line-height: 1;
      }
      .officesToggle input,
      .cityLabelsToggle input {
        display: inline-block;
        width: 13px;
        height: 13px;
        margin: 0;
        padding: 0;
        vertical-align: middle;
        accent-color: #000080;
      }
      .officesToggle span,
      .cityLabelsToggle span {
        display: inline-flex;
        align-items: center;
        line-height: 1;
        padding-top: 0;
        margin-top: 0;
      }
      .projectModeSwitch {
        display: inline-grid !important;
        grid-template-columns: 1fr 1fr !important;
        align-items: stretch !important;
        justify-items: stretch !important;
        box-sizing: border-box;
        overflow: hidden;
      }
      .projectModeBtn {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        align-self: stretch !important;
        justify-self: stretch !important;
        width: 100% !important;
        height: 100% !important;
        min-height: 100% !important;
        box-sizing: border-box !important;
        margin: 0 !important;
        padding: 0 14px !important;
        line-height: 1 !important;
        text-align: center !important;
        vertical-align: middle !important;
      }
      .cityLabel {
        position: absolute;
        left: 0;
        top: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        max-width: 240px;
        padding: 4px 9px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.96);
        color: #111827;
        border: 1px solid rgba(15, 23, 42, 0.18);
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.24);
        font-size: 12px;
        line-height: 1.15;
        font-weight: 800;
        letter-spacing: 0.01em;
        white-space: nowrap;
        text-align: center;
        text-transform: none;
      }
    `;
    document.head.appendChild(style);
  }
  ensureCityLabelStyles();


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
    html += `<div class="panelHeader panelHeader--office">`;
    html += `<h2 class="panelTitle panelTitle--office">${escapeHtml(title)}</h2>`;
    html += `<div class="panelActions">`;
    html += `<button id="panelPrint" class="panelPrint" type="button" aria-label="Imprimer cette fiche">Imprimer</button>`;
    html += `<button id="panelClose" class="panelClose" type="button" aria-label="Fermer">✕</button>`;
    html += `</div>`;
    html += `</div>`;
    html += buildKv(fields);

    if (o.type_lieu === "antenne" && o.antenne) {
      const antennaProjects = getProjectsForAntenna(o.antenne);
      html += `<div class="panelSubTitle panelSubTitle--office">Projets</div>`;

      if (antennaProjects.length) {
        html += `<div class="officeProjectsList">`;
        html += antennaProjects.map((p) => {
          const pid = projectId(p);
          const name = String(p["Nom de projet"] ?? p.nom ?? "Projet").trim() || "Projet";
          const typ = String(p["Type de projet"] ?? p.type ?? "—").trim() || "—";
          const city = projectCity(p) || "—";
          return `
            <button class="officeProjectItem" type="button" data-project-id="${escapeAttr(pid)}">
              <span class="officeProjectName">${escapeHtml(name)}</span>
              <span class="officeProjectMeta">${escapeHtml(typ)} — ${escapeHtml(city)}</span>
            </button>`;
        }).join("");
        html += `</div>`;
      } else {
        html += `<div class="officeProjectsEmpty">Aucun projet rattaché à cette antenne.</div>`;
      }
    }

    openPanel(html);

    elPanel?.querySelectorAll(".officeProjectItem").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pid = btn.getAttribute("data-project-id");
        if (!pid) return;
        const p = allProjects.find((x) => projectId(x) === pid);
        if (p) openProjectFromData(p);
      });
    });

    const btn = document.getElementById("panelClose");
    if (btn) btn.addEventListener("click", () => closePanel({ resetView: true }), { once: true });

    const printBtn = document.getElementById("panelPrint");
    if (printBtn) {
      printBtn.addEventListener("click", () => {
        closeLightbox();
        const previousTitle = document.title;
        document.title = String(title || previousTitle);
        window.print();
        window.setTimeout(() => {
          document.title = previousTitle;
        }, 100);
      });
    }
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
          updateDeptSelectedStat();
          renderMarkers(); // n'afficher que les projets de l'antenne
        } else {
          clearAntennaFocus();
          renderMarkers(); // ré-afficher tous les projets
        }

        updateClearButtonState();
        showOfficePanel(o);
      });

      officesLayer.addLayer(marker);
    }
  }


  function initCityLabelsToggle(afterElement) {
    if (document.getElementById("cityLabelsToggle")) {
      scheduleCityLabelsRender();
      return;
    }

    const wrap = document.createElement("label");
    wrap.className = "toggle cityLabelsToggle";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = "cityLabelsToggle";
    cb.className = "cityLabelsToggleInput";
    cb.checked = false;

    const span = document.createElement("span");
    span.textContent = "Noms des villes";

    wrap.appendChild(cb);
    wrap.appendChild(span);

    if (afterElement?.insertAdjacentElement) {
      afterElement.insertAdjacentElement("afterend", wrap);
    } else {
      const typeFilters = Array.from(document.querySelectorAll(".typeFilter"));
      const last = typeFilters[typeFilters.length - 1];
      const host = last?.closest("label")?.parentElement || last?.parentElement || last;
      if (host?.appendChild) host.appendChild(wrap);
    }

    cityLabelsEnabled = false;
    clearCityLabels();

    cb.addEventListener("change", () => {
      cityLabelsEnabled = !!cb.checked;
      if (cityLabelsEnabled) {
        scheduleCityLabelsRender();
      } else {
        clearCityLabels();
      }
    });
  }

  function initOfficesToggle() {
    // On insère un toggle à côté des filtres de type (MOM/AMO/EXP) si possible
    const typeFilters = Array.from(document.querySelectorAll(".typeFilter"));
    if (!typeFilters.length) {
      initCityLabelsToggle(null);
      renderOffices();
      return;
    }
    const last = typeFilters[typeFilters.length - 1];
    const host = last.closest("label")?.parentElement || last.parentElement || last;

    // Eviter de doubler si le script est chargé deux fois
    if (document.getElementById("officesToggle")) {
      initCityLabelsToggle(document.getElementById("officesToggle")?.closest("label"));
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
    initCityLabelsToggle(wrap);

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

  function describeLoadError(err) {
    if (err?.name === "AbortError") return "délai de chargement dépassé";
    const message = String(err?.message || err || "erreur inconnue").trim();
    if (!message) return "erreur inconnue";
    return message.replace(/\?.*?(?=\s|$)/g, "");
  }

  function setProjectListOpen(open, { focusSearch = false } = {}) {
    if (!elProjListMenu) return;
    const isOpen = !!open;
    elProjListMenu.hidden = !isOpen;
    if (elProjListBtn) elProjListBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");

    if (isOpen) {
      if (projectListDirty) buildProjectList();
      if (focusSearch) elProjListSearch?.focus();
    }
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
    const cleaned = s.replace(/\s/g, "").replace(/€/g, "").replace(/,/g, ".");
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

  function formatMillionEuro(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "";

    const millions = n / 1000000;
    const formatted = new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: millions < 10 ? 1 : 0,
      maximumFractionDigits: 1
    }).format(millions);

    return `${formatted} M€`;
  }

  function projectTypeKey(p) {
    const t = projectType(p);
    if (t.includes("mom")) return "mom";
    if (t.includes("amo")) return "amo";
    if (t.includes("exp")) return "exp";
    return "other";
  }

  function getActiveSummaryTypes() {
    return Array.from(document.querySelectorAll(".typeFilter:checked"))
      .map((x) => String(x.value || "").toLowerCase().trim())
      .filter((value) => ["mom", "amo", "exp"].includes(value));
  }

  function setAntennaSummaryEnabled(enabled, { adjustView = false } = {}) {
    antennaSummaryEnabled = !!enabled;
    if (elAntennaSummaryBtn) {
      elAntennaSummaryBtn.classList.toggle("is-active", antennaSummaryEnabled);
      elAntennaSummaryBtn.setAttribute("aria-pressed", antennaSummaryEnabled ? "true" : "false");
    }
    renderAntennaSummary();

    if (antennaSummaryEnabled && adjustView) {
      closePanel();
      window.setTimeout(zoomToAntennaSummaryView, 40);
    }
  }

  function renderAntennaSummary() {
    if (!elAntennaSummaryOverlay) return;

    // L'ancien conteneur HTML reste présent pour l’accessibilité et les messages,
    // mais les encarts sont maintenant des marqueurs Leaflet : ils bougent avec la carte.
    elAntennaSummaryOverlay.hidden = !antennaSummaryEnabled;
    elAntennaSummaryOverlay.classList.toggle("is-visible", antennaSummaryEnabled);
    antennaSummaryLayer.clearLayers();

    if (!antennaSummaryEnabled) {
      elAntennaSummaryOverlay.innerHTML = "";
      scheduleCityLabelsRender();
      return;
    }

    const activeTypes = getActiveSummaryTypes();
    if (!activeTypes.length) {
      elAntennaSummaryOverlay.innerHTML = `<div class="antennaSummaryEmpty">Cochez au moins un type de projet.</div>`;
      scheduleCityLabelsRender();
      return;
    }

    elAntennaSummaryOverlay.innerHTML = "";

    const activeTypeSet = new Set(activeTypes);
    const summaries = new Map();
    for (const antenna of ANTENNA_LEGEND_ORDER) {
      summaries.set(antenna, { mom: 0, amo: 0, exp: 0, momAmount: 0 });
    }

    for (const project of filteredProjectsForAntennaSummary()) {
      const antenna = String(project["Antenne"] ?? project.antenne ?? "").trim();
      if (!summaries.has(antenna)) continue;

      const typeKey = projectTypeKey(project);
      if (!activeTypeSet.has(typeKey)) continue;

      const summary = summaries.get(antenna);
      summary[typeKey] += 1;
      if (typeKey === "mom") {
        const amount = amountNumber(project["Montant"] ?? project.montant);
        if (Number.isFinite(amount)) summary.momAmount += amount;
      }
    }

    const typeLabels = { mom: "MOM", amo: "AMO", exp: "EXP" };
    let visibleCards = 0;

    for (const antenna of ANTENNA_LEGEND_ORDER) {
      const summary = summaries.get(antenna);
      const lines = activeTypes
        .map((typeKey) => {
          const count = summary[typeKey] || 0;
          if (!count) return "";
          if (typeKey === "mom") {
            const amount = formatMillionEuro(summary.momAmount);
            return amount
              ? `${count} MOM pour ${escapeHtml(amount)}`
              : `${count} MOM`;
          }
          return `${count} ${typeLabels[typeKey]}`;
        })
        .filter(Boolean);

      if (!lines.length) continue;

      const placement = ANTENNA_SUMMARY_PLACEMENTS[antenna];
      if (!placement?.point) continue;

      visibleCards += 1;
      const color = ANTENNA_COLORS[antenna] || "#fff";
      const isSelected = selectedAntenna === antenna;
      const title = antenna === "Nord-Ouest Île-de-France" ? "Nord-Ouest<br>Île-de-France" : escapeHtml(antenna);
      const alignClass = `antennaSummaryCard--${placement.align || "outside-center"}`;
      const html = `
        <button class="antennaSummaryCard antennaSummaryCard--map ${alignClass}${isSelected ? " is-selected" : ""}" type="button" style="--summary-color:${escapeAttr(color)};" data-antenna="${escapeAttr(antenna)}" aria-label="Filtrer sur ${escapeAttr(antenna)}">
          <span class="antennaSummaryTitle">${title} :</span>
          ${lines.map((line) => `<span class="antennaSummaryLine">${line}</span>`).join("")}
        </button>
      `;

      const marker = L.marker(placement.point, {
        interactive: true,
        keyboard: true,
        icon: L.divIcon({
          className: "antennaSummaryMarker",
          html,
          iconSize: null
        })
      });

      marker.on("add", () => {
        const el = marker.getElement();
        if (el) {
          L.DomEvent.disableClickPropagation(el);
          L.DomEvent.disableScrollPropagation(el);
        }
      });

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        selectedAntenna = selectedAntenna === antenna ? null : antenna;
        closePanel();
        updateDeptStyle();
        updateDeptSelectedStat();
        renderMarkers();
      });

      antennaSummaryLayer.addLayer(marker);
    }

    if (!visibleCards) {
      elAntennaSummaryOverlay.innerHTML = `<div class="antennaSummaryEmpty">Aucun projet pour les filtres sélectionnés.</div>`;
    }

    scheduleCityLabelsRender();
  }


  function rectsOverlap(a, b, margin = 0) {
    return !(
      a.right + margin < b.left ||
      a.left - margin > b.right ||
      a.bottom + margin < b.top ||
      a.top - margin > b.bottom
    );
  }

  function rectInsideMap(rect, width, height, padding = 4) {
    return (
      rect.left >= padding &&
      rect.top >= padding &&
      rect.right <= width - padding &&
      rect.bottom <= height - padding
    );
  }

  function getElementRectInMap(element) {
    if (!element || !mapEl) return null;

    const mapRect = mapEl.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    return {
      left: rect.left - mapRect.left,
      top: rect.top - mapRect.top,
      right: rect.right - mapRect.left,
      bottom: rect.bottom - mapRect.top,
      width: rect.width,
      height: rect.height
    };
  }

  function getAntennaSummaryRects() {
    if (!antennaSummaryEnabled) return [];

    const rects = [];
    document.querySelectorAll(".antennaSummaryCard, .antennaSummaryMarker, .antennaSummaryEmpty").forEach((element) => {
      const rect = getElementRectInMap(element);
      if (rect) rects.push(rect);
    });

    return rects;
  }

  function makeRect(left, top, width, height) {
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height
    };
  }

  function setCityLabelsOverlaySize() {
    if (!cityLabelsOverlay || !cityLabelsSvg) return { width: 0, height: 0 };

    const size = map.getSize();
    cityLabelsSvg.setAttribute("width", String(size.x));
    cityLabelsSvg.setAttribute("height", String(size.y));
    cityLabelsSvg.setAttribute("viewBox", `0 0 ${size.x} ${size.y}`);
    return { width: size.x, height: size.y };
  }

  function clearCityLabels() {
    if (cityLabelsHtml) cityLabelsHtml.innerHTML = "";
    if (cityLabelsSvg) cityLabelsSvg.replaceChildren();
    if (cityLabelsOverlay) cityLabelsOverlay.hidden = true;
  }

  function renderCityLabels() {
    if (!cityLabelsOverlay || !cityLabelsHtml || !cityLabelsSvg) return;

    setCityLabelsOverlaySize();
    cityLabelsHtml.innerHTML = "";
    cityLabelsSvg.replaceChildren();

    if (!cityLabelsEnabled) {
      cityLabelsOverlay.hidden = true;
      return;
    }

    cityLabelsOverlay.hidden = false;

    const projects = filteredProjects()
      .map((project) => ({
        project,
        city: projectCity(project),
        ll: projectLatLon(project)
      }))
      .filter((entry) => entry.city && entry.ll);

    if (!projects.length) return;

    const groups = new Map();

    for (const entry of projects) {
      const key = normalizeForLookup(entry.city);
      if (!key) continue;

      if (!groups.has(key)) {
        groups.set(key, {
          city: entry.city,
          points: [],
          anchor: entry.ll
        });
      }

      const group = groups.get(key);
      group.points.push(entry.ll);

      const currentPoint = map.latLngToContainerPoint(group.anchor);
      const candidatePoint = map.latLngToContainerPoint(entry.ll);

      // Le pin le plus haut visuellement devient l'ancre du nom de ville.
      if (candidatePoint.y < currentPoint.y) {
        group.anchor = entry.ll;
      }
    }

    const { width: mapWidth, height: mapHeight } = setCityLabelsOverlaySize();

    const blockedRects = getAntennaSummaryRects();

    // Les pins eux-mêmes sont des zones interdites pour les textes.
    for (const entry of projects) {
      const pt = map.latLngToContainerPoint(entry.ll);
      blockedRects.push(makeRect(pt.x - 14, pt.y - 14, 28, 28));
    }

    const cityGroups = Array.from(groups.values())
      .sort((a, b) => {
        const pa = map.latLngToContainerPoint(a.anchor);
        const pb = map.latLngToContainerPoint(b.anchor);
        return pa.y - pb.y || a.city.localeCompare(b.city, "fr", { sensitivity: "base" });
      });

    // Création invisible d'abord pour mesurer la vraie largeur du libellé.
    const measured = cityGroups.map((group) => {
      const el = document.createElement("div");
      el.className = "cityLabel";
      el.textContent = group.city;
      el.style.visibility = "hidden";
      el.style.transform = "translate(-9999px, -9999px)";
      cityLabelsHtml.appendChild(el);

      const rect = el.getBoundingClientRect();
      return {
        group,
        el,
        width: Math.ceil(Math.min(rect.width || 80, 240)),
        height: Math.ceil(rect.height || 25)
      };
    });

    const placedRects = [];

    function buildPlacementCandidates(labelWidth, labelHeight) {
      const halfW = Math.round(labelWidth / 2);
      const halfH = Math.round(labelHeight / 2);

      // Écart minimal pour ne pas recouvrir le cercle du pin.
      // Visuellement, le nom reste très proche du pin.
      const aboveY = -(halfH + 17);
      const belowY = halfH + 17;
      const sideX = halfW + 17;
      const sideY = 0;

      // Priorité naturelle :
      // 1) au-dessus, 2) au-dessus décalé, 3) droite/gauche,
      // 4) dessous, 5) seulement après : placements plus éloignés avec trait.
      const direct = [
        [0, aboveY],
        [Math.round(halfW * 0.25), aboveY],
        [-Math.round(halfW * 0.25), aboveY],
        [Math.round(halfW * 0.45), aboveY],
        [-Math.round(halfW * 0.45), aboveY],
        [Math.round(halfW * 0.65), aboveY - 2],
        [-Math.round(halfW * 0.65), aboveY - 2],

        [sideX, sideY],
        [-sideX, sideY],
        [sideX, -Math.round(halfH * 0.7)],
        [-sideX, -Math.round(halfH * 0.7)],

        [0, belowY],
        [Math.round(halfW * 0.25), belowY],
        [-Math.round(halfW * 0.25), belowY],
        [Math.round(halfW * 0.45), belowY],
        [-Math.round(halfW * 0.45), belowY],
        [sideX, Math.round(halfH * 0.8)],
        [-sideX, Math.round(halfH * 0.8)]
      ];

      // Ces positions restent proches mais méritent un trait discret,
      // car le lien au pin devient moins évident.
      const nearbyWithLeader = [
        [Math.round(halfW * 0.75), aboveY - 8],
        [-Math.round(halfW * 0.75), aboveY - 8],
        [sideX + 18, -Math.round(halfH * 0.25)],
        [-(sideX + 18), -Math.round(halfH * 0.25)],
        [sideX + 18, Math.round(halfH * 0.7)],
        [-(sideX + 18), Math.round(halfH * 0.7)],
        [Math.round(halfW * 0.65), belowY + 8],
        [-Math.round(halfW * 0.65), belowY + 8],
        [0, aboveY - 18],
        [0, belowY + 18]
      ];

      // Dernier recours uniquement.
      const fallback = [
        [sideX + 45, aboveY - 18],
        [-(sideX + 45), aboveY - 18],
        [sideX + 65, 0],
        [-(sideX + 65), 0],
        [sideX + 45, belowY + 18],
        [-(sideX + 45), belowY + 18],
        [0, aboveY - 42],
        [0, belowY + 42],
        [sideX + 95, aboveY - 30],
        [-(sideX + 95), aboveY - 30],
        [sideX + 95, belowY + 30],
        [-(sideX + 95), belowY + 30]
      ];

      const spiral = [];
      for (let radius = 95; radius <= 220; radius += 24) {
        for (let angle = -165; angle <= 165; angle += 15) {
          // On ne teste le cercle large qu'à la fin, après dessus/droite/gauche/dessous.
          const rad = angle * Math.PI / 180;
          spiral.push([Math.cos(rad) * radius, Math.sin(rad) * radius]);
        }
      }

      return [
        ...direct.map((offset) => ({ offset, leader: false })),
        ...nearbyWithLeader.map((offset) => ({ offset, leader: true })),
        ...fallback.map((offset) => ({ offset, leader: true })),
        ...spiral.map((offset) => ({ offset, leader: true }))
      ];
    }

    function findPlacement(anchorPoint, labelWidth, labelHeight) {
      const allCandidates = buildPlacementCandidates(labelWidth, labelHeight);

      for (const candidate of allCandidates) {
        const [dx, dy] = candidate.offset;
        const centerX = anchorPoint.x + dx;
        const centerY = anchorPoint.y + dy;
        const rect = makeRect(centerX - labelWidth / 2, centerY - labelHeight / 2, labelWidth, labelHeight);

        if (!rectInsideMap(rect, mapWidth, mapHeight, 4)) continue;
        if (placedRects.some((placed) => rectsOverlap(rect, placed, 3))) continue;
        if (blockedRects.some((blocked) => rectsOverlap(rect, blocked, 2))) continue;

        return {
          rect,
          centerX,
          centerY,
          leader: candidate.leader
        };
      }

      return null;
    }

    for (const item of measured) {
      const anchorPoint = map.latLngToContainerPoint(item.group.anchor);
      const placement = findPlacement(anchorPoint, item.width, item.height);

      if (!placement) {
        item.el.remove();
        continue;
      }

      placedRects.push(placement.rect);

      item.el.style.visibility = "visible";
      item.el.style.transform = "";
      item.el.style.left = `${Math.round(placement.rect.left)}px`;
      item.el.style.top = `${Math.round(placement.rect.top)}px`;
      item.el.style.width = `${Math.ceil(item.width)}px`;

      if (placement.leader) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");

        const labelEdgeX = Math.max(placement.rect.left, Math.min(anchorPoint.x, placement.rect.right));
        const labelEdgeY = Math.max(placement.rect.top, Math.min(anchorPoint.y, placement.rect.bottom));

        line.setAttribute("x1", String(Math.round(anchorPoint.x)));
        line.setAttribute("y1", String(Math.round(anchorPoint.y - 11)));
        line.setAttribute("x2", String(Math.round(labelEdgeX)));
        line.setAttribute("y2", String(Math.round(labelEdgeY)));
        cityLabelsSvg.appendChild(line);
      }
    }
  }

  function scheduleCityLabelsRender() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(renderCityLabels);
    });
  }


  function projectId(p) {
    return String(p.__projectId ?? p["Code projet"] ?? p["ID"] ?? p.code_projet ?? p.codeProjet ?? p.id ?? "").trim();
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
    projectListDirty = false;
    const q = normalizeSearchText(elProjListSearch?.value ?? "");

    // On liste les projets actuellement filtrés (recherche + types + dept si activé)
    const arr = filteredProjects();
    const rows = [];

    for (const p of arr) {
      const pid = projectId(p);
      if (!pid) continue;
      const { nom, typ, mnt, ant } = projectListLabel(p);
      const deptName = deptNameFromProject(p);
      const city = projectCity(p);
      const blob = normalizeSearchText(`${nom} ${typ} ${mnt} ${ant} ${deptName} ${city}`);
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
      <button class="projListRow" type="button" data-pid="${escapeAttr(r.pid)}" aria-label="Ouvrir ${escapeAttr(r.nom || "ce projet")}">
        <span class="projListName">${escapeHtml(r.nom || "(sans nom)")}</span>
        <span>${escapeHtml(r.typ)}</span>
        <span>${escapeHtml(r.mnt)}</span>
        <span>${escapeHtml(r.ant)}</span>
      </button>
    `).join("");
  }

  function openProjectFromList(pid) {
    const p = allProjects.find((x) => projectId(x) === pid);
    const marker = projectIdToMarker.get(pid);

    if (!marker) {
      clearSelectedMarker();
      if (p) showPanel(p);
      setProjectListOpen(false);
      return;
    }

    const ll = marker.getLatLng();
    setSelectedMarker(marker);

    const targetZoom = Math.max(map.getZoom(), 14);
    map.flyTo([ll.lat, ll.lng], targetZoom, { duration: 0.6 });

    if (p) showPanel(p);

    setProjectListOpen(false);
  }

  function openProjectFromData(p) {
    if (!p) return;

    const pid = projectId(p);
    const ll = projectLatLon(p);

    selectedAntenna = null;
    renderMarkers();
    updateDeptStyle();
    updateDeptSelectedStat();

    const marker = pid ? projectIdToMarker.get(pid) : null;
    if (marker) setSelectedMarker(marker);
    else clearSelectedMarker();

    if (ll) {
      const targetZoom = Math.max(map.getZoom(), 14);
      map.flyTo(ll, targetZoom, { duration: 0.6 });
    }

    showPanel(p);
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

  function normalizeSearchText(s) {
    return normalizeForLookup(s);
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

  function projectCity(p) {
    return String(
      p["Ville"] ??
      p.ville ??
      p["Commune"] ??
      p.commune ??
      p["Adresse ville"] ??
      ""
    ).trim();
  }

  function projectLatLon(p) {
    const lat = parseFloat(String(p["Latitude"] ?? p.latitude ?? p.lat ?? "").replace(",", "."));
    const lon = parseFloat(String(p["Longitude"] ?? p.longitude ?? p.lon ?? "").replace(",", "."));
    if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
    return null;
  }

  function pointInRing(point, ring) {
    if (!Array.isArray(ring) || ring.length < 3) return false;
    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const denom = (yj - yi) || Number.EPSILON;
      const intersects = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / denom + xi);
      if (intersects) inside = !inside;
    }

    return inside;
  }

  function pointInPolygonCoords(point, polygonCoords) {
    if (!Array.isArray(polygonCoords) || !polygonCoords.length) return false;
    if (!pointInRing(point, polygonCoords[0])) return false;

    for (let i = 1; i < polygonCoords.length; i += 1) {
      if (pointInRing(point, polygonCoords[i])) return false;
    }
    return true;
  }

  function pointInGeometry(point, geometry) {
    if (!geometry) return false;
    if (geometry.type === "Polygon") return pointInPolygonCoords(point, geometry.coordinates);
    if (geometry.type === "MultiPolygon") return geometry.coordinates.some((poly) => pointInPolygonCoords(point, poly));
    return false;
  }

  function collectGeometryPoints(coords, out = []) {
    if (!Array.isArray(coords) || !coords.length) return out;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      out.push(coords);
      return out;
    }
    coords.forEach((item) => collectGeometryPoints(item, out));
    return out;
  }

  function getGeometryBbox(geometry) {
    const pts = collectGeometryPoints(geometry?.coordinates, []);
    if (!pts.length) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    return [minX, minY, maxX, maxY];
  }

  function bboxContainsPoint(bbox, point) {
    if (!bbox) return false;
    const [minX, minY, maxX, maxY] = bbox;
    const [x, y] = point;
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  function inferDeptFromLatLon(lat, lon) {
    const point = [lon, lat];
    for (const entry of deptSpatialIndex) {
      if (!bboxContainsPoint(entry.bbox, point)) continue;
      if (pointInGeometry(point, entry.geometry)) {
        return { code: entry.code, name: entry.name };
      }
    }
    return null;
  }


  function inferOverseasArea(project, lat, lon) {
    const cityBlob = normalizeSearchText(projectCity(project));
    const allBlob = normalizeSearchText(Object.values(project || {}).join(" "));

    for (const rule of OVERSEAS_AREA_RULES) {
      if (rule.matches({ cityBlob, allBlob, lat, lon })) {
        return { code: rule.code, name: rule.name };
      }
    }
    return null;
  }

  function enrichProjectsWithDepartments(projects) {
    for (const p of projects) {
      const existingCode = normalizeDeptCode(p.__deptCode ?? p["Code département"] ?? p.code_departement ?? p["Département"] ?? p.departement ?? "");
      if (/^(\d{2}|\d{3}|2A|2B)$/.test(existingCode)) {
        p.__deptCode = existingCode;
        p.__deptName = String(p.__deptName ?? p["Nom département"] ?? deptCodeToName[existingCode] ?? p.__deptName ?? "").trim();
        p.__searchBlob = buildProjectSearchBlob(p);
        continue;
      }

      const ll = projectLatLon(p);
      let inferred = null;
      if (ll) {
        inferred = inferDeptFromLatLon(ll[0], ll[1]) || inferOverseasArea(p, ll[0], ll[1]);
      }

      if (inferred) {
        p.__deptCode = inferred.code;
        p.__deptName = inferred.name;
      }

      p.__searchBlob = buildProjectSearchBlob(p);
    }
  }

  function deptCodeFromProject(p) {
    const codeLike = String(p.__deptCode ?? p["Code département"] ?? p.code_departement ?? p["Département"] ?? p.departement ?? "").trim();
    if (codeLike) {
      const maybeCode = normalizeDeptCode(codeLike);
      if (/^(\d{2}|\d{3}|2A|2B)$/.test(maybeCode)) return maybeCode;
    }

    const rawName = String(p.__deptName ?? p["Nom département"] ?? p["Département"] ?? p.departement ?? "").trim();
    if (!rawName) return "";
    const key = normalizeForLookup(rawName);
    return deptNameToCode.get(key) || "";
  }

  function deptNameFromProject(p) {
    const rawName = String(p.__deptName ?? p["Nom département"] ?? "").trim();
    if (rawName) return rawName;
    const code = deptCodeFromProject(p);
    return code ? String(deptCodeToName[code] ?? "").trim() : "";
  }

  function buildProjectSearchBlob(p) {
    const values = [
      projectId(p),
      p?.["Nom de projet"], p?.nom,
      p?.["Adresse"], p?.adresse,
      projectCity(p),
      p?.["Client"], p?.client,
      p?.["Type de projet"], p?.type,
      p?.["Type de montage"], p?.type_montage,
      p?.["Montant"], p?.montant,
      p?.["Antenne"], p?.antenne,
      p?.["Phase projet"], p?.phase,
      p?.["Programme"], p?.programme,
      p?.["Début"], p?.debut, p?.["Debut"], p?.deb,
      p?.["Fin"], p?.fin,
      p?.["Thématique"], p?.thematique,
      p?.["CP principal"], p?.cp_principal, p?.cp,
      p?.["Acheteur"], p?.acheteur,
      p?.["CED principal"], p?.ced_principal, p?.ced,
      p?.["Région"], p?.region,
      p?.["Nom département"], p?.["Département"], p?.departement,
      p?.__deptName, p?.__deptCode
    ];
    return normalizeSearchText(values.filter((value) => value != null && String(value).trim()).join(" "));
  }

  function projectStartYear(p) {
    const raw = String(p["Début"] ?? p.debut ?? p["Debut"] ?? p.deb ?? "").trim();
    const match = raw.match(/\b(19|20)\d{2}\b/);
    return match ? Number(match[0]) : null;
  }

  function projectEndYear(p) {
    const raw = String(p["Fin"] ?? p.fin ?? "").trim();
    const match = raw.match(/\b(19|20)\d{2}\b/);
    return match ? Number(match[0]) : null;
  }

  function updateCompletedYearBounds() {
    // La frise des projets finis reste volontairement bornée à la période métier demandée,
    // même si certaines données contiennent des dates hors périmètre.
    COMPLETED_YEAR_MIN = 2008;
    COMPLETED_YEAR_MAX = 2024;

    completedYearFilter = clampCompletedYear(completedYearFilter);
    updateCompletedYearFilterUi();
  }

  function isProjectPresentInYear(p, year) {
    const startYear = projectStartYear(p);
    const endYear = projectEndYear(p);

    if (startYear == null && endYear == null) return true;
    if (startYear == null) return year <= endYear;
    if (endYear == null) return startYear <= year;

    const fromYear = Math.min(startYear, endYear);
    const toYear = Math.max(startYear, endYear);
    return fromYear <= year && year <= toYear;
  }

  function isProjectDeliveredInYear(p, year) {
    const endYear = projectEndYear(p);
    return Number.isFinite(endYear) && endYear === Number(year);
  }

  function matchesFiltersWithoutCompletedYear(p) {
    const q = normalizeSearchText(elQ?.value || "");
    const types = getActiveTypes();
    const t = projectType(p);

    if (types.length && !types.includes(t)) return false;

    if (q) {
      const blob = p.__searchBlob || buildProjectSearchBlob(p);
      if (!blob.includes(q)) return false;
    }

    if (hasActiveAdvancedFilters() && !matchesAdvancedFilters(p)) return false;

    return true;
  }

  function completedTimelineBaseProjects() {
    let projects = allProjects.filter(matchesFiltersWithoutCompletedYear);

    // Important : l'histogramme suit aussi les filtres MOM / AMO / EXP,
    // la recherche, les filtres avancés et le focus antenne, mais pas le curseur d'année.
    if (selectedAntenna) {
      const a = normalizeForLookup(selectedAntenna);
      projects = projects.filter((p) => normalizeForLookup(p["Antenne"] ?? p.antenne) === a);
    }

    return projects;
  }

  function computeCompletedYearStats(projects = completedTimelineBaseProjects()) {
    const stats = new Map();

    for (let year = COMPLETED_YEAR_MIN; year <= COMPLETED_YEAR_MAX; year += 1) {
      stats.set(year, { year, present: 0, delivered: 0, amountPresent: 0, amountDelivered: 0 });
    }

    for (const project of projects) {
      const amount = amountNumber(project["Montant"] ?? project.montant);
      const safeAmount = Number.isFinite(amount) ? amount : 0;

      for (let year = COMPLETED_YEAR_MIN; year <= COMPLETED_YEAR_MAX; year += 1) {
        if (!isProjectPresentInYear(project, year)) continue;
        const entry = stats.get(year);
        entry.present += 1;
        entry.amountPresent += safeAmount;
      }

      for (let year = COMPLETED_YEAR_MIN; year <= COMPLETED_YEAR_MAX; year += 1) {
        if (!isProjectDeliveredInYear(project, year)) continue;
        const entry = stats.get(year);
        entry.delivered += 1;
        entry.amountDelivered += safeAmount;
      }
    }

    return Array.from(stats.values());
  }

  function updateCompletedTimelineUi() {
    if (!elCompletedYearFilter || currentProjectMode !== PROJECT_MODES.completed.key) return;

    const stats = computeCompletedYearStats();
    const selectedStats = stats.find((entry) => entry.year === completedYearFilter) || { present: 0, delivered: 0, amountPresent: 0, amountDelivered: 0 };
    const maxPresent = Math.max(1, ...stats.map((entry) => entry.present));

    if (elCompletedYearStats) {
      const amountLabel = formatMillionEuro(showAllCompletedProjects
        ? stats.reduce((sum, entry) => sum + entry.amountDelivered, 0)
        : selectedStats.amountPresent
      );
      const totalVisible = showAllCompletedProjects
        ? completedTimelineBaseProjects().length
        : selectedStats.present;
      const deliveredVisible = showAllCompletedProjects
        ? stats.reduce((sum, entry) => sum + entry.delivered, 0)
        : selectedStats.delivered;

      elCompletedYearStats.innerHTML = `
        <span><strong>${totalVisible}</strong> présent(s)</span>
        <span><strong>${deliveredVisible}</strong> livré(s)</span>
        ${amountLabel ? `<span><strong>${escapeHtml(amountLabel)}</strong></span>` : ""}
      `;
    }

    if (!elCompletedYearHistogram) return;

    elCompletedYearHistogram.innerHTML = stats.map((entry) => {
      const height = Math.max(8, Math.round((entry.present / maxPresent) * 32));
      const active = !showAllCompletedProjects && entry.year === completedYearFilter;
      const title = `${entry.year} : ${entry.present} présent(s), ${entry.delivered} livré(s)`;
      return `
        <button type="button" class="completedYearBar${active ? " is-active" : ""}" data-year="${entry.year}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}" role="listitem">
          <span class="completedYearBarFill" style="height:${height}px"></span>
          <span class="completedYearBarLabel">${entry.year}</span>
        </button>
      `;
    }).join("");
  }

  function hasProjectPhotos(p) {
    return getProjectPhotos(p).length > 0;
  }

  function hasProjectEnergyData(p) {
    const fields = [
      "Consommation énergetique - avant travaux",
      "Consommation énergetique - Après travaux",
      "Émission GES - avant travaux",
      "Émission GES - Après travaux"
    ];
    return fields.some((key) => p?.[key] != null && String(p[key]).trim() !== "");
  }

  function selectedValue(el) {
    return String(el?.value ?? "").trim();
  }

  function hasActiveAdvancedFilters() {
    return !!(
      selectedValue(elAmountMin) ||
      selectedValue(elAmountMax) ||
      selectedValue(elPhaseFilter) ||
      selectedValue(elClientFilter) ||
      selectedValue(elProgrammeFilter) ||
      selectedValue(elThemeFilter) ||
      selectedValue(elDeptFilter) ||
      selectedValue(elPhotosFilter) ||
      selectedValue(elEnergyFilter)
    );
  }

  function syncAdvancedFiltersButtonState() {
    if (!elAdvancedFiltersBtn) return;
    const active = hasActiveAdvancedFilters();
    elAdvancedFiltersBtn.classList.toggle("is-active", active);
    elAdvancedFiltersBtn.title = active ? "Des filtres avancés sont actifs" : "Afficher les filtres avancés";
  }

  function setAdvancedFiltersOpen(open) {
    if (!elAdvancedFiltersPanel || !elAdvancedFiltersBtn) return;
    elAdvancedFiltersPanel.hidden = !open;
    elAdvancedFiltersBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function uniqueSortedValues(projects, getter) {
    const map = new Map();
    for (const project of projects) {
      const value = String(getter(project) ?? "").trim();
      if (!value) continue;
      const key = normalizeForLookup(value);
      if (!map.has(key)) map.set(key, value);
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base", numeric: true }));
  }

  function fillSelectOptions(select, values, emptyLabel) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>` + values.map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join("");
    if (values.includes(current)) select.value = current;
  }

  function refreshAdvancedFilterOptions() {
    const projects = allProjects || [];
    fillSelectOptions(elPhaseFilter, uniqueSortedValues(projects, (p) => p["Phase projet"] ?? p.phase), "Toutes");
    fillSelectOptions(elClientFilter, uniqueSortedValues(projects, (p) => p["Client"] ?? p.client), "Tous");
    fillSelectOptions(elProgrammeFilter, uniqueSortedValues(projects, (p) => p["Programme"] ?? p.programme), "Tous");
    fillSelectOptions(elThemeFilter, uniqueSortedValues(projects, (p) => p["Thématique"] ?? p.thematique), "Toutes");
    const deptValues = uniqueSortedValues(projects, (p) => {
      const code = deptCodeFromProject(p);
      const name = deptNameFromProject(p);
      if (code && name) return `${code} - ${name}`;
      return name || code;
    });
    fillSelectOptions(elDeptFilter, deptValues, "Tous");
  }

  function matchesAdvancedFilters(p) {
    const minAmount = Number(selectedValue(elAmountMin));
    const maxAmount = Number(selectedValue(elAmountMax));
    const amount = amountNumber(p["Montant"] ?? p.montant);

    if (Number.isFinite(minAmount) && selectedValue(elAmountMin) && (!Number.isFinite(amount) || amount < minAmount)) return false;
    if (Number.isFinite(maxAmount) && selectedValue(elAmountMax) && (!Number.isFinite(amount) || amount > maxAmount)) return false;

    const exactChecks = [
      [elPhaseFilter, p["Phase projet"] ?? p.phase],
      [elClientFilter, p["Client"] ?? p.client],
      [elProgrammeFilter, p["Programme"] ?? p.programme],
      [elThemeFilter, p["Thématique"] ?? p.thematique]
    ];

    for (const [el, raw] of exactChecks) {
      const wanted = selectedValue(el);
      if (wanted && normalizeForLookup(raw) !== normalizeForLookup(wanted)) return false;
    }

    const deptWanted = selectedValue(elDeptFilter);
    if (deptWanted) {
      const code = deptCodeFromProject(p);
      const name = deptNameFromProject(p);
      const label = code && name ? `${code} - ${name}` : (name || code);
      if (normalizeForLookup(label) !== normalizeForLookup(deptWanted)) return false;
    }

    const photosWanted = selectedValue(elPhotosFilter);
    if (photosWanted === "yes" && !hasProjectPhotos(p)) return false;
    if (photosWanted === "no" && hasProjectPhotos(p)) return false;

    const energyWanted = selectedValue(elEnergyFilter);
    if (energyWanted === "yes" && !hasProjectEnergyData(p)) return false;
    if (energyWanted === "no" && hasProjectEnergyData(p)) return false;

    return true;
  }

  function clearAdvancedFilters() {
    [elAmountMin, elAmountMax, elPhaseFilter, elClientFilter, elProgrammeFilter, elThemeFilter, elDeptFilter, elPhotosFilter, elEnergyFilter]
      .forEach((el) => { if (el) el.value = ""; });
    syncAdvancedFiltersButtonState();
  }

  function projectModeFromProject(p) {
    return String(p?.__projectMode || currentProjectMode || PROJECT_MODES.current.key);
  }

  function updateProjectUrl(p) {
    if (suppressProjectUrlUpdate || !p) return;
    const pid = projectId(p);
    if (!pid || !window.history?.replaceState) return;
    const url = new URL(window.location.href);
    url.searchParams.set("mode", projectModeFromProject(p));
    url.searchParams.set("projet", pid);
    window.history.replaceState(null, "", url);
  }

  function clearProjectUrl() {
    if (!window.history?.replaceState) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("projet");
    url.searchParams.delete("mode");
    window.history.replaceState(null, "", url);
  }

  function findProjectByUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const pid = String(params.get("projet") || params.get("project") || params.get("id") || "").trim();
    if (!pid) return null;
    const requestedMode = String(params.get("mode") || "").trim();
    const modes = requestedMode && projectsByMode[requestedMode]
      ? [requestedMode]
      : [PROJECT_MODES.current.key, PROJECT_MODES.completed.key];

    for (const modeKey of modes) {
      const project = (projectsByMode[modeKey] || []).find((candidate) => projectId(candidate) === pid);
      if (project) return { project, modeKey };
    }
    return null;
  }

  async function openProjectFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const requestedMode = String(params.get("mode") || "").trim();

    if (requestedMode === PROJECT_MODES.completed.key && !completedProjectsLoaded && !completedProjectsLoadFailed) {
      const loaded = await ensureCompletedProjectsLoaded({ silent: true });
      if (!loaded) return;
    }

    const match = findProjectByUrlParams();
    if (!match) return;

    suppressProjectUrlUpdate = true;
    try {
      if (match.modeKey !== currentProjectMode) {
        await setProjectMode(match.modeKey);
      }

      if (match.modeKey === PROJECT_MODES.completed.key) {
        const startYear = projectStartYear(match.project);
        const endYear = projectEndYear(match.project);
        const year = Number.isFinite(endYear) ? endYear : startYear;
        if (Number.isFinite(year)) setCompletedYearFilter(clampCompletedYear(year), { rerender: false });
        else setCompletedShowAll(true, { rerender: false });
      }

      renderMarkers();
      openProjectFromData(match.project);
    } finally {
      suppressProjectUrlUpdate = false;
      updateProjectUrl(match.project);
    }
  }

  function matchesFilters(p) {
    if (!matchesFiltersWithoutCompletedYear(p)) return false;

    if (currentProjectMode === PROJECT_MODES.completed.key) {
      if (!showAllCompletedProjects && !isProjectPresentInYear(p, completedYearFilter)) return false;
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

  function getProjectsForAntenna(antennaName) {
    const a = normalizeForLookup(antennaName);
    if (!a) return [];
    return allProjects
      .filter((p) => normalizeForLookup(p["Antenne"] ?? p.antenne) === a)
      .sort((aProj, bProj) => String(aProj["Nom de projet"] ?? aProj.nom ?? "").localeCompare(String(bProj["Nom de projet"] ?? bProj.nom ?? ""), "fr", { sensitivity: "base" }));
  }

  function filteredProjectsForAntennaSummary() {
    // La synthèse doit tenir compte des filtres de recherche / type / année,
    // mais pas du focus antenne créé quand on clique sur un encart.
    return allProjects.filter(matchesFilters);
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
    if (!t) return PROJECT_TYPE_COLORS.mom;
    const x = String(t).toLowerCase();
    if (x.includes("amo")) return PROJECT_TYPE_COLORS.amo;
    if (x.includes("mom")) return PROJECT_TYPE_COLORS.mom;
    if (x.includes("exp")) return PROJECT_TYPE_COLORS.exp;
    return PROJECT_TYPE_COLORS.other;
  }

  function renderMarkers() {
    clusters.clearLayers();
    projectIdToMarker = new Map();
    clearSelectedMarker();

    const list = filteredProjects();
    let markerCount = 0;

    for (const p of list) {
      const ll = projectLatLon(p);
      if (!ll) continue;

      const col = colorByType(p["Type de projet"] ?? p.type ?? "");
      const marker = L.marker(ll, {
        icon: L.divIcon({
          className: "pin-dot",
          html: `<div class="pin-dot-inner" style="border-color:${col};"></div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
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
        updateDeptSelectedStat();
        updateClearButtonState();

        // Zoom/centrage sur le pin cliqué
        const targetZoom = Math.max(map.getZoom(), 14);
        map.flyTo(ll, targetZoom, { duration: 0.6 });

        showPanel(p);
      });

      clusters.addLayer(marker);
      markerCount += 1;
    }

    if (elCount) elCount.textContent = String(list.length);
    if (elStatLocated) {
      elStatLocated.textContent = markerCount === list.length ? "" : ` (${markerCount} localisé(s))`;
    }
    updateCompletedTimelineUi();
    filteredCounts = computeFilteredCounts();
    renderAntennaSummary();
    projectListDirty = true;
    if (elProjListMenu && !elProjListMenu.hidden) buildProjectList();
    updateDeptStyle();
    updateClearButtonState();
  }

  // ---- Panel ----

  // ---- Photos (panel) ----
  let lightboxEl = null;
  let lightboxItems = [];
  let lightboxIndex = 0;
  let lightboxKeyHandler = null;
  let lightboxPreviouslyFocused = null;

  function renderLightboxImage() {
    if (!lightboxEl) return;
    const img = lightboxEl.querySelector(".lightboxImg");
    const prevBtn = lightboxEl.querySelector('[data-nav="-1"]');
    const nextBtn = lightboxEl.querySelector('[data-nav="1"]');
    const counter = lightboxEl.querySelector(".lightboxCounter");
    if (!img) return;

    const total = lightboxItems.length || 0;
    const safeIndex = total ? Math.max(0, Math.min(lightboxIndex, total - 1)) : 0;
    const current = total ? String(lightboxItems[safeIndex] || "") : "";

    img.src = current;
    img.alt = `Photo ${safeIndex + 1}`;
    img.onerror = () => closeLightbox();

    if (counter) counter.textContent = total > 1 ? `${safeIndex + 1} / ${total}` : "Photo";
    if (prevBtn) prevBtn.disabled = total <= 1;
    if (nextBtn) nextBtn.disabled = total <= 1;
  }

  function stepLightbox(delta) {
    const total = lightboxItems.length || 0;
    if (total <= 1) return;
    lightboxIndex = (lightboxIndex + delta + total) % total;
    renderLightboxImage();
  }

  function openLightbox(items, index = 0) {
    const arr = Array.isArray(items) ? items.filter((x) => typeof x === "string" && x.trim()) : [items];
    if (!arr.length) return;

    closeLightbox();
    lightboxPreviouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lightboxItems = arr;
    lightboxIndex = Math.max(0, Math.min(Number(index) || 0, arr.length - 1));

    lightboxEl = document.createElement("div");
    lightboxEl.className = "lightbox";
    lightboxEl.innerHTML = `
      <div class="lightboxBackdrop" data-close="1"></div>
      <div class="lightboxContent" role="dialog" aria-modal="true" aria-label="Galerie photos">
        <button class="lightboxClose" type="button" aria-label="Fermer" data-close="1">✕</button>
        <div class="lightboxStage">
          <button class="lightboxNav lightboxPrev" type="button" aria-label="Photo précédente" data-nav="-1">‹</button>
          <figure class="lightboxFigure">
            <img class="lightboxImg" src="" alt="" loading="eager">
          </figure>
          <button class="lightboxNav lightboxNext" type="button" aria-label="Photo suivante" data-nav="1">›</button>
        </div>
        <div class="lightboxMeta">
          <div class="lightboxCounter" aria-live="polite"></div>
        </div>
      </div>
    `;
    document.body.appendChild(lightboxEl);
    renderLightboxImage();
    lightboxEl.querySelector(".lightboxClose")?.focus();

    lightboxEl.addEventListener("click", (e) => {
      const t = e.target;
      if (!t) return;
      const navBtn = t.closest?.("[data-nav]");
      if (navBtn) {
        stepLightbox(Number(navBtn.getAttribute("data-nav")) || 0);
        return;
      }
      if (t.getAttribute && t.getAttribute("data-close") === "1") closeLightbox();
    });

    lightboxKeyHandler = (e) => {
      if (e.key === "Escape") {
        closeLightbox();
      } else if (e.key === "ArrowLeft") {
        stepLightbox(-1);
      } else if (e.key === "ArrowRight") {
        stepLightbox(1);
      } else if (e.key === "Tab" && lightboxEl) {
        const focusables = Array.from(lightboxEl.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
          .filter((node) => node instanceof HTMLElement && node.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", lightboxKeyHandler);
  }

  function closeLightbox() {
    if (lightboxKeyHandler) {
      document.removeEventListener("keydown", lightboxKeyHandler);
      lightboxKeyHandler = null;
    }
    if (lightboxEl && lightboxEl.parentNode) lightboxEl.parentNode.removeChild(lightboxEl);
    lightboxEl = null;
    lightboxItems = [];
    lightboxIndex = 0;
    if (lightboxPreviouslyFocused && document.contains(lightboxPreviouslyFocused)) {
      lightboxPreviouslyFocused.focus();
    }
    lightboxPreviouslyFocused = null;
  }

  window.addEventListener("beforeprint", closeLightbox);

  function openPanel(html) {
    if (!elPanel) return;
    elPanel.innerHTML = html;
    elPanel.classList.add("open");
    elAntennaSummaryOverlay?.classList.add("is-panel-open");
  }

  function closePanel({ resetView = false } = {}) {
    if (!elPanel) return;
    elPanel.classList.remove("open");
    elAntennaSummaryOverlay?.classList.remove("is-panel-open");
    elPanel.innerHTML = "";
    clearSelectedMarker();

    // La fermeture du panneau ne doit pas désactiver le filtre antenne.
    // Le bouton Réinitialiser doit donc rester actif tant que selectedAntenna
    // ou un autre filtre est encore en cours.
    updateDeptStyle();
    updateClearButtonState();
    clearProjectUrl();

    if (resetView) zoomToFrance();
  }

  function showPanel(p) {
    updateProjectUrl(p);
    const title = p["Nom de projet"] ?? p.nom ?? "Projet";

    // Ordre demandé
    const fieldsMain = [
      ["Adresse", p["Adresse"] ?? p.adresse],
      ["Ville", projectCity(p)],
      ["Client", p["Client"] ?? p.client],
      ["Type de projet", p["Type de projet"] ?? p.type],
      ["Type de montage", p["Type de montage"] ?? p.type_montage],
      ["Montant", formatEuro(p["Montant"] ?? p.montant)],
      ["Antenne", p["Antenne"] ?? p.antenne],
      ["Phase projet", p["Phase projet"] ?? p.phase],
      ["Programme", p["Programme"] ?? p.programme],
      ["Début", p["Début"] ?? p.debut ?? p.start],
      ["Fin", p["Fin"] ?? p.fin ?? p.end],
      ["Thématique", p["Thématique"] ?? p.thematique]
    ];

    const fieldsContacts = [
      ["CP principal", p["CP principal"] ?? p.cp_principal ?? p.cp],
      ["Acheteur", p["Acheteur"] ?? p.acheteur],
      ["CED principal", p["CED principal"] ?? p.ced_principal ?? p.ced],
      ["Contact RPROG", p["Contact RPROG"] ?? p.contact_rprog],
      ["Contact MOE", p["Contact MOE"] ?? p.contact_moe]
    ];

    const energyHtml = renderEnergySection(p);

    let html = "";
    html += `<div class="panelHeader">`;
    html += `<div class="panelHeaderTitleWrap">`;
    html += `<h2 class="panelTitle">${escapeHtml(title)}</h2>`;
    html += `<img class="printProjectLogo" src="assets/logo-ministere.png" alt="Ministères économiques et financiers – Secrétariat général">`;
    html += `</div>`;
    html += `<div class="panelActions">`;
    html += `<button id="panelShare" class="panelShare" type="button" aria-label="Partager le lien de cette fiche">Partager</button>`;
    html += `<button id="panelPrint" class="panelPrint" type="button" aria-label="Imprimer cette fiche">Imprimer</button>`;
    html += `<button id="panelClose" class="panelClose" type="button" aria-label="Fermer">✕</button>`;
    html += `</div>`;
    html += `</div>`;

    const photos = getProjectPhotos(p);
    html += renderHeroPhoto(photos[0]);

    
    // Résumé (affiché avant l'adresse)
    const resumeVal = (p["Résumé"] ?? p["Resume"] ?? p.resume ?? p["Résumé projet"] ?? p["Résumé opération"] ?? p["Description"] ?? p.description);
    const resumeTxt = (resumeVal === undefined || resumeVal === null) ? "" : String(resumeVal).trim();
    if (resumeTxt) {
      const safe = escapeHtml(resumeTxt).replace(/\n/g, "<br>");
      html += `
        <div class="panelSubTitle panelSubTitle--project panelSubTitle--resume">Résumé</div>
        <div class="panelResumeText panelSectionBody">${safe}</div>
      `;
    }

    html += `<section class="panelSection panelSection--general">`;
    html += `<div class="panelSubTitle panelSubTitle--project panelSectionTitle panelSectionTitle--general">`;
    html += `<span class="screenOnlyInline">Informations générales</span><span class="printOnlyInline">Informations générales</span>`;
    html += `</div>`;
    html += buildKv(fieldsMain);
    html += `</section>`;

    // Sous-titre "Contacts" + infos
    const hasContacts = fieldsContacts.some(([, v]) => v !== undefined && v !== null && String(v).trim() !== "");
    if (hasContacts) {
      html += `<section class="panelSection panelSection--contacts">`;
      html += `<div class="panelSubTitle panelSubTitle--project panelSectionTitle panelSectionTitle--contacts">Contacts</div>`;
      html += buildKv(fieldsContacts);
      html += `</section>`;
    }

    if (energyHtml) {
      html += energyHtml;
    }

    html += renderPhotosSection(photos.slice(1));

    openPanel(html);

    const galleryPhotos = photos.filter((x) => typeof x === "string" && x.trim());

    elPanel?.querySelectorAll(".projPhotoBtn").forEach((btnEl) => {
      btnEl.addEventListener("click", () => {
        const idx = Number(btnEl.getAttribute("data-index")) || 0;
        openLightbox(galleryPhotos, idx);
      });
    });

    const btn = document.getElementById("panelClose");
    if (btn) btn.addEventListener("click", () => closePanel({ resetView: true }), { once: true });

    const shareBtn = document.getElementById("panelShare");
    if (shareBtn) {
      shareBtn.addEventListener("click", async () => {
        updateProjectUrl(p);
        const link = window.location.href;
        try {
          await navigator.clipboard.writeText(link);
          shareBtn.textContent = "Lien copié";
          window.setTimeout(() => { shareBtn.textContent = "Partager"; }, 1400);
        } catch {
          window.prompt("Copiez le lien de cette fiche projet :", link);
        }
      });
    }

    const printBtn = document.getElementById("panelPrint");
    if (printBtn) {
      printBtn.addEventListener("click", () => {
        closeLightbox();
        const previousTitle = document.title;
        document.title = String(title || previousTitle);
        window.print();
        window.setTimeout(() => {
          document.title = previousTitle;
        }, 100);
      });
    }
  }

  const TERTIARY_DPE_THRESHOLDS = {
    "bureaux administration enseignement": {
      energy: [50, 110, 210, 350, 540, 750],
      ges: [5, 15, 30, 60, 100, 145]
    },
    "commerces": {
      energy: [50, 120, 230, 380, 570, 800],
      ges: [5, 15, 30, 60, 100, 145]
    },
    "hotels hebergements": {
      energy: [120, 250, 400, 600, 850, 1150],
      ges: [10, 25, 50, 90, 140, 200]
    },
    "logistique entrepots": {
      energy: [30, 70, 140, 240, 370, 520],
      ges: [3, 8, 20, 40, 70, 100]
    },
    "sante etablissements medico sociaux": {
      energy: [150, 300, 480, 700, 950, 1250],
      ges: [15, 35, 65, 115, 175, 250]
    }
  };

  function parseMetricValue(value) {
    if (value === undefined || value === null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const normalized = raw.replace(/\s+/g, "").replace(",", ".");
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  }

  function normalizeBuildingType(value) {
    return normalizeForLookup(value)
      .replace(/\//g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getBuildingThresholds(project) {
    const rawType =
      project["Type de bâtiment"] ??
      project["Type de batiment"] ??
      project.type_batiment ??
      "";
    const key = normalizeBuildingType(rawType);
    return TERTIARY_DPE_THRESHOLDS[key] || null;
  }

  function getLetterFromThresholds(value, bounds) {
    if (!Number.isFinite(value) || !Array.isArray(bounds) || bounds.length !== 6) return "";
    if (value <= bounds[0]) return "A";
    if (value <= bounds[1]) return "B";
    if (value <= bounds[2]) return "C";
    if (value <= bounds[3]) return "D";
    if (value <= bounds[4]) return "E";
    if (value <= bounds[5]) return "F";
    return "G";
  }

  function buildThresholdBands(bounds) {
    if (!Array.isArray(bounds) || bounds.length !== 6) return [];
    const fmt = (n) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(n);
    return [
      { letter: "A", label: `≤ ${fmt(bounds[0])}` },
      { letter: "B", label: `> ${fmt(bounds[0])} à ${fmt(bounds[1])}` },
      { letter: "C", label: `> ${fmt(bounds[1])} à ${fmt(bounds[2])}` },
      { letter: "D", label: `> ${fmt(bounds[2])} à ${fmt(bounds[3])}` },
      { letter: "E", label: `> ${fmt(bounds[3])} à ${fmt(bounds[4])}` },
      { letter: "F", label: `> ${fmt(bounds[4])} à ${fmt(bounds[5])}` },
      { letter: "G", label: `> ${fmt(bounds[5])}` }
    ];
  }

  function formatMarkerValue(value) {
    if (!Number.isFinite(value)) return "";
    return new Intl.NumberFormat("fr-FR", {
      maximumFractionDigits: 1
    }).format(value);
  }

  function renderScaleMarker(kind, value) {
    if (!Number.isFinite(value)) return "";
    return `<span class="dpeMarker dpeMarker--${escapeAttr(kind)}"><span class="dpeMarkerLabel">${escapeHtml(formatMarkerValue(value))}</span></span>`;
  }

  function renderOfficialDpeCard(options) {
    const {
      theme,
      title,
      unitLine,
      bounds,
      beforeValue,
      afterValue
    } = options;

    if (!Array.isArray(bounds) || bounds.length !== 6) return "";

    const beforeLetter = getLetterFromThresholds(beforeValue, bounds);
    const afterLetter = getLetterFromThresholds(afterValue, bounds);
    const bands = buildThresholdBands(bounds);

    if (!beforeLetter && !afterLetter) return "";

    return `
      <div class="dpeCard dpeCard--${escapeAttr(theme)}" style="border-top:none;padding-top:0;">
        <div class="dpeCardTitle">${escapeHtml(title)}</div>

        <div class="dpeScale" role="img" aria-label="${escapeAttr(title)}">
          ${bands.map((band) => {
            const beforeMarker = beforeLetter === band.letter ? renderScaleMarker("before", beforeValue) : "";
            const afterMarker = afterLetter === band.letter ? renderScaleMarker("after", afterValue) : "";

            return `
              <div class="dpeRow dpeRow--${escapeAttr(theme)} dpeRow--${escapeAttr(band.letter)}">
                <div class="dpeRowShape">
                  <span class="dpeRowRange">${escapeHtml(band.label)}</span>
                  <span class="dpeRowLetter">${escapeHtml(band.letter)}</span>
                </div>
                <div class="dpeRowMarkers">
                  ${beforeMarker}
                  ${afterMarker}
                </div>
              </div>
            `;
          }).join("")}
        </div>

        <div class="dpeUnitLine">${escapeHtml(unitLine)}</div>
      </div>
    `;
  }

  function renderEnergySection(project) {
    const thresholds = getBuildingThresholds(project);
    if (!thresholds) return "";

    const energyBefore = parseMetricValue(
      project["Consommation énergetique - avant travaux"] ??
      project["Consommation énergetique - existant"]
    );
    const energyAfter = parseMetricValue(
      project["Consommation énergetique - Après travaux"] ??
      project["Consommation énergetique - après travaux"] ??
      project["Consommation énergetique - objectif"]
    );
    const gesBefore = parseMetricValue(
      project["Émission GES - avant travaux"] ??
      project["Emission GES - avant travaux"] ??
      project["GES - avant travaux"]
    );
    const gesAfter = parseMetricValue(
      project["Émission GES - Après travaux"] ??
      project["Émission GES - après travaux"] ??
      project["Emission GES - Après travaux"] ??
      project["Emission GES - après travaux"] ??
      project["GES - Après travaux"] ??
      project["GES - après travaux"]
    );

    const energyCard = renderOfficialDpeCard({
      theme: "energy",
      title: "Consommations énergétiques",
      unitLine: "Unité de mesure exprimée en kWhEP/ m².an",
      bounds: thresholds.energy,
      beforeValue: energyBefore,
      afterValue: energyAfter
    });

    const gesCard = renderOfficialDpeCard({
      theme: "ges",
      title: "Émissions de gaz à effet de serre",
      unitLine: "Unité de mesure exprimée en kgeqCO2/ m².An",
      bounds: thresholds.ges,
      beforeValue: gesBefore,
      afterValue: gesAfter
    });

    if (!energyCard && !gesCard) return "";

    return `
      <section class="panelSection panelSection--energy">
        <div class="panelSubTitle panelSubTitle--project panelSectionTitle panelSectionTitle--energy">
          <span class="screenOnlyInline">Informations énergétiques</span><span class="printOnlyInline">Informations énergétiques</span>
        </div>
        <div class="panelSectionBody">
        <div class="energyLegendInline" aria-label="Légende des repères">
          <span class="energyLegendInlineItem">
            <span class="energyLegendMiniMarker energyLegendMiniMarker--before" aria-hidden="true"><svg class="energyLegendMiniMarkerSvg" viewBox="0 0 28 14" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true"><polygon points="7,0 28,0 28,14 7,14 0,7" fill="#111"/></svg></span>
            <span class="energyLegendInlineText">Avant travaux</span>
          </span>
          <span class="energyLegendInlineItem">
            <span class="energyLegendMiniMarker energyLegendMiniMarker--after" aria-hidden="true"><svg class="energyLegendMiniMarkerSvg" viewBox="0 0 28 14" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true"><polygon points="7,0 28,0 28,14 7,14 0,7" fill="#111"/><polygon points="7,1 27,1 27,13 7,13 1,7" fill="#fff"/></svg></span>
            <span class="energyLegendInlineText">Après travaux</span>
          </span>
        </div>
        <div class="dpeCards">
          ${energyCard}
          ${gesCard}
        </div>
        </div>
      </section>
    `;
  }

  function normalizePhaseProjectValue(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function getProjectPhaseKey(value) {
    const normalized = normalizePhaseProjectValue(value);
    if (!normalized) return "";
    if (normalized.includes("gpa")) return "gpa";
    if (
      normalized.includes("realisation") ||
      normalized.includes("realisation") ||
      normalized.includes("construction") ||
      normalized.includes("execution") ||
      normalized.includes("travaux")
    ) return "realisation";
    if (
      normalized.includes("conception") ||
      normalized.includes("etudes") ||
      normalized.includes("etude")
    ) return "conception";
    if (
      normalized.includes("definition") ||
      normalized.includes("programmation") ||
      normalized.includes("faisabilite")
    ) return "definition";
    return "";
  }

  function renderProjectPhase(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    const steps = [
      { key: "definition", label: "Définition" },
      { key: "conception", label: "Conception" },
      { key: "realisation", label: "Réalisation" },
      { key: "gpa", label: "GPA" }
    ];

    const currentKey = getProjectPhaseKey(raw);
    const currentIndex = steps.findIndex((step) => step.key === currentKey);

    const items = steps.map((step, index) => {
      const classes = ["phaseStep", `phaseStep--${step.key}`];
      if (currentIndex === -1) {
        classes.push("is-neutral");
      } else if (index < currentIndex) {
        classes.push("is-done");
      } else if (index === currentIndex) {
        classes.push("is-current");
      } else {
        classes.push("is-upcoming");
      }
      return `<span class="${classes.join(" ")}">${escapeHtml(step.label)}</span>`;
    }).join("");

    return `
      <div class="phaseStepperWrap" aria-label="Phase projet">
        <div class="phaseStepper" role="img" aria-label="Phase projet : ${escapeHtml(raw)}">
          ${items}
        </div>
      </div>`;
  }

  // Génère le bloc d'infos du panneau avec les classes attendues par le CSS (kv/kvRow/kvKey/kvVal)
  function buildKv(fields) {
    let html = `<div class="kv kv--project">`;
    for (const [label, value] of fields) {
      if (value === undefined || value === null) continue;
      const s = String(value).trim();
      if (!s) continue;

      if (label === "Phase projet") {
        html += `
          <div class="kvRow kvRow--phaseLabel">
            <div class="kvKey">${escapeHtml(label)} :</div>
          </div>
          <div class="phaseFullRow">${renderProjectPhase(s)}</div>`;
        continue;
      }

      html += `
        <div class="kvRow">
          <div class="kvKey">${escapeHtml(label)} :</div>
          <div class="kvVal">${escapeHtml(s)}</div>
        </div>`;
    }
    html += `</div>`;
    return html;
  }

  // ---- Photos (dans le panneau projet) ----
  function getProjectPhotos(p) {
    const v = p?.photos ?? [];
    return Array.isArray(v) ? v.filter(Boolean) : [];
  }

  function renderPhotosSection(photos) {
    if (!photos || photos.length === 0) return "";
    const items = photos
      .map((src, i) => {
        const safe = String(src);
        const alt = `Photo ${i + 1}`;
        return `
          <button class="projPhotoBtn" type="button" data-src="${escapeHtml(safe)}" data-index="${i + 1}" aria-label="${escapeHtml(alt)}">
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

  function renderHeroPhoto(src) {
    if (!src) return "";
    const safe = String(src);
    const alt = "Photo 1";
    // Même mécanisme que les miniatures (clic -> lightbox)
    return `
      <div class="projHero">
        <button class="projPhotoBtn projHeroBtn" type="button" data-src="${escapeHtml(safe)}" data-index="0" aria-label="${escapeHtml(alt)}">
          <img class="projHeroPhoto" src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}" loading="eager"
               onerror="this.closest('.projHero') && (this.closest('.projHero').style.display='none')">
        </button>
      </div>`;
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

    const isAntennaFocused = !!(selectedAntenna && antenna && antenna === selectedAntenna);

    // On "fonce" l’antenne sélectionnée via opacité/contour
    const weight = isAntennaFocused ? 2 : 1;
    const color = isAntennaFocused ? "#111" : "#666";
    const fillOpacity = isAntennaFocused ? 0.70 : (antenna ? 0.65 : 0.14);

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
        closePanel();
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
    deptCodeToName = {};
    deptSpatialIndex = [];

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
        deptCodeToName[code] = String(nameRaw || "").trim();
        const antenna = DEPT_TO_ANTENNA_BY_CODE[code] || DEPT_TO_ANTENNA_BY_NAME.get(key) || "";
        if (antenna) deptCodeToAntenna[code] = antenna;
      }

      if (code && f?.geometry) {
        deptSpatialIndex.push({
          code,
          name: String(nameRaw || "").trim(),
          geometry: f.geometry,
          bbox: getGeometryBbox(f.geometry)
        });
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
    elStatDept.textContent = selectedAntenna ? ` — ${selectedAntenna}` : "";
  }

  // ---- Fetch robuste ----
  async function fetchJson(url, { timeoutMs = 15000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort("timeout"), timeoutMs);

    try {
      const r = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: ctrl.signal
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
      const txt = await r.text();
      const clean = txt.replace(/^\uFEFF/, "");
      try {
        return JSON.parse(clean);
      } catch (parseErr) {
        throw new Error(`JSON invalide dans ${url}: ${parseErr.message}`);
      }
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
  renderLegendAntennas();
  syncProjectTypeLegendColors();
  createCompletedYearFilterUi();
  updateCompletedYearFilterUi();
  syncToolbarControlHeights();

  window.addEventListener("resize", syncToolbarControlHeights);
  window.addEventListener("load", syncToolbarControlHeights);
  if (document.fonts?.ready) {
    document.fonts.ready.then(syncToolbarControlHeights).catch(() => {});
  }

  const rerenderDebounced = debounce(renderMarkers, 200);
  if (elQ) elQ.addEventListener("input", () => {
    updateClearButtonState();
    rerenderDebounced();
  });
  document.querySelectorAll(".typeFilter").forEach((cb) => cb.addEventListener("change", () => {
    updateClearButtonState();
    renderMarkers();
  }));
  initOfficesToggle();

  if (elAntennaSummaryBtn) {
    elAntennaSummaryBtn.addEventListener("click", () => {
      setAntennaSummaryEnabled(!antennaSummaryEnabled, { adjustView: !antennaSummaryEnabled });
    });
  }

  if (elAntennaSummaryOverlay) {
    elAntennaSummaryOverlay.addEventListener("click", (e) => {
      const card = e.target?.closest?.(".antennaSummaryCard");
      const antenna = card?.getAttribute?.("data-antenna");
      if (!antenna) return;
      selectedAntenna = selectedAntenna === antenna ? null : antenna;
      closePanel();
      updateDeptStyle();
      updateDeptSelectedStat();
      renderMarkers();
    });
  }

  if (elClear) {
    elClear.addEventListener("click", () => {
      if (elQ) elQ.value = "";
      document.querySelectorAll(".typeFilter").forEach((cb) => (cb.checked = true));
      clearAdvancedFilters();
      selectedAntenna = null;
      stopCompletedYearPlayback();
      setCompletedYearFilter(COMPLETED_YEAR_MIN, { rerender: false });
      setCompletedShowAll(false, { rerender: false });
      updateDeptStyle();
      closePanel();
      updateDeptSelectedStat();
      updateClearButtonState();
      renderMarkers();
    });
  }

  if (elProjectModeSwitch) {
    elProjectModeSwitch.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-project-mode]");
      const modeKey = btn?.getAttribute?.("data-project-mode");
      if (modeKey) setProjectMode(modeKey);
    });
  }

  if (elAdvancedFiltersBtn && elAdvancedFiltersPanel) {
    elAdvancedFiltersBtn.addEventListener("click", () => {
      setAdvancedFiltersOpen(elAdvancedFiltersPanel.hidden);
    });
  }

  [elAmountMin, elAmountMax, elPhaseFilter, elClientFilter, elProgrammeFilter, elThemeFilter, elDeptFilter, elPhotosFilter, elEnergyFilter]
    .filter(Boolean)
    .forEach((el) => {
      const eventName = el.tagName === "INPUT" ? "input" : "change";
      el.addEventListener(eventName, () => {
        syncAdvancedFiltersButtonState();
        updateClearButtonState();
        renderMarkers();
      });
    });

  // ---- Liste projets ----
  if (elProjListBtn && elProjListMenu) {
    elProjListBtn.setAttribute("aria-expanded", "false");

    elProjListBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setProjectListOpen(elProjListMenu.hidden, { focusSearch: true });
    });

    elProjListSearch?.addEventListener("input", buildProjectList);
    elProjListSort?.addEventListener("change", buildProjectList);

    elProjListItems?.addEventListener("click", (e) => {
      const row = e.target?.closest?.(".projListRow");
      const pid = row?.getAttribute?.("data-pid");
      if (pid) openProjectFromList(pid);
    });

    elProjListItems?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const row = e.target?.closest?.(".projListRow");
      const pid = row?.getAttribute?.("data-pid");
      if (!pid) return;
      e.preventDefault();
      openProjectFromList(pid);
    });

    document.addEventListener("click", (event) => {
      if (elProjListMenu.hidden) return;
      if (elProjListMenu.contains(event.target) || elProjListBtn.contains(event.target)) return;
      setProjectListOpen(false);
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") setProjectListOpen(false);
    });
    elProjListMenu.addEventListener("click", (e) => e.stopPropagation());
  }


  map.on("zoomstart movestart", clearCityLabels);
  map.on("zoomend moveend resize", scheduleCityLabelsRender);

  updateClearButtonState();

  // ---- Load data ----
  (async () => {
    try {
      await loadDepartements();

      const currentProjects = await fetchJson(CURRENT_PROJECTS_URL);

      projectsByMode.current = ensureProjectIds(normalizeProjectsPayload(currentProjects), PROJECT_MODES.current.key);

      reportProjectDataQuality(projectsByMode.current, PROJECT_MODES.current.key);
      updateCompletedYearBounds();

      enrichProjectsWithDepartments(projectsByMode.current);

      setActiveProjectsForMode(currentProjectMode);
      updateProjectModeUi();
      renderMarkers();
      await openProjectFromUrl();

      window.setTimeout(() => {
        refreshAdvancedFilterOptions();
      }, 0);
    } catch (err) {
      console.error(err);
      showStatus(`Erreur de chargement : ${describeLoadError(err)}. Vérifiez les fichiers JSON et la connexion.`);
    }
  })();

  function escapeAttr(s) {
    return escapeHtml(s);
  }
})();

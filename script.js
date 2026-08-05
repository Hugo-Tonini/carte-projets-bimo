// Carte Projets — Leaflet + clustering + départements colorés par antenne
(() => {
  "use strict";

  /*
   * Organisation générale du fichier
   * 1. Gestion globale des erreurs
   * 2. Configuration applicative et métier
   * 3. Références DOM et état applicatif
   * 4. UI de mode projet, timeline et filtres
   * 5. Configuration antennes, types de projet et départements
   * 6. Initialisation Leaflet et contrôles de carte
   * 7. Rendu des antennes, labels, marqueurs, clusters et panneaux
   * 8. Helpers de données, formatage, accessibilité et robustesse
   * 9. Chargement des données et initialisation finale
   *
   * Étape 10 : refactoring volontairement léger.
   * Les blocs n'ont pas été déplacés massivement pour limiter le risque de régression.
   */

  // ---- 1. Gestion globale des erreurs ----
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

  // ---- 2. Configuration applicative ----
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
  const COMPLETED_YEAR_DEFAULT_MIN = 2008;
  const COMPLETED_YEAR_DEFAULT_MAX = 2024;
  let COMPLETED_YEAR_MIN = COMPLETED_YEAR_DEFAULT_MIN;
  let COMPLETED_YEAR_MAX = COMPLETED_YEAR_DEFAULT_MAX;

  // ---- 3. Références DOM ----
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
  const elFilterBtn = document.getElementById("filterBtn");
  const elFilterMenu = document.getElementById("filterMenu");
  const elDisplayFiltersHost = document.getElementById("displayFiltersHost");
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


  // ---- 4. État applicatif ----
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
  let projectLabelsEnabled = false;
  let projectPinSizeScale = 1;
  let projectClusterDistanceScale = 1;

  // Focus antenne (pour foncer les départements de l’antenne sélectionnée)
  let selectedAntenna = null;

  // Pin sélectionné (pour surligner/agrandir)
  let selectedMarker = null;
  let projectIdToMarker = new Map(); // "Code projet" -> Leaflet marker
  let projectIdToName = new Map();  // "Code projet" -> Nom réel du projet (tooltips clusters)
  let projectListDirty = true;
  let completedProjectsLoadFailed = false;
  let completedProjectsLoaded = false;
  let completedProjectsLoadPromise = null;
  let suppressProjectUrlUpdate = false;
  let completedTimelineOutOfRangeReported = false;
  let mapLabelsRenderFrame = 0;

  function markerElement(marker) {
    if (!marker || typeof marker.getElement !== "function") return null;
    try {
      return marker.getElement() || null;
    } catch (err) {
      console.warn("[BIMO] Élément de marqueur inaccessible", err);
      return null;
    }
  }

  function clearSelectedMarker() {
    markerElement(selectedMarker)?.classList.remove("selected");
    selectedMarker = null;
  }

  function setSelectedMarker(marker) {
    clearSelectedMarker();

    if (!marker || typeof marker.getElement !== "function") {
      selectedMarker = null;
      return;
    }

    selectedMarker = marker;
    markerElement(marker)?.classList.add("selected");
  }

  // ---- 5. UI de mode projet, timeline et état des filtres ----
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


  function ensureProjectModeButtonLabels() {
    if (!elProjectModeSwitch) return;

    const modeButtons = elProjectModeSwitch.querySelectorAll(".projectModeBtn");
    modeButtons.forEach((btn) => {
      if (btn.querySelector(".projectModeBtnLabel")) return;

      const text = String(btn.textContent || "").trim();
      btn.textContent = "";

      const label = document.createElement("span");
      label.className = "projectModeBtnLabel";
      label.textContent = text;

      btn.appendChild(label);
    });
  }

  function syncToolbarControlHeights() {
    ensureProjectModeButtonLabels();
    if (!elProjectModeSwitch) return;

    const referenceButton = elClear || elProjListBtn;
    const referenceHeight = Math.round(referenceButton?.getBoundingClientRect?.().height || 0);
    if (!referenceHeight) return;

    document.documentElement.style.setProperty("--bimo-toolbar-control-height", `${referenceHeight}px`);

    if (elCompletedPlayBtn) {
      const playButtonSize = Math.max(Math.round(referenceHeight * 0.9), 28);
      document.documentElement.style.setProperty("--bimo-completed-play-size", `${playButtonSize}px`);
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
    let completedOutsideTimeline = 0;
    const completedOutsideTimelineYears = new Set();
    const unknownAntennas = new Set();

    for (const project of projects) {
      const pid = projectId(project);
      if (pid) {
        if (seenIds.has(pid)) duplicateIds.add(pid);
        seenIds.add(pid);
      }

      const name = String(project["Nom de projet"] ?? project.nom ?? "").trim();
      if (!name) missingNames += 1;

      const antenna = String(project["Antenne"] ?? project.antenne ?? "").trim();
      if (antenna && !antennaKeyFromText(antenna)) unknownAntennas.add(antenna);

      if (!projectLatLon(project)) missingCoordinates += 1;
      if (modeKey === PROJECT_MODES.completed.key && projectStartYear(project) == null && projectEndYear(project) == null) {
        completedWithoutDates += 1;
      }
      if (modeKey === PROJECT_MODES.completed.key && isCompletedProjectOutsideTimelineRange(project)) {
        completedOutsideTimeline += 1;
        for (const year of completedProjectYearValues(project)) completedOutsideTimelineYears.add(year);
      }
    }

    if (duplicateIds.size) {
      console.warn(`[BIMO] ${duplicateIds.size} identifiant(s) projet en doublon (${modeKey}) :`, Array.from(duplicateIds));
    }
    if (unknownAntennas.size) {
      console.warn(`[BIMO] ${unknownAntennas.size} antenne(s) inconnue(s) dans les données (${modeKey}) :`, Array.from(unknownAntennas));
    }

    if (missingNames || missingCoordinates || completedWithoutDates || completedOutsideTimeline || unknownAntennas.size) {
      console.info(`[BIMO] Qualité des données (${modeKey})`, {
        projets: projects.length,
        sansNom: missingNames,
        sansCoordonnees: missingCoordinates,
        finisSansDates: completedWithoutDates,
        finisHorsPeriodeTimeline: completedOutsideTimeline,
        anneesHorsPeriodeTimeline: Array.from(completedOutsideTimelineYears).sort((a, b) => a - b),
        antennesInconnues: unknownAntennas.size
      });
    }
  }

  function setActiveProjectsForMode(modeKey) {
    allProjects = Array.isArray(projectsByMode[modeKey]) ? projectsByMode[modeKey] : [];
    projectIdToName = new Map();
    for (const p of allProjects) {
      const pid = projectId(p);
      const nm = projectDisplayName(p);
      if (pid && nm) projectIdToName.set(pid, nm);
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

  // ---- 6. Configuration métier : antennes et types de projet ----
  const ANTENNA_CONFIG = Object.freeze({
    "Alpes Centre-Est": {
      label: "Alpes Centre-Est",
      color: "#8B5CF6",
      summaryPlacement: { point: [45.35, 7.75], align: "outside-east" }
    },
    "Atlantique Grand-Ouest": {
      label: "Atlantique Grand-Ouest",
      color: "#3B82F6",
      summaryPlacement: { point: [47.05, -4.75], align: "outside-west" }
    },
    "Grand Sud-Ouest": {
      label: "Grand Sud-Ouest",
      color: "#F59E0B",
      summaryPlacement: { point: [44.05, -2.55], align: "outside-west" }
    },
    "Méditerranée Grand-Sud": {
      label: "Méditerranée Grand-Sud",
      color: "#36540e",
      summaryPlacement: { point: [42.85, 6.30], align: "outside-south" }
    },
    "Nord-Est": {
      label: "Nord-Est",
      color: "#10B981",
      summaryPlacement: { point: [48.95, 8.15], align: "outside-east" }
    },
    "Nord-Ouest Île-de-France": {
      label: "Nord-Ouest Île-de-France",
      color: "#EF4444",
      summaryPlacement: { point: [49.72, -1.95], align: "outside-west" }
    },
    "Siège": {
      label: "Siège",
      color: "#111827",
      summaryPlacement: null,
      includeInLegend: false,
      includeInSummary: false
    }
  });

  const ANTENNA_KEYS = Object.freeze(Object.keys(ANTENNA_CONFIG));
  const ANTENNA_LEGEND_ORDER = Object.freeze(ANTENNA_KEYS.filter((antenna) => ANTENNA_CONFIG[antenna]?.includeInLegend !== false));

  function antennaKeyFromText(value) {
    const text = normalizeForLookup(value);
    if (!text) return "";
    return ANTENNA_KEYS.find((antenna) => normalizeForLookup(antenna) === text) || "";
  }

  function antennaConfigByName(antennaName) {
    const key = antennaKeyFromText(antennaName);
    return key ? ANTENNA_CONFIG[key] : null;
  }

  function antennaColorByName(antennaName, fallback = "#FFFFFF") {
    return antennaConfigByName(antennaName)?.color || fallback;
  }

  function antennaSummaryPlacementByName(antennaName) {
    return antennaConfigByName(antennaName)?.summaryPlacement || null;
  }

  function antennaDisplayLabel(antennaName) {
    return antennaConfigByName(antennaName)?.label || String(antennaName || "").trim();
  }

  function renderLegendAntennas() {
    if (!elLegendAntennas) return;

    elLegendAntennas.innerHTML = ANTENNA_LEGEND_ORDER.map((antenna) => {
      const color = antennaColorByName(antenna);
      const label = antennaDisplayLabel(antenna);
      return `
        <div class="legend-row" data-antenna="${escapeAttr(antenna)}">
          <span class="swatch" style="background:${escapeAttr(color)};"></span>
          <span>${escapeHtml(label)}</span>
        </div>
      `;
    }).join("");
  }

  const PROJECT_TYPE_CONFIG = Object.freeze({
    mom: { key: "mom", label: "MOM", color: "blue", aliases: ["mom"] },
    amo: { key: "amo", label: "AMO", color: "red", aliases: ["amo"] },
    exp: { key: "exp", label: "EXP", color: "green", aliases: ["exp"] }
  });

  const PROJECT_TYPE_FILTER_KEYS = Object.freeze(["mom", "amo", "exp"]);
  const PROJECT_TYPE_CLUSTER_ORDER = Object.freeze(["amo", "mom", "exp"]);

  const PROJECT_TYPE_COLORS = Object.freeze(Object.fromEntries(
    Object.entries(PROJECT_TYPE_CONFIG).map(([key, config]) => [key, config.color])
  ));

  const PROJECT_TYPE_LABELS = Object.freeze(Object.fromEntries(
    Object.entries(PROJECT_TYPE_CONFIG).map(([key, config]) => [key, config.label])
  ));

  function projectTypeConfigByKey(typeKey) {
    const key = String(typeKey || "").toLowerCase().trim();
    return PROJECT_TYPE_CONFIG[key] || PROJECT_TYPE_CONFIG.mom;
  }

  function projectTypeColorByKey(typeKey) {
    return projectTypeConfigByKey(typeKey).color;
  }

  function projectTypeLabelByKey(typeKey) {
    return projectTypeConfigByKey(typeKey).label;
  }

  function projectTypeKeyFromText(value) {
    const text = normalizeForLookup(value);
    if (!text) return PROJECT_TYPE_CONFIG.mom.key;

    for (const key of PROJECT_TYPE_FILTER_KEYS) {
      const config = PROJECT_TYPE_CONFIG[key];
      if (config.aliases.some((alias) => text.includes(alias))) return config.key;
    }

    return PROJECT_TYPE_CONFIG.mom.key;
  }

  function syncProjectTypeLegendColors() {
    if (!elLegend) return;

    const rows = Array.from(elLegend.querySelectorAll(".legend-row"));
    for (const row of rows) {
      const swatch = row.querySelector(".pin-swatch");
      if (!swatch) continue;

      const explicitType = String(swatch.dataset?.type || row.dataset?.type || "").toLowerCase().trim();
      const typeKey = PROJECT_TYPE_CONFIG[explicitType]
        ? explicitType
        : projectTypeKeyFromText(row.textContent || "");
      const color = projectTypeColorByKey(typeKey);

      if (color) swatch.style.borderColor = color;
    }
  }

  // ---- 7. Configuration métier : correspondances départements / antennes ----
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

  // ---- 8. Initialisation Leaflet ----
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

  // ---- 9. Contrôles Leaflet personnalisés ----
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

  function clampProjectPinSizeScale(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0.6, Math.min(1.8, Math.round(n * 10) / 10));
  }

  function projectPinSize(baseSize) {
    return Math.max(6, Math.round(baseSize * projectPinSizeScale));
  }

  function projectPinTransformStyle() {
    return `transform:scale(${projectPinSizeScale});transform-origin:center center;`;
  }

  function clampProjectClusterDistanceScale(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0.4, Math.min(4, Math.round(n * 10) / 10));
  }

  function projectClusterMaxRadius() {
    return Math.max(1, Math.round(10 * projectClusterDistanceScale));
  }

  function rerenderProjectClustersAfterDistanceChange() {
    renderMarkers();
    scheduleCityLabelsRender();
  }


  function rerenderProjectPinsAfterSizeChange() {
    renderMarkers();
    scheduleCityLabelsRender();
  }

  function initProjectPinSizeControls(afterElement) {
    if (document.getElementById("projectPinSizeControls")) {
      initProjectClusterDistanceControls(document.getElementById("projectPinSizeControls")?.closest(".displayFilterControlRow"));
      return;
    }

    const row = document.createElement("div");
    row.className = "displayFilterControlRow";

    const label = document.createElement("span");
    label.className = "displayFilterControlLabel";
    label.textContent = "Taille des pins";

    const wrap = document.createElement("span");
    wrap.id = "projectPinSizeControls";
    wrap.className = "projectPinSizeControls";
    wrap.setAttribute("aria-label", "Taille des pins projets");

    const btnMinus = document.createElement("button");
    btnMinus.type = "button";
    btnMinus.className = "projectPinSizeBtn projectPinSizeBtn--minus";
    btnMinus.innerHTML = '<span class="projectPinSizeGlyph projectPinSizeGlyph--minus" aria-hidden="true"></span>';
    btnMinus.setAttribute("aria-label", "Diminuer la taille des pins projets");

    const btnReset = document.createElement("button");
    btnReset.type = "button";
    btnReset.className = "projectPinSizeBtn projectPinSizeBtn--reset";
    btnReset.innerHTML = '<span class="projectPinSizeGlyph" aria-hidden="true">O</span>';
    btnReset.setAttribute("aria-label", "Revenir à la taille originale des pins projets");

    const btnPlus = document.createElement("button");
    btnPlus.type = "button";
    btnPlus.className = "projectPinSizeBtn projectPinSizeBtn--plus";
    btnPlus.innerHTML = '<span class="projectPinSizeGlyph projectPinSizeGlyph--plus" aria-hidden="true"></span>';
    btnPlus.setAttribute("aria-label", "Augmenter la taille des pins projets");

    wrap.appendChild(btnMinus);
    wrap.appendChild(btnReset);
    wrap.appendChild(btnPlus);
    row.appendChild(label);
    row.appendChild(wrap);

    const sync = () => {
      const pct = Math.round(projectPinSizeScale * 100);
      btnMinus.disabled = projectPinSizeScale <= 0.6;
      btnPlus.disabled = projectPinSizeScale >= 1.8;
      btnReset.disabled = projectPinSizeScale === 1;
      btnReset.classList.toggle("is-active", projectPinSizeScale === 1);
      btnMinus.title = `Taille actuelle : ${pct} %`;
      btnReset.title = "Revenir à 100 %";
      btnPlus.title = `Taille actuelle : ${pct} %`;
    };

    const setScale = (nextScale) => {
      const clamped = clampProjectPinSizeScale(nextScale);
      if (clamped === projectPinSizeScale) {
        sync();
        return;
      }
      projectPinSizeScale = clamped;
      sync();
      rerenderProjectPinsAfterSizeChange();
    };

    btnMinus.addEventListener("click", () => setScale(projectPinSizeScale - 0.1));
    btnReset.addEventListener("click", () => setScale(1));
    btnPlus.addEventListener("click", () => setScale(projectPinSizeScale + 0.1));

    const insertionAnchor = afterElement?.closest?.(".displayFilterControlRow") || afterElement;
    if (insertionAnchor?.insertAdjacentElement) {
      insertionAnchor.insertAdjacentElement("afterend", row);
    } else {
      const target = document.getElementById("projectLabelsToggle")?.closest("label")
        || document.getElementById("cityLabelsToggle")?.closest("label")
        || document.getElementById("officesToggle")?.closest("label");
      if (target?.insertAdjacentElement) target.insertAdjacentElement("afterend", row);
    }

    sync();
  }


  function initProjectClusterDistanceControls(afterElement) {
    if (document.getElementById("projectClusterDistanceControls")) return;

    const row = document.createElement("div");
    row.className = "displayFilterControlRow";

    const label = document.createElement("span");
    label.className = "displayFilterControlLabel";
    label.textContent = "Regroupement des pins";

    const wrap = document.createElement("span");
    wrap.id = "projectClusterDistanceControls";
    wrap.className = "projectClusterDistanceControls";
    wrap.setAttribute("aria-label", "Distance de regroupement des clusters projets");
    wrap.title = "Distance clusters";

    const btnMinus = document.createElement("button");
    btnMinus.type = "button";
    btnMinus.className = "projectPinSizeBtn projectPinSizeBtn--minus projectClusterDistanceBtn projectClusterDistanceBtn--minus";
    btnMinus.innerHTML = '<span class="projectPinSizeGlyph projectPinSizeGlyph--minus" aria-hidden="true"></span>';
    btnMinus.setAttribute("aria-label", "Diminuer la distance de regroupement des clusters projets");

    const btnReset = document.createElement("button");
    btnReset.type = "button";
    btnReset.className = "projectPinSizeBtn projectPinSizeBtn--reset projectClusterDistanceBtn projectClusterDistanceBtn--reset";
    btnReset.innerHTML = '<span class="projectPinSizeGlyph" aria-hidden="true">O</span>';
    btnReset.setAttribute("aria-label", "Revenir à la distance originale de regroupement des clusters projets");

    const btnPlus = document.createElement("button");
    btnPlus.type = "button";
    btnPlus.className = "projectPinSizeBtn projectPinSizeBtn--plus projectClusterDistanceBtn projectClusterDistanceBtn--plus";
    btnPlus.innerHTML = '<span class="projectPinSizeGlyph projectPinSizeGlyph--plus" aria-hidden="true"></span>';
    btnPlus.setAttribute("aria-label", "Augmenter la distance de regroupement des clusters projets");

    wrap.appendChild(btnMinus);
    wrap.appendChild(btnReset);
    wrap.appendChild(btnPlus);
    row.appendChild(label);
    row.appendChild(wrap);

    const sync = () => {
      const pct = Math.round(projectClusterDistanceScale * 100);
      btnMinus.disabled = projectClusterDistanceScale <= 0.4;
      btnPlus.disabled = projectClusterDistanceScale >= 4;
      btnReset.disabled = projectClusterDistanceScale === 1;
      btnReset.classList.toggle("is-active", projectClusterDistanceScale === 1);
      btnMinus.title = `Distance clusters : ${pct} %`;
      btnReset.title = "Revenir à la distance clusters originale";
      btnPlus.title = `Distance clusters : ${pct} %`;
    };

    const setScale = (nextScale) => {
      const clamped = clampProjectClusterDistanceScale(nextScale);
      if (clamped === projectClusterDistanceScale) {
        sync();
        return;
      }
      projectClusterDistanceScale = clamped;
      sync();
      rerenderProjectClustersAfterDistanceChange();
    };

    btnMinus.addEventListener("click", () => setScale(projectClusterDistanceScale - 0.1));
    btnReset.addEventListener("click", () => setScale(1));
    btnPlus.addEventListener("click", () => setScale(projectClusterDistanceScale + 0.1));

    const insertionAnchor = afterElement?.closest?.(".displayFilterControlRow") || afterElement;
    if (insertionAnchor?.insertAdjacentElement) {
      insertionAnchor.insertAdjacentElement("afterend", row);
    } else {
      const target = document.getElementById("projectPinSizeControls")?.closest(".displayFilterControlRow")
        || document.getElementById("projectLabelsToggle")?.closest("label")
        || document.getElementById("cityLabelsToggle")?.closest("label")
        || document.getElementById("officesToggle")?.closest("label");
      if (target?.insertAdjacentElement) target.insertAdjacentElement("afterend", row);
    }

    sync();
  }




  const clusters = L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 10,
    spiderfyOnMaxZoom: true,
    maxClusterRadius: () => projectClusterMaxRadius(),
    spiderfyDistanceMultiplier: 3.5,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    iconCreateFunction: (cluster) => {
      const children = cluster.getAllChildMarkers();
      const count = cluster.getChildCount();
      const colorCounts = new Map();

      for (const marker of children) {
        const color = String(marker?.options?.__bimoType || PROJECT_TYPE_COLORS.mom).trim();
        if (!color) continue;
        colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
      }

      const orderedColors = PROJECT_TYPE_CLUSTER_ORDER
        .map((typeKey) => PROJECT_TYPE_COLORS[typeKey])
        .filter(Boolean);
      const slices = [];

      for (const color of orderedColors) {
        const sliceCount = colorCounts.get(color) || 0;
        if (sliceCount > 0) slices.push({ color, count: sliceCount });
      }

      for (const [color, sliceCount] of colorCounts.entries()) {
        if (!orderedColors.includes(color) && sliceCount > 0) {
          slices.push({ color, count: sliceCount });
        }
      }

      const total = slices.reduce((sum, item) => sum + item.count, 0) || children.length || 1;
      const segments = [];
      let cursor = 0;

      if (slices.length === 1) {
        segments.push({ color: slices[0].color, start: 0, length: 100 });
      } else if (slices.length > 1) {
        slices.forEach((item, index) => {
          const start = cursor;
          const end = index === slices.length - 1 ? 100 : cursor + (item.count / total) * 100;
          cursor = end;
          segments.push({ color: item.color, start, length: Math.max(0, end - start) });
        });
      } else {
        segments.push({ color: PROJECT_TYPE_COLORS.mom, start: 0, length: 100 });
      }

      const ringSegments = segments
        .filter((segment) => segment.length > 0)
        .map((segment) => {
          const length = Math.min(100, Math.max(0, segment.length));
          const gap = Math.max(0, 100 - length);
          return `
            <circle class="pin-dot-cluster-ring"
              cx="9" cy="9" r="7"
              fill="none"
              stroke="${escapeAttr(segment.color)}"
              stroke-width="4"
              pathLength="100"
              stroke-dasharray="${length.toFixed(3)} ${gap.toFixed(3)}"
              stroke-dashoffset="${(-segment.start).toFixed(3)}"
              transform="rotate(-90 9 9)" />`;
        })
        .join("");

      const clusterSvg = `
        <svg class="pin-dot-cluster-svg" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          ${ringSegments}
          <circle class="pin-dot-cluster-center" cx="9" cy="9" r="5" />
        </svg>
      `;

      return L.divIcon({
        className: "pin-dot pin-dot-cluster-wrap",
        html: `<div class="projectPinScaleWrap"><div class="pin-dot-inner pin-dot-cluster" style="${projectPinTransformStyle()}">${clusterSvg}<span class="pin-dot-count">${count}</span></div></div>`,
        iconSize: [projectPinSize(32), projectPinSize(32)],
        iconAnchor: [projectPinSize(16), projectPinSize(16)]
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

  // Les styles des labels et contrôles personnalisés sont maintenant centralisés dans style.css.


// Tooltip (survol) : liste des projets dans un cluster
clusters.on("clustermouseover", (a) => {
  const cl = a.layer;
  const kids = cl.getAllChildMarkers();
  const typeKeys = new Set();

  for (const m of kids) {
    const typeKey = String(m?.options?.__bimoTypeKey || "").trim();
    if (typeKey) typeKeys.add(typeKey);
  }

  const hasMultipleProjectTypes = typeKeys.size > 1;
  const names = [];

  for (const m of kids) {
    const pid = m?.options?.__projId;
    const nm = pid ? (projectIdToName.get(pid) || "") : "";
    if (!nm) continue;

    const typeLabel = projectTypeLabelByKey(m?.options?.__bimoTypeKey);
    names.push({
      name: nm,
      label: hasMultipleProjectTypes && typeLabel ? `${nm} (${typeLabel})` : nm
    });
  }

  names.sort((x, y) => x.name.localeCompare(y.name, "fr", { sensitivity: "base", numeric: true }));
  const max = 25;
  // 1 ligne = 1 projet (pas de retour à la ligne automatique à l'intérieur d'un nom)
  let html = names
    .slice(0, max)
    .map((item) => `<div class="ttLine">${escapeHtml(item.label)}</div>`)
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


  // ---- 10. Pins fixes : siège et antennes ----
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
          const name = projectDisplayName(p);
          const typ = displayOrDash(p["Type de projet"] ?? p.type);
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
    normalizeToolbarCheckboxLabel(wrap);
    normalizeToolbarCheckboxLabel(wrap);
    normalizeToolbarCheckboxLabel(wrap);

    if (afterElement?.insertAdjacentElement) {
      afterElement.insertAdjacentElement("afterend", wrap);
    } else {
      const typeFilters = Array.from(document.querySelectorAll(".typeFilter"));
      const last = typeFilters[typeFilters.length - 1];
      const host = last?.closest("label")?.parentElement || last?.parentElement || last;
      if (host?.appendChild) host.appendChild(wrap);
    }

    cityLabelsEnabled = false;
    initProjectLabelsToggle(wrap);
    scheduleCityLabelsRender();

    cb.addEventListener("change", () => {
      cityLabelsEnabled = !!cb.checked;
      scheduleCityLabelsRender();
    });
  }



  function normalizeToolbarCheckboxLabel(label) {
    if (!label) return;

    label.classList.add("toolbarCheckboxLabel");

    const checkbox = label.querySelector('input[type="checkbox"]');
    if (!checkbox) return;

    const directNodes = Array.from(label.childNodes).filter((node) => node !== checkbox);
    if (!directNodes.length) return;

    if (
      directNodes.length === 1 &&
      directNodes[0].nodeType === Node.ELEMENT_NODE &&
      directNodes[0].classList?.contains("toolbarCheckboxText")
    ) {
      return;
    }

    if (
      directNodes.length === 1 &&
      directNodes[0].nodeType === Node.ELEMENT_NODE &&
      directNodes[0].tagName === "SPAN"
    ) {
      directNodes[0].classList.add("toolbarCheckboxText");
      return;
    }

    const textWrap = document.createElement("span");
    textWrap.className = "toolbarCheckboxText";

    directNodes.forEach((node) => textWrap.appendChild(node));
    label.appendChild(textWrap);
  }

  function normalizeToolbarCheckboxes() {
    document.querySelectorAll(".typeFilter").forEach((input) => {
      normalizeToolbarCheckboxLabel(input.closest("label"));
    });

    document.querySelectorAll(".officesToggle, .cityLabelsToggle, .projectLabelsToggle").forEach((label) => {
      normalizeToolbarCheckboxLabel(label);
    });
  }

  function initProjectLabelsToggle(afterElement) {
    if (document.getElementById("projectLabelsToggle")) {
      initProjectPinSizeControls(document.getElementById("projectLabelsToggle")?.closest("label"));
      scheduleCityLabelsRender();
      return;
    }

    const wrap = document.createElement("label");
    wrap.className = "toggle projectLabelsToggle";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = "projectLabelsToggle";
    cb.className = "projectLabelsToggleInput";
    cb.checked = false;

    const span = document.createElement("span");
    span.textContent = "Noms des projets";

    wrap.appendChild(cb);
    wrap.appendChild(span);

    if (afterElement?.insertAdjacentElement) {
      afterElement.insertAdjacentElement("afterend", wrap);
    } else {
      const cityToggle = document.getElementById("cityLabelsToggle")?.closest("label");
      if (cityToggle?.insertAdjacentElement) cityToggle.insertAdjacentElement("afterend", wrap);
    }

    projectLabelsEnabled = false;
    initProjectPinSizeControls(wrap);
    window.setTimeout(() => {
      initProjectClusterDistanceControls(document.getElementById("projectPinSizeControls") || wrap);
    }, 0);
    scheduleCityLabelsRender();

    cb.addEventListener("change", () => {
      projectLabelsEnabled = !!cb.checked;
      scheduleCityLabelsRender();
    });
  }

  function initOfficesToggle() {
    // Les options d’affichage sont regroupées dans le menu principal « Filtre ».
    const typeFilters = Array.from(document.querySelectorAll(".typeFilter"));
    const last = typeFilters[typeFilters.length - 1] || null;
    const host = elDisplayFiltersHost
      || last?.closest("label")?.parentElement
      || last?.parentElement
      || last;

    if (!host) {
      initCityLabelsToggle(null);
      renderOffices();
      return;
    }

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
    if (host === elDisplayFiltersHost) host.appendChild(wrap);
    else host.insertAdjacentElement("afterend", wrap);
    initCityLabelsToggle(wrap);

    cb.addEventListener("change", () => {
      officesEnabled = !!cb.checked;
      renderOffices();
    });

    renderOffices();
  }

  map.on("click", () => closePanel());

  // ---- 11. Helpers données, formatage et filtres ----
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

  function cleanText(value) {
    if (value === undefined || value === null) return "";
    return String(value).trim();
  }

  function firstNonEmpty(...values) {
    for (const value of values) {
      const text = cleanText(value);
      if (text) return text;
    }
    return "";
  }

  function displayOrDash(value) {
    return firstNonEmpty(value) || "—";
  }


  const PROJECT_FIELD_ALIASES = Object.freeze({
    buildingType: [
      "Type de bâtiment",
      "Type de batiment",
      "type_batiment"
    ],
    energyBefore: [
      "Consommation énergétique - avant travaux",
      "Consommation énergetique - avant travaux",
      "Consommation energetique - avant travaux",
      "Consommation énergétique - existant",
      "Consommation énergetique - existant",
      "Consommation energetique - existant"
    ],
    energyAfter: [
      "Consommation énergétique - après travaux",
      "Consommation énergétique - Après travaux",
      "Consommation énergetique - après travaux",
      "Consommation énergetique - Après travaux",
      "Consommation energetique - apres travaux",
      "Consommation énergétique - objectif",
      "Consommation énergetique - objectif",
      "Consommation energetique - objectif"
    ],
    gesBefore: [
      "Émission GES - avant travaux",
      "Emission GES - avant travaux",
      "Émissions GES - avant travaux",
      "Emissions GES - avant travaux",
      "GES - avant travaux"
    ],
    gesAfter: [
      "Émission GES - après travaux",
      "Émission GES - Après travaux",
      "Emission GES - après travaux",
      "Emission GES - Après travaux",
      "Émissions GES - après travaux",
      "Émissions GES - Après travaux",
      "Emissions GES - après travaux",
      "Emissions GES - Après travaux",
      "GES - après travaux",
      "GES - Après travaux"
    ]
  });

  function projectFieldValue(project, aliases) {
    const source = project && typeof project === "object" ? project : {};
    const fields = Array.isArray(aliases) ? aliases : [aliases];

    for (const field of fields) {
      if (!field) continue;
      const value = source[field];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return value;
      }
    }

    return "";
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
    return projectTypeKeyFromText(projectType(p));
  }

  function getActiveSummaryTypes() {
    return Array.from(document.querySelectorAll(".typeFilter:checked"))
      .map((x) => String(x.value || "").toLowerCase().trim())
      .filter((value) => PROJECT_TYPE_FILTER_KEYS.includes(value));
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
      summaries.set(antenna, {
        ...Object.fromEntries(PROJECT_TYPE_FILTER_KEYS.map((key) => [key, 0])),
        momAmount: 0
      });
    }

    for (const project of filteredProjectsForAntennaSummary()) {
      const antenna = antennaKeyFromText(project["Antenne"] ?? project.antenne);
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
          return `${count} ${projectTypeLabelByKey(typeKey)}`;
        })
        .filter(Boolean);

      if (!lines.length) continue;

      const placement = antennaSummaryPlacementByName(antenna);
      if (!placement?.point) continue;

      visibleCards += 1;
      const color = antennaColorByName(antenna, "#fff");
      const isSelected = selectedAntenna === antenna;
      const displayLabel = antennaDisplayLabel(antenna);
      const title = antenna === "Nord-Ouest Île-de-France" ? "Nord-Ouest<br>Île-de-France" : escapeHtml(displayLabel);
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
        const el = markerElement(marker);
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

  function renderCityLabels(options = {}) {
    if (!cityLabelsOverlay || !cityLabelsHtml || !cityLabelsSvg) return [];

    const preserveExisting = !!options.preserveExisting;
    setCityLabelsOverlaySize();
    if (!preserveExisting) {
      cityLabelsHtml.innerHTML = "";
      cityLabelsSvg.replaceChildren();
    }

    if (!cityLabelsEnabled) {
      if (!preserveExisting) cityLabelsOverlay.hidden = true;
      return [];
    }

    cityLabelsOverlay.hidden = false;

    const projects = filteredProjects()
      .map((project) => ({
        project,
        city: projectCity(project),
        ll: projectLatLon(project)
      }))
      .filter((entry) => entry.city && entry.ll);

    if (!projects.length) return [];

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

    return placedRects;
  }


  function projectRawIdentifier(project) {
    const source = project && typeof project === "object" ? project : {};
    return firstNonEmpty(
      source["Code projet"],
      source["ID"],
      source.code_projet,
      source.codeProjet,
      source.id
    );
  }

  function projectDisplayName(project) {
    const source = project && typeof project === "object" ? project : {};
    return firstNonEmpty(
      source["Nom de projet"],
      source.nom
    );
  }

  function renderProjectLabels(existingPlacedRects = []) {
    if (!projectLabelsEnabled || !cityLabelsOverlay || !cityLabelsHtml || !cityLabelsSvg) return existingPlacedRects;

    const projects = filteredProjects()
      .map((project) => ({
        project,
        name: projectDisplayName(project),
        ll: projectLatLon(project)
      }))
      .filter((entry) => entry.name && entry.ll);

    if (!projects.length) return existingPlacedRects;

    const { width: mapWidth, height: mapHeight } = setCityLabelsOverlaySize();
    const blockedRects = getAntennaSummaryRects();

    for (const entry of projects) {
      const pt = map.latLngToContainerPoint(entry.ll);
      blockedRects.push(makeRect(pt.x - 14, pt.y - 14, 28, 28));
    }

    const measured = projects.map((entry) => {
      const el = document.createElement("div");
      el.className = "cityLabel projectLabel";
      el.textContent = entry.name;
      el.style.visibility = "hidden";
      el.style.transform = "translate(-9999px, -9999px)";
      cityLabelsHtml.appendChild(el);

      const rect = el.getBoundingClientRect();
      return {
        entry,
        el,
        width: Math.ceil(Math.min(rect.width || 90, 260)),
        height: Math.ceil(rect.height || 24)
      };
    });

    const placedRects = Array.isArray(existingPlacedRects) ? existingPlacedRects.slice() : [];

    function buildProjectPlacementCandidates(labelWidth, labelHeight) {
      const halfW = Math.round(labelWidth / 2);
      const halfH = Math.round(labelHeight / 2);
      const aboveY = -(halfH + 17);
      const belowY = halfH + 17;
      const sideX = halfW + 17;

      const direct = [
        [0, aboveY],
        [Math.round(halfW * 0.25), aboveY],
        [-Math.round(halfW * 0.25), aboveY],
        [sideX, 0],
        [-sideX, 0],
        [0, belowY],
        [Math.round(halfW * 0.35), belowY],
        [-Math.round(halfW * 0.35), belowY]
      ];

      const nearbyWithLeader = [
        [Math.round(halfW * 0.7), aboveY - 8],
        [-Math.round(halfW * 0.7), aboveY - 8],
        [sideX + 18, -Math.round(halfH * 0.25)],
        [-(sideX + 18), -Math.round(halfH * 0.25)],
        [sideX + 18, Math.round(halfH * 0.75)],
        [-(sideX + 18), Math.round(halfH * 0.75)],
        [0, aboveY - 20],
        [0, belowY + 20]
      ];

      const fallback = [
        [sideX + 48, aboveY - 18],
        [-(sideX + 48), aboveY - 18],
        [sideX + 68, 0],
        [-(sideX + 68), 0],
        [sideX + 48, belowY + 18],
        [-(sideX + 48), belowY + 18],
        [0, aboveY - 44],
        [0, belowY + 44]
      ];

      return [
        ...direct.map((offset) => ({ offset, leader: false })),
        ...nearbyWithLeader.map((offset) => ({ offset, leader: true })),
        ...fallback.map((offset) => ({ offset, leader: true }))
      ];
    }

    function findProjectPlacement(anchorPoint, labelWidth, labelHeight) {
      const candidates = buildProjectPlacementCandidates(labelWidth, labelHeight);

      for (const candidate of candidates) {
        const [dx, dy] = candidate.offset;
        const centerX = anchorPoint.x + dx;
        const centerY = anchorPoint.y + dy;
        const rect = makeRect(centerX - labelWidth / 2, centerY - labelHeight / 2, labelWidth, labelHeight);

        if (!rectInsideMap(rect, mapWidth, mapHeight, 4)) continue;
        if (placedRects.some((placed) => rectsOverlap(rect, placed, 3))) continue;
        if (blockedRects.some((blocked) => rectsOverlap(rect, blocked, 2))) continue;

        return { rect, leader: candidate.leader };
      }

      return null;
    }

    for (const item of measured) {
      const anchorPoint = map.latLngToContainerPoint(item.entry.ll);
      const placement = findProjectPlacement(anchorPoint, item.width, item.height);

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
        const labelEdgeX = Math.max(placement.rect.left, Math.min(anchorPoint.x, placement.rect.right));
        const labelEdgeY = Math.max(placement.rect.top, Math.min(anchorPoint.y, placement.rect.bottom));

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.classList.add("projectLabelLine");
        line.setAttribute("x1", String(Math.round(anchorPoint.x)));
        line.setAttribute("y1", String(Math.round(anchorPoint.y - 11)));
        line.setAttribute("x2", String(Math.round(labelEdgeX)));
        line.setAttribute("y2", String(Math.round(labelEdgeY)));
        cityLabelsSvg.appendChild(line);
      }
    }

    return placedRects;
  }

  function renderMapLabels() {
    if (!cityLabelsOverlay || !cityLabelsHtml || !cityLabelsSvg) return;

    setCityLabelsOverlaySize();
    cityLabelsHtml.innerHTML = "";
    cityLabelsSvg.replaceChildren();

    if (!cityLabelsEnabled && !projectLabelsEnabled) {
      cityLabelsOverlay.hidden = true;
      return;
    }

    cityLabelsOverlay.hidden = false;

    const placed = cityLabelsEnabled ? renderCityLabels({ preserveExisting: true }) : [];
    renderProjectLabels(placed);
  }


  function scheduleCityLabelsRender() {
    if (mapLabelsRenderFrame) return;

    mapLabelsRenderFrame = window.requestAnimationFrame(() => {
      mapLabelsRenderFrame = window.requestAnimationFrame(() => {
        mapLabelsRenderFrame = 0;
        renderMapLabels();
      });
    });
  }


  function projectId(p) {
    const source = p && typeof p === "object" ? p : {};
    return String(source.__projectId ?? source["Code projet"] ?? source["ID"] ?? source.code_projet ?? source.codeProjet ?? source.id ?? "").trim();
  }

  function projectListLabel(p) {
    const source = p && typeof p === "object" ? p : {};
    const nom = projectDisplayName(source);
    const typ = displayOrDash(source["Type de projet"] ?? source.type);
    const ant = displayOrDash(source["Antenne"] ?? source.antenne);
    const mnt = formatEuro(source["Montant"] ?? source.montant) || "—";
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

    if (!marker || typeof marker.getLatLng !== "function") {
      clearSelectedMarker();
      if (p) showPanel(p);
      setProjectListOpen(false);
      return;
    }

    const ll = marker.getLatLng();
    if (!ll || !Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)) {
      clearSelectedMarker();
      if (p) showPanel(p);
      setProjectListOpen(false);
      return;
    }

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
    const source = p && typeof p === "object" ? p : {};
    return String(source["Type de projet"] ?? source.type ?? "").toLowerCase().trim();
  }

  function projectCity(p) {
    const source = p && typeof p === "object" ? p : {};
    return String(
      source["Ville"] ??
      source.ville ??
      source["Commune"] ??
      source.commune ??
      source["Adresse ville"] ??
      ""
    ).trim();
  }

  function projectLatLon(p) {
    const source = p && typeof p === "object" ? p : {};
    const lat = parseFloat(String(source["Latitude"] ?? source.latitude ?? source.lat ?? "").replace(",", "."));
    const lon = parseFloat(String(source["Longitude"] ?? source.longitude ?? source.lon ?? "").replace(",", "."));
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
    const source = p && typeof p === "object" ? p : {};
    const codeLike = String(source.__deptCode ?? source["Code département"] ?? source.code_departement ?? source["Département"] ?? source.departement ?? "").trim();
    if (codeLike) {
      const maybeCode = normalizeDeptCode(codeLike);
      if (/^(\d{2}|\d{3}|2A|2B)$/.test(maybeCode)) return maybeCode;
    }

    const rawName = String(source.__deptName ?? source["Nom département"] ?? source["Département"] ?? source.departement ?? "").trim();
    if (!rawName) return "";
    const key = normalizeForLookup(rawName);
    return deptNameToCode.get(key) || "";
  }

  function deptNameFromProject(p) {
    const source = p && typeof p === "object" ? p : {};
    const rawName = String(source.__deptName ?? source["Nom département"] ?? "").trim();
    if (rawName) return rawName;
    const code = deptCodeFromProject(source);
    return code ? String(deptCodeToName[code] ?? "").trim() : "";
  }

  function buildProjectSearchBlob(p) {
    const values = [
      projectId(p),
      projectDisplayName(p), p?.["Nom de projet"], p?.nom,
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

  function completedProjectYearValues(p) {
    return [projectStartYear(p), projectEndYear(p)].filter((year) => Number.isFinite(year));
  }

  function completedProjectYearRange(p) {
    const years = completedProjectYearValues(p);
    if (!years.length) return null;
    return {
      from: Math.min(...years),
      to: Math.max(...years)
    };
  }

  function isCompletedProjectOutsideTimelineRange(p) {
    const range = completedProjectYearRange(p);
    if (!range) return false;
    return range.to < COMPLETED_YEAR_DEFAULT_MIN || range.from > COMPLETED_YEAR_DEFAULT_MAX;
  }

  function completedTimelineOutOfRangeProjects(projects = completedTimelineBaseProjects()) {
    return projects.filter(isCompletedProjectOutsideTimelineRange);
  }

  function computeCompletedShowAllStats(projects = completedTimelineBaseProjects()) {
    return projects.reduce((acc, project) => {
      acc.total += 1;
      if (Number.isFinite(projectEndYear(project))) acc.delivered += 1;
      const amount = amountNumber(project["Montant"] ?? project.montant);
      if (Number.isFinite(amount)) acc.amount += amount;
      return acc;
    }, { total: 0, delivered: 0, amount: 0 });
  }

  function reportCompletedTimelineCoverage(projects = projectsByMode.completed) {
    if (completedTimelineOutOfRangeReported || !Array.isArray(projects) || !projects.length) return;

    const outsideProjects = completedTimelineOutOfRangeProjects(projects);
    if (!outsideProjects.length) return;

    completedTimelineOutOfRangeReported = true;
    const years = new Set();
    for (const project of outsideProjects) {
      for (const year of completedProjectYearValues(project)) years.add(year);
    }

    console.info("[BIMO] Certains projets finis sont hors période 2008–2024. Ils restent visibles via l’option Tout afficher.", {
      projets: outsideProjects.length,
      annees: Array.from(years).sort((a, b) => a - b)
    });
  }

  function updateCompletedYearBounds() {
    // La frise des projets finis reste volontairement bornée à la période métier demandée.
    // Les projets hors période ne sont pas masqués silencieusement : ils sont signalés
    // dans la timeline et restent visibles via l’option « Tout afficher ».
    COMPLETED_YEAR_MIN = COMPLETED_YEAR_DEFAULT_MIN;
    COMPLETED_YEAR_MAX = COMPLETED_YEAR_DEFAULT_MAX;

    reportCompletedTimelineCoverage();
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
    const t = projectTypeKey(p);

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

    const baseProjects = completedTimelineBaseProjects();
    const stats = computeCompletedYearStats(baseProjects);
    const selectedStats = stats.find((entry) => entry.year === completedYearFilter) || { present: 0, delivered: 0, amountPresent: 0, amountDelivered: 0 };
    const maxPresent = Math.max(1, ...stats.map((entry) => entry.present));
    const showAllStats = computeCompletedShowAllStats(baseProjects);
    const outsideCount = completedTimelineOutOfRangeProjects(baseProjects).length;

    if (elCompletedYearStats) {
      const amountLabel = formatMillionEuro(showAllCompletedProjects
        ? showAllStats.amount
        : selectedStats.amountPresent
      );
      const totalVisible = showAllCompletedProjects
        ? showAllStats.total
        : selectedStats.present;
      const deliveredVisible = showAllCompletedProjects
        ? showAllStats.delivered
        : selectedStats.delivered;
      const outsideLabel = outsideCount
        ? `<span title="${escapeAttr(showAllCompletedProjects ? "Projets dont les dates sont hors période 2008–2024" : "Projets hors période 2008–2024, visibles via Tout afficher")}"><strong>${outsideCount}</strong> hors période</span>`
        : "";

      elCompletedYearStats.innerHTML = `
        <span><strong>${totalVisible}</strong> présent(s)</span>
        <span><strong>${deliveredVisible}</strong> livré(s)</span>
        ${amountLabel ? `<span><strong>${escapeHtml(amountLabel)}</strong></span>` : ""}
        ${outsideLabel}
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
    return !!(
      projectFieldValue(p, PROJECT_FIELD_ALIASES.energyBefore) ||
      projectFieldValue(p, PROJECT_FIELD_ALIASES.energyAfter) ||
      projectFieldValue(p, PROJECT_FIELD_ALIASES.gesBefore) ||
      projectFieldValue(p, PROJECT_FIELD_ALIASES.gesAfter)
    );
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

  function syncFilterButtonState() {
    if (!elFilterBtn) return;

    const hasTypeFilter = Array.from(document.querySelectorAll(".typeFilter"))
      .some((checkbox) => !checkbox.checked);
    const officesToggle = document.getElementById("officesToggle");
    const cityLabelsToggle = document.getElementById("cityLabelsToggle");
    const projectLabelsToggle = document.getElementById("projectLabelsToggle");
    const hasDisplayOption =
      (officesToggle && !officesToggle.checked) ||
      (cityLabelsToggle && cityLabelsToggle.checked) ||
      (projectLabelsToggle && projectLabelsToggle.checked);

    const active = Boolean(hasTypeFilter || hasDisplayOption);
    elFilterBtn.classList.toggle("is-active", active);
    elFilterBtn.setAttribute("aria-pressed", active ? "true" : "false");
    elFilterBtn.title = active ? "Des filtres d’affichage sont actifs" : "Afficher les filtres";
  }

  function setFilterMenuOpen(open) {
    if (!elFilterMenu || !elFilterBtn) return;
    const isOpen = Boolean(open);
    elFilterMenu.hidden = !isOpen;
    elFilterBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");

    if (isOpen) {
      setAdvancedFiltersOpen(false);
      setProjectListOpen(false);
    }
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

    const antenna = antennaKeyFromText(selectedAntenna);
    if (!antenna) return base;
    return base.filter((p) => antennaKeyFromText(p["Antenne"] ?? p.antenne) === antenna);
  }

  function getProjectsForAntenna(antennaName) {
    const antenna = antennaKeyFromText(antennaName);
    if (!antenna) return [];
    return allProjects
      .filter((p) => antennaKeyFromText(p["Antenne"] ?? p.antenne) === antenna)
      .sort((aProj, bProj) => projectDisplayName(aProj).localeCompare(projectDisplayName(bProj), "fr", { sensitivity: "base" }));
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

  // ---- 12. Pins projets, clusters et rendu carte ----
  function colorByType(t) {
    return projectTypeColorByKey(projectTypeKeyFromText(t));
  }

  function renderMarkers() {
    if (!clusters || typeof clusters.clearLayers !== "function") return;

    clusters.clearLayers();
    projectIdToMarker = new Map();
    clearSelectedMarker();

    const list = filteredProjects();
    const markerLayers = [];
    let markerCount = 0;

    for (const p of list) {
      const ll = projectLatLon(p);
      if (!ll) continue;

      const typeKey = projectTypeKey(p);
      const col = projectTypeColorByKey(typeKey);
      const marker = L.marker(ll, {
        icon: L.divIcon({
          className: "pin-dot",
          html: `<div class="projectPinScaleWrap"><div class="pin-dot-inner" style="border-color:${col};${projectPinTransformStyle()}"></div></div>`,
          iconSize: [projectPinSize(22), projectPinSize(22)],
          iconAnchor: [projectPinSize(11), projectPinSize(11)]
        })
      });

      const pid = projectId(p);
      if (pid) {
        projectIdToMarker.set(pid, marker);
        marker.options.__projId = pid;
      }

      marker.options.__bimoType = col;
      marker.options.__bimoTypeKey = typeKey;
      marker.options.__bimoTypeLabel = projectTypeLabelByKey(typeKey);

      // Tooltip (survol) : nom du projet
      const pName = projectDisplayName(p);
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

      markerLayers.push(marker);
      markerCount += 1;
    }

    if (markerLayers.length) {
      if (typeof clusters.addLayers === "function") {
        clusters.addLayers(markerLayers);
      } else {
        markerLayers.forEach((marker) => clusters.addLayer(marker));
      }
    }

    if (elCount) elCount.textContent = String(list.length);
    if (elStatLocated) {
      const unlocatedCount = Math.max(0, list.length - markerCount);
      elStatLocated.textContent = unlocatedCount
        ? ` (${markerCount} localisé(s), ${unlocatedCount} non localisé(s))`
        : "";
      elStatLocated.title = unlocatedCount
        ? "Certains projets filtrés n’ont pas de coordonnées dans les données JSON et ne peuvent pas être placés sur la carte."
        : "";
    }
    updateCompletedTimelineUi();
    filteredCounts = computeFilteredCounts();
    renderAntennaSummary();
    projectListDirty = true;
    if (elProjListMenu && !elProjListMenu.hidden) buildProjectList();
    updateDeptStyle();
    updateClearButtonState();
    scheduleCityLabelsRender();
  }

  // ---- 13. Panneau latéral ----

  // ---- 14. Photos et lightbox ----
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
    if (!(img instanceof HTMLImageElement)) return;

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
    if (!p || typeof p !== "object") return;

    updateProjectUrl(p);
    const title = projectDisplayName(p);

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
    const rawType = projectFieldValue(project, PROJECT_FIELD_ALIASES.buildingType);
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

    const energyBefore = parseMetricValue(projectFieldValue(project, PROJECT_FIELD_ALIASES.energyBefore));
    const energyAfter = parseMetricValue(projectFieldValue(project, PROJECT_FIELD_ALIASES.energyAfter));
    const gesBefore = parseMetricValue(projectFieldValue(project, PROJECT_FIELD_ALIASES.gesBefore));
    const gesAfter = parseMetricValue(projectFieldValue(project, PROJECT_FIELD_ALIASES.gesAfter));

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

  // ---- 15. Photos dans le panneau projet ----
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



  // ---- 16. Départements et coloration géographique ----
  function colorByAntenna(a) {
    return antennaColorByName(a);
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

  // ---- 17. Chargement réseau robuste ----
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

  // ---- 18. Utilitaires événementiels ----
  function debounce(fn, waitMs) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), waitMs);
    };
  }

  // ---- 19. Initialisation UI et événements ----
  renderLegendAntennas();
  syncProjectTypeLegendColors();
  createCompletedYearFilterUi();
  updateCompletedYearFilterUi();
  ensureProjectModeButtonLabels();
  syncToolbarControlHeights();

  window.addEventListener("resize", syncToolbarControlHeights);
  window.addEventListener("load", syncToolbarControlHeights);
  if (document.fonts?.ready) {
    document.fonts.ready.then(syncToolbarControlHeights).catch(() => {});
  }

  const rerenderDebounced = debounce(renderMarkers, 200);
  const rerenderAdvancedFiltersDebounced = debounce(renderMarkers, 150);
  if (elQ) elQ.addEventListener("input", () => {
    updateClearButtonState();
    rerenderDebounced();
  });
  document.querySelectorAll(".typeFilter").forEach((cb) => cb.addEventListener("change", () => {
    updateClearButtonState();
    syncFilterButtonState();
    renderMarkers();
  }));
  initOfficesToggle();
  normalizeToolbarCheckboxes();
  syncFilterButtonState();

  elFilterMenu?.addEventListener("change", () => {
    syncFilterButtonState();
  });
  window.setTimeout(() => {
    initProjectClusterDistanceControls(
      document.getElementById("projectPinSizeControls")
      || document.getElementById("projectLabelsToggle")?.closest("label")
      || document.getElementById("cityLabelsToggle")?.closest("label")
      || document.getElementById("officesToggle")?.closest("label")
    );
  }, 0);

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

      const officesToggle = document.getElementById("officesToggle");
      if (officesToggle) {
        officesToggle.checked = true;
        officesEnabled = true;
        renderOffices();
      }

      const cityLabelsToggle = document.getElementById("cityLabelsToggle");
      if (cityLabelsToggle) cityLabelsToggle.checked = false;
      cityLabelsEnabled = false;

      const projectLabelsToggle = document.getElementById("projectLabelsToggle");
      if (projectLabelsToggle) projectLabelsToggle.checked = false;
      projectLabelsEnabled = false;
      scheduleCityLabelsRender();

      clearAdvancedFilters();
      selectedAntenna = null;
      stopCompletedYearPlayback();
      setCompletedYearFilter(COMPLETED_YEAR_MIN, { rerender: false });
      setCompletedShowAll(false, { rerender: false });
      updateDeptStyle();
      closePanel();
      updateDeptSelectedStat();
      updateClearButtonState();
      syncFilterButtonState();
      renderMarkers();
    });
  }

  if (elFilterBtn && elFilterMenu) {
    elFilterBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setFilterMenuOpen(elFilterMenu.hidden);
    });

    elFilterMenu.addEventListener("click", (event) => event.stopPropagation());
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
      setFilterMenuOpen(false);
      setProjectListOpen(false);
      setAdvancedFiltersOpen(elAdvancedFiltersPanel.hidden);
    });
  }

  [elAmountMin, elAmountMax, elPhaseFilter, elClientFilter, elProgrammeFilter, elThemeFilter, elDeptFilter, elPhotosFilter, elEnergyFilter]
    .filter(Boolean)
    .forEach((el) => {
      const isTextualInput = el.tagName === "INPUT";
      const eventName = isTextualInput ? "input" : "change";
      el.addEventListener(eventName, () => {
        syncAdvancedFiltersButtonState();
        updateClearButtonState();
        if (isTextualInput) rerenderAdvancedFiltersDebounced();
        else renderMarkers();
      });
    });

  // ---- 20. Liste projets ----
  if (elProjListBtn && elProjListMenu) {
    elProjListBtn.setAttribute("aria-expanded", "false");

    elProjListBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setFilterMenuOpen(false);
      setAdvancedFiltersOpen(false);
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
      if (!elProjListMenu.hidden && !elProjListMenu.contains(event.target) && !elProjListBtn.contains(event.target)) {
        setProjectListOpen(false);
      }
      if (elFilterMenu && !elFilterMenu.hidden && !elFilterMenu.contains(event.target) && !elFilterBtn?.contains(event.target)) {
        setFilterMenuOpen(false);
      }
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      setProjectListOpen(false);
      setFilterMenuOpen(false);
      setAdvancedFiltersOpen(false);
    });
    elProjListMenu.addEventListener("click", (e) => e.stopPropagation());
  }




  // ---- MODULE IMPRESSION A4 - CARTE ACTUELLE ----
  function initMapPrintModule() {
    const existing = document.getElementById("mapPrintBtn");
    if (existing) return;

    injectMapPrintStyles();

    const btn = document.createElement("button");
    btn.id = "mapPrintBtn";
    btn.type = "button";
    btn.textContent = "Imprimer";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-label", "Préparer l’impression de la carte");

    if (elAdvancedFiltersBtn?.insertAdjacentElement) {
      elAdvancedFiltersBtn.insertAdjacentElement("afterend", btn);
    } else {
      document.getElementById("toolbar")?.appendChild(btn);
    }

    btn.addEventListener("click", () => {
      closeLightbox();
      openMapPrintScopeDialog();
    });
  }

  function injectMapPrintStyles() {
    if (document.getElementById("mapPrintModuleStyles")) return;

    const style = document.createElement("style");
    style.id = "mapPrintModuleStyles";
    style.textContent = `
      #mapPrintBtn{
        cursor:pointer;
        border:var(--bimo-button-border);
        background:var(--bimo-button-bg);
        border-radius:var(--bimo-button-radius);
        padding:3px 10px;
        line-height:1;
        min-height:26px;
        height:26px;
        font:inherit;
      }
      #mapPrintBtn:hover{ filter:var(--bimo-button-hover-filter); }
      .mapPrintDialogBackdrop{
        position:fixed;
        inset:0;
        z-index:10000;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:20px;
        background:rgba(15,23,42,0.42);
      }
      .mapPrintDialog{
        width:min(460px, calc(100vw - 32px));
        max-height:calc(100vh - 32px);
        overflow:auto;
        background:#fff;
        color:#111;
        border:1px solid var(--border);
        border-radius:16px;
        box-shadow:0 22px 60px rgba(0,0,0,0.26);
        padding:18px;
        font-family:"Marianne", Arial, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .mapPrintDialog h2{
        margin:0 0 8px 0;
        font-size:20px;
        line-height:1.2;
        font-weight:800;
      }
      .mapPrintDialogIntro{
        margin:0 0 14px 0;
        color:#444;
        font-size:13px;
        line-height:1.35;
      }
      .mapPrintScopeList{
        display:grid;
        gap:8px;
        margin:12px 0 16px;
      }
      .mapPrintScopeItem{
        display:flex;
        align-items:center;
        gap:9px;
        padding:9px 10px;
        border:1px solid var(--border);
        border-radius:10px;
        background:#fff;
        cursor:pointer;
      }
      .mapPrintScopeItem:hover{ background:#f8f8fb; }
      .mapPrintScopeItem input{ margin:0; accent-color:var(--accent); }
      .mapPrintDialogActions{
        display:flex;
        justify-content:flex-end;
        gap:10px;
        margin-top:12px;
      }
      .mapPrintDialogActions button{
        cursor:pointer;
        border:var(--bimo-button-border);
        background:#fff;
        border-radius:10px;
        padding:8px 12px;
        font:inherit;
        font-weight:700;
      }
      .mapPrintDialogActions .mapPrintPrimary{
        background:var(--accent);
        border-color:var(--accent);
        color:#fff;
      }
    `;
    document.head.appendChild(style);
  }

  function openMapPrintScopeDialog() {
    closeMapPrintScopeDialog();

    const dialogId = "mapPrintScopeDialog";
    const backdrop = document.createElement("div");
    backdrop.className = "mapPrintDialogBackdrop";
    backdrop.id = `${dialogId}Backdrop`;

    const antennaOptions = ANTENNA_LEGEND_ORDER.map((antenna) => {
      const checked = selectedAntenna === antenna ? "checked" : "";
      return `
        <label class="mapPrintScopeItem">
          <input type="radio" name="mapPrintScope" value="${escapeAttr(antenna)}" ${checked}>
          <span>${escapeHtml(antennaDisplayLabel(antenna))}</span>
        </label>`;
    }).join("");

    const franceChecked = selectedAntenna ? "" : "checked";
    backdrop.innerHTML = `
      <div id="${dialogId}" class="mapPrintDialog" role="dialog" aria-modal="true" aria-labelledby="mapPrintDialogTitle">
        <h2 id="mapPrintDialogTitle">Imprimer la carte</h2>
        <p class="mapPrintDialogIntro">
          L’impression reprend les filtres et affichages actuellement visibles sur la carte.
          Choisissez uniquement l’emprise à imprimer.
        </p>
        <div class="mapPrintScopeList" role="radiogroup" aria-label="Emprise à imprimer">
          <label class="mapPrintScopeItem">
            <input type="radio" name="mapPrintScope" value="__france__" ${franceChecked}>
            <span>Toute la France</span>
          </label>
          ${antennaOptions}
        </div>
        <div class="mapPrintDialogActions">
          <button type="button" class="mapPrintCancel">Annuler</button>
          <button type="button" class="mapPrintPrimary">Préparer</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    const dialog = backdrop.querySelector(`#${dialogId}`);
    const cancelBtn = backdrop.querySelector(".mapPrintCancel");
    const primaryBtn = backdrop.querySelector(".mapPrintPrimary");

    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeMapPrintScopeDialog();
    };
    backdrop.__bimoPrintEscapeHandler = closeOnEscape;
    document.addEventListener("keydown", closeOnEscape);

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeMapPrintScopeDialog();
    });

    cancelBtn?.addEventListener("click", closeMapPrintScopeDialog);
    primaryBtn?.addEventListener("click", () => {
      const value = String(backdrop.querySelector('input[name="mapPrintScope"]:checked')?.value || "__france__");

      // Important : la fenêtre doit être ouverte directement pendant le clic utilisateur.
      // Si on attend la fin de la préparation de la carte, Chrome/Edge peuvent ouvrir
      // un onglet about:blank impossible à remplir ensuite.
      const printWin = openMapPrintPlaceholderWindow();
      if (!printWin) return;

      closeMapPrintScopeDialog();
      prepareMapPrintFromCurrentState(value, printWin);
    });

    dialog?.querySelector('input[name="mapPrintScope"]:checked')?.focus?.();
  }

  function closeMapPrintScopeDialog() {
    const backdrop = document.getElementById("mapPrintScopeDialogBackdrop");
    if (!backdrop) return;
    if (backdrop.__bimoPrintEscapeHandler) {
      document.removeEventListener("keydown", backdrop.__bimoPrintEscapeHandler);
    }
    backdrop.remove();
  }

  function applyMapPrintScope(scopeValue) {
    const nextAntenna = scopeValue === "__france__" ? null : antennaKeyFromText(scopeValue);
    selectedAntenna = nextAntenna || null;
    closePanel();
    updateDeptStyle();
    updateDeptSelectedStat();
    renderMarkers();

    if (selectedAntenna) {
      const bounds = boundsForAntennaDepartments(selectedAntenna);
      if (bounds?.isValid?.()) {
        map.fitBounds(bounds, { padding: [4, 4], animate: false });
      }
    } else {
      map.fitBounds(FRANCE_BOUNDS, { padding: [20, 20], animate: false });
    }

    updateClearButtonState();
  }

  function boundsForAntennaDepartments(antennaName) {
    if (!deptLayer || !antennaName) return null;
    const target = antennaKeyFromText(antennaName);
    if (!target) return null;
    const bounds = L.latLngBounds();

    deptLayer.eachLayer((layer) => {
      const props = layer?.feature?.properties || {};
      const code = normalizeDeptCode(
        props.code ?? props.CODE ?? props.dep ?? props.DEP ?? props.insee ?? props.INSEE ?? props.code_dept ?? props.CODE_DEPT ?? ""
      );
      if (deptCodeToAntenna[code] !== target) return;
      const layerBounds = layer.getBounds?.();
      if (layerBounds?.isValid?.()) bounds.extend(layerBounds);
    });

    return bounds.isValid() ? bounds : null;
  }

  function serializePrintProject(project) {
    const ll = projectLatLon(project);
    if (!ll) return null;
    const typeKey = projectTypeKey(project);
    const antenna = antennaKeyFromText(project["Antenne"] ?? project.antenne);
    return {
      id: projectId(project),
      name: projectDisplayName(project),
      city: projectCity(project),
      lat: ll[0],
      lon: ll[1],
      typeKey,
      typeLabel: projectTypeLabelByKey(typeKey),
      typeColor: projectTypeColorByKey(typeKey),
      antenna,
      deptCode: deptCodeFromProject(project),
      deptName: deptNameFromProject(project)
    };
  }

  function serializePrintOffice(office) {
    return {
      type: office.type_lieu,
      name: office.nom,
      antenna: office.antenne,
      address: office.adresse,
      lat: Number(office.latitude),
      lon: Number(office.longitude)
    };
  }

  function collectCurrentMapLabelOffsets() {
    const city = {};
    const project = {};

    if (!map || !mapEl || !cityLabelsHtml) {
      return { city, project };
    }

    try {
      // On force un rendu immédiat des libellés de la carte principale avant de
      // mémoriser leurs positions. L'impression doit reprendre leur placement,
      // pas recalculer une nouvelle disposition différente.
      map.invalidateSize(true);
      renderMapLabels();
    } catch (err) {
      console.warn("[BIMO] Libellés de la carte principale non recalculés avant impression", err);
    }

    const mapRect = mapEl.getBoundingClientRect();
    if (!mapRect.width || !mapRect.height) {
      return { city, project };
    }

    const visibleProjects = filteredProjects()
      .map((p) => ({
        project: p,
        id: projectId(p),
        name: projectDisplayName(p),
        city: projectCity(p),
        ll: projectLatLon(p)
      }))
      .filter((entry) => entry.ll);

    const cityAnchors = new Map();
    for (const entry of visibleProjects) {
      const key = normalizeForLookup(entry.city);
      if (!key) continue;
      if (!cityAnchors.has(key)) {
        cityAnchors.set(key, entry);
        continue;
      }
      const current = cityAnchors.get(key);
      const currentPoint = map.latLngToContainerPoint(current.ll);
      const candidatePoint = map.latLngToContainerPoint(entry.ll);
      if (candidatePoint.y < currentPoint.y) cityAnchors.set(key, entry);
    }

    cityLabelsHtml.querySelectorAll(".cityLabel:not(.projectLabel)").forEach((label) => {
      const text = String(label.textContent || "").trim();
      const key = normalizeForLookup(text);
      const anchor = cityAnchors.get(key);
      if (!key || !anchor?.ll) return;

      const rect = label.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const anchorPoint = map.latLngToContainerPoint(anchor.ll);
      city[key] = {
        text,
        dx: (rect.left - mapRect.left) + rect.width / 2 - anchorPoint.x,
        dy: (rect.top - mapRect.top) + rect.height / 2 - anchorPoint.y,
        width: rect.width,
        height: rect.height
      };
    });

    const projectAnchorsById = new Map();
    const projectAnchorsByName = new Map();
    for (const entry of visibleProjects) {
      if (entry.id) projectAnchorsById.set(entry.id, entry);
      const nameKey = normalizeForLookup(entry.name);
      if (nameKey && !projectAnchorsByName.has(nameKey)) projectAnchorsByName.set(nameKey, entry);
    }

    cityLabelsHtml.querySelectorAll(".projectLabel").forEach((label) => {
      const text = String(label.textContent || "").trim();
      const nameKey = normalizeForLookup(text);
      const anchor = projectAnchorsByName.get(nameKey);
      if (!anchor?.ll || !anchor.id) return;

      const rect = label.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const anchorPoint = map.latLngToContainerPoint(anchor.ll);
      project[anchor.id] = {
        text,
        dx: (rect.left - mapRect.left) + rect.width / 2 - anchorPoint.x,
        dy: (rect.top - mapRect.top) + rect.height / 2 - anchorPoint.y,
        width: rect.width,
        height: rect.height
      };
    });

    return { city, project };
  }

  function buildMapPrintPayload(scopeValue) {
    const projects = filteredProjects()
      .map(serializePrintProject)
      .filter((project) => project && Number.isFinite(project.lat) && Number.isFinite(project.lon));

    const selectedScopeAntenna = selectedAntenna ? antennaKeyFromText(selectedAntenna) : "";
    const deptGeoJson = typeof deptLayer?.toGeoJSON === "function" ? deptLayer.toGeoJSON() : null;
    const labelOffsets = collectCurrentMapLabelOffsets();

    return {
      generatedAt: new Date().toISOString(),
      title: selectedScopeAntenna
        ? `Carte des projets BIMO — ${antennaDisplayLabel(selectedScopeAntenna)}`
        : "Carte des projets BIMO — France",
      scope: selectedScopeAntenna ? "antenna" : "france",
      scopeAntenna: selectedScopeAntenna,
      currentProjectMode,
      projectModeTitle: projectModeMeta().title,
      labelOffsets,
      projects,
      offices: OFFICES.map(serializePrintOffice).filter((office) => Number.isFinite(office.lat) && Number.isFinite(office.lon)),
      deptGeoJson,
      deptCodeToAntenna,
      deptCodeToName,
      antennaLegendOrder: ANTENNA_LEGEND_ORDER,
      antennaConfig: ANTENNA_CONFIG,
      projectTypeConfig: PROJECT_TYPE_CONFIG,
      projectTypeOrder: PROJECT_TYPE_CLUSTER_ORDER,
      franceBounds: [[FRANCE_BOUNDS.getSouth(), FRANCE_BOUNDS.getWest()], [FRANCE_BOUNDS.getNorth(), FRANCE_BOUNDS.getEast()]],
      printState: {
        legendVisible: !!(elLegend && !elLegend.hidden),
        officesVisible: !!officesEnabled,
        cityLabelsVisible: !!cityLabelsEnabled,
        projectLabelsVisible: !!projectLabelsEnabled,
        antennaSummaryVisible: !!antennaSummaryEnabled,
        pinSizeScale: projectPinSizeScale,
        clusterDistanceScale: projectClusterDistanceScale
      }
    };
  }

  function prepareMapPrintFromCurrentState(scopeValue, printWin) {
    try {
      applyMapPrintScope(scopeValue);
      window.setTimeout(() => {
        try {
          map.invalidateSize(true);
          renderMapLabels();
          const payload = buildMapPrintPayload(scopeValue);
          openMapPrintWindow(payload, printWin);
        } catch (err) {
          console.error("[BIMO] Préparation impression impossible", err);
          writeMapPrintWindowError(printWin, "L’impression n’a pas pu être préparée. Consultez la console pour le détail technique.");
        }
      }, 480);
    } catch (err) {
      console.error("[BIMO] Préparation impression impossible", err);
      writeMapPrintWindowError(printWin, "L’impression n’a pas pu être préparée. Consultez la console pour le détail technique.");
    }
  }

  function openMapPrintPlaceholderWindow() {
    // Pas de noopener/noreferrer ici : le script doit garder accès au document
    // de la fenêtre about:blank pour y écrire la carte une fois prête.
    const printWin = window.open("", "_blank", "width=1300,height=900");
    if (!printWin) {
      window.alert("La fenêtre d’impression a été bloquée par le navigateur. Autorisez les pop-ups pour ce site puis réessayez.");
      return null;
    }

    try {
      printWin.document.open();
      printWin.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Préparation impression</title><style>html,body{margin:0;height:100%;font-family:Arial,system-ui,sans-serif;background:#f3f4f6;color:#111}.wrap{height:100%;display:flex;align-items:center;justify-content:center;text-align:center}.box{padding:22px 26px;border:1px solid #d0d0d0;border-radius:14px;background:#fff;box-shadow:0 12px 34px rgba(0,0,0,.14)}strong{display:block;margin-bottom:6px;font-size:18px}</style></head><body><div class="wrap"><div class="box"><strong>Préparation de la carte…</strong><span>La fenêtre va se remplir automatiquement.</span></div></div></body></html>`);
      printWin.document.close();
      printWin.focus();
    } catch (err) {
      console.warn("[BIMO] Impossible d’écrire le placeholder d’impression", err);
    }

    return printWin;
  }

  function writeMapPrintWindowError(printWin, message) {
    if (!printWin || printWin.closed) {
      window.alert(message);
      return;
    }

    try {
      printWin.document.open();
      printWin.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Erreur impression</title><style>html,body{margin:0;height:100%;font-family:Arial,system-ui,sans-serif;background:#fff;color:#111}.wrap{height:100%;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}.box{max-width:560px;padding:22px 26px;border:1px solid #f0bcbc;border-radius:14px;background:#fff5f5;color:#8a1f1f;box-shadow:0 12px 34px rgba(0,0,0,.12)}strong{display:block;margin-bottom:8px;font-size:18px}</style></head><body><div class="wrap"><div class="box"><strong>Erreur de préparation</strong><span>${escapeHtml(message)}</span></div></div></body></html>`);
      printWin.document.close();
      printWin.focus();
    } catch {
      window.alert(message);
    }
  }

  function openMapPrintWindow(payload, printWin) {
    if (!printWin || printWin.closed) {
      printWin = openMapPrintPlaceholderWindow();
      if (!printWin) return;
    }

    const payloadJson = JSON.stringify(payload)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");

    const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(payload.title)}</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="anonymous">
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" crossorigin="anonymous">
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" crossorigin="anonymous">
  <style>
    @page{ size:A4 landscape; margin:0; }
    *{ box-sizing:border-box; }
    html,body{ margin:0; min-height:100%; font-family:"Marianne", Arial, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#e5e7eb; color:#111; }
    .printToolbar{ position:sticky; top:0; z-index:5000; display:flex; align-items:center; justify-content:space-between; gap:14px; padding:10px 14px; background:#fff; border-bottom:1px solid #d0d0d0; box-shadow:0 2px 12px rgba(0,0,0,.08); }
    .printToolbarTitle{ font-weight:800; line-height:1.2; }
    .printToolbarMeta{ margin-top:3px; color:#555; font-size:13px; }
    .printToolbarActions{ display:flex; align-items:center; gap:10px; }
    .printToolbar button{ cursor:pointer; border:1px solid #c9c9c9; border-radius:10px; background:#fff; padding:8px 12px; font:inherit; font-weight:700; }
    .printToolbar button.primary{ background:#000091; border-color:#000091; color:#fff; }
    .printToolbar button:disabled{ opacity:.55; cursor:not-allowed; }
    .printStatus{ font-size:13px; color:#555; font-weight:700; }
    .sheetWrap{ min-height:calc(100vh - 58px); display:flex; align-items:center; justify-content:center; padding:10px; }
    .sheet{ position:relative; width:297mm; height:210mm; max-width:calc(100vw - 36px); max-height:calc((100vw - 36px) * 210 / 297); aspect-ratio:297/210; background:#fff; box-shadow:0 12px 34px rgba(0,0,0,.24); overflow:hidden; }
    #printMap{ position:absolute; inset:2mm; background:#fff; pointer-events:none!important; }
    #printMap *, #printMap .leaflet-container, #printMap .leaflet-pane, #printMap .leaflet-layer, #printMap .leaflet-marker-pane, #printMap .leaflet-overlay-pane{ pointer-events:none!important; }
    .printLegend{ position:absolute; left:5mm; bottom:5mm; z-index:1500; max-width:72mm; max-height:86mm; overflow:hidden; padding:8px 10px; border:1px solid #d0d0d0; border-radius:10px; background:rgba(255,255,255,.96); box-shadow:0 6px 18px rgba(0,0,0,.14); font-size:11px; line-height:1.25; }
    .printLegendTitle,.printLegendSubtitle{ font-weight:800; margin-bottom:6px; }
    .printLegendSubtitle{ margin-top:8px; }
    .printLegendRow{ display:flex; align-items:center; gap:7px; margin:3px 0; white-space:nowrap; }
    .printLegendSwatch{ width:16px; height:10px; border:1px solid #d0d0d0; border-radius:4px; flex:0 0 auto; }
    .printLegendPin{ width:13px; height:13px; border-radius:999px; border:4px solid blue; background:rgba(0,0,0,.05); flex:0 0 auto; }
    .printMapTitle{ position:absolute; top:5mm; left:5mm; z-index:1400; padding:5px 8px; border-radius:8px; background:rgba(255,255,255,.92); border:1px solid rgba(0,0,0,.10); font-size:12px; font-weight:800; box-shadow:0 4px 14px rgba(0,0,0,.10); }
    .pin-dot{ background:transparent; border:0; }
    .projectPinScaleWrap{ width:100%; height:100%; display:flex; align-items:center; justify-content:center; pointer-events:none; }
    .projectPinScaleWrap .pin-dot-inner{ flex:0 0 auto; }
    .pin-dot-inner{ width:18px; height:18px; border-radius:50%; background:rgba(0,0,0,.05); border:4px solid blue; box-sizing:border-box; }
    .pin-dot-cluster-wrap{ background:transparent; border:0; }
    .pin-dot-inner.pin-dot-cluster{ width:18px; height:18px; border:0; background:transparent!important; position:relative; display:flex; align-items:center; justify-content:center; overflow:visible; }
    .pin-dot-cluster-svg{ position:absolute; inset:0; width:18px; height:18px; display:block; overflow:visible; }
    .pin-dot-cluster-center{ fill:rgba(0,0,0,.05); }
    .pin-dot-count{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:2; font-weight:800; font-size:12px; color:#111; line-height:1; text-align:center; }
    .marker-cluster,.marker-cluster-small,.marker-cluster-medium,.marker-cluster-large{ background:transparent!important; }
    .marker-cluster div,.marker-cluster-small div,.marker-cluster-medium div,.marker-cluster-large div{ width:22px!important; height:22px!important; line-height:22px!important; font-size:11px!important; margin:0!important; }
    .pin-office-wrap{ width:22px; height:22px; border-radius:999px; background:#fff; border:2px solid #111; display:flex; align-items:center; justify-content:center; position:relative; box-shadow:0 5px 14px rgba(0,0,0,.20); }
    .pin-office-svg{ width:14px; height:14px; fill:#111; display:block; }
    .pin-office-badge{ position:absolute; top:-7px; right:-7px; width:16px; height:16px; border-radius:999px; background:#111; color:#fff; font-size:11px; line-height:16px; text-align:center; }
    .printLabelsOverlay{ position:absolute; inset:0; z-index:1200; pointer-events:none; overflow:hidden; }
    .printLabelsSvg{ position:absolute; inset:0; width:100%; height:100%; overflow:visible; pointer-events:none; }
    .printLabelsSvg line{ stroke:#111; stroke-width:1.2; stroke-opacity:.42; }
    .printLabelsHtml{ position:absolute; inset:0; pointer-events:none; }
    .printLabel{ position:absolute; background:rgba(255,255,255,.94); border:1px solid rgba(0,0,0,.16); border-radius:999px; box-shadow:0 3px 9px rgba(0,0,0,.12); color:#111; font-size:11px; font-weight:800; line-height:1.15; padding:3px 7px; white-space:nowrap; pointer-events:none; overflow:hidden; text-overflow:ellipsis; }
    .printLabel--project{ border-radius:8px; font-size:10.5px; max-width:180px; }
    .leaflet-container{ font-family:"Marianne", Arial, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; touch-action:none!important; overscroll-behavior:contain; cursor:default!important; }
    .leaflet-control-container{ display:none!important; }
    .leaflet-interactive,.printLegend,.printMapTitle,.pin-dot-inner,.pin-office-wrap,.pin-office-badge,.printLabel{ -webkit-print-color-adjust:exact; print-color-adjust:exact; color-adjust:exact; }
    @media print{
      html,body{ width:297mm; height:210mm; overflow:hidden; background:#fff!important; }
      .printToolbar{ display:none!important; }
      .sheetWrap{ display:block; padding:0; min-height:0; }
      .sheet{ width:297mm!important; height:210mm!important; max-width:none!important; max-height:none!important; box-shadow:none!important; margin:0!important; page-break-after:avoid; overflow:hidden!important; }
      #printMap{ inset:2mm!important; }
    }
  </style>
</head>
<body>
  <div class="printToolbar">
    <div>
      <div class="printToolbarTitle">${escapeHtml(payload.title)}</div>
      <div id="printToolbarMeta" class="printToolbarMeta">Préparation de la carte…</div>
    </div>
    <div class="printToolbarActions">
      <span id="printStatus" class="printStatus">Chargement…</span>
      <button id="launchPrintBtn" class="primary" type="button" disabled>Lancer l’impression</button>
      <button type="button" onclick="window.close()">Fermer</button>
    </div>
  </div>
  <div class="sheetWrap">
    <main class="sheet" aria-label="Carte prête pour impression">
      <div id="printMap"></div>
      <div class="printMapTitle">${escapeHtml(payload.title)}</div>
      <div id="printLegend" class="printLegend" hidden></div>
    </main>
  </div>
  <script>window.__BIMO_PRINT_PAYLOAD__=${payloadJson};<\/script>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin="anonymous"><\/script>
  <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js" crossorigin="anonymous"><\/script>
  <script>(${mapPrintWindowRuntime.toString()})();<\/script>
</body>
</html>`;

    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
    printWin.focus();
  }

  function mapPrintWindowRuntime() {
    const payload = window.__BIMO_PRINT_PAYLOAD__ || {};
    const statusEl = document.getElementById("printStatus");
    const metaEl = document.getElementById("printToolbarMeta");
    const launchBtn = document.getElementById("launchPrintBtn");
    const legendEl = document.getElementById("printLegend");

    const PROJECT_TYPE_COLORS = Object.freeze({ mom: "blue", amo: "red", exp: "green" });
    const PROJECT_TYPE_LABELS = Object.freeze({ mom: "MOM", amo: "AMO", exp: "EXP" });

    function setStatus(text) {
      if (statusEl) statusEl.textContent = text;
    }

    function setMeta(text) {
      if (metaEl) metaEl.textContent = text;
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function normalizeDeptCode(code) {
      const c = String(code || "").trim().toUpperCase();
      if (!c) return "";
      if (c === "2A" || c === "2B") return c;
      if (/^\d{1,2}$/.test(c)) return c.padStart(2, "0");
      if (/^\d{3}$/.test(c)) return c;
      return c;
    }

    function normalizeForLookup(value) {
      return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[’']/g, " ")
        .replace(/-/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function antennaDisplayLabel(antenna) {
      return payload.antennaConfig?.[antenna]?.label || String(antenna || "").trim();
    }

    function antennaColor(antenna, fallback = "#ffffff") {
      return payload.antennaConfig?.[antenna]?.color || fallback;
    }

    function projectTypeLabel(typeKey) {
      return payload.projectTypeConfig?.[typeKey]?.label || PROJECT_TYPE_LABELS[typeKey] || String(typeKey || "").toUpperCase();
    }

    function projectTypeColor(typeKey) {
      return payload.projectTypeConfig?.[typeKey]?.color || PROJECT_TYPE_COLORS[typeKey] || "blue";
    }

    function projectPinSize(baseSize) {
      const scale = Number(payload.printState?.pinSizeScale) || 1;
      return Math.max(6, Math.round(baseSize * scale));
    }

    function projectPinTransformStyle() {
      const scale = Number(payload.printState?.pinSizeScale) || 1;
      return `transform:scale(${scale});transform-origin:center center;`;
    }

    function projectClusterMaxRadius() {
      const scale = Number(payload.printState?.clusterDistanceScale) || 1;
      return Math.max(1, Math.round(10 * scale));
    }

    function extractDeptCode(feature) {
      const props = feature?.properties || {};
      return normalizeDeptCode(props.code ?? props.CODE ?? props.dep ?? props.DEP ?? props.insee ?? props.INSEE ?? props.code_dept ?? props.CODE_DEPT ?? "");
    }

    function styleDept(feature) {
      const code = extractDeptCode(feature);
      const antenna = payload.deptCodeToAntenna?.[code] || "";
      const scopeAntenna = payload.scopeAntenna || "";
      const focused = !!(scopeAntenna && antenna === scopeAntenna);
      const hasAntenna = !!antenna;

      return {
        weight: focused ? 1.6 : 0.8,
        color: focused ? "#111" : "#666",
        fillColor: antennaColor(antenna, "#ffffff"),
        fillOpacity: !hasAntenna ? 0.10 : (scopeAntenna ? (focused ? 0.72 : 0.22) : 0.62),
        opacity: 0.85
      };
    }

    function makeProjectIcon(project) {
      const color = project.typeColor || projectTypeColor(project.typeKey);
      const size = projectPinSize(22);
      return L.divIcon({
        className: "pin-dot",
        html: `<div class="projectPinScaleWrap"><div class="pin-dot-inner" style="border-color:${escapeHtml(color)};${projectPinTransformStyle()}"></div></div>`,
        iconSize: [size, size],
        iconAnchor: [projectPinSize(11), projectPinSize(11)]
      });
    }

    function makeClusterIcon(cluster) {
      const children = cluster.getAllChildMarkers();
      const count = cluster.getChildCount();
      const colorCounts = new Map();
      for (const marker of children) {
        const typeKey = marker?.options?.__bimoTypeKey || "mom";
        const color = projectTypeColor(typeKey);
        colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
      }

      const orderedColors = (payload.projectTypeOrder || ["amo", "mom", "exp"])
        .map(projectTypeColor)
        .filter(Boolean);
      const slices = [];
      for (const color of orderedColors) {
        const sliceCount = colorCounts.get(color) || 0;
        if (sliceCount > 0) slices.push({ color, count: sliceCount });
      }
      for (const [color, sliceCount] of colorCounts.entries()) {
        if (!orderedColors.includes(color) && sliceCount > 0) slices.push({ color, count: sliceCount });
      }

      const total = slices.reduce((sum, item) => sum + item.count, 0) || children.length || 1;
      const segments = [];
      let cursor = 0;
      if (slices.length === 1) {
        segments.push({ color: slices[0].color, start: 0, length: 100 });
      } else if (slices.length > 1) {
        slices.forEach((item, index) => {
          const start = cursor;
          const end = index === slices.length - 1 ? 100 : cursor + (item.count / total) * 100;
          cursor = end;
          segments.push({ color: item.color, start, length: Math.max(0, end - start) });
        });
      } else {
        segments.push({ color: "blue", start: 0, length: 100 });
      }

      const ringSegments = segments
        .filter((segment) => segment.length > 0)
        .map((segment) => {
          const length = Math.min(100, Math.max(0, segment.length));
          const gap = Math.max(0, 100 - length);
          return `<circle class="pin-dot-cluster-ring" cx="9" cy="9" r="7" fill="none" stroke="${escapeHtml(segment.color)}" stroke-width="4" pathLength="100" stroke-dasharray="${length.toFixed(3)} ${gap.toFixed(3)}" stroke-dashoffset="${(-segment.start).toFixed(3)}" transform="rotate(-90 9 9)" />`;
        })
        .join("");

      const svg = `<svg class="pin-dot-cluster-svg" viewBox="0 0 18 18" aria-hidden="true" focusable="false">${ringSegments}<circle class="pin-dot-cluster-center" cx="9" cy="9" r="5" /></svg>`;
      const size = projectPinSize(32);
      return L.divIcon({
        className: "pin-dot pin-dot-cluster-wrap",
        html: `<div class="projectPinScaleWrap"><div class="pin-dot-inner pin-dot-cluster" style="${projectPinTransformStyle()}">${svg}<span class="pin-dot-count">${count}</span></div></div>`,
        iconSize: [size, size],
        iconAnchor: [projectPinSize(16), projectPinSize(16)]
      });
    }

    function makeOfficeIcon(office) {
      const isHQ = office.type === "siege";
      const svg = `<svg class="pin-office-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 22h16v-2H4v2zm2-4h12V4H6v14zm2-2V6h2v10H8zm4 0V6h2v10h-2z"/></svg>`;
      return L.divIcon({
        className: "pin-dot",
        html: `<div class="pin-office-wrap">${svg}${isHQ ? `<div class="pin-office-badge">★</div>` : ""}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
    }

    function renderLegend() {
      if (!legendEl || !payload.printState?.legendVisible) return;
      const antennaRows = (payload.antennaLegendOrder || []).map((antenna) => `
        <div class="printLegendRow">
          <span class="printLegendSwatch" style="background:${escapeHtml(antennaColor(antenna))}"></span>
          <span>${escapeHtml(antennaDisplayLabel(antenna))}</span>
        </div>
      `).join("");
      const typeRows = ["amo", "mom", "exp"].map((typeKey) => `
        <div class="printLegendRow">
          <span class="printLegendPin" style="border-color:${escapeHtml(projectTypeColor(typeKey))}"></span>
          <span>${escapeHtml(projectTypeLabel(typeKey))}</span>
        </div>
      `).join("");
      legendEl.innerHTML = `<div class="printLegendTitle">Antenne (départements)</div>${antennaRows}<div class="printLegendSubtitle">Type de projet (pins)</div>${typeRows}`;
      legendEl.hidden = false;
    }

    function makeRect(left, top, width, height) {
      return { left, top, right: left + width, bottom: top + height, width, height };
    }

    function rectsOverlap(a, b, margin = 0) {
      return !(a.right + margin < b.left || a.left - margin > b.right || a.bottom + margin < b.top || a.top - margin > b.bottom);
    }

    function rectInsideMap(rect, width, height, padding = 4) {
      return rect.left >= padding && rect.top >= padding && rect.right <= width - padding && rect.bottom <= height - padding;
    }

    function rectFromElementInMap(element, mapContainer) {
      if (!element || !mapContainer) return null;
      const mapRect = mapContainer.getBoundingClientRect();
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

    function ensureLabelsOverlay(map) {
      const container = map.getContainer();
      let overlay = container.querySelector(".printLabelsOverlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "printLabelsOverlay";
        overlay.innerHTML = '<svg class="printLabelsSvg" aria-hidden="true" focusable="false"></svg><div class="printLabelsHtml"></div>';
        container.appendChild(overlay);
      }
      const svg = overlay.querySelector(".printLabelsSvg");
      const html = overlay.querySelector(".printLabelsHtml");
      const size = map.getSize();
      svg.setAttribute("width", String(size.x));
      svg.setAttribute("height", String(size.y));
      svg.setAttribute("viewBox", `0 0 ${size.x} ${size.y}`);
      svg.replaceChildren();
      html.innerHTML = "";
      return { overlay, svg, html, width: size.x, height: size.y };
    }

    function appendLeaderLine(svg, anchorPoint, labelRect, labelId = "") {
      const labelEdgeX = Math.max(labelRect.left, Math.min(anchorPoint.x, labelRect.right));
      const labelEdgeY = Math.max(labelRect.top, Math.min(anchorPoint.y, labelRect.bottom));
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      if (labelId) line.dataset.printLabelId = labelId;
      line.setAttribute("x1", String(Math.round(anchorPoint.x)));
      line.setAttribute("y1", String(Math.round(anchorPoint.y)));
      line.setAttribute("x2", String(Math.round(labelEdgeX)));
      line.setAttribute("y2", String(Math.round(labelEdgeY)));
      svg.appendChild(line);
      return line;
    }

    function expandRect(rect, margin = 0) {
      return {
        left: rect.left - margin,
        top: rect.top - margin,
        right: rect.right + margin,
        bottom: rect.bottom + margin,
        width: rect.width + margin * 2,
        height: rect.height + margin * 2
      };
    }

    function removePrintedLabel(label) {
      if (!label) return;
      const id = label.dataset?.printLabelId || "";
      if (id) {
        const root = label.closest?.(".leaflet-container") || document;
        root.querySelectorAll(`[data-print-label-id="${id}"]`).forEach((node) => {
          if (node !== label) node.remove();
        });
      }
      label.remove();
    }

    function pruneOverlappingPrintedLabels(map) {
      const mapContainer = map?.getContainer?.();
      if (!mapContainer) return;

      const keptRects = [];
      for (const selector of [".printLegend:not([hidden])", ".printMapTitle"]) {
        const rect = rectFromElementInMap(document.querySelector(selector), mapContainer);
        if (rect) keptRects.push(expandRect(rect, 6));
      }

      const labels = Array.from(mapContainer.querySelectorAll(".printLabel"));
      labels.forEach((label) => {
        const rect = rectFromElementInMap(label, mapContainer);
        if (!rect) {
          removePrintedLabel(label);
          return;
        }

        const safeRect = expandRect(rect, 4);
        const hasOverlap = keptRects.some((kept) => rectsOverlap(safeRect, kept, 0));
        if (hasOverlap) {
          removePrintedLabel(label);
          return;
        }

        keptRects.push(safeRect);
      });
    }

    function buildPreferredLabelCandidates(preferredOffset, kind = "city") {
      if (!preferredOffset) return [];
      const dx = Number(preferredOffset.dx);
      const dy = Number(preferredOffset.dy);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return [];

      const small = kind === "project" ? 5 : 6;
      const adjustments = [
        [0, 0],
        [0, -small],
        [0, small],
        [small, 0],
        [-small, 0],
        [small, -small],
        [-small, -small],
        [small, small],
        [-small, small],
        [0, -small * 2],
        [0, small * 2]
      ];

      return adjustments.map(([ax, ay]) => ({
        offset: [dx + ax, dy + ay],
        leader: false,
        preferred: true
      }));
    }

    function buildLabelCandidates(labelWidth, labelHeight, kind = "city") {
      const halfW = Math.round(labelWidth / 2);
      const halfH = Math.round(labelHeight / 2);
      const pinGap = kind === "project" ? 17 : 18;
      const aboveY = -(halfH + pinGap);
      const belowY = halfH + pinGap;
      const sideX = halfW + pinGap;

      const direct = [
        [0, aboveY],
        [Math.round(halfW * 0.25), aboveY],
        [-Math.round(halfW * 0.25), aboveY],
        [Math.round(halfW * 0.55), aboveY - 2],
        [-Math.round(halfW * 0.55), aboveY - 2],
        [sideX, 0],
        [-sideX, 0],
        [sideX, -Math.round(halfH * 0.65)],
        [-sideX, -Math.round(halfH * 0.65)],
        [0, belowY],
        [Math.round(halfW * 0.35), belowY],
        [-Math.round(halfW * 0.35), belowY]
      ];

      const nearby = [
        [Math.round(halfW * 0.78), aboveY - 8],
        [-Math.round(halfW * 0.78), aboveY - 8],
        [sideX + 18, -Math.round(halfH * 0.25)],
        [-(sideX + 18), -Math.round(halfH * 0.25)],
        [sideX + 18, Math.round(halfH * 0.75)],
        [-(sideX + 18), Math.round(halfH * 0.75)],
        [0, aboveY - 22],
        [0, belowY + 22],
        [Math.round(halfW * 0.65), belowY + 8],
        [-Math.round(halfW * 0.65), belowY + 8]
      ];

      const fallback = [];
      for (let radius = kind === "project" ? 72 : 85; radius <= 190; radius += 24) {
        for (let angle = -160; angle <= 160; angle += 20) {
          const rad = angle * Math.PI / 180;
          fallback.push([Math.cos(rad) * radius, Math.sin(rad) * radius]);
        }
      }

      return [
        ...direct.map((offset) => ({ offset, leader: false })),
        ...nearby.map((offset) => ({ offset, leader: true })),
        ...fallback.map((offset) => ({ offset, leader: true }))
      ];
    }

    function placeLabel({ map, svg, html, placedRects, blockedRects, entry, text, className, kind }) {
      const anchorPoint = map.latLngToContainerPoint([entry.lat, entry.lon]);
      const mapContainer = map.getContainer();
      const mapSize = map.getSize();
      const el = document.createElement("div");
      el.className = className;
      el.textContent = text;
      const labelId = `print-label-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      el.dataset.printLabelId = labelId;
      el.style.visibility = "hidden";
      el.style.left = "-9999px";
      el.style.top = "-9999px";
      html.appendChild(el);

      const measured = el.getBoundingClientRect();
      const labelWidth = Math.ceil(Math.min(measured.width || 90, kind === "project" ? 180 : 220));
      const labelHeight = Math.ceil(measured.height || 22);
      const separation = kind === "project" ? 8 : 10;
      const blockedMargin = 5;

      const preferredCandidates = buildPreferredLabelCandidates(entry.preferredOffset, kind);
      const fallbackCandidates = preferredCandidates.length ? [] : buildLabelCandidates(labelWidth, labelHeight, kind);
      const candidates = [...preferredCandidates, ...fallbackCandidates];

      let best = null;
      for (const candidate of candidates) {
        const [dx, dy] = candidate.offset;
        const centerX = anchorPoint.x + dx;
        const centerY = anchorPoint.y + dy;
        const theoreticalRect = makeRect(centerX - labelWidth / 2, centerY - labelHeight / 2, labelWidth, labelHeight);

        el.style.left = `${Math.round(theoreticalRect.left)}px`;
        el.style.top = `${Math.round(theoreticalRect.top)}px`;
        el.style.width = `${Math.ceil(labelWidth)}px`;

        const actualRect = rectFromElementInMap(el, mapContainer) || theoreticalRect;
        if (!rectInsideMap(actualRect, mapSize.x, mapSize.y, 5)) continue;
        if (placedRects.some((placed) => rectsOverlap(actualRect, placed, separation))) continue;
        if (blockedRects.some((blocked) => rectsOverlap(actualRect, blocked, blockedMargin))) continue;

        best = { rect: actualRect, leader: candidate.leader };
        break;
      }

      if (!best) {
        el.remove();
        return false;
      }

      placedRects.push(best.rect);
      el.style.visibility = "visible";
      if (best.leader) appendLeaderLine(svg, anchorPoint, best.rect, labelId);
      return true;
    }

    function renderMapLabels(map) {
      if (!payload.printState?.cityLabelsVisible && !payload.printState?.projectLabelsVisible) return;
      const { svg, html } = ensureLabelsOverlay(map);
      const placedRects = [];
      const blockedRects = [];
      const mapContainer = map.getContainer();

      for (const project of payload.projects || []) {
        if (!Number.isFinite(project.lat) || !Number.isFinite(project.lon)) continue;
        const pt = map.latLngToContainerPoint([project.lat, project.lon]);
        const pinRadius = Math.max(11, Math.round(projectPinSize(22) / 2) + 4);
        blockedRects.push(makeRect(pt.x - pinRadius, pt.y - pinRadius, pinRadius * 2, pinRadius * 2));
      }

      for (const selector of [".printLegend:not([hidden])", ".printMapTitle"]) {
        const rect = rectFromElementInMap(document.querySelector(selector), mapContainer);
        if (rect) blockedRects.push(rect);
      }

      if (payload.printState?.cityLabelsVisible) {
        const groups = new Map();
        for (const project of payload.projects || []) {
          if (!project.city || !Number.isFinite(project.lat) || !Number.isFinite(project.lon)) continue;
          const key = normalizeForLookup(project.city);
          if (!key) continue;
          if (!groups.has(key)) {
            groups.set(key, { city: project.city, lat: project.lat, lon: project.lon });
            continue;
          }
          const current = groups.get(key);
          const currentPoint = map.latLngToContainerPoint([current.lat, current.lon]);
          const candidatePoint = map.latLngToContainerPoint([project.lat, project.lon]);
          if (candidatePoint.y < currentPoint.y) groups.set(key, { city: project.city, lat: project.lat, lon: project.lon });
        }

        Array.from(groups.values())
          .sort((a, b) => {
            const pa = map.latLngToContainerPoint([a.lat, a.lon]);
            const pb = map.latLngToContainerPoint([b.lat, b.lon]);
            return pa.y - pb.y || String(a.city).localeCompare(String(b.city), "fr", { sensitivity: "base", numeric: true });
          })
          .forEach((entry) => {
            const key = normalizeForLookup(entry.city);
            entry.preferredOffset = payload.labelOffsets?.city?.[key] || null;
            placeLabel({ map, svg, html, placedRects, blockedRects, entry, text: entry.city, className: "printLabel", kind: "city" });
          });
      }

      if (payload.printState?.projectLabelsVisible) {
        (payload.projects || [])
          .filter((project) => project.name && Number.isFinite(project.lat) && Number.isFinite(project.lon))
          .sort((a, b) => String(a.name).localeCompare(String(b.name), "fr", { sensitivity: "base", numeric: true }))
          .forEach((entry) => {
            entry.preferredOffset = payload.labelOffsets?.project?.[entry.id] || null;
            placeLabel({ map, svg, html, placedRects, blockedRects, entry, text: entry.name, className: "printLabel printLabel--project", kind: "project" });
          });
      }
    }

    function getAntennaDepartmentBounds(deptLayer) {
      const target = payload.scopeAntenna || "";
      if (!target || !deptLayer) return null;
      const bounds = L.latLngBounds();
      deptLayer.eachLayer((layer) => {
        const code = extractDeptCode(layer?.feature);
        const antenna = payload.deptCodeToAntenna?.[code] || "";
        if (antenna !== target) return;
        const layerBounds = layer.getBounds?.();
        if (layerBounds?.isValid?.()) bounds.extend(layerBounds);
      });
      return bounds.isValid() ? bounds : null;
    }

    function getProjectBounds() {
      const bounds = L.latLngBounds();
      for (const project of payload.projects || []) {
        if (Number.isFinite(project.lat) && Number.isFinite(project.lon)) bounds.extend([project.lat, project.lon]);
      }
      return bounds.isValid() ? bounds : null;
    }

    function getFranceBounds() {
      const b = payload.franceBounds;
      if (Array.isArray(b) && b.length === 2) return L.latLngBounds(b);
      return L.latLngBounds([[41.0, -5.5], [51.6, 9.8]]);
    }

    function wait(ms) {
      return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    function waitForTiles(layer, timeoutMs = 5000) {
      return new Promise((resolve) => {
        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          layer?.off?.("load", finish);
          resolve();
        };
        layer?.on?.("load", finish);
        window.setTimeout(finish, timeoutMs);
      });
    }

    function disablePrintMapInteractions(map) {
      const handlers = ["dragging", "touchZoom", "doubleClickZoom", "scrollWheelZoom", "boxZoom", "keyboard", "tap"];
      handlers.forEach((handlerName) => {
        try { map?.[handlerName]?.disable?.(); } catch {}
      });

      const container = map?.getContainer?.();
      if (!container || container.__bimoPrintInteractionsLocked) return;
      container.__bimoPrintInteractionsLocked = true;
      container.style.pointerEvents = "none";
      container.setAttribute("tabindex", "-1");

      const stopMapInteraction = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };

      ["wheel", "mousewheel", "DOMMouseScroll", "dblclick", "mousedown", "pointerdown", "touchstart", "touchmove", "keydown"].forEach((eventName) => {
        container.addEventListener(eventName, stopMapInteraction, { passive: false, capture: true });
      });
    }

    function lockPrintMapZoom(map) {
      if (!map) return;
      disablePrintMapInteractions(map);
      const lockedZoom = map.getZoom();
      if (Number.isFinite(lockedZoom)) {
        try { map.setMinZoom(lockedZoom); } catch {}
        try { map.setMaxZoom(lockedZoom); } catch {}
      }
    }

    function fitPrintMapToBounds(map, bounds) {
      if (!map || !bounds?.isValid?.()) return;
      const isAntennaScope = payload.scope === "antenna";
      const padding = isAntennaScope ? [18, 18] : [8, 8];
      map.fitBounds(bounds, { padding, animate: false });
    }

    async function boot() {
      if (!window.L || typeof L.map !== "function") {
        setStatus("Erreur");
        setMeta("Leaflet n’est pas disponible dans la fenêtre d’impression.");
        return;
      }

      const map = L.map("printMap", {
        preferCanvas: true,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        tap: false,
        inertia: false,
        zoomSnap: 0.1,
        zoomDelta: 0.25,
        wheelPxPerZoomLevel: 120
      }).setView([46.8, 2.5], 6);

      disablePrintMapInteractions(map);

      const tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
        crossOrigin: true
      }).addTo(map);

      let printDeptLayer = null;
      if (payload.deptGeoJson) {
        printDeptLayer = L.geoJSON(payload.deptGeoJson, {
          style: styleDept,
          interactive: false
        }).addTo(map);
        printDeptLayer.bringToBack();
      }

      const clusterLayer = typeof L.markerClusterGroup === "function"
        ? L.markerClusterGroup({
            chunkedLoading: false,
            spiderfyOnMaxZoom: false,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: false,
            maxClusterRadius: () => projectClusterMaxRadius(),
            iconCreateFunction: makeClusterIcon
          })
        : L.layerGroup();

      for (const project of payload.projects || []) {
        if (!Number.isFinite(project.lat) || !Number.isFinite(project.lon)) continue;
        const marker = L.marker([project.lat, project.lon], { icon: makeProjectIcon(project), interactive: false, keyboard: false });
        marker.options.__bimoTypeKey = project.typeKey || "mom";
        clusterLayer.addLayer(marker);
      }
      clusterLayer.addTo(map);

      if (payload.printState?.officesVisible) {
        const officesLayer = L.layerGroup().addTo(map);
        for (const office of payload.offices || []) {
          if (!Number.isFinite(office.lat) || !Number.isFinite(office.lon)) continue;
          L.marker([office.lat, office.lon], { icon: makeOfficeIcon(office), interactive: false }).addTo(officesLayer);
        }
      }

      renderLegend();

      await wait(120);
      map.invalidateSize(true);

      const bounds = payload.scope === "antenna"
        ? (getAntennaDepartmentBounds(printDeptLayer) || getProjectBounds() || getFranceBounds())
        : getFranceBounds();

      if (bounds?.isValid?.()) {
        fitPrintMapToBounds(map, bounds);
      }

      await wait(350);
      map.invalidateSize(true);
      await waitForTiles(tileLayer, 5200);
      await wait(450);
      map.invalidateSize(true);
      lockPrintMapZoom(map);
      renderMapLabels(map);
      await wait(80);
      pruneOverlappingPrintedLabels(map);

      const projectCount = (payload.projects || []).length;
      const scopeLabel = payload.scope === "antenna" && payload.scopeAntenna
        ? antennaDisplayLabel(payload.scopeAntenna)
        : "Toute la France";
      setStatus("Carte prête");
      setMeta(`${scopeLabel} — ${projectCount} projet(s) localisé(s)`);
      if (launchBtn) {
        launchBtn.disabled = false;
        launchBtn.addEventListener("click", () => window.print());
        launchBtn.focus();
      }
    }

    boot().catch((err) => {
      console.error("[BIMO] Erreur préparation carte impression", err);
      setStatus("Erreur");
      setMeta("La carte n’a pas pu être préparée. Consultez la console pour le détail technique.");
    });
  }

  console.info("[BIMO] module impression carte actuelle v7 chargé");
  initMapPrintModule();
  // ---- FIN MODULE IMPRESSION A4 - CARTE ACTUELLE ----

  map.on("zoomstart movestart", clearCityLabels);
  map.on("zoomend moveend resize", scheduleCityLabelsRender);

  updateClearButtonState();

  // ---- 21. Chargement initial des données ----
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

Modifications à appliquer dans script.js
======================================

Objectif :
- Au survol d’un cluster contenant plusieurs types de projets, afficher le type entre parenthèses après chaque nom : Projet X (AMO), Projet Y (EXP), Projet Z (MOM).
- Les projets sans nom ne doivent pas être renommés avec leur numéro/code projet dans les tooltips et libellés de carte.
- Aucun fichier JSON à modifier.

--------------------------------------------------------------------
1) Ajouter cette fonction près de projectRawIdentifier / projectDisplayName
--------------------------------------------------------------------

function projectRawName(project) {
  const source = project && typeof project === "object" ? project : {};
  return firstNonEmpty(source["Nom de projet"], source.nom);
}

--------------------------------------------------------------------
2) Dans setActiveProjectsForMode, remplacer le nom stocké pour les clusters
--------------------------------------------------------------------

Remplacer :

const nm = projectDisplayName(p);
if (pid) projectIdToName.set(pid, nm);

Par :

const nm = projectRawName(p);
if (pid && nm) projectIdToName.set(pid, nm);

Remarque : si votre version contient déjà :
const nm = String(p["Nom de projet"] ?? p.nom ?? "").trim();
vous pouvez la remplacer aussi par les deux lignes ci-dessus.

--------------------------------------------------------------------
3) Dans renderProjectLabels, éviter les libellés générés à partir du code projet
--------------------------------------------------------------------

Remplacer :

.map((project) => ({ project, name: projectDisplayName(project), ll: projectLatLon(project) }))

Par :

.map((project) => ({ project, name: projectRawName(project), ll: projectLatLon(project) }))

--------------------------------------------------------------------
4) Dans renderMarkers, stocker le type du projet sur le marker Leaflet
--------------------------------------------------------------------

Remplacer :

const col = colorByType(p["Type de projet"] ?? p.type ?? "");

Par :

const typeKey = projectTypeKeyFromText(p["Type de projet"] ?? p.type ?? "");
const col = projectTypeColorByKey(typeKey);

Puis, juste après :

marker.options.__bimoType = col;

Ajouter :

marker.options.__bimoTypeKey = typeKey;
marker.options.__bimoTypeLabel = projectTypeLabelByKey(typeKey);

--------------------------------------------------------------------
5) Dans renderMarkers, éviter le tooltip de pin généré depuis le numéro/code projet
--------------------------------------------------------------------

Remplacer :

const pName = projectDisplayName(p);

Par :

const pName = projectRawName(p);

--------------------------------------------------------------------
6) Remplacer le bloc clustermouseover complet
--------------------------------------------------------------------

Remplacer le bloc qui commence par :

clusters.on("clustermouseover", (a) => {

et qui se termine juste avant :

clusters.on("clustermouseout", (a) => {

Par ce bloc :

clusters.on("clustermouseover", (a) => {
  const cl = a.layer;
  const kids = cl.getAllChildMarkers();
  const items = [];
  const typeLabelsInCluster = new Set();

  for (const m of kids) {
    const pid = m?.options?.__projId;
    const nm = pid ? (projectIdToName.get(pid) || "") : "";
    const typeLabel = String(m?.options?.__bimoTypeLabel || "").trim();

    if (typeLabel) typeLabelsInCluster.add(typeLabel);
    if (!nm) continue;

    items.push({ name: nm, typeLabel });
  }

  items.sort((aItem, bItem) => {
    const byName = aItem.name.localeCompare(bItem.name, "fr", { sensitivity: "base", numeric: true });
    if (byName) return byName;
    return aItem.typeLabel.localeCompare(bItem.typeLabel, "fr", { sensitivity: "base", numeric: true });
  });

  const showTypeLabels = typeLabelsInCluster.size > 1;
  const max = 25;

  // 1 ligne = 1 projet, sans retour à la ligne automatique dans le nom.
  let html = items
    .slice(0, max)
    .map((item) => {
      const label = showTypeLabels && item.typeLabel
        ? `${item.name} (${item.typeLabel})`
        : item.name;
      return `<div class="projTooltipLine">${escapeHtml(label)}</div>`;
    })
    .join("");

  if (items.length > max) {
    html += `<div class="projTooltipMore">+${items.length - max} autres</div>`;
  }

  if (!html) html = `${kids.length} projets`;

  if (!cl.getTooltip()) {
    cl.bindTooltip(html, {
      className: "projTooltip projTooltip--cluster",
      direction: "top",
      offset: [0, -10],
      opacity: 0.95,
      sticky: true
    });
  } else {
    cl.setTooltipContent(html);
  }

  cl.openTooltip();
});


(() => {
  "use strict";

  const qs = new URLSearchParams(location.search);
  const code = (qs.get("code") || "").trim();
  const assetVersion = window.ASSET_VERSION || "2026-04-16a";
  const PROJECTS_URL = `export_projets_web.json?v=${encodeURIComponent(assetVersion)}`;

  const el = (id) => document.getElementById(id);

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function text(...values) {
    for (const value of values) {
      const s = String(value ?? "").trim();
      if (s) return s;
    }
    return "";
  }

  function formatEuro(v) {
    const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n)) return "";
    try {
      return new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0
      }).format(n);
    } catch {
      return `${Math.round(n)} €`;
    }
  }

  const STEPS = [
    "Étude de faisabilité",
    "Programmation / études préalables",
    "Phase marché : recrutement et études",
    "Travaux",
    "Réception",
    "Exploitation / Maintenance"
  ];

  function guessStepIndex(phase) {
    const s = String(phase ?? "").toLowerCase();
    if (!s) return -1;
    if (s.includes("faisabil")) return 0;
    if (s.includes("programm") || s.includes("etude")) return 1;
    if (s.includes("march") || s.includes("recrut")) return 2;
    if (s.includes("trav")) return 3;
    if (s.includes("recept")) return 4;
    if (s.includes("exploit") || s.includes("maint")) return 5;
    return -1;
  }

  function renderTimeline(activeIdx) {
    const t = el("timeline");
    if (!t) return;

    t.innerHTML = STEPS.map((label, i) => {
      const cls = i < activeIdx ? "step done" : (i === activeIdx ? "step active" : "step");
      return `<div class="${cls}">${esc(label)}</div>`;
    }).join("");
  }

  function kvRow(label, value) {
    const v = String(value ?? "").trim();
    if (!v) return "";
    return `<div class="kvRow"><div class="kvKey">${esc(label)} :</div><div class="kvVal">${esc(v).replace(/\n/g, "<br>")}</div></div>`;
  }

  function parseBulletItems(value) {
    if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
    const s = String(value ?? "").trim();
    if (!s) return [];
    return s
      .split(/\r?\n|•|▪|—\s+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function buildTeamLabel(p) {
    const people = [
      text(p["CP principal"]),
      text(p["CP 2"]),
      text(p["CP3"]),
      text(p["CED principal"]),
      text(p["CED 2"]),
      text(p["Acheteur"])
    ].filter(Boolean);

    return people.length ? people.join(" · ") : "—";
  }

  function buildAddress(p) {
    const adresse = text(p["Adresse"], p.adresse);
    const ville = text(p["Ville"], p.ville, p["Commune"], p.commune);
    return [adresse, ville].filter(Boolean).join(", ") || "—";
  }

  function fillTop(p) {
    const titre = text(p["Nom de projet"], p.nom, "Projet");
    const majValue = text(p["Maj"], p["Màj"], p["Mise à jour"]);
    const resumeValue = text(p["Résumé"], p["Resume"], p.resume, p["Résumé projet"], p["Résumé opération"]);

    const t = el("title");
    if (t) t.textContent = titre;

    const maj = el("maj");
    if (maj) maj.textContent = majValue ? `Maj : ${majValue}` : `Maj : ${new Date().toLocaleDateString("fr-FR")}`;

    const adr = el("adresse");
    if (adr) adr.textContent = buildAddress(p);

    const eq = el("equipe");
    if (eq) eq.textContent = text(p["Équipe projet"], p["Equipe projet"]) || buildTeamLabel(p);

    const proc = el("processus");
    if (proc) proc.textContent = text(p["Type de projet"], p["Phase projet"], "—");

    const res = el("resume");
    if (res) res.textContent = resumeValue || "—";
  }

  function renderDates(p) {
    const list = el("datesCles");
    if (!list) return;

    const knownDates = [
      ["Avis MMA conforme", p["Avis MMA conforme"]],
      ["Convention et programme", p["Convention et programme"]],
      ["Notification marché(s)", p["Notification marché(s)"]],
      ["CT & SPS", p["CT & SPS"]],
      ["MPGP", p["MPGP"]],
      ["Réception", p["Réception"]],
      ["Exploitation maintenance", p["Exploitation maintenance"]]
    ].filter(([, value]) => String(value ?? "").trim());

    list.innerHTML = knownDates.length
      ? knownDates.map(([label, value]) => `<li><b>${esc(label)}</b> ${esc(String(value).trim())}</li>`).join("")
      : `<li class="small">—</li>`;
  }

  function renderIdentite(p) {
    const ident = el("identiteKv");
    if (!ident) return;

    const rows = [
      kvRow("Antenne", p["Antenne"]),
      kvRow("Ville", text(p["Ville"], p.ville)),
      kvRow("Client", p["Client"]),
      kvRow("Type de projet", p["Type de projet"]),
      kvRow("Type de montage", p["Type de montage"]),
      kvRow("Programme", p["Programme"]),
      kvRow("Montant", formatEuro(p["Montant"] ?? p["Budget opération"])),
      kvRow("Phase projet", p["Phase projet"]),
      kvRow("Thématique", p["Thématique"])
    ].filter(Boolean);

    ident.innerHTML = rows.length ? rows.join("") : `<div class="small">—</div>`;
  }

  function renderActus(p) {
    const actus = el("actus");
    const vigilance = el("vigilance");
    if (actus) {
      const actusText = text(p["Actualités"], p["Actualites"]);
      actus.innerHTML = actusText ? esc(actusText).replace(/\n/g, "<br>") : `<div class="small">—</div>`;
    }

    if (vigilance) {
      const items = parseBulletItems(p["Vigilance"] ?? p["Points de vigilance"]);
      vigilance.innerHTML = items.length
        ? items.map((item, i) => {
            const cls = i === 2 ? "dot orange" : (i >= 3 ? "dot green" : "dot");
            return `<div class="bulletRow"><span class="${cls}"></span><div>${esc(item)}</div></div>`;
          }).join("")
        : `<div class="small">—</div>`;
    }
  }

  function renderContacts(p) {
    const cont = el("contactsKv");
    if (!cont) return;

    const rows = [
      kvRow("Acheteur", p["Acheteur"]),
      kvRow("Contact RPROG", p["Contact RPROG"]),
      kvRow("Contact MOE", p["Contact MOE"]),
      kvRow("CP principal", p["CP principal"]),
      kvRow("CP 2", p["CP 2"]),
      kvRow("CP3", p["CP3"]),
      kvRow("CED principal", p["CED principal"]),
      kvRow("CED 2", p["CED 2"]),
      kvRow("Autres contacts", p["Contacts"])
    ].filter(Boolean);

    cont.innerHTML = rows.length ? rows.join("") : `<div class="small">—</div>`;
  }

  async function fetchProjects() {
    const res = await fetch(PROJECTS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("Impossible de charger export_projets_web.json");
    const txt = await res.text();
    const clean = txt.replace(/^\uFEFF/, "");
    const data = JSON.parse(clean);
    return Array.isArray(data) ? data : (data?.projets || []);
  }

  async function load() {
    if (!code) {
      const t = el("title"); if (t) t.textContent = "Code projet manquant";
      const r = el("resume"); if (r) r.textContent = "Ouvrez la fiche depuis un projet (bouton “Fiche A4” dans le panneau latéral).";
      renderTimeline(-1);
      return;
    }

    const list = await fetchProjects();
    const p = list.find((x) => String(x?.["Code projet"] ?? "").trim() === code);

    if (!p) {
      const t = el("title"); if (t) t.textContent = `Projet introuvable (code ${code})`;
      const r = el("resume"); if (r) r.textContent = "Vérifiez le Code projet dans export_projets_web.json.";
      renderTimeline(-1);
      return;
    }

    fillTop(p);
    renderTimeline(guessStepIndex(p["Phase projet"]));
    renderDates(p);
    renderIdentite(p);
    renderActus(p);
    renderContacts(p);

    document.title = `Fiche — ${text(p["Nom de projet"], code)}`;
  }

  document.getElementById("btnPrint")?.addEventListener("click", () => window.print());

  document.querySelector(".backlink")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (window.opener) {
      window.close();
      return;
    }
    if (history.length > 1) {
      history.back();
      return;
    }
    location.href = "./";
  });

  load().catch((e) => {
    const t = el("title"); if (t) t.textContent = "Erreur";
    const r = el("resume"); if (r) r.textContent = String(e?.message || e);
    renderTimeline(-1);
  });
})();

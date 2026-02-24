(() => {
  "use strict";

  const qs = new URLSearchParams(location.search);
  const code = (qs.get("code") || "").trim();

  const PROJECTS_URL = "export_projets_web.json";

  const el = (id) => document.getElementById(id);

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
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

    const html = STEPS.map((label, i) => {
      const cls = i < activeIdx ? "step done" : (i === activeIdx ? "step active" : "step");
      return `<div class="${cls}">${esc(label)}</div>`;
    }).join("");

    t.innerHTML = html || "";
  }

  function kvRow(label, value) {
    const v = String(value ?? "").trim();
    if (!v) return "";
    return `<div class="kvRow"><div class="kvKey">${esc(label)} :</div><div class="kvVal">${esc(v)}</div></div>`;
  }

  function renderIdentite(p) {
    const rows = [];
    rows.push(`<div class="sectionTitle">Dates clés :</div>`);

    const knownDates = [
      ["Avis MMA conforme", p["Avis MMA conforme"]],
      ["Convention et programme", p["Convention et programme"]],
      ["Notification marché(s)", p["Notification marché(s)"]],
      ["CT & SPS", p["CT & SPS"]],
      ["MPGP", p["MPGP"]],
      ["Réception", p["Réception"]],
      ["Exploitation maintenance", p["Exploitation maintenance"]],
    ];

    const dateLis = knownDates
      .filter(([, v]) => String(v ?? "").trim())
      .map(([k, v]) => `<li><b>${esc(k)}</b> ${esc(String(v).trim())}</li>`)
      .join("");

    rows.push(`<ul class="list">${dateLis || `<li class="small">—</li>`}</ul>`);

    rows.push(`<div class="sectionTitle">Montage :</div>`);
    rows.push(`<div class="kv">${kvRow("Type de montage", p["Type de montage"]) || `<div class="small">—</div>`}</div>`);

    rows.push(`<div class="sectionTitle">Programme budgétaire :</div>`);
    rows.push(`<div class="kv">${kvRow("Programme", p["Programme"]) || `<div class="small">—</div>`}</div>`);

    rows.push(`<div class="sectionTitle">Budget opération :</div>`);
    const bud = formatEuro(p["Montant"] ?? p["Budget opération"]);
    rows.push(`<div class="kv">${kvRow("Montant", bud) || `<div class="small">—</div>`}</div>`);

    return rows.join("");
  }

  function renderActus(p) {
    const rows = [];
    const actusText = String(p["Actualités"] ?? "").trim();
    if (actusText) rows.push(`<div>${esc(actusText)}</div>`);

    rows.push(`<div class="sectionTitle">Points de vigilance / enjeux stratégiques et politique</div>`);

    const v = p["Vigilance"] ?? p["Points de vigilance"];
    let items = [];
    if (Array.isArray(v)) items = v.map(String).filter(s => s.trim());
    else if (typeof v === "string") items = v.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    const htmlItems = (items.length ? items : ["—"]).map((t, i) => {
      const cls = i === 0 ? "dot" : (i === 1 ? "dot" : (i === 2 ? "dot orange" : "dot green"));
      return `<div class="bulletRow"><span class="${cls}"></span><div>${esc(t)}</div></div>`;
    }).join("");

    rows.push(`<div class="bullets">${htmlItems}</div>`);
    return rows.join("");
  }

  function renderContacts(p) {
    const lines = [];
    const add = (title, val) => {
      const s = String(val ?? "").trim();
      if (!s) return;
      lines.push(`<div class="sectionTitle">${esc(title)}</div>`);
      lines.push(`<div>${esc(s).replace(/\n/g, "<br>")}</div>`);
    };

    add("Acheteur", p["Acheteur"]);
    add("Contact RPROG", p["Contact RPROG"]);
    add("Contact MOE", p["Contact MOE"]);

    const other = p["Contacts"] ?? "";
    if (String(other).trim()) add("Autres contacts", other);

    if (!lines.length) return `<div class="small">—</div>`;
    return lines.join("");
  }

  function fillTop(p) {
    const t = el("title"); if (t) t.textContent = p["Nom de projet"] || "Projet";
    const maj = el("maj"); if (maj) maj.textContent = p["Maj"] || p["Màj"] || p["Mise à jour"] || new Date().toLocaleDateString("fr-FR");
    const adr = el("adresse"); if (adr) adr.textContent = p["Adresse"] || "";
    const eq = el("equipe"); if (eq) eq.textContent = p["Équipe projet"] || p["Equipe projet"] || "";
    const proc = el("processus"); if (proc) proc.textContent = p["Type de projet"] || "";
    const res = el("resume"); if (res) res.textContent = p["Résumé"] || "";
  }

  async function load() {
    if (!code) {
      const t = el("title"); if (t) t.textContent = "Code projet manquant";
      const r = el("resume"); if (r) r.textContent = "Ouvrez la fiche depuis un projet (bouton “Fiche A4” dans le panneau latéral).";
      renderTimeline(-1);
      return;
    }

    const res = await fetch(`${PROJECTS_URL}?v=${encodeURIComponent(Date.now())}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Impossible de charger export_projets_web.json");

    const data = await res.json();
    const list = Array.isArray(data) ? data : (data?.projets || []);
    const p = list.find(x => String(x?.["Code projet"] ?? "").trim() === code);

    if (!p) {
      const t = el("title"); if (t) t.textContent = `Projet introuvable (code ${code})`;
      const r = el("resume"); if (r) r.textContent = "Vérifiez le Code projet dans export_projets_web.json.";
      renderTimeline(-1);
      return;
    }

    fillTop(p);
    renderTimeline(guessStepIndex(p["Phase projet"]));

    const ident = el("identite"); if (ident) ident.innerHTML = renderIdentite(p);
    const actus = el("actus"); if (actus) actus.innerHTML = renderActus(p);
    const cont = el("contacts"); if (cont) cont.innerHTML = renderContacts(p);

    document.title = `Fiche — ${p["Nom de projet"] || code}`;
  }

  // Imprimer
  document.getElementById("btnPrint")?.addEventListener("click", () => window.print());

  // Retour à la carte : ferme l'onglet (sans navigation).
  // NB: window.close() fonctionne si l'onglet a été ouvert par un clic (target="_blank" / window.open).
  document.querySelector(".backlink")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.close();
  });

  load().catch((e) => {
    const t = el("title"); if (t) t.textContent = "Erreur";
    const r = el("resume"); if (r) r.textContent = String(e?.message || e);
    renderTimeline(-1);
  });
})();

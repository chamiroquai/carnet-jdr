/* Carnet JDR — modules de jeu (étape 3) : fiches, création guidée, sauvegardes,
   dégâts, inventaire à emplacements, repos et tables aléatoires.
   Moteur générique : aucun contenu de jeu ici. Les modules sont des fichiers JSON
   importés par l'utilisateur et stockés sur l'appareil. Chargé avant app.js. */
'use strict';

const FORMAT_MODULE = 'carnet-jdr-module';

/* ---------- Formules de dés : « 3d6h2 », « 1d6+1 », « 2d20l1 », « d6xd6 » ---------- */
function lireFormule(f) {
  if (f && typeof f === 'object') return f;
  const s = String(f || '').trim().toLowerCase().replace(/\s/g, '');
  const g = s.match(/^d(\d+)xd(\d+)$/);
  if (g) return { grille: [Number(g[1]), Number(g[2])] };
  const m = s.match(/^(\d*)d(\d+)(?:([hl])(\d+))?([+-]\d+)?$/);
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : 1;
  return { n, faces: Number(m[2]), garde: m[3] || 'tous', k: m[4] ? Number(m[4]) : n, mod: m[5] ? Number(m[5]) : 0 };
}
function formuleCourte(f) {
  const x = lireFormule(f);
  if (!x) return '';
  if (x.grille) return `d${x.grille[0]} × d${x.grille[1]}`;
  return `${x.n > 1 ? x.n : ''}d${x.faces}${x.garde !== 'tous' && x.k < x.n ? (x.garde === 'h' ? ' (meilleurs ' : ' (plus faibles ') + x.k + ')' : ''}${x.mod ? ' ' + signe(x.mod) : ''}`;
}
function nbDes(f) { const x = lireFormule(f); return !x ? 0 : x.grille ? 2 : x.n; }
function facesDe(f, i) { const x = lireFormule(f); return x.grille ? x.grille[i] : x.faces; }

/* ---------- Module actif ---------- */
function modulesImportes() { return etat.contenus.filter(c => c.donnees.format === FORMAT_MODULE); }
function moduleActif() {
  const id = etat.partie?.module;
  return id ? etat.contenus.find(c => c.id === id)?.donnees || null : null;
}
function tableParId(mod, id) { return (mod.tables || []).find(t => t.id === id) || null; }
function remplirModele(s, vars) { return String(s).replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? `{${k}}`); }

/* ---------- Validation d'un module ---------- */
function validerModule(d) {
  const erreurs = [], avert = [];
  if (!d.id || !d.nom) erreurs.push('Champs « id » et « nom » obligatoires.');
  if (!d.fiches || typeof d.fiches !== 'object' || !Object.keys(d.fiches).length) erreurs.push('Aucune fiche décrite (section « fiches »).');
  const ids = new Set();
  for (const t of d.tables || []) {
    if (!t.id) { erreurs.push(`Table sans id (« ${t.nom ?? '?'} »).`); continue; }
    if (ids.has(t.id)) erreurs.push(`Table « ${t.id} » en double.`);
    ids.add(t.id);
    if (t.de && !lireFormule(t.de)) erreurs.push(`Table « ${t.nom} » : dé illisible (« ${t.de} »).`);
    if (t.de && (t.entrees || []).length) {
      const p = plagesTable(t);
      const f = lireFormule(t.de);
      if (f.grille) { if (t.entrees.length !== f.grille[0] * f.grille[1]) avert.push(`Table « ${t.nom} » : ${t.entrees.length} entrées pour une grille ${f.grille.join(' × ')}.`); }
      else {
        const min = minFormule(f), max = maxFormule(f);
        for (let v = min; v <= max; v++) if (!p.some(x => v >= x[0] && v <= x[1])) { avert.push(`Table « ${t.nom} » : aucune entrée pour ${v}.`); break; }
      }
    }
  }
  for (const t of d.tables || []) for (const e of t.entrees || []) {
    if (e && e.suite && !ids.has(e.suite)) avert.push(`Table « ${t.nom} » : suite « ${e.suite} » introuvable.`);
  }
  for (const [type, def] of Object.entries(d.fiches || {})) {
    for (const p of def.creation || []) {
      if (p.table && !String(p.table).includes('{') && !ids.has(p.table)) avert.push(`Création « ${def.nom || type} » / ${p.nom} : table « ${p.table} » introuvable.`);
    }
  }
  if (d.memo != null && (!Array.isArray(d.memo) || d.memo.some(x => !x || !x.titre || !Array.isArray(x.points)))) avert.push('Section « memo » mal formée (attendu : liste de { titre, points }).');
  for (const g of d.generateurs || []) for (const id of g.tables || []) if (!ids.has(id)) avert.push(`Générateur « ${g.nom} » : table « ${id} » introuvable.`);
  if (typeof validerModulePlus === 'function') validerModulePlus(d, erreurs, avert);
  return { erreurs, avert };
}
function minFormule(f) { return (f.garde !== 'tous' ? f.k : f.n) + (f.mod || 0); }
function maxFormule(f) { return (f.garde !== 'tous' ? f.k : f.n) * f.faces + (f.mod || 0); }

/* Plages [min, max] de chaque entrée : « n » explicite, sinon à la suite de la précédente */
function plagesTable(t) {
  const f = lireFormule(t.de);
  let suivant = f && !f.grille ? minFormule(f) : 1;
  return (t.entrees || []).map(e => {
    const n = typeof e === 'object' ? e.n : undefined;
    const p = Array.isArray(n) ? n : n != null ? [n, n] : [suivant, suivant];
    suivant = p[1] + 1;
    return p;
  });
}
const entreeObj = e => (typeof e === 'string' ? { texte: e } : e);

/* ---------- Tirage sur une table ---------- */
function tirerTable(mod, t, valeurs) {
  const f = lireFormule(t.de);
  if (!f) return null;
  if (f.grille) {
    const [c, l] = valeurs || [de(f.grille[0]), de(f.grille[1])];
    const e = t.entrees?.length ? entreeObj(t.entrees[(c - 1) * f.grille[1] + (l - 1)]) : null;
    return { table: t.nom, tableId: t.id, de: formuleCourte(t.de), valeur: `${c}-${l}`, entree: e,
      texte: e ? e.texte : `colonne ${c}, ligne ${l}`, detail: e?.detail || (e ? `colonne ${c}, ligne ${l}` : '') };
  }
  const j = calculerJet(f, valeurs);
  const plages = plagesTable(t);
  const i = plages.findIndex(p => j.total >= p[0] && j.total <= p[1]);
  const e = i >= 0 ? entreeObj(t.entrees[i]) : null;
  return { table: t.nom, tableId: t.id, de: formuleCourte(t.de), valeur: j.total, des: j.des, entree: e,
    texte: e ? e.texte : t.entrees?.length ? `aucune entrée pour ${j.total}` : String(j.total), detail: e?.detail || '' };
}

/* Résout un tirage avec ses relances et ses suites (les tirages enchaînés sont virtuels) */
function resoudreTable(mod, id, valeurs, profondeur = 0) {
  const t = tableParId(mod, id);
  if (!t || profondeur > 12) return [];
  const r = tirerTable(mod, t, valeurs);
  if (!r) return [];
  const e = r.entree;
  if (e?.relancer) {
    let sous;
    for (let essai = 0; essai < 10; essai++) {
      sous = resoudreTable(mod, id, null, profondeur + 1);
      if (!sous[0]?.entree?.relancer) break;
    }
    const premier = sous.shift() || r;
    premier.valeur = `${r.valeur} → ${premier.valeur}`;
    if (e.relancer !== 'remplacer') premier.texte = `${premier.texte} (${e.texte.toLowerCase()})`;
    if (e.detail) premier.detail = [premier.detail, e.detail].filter(Boolean).join(' ');
    return [premier, ...sous];
  }
  const res = [r];
  if (e?.suite) res.push(...resoudreTable(mod, e.suite, null, profondeur + 1));
  return res;
}

function texteResultats(rs) {
  return rs.map(r => `${r.table} (${r.de} = ${r.valeur}) → ${r.texte}`).join(' ; ');
}

async function noterTables(rs, physique, libelle) {
  await noter({ type: 'table', libelle: libelle || '', physique: !!physique,
    resultats: rs.map(r => ({ table: r.table, de: r.de, valeur: r.valeur, texte: r.texte, detail: r.detail || '' })) });
}

/* ---------- Fiches ---------- */
function defFiche(mod, type) { return mod?.fiches?.[type] || null; }
function nomFiche(f, def) { return f.champs?.nom || (def ? def.nom : 'Sans nom'); }

function nouvelleFiche(mod, type, role) {
  const def = defFiche(mod, type);
  const f = { id: nouvelId(), type, role: role || '', creeLe: maintenant(), jauges: {}, compteurs: {}, champs: {}, inventaire: {}, surplus: [] };
  for (const j of def.jauges || []) f.jauges[j.id] = { max: j.max ?? 0, act: j.max ?? 0 };
  for (const c of def.compteurs || []) f.compteurs[c.id] = c.defaut ?? 0;
  return completerFiche(f, def);
}

function tailleGroupe(f, g) {
  if (typeof g.taille === 'number') return g.taille;
  const m = String(g.taille || '').match(/^jauge:(\w+)$/);
  return m ? Math.max(0, f.jauges[m[1]]?.max | 0) : 0;
}
/* Emplacements d'un groupe, ajustés à sa taille (le surplus part dans « surplus ») */
function emplacements(f, g) {
  const n = tailleGroupe(f, g);
  let a = f.inventaire[g.id] || [];
  while (a.length < n) a.push(null);
  if (a.length > n) {
    a.slice(n).forEach(x => { if (x && !x.suite) f.surplus.push(x); });
    a = a.slice(0, n);
    if (a.length && a[a.length - 1]?.encombrant) { /* objet encombrant coupé : il garde sa place */ }
  }
  f.inventaire[g.id] = a;
  return a;
}

function placerObjet(f, def, objet, prefere) {
  const inv = def.inventaire;
  if (!inv) { f.surplus.push(objet); return 'surplus'; }
  const ordre = [...new Set([prefere, ...(inv.ordre || []), ...inv.groupes.map(g => g.id)].filter(Boolean))];
  for (const gid of ordre) {
    const g = inv.groupes.find(x => x.id === gid);
    if (!g) continue;
    const a = emplacements(f, g);
    for (let i = 0; i < a.length; i++) {
      if (a[i]) continue;
      if (objet.encombrant) { if (i + 1 < a.length && !a[i + 1]) { a[i] = objet; a[i + 1] = { suite: true }; return g.nom; } }
      else { a[i] = objet; return g.nom; }
    }
  }
  f.surplus.push(objet);
  return 'surplus';
}

function retirerSlot(f, gid, i) {
  if (gid === 'surplus') return f.surplus.splice(i, 1)[0] || null;
  const a = f.inventaire[gid];
  const x = a[i];
  if (!x) return null;
  a[i] = null;
  if (x.encombrant && a[i + 1]?.suite) a[i + 1] = null;
  return x;
}

function occupation(f, def) {
  const inv = def.inventaire;
  if (!inv) return { total: 0, pris: 0 };
  let total = 0, pris = 0;
  for (const g of inv.groupes) { const a = emplacements(f, g); total += a.length; pris += a.filter(Boolean).length; }
  return { total, pris };
}

async function sauverPartie() {
  etat.partie.majLe = maintenant();
  await DB.mettre('parties', etat.partie);
  await signalerChangement();
}
function ficheParId(id) { return (etat.partie?.fiches || []).find(f => f.id === id) || null; }

/* ---------- Création guidée ---------- */
function creationCourante() { return etat.partie?.creation || null; }

function valeurJauge(c, id) { return (c.bases[id] ?? 0) + (c.modifs[id] ?? 0); }
function synchroniserCreation(c) {
  for (const id of Object.keys(c.fiche.jauges)) {
    if (c.bases[id] == null) continue;
    const v = valeurJauge(c, id);
    c.fiche.jauges[id] = { max: v, act: v };
  }
}

function appliquerEffets(c, effets) {
  for (const ef of effets || []) {
    if (ef.jauge != null) {
      if (ef.fixer != null) c.bases[ef.jauge] = ef.fixer - (c.modifs[ef.jauge] || 0);
      if (ef.mod) c.modifs[ef.jauge] = (c.modifs[ef.jauge] || 0) + ef.mod;
    }
    if (ef.compteur != null) {
      if (ef.fixer != null) c.fiche.compteurs[ef.compteur] = ef.fixer;
      if (ef.mod) c.fiche.compteurs[ef.compteur] = (c.fiche.compteurs[ef.compteur] || 0) + ef.mod;
    }
    appliquerEffetPlus(c.fiche, ef);
  }
  synchroniserCreation(c);
}

function ajouterChamp(f, id, texte, ajouter) {
  if (!texte) return;
  const avant = f.champs[id];
  f.champs[id] = ajouter && avant ? `${avant}\n${texte}` : texte;
}

async function commencerCreation(type, role, vierge) {
  const mod = moduleActif();
  const fiche = nouvelleFiche(mod, type, role);
  const def = defFiche(mod, type);
  if (vierge || !(def.creation || []).length) {
    recalculerFiche(mod, fiche, def);
    etat.partie.fiches = [...(etat.partie.fiches || []), fiche];
    await sauverPartie();
    etat.ficheOuverte = fiche.id; etat.ficheEdition = true;
    return rendre();
  }
  etat.partie.creation = { type, role, pas: 0, fiche, vars: {}, bases: {}, modifs: {}, resume: [], courant: null };
  sauterEtapesInactives(mod, etat.partie.creation);
  await sauverPartie();
  rendre();
}

function pasCourant(mod, c) { return defFiche(mod, c.type).creation[c.pas] || null; }

/* Lance (ou saisit) le résultat de l'étape courante ; rien n'est appliqué avant « Valider » */
function tirerEtape(mod, c, p, valeurs, choixManuel) {
  if (p.type === 'table') {
    const tid = remplirModele(p.table, c.vars);
    const t = tableParId(mod, tid);
    if (!t) return { erreur: `Table « ${tid} » introuvable dans le module.` };
    const n = p.repeter || 1;
    if (choixManuel != null) {
      const e = entreeObj(t.entrees[choixManuel]);
      const choix = [{ table: t.nom, tableId: t.id, de: 'choix', valeur: '—', entree: e, texte: e.texte, detail: e.detail || '' }];
      if (e.suite) choix.push(...resoudreTable(mod, e.suite));
      // Avec plusieurs tirages (ex. « lance deux fois »), les choix manuels s'ajoutent un par un.
      const avant = c.courant?.manuel && c.courant.tirages.length < n ? c.courant.tirages : [];
      return { type: 'table', tirages: [...avant, choix], manuel: true };
    }
    const nd = nbDes(t.de);
    const tirages = [];
    for (let k = 0; k < n; k++) tirages.push(resoudreTable(mod, tid, valeurs ? valeurs.slice(k * nd, (k + 1) * nd) : null));
    return { type: 'table', tirages, physique: !!valeurs };
  }
  if (p.type === 'choix') {
    let i = choixManuel;
    let valeur = null;
    if (i == null) {
      const j = calculerJet(lireFormule(p.de), valeurs);
      valeur = j.total;
      const pl = plagesTable({ de: p.de, entrees: p.options });
      i = pl.findIndex(x => valeur >= x[0] && valeur <= x[1]);
      if (i < 0) return { erreur: `Aucune option pour ${valeur}.` };
    }
    return { type: 'choix', i, valeur, physique: !!valeurs };
  }
  if (p.type === 'attributs') {
    const f = lireFormule(p.formule);
    const jets = p.jauges.map((j, k) => calculerJet(f, valeurs ? valeurs.slice(k * f.n, (k + 1) * f.n) : null));
    return { type: 'attributs', jets: jets.map(j => ({ des: j.des, gardes: j.gardes, total: j.total })), ordre: [...p.jauges], physique: !!valeurs };
  }
  if (p.type === 'jet') {
    const j = calculerJet(lireFormule(p.formule), valeurs);
    return { type: 'jet', des: j.des, gardes: j.gardes, total: j.total, physique: !!valeurs };
  }
  return { type: p.type };
}

/* Applique le résultat validé de l'étape courante à la fiche en création */
function validerEtape(mod, c, p) {
  if (['repartition', 'ajustement', 'voie', 'voies'].includes(p.type)) return validerEtapePlus(mod, c, p);
  const r = c.courant;
  const f = c.fiche;
  const lignes = [];
  const cible = String(p.cible || '');
  const [genre, id] = cible.split(':');
  const appliquerEntree = (e, rs) => {
    if (!e) return;
    if (e.var) Object.assign(c.vars, e.var);
    if (e.champs) for (const [k, v] of Object.entries(e.champs)) ajouterChamp(f, k, v, true);
    if (e.armes) f.armes = [...(f.armes || []), ...e.armes.map(a => ({ ...a }))];
    appliquerEffets(c, e.effets);
  };
  if (p.type === 'table' && r) {
    for (const rs of r.tirages) {
      const [premier, ...suites] = rs;
      if (!premier) continue;
      const e = premier.entree || {};
      lignes.push(`${p.nom} : ${premier.texte} (${premier.de} = ${premier.valeur})${r.relance ? ' — relancé' : ''}`);
      if (genre === 'inventaire' && e.objet !== false) {
        const ou = placerObjet(f, defFiche(mod, c.type), { texte: premier.texte, encombrant: !!e.encombrant }, e.groupe || p.groupe);
        if (ou === 'surplus') lignes.push(`  (plus de place : « ${premier.texte} » en surplus)`);
      } else if (genre === 'inventaire') ajouterChamp(f, 'notes', premier.texte, true);
      else if (genre === 'champ') {
        const detailIci = p.detail === cible && premier.detail;
        ajouterChamp(f, id, detailIci ? `${premier.texte} — ${premier.detail}` : premier.texte, (p.repeter || 1) > 1 || !!p.ajouter);
      }
      if (p.detail && p.detail !== cible && premier.detail) ajouterChamp(f, p.detail.split(':')[1], premier.detail, true);
      appliquerEntree(e);
      for (const s of suites) {
        lignes.push(`  ${s.table} : ${s.texte} (${s.de} = ${s.valeur})`);
        ajouterChamp(f, 'notes', `${s.table} : ${s.texte}${s.detail ? ' — ' + s.detail : ''}`, true);
        appliquerEntree(s.entree);
      }
    }
  } else if (p.type === 'choix' && r) {
    const o = entreeObj(p.options[r.i]);
    if (genre === 'champ') ajouterChamp(f, id, o.texte, false);
    appliquerEntree(o);
    lignes.push(`${p.nom} : ${o.texte}${r.valeur != null ? ` (${formuleCourte(p.de)} = ${r.valeur})` : ' (choisi)'}${o.detail ? ' — ' + o.detail : ''}`);
  } else if (p.type === 'attributs' && r) {
    const def = defFiche(mod, c.type);
    p.jauges.forEach((jid, k) => { c.bases[jid] = r.jets[k].total; });
    synchroniserCreation(c);
    lignes.push(`${p.nom} : ` + p.jauges.map((jid, k) => {
      const jd = def.jauges.find(x => x.id === jid);
      const des = r.jets[k].des.map((v, i) => (r.jets[k].gardes.includes(i) ? v : `(${v})`)).join(', ');
      return `${jd?.abr || jid} ${valeurJauge(c, jid)} [${des}${c.modifs[jid] ? ' ' + signe(c.modifs[jid]) : ''}]`;
    }).join(', ') + (r.echanges?.length ? ` — échange : ${r.echanges.join(', ')}` : ''));
  } else if (p.type === 'jet' && r) {
    if (genre === 'jauge') { c.bases[id] = r.total; synchroniserCreation(c); }
    if (genre === 'compteur') f.compteurs[id] = (f.compteurs[id] || 0) + r.total;
    lignes.push(`${p.nom} : ${r.total} (${formuleCourte(p.formule)}${r.des.length > 1 ? ' : ' + r.des.join(', ') : ''})`);
  } else if (p.type === 'saisie') {
    const vus = [];
    for (const ch of p.champs) {
      const el = document.getElementById('cr-' + ch);
      if (el && el.value.trim()) { f.champs[ch] = el.value.trim(); vus.push(ch); }
    }
    if (vus.length) lignes.push(`${p.nom} : renseigné`);
  } else if (p.type === 'objets') {
    const liste = objetsEtape(p, c.vars);
    if (genre === 'champ') ajouterChamp(f, id, liste.map(o => o.texte).join('\n'), true);
    else for (const o of liste) placerObjet(f, defFiche(mod, c.type), { texte: o.texte, encombrant: !!o.encombrant }, o.groupe);
    for (const o of liste) {
      if (o.arme) f.armes = [...(f.armes || []), { nom: o.arme.nom || o.texte, attaque: o.arme.attaque || '', dm: o.arme.dm || '', notes: o.arme.notes || '' }];
      appliquerEffets(c, o.effets);
    }
    lignes.push(`${p.nom} : ${liste.map(o => o.texte).join(', ')}`);
  }
  c.resume.push(...lignes);
}

async function terminerCreation() {
  const c = creationCourante();
  const mod = moduleActif();
  const def = defFiche(mod, c.type);
  synchroniserCreation(c);
  const f = c.fiche;
  f.vars = { ...(f.vars || {}), ...c.vars };
  if (def.voies) f.pointsGratuits = coutVoies(mod, f, def);
  recalculerFiche(mod, f, def);
  for (const j of def.jauges || []) if (j.maxFormule && f.jauges[j.id]) f.jauges[j.id].act = f.jauges[j.id].max;
  etat.partie.fiches = [...(etat.partie.fiches || []), f];
  delete etat.partie.creation;
  await noter({ type: 'fiche', texte: `Création : ${nomFiche(f, def)} (${def.nom}${f.role ? ', ' + roleFr(f.role) : ''})`, details: c.resume });
  etat.ficheOuverte = f.id;
  toast('Fiche créée');
  rendre();
}
const roleFr = r => ({ principal: 'personnage principal', secondaire: 'secondaire' }[r] || r);

/* ---------- Rendu : vue Jeu ---------- */
async function vueJeu() {
  const p = etat.partie;
  if (!p) return `<div class="carte vide"><p>Les fiches et les tables d'un jeu sont rattachées à une partie.</p>
    <button class="principal" data-action="aller-parties">Créer ou ouvrir une partie</button></div>`;
  const mod = moduleActif();
  if (!mod) {
    const mods = modulesImportes();
    return `<div class="carte">
      <h2>Module de jeu</h2>
      <p class="discret">La partie « ${esc(p.nom)} » n'est liée à aucun module.</p>
      ${mods.length ? `<div class="pile">${mods.map(m => `<button data-action="jeu-lier" data-id="${esc(m.id)}">Utiliser ${esc(m.donnees.nom)}</button>`).join('')}</div>` : ''}
      <div style="margin-top:12px"><button class="${mods.length ? '' : 'principal'}" data-action="importer">Importer un module (fichier JSON)</button></div>
      <p class="discret petit">Le module reste sur cet appareil, comme l'oracle.</p>
    </div>`;
  }
  if (etat.ficheOuverte && ficheParId(etat.ficheOuverte)) return vueFiche(mod, ficheParId(etat.ficheOuverte));
  const sous = etat.jeuSous || 'fiches';
  const puces = `<div class="puces sous-onglets">${[['fiches', 'Fiches'], ['tables', 'Tables'], ['memo', 'Mémo']].map(([k, l]) =>
    `<button class="puce ${sous === k ? 'choisie' : ''}" data-action="jeu-sous" data-v="${k}">${l}</button>`).join('')}</div>`;
  return puces + (sous === 'tables' ? vueTables(mod) : sous === 'memo' ? vueMemo(mod) : vueListeFiches(mod));
}

/* ---------- Rendu : mémo des règles (section « memo » du module) ---------- */
function enrichir(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
function vueMemo(mod) {
  const sections = Array.isArray(mod.memo) ? mod.memo : [];
  if (!sections.length) {
    return `<div class="carte"><h2>Mémo des règles</h2>
      <p class="discret">Ce module ne contient pas de mémo (section « memo » du fichier).</p>
      ${mod.test?.aide ? `<p>${enrichir(mod.test.aide)}</p>` : ''}</div>`;
  }
  return sections.map((sec, i) => `<details class="carte memo" data-garde="memo-${i}" ${i === 0 ? 'open' : ''}>
    <summary><strong>${esc(sec.titre)}</strong></summary>
    ${sec.intro ? `<p class="discret petit">${enrichir(sec.intro)}</p>` : ''}
    <ul>${(sec.points || []).map(x => `<li>${enrichir(x)}</li>`).join('')}</ul>
  </details>`).join('');
}

function resumeJauges(f, def) {
  return (def.jauges || []).filter(j => !(j.masquerSiZero && !(f.jauges[j.id]?.max))).map(j => `${esc(j.abr || j.nom)} ${f.jauges[j.id]?.act ?? 0}/${f.jauges[j.id]?.max ?? 0}`).join(' · ');
}

function vueListeFiches(mod) {
  const p = etat.partie;
  const c = creationCourante();
  const fiches = [...(p.fiches || [])].sort((a, b) => (a.role === 'principal' ? -1 : 0) - (b.role === 'principal' ? -1 : 0));
  let html = '';
  if (c) html += vueCreation(mod, c);
  html += fiches.map(f => {
    const def = defFiche(mod, f.type);
    if (!def) return `<div class="carte"><div class="titre">${esc(f.champs?.nom || 'Fiche')}</div><p class="discret petit">Type « ${esc(f.type)} » absent du module actuel.</p></div>`;
    return `<div class="carte fiche-resume ${f.role === 'principal' ? 'principal' : ''}" data-action="jeu-ouvrir" data-id="${esc(f.id)}">
      <div class="titre">${esc(nomFiche(f, def))} ${f.role === 'principal' ? '<span class="etiquette">principal</span>' : ''}</div>
      <div class="discret petit">${esc(def.nom)}${def.niveau ? ` · niv. ${f.niveau ?? 1}` : ''}${(def.resume || ['creature', 'classe', 'role']).filter(k => f.champs[k]).map(k => ' · ' + esc(f.champs[k])).join('')}</div>
      <div class="petit" style="margin-top:4px">${resumeJauges(f, def)}</div>
    </div>`;
  }).join('');
  if (!c) {
    const nf = etat.nouvelleFiche;
    const types = Object.entries(mod.fiches);
    html += nf ? `<div class="carte">
      <h2>Nouvelle fiche</h2>
      <div class="puces">${types.map(([k, d]) => `<button class="puce ${nf.type === k ? 'choisie' : ''}" data-action="nf-type" data-v="${esc(k)}">${esc(d.nom)}</button>`).join('')}</div>
      <h3>Rôle dans l'histoire</h3>
      <div class="puces">${[['principal', 'Principal'], ['secondaire', 'Secondaire'], ['', 'Aucun']].map(([k, l]) =>
        `<button class="puce ${nf.role === k ? 'choisie' : ''}" data-action="nf-role" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="pile" style="margin-top:12px">
        ${(mod.fiches[nf.type]?.creation || []).length ? `<button class="principal" data-action="nf-guidee">Création guidée (${mod.fiches[nf.type].creation.length} étapes)</button>` : ''}
        <button data-action="nf-vierge">Fiche vierge à remplir</button>
        <button class="lien" data-action="nf-annuler">Annuler</button>
      </div>
    </div>` : `<button class="principal" data-action="nf-ouvrir">Nouvelle fiche</button>`;
  }
  if (!fiches.length && !c && !etat.nouvelleFiche) html += `<p class="discret petit" style="text-align:center">Commence par ton personnage principal, puis l'équipage et le vaisseau.</p>`;
  return html;
}

/* ---------- Rendu : création ---------- */
function champsDef(def) { return [{ id: 'nom', nom: 'Nom' }, ...(def.champs || [])]; }

function vueCreation(mod, c) {
  const def = defFiche(mod, c.type);
  const etapes = def.creation;
  const p = etapes[c.pas];
  let corps = '';
  if (!p) {
    corps = `<p>Toutes les étapes sont faites.</p>
      <button class="principal" data-action="cr-terminer">Enregistrer la fiche</button>`;
  } else {
    const r = c.courant;
    corps = `<h2>${c.pas + 1}/${etapes.length} · ${esc(p.nom)}</h2>
      ${p.aide ? `<p class="discret petit">${esc(p.aide)}</p>` : ''}
      ${r?.erreur ? `<p class="force">${esc(r.erreur)}</p>` : ''}
      ${corpsEtape(mod, c, p, r)}
      <div class="rangee" style="margin-top:12px">
        <button class="lien" data-action="cr-passer">${p.facultatif || p.type === 'saisie' ? 'Passer' : 'Passer cette étape'}</button>
        ${(r && !r.erreur && !['ajustement', 'voies'].includes(p.type)) || ETAPES_SANS_JET.includes(p.type) ? `<button class="principal" style="flex:2" data-action="cr-valider">Valider et continuer</button>` : ''}
      </div>`;
  }
  return `<div class="carte creation">
    <div class="discret petit">Création : ${esc(def.nom)}${c.role ? ' · ' + esc(roleFr(c.role)) : ''}</div>
    ${corps}
    ${apercuCreation(mod, c)}
    <button class="lien danger" data-action="cr-abandon">Abandonner la création</button>
  </div>`;
}

function blocPhysique(id, n, faces, libelle) {
  return `<details class="de-physique" data-garde="${id}">
    <summary>${libelle || 'J’ai lancé mes dés'} (${n > 1 ? n + ' × ' : ''}${Array.isArray(faces) ? faces.map(x => 'd' + x).join(' + ') : 'd' + faces})</summary>
    <div class="rangee">${Array.from({ length: n }, (_, i) =>
      `<input type="number" inputmode="numeric" min="1" max="${Array.isArray(faces) ? faces[i] : faces}" id="${id}-${i}" placeholder="d${Array.isArray(faces) ? faces[i] : faces}">`).join('')}
      <button data-action="${id}">Valider</button></div>
  </details>`;
}
function lireValeursPhysiques(id, n, faces) {
  const v = Array.from({ length: n }, (_, i) => lireEntier(document.getElementById(`${id}-${i}`)?.value ?? '', 1, Array.isArray(faces) ? faces[i] : faces));
  return v.some(x => x == null) ? null : v;
}

function corpsEtape(mod, c, p, r) {
  if (['repartition', 'ajustement', 'voie', 'voies', 'objets'].includes(p.type)) return corpsEtapePlus(mod, c, p, r);
  if (p.type === 'table') {
    const tid = remplirModele(p.table, c.vars);
    const t = tableParId(mod, tid);
    if (!t) return `<p class="force">Table « ${esc(tid)} » introuvable (étape précédente passée ?).</p>`;
    const n = p.repeter || 1;
    const f = lireFormule(t.de);
    const nd = nbDes(t.de) * n;
    const faces = f.grille ? f.grille : f.faces;
    let html = `<p class="discret petit">${esc(t.nom)} · ${esc(formuleCourte(t.de))}${n > 1 ? ` × ${n}` : ''}</p>`;
    if (r && r.tirages) {
      if (r.manuel && r.tirages.length < n) html += `<p class="discret petit">Choix ${r.tirages.length}/${n} : choisis encore dans la liste.</p>`;
      html += `<div class="resultat">${r.tirages.map(rs => rs.map((x, k) => `<div class="${k ? 'meta' : 'reponse petit-rep'}">${k ? esc(x.table) + ' : ' : ''}${esc(x.texte)}</div>
        ${x.detail ? `<div class="meta">${esc(x.detail)}</div>` : ''}
        <div class="meta">${esc(x.de)} = ${esc(x.valeur)}</div>`).join('')).join('<hr>')}</div>
        <button class="lien" data-action="cr-lancer">Relancer</button>`;
    } else {
      html += `<button class="principal" data-action="cr-lancer">Lancer ${esc(formuleCourte(t.de))}${n > 1 ? ' × ' + n : ''}</button>
        ${blocPhysique('cr-phys', nd, f.grille ? [...Array(n)].flatMap(() => f.grille) : faces)}`;
    }
    html += `<details class="de-physique" data-garde="cr-choix"><summary>Choisir dans la liste${n > 1 ? ` (${n} fois)` : ''}</summary>
      <div class="pile">${(t.entrees || []).map((e, i) => { const o = entreeObj(e); return o.relancer ? '' : `<button data-action="cr-choisir" data-i="${i}">${esc(o.texte)}${o.detail ? `<small class="discret"> — ${esc(o.detail)}</small>` : ''}</button>`; }).join('')}</div>
    </details>`;
    return html;
  }
  if (p.type === 'choix') {
    const f = lireFormule(p.de);
    return `<div class="pile">${p.options.map((o, i) => `<button class="${r && r.i === i ? 'choisi' : ''}" data-action="cr-choisir" data-i="${i}">
        ${esc(o.texte)}${o.detail ? `<small class="discret"> — ${esc(o.detail)}</small>` : ''}</button>`).join('')}</div>
      ${r && r.valeur != null ? `<p class="meta">${esc(formuleCourte(p.de))} = ${r.valeur}</p>` : ''}
      ${f ? `<div style="margin-top:10px"><button data-action="cr-lancer">Lancer ${esc(formuleCourte(p.de))}</button></div>${blocPhysique('cr-phys', f.n, f.faces)}` : ''}`;
  }
  if (p.type === 'attributs') {
    const f = lireFormule(p.formule);
    const def = defFiche(mod, c.type);
    const abr = id => def.jauges.find(j => j.id === id)?.abr || id;
    if (!r || !r.jets) return `<button class="principal" data-action="cr-lancer">Lancer ${p.jauges.length} × ${esc(formuleCourte(p.formule))}</button>
      ${blocPhysique('cr-phys', f.n * p.jauges.length, f.faces, `J’ai lancé mes dés (${p.jauges.map(abr).join(', ')} dans l’ordre)`)}`;
    return `<div class="resultat attributs">${p.jauges.map((jid, k) => {
      const j = r.jets[k];
      const m = c.modifs[jid] || 0;
      return `<div class="attr"><strong>${esc(abr(jid))}</strong> <span class="reponse petit-rep">${j.total + m}</span>
        <div class="meta">${j.des.map((v, i) => `<span class="de-res ${j.gardes.includes(i) ? '' : 'ecarte'}">${v}</span>`).join('')}${m ? ` ${signe(m)} (taille)` : ''}</div></div>`;
    }).join('')}</div>
    ${p.echange ? `<h3>Échanger deux valeurs</h3><div class="rangee">
      <select id="cr-ech-a">${p.jauges.map(j => `<option value="${esc(j)}">${esc(abr(j))}</option>`).join('')}</select>
      <select id="cr-ech-b">${p.jauges.map((j, i) => `<option value="${esc(j)}" ${i === 1 ? 'selected' : ''}>${esc(abr(j))}</option>`).join('')}</select>
      <button data-action="cr-echanger">Échanger</button></div>
      ${r.echanges?.length ? `<p class="discret petit">Échange : ${esc(r.echanges.join(', '))}</p>` : ''}` : ''}
    <button class="lien" data-action="cr-lancer">Relancer tout</button>`;
  }
  if (p.type === 'jet') {
    const f = lireFormule(p.formule);
    if (!r || r.total == null) return `<button class="principal" data-action="cr-lancer">Lancer ${esc(formuleCourte(p.formule))}</button>${blocPhysique('cr-phys', f.n, f.faces)}`;
    return `<div class="resultat"><div class="reponse">${r.total}</div><div class="meta">${esc(formuleCourte(p.formule))}${r.des.length > 1 ? ' : ' + r.des.join(', ') : ''}</div></div>
      <button class="lien" data-action="cr-lancer">Relancer</button>`;
  }
  if (p.type === 'saisie') {
    const def = defFiche(mod, c.type);
    return p.champs.map(id => {
      const ch = champsDef(def).find(x => x.id === id) || { id, nom: id };
      const v = c.fiche.champs[id] || '';
      return `<h3>${esc(ch.nom)}</h3>${ch.long ? `<textarea id="cr-${esc(id)}" rows="3">${esc(v)}</textarea>` : `<input type="text" id="cr-${esc(id)}" value="${esc(v)}">`}`;
    }).join('');
  }
  return '';
}

function apercuCreation(mod, c) {
  const def = defFiche(mod, c.type);
  const f = c.fiche;
  const champs = champsDef(def).filter(ch => f.champs[ch.id]);
  const objets = (def.inventaire?.groupes || []).flatMap(g => (f.inventaire[g.id] || []).filter(x => x && !x.suite).map(x => x.texte));
  return `<details class="de-physique" data-garde="cr-apercu"><summary>Aperçu de la fiche</summary>
    ${apercuCreationPlus(mod, c) || `<p class="petit">${resumeJauges(f, def)}</p>`}
    <p class="petit">${(def.compteurs || []).map(k => `${esc(k.nom)} ${f.compteurs[k.id] ?? 0}`).join(' · ')}</p>
    ${champs.map(ch => `<p class="petit"><strong>${esc(ch.nom)} :</strong> ${esc(f.champs[ch.id])}</p>`).join('')}
    ${objets.length ? `<p class="petit"><strong>Inventaire :</strong> ${esc(objets.join(', '))}</p>` : ''}
    ${c.resume.length ? `<ul class="liste-simple petit discret">${c.resume.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
  </details>`;
}

/* ---------- Rendu : fiche ---------- */
function vueFiche(mod, f) {
  const def = defFiche(mod, f.type);
  if (!def) return `<div class="carte"><p>Type de fiche « ${esc(f.type)} » absent du module.</p><button data-action="jeu-fermer">Retour</button></div>`;
  if (etat.ficheEdition) return vueFicheEdition(mod, f, def);
  const nom = nomFiche(f, def);
  const test = mod.test;
  const testables = (def.jauges || []).filter(j => j.test);
  const occ = occupation(f, def);
  const encombre = f.surplus.length > 0;
  const mode = etat.modeSauvegarde || 'normal';
  const resJet = etat.dernier.jet?.origine === 'fiche:' + f.id ? rendreResultatJet(etat.dernier.jet) : '';
  const resTable = etat.dernier.table?.origine === 'fiche:' + f.id ? rendreResultatTable(etat.dernier.table) : '';
  const deg = etat.dernier.degats?.fiche === f.id ? etat.dernier.degats : null;
  let html = `<div class="rangee entete-fiche">
      <button class="lien" data-action="jeu-fermer">‹ Fiches</button>
      <button class="lien" style="text-align:center" data-action="jeu-memo">Mémo</button>
      <button class="lien" style="text-align:right" data-action="jeu-editer">Modifier</button>
    </div>
    <div class="carte">
      <div class="titre grand">${esc(nom)} ${f.role === 'principal' ? '<span class="etiquette">principal</span>' : f.role ? `<span class="discret petit">· ${esc(roleFr(f.role))}</span>` : ''}</div>
      <div class="discret petit">${esc(def.nom)}${def.resume ? def.resume.filter(k => f.champs[k]).map(k => ' · ' + esc(f.champs[k])).join('') : `${f.champs.creature ? ' · ' + esc(f.champs.creature) : ''}${f.champs.taille ? ' (' + esc(f.champs.taille.toLowerCase()) + ')' : ''}${f.champs.classe ? ' · ' + esc(f.champs.classe) : ''}`}</div>
      ${vueEnteteFichePlus(mod, f, def)}
      <div class="jauges">${(def.jauges || []).filter(j => !(j.masquerSiZero && !(f.jauges[j.id]?.max))).map(j => {
        const v = f.jauges[j.id] || { max: 0, act: 0 };
        const deJ = j.deVar && f.vars?.[j.deVar] ? ` (d${esc(f.vars[j.deVar])})` : '';
        return `<div class="jauge ${v.act <= 0 && v.max > 0 ? 'zero' : ''}">
          <div class="j-nom">${esc(j.abr || j.nom)}${deJ}<small>${esc(j.nom)}</small></div>
          <div class="j-val">${v.act}<small>/${v.max}</small></div>
          <div class="rangee serree"><button data-action="j-moins" data-j="${esc(j.id)}" aria-label="Moins">−</button><button data-action="j-plus" data-j="${esc(j.id)}" aria-label="Plus">+</button></div>
        </div>`;
      }).join('')}</div>
      ${(def.jauges || []).filter(j => j.zero && (f.jauges[j.id]?.act ?? 1) <= 0 && f.jauges[j.id]?.max > 0).map(j => `<p class="force">${esc(j.zero)}</p>`).join('')}
      ${(def.jauges || []).filter(j => j.bas && (f.jauges[j.id]?.act ?? 0) > 0 && f.jauges[j.id].act <= j.bas.seuil).map(j => `<p class="force">${esc(j.bas.texte)}</p>`).join('')}
      ${(def.compteurs || []).length ? `<div class="compteurs">${def.compteurs.map(k => `<button class="compteur" data-action="cpt" data-k="${esc(k.id)}">
          <small>${esc(k.nom)}</small><strong>${(f.compteurs[k.id] ?? 0).toLocaleString('fr-FR')}</strong></button>`).join('')}</div>` : ''}
    </div>`;

  if (test?.mode === 'bonus' && def.caracs) html += vueTestsBonus(mod, f, def);
  else if (test && testables.length) {
    html += `<div class="carte">
      <h2>${esc(test.nom || 'Test')}s</h2>
      <div class="puces">${[['normal', 'Normal'], ['avantage', 'Avantage'], ['desavantage', 'Désavantage']].map(([k, l]) =>
        `<button class="puce ${mode === k ? 'choisie' : ''}" data-action="sv-mode" data-v="${k}">${l}</button>`).join('')}</div>
      ${encombre && mode !== 'desavantage' ? '<p class="force">Encombré : sauvegardes avec désavantage.</p>' : ''}
      <div class="grille-3" style="margin-top:10px">${testables.map(j =>
        `<button data-action="sv" data-j="${esc(j.id)}"><strong>${esc(j.abr || j.nom)}</strong><small class="discret"> ≤ ${f.jauges[j.id]?.act ?? 0}</small></button>`).join('')}</div>
      <details class="de-physique" data-garde="sv-phys"><summary>Avec mes dés : saisis-les puis touche la caractéristique</summary>
        <div class="rangee"><input type="number" inputmode="numeric" id="sv-0" placeholder="d${test.de}">${mode !== 'normal' ? `<input type="number" inputmode="numeric" id="sv-1" placeholder="d${test.de}">` : ''}</div>
      </details>
      ${test.aide ? `<p class="discret petit">${esc(test.aide)}</p>` : ''}
      ${resJet}
    </div>`;
  }

  if (def.armes) html += vueArmes(mod, f, def);
  if (def.degats) {
    const cfg = def.degats;
    html += `<div class="carte">
      <h2>${esc(cfg.titre || 'Subir des dégâts')}</h2>
      <div class="rangee"><input type="number" inputmode="numeric" id="dg-n" placeholder="${esc(cfg.placeholder || 'dégâts')}">
        <button data-action="dg">${esc(cfg.bouton || 'Appliquer')}</button>${cfg.soins ? `<button data-action="dg-soin">${esc(cfg.soins)}</button>` : ''}</div>
      ${cfg.armure ? `<label class="case petit"><input type="checkbox" id="dg-sans-armure"> Ignorer l'armure (${f.compteurs[cfg.armure] ?? 0})</label>` : ''}
      ${deg ? `<div class="resultat gauche">${deg.lignes.map(l => `<div>${esc(l)}</div>`).join('')}
        ${deg.exact && cfg.zeroExact?.table ? `<p class="force">${esc(cfg.zeroExact.texte || '')}</p><button data-action="fiche-table" data-t="${esc(cfg.zeroExact.table)}">Lancer : ${esc(tableParId(mod, cfg.zeroExact.table)?.nom || cfg.zeroExact.table)}</button>` : ''}
        ${deg.debord && cfg.debordement ? `<p class="force">${esc(cfg.debordement.texte || '')}</p>
          <div class="rangee">${cfg.debordement.test ? `<button data-action="sv" data-j="${esc(cfg.debordement.test)}">Sauvegarde de ${esc(def.jauges.find(j => j.id === cfg.debordement.test)?.abr || cfg.debordement.test)}</button>` : ''}
          ${cfg.debordement.etat ? `<button data-action="ajout-etat" data-n="${esc(cfg.debordement.etat)}">En cas d'échec : état ${esc(cfg.debordement.etat)}</button>` : ''}</div>
          ${cfg.debordement.echec ? `<p class="discret petit">${esc(cfg.debordement.echec)}</p>` : ''}` : ''}
      </div>` : ''}
      ${resTable}
    </div>`;
  }

  if ((def.jets || []).length || (def.actions || []).length) {
    html += `<div class="carte">
      ${(def.jets || []).length ? `<h2>Jets rapides</h2><div class="grille-2b">${def.jets.map((j, i) =>
        `<button data-action="jr" data-i="${i}">${esc(j.nom)}<small class="discret"> ${esc(formuleCourte(j.formule))}</small></button>`).join('')}</div>
        ${!test || !testables.length ? resJet : ''}` : ''}
      ${(def.actions || []).length ? `<h3>Repos et actions</h3><div class="pile">${def.actions.map((a, i) =>
        `<button data-action="act" data-i="${i}">${esc(a.nom)}${a.aide ? `<small class="discret"> — ${esc(a.aide)}</small>` : ''}</button>`).join('')}</div>` : ''}
    </div>`;
  }

  if (def.voies) html += vueVoies(mod, f, def);
  if (def.inventaire) html += vueInventaire(f, def, occ);

  const champs = champsDef(def).filter(ch => ch.id !== 'nom' && f.champs[ch.id]);
  html += `<div class="carte">
    <h2>Identité et notes</h2>
    ${champs.length ? champs.map(ch => `<div class="champ"><div class="discret petit">${esc(ch.nom)}</div><div class="prose">${esc(f.champs[ch.id])}</div></div>`).join('')
      : '<p class="discret petit">Rien de noté. Touche « Modifier » pour compléter la fiche.</p>'}
  </div>`;
  return html;
}

function vueInventaire(f, def, occ) {
  const inv = def.inventaire;
  const ed = etat.slotEdit;
  const plein = occ.total > 0 && occ.pris >= occ.total;
  const slot = (gid, i, x, libelle) => {
    if (ed && ed.g === gid && ed.i === i) return editeurSlot(f, def, gid, i, x);
    if (x?.suite) return `<li class="slot suite"><span class="n">${libelle}</span><span class="discret">↳ suite de l'objet encombrant</span></li>`;
    return `<li class="slot ${x ? (x.etat ? 'etat' : '') : 'vide'}" data-action="slot" data-g="${esc(gid)}" data-i="${i}">
      <span class="n">${libelle}</span><span>${x ? esc(x.texte) + (x.encombrant ? ' <small class="discret">(2 empl.)</small>' : '') : '<span class="discret">vide</span>'}</span></li>`;
  };
  let html = `<div class="carte">
    <h2>Inventaire <span class="discret petit">· ${occ.pris}/${occ.total}</span></h2>
    ${inv.aide ? `<p class="discret petit">${esc(inv.aide)}</p>` : ''}
    ${plein && inv.plein ? `<p class="force">${esc(inv.plein)}</p>` : ''}
    ${f.surplus.length && inv.surcharge ? `<p class="force">${esc(inv.surcharge)}</p>` : ''}`;
  for (const g of inv.groupes) {
    const a = emplacements(f, g);
    if (!a.length) continue;
    html += `<h3>${esc(g.nom)}${g.aide ? ` <span class="discret petit">— ${esc(g.aide)}</span>` : ''}</h3>
      <ul class="slots">${a.map((x, i) => slot(g.id, i, x, i + 1)).join('')}</ul>`;
  }
  if (f.surplus.length || (ed && ed.g === 'surplus')) {
    html += `<h3>En surplus</h3><ul class="slots">${f.surplus.map((x, i) => slot('surplus', i, x, '+')).join('')}
      ${ed && ed.g === 'surplus' && ed.i >= f.surplus.length ? editeurSlot(f, def, 'surplus', ed.i, null) : ''}</ul>`;
  }
  if ((inv.etats || []).length) {
    html += `<h3>Ajouter un état</h3><div class="puces">${inv.etats.map(s =>
      `<button class="puce" data-action="ajout-etat" data-n="${esc(s.nom)}" ${s.aide ? `title="${esc(s.aide)}"` : ''}>${esc(s.nom)}</button>`).join('')}</div>`;
  }
  html += `<button class="lien" data-action="slot" data-g="surplus" data-i="${f.surplus.length}">+ Objet en surplus (hors emplacements)</button></div>`;
  return html;
}

function editeurSlot(f, def, gid, i, x) {
  const options = [];
  for (const g of def.inventaire.groupes) emplacements(f, g).forEach((y, k) => {
    options.push(`<option value="${esc(g.id)}:${k}" ${g.id === gid && k === i ? 'selected' : ''}>${esc(g.nom)} ${k + 1}${y && !(g.id === gid && k === i) ? (y.suite ? ' (occupé)' : ' — ' + esc(y.texte).slice(0, 24)) : ''}</option>`);
  });
  options.push(`<option value="surplus" ${gid === 'surplus' ? 'selected' : ''}>En surplus</option>`);
  const etatsAide = (def.inventaire.etats || []).find(s => s.nom === x?.texte)?.aide;
  return `<li class="slot edition">
    <input type="text" id="sl-texte" value="${esc(x?.texte || '')}" placeholder="Objet ou état">
    ${etatsAide ? `<p class="discret petit">${esc(etatsAide)}</p>` : ''}
    <label class="case petit"><input type="checkbox" id="sl-etat" ${x?.etat ? 'checked' : ''}> C'est un état</label>
    <label class="case petit"><input type="checkbox" id="sl-enc" ${x?.encombrant ? 'checked' : ''}> Encombrant (2 emplacements)</label>
    <div class="rangee"><span class="discret petit" style="flex:0 0 auto">Place</span><select id="sl-place">${options.join('')}</select></div>
    <div class="rangee" style="margin-top:8px">
      ${x ? '<button class="lien danger" data-action="sl-vider">Retirer</button>' : ''}
      <button data-action="sl-annuler">Annuler</button>
      <button class="principal" style="flex:2;min-height:44px" data-action="sl-ok">OK</button>
    </div>
  </li>`;
}

function vueFicheEdition(mod, f, def) {
  completerFiche(f, def);
  return `<div class="carte">
    <h2>Modifier la fiche</h2>
    <h3>Rôle</h3>
    <select id="fe-role">${[['principal', 'Personnage principal'], ['secondaire', 'Secondaire'], ['', 'Aucun']].map(([k, l]) => `<option value="${k}" ${f.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${vueEditionPlus(mod, f, def)}
    ${(def.jauges || []).length ? `<h3>Jauges (actuel${def.jauges.every(j => j.maxFormule) ? '' : ' / max'})</h3>${def.jauges.map(j => `<div class="rangee edition-jauge">
      <span>${esc(j.nom)}${j.maxFormule ? ` <small class="discret">max ${f.jauges[j.id]?.max ?? 0}, calculé</small>` : ''}</span>
      <input type="number" inputmode="numeric" id="fe-j-${esc(j.id)}-act" value="${f.jauges[j.id]?.act ?? 0}">
      ${j.maxFormule ? '' : `<input type="number" inputmode="numeric" id="fe-j-${esc(j.id)}-max" value="${f.jauges[j.id]?.max ?? 0}">`}
    </div>`).join('')}` : ''}
    ${(def.compteurs || []).length ? `<h3>Compteurs</h3>${def.compteurs.map(k => `<div class="rangee edition-jauge">
      <span>${esc(k.nom)}</span><input type="number" inputmode="numeric" id="fe-c-${esc(k.id)}" value="${f.compteurs[k.id] ?? 0}"></div>`).join('')}` : ''}
    ${champsDef(def).map(ch => `<h3>${esc(ch.nom)}</h3>${ch.long
      ? `<textarea id="fe-ch-${esc(ch.id)}" rows="3">${esc(f.champs[ch.id] || '')}</textarea>`
      : `<input type="text" id="fe-ch-${esc(ch.id)}" value="${esc(f.champs[ch.id] || '')}">`}`).join('')}
    <div class="rangee" style="margin-top:14px">
      <button data-action="fe-annuler">Annuler</button>
      <button class="principal" style="flex:2" data-action="fe-ok">Enregistrer</button>
    </div>
    <button class="lien danger" data-action="fe-suppr" style="margin-top:10px">Supprimer cette fiche</button>
  </div>`;
}

/* ---------- Rendu : tables ---------- */
function rendreResultatTable(r) {
  return `<div class="resultat gauche">
    ${r.libelle ? `<div class="meta">${esc(r.libelle)}</div>` : ''}
    ${r.resultats.map((x, k) => `<div class="res-table">
      <div class="discret petit">${esc(x.table)} · ${esc(x.de)} = ${esc(x.valeur)}</div>
      <div class="reponse petit-rep ${x.entree?.sens || ''}">${esc(x.texte)}</div>
      ${x.detail ? `<div class="meta">${esc(x.detail)}</div>` : ''}
    </div>`).join('')}
    ${r.aide ? `<p class="discret petit">${esc(r.aide)}</p>` : ''}
  </div>`;
}

function vueTables(mod) {
  const groupes = [];
  for (const t of mod.tables || []) {
    const g = t.groupe || 'Tables';
    let x = groupes.find(y => y.nom === g);
    if (!x) groupes.push(x = { nom: g, tables: [], gens: [] });
    x.tables.push(t);
  }
  for (const gen of mod.generateurs || []) {
    const g = gen.groupe || 'Générateurs';
    let x = groupes.find(y => y.nom === g);
    if (!x) groupes.push(x = { nom: g, tables: [], gens: [] });
    x.gens.push(gen);
  }
  const ouverte = etat.tableOuverte ? tableParId(mod, etat.tableOuverte) : null;
  const r = etat.dernier.table?.origine === 'tables' ? etat.dernier.table : null;
  let html = '';
  if (ouverte) {
    const f = lireFormule(ouverte.de);
    const plages = f && !f.grille ? plagesTable(ouverte) : null;
    html += `<div class="carte table-ouverte">
      <div class="rangee"><h2 style="margin:0">${esc(ouverte.nom)}</h2><button class="lien" style="flex:0 0 auto" data-action="tb-fermer">Fermer</button></div>
      ${ouverte.aide ? `<p class="discret petit">${esc(ouverte.aide)}</p>` : ''}
      ${f ? `<button class="principal" data-action="tb-lancer" data-t="${esc(ouverte.id)}">Lancer ${esc(formuleCourte(ouverte.de))}</button>
        ${blocPhysique('tb-phys', nbDes(ouverte.de), f.grille || f.faces)}` : ''}
      ${r && r.resultats[0]?.tableId === ouverte.id ? rendreResultatTable(r) : ''}
      ${(ouverte.entrees || []).length ? `<details class="de-physique" data-garde="tb-liste" ${f ? '' : 'open'}><summary>Contenu de la table</summary>
        <ul class="liste-table">${ouverte.entrees.map((e, i) => {
          const o = entreeObj(e);
          const num = f?.grille ? `${Math.floor(i / f.grille[1]) + 1}-${(i % f.grille[1]) + 1}` : plages ? (plages[i][0] === plages[i][1] ? plages[i][0] : plages[i].join('–')) : '•';
          return `<li><span class="n">${esc(num)}</span><div><strong>${esc(o.texte)}</strong>${o.detail ? `<div class="discret petit">${esc(o.detail)}</div>` : ''}${o.suite ? `<div class="discret petit">→ ${esc(tableParId(mod, o.suite)?.nom || o.suite)}</div>` : ''}</div></li>`;
        }).join('')}</ul></details>` : ''}
    </div>`;
  } else if (r) html += `<div class="carte">${rendreResultatTable(r)}</div>`;
  html += groupes.map(g => `<details class="carte groupe-tables" data-garde="tg-${esc(g.nom)}">
    <summary><strong>${esc(g.nom)}</strong> <span class="discret petit">· ${g.tables.length + g.gens.length}</span></summary>
    ${g.gens.map(gen => `<div class="ligne-table gen">
      <button class="nom" data-action="gen" data-id="${esc(gen.id)}">✦ ${esc(gen.nom)}</button>
      ${gen.aide ? `<div class="discret petit">${esc(gen.aide)}</div>` : ''}</div>`).join('')}
    ${g.tables.map(t => `<div class="ligne-table">
      <button class="nom" data-action="tb-ouvrir" data-t="${esc(t.id)}">${esc(t.nom)} <small class="discret">${t.de ? esc(formuleCourte(t.de)) : 'liste'}</small></button>
      ${t.de ? `<button class="lancer" data-action="tb-lancer" data-t="${esc(t.id)}" aria-label="Lancer">⚄</button>` : ''}
    </div>`).join('')}
  </details>`).join('');
  return html;
}

/* ---------- Actions ---------- */
async function lancerTableJeu(mod, id, valeurs, origine) {
  const rs = resoudreTable(mod, id, valeurs);
  if (!rs.length) return toast('Table vide ou introuvable');
  await noterTables(rs, valeurs, origine?.startsWith('fiche:') ? nomFiche(ficheParId(origine.slice(6)), defFiche(mod, ficheParId(origine.slice(6))?.type)) : '');
  etat.dernier.table = { origine, resultats: rs, aide: null };
  rendre();
}

async function lancerGenerateur(mod, id) {
  const gen = (mod.generateurs || []).find(g => g.id === id);
  const rs = gen.tables.flatMap(t => resoudreTable(mod, t));
  await noterTables(rs, false, gen.nom);
  etat.dernier.table = { origine: 'tables', libelle: gen.nom, resultats: rs, aide: gen.aide };
  etat.tableOuverte = null;
  rendre();
  window.scrollTo(0, 0);
}

async function sauvegardeFiche(mod, f, jid) {
  const def = defFiche(mod, f.type);
  const j = def.jauges.find(x => x.id === jid);
  const test = mod.test || { nom: 'Test', de: 20, comp: '<=' };
  const mode = etat.modeSauvegarde || 'normal';
  const n = mode === 'normal' ? 1 : 2;
  const a = $('#sv-0')?.value.trim(), b = $('#sv-1')?.value.trim();
  let valeurs = null;
  if (a) {
    valeurs = [lireEntier(a, 1, test.de), n === 2 ? lireEntier(b, 1, test.de) : 0].slice(0, n);
    if (valeurs.some(v => v == null)) return toast(`Entre ${n === 2 ? 'deux valeurs' : 'une valeur'} entre 1 et ${test.de}`);
  }
  const cfg = { faces: test.de, n, garde: mode === 'avantage' ? 'l' : mode === 'desavantage' ? 'h' : 'tous', k: 1, mod: 0,
    comp: test.comp || '<=', seuil: f.jauges[jid]?.act ?? 0,
    libelle: `${test.nom} de ${j?.abr || jid}${mode === 'avantage' ? ' avec avantage' : mode === 'desavantage' ? ' avec désavantage' : ''} — ${nomFiche(f, def)}` };
  if (test.comp === '>=' ) cfg.garde = mode === 'avantage' ? 'h' : mode === 'desavantage' ? 'l' : 'tous';
  const r = calculerJet(cfg, valeurs);
  await noter({ type: 'jet', physique: !!valeurs, ...r });
  etat.dernier.jet = { ...r, physique: !!valeurs, origine: 'fiche:' + f.id };
  rendre();
}

async function jetRapide(mod, f, i) {
  const def = defFiche(mod, f.type);
  const jr = def.jets[i];
  const cfg = { ...lireFormule(jr.formule), libelle: `${jr.nom} — ${nomFiche(f, def)}` };
  const r = calculerJet(cfg);
  await noter({ type: 'jet', physique: false, ...r });
  etat.dernier.jet = { ...r, physique: false, origine: 'fiche:' + f.id };
  rendre();
}

async function appliquerDegats(mod, f) {
  const def = defFiche(mod, f.type);
  const cfg = def.degats;
  const n = lireEntier($('#dg-n')?.value ?? '', 0, 999);
  if (n == null) return toast('Entre un nombre de dégâts');
  const armure = $('#dg-sans-armure')?.checked ? 0 : (f.compteurs[cfg.armure] || 0);
  const d = Math.max(0, n - armure);
  const [j1, j2] = cfg.cascade;
  const J = id => f.jauges[id] || (f.jauges[id] = { max: 0, act: 0 });
  const abr = id => def.jauges.find(x => x.id === id)?.abr || id;
  const av1 = J(j1).act, av2 = j2 ? J(j2).act : null;
  let exact = false, debord = 0;
  if (d <= J(j1).act || !j2) {
    J(j1).act = Math.max(0, J(j1).act - d);
    exact = d > 0 && J(j1).act === 0 && cfg.zeroExact && cfg.zeroExact.jauge === j1 && av1 === d;
  } else {
    debord = d - J(j1).act;
    J(j1).act = 0;
    J(j2).act = Math.max(0, J(j2).act - debord);
  }
  const lignes = [`${n} dégât(s)${armure ? ` − ${armure} d'armure = ${d}` : ''}`,
    `${abr(j1)} ${av1} → ${J(j1).act}${debord ? `, ${abr(j2)} ${av2} → ${J(j2).act}` : ''}`];
  const zero = debord && J(j2).act <= 0 ? def.jauges.find(x => x.id === j2)?.zero : null;
  if (zero) lignes.push(zero);
  if (cfg.aZero && av1 > 0 && J(j1).act === 0) {
    const z = cfg.aZero;
    const jz = f.jauges[z.jauge];
    if (jz) { const a = jz.act; jz.act = Math.max(0, Math.min(jz.max, jz.act + (z.mod || 0))); lignes.push(`${z.texte || ''}${z.texte ? ' ' : ''}(${def.jauges.find(x => x.id === z.jauge)?.abr || z.jauge} ${a} → ${jz.act})`); }
  }
  await sauverPartie();
  await noter({ type: 'fiche', texte: `${nomFiche(f, def)} subit ${n} dégât(s)${armure ? ` (armure ${armure})` : ''} : ${lignes.slice(1).join(' ; ')}${exact ? ' — à 0 exactement' : ''}` });
  etat.dernier.degats = { fiche: f.id, lignes, exact, debord };
  rendre();
}

async function soignerFiche(mod, f) {
  const def = defFiche(mod, f.type);
  const n = lireEntier($('#dg-n')?.value ?? '', 0, 999);
  if (n == null) return toast('Entre un nombre de points');
  const j1 = def.degats.cascade[0];
  const j = f.jauges[j1];
  const av = j.act;
  j.act = Math.min(j.max, j.act + n);
  const abr = def.jauges.find(x => x.id === j1)?.abr || j1;
  await sauverPartie();
  await noter({ type: 'fiche', texte: `${nomFiche(f, def)} récupère ${n} ${abr} : ${av} → ${j.act}` });
  etat.dernier.degats = { fiche: f.id, lignes: [`+${n} ${abr}`, `${abr} ${av} → ${j.act}`], exact: false, debord: 0 };
  rendre();
}

async function actionFiche(mod, f, i) {
  const def = defFiche(mod, f.type);
  const a = def.actions[i];
  const parts = [];
  for (const ef of a.effets || []) {
    if (ef.requis && (f.jauges[ef.jauge]?.act ?? 0) < (ef.retirer || 1)) {
      return toast(ef.requis === true ? `Pas assez de ${def.jauges.find(x => x.id === ef.jauge)?.abr || ef.jauge}` : ef.requis);
    }
  }
  if (a.confirmer && !confirm(a.confirmer)) return;
  const ctx = contexteFiche(mod, f, def);
  for (const ef of a.effets || []) {
    const j = f.jauges[ef.jauge];
    if (!j) continue;
    const av = j.act;
    if (ef.remplir) j.act = j.max;
    if (ef.retirer) j.act = Math.max(0, j.act - ef.retirer);
    if (ef.ajouter) {
      const r = lancerExpression(ef.ajouter, ctx);
      j.act = Math.max(0, Math.min(j.max, j.act + r.total));
      if (r.des.length) parts.push(`${r.formule} : ${r.des.join(', ')}${r.cst ? ' ' + signe(r.cst) : ''} = ${r.total}`);
    }
    const jd = def.jauges.find(x => x.id === ef.jauge);
    if (av !== j.act || (ef.remplir && j.max)) parts.push(`${jd?.abr || ef.jauge} ${av} → ${j.act}`);
  }
  await sauverPartie();
  await noter({ type: 'fiche', texte: `${a.nom} — ${nomFiche(f, def)}${parts.length ? ' : ' + parts.join(', ') : ''}` });
  toast(a.nom + (parts.length ? ' : ' + parts.join(', ') : ''));
  rendre();
}

async function enregistrerSlot(mod, f) {
  const def = defFiche(mod, f.type);
  const ed = etat.slotEdit;
  const texte = $('#sl-texte').value.trim();
  const objet = texte ? { texte, etat: $('#sl-etat').checked, encombrant: $('#sl-enc').checked } : null;
  const [cg, ci] = $('#sl-place').value.split(':');
  const ancien = ed.g === 'surplus' ? (f.surplus[ed.i] ? retirerSlot(f, 'surplus', ed.i) : null) : retirerSlot(f, ed.g, ed.i);
  if (objet) {
    if (cg === 'surplus') f.surplus.push(objet);
    else {
      const a = f.inventaire[cg];
      const i = Number(ci);
      const libre = k => k < a.length && !a[k];
      if (a[i] && !a[i].suite && !a[i].encombrant && !objet.encombrant && ed.g !== 'surplus') {
        const autre = a[i]; a[i] = objet;                 // échange simple
        f.inventaire[ed.g][ed.i] = autre;
      } else if (libre(i) && (!objet.encombrant || libre(i + 1))) {
        a[i] = objet; if (objet.encombrant) a[i + 1] = { suite: true };
      } else {
        if (ancien && ed.g !== 'surplus') { f.inventaire[ed.g][ed.i] = ancien; if (ancien.encombrant && f.inventaire[ed.g][ed.i + 1] === null) f.inventaire[ed.g][ed.i + 1] = { suite: true }; }
        else if (ancien) f.surplus.splice(ed.i, 0, ancien);
        return toast('Pas la place à cet endroit');
      }
    }
  }
  etat.slotEdit = null;
  await sauverPartie();
  rendre();
}

async function ajouterEtat(mod, f, nom) {
  const def = defFiche(mod, f.type);
  const ou = placerObjet(f, def, { texte: nom, etat: true }, null);
  await sauverPartie();
  await noter({ type: 'fiche', texte: `${nomFiche(f, def)} : état ${nom}${ou === 'surplus' ? ' (en surplus : encombré)' : ''}` });
  toast(`État ${nom} ajouté`);
  rendre();
}

async function enregistrerEdition_fiche(mod, f, resterEnEdition) {
  const def = defFiche(mod, f.type);
  f.role = $('#fe-role').value;
  for (const j of def.jauges || []) {
    const act = Number($(`#fe-j-${CSS.escape(j.id)}-act`).value);
    const max = j.maxFormule ? f.jauges[j.id]?.max ?? 0 : Number($(`#fe-j-${CSS.escape(j.id)}-max`).value);
    f.jauges[j.id] = { act: Number.isFinite(act) ? Math.round(act) : 0, max: Number.isFinite(max) ? Math.round(max) : 0 };
  }
  lireEditionPlus(mod, f, def);
  for (const k of def.compteurs || []) {
    const v = Number($(`#fe-c-${CSS.escape(k.id)}`).value);
    f.compteurs[k.id] = Number.isFinite(v) ? Math.round(v) : 0;
  }
  for (const ch of champsDef(def)) f.champs[ch.id] = $(`#fe-ch-${CSS.escape(ch.id)}`).value.trim();
  if (f.role === 'principal') (etat.partie.fiches || []).forEach(x => { if (x !== f && x.role === 'principal') x.role = 'secondaire'; });
  recalculerFiche(mod, f, def);
  for (const j of def.jauges || []) if (f.jauges[j.id] && f.jauges[j.id].act > f.jauges[j.id].max && j.maxFormule) f.jauges[j.id].act = f.jauges[j.id].max;
  if (resterEnEdition) return sauverPartie();
  etat.ficheEdition = false;
  await sauverPartie();
  rendre();
}

/* Point d'entrée des actions de cette vue (appelé par app.js) */
async function actionJeu(a, b) {
  const mod = moduleActif();
  const f = etat.ficheOuverte ? ficheParId(etat.ficheOuverte) : null;
  const c = creationCourante();
  switch (a) {
    case 'jeu-lier':
      etat.partie.module = b.dataset.id;
      if (!etat.partie.jeu) etat.partie.jeu = etat.contenus.find(x => x.id === b.dataset.id)?.donnees.nom || '';
      await sauverPartie(); return rendre();
    case 'jeu-sous': etat.jeuSous = b.dataset.v; return rendre();
    case 'jeu-memo': etat.ficheOuverte = null; etat.ficheEdition = false; etat.slotEdit = null; etat.jeuSous = 'memo'; await rendre(); return window.scrollTo(0, 0);
    case 'jeu-ouvrir': {
      etat.ficheOuverte = b.dataset.id; etat.ficheEdition = false; etat.slotEdit = null; etat.ajoutVoie = false;
      const fo = ficheParId(b.dataset.id), dfo = defFiche(mod, fo?.type);
      if (fo && dfo) { completerFiche(fo, dfo); if (recalculerFiche(mod, fo, dfo)) await sauverPartie(); }
      await rendre(); return window.scrollTo(0, 0);
    }
    case 'jeu-fermer': etat.ficheOuverte = null; etat.ficheEdition = false; etat.slotEdit = null; return rendre();
    case 'jeu-editer': etat.ficheEdition = true; await rendre(); return window.scrollTo(0, 0);

    /* Nouvelle fiche */
    case 'nf-ouvrir': {
      const types = Object.keys(mod.fiches);
      const aPrincipal = (etat.partie.fiches || []).some(x => x.role === 'principal');
      etat.nouvelleFiche = { type: types[0], role: aPrincipal ? 'secondaire' : 'principal' };
      return rendre();
    }
    case 'nf-type': etat.nouvelleFiche.type = b.dataset.v; return rendre();
    case 'nf-role': etat.nouvelleFiche.role = b.dataset.v; return rendre();
    case 'nf-annuler': etat.nouvelleFiche = null; return rendre();
    case 'nf-guidee': case 'nf-vierge': {
      const nf = etat.nouvelleFiche; etat.nouvelleFiche = null;
      if (nf.role === 'principal') (etat.partie.fiches || []).forEach(x => { if (x.role === 'principal') x.role = 'secondaire'; });
      return commencerCreation(nf.type, nf.role, a === 'nf-vierge');
    }

    /* Création */
    case 'cr-lancer': case 'cr-phys': case 'cr-choisir': {
      const p = pasCourant(mod, c);
      let valeurs = null;
      if (a === 'cr-phys') {
        const ins = [...document.querySelectorAll('[id^="cr-phys-"]')];
        valeurs = ins.map(x => lireEntier(x.value, 1, Number(x.max)));
        if (valeurs.some(v => v == null)) return toast('Entre une valeur valide pour chaque dé');
      }
      const relance = !!c.courant && !c.courant.erreur && a === 'cr-lancer';
      c.courant = tirerEtape(mod, c, p, valeurs, a === 'cr-choisir' ? Number(b.dataset.i) : null);
      if (relance) c.courant.relance = true;
      await sauverPartie(); return rendre();
    }
    case 'cr-echanger': {
      const x = $('#cr-ech-a').value, y = $('#cr-ech-b').value;
      if (x === y) return toast('Choisis deux caractéristiques différentes');
      const p = pasCourant(mod, c);
      const r = c.courant;
      const ix = p.jauges.indexOf(x), iy = p.jauges.indexOf(y);
      [r.jets[ix], r.jets[iy]] = [r.jets[iy], r.jets[ix]];
      const def = defFiche(mod, c.type);
      const abr = id => def.jauges.find(j => j.id === id)?.abr || id;
      r.echanges = [...(r.echanges || []), `${abr(x)} ↔ ${abr(y)}`];
      await sauverPartie(); return rendre();
    }
    case 'cr-valider': {
      const p = pasCourant(mod, c);
      if (validerEtape(mod, c, p) === false) { await sauverPartie(); return rendre(); }
      c.pas += 1; c.courant = null;
      sauterEtapesInactives(mod, c);
      await sauverPartie(); await rendre();
      return document.querySelector('.creation')?.scrollIntoView({ block: 'start' });
    }
    case 'cr-passer': {
      const p = pasCourant(mod, c);
      if (p.type === 'saisie') validerEtape(mod, c, p);
      else c.resume.push(`${p.nom} : passé`);
      c.pas += 1; c.courant = null;
      sauterEtapesInactives(mod, c);
      await sauverPartie(); return rendre();
    }
    case 'cr-terminer': return terminerCreation();
    case 'cr-abandon':
      if (!confirm('Abandonner cette création ? Les résultats déjà tirés seront perdus.')) return;
      delete etat.partie.creation; await sauverPartie(); return rendre();

    /* Fiche */
    case 'j-plus': case 'j-moins': {
      const j = f.jauges[b.dataset.j];
      j.act += a === 'j-plus' ? 1 : -1;
      if (j.act < 0) j.act = 0;
      await sauverPartie(); return rendre();
    }
    case 'cpt': {
      const def = defFiche(mod, f.type);
      const k = def.compteurs.find(x => x.id === b.dataset.k);
      const s = prompt(`${k.nom} : ${f.compteurs[k.id] ?? 0}\n\nAjouter ou retirer (ex. 5 ou -3), ou « = 120 » pour fixer :`, '');
      if (s == null || !s.trim()) return;
      const m = s.trim().replace(/\s/g, '').replace(',', '.').match(/^(=)?([+-]?\d+)$/);
      if (!m) return toast('Valeur non comprise');
      const av = f.compteurs[k.id] ?? 0;
      f.compteurs[k.id] = m[1] ? Number(m[2]) : av + Number(m[2]);
      await sauverPartie();
      await noter({ type: 'fiche', texte: `${nomFiche(f, def)} : ${k.nom} ${av.toLocaleString('fr-FR')} → ${f.compteurs[k.id].toLocaleString('fr-FR')}` });
      return rendre();
    }
    case 'sv-mode': etat.modeSauvegarde = b.dataset.v; return rendre();
    case 'sv': return sauvegardeFiche(mod, f, b.dataset.j);
    case 'jr': return jetRapide(mod, f, Number(b.dataset.i));
    case 'act': return actionFiche(mod, f, Number(b.dataset.i));
    case 'dg': return appliquerDegats(mod, f);
    case 'dg-soin': return soignerFiche(mod, f);
    case 'fiche-table': return lancerTableJeu(mod, b.dataset.t, null, 'fiche:' + f.id);
    case 'ajout-etat': return ajouterEtat(mod, f, b.dataset.n);
    case 'slot': etat.slotEdit = { g: b.dataset.g, i: Number(b.dataset.i) }; await rendre(); return $('#sl-texte')?.focus();
    case 'sl-annuler': etat.slotEdit = null; return rendre();
    case 'sl-ok': return enregistrerSlot(mod, f);
    case 'sl-vider': {
      const ed = etat.slotEdit;
      retirerSlot(f, ed.g, ed.i);
      etat.slotEdit = null; await sauverPartie(); return rendre();
    }
    case 'fe-annuler': etat.ficheEdition = false; return rendre();
    case 'fe-ok': return enregistrerEdition_fiche(mod, f);
    case 'fe-suppr': {
      const def = defFiche(mod, f.type);
      if (!confirm(`Supprimer la fiche « ${nomFiche(f, def)} » ? (Le journal n'est pas touché.)`)) return;
      etat.partie.fiches = etat.partie.fiches.filter(x => x.id !== f.id);
      etat.ficheOuverte = null; etat.ficheEdition = false;
      await sauverPartie(); return rendre();
    }

    /* Tables */
    case 'tb-ouvrir': etat.tableOuverte = b.dataset.t; await rendre(); return window.scrollTo(0, 0);
    case 'tb-fermer': etat.tableOuverte = null; return rendre();
    case 'tb-lancer': {
      if (etat.tableOuverte !== b.dataset.t && b.closest('.groupe-tables')) etat.tableOuverte = null;
      await lancerTableJeu(mod, b.dataset.t, null, 'tables');
      if (!etat.tableOuverte) window.scrollTo(0, 0);
      return;
    }
    case 'tb-phys': {
      const t = tableParId(mod, etat.tableOuverte);
      const f2 = lireFormule(t.de);
      const v = lireValeursPhysiques('tb-phys', nbDes(t.de), f2.grille || f2.faces);
      if (!v) return toast('Entre une valeur valide pour chaque dé');
      return lancerTableJeu(mod, t.id, v, 'tables');
    }
    case 'gen': return lancerGenerateur(mod, b.dataset.id);
    default: return actionJeuPlus(a, b, mod, f, c);
  }
}

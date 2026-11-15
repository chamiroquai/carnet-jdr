/* Carnet JDR — rencontres (étape 6) : bestiaire, tables de rencontre par zone,
   génération d'une rencontre (créatures, nombre, jets annexes), puis passage au
   combat ou création de fiches PNJ.
   Moteur générique : aucun contenu de jeu ici. Le bestiaire du livre et les réglages
   viennent de la section « rencontres » du module ; les tables de zone et les
   créatures personnelles sont écrites par le joueur et rangées dans la partie.
   Chargé après regles.js, avant app.js. */
'use strict';

const DES_ZONE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', '2d6', 'd100'];

/* ---------- Configuration ---------- */
function rencontresCfg(mod) {
  const R = mod?.rencontres || {};
  const C = mod?.regles?.combat;
  // Sans profil déclaré, on reprend les champs de la fiche rapide d'adversaire du combat
  const profil = R.profil || (C ? [
    { id: 'niveau', nom: C.adversaire?.niveau || 'Niveau', texte: true },
    { id: 'def', nom: C.adversaire?.defense || 'DEF' },
    { id: 'pv', nom: C.adversaire?.pv || 'PV' },
    { id: 'init', nom: C.adversaire?.init || 'Init.' },
    ...(C.adversaire?.rd !== false ? [{ id: 'rd', nom: C.adversaire?.rd || 'RD' }] : [])
  ] : []);
  return { titre: 'Rencontres', jets: [], bestiaire: [], tables: [], ...R, profil };
}
const peutCombattre = mod => !!mod?.regles?.combat;

function bestiaireModule(mod) { return rencontresCfg(mod).bestiaire || []; }
function bestiairePartie() { return etat.partie?.bestiaire || []; }
function tablesZone(mod) {
  return [...(rencontresCfg(mod).tables || []).map(t => ({ ...t, livre: true })), ...(etat.partie?.tablesRencontre || [])];
}

/* « m:loup » → bestiaire du module ; « p:Nom » → créatures de la partie */
function creatureRef(mod, ref) {
  if (!ref) return null;
  if (ref.startsWith('m:')) { const c = bestiaireModule(mod).find(x => x.id === ref.slice(2)); return c ? { ...c, source: 'livre' } : null; }
  if (ref.startsWith('p:')) { const c = bestiairePartie().find(x => x.nom === ref.slice(2)); return c ? { ...c, source: 'partie' } : null; }
  return null;
}
const refDe = c => (c.source === 'livre' ? 'm:' + c.id : 'p:' + c.nom);

/* « 1/2 » → 0,5 ; « 8+ » → 8 */
function valeurNiveau(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().replace('½', '1/2').replace('+', '');
  const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function texteProfil(mod, c) {
  const P = rencontresCfg(mod).profil;
  return P.filter(p => c[p.id] != null && c[p.id] !== '' && !(p.id === 'rd' && !c.rd)).map(p => `${p.nom} ${c[p.id]}`).join(' · ');
}

/* Nombre : « 1d4 », « 2d6+1 », « 3 » */
function lancerNombre(f) {
  const s = String(f ?? '').trim() || '1';
  if (/^\d+$/.test(s)) return { formule: s, valeur: Math.max(1, Number(s)), des: null };
  const x = lireFormule(s);
  if (!x || x.grille) return { formule: '1', valeur: 1, des: null };
  const j = calculerJet(x, null);
  return { formule: formuleCourte(s), valeur: Math.max(1, j.total), des: j.des };
}

/* ---------- Validation du module (appelée par validerModule) ---------- */
function validerRencontres(d, erreurs, avert) {
  const R = d.rencontres;
  if (!R) return;
  const ids = new Set((d.tables || []).map(t => t.id));
  const vus = new Set();
  for (const c of R.bestiaire || []) {
    if (!c.id || !c.nom) { erreurs.push(`Bestiaire : créature sans id ou sans nom (« ${c.nom ?? c.id ?? '?'} »).`); continue; }
    if (vus.has(c.id)) erreurs.push(`Bestiaire : « ${c.id} » en double.`);
    vus.add(c.id);
    if (c.nombre && !/^\d+$/.test(String(c.nombre)) && !lireFormule(c.nombre)) avert.push(`Bestiaire « ${c.nom} » : nombre illisible (« ${c.nombre} »).`);
  }
  for (const j of R.jets || []) if (!ids.has(j.table)) avert.push(`Rencontres : table « ${j.table} » introuvable.`);
  if (R.declencheur && !ids.has(R.declencheur)) avert.push(`Rencontres : table « ${R.declencheur} » introuvable.`);
  if (R.versFiche && !d.fiches?.[R.versFiche.type]) avert.push(`Rencontres : type de fiche « ${R.versFiche.type} » introuvable.`);
  for (const t of R.tables || []) for (const l of t.lignes || []) {
    if (l.ref?.startsWith('m:') && !vus.has(l.ref.slice(2))) avert.push(`Table de rencontre « ${t.nom} » : créature « ${l.ref.slice(2)} » introuvable.`);
  }
}

/* ======================================================================
   Vue « Rencontres » (sous-onglet de Jeu)
   ====================================================================== */
function vueRencontres(mod) {
  const R = rencontresCfg(mod);
  const p = etat.partie;
  const G = etat.rcGen || (etat.rcGen = { source: tablesZone(mod)[0]?.id || 'hasard', groupe: '', min: '', max: '', mien: true, jets: null });
  if (G.jets == null) G.jets = (R.jets || []).filter(j => j.defaut !== false).map(j => j.table);
  if (G.source !== 'hasard' && !tablesZone(mod).some(t => t.id === G.source)) G.source = tablesZone(mod)[0]?.id || 'hasard';
  if (etat.rcEdit) return vueEditeurTable(mod, R);
  if (etat.rcCreature) return vueEditeurCreature(mod, R);
  let html = '';
  const r = p.rencontre;
  if (r) html += vueResultatRencontre(mod, R, r);

  const zones = tablesZone(mod);
  const groupes = [...new Set(bestiaireModule(mod).map(c => c.groupe).filter(Boolean))];
  const pool = poolHasard(mod, G);
  const t = zones.find(z => z.id === G.source);
  const f = t ? lireFormule(t.de) : null;
  const decl = R.declencheur ? tableParId(mod, R.declencheur) : null;
  const rd = etat.dernier.table?.origine === 'rencontres' ? etat.dernier.table : null;
  html += `<div class="carte">
    <h2>${r ? 'Nouvelle rencontre' : 'Générer une rencontre'}</h2>
    ${R.aide ? `<p class="discret petit">${enrichir(R.aide)}</p>` : ''}
    ${decl ? `<button data-action="rc-decl">${esc(decl.nom)} <small class="discret">${esc(formuleCourte(decl.de))}</small></button>
      ${rd ? rendreResultatTable(rd) : ''}` : ''}
    <h3>D'où vient-elle ?</h3>
    <div class="puces">${zones.map(z => `<button class="puce ${G.source === z.id ? 'choisie' : ''}" data-action="rc-source" data-v="${esc(z.id)}">${esc(z.nom)}</button>`).join('')}
      <button class="puce ${G.source === 'hasard' ? 'choisie' : ''}" data-action="rc-source" data-v="hasard">Bestiaire au hasard</button></div>
    ${!zones.length ? `<p class="discret petit">Aucune table de rencontre pour l'instant : crée celle d'une zone (forêt, station, épave…) plus bas, ou tire au hasard dans le bestiaire.</p>` : ''}
    ${G.source === 'hasard' ? `
      ${groupes.length > 1 ? `<div class="puces" style="margin-top:8px">${['', ...groupes].map(g => `<button class="puce ${G.groupe === g ? 'choisie' : ''}" data-action="rc-groupe" data-v="${esc(g)}">${esc(g || 'Tous')}</button>`).join('')}</div>` : ''}
      ${R.filtre ? `<div class="rangee" style="margin-top:8px"><span class="petit">${esc(R.filtre.nom)} de</span><input type="text" inputmode="decimal" id="rc-min" value="${esc(G.min)}" placeholder="min"><span class="petit">à</span><input type="text" inputmode="decimal" id="rc-max" value="${esc(G.max)}" placeholder="max"></div>` : ''}
      ${bestiairePartie().length && bestiaireModule(mod).length ? `<label class="case petit"><input type="checkbox" id="rc-mien" ${G.mien ? 'checked' : ''}> Inclure mes créatures</label>` : ''}
      <p class="discret petit">${pool.length} créature${pool.length > 1 ? 's' : ''} possible${pool.length > 1 ? 's' : ''}${R.filtre ? ' (filtre appliqué au tirage)' : ''}.</p>` : ''}
    ${t ? `<p class="discret petit">${esc(t.nom)} · ${esc(formuleCourte(t.de))} · ${(t.lignes || []).length} ligne${(t.lignes || []).length > 1 ? 's' : ''}${t.livre ? ' · fournie par le module' : ''}</p>` : ''}
    ${(R.jets || []).length ? `<h3>Lancer aussi</h3>${R.jets.map(j => `<label class="case petit"><input type="checkbox" class="rc-jet" value="${esc(j.table)}" ${G.jets.includes(j.table) ? 'checked' : ''}> ${esc(j.nom || tableParId(mod, j.table)?.nom || j.table)}</label>`).join('')}` : ''}
    <button class="principal" style="margin-top:8px" data-action="rc-generer" ${G.source === 'hasard' && !pool.length ? 'disabled' : ''}>Générer une rencontre</button>
    ${t && f ? blocPhysique('rc-phys', nbDes(t.de), f.grille || f.faces, 'J’ai lancé mon dé pour la table') : ''}
  </div>`;

  html += `<div class="carte"><h2>Tables de rencontre</h2>
    ${zones.length ? `<ul class="liste-simple">${zones.map(z => `<li class="rangee"><span><strong>${esc(z.nom)}</strong> <small class="discret">${esc(formuleCourte(z.de))} · ${(z.lignes || []).map(l => esc(nomLigne(mod, l))).join(', ')}</small></span>
      ${z.livre ? '' : `<button class="lien" style="flex:0 0 auto" data-action="rc-table-edit" data-id="${esc(z.id)}">Modifier</button>`}</li>`).join('')}</ul>` : ''}
    <button data-action="rc-table-nouv">+ Nouvelle table de rencontre</button>
    ${R.modele?.aide ? `<p class="discret petit">${enrichir(R.modele.aide)}</p>` : ''}
  </div>`;

  html += vueBestiaire(mod, R);
  return html;
}

function nomLigne(mod, l) {
  const c = creatureRef(mod, l.ref);
  const nom = l.texte || c?.nom || '—';
  return `${nom}${l.nombre ? ' ×' + l.nombre : ''}`;
}

function poolHasard(mod, G) {
  const R = rencontresCfg(mod);
  let pool = bestiaireModule(mod).map(c => ({ ...c, source: 'livre' }));
  if (G.groupe) pool = pool.filter(c => c.groupe === G.groupe);
  if (G.mien || !pool.length) pool.push(...bestiairePartie().filter(c => !G.groupe || c.groupe === G.groupe).map(c => ({ ...c, source: 'partie' })));
  if (R.filtre) {
    const min = valeurNiveau(G.min), max = valeurNiveau(G.max);
    pool = pool.filter(c => { const v = valeurNiveau(c[R.filtre.id]); return v == null ? min == null && max == null : (min == null || v >= min) && (max == null || v <= max); });
  }
  return pool;
}

/* ---------- Bestiaire ---------- */
function vueBestiaire(mod, R) {
  const livre = bestiaireModule(mod), mien = bestiairePartie();
  const groupes = [];
  for (const c of livre) { const g = c.groupe || 'Bestiaire'; let x = groupes.find(y => y.nom === g); if (!x) groupes.push(x = { nom: g, l: [] }); x.l.push(c); }
  const ligne = (c, src, i) => `<details class="creature" data-garde="rc-c-${src}-${esc(c.id || c.nom)}"><summary><strong>${esc(c.nom)}</strong> <small class="discret">${esc(texteProfil(mod, c))}</small></summary>
    ${fichePresentation(mod, c)}
    <div class="rangee" style="margin-top:6px">
      <button data-action="rc-direct" data-ref="${esc(src === 'livre' ? 'm:' + c.id : 'p:' + c.nom)}">Rencontre avec ${esc(c.nom)}</button>
      ${src === 'partie' ? `<button class="lien" style="flex:0 0 auto" data-action="rc-crea-edit" data-i="${i}">Modifier</button>` : `<button class="lien" style="flex:0 0 auto" data-action="rc-crea-copier" data-id="${esc(c.id)}">Copier pour l'adapter</button>`}
    </div></details>`;
  return `<div class="carte"><h2>Bestiaire</h2>
    ${groupes.map(g => `<details class="de-physique" data-garde="rc-bg-${esc(g.nom)}"><summary>${esc(g.nom)} <span class="discret petit">· ${g.l.length}</span></summary>${g.l.map(c => ligne(c, 'livre')).join('')}</details>`).join('')}
    <details class="de-physique" data-garde="rc-bg-mien" ${livre.length ? '' : 'open'}><summary>Mes créatures <span class="discret petit">· ${mien.length}</span></summary>
      ${mien.map((c, i) => ligne(c, 'partie', i)).join('') || '<p class="discret petit">Les adversaires gardés pendant un combat et les créatures que tu crées ici apparaissent dans cette liste.</p>'}
    </details>
    <button style="margin-top:8px" data-action="rc-crea-nouv">+ Nouvelle créature</button>
    ${livre.length ? `<p class="discret petit">${livre.length} profils du livre (chiffres et noms des capacités : le texte est dans ton livre).</p>` : ''}
  </div>`;
}

function fichePresentation(mod, c) {
  return `<div class="petit">
    ${c.type ? `<div class="discret">${esc(c.type)}</div>` : ''}
    ${texteProfil(mod, c) ? `<div>${esc(texteProfil(mod, c))}</div>` : ''}
    ${c.caracs ? `<div class="discret">${esc(c.caracs)}</div>` : ''}
    ${String(c.attaques || '').split('\n').filter(Boolean).map(a => `<div>${esc(a)}</div>`).join('')}
    ${c.nombre ? `<div class="discret">Nombre habituel : ${esc(c.nombre)}</div>` : ''}
    ${c.notes ? `<div class="prose discret">${esc(c.notes)}</div>` : ''}
  </div>`;
}

/* ---------- Résultat ---------- */
function vueResultatRencontre(mod, R, r) {
  const c = r.creature;
  const fiche = R.versFiche && defFiche(mod, R.versFiche.type);
  const combat = peutCombattre(mod) && c && c.def != null && c.pv != null;
  return `<div class="carte rencontre">
    <div class="rangee"><div class="discret petit" style="flex:1">${esc(r.origine)}</div><button class="lien" style="flex:0 0 auto" data-action="rc-effacer">Effacer</button></div>
    ${r.categorie ? `<div class="etiquette">${esc(r.categorie)}</div>` : ''}
    <div class="titre grand">${c ? '' : ''}${esc(r.nom)}</div>
    <div class="rangee serree" style="margin:6px 0">
      <span class="petit" style="flex:1">Nombre : <strong>${r.nombre}</strong> <small class="discret">${r.nbFormule && r.nbFormule !== String(r.nombre) ? '(' + esc(r.nbFormule) + (r.nbDes ? ' : ' + r.nbDes.join(', ') : '') + ')' : ''}</small></span>
      <button data-action="rc-nb" data-v="-1" aria-label="Un de moins">−</button><button data-action="rc-nb" data-v="1" aria-label="Un de plus">+</button>
    </div>
    ${r.note ? `<p class="petit">${esc(r.note)}</p>` : ''}
    ${c ? fichePresentation(mod, c) : '<p class="discret petit">Pas de profil : complète-le dans le bestiaire si besoin.</p>'}
    ${(r.jets || []).length ? `<div class="resultat gauche">${r.jets.map(x => `<div class="res-table">
      <div class="discret petit">${esc(x.table)} · ${esc(x.de)} = ${esc(x.valeur)}</div>
      <div class="reponse petit-rep ${x.sens || ''}">${esc(x.texte)}</div>${x.detail ? `<div class="meta">${esc(x.detail)}</div>` : ''}</div>`).join('')}</div>` : ''}
    <div class="pile" style="margin-top:10px">
      ${combat ? `<button class="principal" data-action="rc-combat">${etat.partie.combat ? 'Ajouter au combat' : 'Préparer le combat'} (${r.nombre})</button>` : ''}
      ${fiche && c ? `<button class="${combat ? '' : 'principal'}" data-action="rc-fiches">Créer ${r.nombre > 1 ? 'les ' + r.nombre + ' fiches' : 'la fiche'} « ${esc(fiche.nom)} »</button>` : ''}
      ${r.fait ? `<p class="discret petit">${esc(r.fait)}</p>` : ''}
    </div>
  </div>`;
}

/* ---------- Génération ---------- */
function lireGen() {
  const G = etat.rcGen;
  if (!G) return;
  if ($('#rc-min')) { G.min = $('#rc-min').value.trim(); G.max = $('#rc-max').value.trim(); }
  if ($('#rc-mien')) G.mien = $('#rc-mien').checked;
  const cases = [...document.querySelectorAll('.rc-jet')];
  if (cases.length) G.jets = cases.filter(x => x.checked).map(x => x.value);
}

async function genererRencontre(mod, valeurs, refDirecte) {
  const R = rencontresCfg(mod);
  const G = etat.rcGen;
  let creature = null, origine = '', nom = '', categorie = '', note = '', nbF = null, tir = null;
  if (refDirecte) {
    creature = creatureRef(mod, refDirecte);
    origine = 'Bestiaire';
    nom = creature?.nom || '?';
  } else if (G.source === 'hasard') {
    const pool = poolHasard(mod, G);
    if (!pool.length) return toast('Aucune créature ne correspond');
    const k = de(pool.length);
    creature = pool[k - 1];
    tir = { table: 'Bestiaire au hasard' + (G.groupe ? ' · ' + G.groupe : ''), de: 'd' + pool.length, valeur: k };
    origine = `${tir.table} · ${tir.de} = ${k}`;
    nom = creature.nom;
  } else {
    const t = tablesZone(mod).find(z => z.id === G.source);
    if (!t) return toast('Table introuvable');
    const f = lireFormule(t.de);
    const j = calculerJet(f, valeurs);
    const l = (t.lignes || []).find(x => j.total >= x.n[0] && j.total <= x.n[1]);
    tir = { table: t.nom, de: formuleCourte(t.de), valeur: j.total };
    origine = `${t.nom} · ${tir.de} = ${j.total}${valeurs ? ' (dé physique)' : ''}`;
    if (!l) { nom = `aucune ligne pour ${j.total}`; }
    else {
      creature = creatureRef(mod, l.ref);
      nom = l.texte || creature?.nom || 'Rencontre';
      categorie = l.categorie || '';
      note = l.note || '';
      nbF = l.nombre || null;
    }
  }
  const nb = lancerNombre(nbF || creature?.nombre || '1');
  const jets = (refDirecte ? [] : G.jets || []).flatMap(id => resoudreTable(mod, id)).map(x => ({ table: x.table, de: x.de, valeur: x.valeur, texte: x.texte, detail: x.detail || '', sens: x.entree?.sens || '' }));
  const r = { t: maintenant(), origine, nom, categorie, note, creature: creature ? JSON.parse(JSON.stringify(creature)) : null,
    nombre: nb.valeur, nbFormule: nb.formule, nbDes: nb.des, jets };
  etat.partie.rencontre = r;
  // Journal : une ligne pour la table (avec le nombre s'il est fixe), une pour le nombre s'il a été lancé
  const resultats = [];
  const aleatoire = !!nb.des;
  const quoi = `${aleatoire ? '' : nb.valeur + ' × '}${nom}`;
  const detail = [note, creature ? texteProfil(mod, creature) : ''].filter(Boolean).join(' — ');
  if (tir) resultats.push({ table: tir.table, de: tir.de, valeur: tir.valeur, texte: `${categorie ? categorie + ' : ' : ''}${quoi}`, detail });
  if (aleatoire) resultats.push({ table: 'Nombre', de: nb.formule, valeur: nb.valeur, texte: `${nb.valeur} × ${nom}`, detail: tir ? '' : detail });
  else if (!tir) resultats.push({ table: 'Bestiaire', de: '—', valeur: nb.valeur, texte: quoi, detail });
  resultats.push(...jets);
  await noterTables(resultats, !!valeurs, 'Rencontre');
  await sauverPartie();
  etat.dernier.table = null;
  await rendre();
  window.scrollTo(0, 0);
}

/* ---------- Vers le combat ou les fiches ---------- */
function modeleAdversaire(c) {
  return { nom: c.nom, niveau: c.niveau ?? '', def: Number(c.def), pv: Number(c.pv), init: c.init != null && c.init !== '' ? Number(c.init) : 10, rd: Number(c.rd) || 0, attaques: c.attaques || '', notes: [c.type, c.caracs, c.notes].filter(Boolean).join('\n') };
}

async function rencontreVersCombat(mod) {
  const r = etat.partie.rencontre;
  const m = modeleAdversaire(r.creature);
  let cb = etat.partie.combat;
  if (!cb) { cb = etat.partie.combat = nouveauCombat(); initialiserPJ(mod, cb); }
  const deja = cb.participants.filter(p => p.camp === 'adv' && (p.nom === m.nom || p.nom.startsWith(m.nom + ' '))).length;
  const att = lireAttaques(m.attaques);
  const nouveaux = [];
  for (let k = 1; k <= r.nombre; k++) {
    const n = r.nombre + deja > 1 ? `${m.nom} ${deja + k}` : m.nom;
    nouveaux.push({ id: nouvelId(), camp: 'adv', nom: n, niveau: m.niveau, def: m.def, pv: { act: m.pv, max: m.pv }, init: m.init, initBase: m.init, rd: m.rd, attaques: att, notes: m.notes, etats: [] });
  }
  cb.participants.push(...nouveaux);
  if (cb.phase === 'jeu') {
    const courantId = cb.ordre[cb.tour];
    cb.ordre = calculerOrdre(mod, cb);
    cb.tour = Math.max(0, cb.ordre.indexOf(courantId));
  }
  await noter({ type: 'combat', texte: `Rencontre : ${r.nombre} × ${m.nom} ${cb.phase === 'jeu' ? 'entre' + (r.nombre > 1 ? 'nt' : '') + ' dans le combat' : 'ajouté' + (r.nombre > 1 ? 's' : '') + ' à la préparation du combat'} (DEF ${m.def}, PV ${m.pv}, Init. ${m.init})` });
  r.fait = `${r.nombre} × ${m.nom} ajouté${r.nombre > 1 ? 's' : ''} au combat.`;
  await sauverPartie();
  etat.jeuSous = 'regles'; etat.reglesVue = 'combat'; etat.formAdv = null;
  await rendre();
  window.scrollTo(0, 0);
}

async function rencontreVersFiches(mod) {
  const R = rencontresCfg(mod);
  const V = R.versFiche;
  const def = defFiche(mod, V.type);
  const r = etat.partie.rencontre;
  const c = r.creature;
  const noms = [];
  const existants = (etat.partie.fiches || []).filter(f => (f.champs?.nom || '').startsWith(c.nom)).length;
  for (let k = 1; k <= r.nombre; k++) {
    const f = nouvelleFiche(mod, V.type, '');
    f.champs.nom = r.nombre + existants > 1 ? `${c.nom} ${existants + k}` : c.nom;
    for (const [src, jid] of Object.entries(V.jauges || {})) {
      const v = Number(c[src]);
      if (Number.isFinite(v) && f.jauges[jid]) f.jauges[jid] = { max: v, act: v };
    }
    for (const [src, cid] of Object.entries(V.compteurs || {})) { const v = Number(c[src]); if (Number.isFinite(v)) f.compteurs[cid] = v; }
    // Profils complets : caractéristiques, compétences, armes, valeurs calculées ramenées à celles du profil
    if (V.caracs && c.caracs) f.caracs = { ...(f.caracs || {}), ...c.caracs };
    if (V.competences && c.competences) f.competences = c.competences.map(x => ({ ...x }));
    if (V.armes && c.armes) f.armes = c.armes.map(x => ({ ...x }));
    if (V.cibles && typeof contexteFiche === 'function') {
      const ctx = contexteFiche(mod, f, def);
      for (const [src, did] of Object.entries(V.cibles)) {
        const v = Number(c[src]);
        if (Number.isFinite(v) && did in ctx) f.bonus[did] = (f.bonus[did] || 0) + v - ctx[did];
      }
    }
    for (const [src, chid] of Object.entries(V.champs || {})) {
      const v = src === 'notes' ? [c.type, c.notes].filter(Boolean).join('\n') : c[src];
      if (v) f.champs[chid] = String(v);
    }
    if (typeof recalculerFiche === 'function') recalculerFiche(mod, f, def);
    etat.partie.fiches = [...(etat.partie.fiches || []), f];
    noms.push(f.champs.nom);
  }
  await noter({ type: 'fiche', texte: `Rencontre : fiche${noms.length > 1 ? 's' : ''} créée${noms.length > 1 ? 's' : ''} (${def.nom}) — ${noms.join(', ')}` });
  r.fait = `Fiche${noms.length > 1 ? 's' : ''} créée${noms.length > 1 ? 's' : ''} : ${noms.join(', ')} (onglet Fiches).`;
  await sauverPartie();
  toast(r.fait);
  rendre();
}

/* ======================================================================
   Éditeur de table de zone
   ====================================================================== */
function ouvrirEditeurTable(mod, id) {
  const R = rencontresCfg(mod);
  const t = id ? (etat.partie.tablesRencontre || []).find(x => x.id === id) : null;
  if (t) { etat.rcEdit = JSON.parse(JSON.stringify(t)); return; }
  const M = R.modele;
  const de0 = M?.de || 'd6';
  const lignes = M?.lignes?.length ? M.lignes.map(l => ({ n: Array.isArray(l.n) ? [...l.n] : [l.n, l.n], categorie: l.nom || '', ref: '', texte: '', nombre: '', note: '' }))
    : lignesParDefaut(de0);
  etat.rcEdit = { id: null, nom: '', de: de0, lignes };
}
function lignesParDefaut(d) {
  const f = lireFormule(d);
  const min = minFormule(f), max = maxFormule(f);
  if (max - min + 1 <= 12) return Array.from({ length: max - min + 1 }, (_, i) => ({ n: [min + i, min + i], categorie: '', ref: '', texte: '', nombre: '', note: '' }));
  const pas = Math.ceil((max - min + 1) / 6);
  const out = [];
  for (let a = min; a <= max; a += pas) out.push({ n: [a, Math.min(max, a + pas - 1)], categorie: '', ref: '', texte: '', nombre: '', note: '' });
  return out;
}

function optionsCreatures(mod, sel) {
  const livre = bestiaireModule(mod), mien = bestiairePartie();
  const groupes = [];
  for (const c of livre) { const g = c.groupe || 'Bestiaire'; let x = groupes.find(y => y.nom === g); if (!x) groupes.push(x = { nom: g, l: [] }); x.l.push(c); }
  return `<option value="">— sans profil (texte libre) —</option>
    ${mien.length ? `<optgroup label="Mes créatures">${mien.map(c => `<option value="p:${esc(c.nom)}" ${sel === 'p:' + c.nom ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}</optgroup>` : ''}
    ${groupes.map(g => `<optgroup label="${esc(g.nom)}">${g.l.map(c => `<option value="m:${esc(c.id)}" ${sel === 'm:' + c.id ? 'selected' : ''}>${esc(c.nom)}${c.niveau != null && c.niveau !== '' ? ' (' + esc(c.niveau) + ')' : ''}</option>`).join('')}</optgroup>`).join('')}`;
}

function vueEditeurTable(mod, R) {
  const E = etat.rcEdit;
  const f = lireFormule(E.de);
  const min = minFormule(f), max = maxFormule(f);
  const trous = [];
  for (let v = min; v <= max; v++) if (!E.lignes.some(l => v >= l.n[0] && v <= l.n[1])) trous.push(v);
  return `<div class="rangee entete-fiche"><button class="lien" data-action="rc-table-annuler">‹ Rencontres</button>
    ${E.id ? `<button class="lien danger" style="text-align:right" data-action="rc-table-suppr">Supprimer la table</button>` : '<span></span>'}</div>
    <div class="carte"><h2>${E.id ? 'Modifier la table' : 'Nouvelle table de rencontre'}</h2>
    <div class="rangee"><input type="text" id="rt-nom" placeholder="Zone (ex. Forêt de Kellar)" value="${esc(E.nom)}" style="flex:2">
      <select id="rt-de" data-action="rt-de">${DES_ZONE.map(d => `<option value="${d}" ${E.de === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
    ${E.lignes.map((l, i) => `<div class="ligne-rencontre">
      <div class="rangee serree"><span class="petit">De</span><input type="number" inputmode="numeric" id="rt-a-${i}" value="${l.n[0]}"><span class="petit">à</span><input type="number" inputmode="numeric" id="rt-b-${i}" value="${l.n[1]}">
        <input type="text" id="rt-cat-${i}" placeholder="Catégorie" value="${esc(l.categorie || '')}" style="flex:3">
        <button class="lien danger" data-action="rt-moins" data-i="${i}" aria-label="Retirer la ligne">✕</button></div>
      <select id="rt-ref-${i}">${optionsCreatures(mod, l.ref)}</select>
      <div class="rangee"><input type="text" id="rt-txt-${i}" placeholder="Nom affiché (facultatif)" value="${esc(l.texte || '')}" style="flex:2"><input type="text" id="rt-nb-${i}" placeholder="Nombre (1d4)" value="${esc(l.nombre || '')}"></div>
      <input type="text" id="rt-note-${i}" placeholder="Ce qu'ils font déjà (facultatif)" value="${esc(l.note || '')}">
    </div>`).join('')}
    ${trous.length ? `<p class="force petit">Aucune ligne pour : ${trous.slice(0, 12).join(', ')}${trous.length > 12 ? '…' : ''} (le tirage le signalera).</p>` : ''}
    <button class="lien" data-action="rt-plus">+ Ajouter une ligne</button>
    <div class="rangee" style="margin-top:10px"><button data-action="rc-table-annuler">Annuler</button><button class="principal" style="flex:2" data-action="rc-table-ok">Enregistrer</button></div>
    ${R.modele?.aide ? `<p class="discret petit">${enrichir(R.modele.aide)}</p>` : ''}
    <p class="discret petit">Nombre : un chiffre ou une formule (1d4, 2d6+1). Vide : le nombre habituel de la créature, sinon 1.</p>
  </div>`;
}

function lireEditeurTable() {
  const E = etat.rcEdit;
  if (!E || !$('#rt-nom')) return E;
  E.nom = $('#rt-nom').value.trim();
  E.de = $('#rt-de').value;
  E.lignes = E.lignes.map((l, i) => {
    const a = Number($('#rt-a-' + i)?.value), b = Number($('#rt-b-' + i)?.value);
    return { n: [Number.isFinite(a) ? a : l.n[0], Number.isFinite(b) ? Math.max(a, b) : l.n[1]], categorie: $('#rt-cat-' + i)?.value.trim() || '', ref: $('#rt-ref-' + i)?.value || '',
      texte: $('#rt-txt-' + i)?.value.trim() || '', nombre: $('#rt-nb-' + i)?.value.trim() || '', note: $('#rt-note-' + i)?.value.trim() || '' };
  });
  return E;
}

/* ======================================================================
   Éditeur de créature (bestiaire de la partie)
   ====================================================================== */
function vueEditeurCreature(mod, R) {
  const E = etat.rcCreature;
  const c = E.c;
  return `<div class="rangee entete-fiche"><button class="lien" data-action="rc-crea-annuler">‹ Rencontres</button>
    ${E.i != null ? `<button class="lien danger" style="text-align:right" data-action="rc-crea-suppr">Supprimer</button>` : '<span></span>'}</div>
    <div class="carte"><h2>${E.i != null ? 'Modifier la créature' : 'Nouvelle créature'}</h2>
    <input type="text" id="rk-nom" placeholder="Nom" value="${esc(c.nom || '')}">
    ${R.profil.length ? `<div class="grille-edition" style="margin-top:8px">${R.profil.map(p => `<label><span>${esc(p.nom)}</span><input type="${p.texte ? 'text' : 'number'}" ${p.texte ? '' : 'inputmode="numeric"'} id="rk-p-${esc(p.id)}" value="${esc(c[p.id] ?? '')}"></label>`).join('')}</div>` : ''}
    <h3>Attaques <small class="discret">(une par ligne)</small></h3>
    <textarea id="rk-att" rows="2" placeholder="${esc(R.exempleAttaque || mod.regles?.combat?.adversaire?.exemple || 'Morsure 1d6')}">${esc(c.attaques || '')}</textarea>
    <div class="rangee"><input type="text" id="rk-nb" placeholder="Nombre habituel (1d4)" value="${esc(c.nombre || '')}"><input type="text" id="rk-groupe" placeholder="Groupe (facultatif)" value="${esc(c.groupe || '')}"></div>
    <textarea id="rk-notes" rows="3" placeholder="Comportement, capacités, page du livre…">${esc(c.notes || '')}</textarea>
    <div class="rangee" style="margin-top:10px"><button data-action="rc-crea-annuler">Annuler</button><button class="principal" style="flex:2" data-action="rc-crea-ok">Enregistrer</button></div>
  </div>`;
}

function lireEditeurCreature(mod) {
  const R = rencontresCfg(mod);
  const c = { ...(etat.rcCreature.c || {}) };
  c.nom = $('#rk-nom').value.trim();
  for (const p of R.profil) {
    const v = $('#rk-p-' + p.id)?.value.trim() ?? '';
    if (v === '') delete c[p.id];
    else c[p.id] = p.texte ? v : Number(v.replace('−', '-'));
  }
  c.attaques = $('#rk-att').value.trim();
  c.nombre = $('#rk-nb').value.trim();
  c.groupe = $('#rk-groupe').value.trim();
  c.notes = $('#rk-notes').value.trim();
  for (const k of ['attaques', 'nombre', 'groupe', 'notes']) if (!c[k]) delete c[k];
  delete c.source; delete c.id;
  return c;
}

/* ======================================================================
   Actions (préfixe « rc- » et « rt- »)
   ====================================================================== */
async function actionRencontres(a, b, mod) {
  const p = etat.partie;
  switch (a) {
    case 'rc-source': lireGen(); etat.rcGen.source = b.dataset.v; return rendre();
    case 'rc-groupe': lireGen(); etat.rcGen.groupe = b.dataset.v; return rendre();
    case 'rc-generer': lireGen(); return genererRencontre(mod, null);
    case 'rc-phys': {
      lireGen();
      const t = tablesZone(mod).find(z => z.id === etat.rcGen.source);
      const f = lireFormule(t.de);
      const v = lireValeursPhysiques('rc-phys', nbDes(t.de), f.grille || f.faces);
      if (!v) return toast('Entre une valeur valide pour chaque dé');
      return genererRencontre(mod, v);
    }
    case 'rc-direct': lireGen(); return genererRencontre(mod, null, b.dataset.ref);
    case 'rc-decl': {
      lireGen();
      const rs = resoudreTable(mod, rencontresCfg(mod).declencheur);
      await noterTables(rs, false, '');
      etat.dernier.table = { origine: 'rencontres', resultats: rs, aide: null };
      return rendre();
    }
    case 'rc-effacer': delete p.rencontre; await sauverPartie(); return rendre();
    case 'rc-nb': {
      const r = p.rencontre;
      const av = r.nombre;
      r.nombre = Math.max(1, Math.min(30, r.nombre + Number(b.dataset.v)));
      if (r.nombre === av) return;
      if (!r.ajuste) r.ajuste = av;
      await sauverPartie(); rendre();
      clearTimeout(etat.rcMinuterie);
      // Une seule entrée de journal pour une série de + / −
      etat.rcMinuterie = setTimeout(async () => {
        const rr = etat.partie?.rencontre;
        if (!rr?.ajuste || rr.ajuste === rr.nombre) { if (rr) delete rr.ajuste; return; }
        await noter({ type: 'derogation', texte: `Rencontre « ${rr.nom} » : nombre fixé à ${rr.nombre} (le tirage donnait ${rr.ajuste})` });
        delete rr.ajuste; await sauverPartie();
      }, 2500);
      return;
    }
    case 'rc-combat': return rencontreVersCombat(mod);
    case 'rc-fiches': return rencontreVersFiches(mod);

    /* Tables de zone */
    case 'rc-table-nouv': lireGen(); ouvrirEditeurTable(mod, null); await rendre(); return window.scrollTo(0, 0);
    case 'rc-table-edit': lireGen(); ouvrirEditeurTable(mod, b.dataset.id); await rendre(); return window.scrollTo(0, 0);
    case 'rc-table-annuler': etat.rcEdit = null; await rendre(); return window.scrollTo(0, 0);
    case 'rt-plus': {
      const E = lireEditeurTable();
      const der = E.lignes[E.lignes.length - 1];
      const n = der ? der.n[1] + 1 : minFormule(lireFormule(E.de));
      E.lignes.push({ n: [n, n], categorie: '', ref: '', texte: '', nombre: '', note: '' });
      return rendre();
    }
    case 'rt-moins': { const E = lireEditeurTable(); E.lignes.splice(Number(b.dataset.i), 1); return rendre(); }
    case 'rc-table-ok': {
      const E = lireEditeurTable();
      if (!E.nom) return toast('Donne un nom à la table (la zone)');
      E.lignes = E.lignes.filter(l => l.ref || l.texte);
      if (!E.lignes.length) return toast('Ajoute au moins une créature ou un texte');
      const liste = p.tablesRencontre || (p.tablesRencontre = []);
      if (E.id) { const i = liste.findIndex(x => x.id === E.id); liste[i] = E; }
      else { E.id = nouvelId(); liste.push(E); }
      etat.rcGen.source = E.id;
      etat.rcEdit = null;
      await sauverPartie(); toast('Table enregistrée'); await rendre(); return window.scrollTo(0, 0);
    }
    case 'rc-table-suppr': {
      const E = etat.rcEdit;
      if (!confirm(`Supprimer la table « ${E.nom} » ?`)) return;
      p.tablesRencontre = (p.tablesRencontre || []).filter(x => x.id !== E.id);
      etat.rcEdit = null; await sauverPartie(); return rendre();
    }

    /* Créatures de la partie */
    case 'rc-crea-nouv': lireGen(); etat.rcCreature = { i: null, c: {} }; await rendre(); return window.scrollTo(0, 0);
    case 'rc-crea-edit': lireGen(); etat.rcCreature = { i: Number(b.dataset.i), c: { ...bestiairePartie()[Number(b.dataset.i)] } }; await rendre(); return window.scrollTo(0, 0);
    case 'rc-crea-copier': {
      lireGen();
      const c = bestiaireModule(mod).find(x => x.id === b.dataset.id);
      const copie = { ...c }; delete copie.id;
      copie.nom = c.nom + ' (variante)';
      etat.rcCreature = { i: null, c: copie }; await rendre(); return window.scrollTo(0, 0);
    }
    case 'rc-crea-annuler': etat.rcCreature = null; await rendre(); return window.scrollTo(0, 0);
    case 'rc-crea-ok': {
      const c = lireEditeurCreature(mod);
      if (!c.nom) return toast('Donne un nom à la créature');
      const liste = p.bestiaire || (p.bestiaire = []);
      const E = etat.rcCreature;
      const autre = liste.findIndex((x, i) => x.nom === c.nom && i !== E.i);
      if (autre >= 0) return toast('Une créature porte déjà ce nom');
      if (E.i != null) {
        const ancien = liste[E.i].nom;
        liste[E.i] = c;
        // Les tables qui la citaient suivent le changement de nom
        if (ancien !== c.nom) for (const t of p.tablesRencontre || []) for (const l of t.lignes) if (l.ref === 'p:' + ancien) l.ref = 'p:' + c.nom;
      } else liste.push(c);
      etat.rcCreature = null;
      await sauverPartie(); toast('Créature enregistrée'); await rendre(); return window.scrollTo(0, 0);
    }
    case 'rc-crea-suppr': {
      const E = etat.rcCreature;
      const c = bestiairePartie()[E.i];
      const utilisee = (p.tablesRencontre || []).filter(t => t.lignes.some(l => l.ref === 'p:' + c.nom)).map(t => t.nom);
      if (!confirm(`Supprimer « ${c.nom} » de tes créatures ?${utilisee.length ? `\n\nElle figure dans : ${utilisee.join(', ')}. Ces lignes resteront, sans profil.` : ''}`)) return;
      for (const t of p.tablesRencontre || []) for (const l of t.lignes) if (l.ref === 'p:' + c.nom) { l.ref = ''; l.texte = l.texte || c.nom; }
      p.bestiaire.splice(E.i, 1);
      etat.rcCreature = null; await sauverPartie(); return rendre();
    }
  }
}

/* Changement du dé de l'éditeur (événement « change ») */
document.addEventListener('change', e => {
  if (e.target.id !== 'rt-de' || !etat.rcEdit) return;
  const E = lireEditeurTable();
  const f = lireFormule(E.de);
  const max = maxFormule(f);
  // Garde les lignes déjà remplies ; recale seulement les plages vides ou hors du dé
  const pleines = E.lignes.filter(l => l.ref || l.texte || l.categorie);
  E.lignes = pleines.length ? pleines.map(l => ({ ...l, n: [Math.min(l.n[0], max), Math.min(l.n[1], max)] })) : lignesParDefaut(E.de);
  rendre();
});

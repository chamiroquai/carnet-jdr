/* Carnet JDR — assistant de règles (étape 5) : test pas à pas, combat (initiative, tours,
   attaque contre défense, dommages, états, postures), fiches rapides d'adversaires,
   procédures décrites dans le module.
   Moteur générique : aucun contenu de jeu ici. Les règles viennent de la section « regles »
   du module, ou d'un fichier complément importé et rattaché au module.
   Chargé après systeme.js, avant app.js. */
'use strict';

const FORMAT_COMPLEMENT = 'carnet-jdr-complement';

/* ---------- Références : « DEF », « Init », « PV » → éléments de la fiche ---------- */
const normRef = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function trouverRef(def, ref) {
  if (!def || ref == null) return null;
  const r = normRef(ref);
  if (!r) return null;
  const listes = [['carac', def.caracs || []], ['derivee', def.derivees || []], ['jauge', def.jauges || []]];
  for (const cle of ['id', 'abr', 'nom']) {
    for (const [kind, l] of listes) for (const x of l) if (x[cle] != null && normRef(x[cle]) === r) return { kind, id: x.id, item: x };
  }
  for (const [kind, l] of listes) for (const x of l) if ([x.abr, x.nom].some(v => v && normRef(v).startsWith(r))) return { kind, id: x.id, item: x };
  if (r.length >= 4) for (const [kind, l] of listes) for (const x of l) if ([x.abr, x.nom].some(v => v && normRef(v).includes(r))) return { kind, id: x.id, item: x };
  return null;
}
function valeurRef(mod, f, def, x) {
  if (!x) return 0;
  if (x.kind === 'jauge') return f.jauges?.[x.id]?.act ?? 0;
  return contexteFiche(mod, f, def)[x.id] ?? 0;
}
const libRef = x => x ? (x.item.abr || x.item.nom || x.id) : '?';

function reglesMod(mod) { return mod?.regles || null; }
function refsMod(mod) { return { defense: 'DEF', init: 'Init', pv: 'PV', ...(reglesMod(mod)?.refs || {}) }; }
function refFiche(mod, f, cle) {
  const def = defFiche(mod, f?.type);
  return def ? trouverRef(def, refsMod(mod)[cle]) : null;
}
function valeurFiche(mod, f, cle) {
  const def = defFiche(mod, f.type);
  return valeurRef(mod, f, def, refFiche(mod, f, cle));
}

/* Dé évolutif : « 1d4° » devient « 1d6 » si la fiche a un dé évolutif de 6 */
function exprEvo(src, mod, f) {
  const def = f ? defFiche(mod, f.type) : null;
  let evo = null;
  const ref = reglesMod(mod)?.refs?.deEvolutif;
  if (ref && def) { const x = trouverRef(def, ref); if (x) evo = valeurRef(mod, f, def, x); }
  return String(src ?? '').replace(/(\d*)d(\d+)°/g, (_, n, fa) => `${n}d${evo || fa}`);
}
function ctxFiche(mod, f) { const def = f ? defFiche(mod, f.type) : null; return def ? contexteFiche(mod, f, def) : {}; }

/* ---------- Validation du bloc « regles » ---------- */
function validerRegles(mod, regles) {
  const avert = [];
  const defs = Object.entries(mod.fiches || {}).filter(([, d]) => d.caracs || d.derivees);
  for (const [type, def] of defs) {
    const refs = { defense: 'DEF', init: 'Init', pv: 'PV', ...(regles.refs || {}) };
    for (const [cle, ref] of Object.entries(refs)) {
      if (!trouverRef(def, ref)) avert.push(`Fiche « ${def.nom || type} » : « ${ref} » (${cle}) introuvable.`);
    }
    for (const p of regles.procedures || []) for (const e of p.etapes || []) {
      if (e.type === 'test' && e.carac && !trouverRef(def, e.carac)) avert.push(`Procédure « ${p.nom} » : « ${e.carac} » introuvable sur la fiche « ${def.nom || type} ».`);
    }
  }
  for (const p of regles.procedures || []) {
    const ids = new Set((p.etapes || []).map(e => e.id).filter(Boolean));
    for (const e of p.etapes || []) for (const k of ['siReussite', 'siEchec', 'suite']) if (e[k] && !ids.has(e[k])) avert.push(`Procédure « ${p.nom} » : étape « ${e[k]} » introuvable.`);
  }
  return avert;
}

/* ---------- Import d'un complément (fichier « carnet-jdr-complement ») ---------- */
async function importerComplement(d) {
  if (!d.regles || typeof d.regles !== 'object') { alert('Import refusé : ce complément ne contient pas de section « regles ».'); return; }
  const mods = modulesImportes();
  if (!mods.length) { alert('Importe d’abord le module de jeu : le complément s’y rattache.'); return; }
  let cible = null;
  const indice = normRef(d.pour?.nom || '');
  const candidats = indice ? mods.filter(m => normRef(m.donnees.nom).includes(indice) || normRef(m.id).includes(indice)) : [];
  const actif = etat.partie?.module ? mods.find(m => m.id === etat.partie.module) : null;
  if (candidats.length === 1) cible = candidats[0];
  else if (actif && (!candidats.length || candidats.includes(actif))) cible = actif;
  else if (mods.length === 1) cible = mods[0];
  else {
    const s = prompt(`À quel module rattacher « ${d.nom} » ?\n\n${mods.map((m, i) => `${i + 1}. ${m.donnees.nom}`).join('\n')}\n\nNuméro :`, '1');
    const i = Number(s) - 1;
    if (!mods[i]) return;
    cible = mods[i];
  }
  const avert = validerRegles(cible.donnees, d.regles);
  const msg = `Rattacher « ${d.nom} »${d.version ? ' v' + d.version : ''} au module « ${cible.donnees.nom} » ?${cible.donnees.regles ? '\n\nLes règles déjà rattachées seront remplacées.' : ''}`;
  if (avert.length) { if (!confirm('Points à vérifier :\n\n• ' + avert.slice(0, 10).join('\n• ') + '\n\n' + msg)) return; }
  else if (!confirm(msg)) return;
  cible.donnees.regles = d.regles;
  cible.donnees.complements = { ...(cible.donnees.complements || {}), [d.id || 'regles']: { nom: d.nom, version: d.version || '', le: maintenant() } };
  cible.majLe = maintenant();
  await DB.mettre('contenus', cible);
  await chargerContenus();
  await signalerChangement();
  toast(`« ${d.nom} » rattaché à ${cible.donnees.nom}`);
  rendre();
}

/* ---------- Dés bonus / malus : un seul de chaque, ils s'annulent ---------- */
function resoudreDe(sources) {
  const b = sources.includes('bonus'), m = sources.includes('malus');
  return b && m ? 'normal' : b ? 'bonus' : m ? 'malus' : 'normal';
}

/* Jet d20 + bonus ≥ seuil, avec critiques (règles de la section « test » du module) */
function jetD20(mod, { base, modif, de, valeurs, seuil, attaque, critSeuil, libelle }) {
  const t = mod.test || {};
  const faces = t.de || 20;
  const n = de === 'normal' ? 1 : 2;
  const cfg = { faces, n, garde: de === 'bonus' ? 'h' : de === 'malus' ? 'l' : 'tous', k: 1, mod: base + modif, comp: '>=', seuil: seuil ?? '', libelle };
  const r = calculerJet(cfg, valeurs);
  const nat = r.des[r.gardes[0]];
  r.naturel = nat;
  if (nat >= (critSeuil || t.critique || faces)) {
    r.critique = true;
    r.mention = attaque ? (t.critiqueAttaque || 'Réussite critique') : (t.critiqueTexte || 'Réussite critique');
    if (r.seuil != null) r.reussite = true;
  } else if (t.echecCritique && nat <= t.echecCritique) {
    if (!attaque || t.echecCritiqueAttaque) {
      r.echecCritique = true;
      r.mention = t.echecTexte || 'Échec critique';
      if (r.seuil != null) r.reussite = false;
    } else if (t.unAttaque) r.mention = t.unAttaque;
  }
  return r;
}

function lireDesPhysiques(prefixe, n, faces) {
  const a = $(`#${prefixe}-0`)?.value.trim();
  if (!a) return { valeurs: null };
  const v = Array.from({ length: n }, (_, i) => lireEntier($(`#${prefixe}-${i}`)?.value ?? '', 1, faces));
  if (v.some(x => x == null)) return { erreur: `Entre ${n === 2 ? 'deux valeurs' : 'une valeur'} entre 1 et ${faces}` };
  return { valeurs: v };
}
function champsDesPhysiques(prefixe, n, faces) {
  return `<details class="de-physique" data-garde="${prefixe}"><summary>Avec mes dés : saisis-les puis lance</summary>
    <div class="rangee">${Array.from({ length: n }, (_, i) => `<input type="number" inputmode="numeric" id="${prefixe}-${i}" placeholder="d${faces}">`).join('')}</div>
  </details>`;
}

/* ---------- États (section regles.combat.etats) ---------- */
function etatsDef(mod) { return reglesMod(mod)?.combat?.etats || []; }
function etatDef(mod, nom) { return etatsDef(mod).find(e => e.nom === nom) || { nom }; }

/* ======================================================================
   Vue « Règles » (sous-onglet de Jeu)
   ====================================================================== */
function vueRegles(mod) {
  const R = reglesMod(mod);
  const v = etat.reglesVue || 'hub';
  if (v === 'test' && etat.assistantTest) return vueAssistantTest(mod);
  if (v === 'combat' && etat.partie.combat) return vueCombat(mod);
  if (v === 'proc' && etat.procedure) return vueProcedure(mod);
  etat.reglesVue = 'hub';
  const fiches = (etat.partie.fiches || []).filter(f => defFiche(mod, f.type));
  const testable = mod.test?.mode === 'bonus';
  let html = '';
  if (!R) {
    html += `<div class="carte"><h2>Assistant de règles</h2>
      <p class="discret">Ce module ne décrit pas encore ses règles d'assistance (section « regles »). Importe le fichier complément fourni pour ce jeu (Réglages › Importer).</p>
      ${testable ? '<p class="discret petit">Le test pas à pas reste disponible ci-dessous.</p>' : ''}</div>`;
  }
  if (R?.combat) {
    const cb = etat.partie.combat;
    html += `<div class="carte">
      <h2>${esc(R.combat.titre || 'Combat')}</h2>
      ${cb ? `<p class="petit">${cb.phase === 'prep' ? 'Combat en préparation' : `En cours · round ${cb.round}`} · ${cb.participants.length} participant${cb.participants.length > 1 ? 's' : ''}</p>
        <button class="principal" data-action="rg-combat-ouvrir">${cb.phase === 'prep' ? 'Reprendre la préparation' : 'Reprendre le combat'}</button>`
        : `<p class="discret petit">Initiative, tours, attaques contre la défense, dommages et états. Tu choisis les actions de chacun ; l'appli applique la règle.</p>
        <button class="principal" data-action="rg-combat-preparer">Préparer un combat</button>`}
    </div>`;
  }
  if (testable) {
    html += `<div class="carte"><h2>${esc(mod.test.nom || 'Test')} pas à pas</h2>
      ${fiches.length ? `<div class="pile">${fiches.map(f => `<button data-action="rg-test" data-id="${esc(f.id)}">${esc(nomFiche(f, defFiche(mod, f.type)))}${f.role === 'principal' ? '<small class="discret"> — principal</small>' : ''}</button>`).join('')}</div>`
        : '<p class="discret petit">Crée d’abord une fiche.</p>'}
    </div>`;
  }
  if ((R?.procedures || []).length) {
    html += `<div class="carte"><h2>Procédures</h2>
      <div class="pile">${R.procedures.map(p => `<button data-action="rg-proc" data-id="${esc(p.id)}">${esc(p.nom)}${p.aide ? `<small class="discret"> — ${esc(p.aide)}</small>` : ''}</button>`).join('')}</div></div>`;
  }
  if (R && fiches.length) {
    const lignes = fiches.slice(0, 6).map(f => {
      const r = ['defense', 'init', 'pv'].map(k => { const x = refFiche(mod, f, k); return `${k === 'defense' ? 'Défense' : k === 'init' ? 'Initiative' : 'Vitalité'} : ${x ? esc(libRef(x)) + ' (' + valeurFiche(mod, f, k) + ')' : '<span class="force">introuvable</span>'}`; });
      return `<li><strong>${esc(nomFiche(f, defFiche(mod, f.type)))}</strong> — ${r.join(' · ')}</li>`;
    });
    html += `<details class="carte" data-garde="rg-corresp"><summary><strong>Correspondances avec les fiches</strong></summary>
      <ul class="liste-simple petit">${lignes.join('')}</ul>
      ${(mod.complements ? Object.values(mod.complements) : []).map(c => `<p class="discret petit">Complément : ${esc(c.nom)}${c.version ? ' v' + esc(c.version) : ''}</p>`).join('')}</details>`;
  }
  return html;
}

/* ======================================================================
   Test pas à pas
   ====================================================================== */
function ouvrirTest(mod, f, retour) {
  etat.assistantTest = { fiche: f.id, etape: 1, quoi: null, contre: { type: 'diff', valeur: null, nom: '' }, modif: 0, de: [], mods: [], retour: retour || 'hub', res: null };
  etat.jeuSous = 'regles'; etat.reglesVue = 'test'; etat.ficheOuverte = null;
}

function etatsTestFiche(mod, f) {
  const cb = etat.partie?.combat;
  if (!cb || cb.phase !== 'jeu') return [];
  const p = cb.participants.find(x => x.fiche === f.id);
  return p ? etatsParticipant(mod, cb, p) : [];
}

function vueAssistantTest(mod) {
  const A = etat.assistantTest;
  const f = ficheParId(A.fiche);
  if (!f) { etat.assistantTest = null; etat.reglesVue = 'hub'; return vueRegles(mod); }
  const def = defFiche(mod, f.type);
  const t = mod.test;
  const T = reglesMod(mod)?.test || {};
  const ctx = contexteFiche(mod, f, def);
  const abr = x => x.abr || x.nom || x.id;
  const etapes = ['Quoi ?', 'Contre quoi ?', 'Modificateurs', 'Jet'];
  let html = `<div class="rangee entete-fiche"><button class="lien" data-action="rg-test-fermer">‹ ${A.retour === 'combat' ? 'Combat' : 'Règles'}</button>
    <span class="discret petit" style="text-align:right">${esc(nomFiche(f, def))}</span></div>
    <div class="carte assistant">
    <div class="etapes-assist">${etapes.map((e, i) => `<span class="${i + 1 === A.etape ? 'courante' : i + 1 < A.etape ? 'faite' : ''}">${i + 1}. ${e}</span>`).join('')}</div>`;
  if (A.etape === 1) {
    const att = (def.derivees || []).filter(d => d.test);
    html += `<h2>Quelle caractéristique ?</h2>
      <div class="grille-4">${(def.caracs || []).map(k => `<button data-action="rg-t-quoi" data-k="${esc(k.id)}"><strong>${esc(abr(k))}</strong><small class="discret"> ${txtSigne(ctx[k.id])}</small></button>`).join('')}</div>
      ${att.length ? `<h3>Ou un test d'attaque</h3><div class="grille-3">${att.map(d => `<button data-action="rg-t-quoi" data-d="${esc(d.id)}"><strong>${esc(abr(d))}</strong><small class="discret"> ${texteDerivee(d, ctx[d.id])}</small></button>`).join('')}</div>` : ''}
      ${T.aide ? `<p class="discret petit">${enrichir(T.aide)}</p>` : t.aide ? `<p class="discret petit">${esc(t.aide)}</p>` : ''}`;
  } else if (A.etape === 2) {
    const diffs = T.difficultes || [];
    const c = A.contre;
    html += `<h2>Contre quoi ?</h2>
      <div class="puces">${[['diff', 'Difficulté'], ['oppose', 'Test opposé'], ['aucun', 'Sans seuil']].map(([k, l]) => `<button class="puce ${c.type === k ? 'choisie' : ''}" data-action="rg-t-contre" data-v="${k}">${l}</button>`).join('')}</div>`;
    if (c.type === 'diff') {
      html += `${diffs.length ? `<div class="pile" style="margin-top:10px">${diffs.map((d, i) => `<button class="${c.valeur === d.valeur && c.nom === d.nom ? 'choisi' : ''}" data-action="rg-t-diff" data-i="${i}"><strong>${esc(d.nom)}</strong> <small class="discret">${d.valeur}${d.aide ? ' — ' + esc(d.aide) : ''}</small></button>`).join('')}</div>` : ''}
        <div class="rangee" style="margin-top:10px"><span class="petit">Autre valeur</span><input type="number" inputmode="numeric" id="rg-t-val" value="${c.valeur ?? ''}" placeholder="difficulté"></div>`;
    } else if (c.type === 'oppose') {
      html += `<p class="discret petit">${esc(T.oppose || 'Le résultat est comparé au test de l’adversaire. Saisis son résultat, ou son bonus pour que l’appli lance son d20.')}</p>
        <div class="rangee"><input type="text" id="rg-t-adv-nom" placeholder="Adversaire (facultatif)" value="${esc(c.nom || '')}"></div>
        <div class="rangee" style="margin-top:8px"><span class="petit">Bonus de l'adversaire</span><input type="number" inputmode="numeric" id="rg-t-adv-bonus" value="${c.bonus ?? ''}" placeholder="+0"></div>
        <label class="case petit"><input type="checkbox" id="rg-t-adv-fixe" ${c.fixe ? 'checked' : ''}> Ne pas lancer pour lui : 10 + bonus${T.opposeFixe ? ' (' + esc(T.opposeFixe) + ')' : ''}</label>
        <div class="rangee" style="margin-top:8px"><span class="petit">Ou son résultat</span><input type="number" inputmode="numeric" id="rg-t-adv-res" value="${c.resultat ?? ''}" placeholder="résultat"></div>`;
    }
    html += `<div class="rangee" style="margin-top:12px"><button class="lien" data-action="rg-t-retour">Retour</button><button class="principal" style="flex:2" data-action="rg-t-suite2">Continuer</button></div>`;
  } else if (A.etape === 3) {
    const mods = T.modificateurs || [];
    const auto = etatsTestFiche(mod, f).filter(e => etatDef(mod, e).deTests);
    html += `<h2>Modificateurs</h2>
      <div class="puces">${[['bonus', t.libelleBonus || 'Dé bonus'], ['malus', t.libelleMalus || 'Dé malus']].map(([k, l]) => `<button class="puce ${A.de.includes(k) ? 'choisie' : ''}" data-action="rg-t-de" data-v="${k}">${l}</button>`).join('')}</div>
      ${auto.length ? `<p class="force petit">État${auto.length > 1 ? 's' : ''} ${auto.map(esc).join(', ')} : ${esc((t.libelleMalus || 'dé malus').toLowerCase())} appliqué.</p>` : ''}
      ${mods.length ? `<div class="pile" style="margin-top:10px">${mods.map((m, i) => `<label class="case" data-action="rg-t-mod" data-i="${i}"><input type="checkbox" ${A.mods.includes(i) ? 'checked' : ''}> ${esc(m.nom)} <small class="discret">${m.mod ? txtSigne(m.mod) : m.de === 'bonus' ? (t.libelleBonus || 'dé bonus') : m.de === 'malus' ? (t.libelleMalus || 'dé malus') : ''}${m.aide ? ' — ' + esc(m.aide) : ''}</small></label>`).join('')}</div>` : ''}
      <div class="stepper" style="margin-top:10px"><span class="discret petit">Autre modificateur (capacité, situation…)</span><div class="rangee serree">
        <button data-action="rg-t-modif" data-v="-1">−</button><output>${txtSigne(A.modif)}</output><button data-action="rg-t-modif" data-v="1">+</button></div></div>
      ${(T.sansJet || []).length && A.contre.type !== 'oppose' ? `<h3>Sans lancer le dé</h3><div class="pile">${T.sansJet.map((s, i) => `<button data-action="rg-t-sansjet" data-i="${i}">${esc(s.nom)} <small class="discret">: résultat ${s.valeur} + bonus${s.aide ? ' — ' + esc(s.aide) : ''}</small></button>`).join('')}</div>` : ''}
      <div class="rangee" style="margin-top:12px"><button class="lien" data-action="rg-t-retour">Retour</button><button class="principal" style="flex:2" data-action="rg-t-suite3">Continuer</button></div>`;
  } else {
    const p = parametresTest(mod, f, A);
    html += `<h2>${esc(p.quoi)}</h2>
      <ul class="liste-simple petit">${p.lignes.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <p class="petit"><strong>Total : d${t.de || 20}${p.de !== 'normal' ? ` (${p.de === 'bonus' ? (t.libelleBonus || 'dé bonus') : (t.libelleMalus || 'dé malus')})` : ''} ${txtSigne(p.base + p.modif)}${p.seuilTxt ? ' contre ' + esc(p.seuilTxt) : ''}</strong></p>`;
    if (!A.res) {
      html += `<button class="principal" data-action="rg-t-lancer">Lancer</button>${champsDesPhysiques('rg-t-phys', p.de === 'normal' ? 1 : 2, t.de || 20)}`;
    } else {
      html += rendreResultatJet(etat.dernier.jet && etat.dernier.jet.id === A.res ? etat.dernier.jet : A.resObj);
      if (A.oppose) html += `<p class="petit">${esc(A.oppose)}</p>`;
      html += `<div class="rangee" style="margin-top:10px"><button data-action="rg-t-nouveau">Autre test</button><button class="principal" data-action="rg-test-fermer">Terminer</button></div>`;
    }
    if (!A.res) html += `<div class="rangee" style="margin-top:12px"><button class="lien" data-action="rg-t-retour">Retour</button></div>`;
  }
  return html + '</div>';
}

function parametresTest(mod, f, A) {
  const def = defFiche(mod, f.type);
  const t = mod.test;
  const T = reglesMod(mod)?.test || {};
  const ctx = contexteFiche(mod, f, def);
  const lignes = [];
  let base = 0, quoi = '';
  if (A.quoi?.carac) { const k = def.caracs.find(x => x.id === A.quoi.carac); base = ctx[k.id]; quoi = `${t.nom || 'Test'} ${deCarac(k.abr || k.id)}`; lignes.push(`${k.nom || k.abr} : ${txtSigne(base)}`); }
  else if (A.quoi?.derivee) { const d = def.derivees.find(x => x.id === A.quoi.derivee); base = ctx[d.id]; quoi = d.nom; lignes.push(`${d.nom} : ${txtSigne(base)}`); }
  let modif = A.modif;
  const sources = [...A.de];
  for (const i of A.mods) { const m = (T.modificateurs || [])[i]; if (!m) continue; if (m.mod) { modif += m.mod; lignes.push(`${m.nom} : ${txtSigne(m.mod)}`); } if (m.de) { sources.push(m.de); lignes.push(`${m.nom} : ${m.de === 'bonus' ? 'dé bonus' : 'dé malus'}`); } }
  for (const e of etatsTestFiche(mod, f)) { const ed = etatDef(mod, e); if (ed.deTests) { sources.push(ed.deTests); lignes.push(`État ${e} : ${ed.deTests === 'bonus' ? 'dé bonus' : 'dé malus'}`); } }
  if (A.modif) lignes.push(`Autre modificateur : ${txtSigne(A.modif)}`);
  const de = resoudreDe(sources);
  if (sources.includes('bonus') && sources.includes('malus')) lignes.push('Dé bonus et dé malus s’annulent');
  let seuil = null, seuilTxt = '';
  const c = A.contre;
  if (c.type === 'diff' && c.valeur != null) { seuil = c.valeur; seuilTxt = `${c.nom ? c.nom.toLowerCase() + ' ' : 'difficulté '}${c.valeur}`; }
  if (c.type === 'oppose') seuilTxt = `${c.nom || 'l’adversaire'} (${c.resultat != null ? 'résultat ' + c.resultat : (c.fixe ? '10 ' : 'd20 ') + txtSigne(c.bonus || 0)})`;
  return { base, modif, de, seuil, seuilTxt, quoi, lignes };
}

async function lancerTestAssistant(mod, sansJet) {
  const A = etat.assistantTest;
  const f = ficheParId(A.fiche);
  const def = defFiche(mod, f.type);
  const t = mod.test;
  const p = parametresTest(mod, f, A);
  const faces = t.de || 20;
  let valeurs = null;
  if (sansJet == null) {
    const ph = lireDesPhysiques('rg-t-phys', p.de === 'normal' ? 1 : 2, faces);
    if (ph.erreur) return toast(ph.erreur);
    valeurs = ph.valeurs;
  }
  const libelle = `${p.quoi}${p.modif ? ' ' + txtSigne(p.modif) : ''}${p.de === 'bonus' ? ' avec ' + (t.libelleBonus || 'dé bonus').toLowerCase() : p.de === 'malus' ? ' avec ' + (t.libelleMalus || 'dé malus').toLowerCase() : ''} — ${nomFiche(f, def)}`;
  let r;
  if (sansJet != null) {
    const s = reglesMod(mod).test.sansJet[sansJet];
    const total = s.valeur + p.base + p.modif;
    r = { formule: `${s.nom} (${s.valeur} ${txtSigne(p.base + p.modif)})`, faces, des: [s.valeur], gardes: [0], mod: p.base + p.modif, total,
      comp: p.seuil != null ? '>=' : null, seuil: p.seuil, reussite: p.seuil != null ? total >= p.seuil : null, libelle, mention: s.mention || '' };
  } else r = jetD20(mod, { base: p.base, modif: p.modif, de: p.de, valeurs, seuil: p.seuil, attaque: !!A.quoi?.derivee, libelle });
  A.oppose = '';
  if (A.contre.type === 'oppose') {
    const c = A.contre;
    let adv;
    if (c.resultat != null) adv = { total: c.resultat, txt: `résultat ${c.resultat}` };
    else if (c.fixe) adv = { total: 10 + (c.bonus || 0), txt: `10 ${txtSigne(c.bonus || 0)} = ${10 + (c.bonus || 0)}` };
    else { const j = calculerJet({ faces, n: 1, mod: c.bonus || 0 }); adv = { total: j.total, txt: `d${faces} = ${j.des[0]} ${txtSigne(c.bonus || 0)} = ${j.total}` }; }
    r.seuil = adv.total; r.comp = '>=';
    const tot = r.total;
    if (r.critique) r.reussite = true;
    else if (r.echecCritique) r.reussite = false;
    else if (tot === adv.total) { r.reussite = null; r.mention = [r.mention, T_EGALITE].filter(Boolean).join(' · '); }
    else r.reussite = tot > adv.total;
    if (r.reussite === null) { r.seuil = null; r.comp = null; }
    r.libelle += ` contre ${c.nom || 'adversaire'} (${adv.txt})`;
    A.oppose = `${c.nom || 'Adversaire'} : ${adv.txt}.`;
  }
  const e = await noter({ type: 'jet', physique: !!valeurs, ...r });
  etat.dernier.jet = { ...r, physique: !!valeurs, origine: 'fiche:' + f.id, arme: null, id: e.id };
  A.res = e.id; A.resObj = etat.dernier.jet;
  rendre();
}
const T_EGALITE = 'Égalité : on relance pour départager';

/* ======================================================================
   Combat
   ====================================================================== */
function combatCfg(mod) {
  return { titre: 'Combat', adversaire: {}, options: [], etats: [], dmMin: 1, ...(reglesMod(mod)?.combat || {}) };
}
function participant(cb, id) { return cb.participants.find(p => p.id === id) || null; }
function ficheDe(p) { return p.fiche ? ficheParId(p.fiche) : null; }
function nomPart(mod, p) { const f = ficheDe(p); return f ? nomFiche(f, defFiche(mod, f.type)) : p.nom; }

function pvPart(mod, p) {
  if (p.camp === 'adv') return p.pv;
  const f = ficheDe(p);
  const x = f ? refFiche(mod, f, 'pv') : null;
  return x ? f.jauges[x.id] || { act: 0, max: 0 } : null;
}
function defPart(mod, p) { if (p.camp === 'adv') return p.def ?? 10; const f = ficheDe(p); return f ? valeurFiche(mod, f, 'defense') : 10; }
function niveauPart(p) {
  if (p.camp !== 'adv') return ficheDe(p)?.niveau ?? 0;
  try { return evaluerFormule(String(p.niveau || '0').replace(',', '.'), {}) || 0; } catch { return 0; }
}
function actifPart(mod, p) { if (p.retire) return false; const pv = pvPart(mod, p); return !pv || pv.max <= 0 || pv.act > 0; }

/* États d'un participant : choisis + automatiques (seuil de PV) */
function etatsParticipant(mod, cb, p) {
  const l = [...(p.etats || [])];
  const pv = pvPart(mod, p);
  for (const a of combatCfg(mod).etatAuto || []) {
    if (pv && pv.max > 0 && pv.act > 0 && pv.act <= a.pv && !l.includes(a.etat)) l.push(a.etat);
  }
  return l;
}
function postures(cb, p) { return (cb.effets || []).filter(e => e.porteur === p.id); }

function calculerOrdre(mod, cb) {
  const ix = new Map(cb.participants.map((p, i) => [p.id, i]));
  return [...cb.participants].sort((a, b) => (b.init - a.init) || (niveauPart(b) - niveauPart(a)) || ((a.camp === 'pj' ? 0 : 1) - (b.camp === 'pj' ? 0 : 1)) || (ix.get(a.id) - ix.get(b.id))).map(p => p.id);
}

function nouveauCombat() {
  return { phase: 'prep', round: 0, tour: 0, ordre: [], participants: [], effets: [], action: null, debut: maintenant() };
}

function initialiserPJ(mod, cb) {
  const pris = new Set(cb.participants.map(p => p.fiche).filter(Boolean));
  for (const f of etat.partie.fiches || []) {
    if (pris.has(f.id) || !refFiche(mod, f, 'pv')) continue;
    if (f.role === 'principal' || f.role === 'secondaire') cb.participants.push({ id: nouvelId(), camp: 'pj', fiche: f.id, etats: [] });
  }
}

/* « Épée longue +4 DM 1d8+2 » ; « Morsure +5 · DM 1d6+2 + paralysie » ; « Arc (30 m) +2 DM 1d6 » */
function lireAttaques(txt) {
  return String(txt || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(.*?)\s*([+\-−]\s*\d+)\s*[·,:]?\s*(?:DM|dommages?)?\s*[:·]?\s*(.*)$/i);
    if (!m) return { nom: l, bonus: 0, dm: '1' };
    return { nom: m[1].trim() || 'Attaque', bonus: Number(m[2].replace(/\s/g, '').replace('−', '-')), dm: m[3].trim() || '1' };
  });
}
const texteAttaque = a => `${a.nom} ${txtSigne(a.bonus)} · DM ${a.dm}`;
const estDistance = (mod, nom) => /\(\s*\d+\s*m\s*\)|distance|arc|arbal[eè]te|fronde|jet/i.test(nom || '') || (combatCfg(mod).distance || []).some(r => normRef(nom).includes(normRef(r)));

function vueCombat(mod) {
  const cb = etat.partie.combat;
  const C = combatCfg(mod);
  if (cb.phase === 'prep') return vuePreparation(mod, cb, C);
  if (cb.action) return vueAction(mod, cb, C);
  const courant = participant(cb, cb.ordre[cb.tour]);
  const vivantsAdv = cb.participants.filter(p => p.camp === 'adv' && actifPart(mod, p));
  let html = `<div class="rangee entete-fiche"><button class="lien" data-action="rg-hub">‹ Règles</button>
    <span class="petit" style="text-align:center"><strong>Round ${cb.round}</strong></span>
    <button class="lien danger" style="text-align:right" data-action="rg-c-fin">Fin du combat</button></div>`;
  if (!vivantsAdv.length) html += `<div class="carte"><p class="force">Plus aucun adversaire debout.</p><button class="principal" data-action="rg-c-fin">Terminer le combat</button></div>`;
  if (courant) {
    const f = ficheDe(courant);
    const etats = etatsParticipant(mod, cb, courant);
    const bloquants = etats.filter(e => etatDef(mod, e).aucuneAction);
    html += `<div class="carte tour-courant">
      <div class="discret petit">Tour de</div>
      <div class="titre grand">${esc(nomPart(mod, courant))}</div>
      ${etats.length ? `<p class="petit">${etats.map(e => `<span class="etiquette etat">${esc(e)}</span>`).join(' ')}</p>` : ''}
      ${bloquants.length ? `<p class="force petit">${bloquants.map(e => `${esc(e)} : ${esc(etatDef(mod, e).texte || 'aucune action')}`).join('<br>')}</p>` : ''}
      ${C.actions ? `<p class="discret petit">${enrichir(C.actions)}</p>` : ''}
      <div class="pile">
        <button class="principal" data-action="rg-c-attaque">Attaquer</button>
        ${f && mod.test?.mode === 'bonus' ? `<button data-action="rg-c-test">Faire un test</button>` : ''}
        ${(C.options || []).filter(o => o.defense).map(o => `<button data-action="rg-c-posture" data-id="${esc(o.id)}">${esc(o.nom)} <small class="discret">${txtSigne(o.defense)} DEF jusqu'à son prochain tour${o.action ? ' · ' + esc(o.action) : ''}</small></button>`).join('')}
      </div>
      <div class="rangee" style="margin-top:10px">
        <button data-action="rg-c-retarder">Retarder son tour</button>
        <button class="principal" style="flex:1.4" data-action="rg-c-suivant">Tour suivant ›</button>
      </div>
    </div>`;
  }
  html += `<div class="carte"><h2>Ordre d'initiative</h2><ul class="ordre">${cb.ordre.map((id, i) => {
    const p = participant(cb, id);
    if (!p) return '';
    const pv = pvPart(mod, p);
    const ouvert = etat.partOuvert === p.id;
    const post = postures(cb, p);
    const et = etatsParticipant(mod, cb, p);
    return `<li class="${i === cb.tour ? 'courant' : ''} ${actifPart(mod, p) ? '' : 'hors'} ${p.camp}">
      <button class="ligne-part" data-action="rg-c-part" data-id="${esc(p.id)}">
        <span class="n">${p.init}</span>
        <span class="nom">${esc(nomPart(mod, p))}${et.length || post.length ? `<small class="discret"> · ${[...et, ...post.map(x => x.nom)].map(esc).join(', ')}</small>` : ''}</span>
        <span class="pv">${pv ? `${pv.act}/${pv.max}` : ''}</span>
        <span class="def discret petit">DEF ${defPart(mod, p) + bonusDefense(mod, cb, p).total}</span>
      </button>
      ${ouvert ? vueDetailPart(mod, cb, p) : ''}
    </li>`;
  }).join('')}</ul>
  <p class="discret petit">Touche un participant pour ses PV, ses états et ses notes. Les PJ se modifient aussi depuis leur fiche.</p>
  <button class="lien" data-action="rg-c-ajout-adv">+ Ajouter un adversaire en cours de combat</button></div>`;
  if (etat.ajoutAdv) html += vueFormAdversaire(mod, cb, C);
  return html;
}

function vueDetailPart(mod, cb, p) {
  const C = combatCfg(mod);
  const et = p.etats || [];
  return `<div class="detail-part">
    ${p.camp === 'adv' ? `<p class="petit">${C.adversaire.niveau ? esc(C.adversaire.niveau) + ' ' + esc(p.niveau ?? '–') + ' · ' : ''}DEF ${p.def} · PV ${p.pv.act}/${p.pv.max}${p.rd ? ' · ' + esc(C.adversaire.rd || 'RD') + ' ' + p.rd : ''}</p>
      ${(p.attaques || []).map(a => `<div class="petit">${esc(texteAttaque(a))}</div>`).join('')}
      ${p.notes ? `<div class="prose petit discret">${esc(p.notes)}</div>` : ''}` : ''}
    <div class="rangee" style="margin-top:8px"><input type="number" inputmode="numeric" id="rg-dd-${esc(p.id)}" placeholder="points">
      <button data-action="rg-c-dm-direct" data-id="${esc(p.id)}">DM directs</button><button data-action="rg-c-soin" data-id="${esc(p.id)}">Soins</button></div>
    ${etatsDef(mod).length ? `<h3>États</h3><div class="puces">${etatsDef(mod).map(e => `<button class="puce ${et.includes(e.nom) ? 'choisie' : ''}" data-action="rg-c-etat" data-id="${esc(p.id)}" data-n="${esc(e.nom)}" title="${esc(e.texte || '')}">${esc(e.nom)}</button>`).join('')}</div>` : ''}
    <div class="rangee" style="margin-top:8px">
      ${p.camp === 'pj' ? `<button class="lien" data-action="jeu-ouvrir" data-id="${esc(p.fiche)}">Ouvrir la fiche</button>` : ''}
      <button class="lien" data-action="rg-c-init" data-id="${esc(p.id)}">Changer l'initiative</button>
      <button class="lien danger" data-action="rg-c-retirer" data-id="${esc(p.id)}">${p.retire ? 'Remettre' : 'Retirer'}</button>
    </div>
  </div>`;
}

/* Bonus de DEF : postures + états */
function bonusDefense(mod, cb, p) {
  const lignes = [];
  let total = 0;
  for (const e of postures(cb, p)) { total += e.defense; lignes.push({ cle: 'post:' + e.nom, texte: `${e.nom} ${txtSigne(e.defense)}`, v: e.defense }); }
  for (const n of etatsParticipant(mod, cb, p)) { const d = etatDef(mod, n); if (d.defense) { total += d.defense; lignes.push({ cle: 'etat:' + n, texte: `${n} ${txtSigne(d.defense)}`, v: d.defense }); } }
  return { total, lignes };
}

function vuePreparation(mod, cb, C) {
  const pj = cb.participants.filter(p => p.camp === 'pj');
  const adv = cb.participants.filter(p => p.camp === 'adv');
  const libres = (etat.partie.fiches || []).filter(f => refFiche(mod, f, 'pv') && !pj.some(p => p.fiche === f.id));
  let html = `<div class="rangee entete-fiche"><button class="lien" data-action="rg-hub">‹ Règles</button>
    <button class="lien danger" style="text-align:right" data-action="rg-c-annuler">Annuler</button></div>
    <div class="carte"><h2>Préparer le combat</h2>
    <h3>Personnages</h3>
    ${pj.length ? `<ul class="liste-simple">${pj.map(p => { const f = ficheDe(p); return `<li class="rangee"><span>${esc(nomPart(mod, p))} <small class="discret">Init. ${f ? valeurFiche(mod, f, 'init') : '?'} · DEF ${defPart(mod, p)}</small>${(p.etats || []).length ? ' · ' + p.etats.map(esc).join(', ') : ''}</span>
      <button class="lien" style="flex:0 0 auto" data-action="rg-c-surpris" data-id="${esc(p.id)}">${(p.etats || []).includes(C.surpris || 'Surpris') ? 'Pas surpris' : (C.surpris || 'Surpris')}</button>
      <button class="lien danger" style="flex:0 0 auto" data-action="rg-c-suppr" data-id="${esc(p.id)}">✕</button></li>`; }).join('')}</ul>` : '<p class="discret petit">Aucun personnage.</p>'}
    ${libres.length ? `<div class="puces">${libres.map(f => `<button class="puce" data-action="rg-c-pj" data-id="${esc(f.id)}">+ ${esc(nomFiche(f, defFiche(mod, f.type)))}</button>`).join('')}</div>` : ''}
    <h3>Adversaires</h3>
    ${adv.length ? `<ul class="liste-simple">${adv.map(p => `<li class="rangee"><span><strong>${esc(p.nom)}</strong> <small class="discret">DEF ${p.def} · PV ${p.pv.max} · Init. ${p.init}${p.rd ? ' · RD ' + p.rd : ''}</small>${(p.etats || []).length ? ' · ' + p.etats.map(esc).join(', ') : ''}
      <div class="petit discret">${(p.attaques || []).map(a => esc(texteAttaque(a))).join(' ; ')}</div></span>
      <button class="lien" style="flex:0 0 auto" data-action="rg-c-surpris" data-id="${esc(p.id)}">${(p.etats || []).includes(C.surpris || 'Surpris') ? 'Pas surpris' : (C.surpris || 'Surpris')}</button>
      <button class="lien danger" style="flex:0 0 auto" data-action="rg-c-suppr" data-id="${esc(p.id)}">✕</button></li>`).join('')}</ul>` : '<p class="discret petit">Aucun adversaire pour l’instant.</p>'}
  </div>`;
  html += vueFormAdversaire(mod, cb, C);
  html += `<div class="carte">
    ${C.initiativeAide ? `<p class="discret petit">${enrichir(C.initiativeAide)}</p>` : ''}
    <button class="principal" data-action="rg-c-commencer" ${pj.length && adv.length ? '' : 'disabled'}>Commencer : ordre d'initiative</button>
    ${pj.length && adv.length ? '' : '<p class="discret petit">Il faut au moins un personnage et un adversaire.</p>'}
  </div>`;
  return html;
}

function vueFormAdversaire(mod, cb, C) {
  const A = C.adversaire || {};
  const best = etat.partie.bestiaire || [];
  const fa = etat.formAdv || {};
  return `<div class="carte" id="form-adv"><h2>Fiche rapide d'adversaire</h2>
    ${best.length ? `<details class="de-physique" data-garde="rg-best"><summary>Reprendre un adversaire déjà rencontré (${best.length})</summary>
      <div class="pile">${best.map((b, i) => `<div class="rangee serree favori"><button data-action="rg-c-best" data-i="${i}">${esc(b.nom)}<small class="discret"> DEF ${b.def} · PV ${b.pv}</small></button><button class="lien danger" data-action="rg-c-best-suppr" data-i="${i}" aria-label="Oublier">✕</button></div>`).join('')}</div></details>` : ''}
    <div class="rangee"><input type="text" id="ra-nom" placeholder="Nom (ex. Gobelin)" value="${esc(fa.nom || '')}" style="flex:2"><input type="number" inputmode="numeric" id="ra-nb" placeholder="Nombre" value="${esc(fa.nb || '')}" title="Nombre d'exemplaires"></div>
    <div class="grille-edition">
      <label><span>${esc(A.niveau || 'Niveau')}</span><input type="text" id="ra-niv" value="${esc(fa.niveau ?? '')}"></label>
      <label><span>${esc(A.defense || 'DEF')}</span><input type="number" inputmode="numeric" id="ra-def" value="${esc(fa.def ?? '')}"></label>
      <label><span>${esc(A.pv || 'PV')}</span><input type="number" inputmode="numeric" id="ra-pv" value="${esc(fa.pv ?? '')}"></label>
      <label><span>${esc(A.init || 'Init.')}</span><input type="number" inputmode="numeric" id="ra-init" value="${esc(fa.init ?? '')}"></label>
      ${A.rd !== false ? `<label><span>${esc(A.rd || 'RD')}</span><input type="number" inputmode="numeric" id="ra-rd" value="${esc(fa.rd ?? '')}"></label>` : ''}
    </div>
    <h3>Attaques <small class="discret">(une par ligne)</small></h3>
    <textarea id="ra-att" rows="2" placeholder="${esc(A.exemple || 'Épée longue +4 DM 1d8+2')}">${esc(fa.attaques || '')}</textarea>
    <textarea id="ra-notes" rows="2" placeholder="Capacités, notes (page du livre…)">${esc(fa.notes || '')}</textarea>
    <label class="case petit"><input type="checkbox" id="ra-garder" checked> Garder dans les adversaires de la partie</label>
    <button data-action="rg-c-adv-ok">Ajouter au combat</button>
    ${A.aide ? `<p class="discret petit">${enrichir(A.aide)}</p>` : ''}
  </div>`;
}

function lireFormAdversaire() {
  const num = id => { const v = $('#' + id)?.value.trim(); return v === '' || v == null ? null : Number(v.replace('−', '-')); };
  return { nom: $('#ra-nom')?.value.trim() || '', nb: num('ra-nb'), niveau: $('#ra-niv')?.value.trim() || '', def: num('ra-def'), pv: num('ra-pv'), init: num('ra-init'), rd: num('ra-rd'),
    attaques: $('#ra-att')?.value || '', notes: $('#ra-notes')?.value.trim() || '', garder: !!$('#ra-garder')?.checked };
}

async function ajouterAdversaires(mod, cb) {
  const fa = lireFormAdversaire();
  etat.formAdv = fa;
  if (!fa.nom) return toast('Donne un nom à l’adversaire');
  if (fa.def == null || fa.pv == null) return toast('Défense et PV sont nécessaires');
  const nb = Math.max(1, Math.min(20, fa.nb || 1));
  const att = lireAttaques(fa.attaques);
  const nouveaux = [];
  for (let k = 1; k <= nb; k++) {
    nouveaux.push({ id: nouvelId(), camp: 'adv', nom: nb > 1 ? `${fa.nom} ${k}` : fa.nom, niveau: fa.niveau, def: fa.def, pv: { act: fa.pv, max: fa.pv },
      init: fa.init ?? 10, initBase: fa.init ?? 10, rd: fa.rd || 0, attaques: att, notes: fa.notes, etats: [] });
  }
  cb.participants.push(...nouveaux);
  if (fa.garder) {
    const b = etat.partie.bestiaire || (etat.partie.bestiaire = []);
    const modele = { nom: fa.nom, niveau: fa.niveau, def: fa.def, pv: fa.pv, init: fa.init ?? 10, rd: fa.rd || 0, attaques: fa.attaques, notes: fa.notes };
    const i = b.findIndex(x => x.nom === fa.nom);
    if (i >= 0) b[i] = modele; else b.push(modele);
  }
  if (cb.phase === 'jeu') {
    for (const p of nouveaux) {
      // Insère à sa place d'initiative sans bouleverser le round en cours
      const courantId = cb.ordre[cb.tour];
      cb.ordre = calculerOrdre(mod, cb);
      cb.tour = Math.max(0, cb.ordre.indexOf(courantId));
      await noter({ type: 'combat', texte: `${p.nom} entre dans le combat (Init. ${p.init}, DEF ${p.def}, PV ${p.pv.max})` });
    }
    etat.ajoutAdv = false;
  }
  etat.formAdv = null;
  await sauverPartie();
  rendre();
}

async function commencerCombat(mod, cb) {
  const C = combatCfg(mod);
  const lignes = [];
  for (const p of cb.participants) {
    if (p.camp === 'pj') {
      const f = ficheDe(p);
      const base = f ? valeurFiche(mod, f, 'init') : 10;
      if (C.initiative?.jet) { const x = lancerExpression(remplirModele(C.initiative.jet, { init: base }), {}); p.init = x.total; lignes.push(`${nomPart(mod, p)} ${x.formule} = ${x.total}`); }
      else p.init = base;
    } else if (C.initiative?.jet) { const x = lancerExpression(remplirModele(C.initiative.jet, { init: p.initBase ?? p.init }), {}); p.init = x.total; }
  }
  cb.phase = 'jeu'; cb.round = 1; cb.tour = 0;
  cb.ordre = calculerOrdre(mod, cb);
  await sauverPartie();
  await noter({ type: 'combat', texte: `Combat — round 1. Ordre : ${cb.ordre.map(id => { const p = participant(cb, id); return `${nomPart(mod, p)} (${p.init})`; }).join(', ')}` });
  if (!actifPart(mod, participant(cb, cb.ordre[0]))) await tourSuivant(mod, cb, true);
  rendre();
  window.scrollTo(0, 0);
}

async function tourSuivant(mod, cb, silencieux) {
  const C = combatCfg(mod);
  const n = cb.ordre.length;
  if (!n) return;
  let i = cb.tour;
  for (let k = 0; k < n + 1; k++) {
    i++;
    if (i >= n) {
      i = 0;
      cb.round++;
      // Retarder son tour ne dure qu'un round ; les états « premier round » (surprise) se terminent
      cb.ordre = calculerOrdre(mod, cb);
      const finis = [];
      for (const p of cb.participants) {
        const avant = p.etats || [];
        p.etats = avant.filter(e => !(etatDef(mod, e).premierRound && cb.round > 1));
        if (p.etats.length !== avant.length) finis.push(nomPart(mod, p));
      }
      await noter({ type: 'combat', texte: `Round ${cb.round}${finis.length ? ` (fin de la surprise : ${finis.join(', ')})` : ''}` });
    }
    if (actifPart(mod, participant(cb, cb.ordre[i]))) break;
  }
  cb.tour = i;
  const p = participant(cb, cb.ordre[i]);
  // Les postures durent jusqu'au prochain tour de celui qui les a prises
  const exp = (cb.effets || []).filter(e => e.porteur === p.id && cb.round > e.round);
  if (exp.length) cb.effets = cb.effets.filter(e => !exp.includes(e));
  etat.partOuvert = null;
  await sauverPartie();
  if (!silencieux) rendre();
  window.scrollTo(0, 0);
}

async function finCombat(mod, cb) {
  if (!confirm('Terminer le combat ?')) return;
  const vaincus = cb.participants.filter(p => p.camp === 'adv' && !actifPart(mod, p) && !p.retire).map(p => p.nom);
  const debout = cb.participants.filter(p => p.camp === 'adv' && actifPart(mod, p)).map(p => p.nom);
  const pj = cb.participants.filter(p => p.camp === 'pj').map(p => { const pv = pvPart(mod, p); return `${nomPart(mod, p)}${pv ? ` ${pv.act}/${pv.max}` : ''}`; });
  if (cb.phase === 'jeu') await noter({ type: 'combat', texte: `Fin du combat après ${cb.round} round${cb.round > 1 ? 's' : ''}${vaincus.length ? ` — hors de combat : ${vaincus.join(', ')}` : ''}${debout.length ? ` — encore debout : ${debout.join(', ')}` : ''}${pj.length ? ` — ${pj.join(', ')}` : ''}` });
  delete etat.partie.combat;
  etat.reglesVue = 'hub';
  await sauverPartie();
  const fin = combatCfg(mod).finAide;
  if (fin) toast(fin);
  rendre();
}

/* ---------- Action d'attaque pas à pas ---------- */
function attaquesDe(mod, p) {
  if (p.camp === 'adv') return (p.attaques || []).map((a, i) => ({ i, nom: a.nom, bonus: a.bonus, dm: a.dm, distance: estDistance(mod, a.nom) }));
  const f = ficheDe(p);
  if (!f) return [];
  const def = defFiche(mod, f.type);
  const ctx = contexteFiche(mod, f, def);
  const l = (f.armes || []).map((a, i) => {
    const d = def.derivees?.find(x => x.id === a.attaque);
    // « critique 19-20 » dans les notes de l'arme
    const mc = String(a.notes || '').match(/critique\s*(?:sur\s*)?(\d+)\s*[-–à]\s*20/i);
    return { i, nom: a.nom, bonus: d ? ctx[d.id] : 0, derivee: a.attaque, dm: a.dm, critique: a.critique || (mc ? Number(mc[1]) : null), notes: a.notes, distance: estDistance(mod, d?.nom || '') || estDistance(mod, a.nom) };
  });
  // Attaques sans arme (sorts…) : les valeurs d'attaque de la fiche
  for (const d of (def.derivees || []).filter(x => x.test)) l.push({ i: 'd:' + d.id, nom: d.nom, bonus: ctx[d.id], derivee: d.id, dm: '', distance: estDistance(mod, d.nom), sansArme: true });
  return l;
}

function demarrerAttaque(mod, cb) {
  const p = participant(cb, cb.ordre[cb.tour]);
  const att = attaquesDe(mod, p);
  const cibles = cb.participants.filter(x => x.camp !== p.camp && actifPart(mod, x));
  cb.action = { type: 'attaque', etape: 'choix', attaquant: p.id, attaque: att[0]?.i ?? null, cible: cibles[0]?.id ?? null, option: null, modif: 0, de: [], ignorer: [], critSeuil: null };
}

function parametresAttaque(mod, cb) {
  const A = cb.action;
  const C = combatCfg(mod);
  const t = mod.test || {};
  const p = participant(cb, A.attaquant);
  const c = participant(cb, A.cible);
  const att = attaquesDe(mod, p).find(x => String(x.i) === String(A.attaque)) || null;
  const opt = (C.options || []).find(o => o.id === A.option) || null;
  const lignes = [];   // { cle, texte, v (attaque), de, auto }
  let modif = A.modif;
  const sources = [...A.de];
  if (opt?.attaque) lignes.push({ cle: 'opt', texte: `${opt.nom} ${txtSigne(opt.attaque)}`, v: opt.attaque });
  if (opt?.de) lignes.push({ cle: 'opt-de', texte: `${opt.nom} : ${opt.de === 'bonus' ? 'dé bonus' : 'dé malus'}`, de: opt.de });
  for (const n of etatsParticipant(mod, cb, p)) {
    const d = etatDef(mod, n);
    if (d.attaque) lignes.push({ cle: 'etat:' + n, texte: `${n} ${txtSigne(d.attaque)}`, v: d.attaque, auto: true });
    if (d.distance && att?.distance) lignes.push({ cle: 'etatd:' + n, texte: `${n} (à distance) ${txtSigne(d.distance)}`, v: d.distance, auto: true });
    if (d.deAttaque || d.deTests) lignes.push({ cle: 'etatde:' + n, texte: `${n} : ${(d.deAttaque || d.deTests) === 'bonus' ? 'dé bonus' : 'dé malus'}`, de: d.deAttaque || d.deTests, auto: true });
  }
  let autoTouche = false, critSubi = false;
  if (c) for (const n of etatsParticipant(mod, cb, c)) {
    const d = etatDef(mod, n);
    if (d.autoTouche) { autoTouche = true; lignes.push({ cle: 'cible:' + n, texte: `Cible ${n.toLowerCase()} : touchée automatiquement${d.critiqueSubi ? ', critique' : ''}`, auto: true, flag: true }); if (d.critiqueSubi) critSubi = true; }
  }
  const actives = lignes.filter(l => !A.ignorer.includes(l.cle));
  for (const l of actives) { if (l.v) modif += l.v; if (l.de) sources.push(l.de); }
  if (actives.every(l => !l.flag)) { autoTouche = false; critSubi = false; }
  const de = resoudreDe(sources);
  const bd = c ? bonusDefense(mod, cb, c) : { total: 0, lignes: [] };
  const bdActifs = bd.lignes.filter(l => !A.ignorer.includes(l.cle));
  const defBase = c ? defPart(mod, c) : 10;
  const defense = defBase + bdActifs.reduce((s, l) => s + l.v, 0);
  const critMin = C.critiqueMin || 1;
  const critSeuil = Math.max(critMin, A.critSeuil || att?.critique || t.critique || t.de || 20);
  return { p, c, att, opt, lignes, de, modif, base: att?.bonus || 0, defBase, defense, bd, autoTouche, critSubi, critSeuil };
}

function vueAction(mod, cb, C) {
  const A = cb.action;
  if (A.type !== 'attaque') { cb.action = null; return vueCombat(mod); }
  const P = parametresAttaque(mod, cb);
  const t = mod.test || {};
  const { p, c, att } = P;
  const cibles = cb.participants.filter(x => x.id !== p.id && actifPart(mod, x));
  const etapes = ['Choix', 'Jet d’attaque', 'Dommages'];
  const ie = A.etape === 'choix' ? 0 : A.etape === 'jet' ? 1 : 2;
  let html = `<div class="rangee entete-fiche"><button class="lien" data-action="rg-a-annuler">‹ ${A.etape === 'choix' || !A.res ? 'Annuler' : 'Combat'}</button>
    <span class="petit" style="text-align:right">Round ${cb.round}</span></div>
    <div class="carte assistant">
    <div class="etapes-assist">${etapes.map((e, i) => `<span class="${i === ie ? 'courante' : i < ie ? 'faite' : ''}">${i + 1}. ${e}</span>`).join('')}</div>
    <h2>${esc(nomPart(mod, p))} attaque</h2>`;
  if (A.etape === 'choix') {
    const att2 = attaquesDe(mod, p);
    html += `<h3>Avec</h3>${att2.length ? `<div class="pile">${att2.map(a => `<button class="${String(a.i) === String(A.attaque) ? 'choisi' : ''}" data-action="rg-a-att" data-i="${esc(a.i)}">${esc(a.nom)} <small class="discret">${txtSigne(a.bonus)}${a.dm ? ' · DM ' + esc(a.dm) : ''}${a.distance ? ' · distance' : ''}</small></button>`).join('')}</div>`
      : `<p class="force petit">Aucune attaque. ${p.camp === 'pj' ? 'Ajoute une arme dans la fiche.' : 'Ajoute une attaque à cet adversaire.'}</p>`}
      <h3>Cible</h3>${cibles.length ? `<div class="puces">${cibles.map(x => `<button class="puce ${x.id === A.cible ? 'choisie' : ''}" data-action="rg-a-cible" data-id="${esc(x.id)}">${esc(nomPart(mod, x))} <small>DEF ${defPart(mod, x) + bonusDefense(mod, cb, x).total}</small></button>`).join('')}</div>` : '<p class="discret petit">Aucune cible debout.</p>'}
      ${(C.options || []).filter(o => !o.defense).length ? `<h3>Option tactique</h3><div class="pile">
        <button class="${!A.option ? 'choisi' : ''}" data-action="rg-a-opt" data-id="">Attaque normale</button>
        ${C.options.filter(o => !o.defense).map(o => `<button class="${A.option === o.id ? 'choisi' : ''}" data-action="rg-a-opt" data-id="${esc(o.id)}">${esc(o.nom)} <small class="discret">${[o.attaque ? txtSigne(o.attaque) + ' att.' : '', o.de ? (o.de === 'bonus' ? 'dé bonus' : 'dé malus') : '', o.dmPlus ? '+' + esc(o.dmPlus) + ' DM' : '', o.dmDiv ? 'DM ÷ ' + o.dmDiv : '', o.action || ''].filter(Boolean).join(' · ')}${o.aide ? ' — ' + esc(o.aide) : ''}</small></button>`).join('')}</div>` : ''}
      <div class="rangee" style="margin-top:12px"><button class="lien" data-action="rg-a-annuler">Annuler</button><button class="principal" style="flex:2" data-action="rg-a-suite" ${att && c ? '' : 'disabled'}>Continuer</button></div>`;
    return html + '</div>';
  }
  // Récapitulatif commun aux étapes jet et dommages
  const recap = `<p class="petit">${esc(att?.nom || '?')} contre <strong>${esc(c ? nomPart(mod, c) : '?')}</strong></p>`;
  if (A.etape === 'jet') {
    html += recap;
    if (!A.res) {
      html += `<ul class="liste-simple petit">
        <li>${esc(p.camp === 'pj' ? 'Valeur d’attaque' : 'Bonus d’attaque')} : ${txtSigne(P.base)}</li>
        ${P.lignes.map(l => `<li><label class="case" data-action="rg-a-ign" data-cle="${esc(l.cle)}"><input type="checkbox" ${A.ignorer.includes(l.cle) ? '' : 'checked'}> ${esc(l.texte)}</label></li>`).join('')}
        <li>Défense de la cible : ${P.defBase}${P.bd.lignes.map(l => ` <label class="case" style="display:inline-flex" data-action="rg-a-ign" data-cle="${esc(l.cle)}"><input type="checkbox" ${A.ignorer.includes(l.cle) ? '' : 'checked'}> ${esc(l.texte)}</label>`).join('')} → <strong>${P.defense}</strong></li>
      </ul>
      <div class="puces">${[['bonus', t.libelleBonus || 'Dé bonus'], ['malus', t.libelleMalus || 'Dé malus']].map(([k, l]) => `<button class="puce ${A.de.includes(k) ? 'choisie' : ''}" data-action="rg-a-de" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="rangee reglages-test">
        <div class="stepper"><span class="discret petit">Autre modificateur</span><div class="rangee serree"><button data-action="rg-a-modif" data-v="-1">−</button><output>${txtSigne(A.modif)}</output><button data-action="rg-a-modif" data-v="1">+</button></div></div>
        <div class="stepper"><span class="discret petit">Critique dès</span><div class="rangee serree"><button data-action="rg-a-crit" data-v="-1">−</button><output>${P.critSeuil}</output><button data-action="rg-a-crit" data-v="1">+</button></div></div>
      </div>
      <p class="petit"><strong>d${t.de || 20}${P.de !== 'normal' ? ` (${P.de === 'bonus' ? 'dé bonus' : 'dé malus'})` : ''} ${txtSigne(P.base + P.modif)} contre DEF ${P.defense}</strong></p>
      ${P.autoTouche ? `<button class="principal" data-action="rg-a-auto">Touche automatique</button>` : `<button class="principal" data-action="rg-a-lancer">Lancer l'attaque</button>${champsDesPhysiques('rg-a-phys', P.de === 'normal' ? 1 : 2, t.de || 20)}`}`;
    } else {
      const r = A.res;
      html += r.auto ? `<div class="resultat"><div class="meta">${esc(r.libelle)}</div><div class="reponse oui">Touché</div><div class="meta mention"><strong>${esc(r.mention)}</strong></div></div>`
        : rendreResultatJet({ ...r, sansForcage: true });
      const pc = p.camp === 'pj' ? chanceDispo(mod, ficheDe(p)) : null;
      html += `<div class="pile" style="margin-top:10px">
        ${r.reussite ? `<button class="principal" data-action="rg-a-vers-dm">Dommages${r.critique && !C.critiqueSansDouble ? ' ×' + (C.multCritique || 2) + ' (critique)' : ''} ›</button>` : ''}
        ${!r.reussite && pc ? `<button data-action="rg-a-chance">Dépenser 1 ${esc(pc.abr)} : +${pc.bonus} <small class="discret">(reste ${pc.reste})</small></button>` : ''}
        ${!r.reussite ? `<button class="principal" data-action="rg-a-terminer">Attaque ratée : terminer</button>` : ''}
        <div class="rangee"><button class="lien" data-action="rg-a-forcer" data-v="${r.reussite ? 0 : 1}">Forcer : ${r.reussite ? 'ratée' : 'touchée'}</button>
          ${r.critique ? '' : `<button class="lien" data-action="rg-a-forcer" data-v="2">Forcer : critique</button>`}</div>
      </div>`;
    }
    return html + '</div>';
  }
  /* Dommages */
  html += recap;
  const D = A.dm || {};
  const crit = A.res?.critique && !C.critiqueSansDouble;
  const baseExpr = att?.dm || '';
  const f = p.camp === 'pj' ? ficheDe(p) : null;
  const ctx = ctxFiche(mod, f);
  if (!D.fait) {
    const rd = c?.camp === 'adv' ? c.rd || 0 : 0;
    html += `<ul class="liste-simple petit">
      <li>Dommages : <strong>${esc(baseExpr ? texteExpression(exprEvo(baseExpr, mod, f), ctx) : '—')}</strong>${crit ? ` × ${C.multCritique || 2} (critique, bonus compris)` : ''}</li>
      ${P.opt?.dmPlus ? `<li>${esc(P.opt.nom)} : +${esc(texteExpression(exprEvo(P.opt.dmPlus, mod, f), ctx))}${crit ? ' (non doublés)' : ''}</li>` : ''}
      ${P.opt?.dmDiv ? `<li>${esc(P.opt.nom)} : DM ÷ ${P.opt.dmDiv}</li>` : ''}
      ${rd ? `<li>${esc(C.adversaire.rd || 'RD')} de la cible : −${rd} (au moins ${C.dmMin ?? 1} DM)</li>` : ''}
    </ul>
    ${!baseExpr ? `<div class="rangee"><input type="text" id="rg-dm-base" placeholder="DM (ex. 1d6+INT)" value="${esc(D.base || '')}"></div>` : ''}
    <div class="rangee" style="margin-top:8px"><input type="text" id="rg-dm-plus" placeholder="DM en plus, non doublés (ex. 2d4°, +2)" value="${esc(D.plus || '')}"></div>
    <label class="case petit"><input type="checkbox" id="rg-dm-resist" ${D.resist ? 'checked' : ''}> ${esc(C.resistance || 'La cible résiste à ce type de DM (÷ 2)')}</label>
    <button class="principal" data-action="rg-a-dm">Lancer les dommages</button>
    <details class="de-physique" data-garde="rg-dm-phys"><summary>Avec mes dés : total des dés de l'arme (sans les bonus fixes)</summary>
      <div class="rangee"><input type="number" inputmode="numeric" id="rg-dm-phys" placeholder="total des dés"><button data-action="rg-a-dm">Valider</button></div></details>`;
  } else {
    html += `<div class="resultat gauche">
      ${D.lignes.map(l => `<div class="petit">${esc(l)}</div>`).join('')}
      <div class="reponse">${D.final}</div>
      <div class="meta">DM ${D.force != null ? '(forcés) ' : ''}infligés à ${esc(c ? nomPart(mod, c) : '?')}${D.applique ? ' — appliqués' : ''}</div>
    </div>`;
    if (!D.applique) {
      html += `<div class="pile" style="margin-top:10px">
        <button class="principal" data-action="rg-a-appliquer">Appliquer ${D.final} DM à ${esc(c ? nomPart(mod, c) : '?')}</button>
        <div class="rangee"><input type="number" inputmode="numeric" id="rg-dm-force" placeholder="autre montant"><button class="lien" data-action="rg-a-dm-forcer">Forcer</button></div>
        <button class="lien" data-action="rg-a-dm-refaire">Relancer les dommages</button>
      </div>`;
    } else {
      html += `${D.suite ? `<p class="force">${esc(D.suite)}</p>` : ''}
        <div class="rangee" style="margin-top:10px"><button data-action="rg-a-encore">Autre attaque</button><button class="principal" data-action="rg-a-terminer">Terminer l'action</button></div>`;
    }
  }
  return html + '</div>';
}

function chanceDispo(mod, f) {
  const ch = mod.test?.chance;
  if (!ch || !f) return null;
  const j = f.jauges?.[ch.jauge];
  if (!j || j.act <= 0) return null;
  const def = defFiche(mod, f.type);
  return { abr: def.jauges.find(x => x.id === ch.jauge)?.abr || ch.jauge, bonus: ch.bonus, reste: j.act, j };
}

async function lancerAttaque(mod, cb, auto) {
  const A = cb.action;
  const P = parametresAttaque(mod, cb);
  const t = mod.test || {};
  const faces = t.de || 20;
  const lib = `${P.att.nom}${P.opt ? ' (' + P.opt.nom.toLowerCase() + ')' : ''} — ${nomPart(mod, P.p)} contre ${nomPart(mod, P.c)}`;
  let r, physique = false;
  if (auto) {
    r = { auto: true, formule: 'touche automatique', faces, des: [], gardes: [], mod: 0, total: P.defense, comp: '>=', seuil: P.defense, reussite: true, libelle: lib, critique: P.critSubi, mention: P.critSubi ? `Touche automatique · ${t.critiqueAttaque || 'réussite critique'}` : 'Touche automatique' };
  } else {
    const ph = lireDesPhysiques('rg-a-phys', P.de === 'normal' ? 1 : 2, faces);
    if (ph.erreur) return toast(ph.erreur);
    physique = !!ph.valeurs;
    r = jetD20(mod, { base: P.base, modif: P.modif, de: P.de, valeurs: ph.valeurs, seuil: P.defense, attaque: true, critSeuil: P.critSeuil, libelle: lib });
  }
  const ign = P.lignes.filter(l => A.ignorer.includes(l.cle) && l.auto).concat(P.bd.lignes.filter(l => A.ignorer.includes(l.cle)));
  r.physique = physique;
  A.res = r; A.etape = 'jet';
  if (r.auto) await noter({ type: 'combat', texte: `${lib} : ${r.mention.toLowerCase()}` });
  else await noter({ type: 'jet', ...r });
  if (ign.length) await noter({ type: 'derogation', texte: `${lib} : règle écartée (${ign.map(l => l.texte).join(', ')})` });
  await sauverPartie();
  rendre();
}

async function lancerDommages(mod, cb) {
  const A = cb.action;
  const C = combatCfg(mod);
  const P = parametresAttaque(mod, cb);
  const f = P.p.camp === 'pj' ? ficheDe(P.p) : null;
  const ctx = ctxFiche(mod, f);
  const D = A.dm || (A.dm = {});
  D.plus = $('#rg-dm-plus')?.value.trim() || '';
  D.resist = !!$('#rg-dm-resist')?.checked;
  if ($('#rg-dm-base')) D.base = $('#rg-dm-base').value.trim();
  const baseExpr = exprEvo(P.att.dm || D.base || '', mod, f);
  if (!baseExpr) return toast('Indique les DM de l’attaque');
  const phys = $('#rg-dm-phys')?.value.trim();
  const crit = A.res?.critique && !C.critiqueSansDouble;
  const mult = crit ? (C.multCritique || 2) : 1;
  const lignes = [];
  let x;
  if (phys) {
    const tot = lireEntier(phys, 0, 999);
    if (tot == null) return toast('Total des dés invalide');
    const a = analyserExpression(baseExpr, ctx);
    x = { total: tot + a.cst, formule: texteExpression(baseExpr, ctx), des: [tot], cst: a.cst };
    lignes.push(`${x.formule} : dés ${tot} (physiques)${a.cst ? ' ' + signe(a.cst) : ''} = ${x.total}`);
  } else {
    x = lancerExpression(baseExpr, ctx);
    lignes.push(`${x.formule} : ${x.des.join(', ')}${x.cst ? ' ' + signe(x.cst) : ''} = ${x.total}`);
  }
  let total = Math.max(C.dmMin ?? 1, x.total) * mult;
  if (mult > 1) lignes.push(`× ${mult} (critique) = ${total}`);
  for (const [nom, expr] of [[P.opt?.nom, P.opt?.dmPlus], ['En plus', D.plus]]) {
    if (!expr) continue;
    const y = lancerExpression(exprEvo(expr, mod, f), ctx);
    total += y.total;
    lignes.push(`${nom} : ${y.formule}${y.des.length ? ' : ' + y.des.join(', ') + (y.cst ? ' ' + signe(y.cst) : '') : ''} = +${y.total}`);
  }
  if (P.opt?.dmDiv) { total = Math.floor(total / P.opt.dmDiv); lignes.push(`÷ ${P.opt.dmDiv} (${P.opt.nom}) = ${total}`); }
  const rd = P.c.camp === 'adv' ? P.c.rd || 0 : 0;
  if (rd) { total = Math.max(C.dmMin ?? 1, total - rd); lignes.push(`− ${rd} (${C.adversaire.rd || 'RD'}) = ${total}`); }
  if (D.resist) { total = Math.max(C.dmMin ?? 1, Math.floor(total / 2)); lignes.push(`÷ 2 (résistance) = ${total}`); }
  total = Math.max(C.dmMin ?? 1, total);
  Object.assign(D, { fait: true, lignes, final: total, brut: total, physique: !!phys, force: null });
  await noter({ type: 'combat', texte: `Dommages ${P.att.nom}${crit ? ' (critique)' : ''} — ${nomPart(mod, P.p)} contre ${nomPart(mod, P.c)} : ${lignes.join(' ; ')}${phys ? ', dés physiques' : ''}` });
  await sauverPartie();
  rendre();
}

/* Applique des DM à un participant ; renvoie la ligne de suite (0 PV, état…) */
async function infligerPart(mod, cb, c, n, source) {
  const C = combatCfg(mod);
  let suite = '';
  if (c.camp === 'adv') {
    const av = c.pv.act;
    c.pv.act = Math.max(0, c.pv.act - n);
    await noter({ type: 'combat', texte: `${c.nom} subit ${n} DM${source ? ' (' + source + ')' : ''} : PV ${av} → ${c.pv.act}` });
    if (c.pv.act <= 0) suite = C.zeroAdversaire || `${c.nom} est hors de combat.`;
  } else {
    const f = ficheDe(c);
    const def = defFiche(mod, f.type);
    const lignes = subirDegats(mod, f, n, { sansArmure: !!C.ignorerArmurePJ, source });
    const pv = pvPart(mod, c);
    if (pv && pv.act <= 0) suite = C.zeroPJ || `${nomFiche(f, def)} tombe à 0.`;
    else if (lignes.alerte) suite = lignes.alerte;
  }
  if (c.camp === 'adv' || !suite) {
    const pv = pvPart(mod, c);
    for (const a of C.etatAuto || []) if (pv && pv.act > 0 && pv.act <= a.pv && a.texte) suite = [suite, `${nomPart(mod, c)} : ${a.texte}`].filter(Boolean).join(' ');
  }
  await sauverPartie();
  return suite;
}

/* ---------- Procédures (regles.procedures) ---------- */
function ouvrirProcedure(mod, id) {
  const p = (reglesMod(mod)?.procedures || []).find(x => x.id === id);
  if (!p) return;
  const fiches = (etat.partie.fiches || []).filter(f => defFiche(mod, f.type));
  const princ = fiches.find(f => f.role === 'principal') || fiches[0];
  etat.procedure = { id, acteur: princ?.id || null, cible: p.cible ? (princ?.id || null) : null, pas: -1, diff: 0, mod: 0, de: [], vars: {}, histo: [], res: null };
  etat.reglesVue = 'proc';
}
function etapeProc(p, P) { return P.pas >= 0 ? p.etapes[P.pas] : null; }
function allerEtape(p, P, id) {
  if (id === 'fin') { P.pas = p.etapes.length; return; }
  if (id) { const i = p.etapes.findIndex(e => e.id === id); P.pas = i >= 0 ? i : p.etapes.length; }
  else P.pas += 1;
  P.res = null;
}

function vueProcedure(mod) {
  const P = etat.procedure;
  const p = (reglesMod(mod)?.procedures || []).find(x => x.id === P.id);
  if (!p) { etat.procedure = null; etat.reglesVue = 'hub'; return vueRegles(mod); }
  const fiches = (etat.partie.fiches || []).filter(f => defFiche(mod, f.type));
  let html = `<div class="rangee entete-fiche"><button class="lien" data-action="rg-hub">‹ Règles</button></div>
    <div class="carte assistant"><h2>${esc(p.nom)}</h2>${p.intro ? `<p class="discret petit">${enrichir(p.intro)}</p>` : ''}`;
  if (P.pas < 0) {
    html += `<h3>${esc(p.acteur || 'Qui agit ?')}</h3><div class="puces">${fiches.map(f => `<button class="puce ${P.acteur === f.id ? 'choisie' : ''}" data-action="rg-p-acteur" data-id="${esc(f.id)}">${esc(nomFiche(f, defFiche(mod, f.type)))}</button>`).join('')}</div>
      ${p.cible ? `<h3>${esc(typeof p.cible === 'string' ? p.cible : 'Sur qui ?')}</h3><div class="puces">${fiches.map(f => `<button class="puce ${P.cible === f.id ? 'choisie' : ''}" data-action="rg-p-cible" data-id="${esc(f.id)}">${esc(nomFiche(f, defFiche(mod, f.type)))}</button>`).join('')}</div>` : ''}
      <button class="principal" style="margin-top:12px" data-action="rg-p-commencer" ${P.acteur ? '' : 'disabled'}>Commencer</button>`;
    return html + '</div>';
  }
  if (P.histo.length) html += `<ul class="liste-simple petit discret">${P.histo.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;
  const e = etapeProc(p, P);
  if (!e) {
    html += `<p><strong>Procédure terminée.</strong></p><div class="rangee"><button data-action="rg-proc" data-id="${esc(p.id)}">Recommencer</button><button class="principal" data-action="rg-hub">Terminer</button></div>`;
    return html + '</div>';
  }
  const acteur = ficheParId(P.acteur);
  if (e.texte) html += `<p>${enrichir(remplirModele(e.texte, P.vars))}</p>`;
  if (e.type === 'choix') {
    html += `<div class="pile">${e.options.map((o, i) => `<button data-action="rg-p-choix" data-i="${i}">${esc(o.texte)}${o.aide ? `<small class="discret"> — ${esc(o.aide)}</small>` : ''}</button>`).join('')}</div>`;
  } else if (e.type === 'test') {
    const def = defFiche(mod, acteur.type);
    const x = trouverRef(def, e.carac);
    const base = valeurRef(mod, acteur, def, x);
    const diff = (e.difficulte ?? 0) + P.diff;
    const de = resoudreDe([...P.de, ...(e.de ? [e.de] : [])]);
    if (!P.res) {
      html += `<p class="petit"><strong>${esc(e.libelle || 'Test')} : ${esc(libRef(x))} ${txtSigne(base + P.mod)}${de !== 'normal' ? ` (${de === 'bonus' ? 'dé bonus' : 'dé malus'})` : ''} contre ${diff}</strong></p>
        <button class="principal" data-action="rg-p-lancer">Lancer</button>${champsDesPhysiques('rg-p-phys', de === 'normal' ? 1 : 2, mod.test?.de || 20)}`;
    } else {
      html += rendreResultatJet({ ...P.res, sansForcage: true });
      html += `<div class="rangee" style="margin-top:10px"><button class="lien" data-action="rg-p-forcer">Forcer : ${P.res.reussite ? 'échec' : 'réussite'}</button><button class="principal" style="flex:2" data-action="rg-p-suite">Continuer</button></div>`;
    }
  } else {
    if (e.jet && !P.res) html += `<button class="principal" data-action="rg-p-jet">Lancer ${esc(texteExpression(exprEvo(e.jet, mod, acteur), ctxFiche(mod, acteur)))}</button>`;
    else {
      if (P.res) html += `<div class="resultat"><div class="reponse">${P.res.total}</div><div class="meta">${esc(P.res.formule)}${P.res.des.length ? ' : ' + P.res.des.join(', ') : ''}</div></div>`;
      if (e.effet && !P.effetFait) {
        const cible = ficheParId(e.effet.sur === 'acteur' ? P.acteur : P.cible || P.acteur);
        html += `<button class="principal" data-action="rg-p-effet">${esc(e.effet.bouton || 'Appliquer')} — ${esc(cible ? nomFiche(cible, defFiche(mod, cible.type)) : '?')}</button>`;
      }
      html += `<button style="margin-top:8px" data-action="rg-p-suite">${e.fin ? 'Terminer' : 'Continuer'}</button>`;
    }
  }
  return html + '</div>';
}

async function effetProcedure(mod, e, P) {
  const cible = ficheParId(e.effet.sur === 'acteur' ? P.acteur : P.cible || P.acteur);
  if (!cible) return;
  const def = defFiche(mod, cible.type);
  const x = trouverRef(def, e.effet.ref);
  if (!x || x.kind !== 'jauge') return toast(`« ${e.effet.ref} » introuvable sur la fiche`);
  const j = cible.jauges[x.id];
  const av = j.act;
  const val = Math.round(evaluerFormule(remplirModele(String(e.effet.fixer ?? e.effet.ajouter ?? 0), { jet: P.res?.total ?? 0, ...P.vars }), {}));
  j.act = Math.max(0, Math.min(j.max, e.effet.fixer != null ? val : j.act + val));
  P.effetFait = true;
  await sauverPartie();
  const texte = `${nomFiche(cible, def)} : ${libRef(x)} ${av} → ${j.act}`;
  P.histo.push(texte);
  await noter({ type: 'fiche', texte: `${reglesMod(mod).procedures.find(q => q.id === P.id)?.nom || 'Procédure'} — ${texte}` });
  rendre();
}

/* ======================================================================
   Actions (préfixe « rg- »)
   ====================================================================== */
async function actionRegles(a, b, mod, f) {
  const cb = etat.partie?.combat;
  const C = combatCfg(mod);
  switch (a) {
    case 'rg-hub': etat.reglesVue = 'hub'; etat.procedure = null; await rendre(); return window.scrollTo(0, 0);
    case 'rg-ouvrir': etat.jeuSous = 'regles'; etat.ficheOuverte = null; etat.reglesVue = etat.partie.combat ? 'combat' : 'hub'; await rendre(); return window.scrollTo(0, 0);
    case 'rg-fiche-regles': ouvrirTest(mod, f, 'fiche'); await rendre(); return window.scrollTo(0, 0);

    /* Test pas à pas */
    case 'rg-test': ouvrirTest(mod, ficheParId(b.dataset.id), 'hub'); await rendre(); return window.scrollTo(0, 0);
    case 'rg-test-fermer': {
      const A = etat.assistantTest;
      etat.assistantTest = null;
      if (A?.retour === 'fiche') { etat.jeuSous = 'fiches'; etat.ficheOuverte = A.fiche; etat.reglesVue = 'hub'; }
      else etat.reglesVue = A?.retour === 'combat' && etat.partie.combat ? 'combat' : 'hub';
      await rendre(); return window.scrollTo(0, 0);
    }
    case 'rg-t-quoi': { const A = etat.assistantTest; A.quoi = b.dataset.k ? { carac: b.dataset.k } : { derivee: b.dataset.d }; A.etape = 2; return rendre(); }
    case 'rg-t-contre': { const A = etat.assistantTest; lireContre(A); A.contre.type = b.dataset.v; return rendre(); }
    case 'rg-t-diff': { const A = etat.assistantTest; const d = reglesMod(mod).test.difficultes[Number(b.dataset.i)]; A.contre = { ...A.contre, type: 'diff', valeur: d.valeur, nom: d.nom }; A.etape = 3; return rendre(); }
    case 'rg-t-suite2': {
      const A = etat.assistantTest; lireContre(A);
      if (A.contre.type === 'diff' && A.contre.valeur == null) return toast('Choisis ou saisis une difficulté');
      A.etape = 3; return rendre();
    }
    case 'rg-t-de': { const A = etat.assistantTest; A.de = A.de.includes(b.dataset.v) ? A.de.filter(x => x !== b.dataset.v) : [...A.de, b.dataset.v]; return rendre(); }
    case 'rg-t-mod': { const A = etat.assistantTest; const i = Number(b.dataset.i); A.mods = A.mods.includes(i) ? A.mods.filter(x => x !== i) : [...A.mods, i]; return rendre(); }
    case 'rg-t-modif': { const A = etat.assistantTest; A.modif = Math.max(-30, Math.min(30, A.modif + Number(b.dataset.v))); return rendre(); }
    case 'rg-t-suite3': etat.assistantTest.etape = 4; return rendre();
    case 'rg-t-sansjet': etat.assistantTest.etape = 4; return lancerTestAssistant(mod, Number(b.dataset.i));
    case 'rg-t-retour': { const A = etat.assistantTest; if (A.etape === 2) lireContre(A); A.etape = Math.max(1, A.etape - 1); return rendre(); }
    case 'rg-t-lancer': return lancerTestAssistant(mod);
    case 'rg-t-nouveau': { const A = etat.assistantTest; ouvrirTest(mod, ficheParId(A.fiche), A.retour); return rendre(); }

    /* Combat : préparation */
    case 'rg-combat-preparer': {
      etat.partie.combat = nouveauCombat();
      initialiserPJ(mod, etat.partie.combat);
      etat.reglesVue = 'combat'; etat.formAdv = null;
      await sauverPartie(); await rendre(); return window.scrollTo(0, 0);
    }
    case 'rg-combat-ouvrir': etat.reglesVue = 'combat'; await rendre(); return window.scrollTo(0, 0);
    case 'rg-c-annuler':
      if (!confirm('Abandonner la préparation de ce combat ?')) return;
      delete etat.partie.combat; etat.reglesVue = 'hub'; await sauverPartie(); return rendre();
    case 'rg-c-pj': cb.participants.push({ id: nouvelId(), camp: 'pj', fiche: b.dataset.id, etats: [] }); etat.formAdv = lireFormAdversaire(); await sauverPartie(); return rendre();
    case 'rg-c-suppr': cb.participants = cb.participants.filter(p => p.id !== b.dataset.id); etat.formAdv = lireFormAdversaire(); await sauverPartie(); return rendre();
    case 'rg-c-surpris': {
      const p = participant(cb, b.dataset.id); const n = C.surpris || 'Surpris';
      p.etats = (p.etats || []).includes(n) ? p.etats.filter(x => x !== n) : [...(p.etats || []), n];
      etat.formAdv = lireFormAdversaire(); await sauverPartie(); return rendre();
    }
    case 'rg-c-best': {
      const m = etat.partie.bestiaire[Number(b.dataset.i)];
      etat.formAdv = { ...m, nb: '' }; await rendre();
      return document.getElementById('form-adv')?.scrollIntoView({ block: 'start' });
    }
    case 'rg-c-best-suppr': {
      const m = etat.partie.bestiaire[Number(b.dataset.i)];
      if (!confirm(`Oublier « ${m.nom} » ?`)) return;
      etat.formAdv = lireFormAdversaire();
      etat.partie.bestiaire.splice(Number(b.dataset.i), 1); await sauverPartie(); return rendre();
    }
    case 'rg-c-adv-ok': return ajouterAdversaires(mod, cb);
    case 'rg-c-commencer': return commencerCombat(mod, cb);

    /* Combat : déroulement */
    case 'rg-c-suivant': return tourSuivant(mod, cb);
    case 'rg-c-retarder': {
      const i = cb.tour;
      let j = i + 1;
      while (j < cb.ordre.length && !actifPart(mod, participant(cb, cb.ordre[j]))) j++;
      if (j >= cb.ordre.length) return toast('Personne ne joue après lui ce round-ci');
      const p = participant(cb, cb.ordre[i]), q = participant(cb, cb.ordre[j]);
      cb.ordre.splice(i, 1); cb.ordre.splice(j, 0, p.id);
      await noter({ type: 'combat', texte: `${nomPart(mod, p)} retarde son tour et jouera après ${nomPart(mod, q)}` });
      await sauverPartie(); return rendre();
    }
    case 'rg-c-posture': {
      const o = C.options.find(x => x.id === b.dataset.id);
      const p = participant(cb, cb.ordre[cb.tour]);
      cb.effets = (cb.effets || []).filter(e => !(e.porteur === p.id && e.nom === o.nom));
      cb.effets.push({ porteur: p.id, nom: o.nom, defense: o.defense, round: cb.round });
      await noter({ type: 'combat', texte: `${nomPart(mod, p)} : ${o.nom} (${txtSigne(o.defense)} DEF jusqu'à son prochain tour)` });
      await sauverPartie(); return rendre();
    }
    case 'rg-c-test': {
      const p = participant(cb, cb.ordre[cb.tour]);
      ouvrirTest(mod, ficheDe(p), 'combat'); await rendre(); return window.scrollTo(0, 0);
    }
    case 'rg-c-part': etat.partOuvert = etat.partOuvert === b.dataset.id ? null : b.dataset.id; return rendre();
    case 'rg-c-ajout-adv': etat.ajoutAdv = !etat.ajoutAdv; await rendre(); return etat.ajoutAdv && document.getElementById('form-adv')?.scrollIntoView({ block: 'start' });
    case 'rg-c-etat': {
      const p = participant(cb, b.dataset.id); const n = b.dataset.n;
      const avait = (p.etats || []).includes(n);
      p.etats = avait ? p.etats.filter(x => x !== n) : [...(p.etats || []), n];
      await noter({ type: 'combat', texte: `${nomPart(mod, p)} : ${avait ? 'fin de l’état' : 'état'} ${n}` });
      await sauverPartie(); return rendre();
    }
    case 'rg-c-dm-direct': case 'rg-c-soin': {
      const p = participant(cb, b.dataset.id);
      const n = lireEntier($('#rg-dd-' + CSS.escape(p.id))?.value ?? '', 0, 999);
      if (n == null) return toast('Entre un nombre de points');
      if (a === 'rg-c-soin') {
        if (p.camp === 'adv') { const av = p.pv.act; p.pv.act = Math.min(p.pv.max, p.pv.act + n); await noter({ type: 'combat', texte: `${p.nom} récupère ${n} PV : ${av} → ${p.pv.act}` }); }
        else { const fp = ficheDe(p); const x = refFiche(mod, fp, 'pv'); const j = fp.jauges[x.id]; const av = j.act; j.act = Math.min(j.max, j.act + n); await noter({ type: 'fiche', texte: `${nomPart(mod, p)} récupère ${n} ${libRef(x)} : ${av} → ${j.act}` }); }
        await sauverPartie();
      } else {
        const s = await infligerPart(mod, cb, p, n, 'DM directs');
        if (s) toast(s);
      }
      return rendre();
    }
    case 'rg-c-init': {
      const p = participant(cb, b.dataset.id);
      const s = prompt(`Initiative de ${nomPart(mod, p)} :`, String(p.init));
      const v = s == null ? null : lireEntier(s, -99, 999);
      if (v == null) return;
      const courantId = cb.ordre[cb.tour];
      p.init = v;
      cb.ordre = calculerOrdre(mod, cb);
      cb.tour = Math.max(0, cb.ordre.indexOf(courantId));
      await noter({ type: 'derogation', texte: `Initiative de ${nomPart(mod, p)} fixée à ${v}` });
      await sauverPartie(); return rendre();
    }
    case 'rg-c-retirer': {
      const p = participant(cb, b.dataset.id);
      p.retire = !p.retire;
      await noter({ type: 'combat', texte: `${nomPart(mod, p)} ${p.retire ? 'quitte' : 'revient dans'} le combat` });
      if (p.retire && cb.ordre[cb.tour] === p.id) return tourSuivant(mod, cb);
      await sauverPartie(); return rendre();
    }
    case 'rg-c-fin': return finCombat(mod, cb);

    /* Attaque pas à pas */
    case 'rg-c-attaque': demarrerAttaque(mod, cb); await sauverPartie(); await rendre(); return window.scrollTo(0, 0);
    case 'rg-a-att': cb.action.attaque = /^\d+$/.test(b.dataset.i) ? Number(b.dataset.i) : b.dataset.i; cb.action.critSeuil = null; return rendre();
    case 'rg-a-cible': cb.action.cible = b.dataset.id; return rendre();
    case 'rg-a-opt': cb.action.option = b.dataset.id || null; return rendre();
    case 'rg-a-suite': cb.action.etape = 'jet'; await sauverPartie(); return rendre();
    case 'rg-a-ign': { const A = cb.action; const k = b.dataset.cle; A.ignorer = A.ignorer.includes(k) ? A.ignorer.filter(x => x !== k) : [...A.ignorer, k]; return rendre(); }
    case 'rg-a-de': { const A = cb.action; A.de = A.de.includes(b.dataset.v) ? A.de.filter(x => x !== b.dataset.v) : [...A.de, b.dataset.v]; return rendre(); }
    case 'rg-a-modif': cb.action.modif = Math.max(-30, Math.min(30, cb.action.modif + Number(b.dataset.v))); return rendre();
    case 'rg-a-crit': { const P = parametresAttaque(mod, cb); cb.action.critSeuil = Math.max(C.critiqueMin || 2, Math.min(mod.test?.de || 20, P.critSeuil + Number(b.dataset.v))); return rendre(); }
    case 'rg-a-lancer': return lancerAttaque(mod, cb, false);
    case 'rg-a-auto': return lancerAttaque(mod, cb, true);
    case 'rg-a-chance': {
      const A = cb.action; const p = participant(cb, A.attaquant); const pc = chanceDispo(mod, ficheDe(p));
      if (!pc) return toast('Plus de points');
      pc.j.act -= 1;
      const avant = A.res.totalForce ?? A.res.total;
      A.res.chance = true; A.res.totalForce = avant + pc.bonus;
      A.res.reussite = A.res.totalForce >= A.res.seuil;
      await noter({ type: 'fiche', texte: `${nomPart(mod, p)} dépense 1 ${pc.abr} sur son attaque : ${avant} → ${A.res.totalForce} (${A.res.reussite ? 'touché' : 'raté'}) — ${pc.abr} ${pc.reste} → ${pc.reste - 1}` });
      await sauverPartie(); return rendre();
    }
    case 'rg-a-forcer': {
      const A = cb.action; const v = Number(b.dataset.v);
      if (v === 2) { A.res.critique = true; A.res.reussite = true; A.res.mention = mod.test?.critiqueAttaque || 'Réussite critique'; }
      else A.res.reussite = v === 1;
      await noter({ type: 'derogation', texte: `${A.res.libelle} : ${v === 2 ? 'critique' : v === 1 ? 'touché' : 'raté'} forcé (le jet donnait ${A.res.totalForce ?? A.res.total} contre DEF ${A.res.seuil})` });
      await sauverPartie(); return rendre();
    }
    case 'rg-a-vers-dm': cb.action.etape = 'dm'; cb.action.dm = null; await sauverPartie(); return rendre();
    case 'rg-a-dm': return lancerDommages(mod, cb);
    case 'rg-a-dm-refaire': cb.action.dm = { plus: cb.action.dm?.plus, resist: cb.action.dm?.resist, base: cb.action.dm?.base }; return rendre();
    case 'rg-a-dm-forcer': {
      const D = cb.action.dm;
      const v = lireEntier($('#rg-dm-force')?.value ?? '', 0, 999);
      if (v == null) return toast('Entre un nombre');
      await noter({ type: 'derogation', texte: `Dommages forcés à ${v} au lieu de ${D.brut}` });
      D.force = v; D.final = v; await sauverPartie(); return rendre();
    }
    case 'rg-a-appliquer': {
      const A = cb.action; const c = participant(cb, A.cible); const p = participant(cb, A.attaquant);
      A.dm.suite = await infligerPart(mod, cb, c, A.dm.final, `${p ? nomPart(mod, p) : ''}, ${parametresAttaque(mod, cb).att?.nom || ''}`.replace(/^, |, $/g, ''));
      A.dm.applique = true; await sauverPartie(); return rendre();
    }
    case 'rg-a-encore': { const A = cb.action; const garde = { attaque: A.attaque, cible: actifPart(mod, participant(cb, A.cible)) ? A.cible : null }; demarrerAttaque(mod, cb); if (garde.cible) cb.action.cible = garde.cible; cb.action.attaque = garde.attaque; await sauverPartie(); return rendre(); }
    case 'rg-a-terminer': cb.action = null; await sauverPartie(); await rendre(); return window.scrollTo(0, 0);
    case 'rg-a-annuler': {
      if (cb.action?.res && !cb.action.dm?.applique && !confirm('Quitter cette attaque ? Le jet reste noté au journal.')) return;
      cb.action = null; await sauverPartie(); return rendre();
    }

    /* Procédures */
    case 'rg-proc': ouvrirProcedure(mod, b.dataset.id); await rendre(); return window.scrollTo(0, 0);
    case 'rg-p-acteur': etat.procedure.acteur = b.dataset.id; return rendre();
    case 'rg-p-cible': etat.procedure.cible = b.dataset.id; return rendre();
    case 'rg-p-commencer': {
      const P = etat.procedure; const p = reglesMod(mod).procedures.find(x => x.id === P.id);
      P.pas = 0; P.histo = [];
      await noter({ type: 'combat', texte: `${p.nom} — ${nomFiche(ficheParId(P.acteur), defFiche(mod, ficheParId(P.acteur).type))}${P.cible && P.cible !== P.acteur ? ' sur ' + nomFiche(ficheParId(P.cible), defFiche(mod, ficheParId(P.cible).type)) : ''}` });
      return rendre();
    }
    case 'rg-p-choix': {
      const P = etat.procedure; const p = reglesMod(mod).procedures.find(x => x.id === P.id); const e = etapeProc(p, P);
      const o = e.options[Number(b.dataset.i)];
      P.diff += o.diff || 0; P.mod += o.mod || 0; if (o.de) P.de.push(o.de);
      Object.assign(P.vars, o.vars || {});
      P.histo.push(`${remplirModele(e.texte || e.nom || '', P.vars).replace(/\s*\?$/, '')} : ${o.texte}`);
      allerEtape(p, P, o.suite || e.suite);
      return rendre();
    }
    case 'rg-p-lancer': case 'rg-p-forcer': {
      const P = etat.procedure; const p = reglesMod(mod).procedures.find(x => x.id === P.id); const e = etapeProc(p, P);
      if (a === 'rg-p-forcer') {
        P.res.reussite = !P.res.reussite;
        await noter({ type: 'derogation', texte: `${P.res.libelle} : ${P.res.reussite ? 'réussite' : 'échec'} forcé` });
        return rendre();
      }
      const acteur = ficheParId(P.acteur); const def = defFiche(mod, acteur.type);
      const x = trouverRef(def, e.carac);
      const de = resoudreDe([...P.de, ...(e.de ? [e.de] : [])]);
      const ph = lireDesPhysiques('rg-p-phys', de === 'normal' ? 1 : 2, mod.test?.de || 20);
      if (ph.erreur) return toast(ph.erreur);
      const diff = (e.difficulte ?? 0) + P.diff;
      const r = jetD20(mod, { base: valeurRef(mod, acteur, def, x), modif: P.mod, de, valeurs: ph.valeurs, seuil: diff, attaque: false, libelle: `${e.libelle || 'Test'} (${libRef(x)}) — ${nomFiche(acteur, def)}` });
      r.physique = !!ph.valeurs;
      P.res = r;
      await noter({ type: 'jet', ...r });
      return rendre();
    }
    case 'rg-p-jet': {
      const P = etat.procedure; const p = reglesMod(mod).procedures.find(x => x.id === P.id); const e = etapeProc(p, P);
      const acteur = ficheParId(P.acteur);
      const x = lancerExpression(exprEvo(e.jet, mod, acteur), ctxFiche(mod, acteur));
      P.res = { ...x }; P.vars.jet = x.total;
      await noter({ type: 'jet', physique: false, formule: x.formule, faces: 0, des: x.des, gardes: x.des.map((_, k) => k), mod: x.cst, total: x.total, comp: null, seuil: null, reussite: null, libelle: `${p.nom} — ${e.libelleJet || 'jet'}` });
      return rendre();
    }
    case 'rg-p-effet': { const P = etat.procedure; const p = reglesMod(mod).procedures.find(x => x.id === P.id); return effetProcedure(mod, etapeProc(p, P), P); }
    case 'rg-p-suite': {
      const P = etat.procedure; const p = reglesMod(mod).procedures.find(x => x.id === P.id); const e = etapeProc(p, P);
      if (e.type === 'test' && P.res) { P.histo.push(`${e.libelle || 'Test'} : ${P.res.reussite ? 'réussite' : 'échec'} (${P.res.totalForce ?? P.res.total} contre ${P.res.seuil})`); allerEtape(p, P, P.res.reussite ? e.siReussite : e.siEchec); }
      else { if (e.texte) P.histo.push(remplirModele(e.texte, P.vars)); P.effetFait = false; allerEtape(p, P, e.fin ? 'fin' : e.suite); }
      P.effetFait = false;
      return rendre();
    }
  }
}

function lireContre(A) {
  const c = A.contre;
  const num = id => { const v = $('#' + id)?.value.trim(); return v === '' || v == null ? undefined : lireEntier(v.replace('−', '-'), -99, 999); };
  if (c.type === 'diff' && $('#rg-t-val')) { const v = num('rg-t-val'); if (v !== undefined && v !== c.valeur) { c.valeur = v; c.nom = ''; } }
  if (c.type === 'oppose' && $('#rg-t-adv-bonus')) {
    c.nom = $('#rg-t-adv-nom').value.trim();
    c.bonus = num('rg-t-adv-bonus') ?? 0;
    c.fixe = !!$('#rg-t-adv-fixe').checked;
    const r = num('rg-t-adv-res'); c.resultat = r === undefined ? null : r;
  }
}

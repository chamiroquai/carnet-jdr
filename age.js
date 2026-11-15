/* Carnet JDR — système « trois dés dont un dé spécial » (étape 7).
   Tests 3d6 + caractéristique + bonus de compétence ≥ difficulté ; le dé spécial donne le degré
   de réussite et, sur un doublé, des points d'action spéciale ; une réserve (jauge) permet de
   remplacer la valeur d'un dé ; compétences rattachées aux caractéristiques ; armes ;
   dégâts encaissés par paliers (résistance, réserve, états) ; réserve de complications de partie.
   Création : tirage de caractéristiques avec conversion, achat de points, choix de compétences.
   Moteur générique : aucun contenu de jeu ici. Tout le vocabulaire vient du module
   (section « test » en mode « age »). Chargé après rencontres.js, avant app.js. */
'use strict';

const estAge = mod => mod?.test?.mode === 'age';
function cfgAge(mod) {
  const t = mod?.test || {};
  return {
    nom: 'Test', special: 'dé spécial', bonusCompetence: 2, libelleSeuil: 'Difficulté', seuils: [],
    points: { abr: 'PA', nom: "points d'action" }, ...t,
    reserve: t.reserve ? { coutSpecial: 2, max: 6, ...t.reserve } : null,
  };
}
const deNom = nom => (/^[AEIOUYÉÈÊH]/i.test(nom) ? 'd’' : 'de ') + nom;

/* ---------- Compétences : « DEX:Apesanteur », « INT:* », « * », « A|B » ---------- */
function competencesModule(mod) { return mod?.competences || {}; }
function caracDef(def, id) { return (def.caracs || []).find(k => k.id === id) || { id, nom: id, abr: id }; }
function lireSpecCompetences(mod, spec) {
  const out = [];
  const C = competencesModule(mod);
  for (const s of String(spec || '').split('|').map(x => x.trim()).filter(Boolean)) {
    if (s === '*') { for (const [c, l] of Object.entries(C)) for (const n of l) out.push({ c, n }); continue; }
    const [c, n] = s.split(':');
    if (n === '*') { for (const x of C[c] || []) out.push({ c, n: x }); continue; }
    if (c && n) out.push({ c, n });
  }
  const vus = new Set();
  return out.filter(o => { const k = o.c + ':' + o.n; if (vus.has(k)) return false; vus.add(k); return true; });
}
const cleComp = o => `${o.c}:${o.n}`;
function competenceFiche(f, c, n) { return (f.competences || []).find(x => x.c === c && x.n === n) || null; }
function ajouterCompetence(f, o) {
  if (!f.competences) f.competences = [];
  if (competenceFiche(f, o.c, o.n)) return false;
  f.competences.push({ c: o.c, n: o.n, b: o.b ?? null });
  return true;
}
function bonusCompetence(mod, x) { return x?.b ?? cfgAge(mod).bonusCompetence; }
function texteCompetence(def, x) { return `${caracDef(def, x.c).nom} (${x.n})`; }

/* Effet de création « competence » (appelé par appliquerEffetPlus) : ajoutée si elle est unique et
   nouvelle ; sinon (choix, ou déjà acquise) un choix est mis en attente dans la variable « compChoix ». */
function appliquerEffetAge(f, ef, c) {
  if (ef.competence == null) return;
  const opts = lireSpecCompetences(moduleActif(), ef.competence);
  const libres = opts.filter(o => !competenceFiche(f, o.c, o.n));
  if (opts.length === 1 && libres.length === 1 && !String(ef.competence).includes('*')) { ajouterCompetence(f, libres[0]); return; }
  if (!c) return;
  const spec = libres.length ? libres.map(cleComp).join('|') : '*';
  c.vars.compChoix = c.vars.compChoix ? `${c.vars.compChoix}|${spec}` : spec;
  if (!libres.length) c.vars.compDouble = opts.map(o => o.n).join(', ');
}

/* ---------- Création : étapes « competences », « tirageCaracs », « achat » ---------- */
const ETAPES_AGE = ['competences', 'tirageCaracs', 'achat'];
function specEtape(p, vars) {
  if (p.parmiVar) return vars?.[p.parmiVar] || '';
  if (p.cas) return p.cas[vars?.[p.parVar]] || '';
  return p.parmi || '';
}
function optionsCompEtape(mod, c, p) {
  let opts = lireSpecCompetences(mod, specEtape(p, c.vars));
  const libres = opts.filter(o => !competenceFiche(c.fiche, o.c, o.n));
  // Trait cumulé : si toutes les options sont déjà acquises, n'importe quelle autre compétence
  if (!libres.length) return { opts: lireSpecCompetences(mod, '*').filter(o => !competenceFiche(c.fiche, o.c, o.n)), toutes: true };
  return { opts: libres, toutes: false };
}
function conversionCarac(p, total) {
  const x = (p.conversion || []).find(e => total >= e.de && total <= (e.a ?? e.de));
  return x ? x.v : total;
}
function tirerEtapeAge(mod, c, p, valeurs) {
  if (p.type !== 'tirageCaracs') return null;
  const def = defFiche(mod, c.type);
  const f = lireFormule(p.formule || '3d6');
  const jets = (def.caracs || []).map((k, i) => {
    const j = valeurs ? { des: [], total: valeurs[i] } : calculerJet(f);
    return { id: k.id, des: j.des, total: j.total, score: conversionCarac(p, j.total) };
  });
  return { type: 'tirageCaracs', jets, ordre: jets.map(j => j.id), echanges: [], physique: !!valeurs };
}

function corpsEtapeAge(mod, c, p, r) {
  const def = defFiche(mod, c.type);
  if (p.type === 'competences') {
    const { opts, toutes } = optionsCompEtape(mod, c, p);
    const n = p.choisir || 1;
    const ids = r?.ids || [];
    const parCarac = {};
    for (const o of opts) (parCarac[o.c] = parCarac[o.c] || []).push(o);
    return `${toutes ? `<p class="force petit">Déjà acquise${c.vars.compDouble ? ' (' + esc(c.vars.compDouble) + ')' : ''} : choisis une autre compétence.</p>` : ''}
      <p class="discret petit">Choisis ${n} compétence${n > 1 ? 's' : ''} (${ids.length}/${n}).</p>
      ${Object.entries(parCarac).map(([k, l]) => `${Object.keys(parCarac).length > 1 ? `<h3>${esc(caracDef(def, k).nom)}</h3>` : ''}
        <div class="puces">${l.map(o => `<button class="puce ${ids.includes(cleComp(o)) ? 'choisie' : ''}" data-action="age-comp" data-v="${esc(cleComp(o))}">${Object.keys(parCarac).length > 1 ? '' : esc(caracDef(def, o.c).abr || o.c) + ' · '}${esc(o.n)}</button>`).join('')}</div>`).join('')}`;
  }
  if (p.type === 'tirageCaracs') {
    if (!r || !r.jets) {
      return `<button class="principal" data-action="cr-lancer">Lancer ${(def.caracs || []).length} × ${esc(formuleCourte(p.formule || '3d6'))}</button>
        <details class="de-physique" data-garde="cr-age-phys"><summary>J’ai lancé mes dés : saisis les totaux dans l’ordre</summary>
          <div class="grille-edition">${(def.caracs || []).map((k, i) => `<label><span>${esc(k.abr || k.id)}</span><input type="number" inputmode="numeric" id="cr-age-${i}" placeholder="3-18"></label>`).join('')}</div>
          <button data-action="age-tirage-phys">Valider</button></details>`;
    }
    const lim = p.echanges ?? 1;
    return `<div class="resultat attributs">${r.ordre.map((id, i) => {
      const j = r.jets[i];
      return `<div class="attr"><strong>${esc(caracDef(def, id).abr || id)}</strong> <span class="reponse petit-rep">${txtSigne(j.score)}</span>
        <div class="meta">${j.des.length ? j.des.map(v => `<span class="de-res">${v}</span>`).join('') : ''} = ${j.total}${j.de && j.de !== id ? ` <small>(tiré pour ${esc(caracDef(def, j.de).abr || j.de)})</small>` : ''}</div></div>`;
    }).join('')}</div>
    <h3>Échanger deux scores${lim ? ` (règle : ${lim} échange${lim > 1 ? 's' : ''})` : ''}</h3><div class="rangee">
      <select id="cr-ech-a">${r.ordre.map(id => `<option value="${esc(id)}">${esc(caracDef(def, id).abr || id)}</option>`).join('')}</select>
      <select id="cr-ech-b">${r.ordre.map((id, i) => `<option value="${esc(id)}" ${i === 1 ? 'selected' : ''}>${esc(caracDef(def, id).abr || id)}</option>`).join('')}</select>
      <button data-action="age-echanger">Échanger</button></div>
    ${r.echanges.length ? `<p class="discret petit">Échanges : ${esc(r.echanges.join(', '))}${r.echanges.length > lim ? ' — au-delà de la règle (dérogation notée)' : ''}</p>` : ''}
    <button class="lien" data-action="cr-lancer">Relancer tout</button>`;
  }
  if (p.type === 'achat') {
    const val = r?.valeurs || Object.fromEntries((def.caracs || []).map(k => [k.id, p.min ?? 0]));
    const dep = Object.values(val).reduce((s, v) => s + v - (p.min ?? 0), 0);
    return `<p class="discret petit">${dep} / ${p.points} points dépensés · de ${txtSigne(p.min ?? 0)} à ${txtSigne(p.max ?? 3)}.</p>
      <div class="pile">${(def.caracs || []).map(k => `<div class="rangee edition-jauge"><span><strong>${esc(k.abr || k.id)}</strong> <small class="discret">${esc(k.nom)}</small></span>
        <div class="rangee serree"><button data-action="age-achat" data-k="${esc(k.id)}" data-v="-1" aria-label="Moins">−</button><output>${txtSigne(val[k.id])}</output><button data-action="age-achat" data-k="${esc(k.id)}" data-v="1" aria-label="Plus">+</button></div></div>`).join('')}</div>`;
  }
  return '';
}

function validerEtapeAge(mod, c, p) {
  const f = c.fiche;
  const def = defFiche(mod, c.type);
  const lignes = [];
  if (p.type === 'competences') {
    const n = p.choisir || 1;
    const ids = c.courant?.ids || [];
    if (ids.length !== n) { toast(`Choisis ${n} compétence${n > 1 ? 's' : ''}`); return false; }
    const { toutes } = optionsCompEtape(mod, c, p);
    for (const id of ids) {
      const [cc, nn] = id.split(':');
      ajouterCompetence(f, { c: cc, n: nn });
      lignes.push(`${p.nom} : ${texteCompetence(def, { c: cc, n: nn })}${toutes ? ' (à la place d’une compétence déjà acquise)' : ''}`);
    }
    if (p.parmiVar) { c.vars[p.parmiVar] = ''; delete c.vars.compDouble; }
  } else if (p.type === 'tirageCaracs') {
    const r = c.courant;
    if (!r?.jets) { toast('Lance d’abord les dés'); return false; }
    f.caracs = { ...(f.caracs || {}) };
    r.ordre.forEach((id, i) => { f.caracs[id] = r.jets[i].score; });
    lignes.push(`${p.nom} : ${r.ordre.map((id, i) => `${caracDef(def, id).abr || id} ${txtSigne(r.jets[i].score)} (${r.jets[i].total})`).join(', ')}${r.echanges.length ? ' — échanges : ' + r.echanges.join(', ') : ''}`);
    const lim = p.echanges ?? 1;
    if (r.echanges.length > lim) noter({ type: 'derogation', texte: `Création : ${r.echanges.length} échanges de scores au lieu de ${lim}` });
  } else if (p.type === 'achat') {
    const val = c.courant?.valeurs || Object.fromEntries((def.caracs || []).map(k => [k.id, p.min ?? 0]));
    const dep = Object.values(val).reduce((s, v) => s + v - (p.min ?? 0), 0);
    if (dep !== p.points) {
      if (!confirm(`${dep} points dépensés sur ${p.points}. Continuer quand même ? (Ce sera noté comme dérogation.)`)) return false;
      noter({ type: 'derogation', texte: `Création : achat de caractéristiques avec ${dep} points au lieu de ${p.points}` });
    }
    f.caracs = { ...(f.caracs || {}), ...val };
    lignes.push(`${p.nom} : ${(def.caracs || []).map(k => `${k.abr || k.id} ${txtSigne(val[k.id])}`).join(', ')}`);
  }
  c.resume.push(...lignes);
  return true;
}

/* ---------- Réserve de complications de la partie (ex. « Turbulences ») ---------- */
function cfgReserveAge(mod) { return mod?.reservePartie || null; }
function etatReserve() {
  const p = etat.partie;
  if (!p) return null;
  if (!p.reserveAge) p.reserveAge = { valeur: 0, actif: true, seuilsVus: [] };
  return p.reserveAge;
}
async function modifierReserve(mod, delta, raison, { silencieux } = {}) {
  const R = cfgReserveAge(mod);
  const s = etatReserve();
  if (!R || !s || (!s.actif && raison !== 'manuel')) return;
  const av = s.valeur;
  s.valeur = Math.max(0, av + delta);
  const franchis = (R.seuils || []).filter(x => delta > 0 && av < x.valeur && s.valeur >= x.valeur);
  for (const x of franchis) s.alerte = x.valeur;
  await sauverPartie();
  await noter({ type: 'note', texte: `${R.nom} ${delta > 0 ? '+' : '−'}${Math.abs(delta)}${raison && raison !== 'manuel' ? ` (${raison})` : ''} : ${av} → ${s.valeur}${franchis.length ? ` — seuil ${franchis.map(x => x.valeur).join(', ')} atteint` : ''}` });
  if (!silencieux && franchis.length) toast(`${R.nom} : seuil ${franchis[franchis.length - 1].valeur} atteint`);
}
function vueReserveAge(mod) {
  const R = cfgReserveAge(mod);
  const s = etatReserve();
  if (!R || !s) return '';
  const seuil = s.alerte != null ? (R.seuils || []).find(x => x.valeur === s.alerte) : null;
  const res = etat.dernier.table?.origine === 'reserve' ? rendreResultatTable(etat.dernier.table) : '';
  return `<div class="carte reserve-age">
    <div class="rangee"><h2 style="margin:0">${esc(R.nom)}</h2>
      <label class="case petit" style="flex:0 0 auto"><input type="checkbox" data-action="age-res-actif" ${s.actif ? 'checked' : ''}> utilisée</label></div>
    ${s.actif ? `<div class="rangee" style="margin-top:8px"><span class="reponse petit-rep">${s.valeur}</span>
      <button data-action="age-res" data-v="-1" aria-label="Moins">−1</button><button data-action="age-res" data-v="1" aria-label="Plus">+1</button>
      <button class="lien" data-action="age-res-zero">Remettre à 0</button></div>
      ${R.prochain !== false ? `<p class="discret petit">Seuils : ${(R.seuils || []).map(x => `${x.valeur}${s.valeur >= x.valeur ? ' ✓' : ''}`).join(' · ')}</p>` : ''}
      ${seuil ? `<p class="force">${esc(seuil.texte || `Seuil ${seuil.valeur} atteint`)}</p>
        <div class="rangee">${seuil.table ? `<button class="principal" data-action="age-res-table" data-t="${esc(seuil.table)}">${esc(seuil.bouton || 'Lancer la table')}</button>` : ''}
        <button class="lien" data-action="age-res-vu">${seuil.remise ? 'Fait : remettre à 0' : 'Fait'}</button></div>` : ''}
      ${res}
      ${(R.declencheurs || []).length ? `<details class="de-physique" data-garde="res-decl"><summary>Ce qui la fait monter</summary>
        <ul class="liste-simple">${R.declencheurs.map(d => `<li>${enrichir(d)}</li>`).join('')}</ul>
        ${R.aide ? `<p class="discret petit">${esc(R.aide)}</p>` : ''}</details>` : ''}` : `<p class="discret petit">Règle optionnelle désactivée pour cette partie.</p>`}
  </div>`;
}

/* ---------- Paliers de dégâts (états) et malus ---------- */
function cfgPaliers(def) { return def?.degats?.mode === 'paliers' ? def.degats : null; }
function palierFiche(f) { return f.palier || 0; }
function malusPalier(def, f) {
  const D = cfgPaliers(def);
  const k = palierFiche(f);
  if (!D || !k) return { malus: 0, nom: '' };
  const p = D.paliers[Math.min(k, D.paliers.length) - 1];
  return k > D.paliers.length ? { malus: p?.malus || 0, nom: D.horsCombat?.nom || 'Hors de combat' } : { malus: p?.malus || 0, nom: p?.nom || '' };
}
function nomPalier(D, k) { return k <= 0 ? '' : k <= D.paliers.length ? D.paliers[k - 1].nom : (D.horsCombat?.nom || 'Hors de combat'); }

/* ---------- Tests ---------- */
function lireDesAge() {
  const v = [0, 1, 2].map(i => $('#age-d-' + i)?.value.trim() ?? '');
  if (v.every(x => x === '')) return { valeurs: null };
  const n = v.map(x => lireEntier(x, 1, 6));
  if (n.some(x => x == null)) return { erreur: 'Entre les trois dés (1 à 6), le dé spécial en dernier' };
  return { valeurs: n };
}
function evaluerAge(mod, r) {
  const T = cfgAge(mod);
  const [a, b, s] = r.des;
  r.total = a + b + s + r.mod;
  if (r.seuil != null) r.reussite = r.total >= r.seuil;
  const double = a === b || a === s || b === s;
  r.age = { ...(r.age || {}), special: s, points: double ? s : 0 };
  const m = [];
  if (double) m.push(r.age.sansPoints ? `Doublé (pas de ${T.points.abr} sur ce test)` : `Doublé : ${s} ${T.points.abr}${r.reussite === false ? ' (seulement en cas de réussite)' : ''}`);
  if (r.reussite !== false) m.push(`${T.special.charAt(0).toUpperCase() + T.special.slice(1)} : ${s}${T.degres?.[s] ? ' — ' + T.degres[s] : ''}`);
  if (r.age.enrayage && r.reussite === false && s === 6) m.push(r.age.enrayage);
  r.mention = m.join(' · ');
}
async function testAge(mod, f, { carac, comp, compteur, arme }) {
  const def = defFiche(mod, f.type);
  const T = cfgAge(mod);
  const lu = lireDesAge();
  if (lu.erreur) return toast(lu.erreur);
  const ctx = contexteFiche(mod, f, def);
  const dTxt = $('#ts-diff')?.value.trim() ?? '';
  etat.tsDiff = dTxt;
  const seuil = dTxt === '' ? null : lireEntier(dTxt, -99, 999);
  const modif = etat.tsMod || 0;
  const a = arme != null ? f.armes?.[arme] : null;
  if (a) { carac = a.carac; comp = a.comp; }
  let base = 0, quoi = '', bc = 0, sansComp = false;
  if (compteur) {
    const k = (def.compteurs || []).find(x => x.id === compteur);
    base = f.compteurs?.[compteur] ?? 0;
    quoi = `${T.nom} ${deNom(k?.nom || compteur)}`;
  } else {
    const k = caracDef(def, carac);
    base = ctx[carac] ?? 0;
    if (comp) { const x = competenceFiche(f, carac, comp); if (x) bc = bonusCompetence(mod, x); else sansComp = true; }
    quoi = a ? `${a.nom} (${k.nom}${comp ? ' – ' + comp : ''})` : `${T.nom} ${deNom(k.nom)}${comp ? ` (${comp})` : ''}`;
    if (a && a.att != null && a.att !== '') { base = Number(a.att) || 0; bc = 0; sansComp = false; quoi = `${a.nom} (${txtSigne(base)})`; }
  }
  const pal = malusPalier(def, f);
  const total = base + bc + modif + pal.malus;
  const libelle = `${quoi}${sansComp ? ' sans la compétence' : ''}${modif ? ' ' + txtSigne(modif) : ''}${pal.malus ? ` ${txtSigne(pal.malus)} (${pal.nom.toLowerCase()})` : ''} — ${nomFiche(f, def)}`;
  const r = calculerJet({ faces: 6, n: 3, garde: 'tous', k: 3, mod: total, comp: '>=', seuil: seuil ?? '', libelle }, lu.valeurs);
  r.formule = `3d6 ${txtSigne(total)}`;
  r.special = 2;
  r.age = { sansPoints: !!(comp && (T.sansPoints || []).includes(comp)), enrayage: a?.feu ? (T.enrayage || 'Arme enrayée ou à court de munitions') : '' };
  evaluerAge(mod, r);
  await noter({ type: 'jet', physique: !!lu.valeurs, ...r });
  etat.dernier.jet = { ...r, physique: !!lu.valeurs, origine: 'fiche:' + f.id, arme: arme ?? null };
  const R = cfgReserveAge(mod);
  if (R?.auto?.specialMax && r.reussite && r.age.special === 6) await modifierReserve(mod, 1, R.auto.specialMax);
  await rendre();
  document.getElementById(a ? 'carte-armes' : 'carte-tests')?.querySelector('.resultat')?.scrollIntoView({ block: 'nearest' });
}

function vueTestsAge(mod, f, def) {
  const T = cfgAge(mod);
  const ctx = contexteFiche(mod, f, def);
  const m = etat.tsMod || 0;
  const pal = malusPalier(def, f);
  const resJet = etat.dernier.jet?.origine === 'fiche:' + f.id && etat.dernier.jet.arme == null ? rendreResultatJet(etat.dernier.jet) : '';
  const comps = [...(f.competences || [])].sort((x, y) => (def.caracs || []).findIndex(k => k.id === x.c) - (def.caracs || []).findIndex(k => k.id === y.c) || x.n.localeCompare(y.n));
  const testables = (def.compteurs || []).filter(k => k.test);
  return `<div class="carte" id="carte-tests">
    <h2>${esc(T.nom)}s</h2>
    <div class="rangee reglages-test">
      <div class="stepper"><span class="discret petit">Modificateur</span><div class="rangee serree">
        <button data-action="ts-mod" data-v="-1" aria-label="Moins">−</button><output>${txtSigne(m)}</output><button data-action="ts-mod" data-v="1" aria-label="Plus">+</button></div></div>
      <div class="stepper"><span class="discret petit">${esc(T.libelleSeuil)}</span>
        <input type="number" inputmode="numeric" id="ts-diff" placeholder="—" value="${esc(etat.tsDiff ?? '')}"></div>
    </div>
    ${T.seuils.length ? `<div class="puces petites">${T.seuils.map(s => `<button class="puce ${String(etat.tsDiff) === String(s.v) ? 'choisie' : ''}" data-action="age-nd" data-v="${s.v}" title="${esc(s.nom)}">${s.v}</button>`).join('')}</div>` : ''}
    ${pal.malus ? `<p class="force petit">${esc(pal.nom)} : ${txtSigne(pal.malus)} appliqué à tous les tests.</p>` : ''}
    <div class="grille-3" style="margin-top:10px">${(def.caracs || []).map(k =>
      `<button data-action="age-test" data-k="${esc(k.id)}"><strong>${esc(k.abr || k.id)}</strong><small class="discret"> ${txtSigne(ctx[k.id] ?? 0)}</small></button>`).join('')}</div>
    ${comps.length ? `<h3>Avec une compétence</h3><div class="grille-2b">${comps.map(x => {
      const k = caracDef(def, x.c);
      return `<button data-action="age-test" data-k="${esc(x.c)}" data-c="${esc(x.n)}">${esc(x.n)}<small class="discret"> ${esc(k.abr || k.id)} ${txtSigne((ctx[x.c] ?? 0) + bonusCompetence(mod, x))}</small></button>`;
    }).join('')}</div>` : `<p class="discret petit">Aucune compétence notée (« Modifier » pour en ajouter).</p>`}
    ${testables.length ? `<div class="pile" style="margin-top:8px">${testables.map(k => `<button data-action="age-test" data-cpt="${esc(k.id)}">${T.nom} ${esc(deNom(k.nom))}<small class="discret"> ${txtSigne(f.compteurs?.[k.id] ?? 0)}</small></button>`).join('')}</div>` : ''}
    <details class="de-physique" data-garde="age-phys"><summary>Avec mes dés : saisis-les puis touche le test</summary>
      <div class="rangee">${[0, 1, 2].map(i => `<input type="number" inputmode="numeric" id="age-d-${i}" placeholder="${i < 2 ? 'd6' : esc(T.abrSpecial || 'spécial')}">`).join('')}</div>
      <p class="discret petit">Le troisième est le ${esc(T.special)}.</p>
    </details>
    ${T.aide ? `<p class="discret petit">${esc(T.aide)}</p>` : ''}
    ${resJet}
  </div>`;
}

/* Boutons sous le résultat : dépense de réserve sur un dé, dégâts de l'arme */
function boutonsJetAge(r) {
  const mod = moduleActif();
  const f = ficheParId(r.origine.slice(6));
  if (!mod || !f) return '';
  const def = defFiche(mod, f.type);
  const T = cfgAge(mod);
  let html = '';
  if (r.dm) {
    const ex = def.armes?.extras || [];
    if (ex.length && !r.extras) html += `<div class="puces petites">${ex.map((x, i) => `<button class="puce" data-action="age-dm-extra" data-i="${i}">+${esc(x.de)} <small>${esc(x.nom)}</small></button>`).join('')}</div>`;
    return html ? `<div style="margin-top:10px">${html}</div>` : '';
  }
  if (r.arme != null && f.armes?.[r.arme] && r.reussite !== false) {
    html += `<button data-action="age-dm" data-i="${r.arme}">Dégâts : ${esc(texteExpression(f.armes[r.arme].dm, contexteFiche(mod, f, def)))}</button>`;
  }
  const RS = T.reserve;
  const j = RS ? f.jauges?.[RS.jauge] : null;
  if (RS && j && !r.reserve) {
    if (etat.ageReserve === r.libelle) {
      html += `<div class="carte-interne">
        <div class="rangee"><select id="age-res-de">${r.des.map((v, i) => `<option value="${i}">${i === r.special ? esc(T.special) : 'dé ' + (i + 1)} (${v})</option>`).join('')}</select>
          <select id="age-res-val">${[1, 2, 3, 4, 5, 6].map(v => `<option value="${v}" ${v === 6 ? 'selected' : ''}>→ ${v}</option>`).join('')}</select></div>
        <p class="discret petit">Coût : la nouvelle valeur (× ${RS.coutSpecial} pour le ${esc(T.special)}). Un seul dé par test. ${esc(RS.abr || RS.nom)} : ${j.act}.</p>
        <div class="rangee"><button class="principal" data-action="age-res-appliquer">Appliquer</button><button class="lien" data-action="age-res-fermer">Annuler</button></div></div>`;
    } else if (j.act > 0) html += `<button data-action="age-res-ouvrir">Dépenser ${esc(RS.nom)} sur un dé <small class="discret">(${j.act} ${esc(RS.abr || '')})</small></button>`;
  }
  return html ? `<div class="pile" style="margin-top:10px">${html}</div>` : '';
}

async function depenserReserveDe(mod) {
  const r = etat.dernier.jet;
  const f = ficheParId(r.origine.slice(6));
  const def = defFiche(mod, f.type);
  const T = cfgAge(mod);
  const RS = T.reserve;
  const i = Number($('#age-res-de').value), v = Number($('#age-res-val').value);
  if (r.des[i] === v) return toast('Ce dé a déjà cette valeur');
  const cout = i === r.special ? v * RS.coutSpecial : v;
  const j = f.jauges[RS.jauge];
  if (j.act < cout) return toast(`Il faut ${cout} ${RS.abr || RS.nom} (reste ${j.act})`);
  const avantDe = r.des[i], avantTotal = r.total;
  const avantRes = j.act;
  j.act -= cout;
  r.des = [...r.des]; r.des[i] = v;
  evaluerAge(mod, r);
  r.reserve = { i, avant: avantDe, apres: v, cout };
  etat.ageReserve = null;
  await sauverPartie();
  await noter({ type: 'fiche', texte: `${nomFiche(f, def)} dépense ${cout} ${RS.abr || RS.nom} sur « ${r.libelle.split(' — ')[0]} » : ${i === r.special ? T.special : 'dé ' + (i + 1)} ${avantDe} → ${v}, total ${avantTotal} → ${r.total}${r.seuil != null ? ` (${r.reussite ? 'réussite' : 'échec'})` : ''}${r.age.points ? `, ${r.age.points} ${T.points.abr}` : ''} — ${RS.abr || RS.nom} ${avantRes} → ${j.act}` });
  const R = cfgReserveAge(mod);
  if (R?.auto?.depenseReserve) await modifierReserve(mod, 1, R.auto.depenseReserve);
  if (R?.auto?.specialMax && r.reussite && i === r.special && v === 6) await modifierReserve(mod, 1, R.auto.specialMax);
  rendre();
}

/* ---------- Armes ---------- */
function vueArmesAge(mod, f, def) {
  const ctx = contexteFiche(mod, f, def);
  const resJet = etat.dernier.jet?.origine === 'fiche:' + f.id && etat.dernier.jet.arme != null ? rendreResultatJet(etat.dernier.jet) : '';
  return `<div class="carte" id="carte-armes">
    <h2>${esc(def.armes.titre || 'Armes')}</h2>
    ${(f.armes || []).length ? f.armes.map((a, i) => {
      const k = caracDef(def, a.carac);
      const x = a.comp ? competenceFiche(f, a.carac, a.comp) : null;
      const att = a.att != null && a.att !== '' ? Number(a.att) || 0 : (ctx[a.carac] ?? 0) + (x ? bonusCompetence(mod, x) : 0);
      return `<div class="ligne-arme">
        <div class="arme-nom"><strong>${esc(a.nom)}</strong>
          <div class="discret petit">${a.carac || a.att != null ? `${a.att != null && a.att !== '' ? '' : esc(k.abr || k.id)}${a.comp ? ` (${esc(a.comp)}${x ? '' : ', non acquise'})` : ''} ${txtSigne(att)} · ` : ''}Dégâts ${esc(texteExpression(a.dm, ctx))}${a.notes ? ' · ' + esc(a.notes) : ''}</div></div>
        ${a.carac || (a.att != null && a.att !== '') ? `<button data-action="age-att" data-i="${i}">Attaque</button>` : ''}
        <button data-action="age-dm" data-i="${i}">Dégâts</button>
      </div>`;
    }).join('') : '<p class="discret petit">Aucune arme. Ajoute-les avec « Modifier ».</p>'}
    ${def.armes.aide ? `<p class="discret petit">${esc(def.armes.aide)}</p>` : ''}
    ${resJet}
  </div>`;
}
async function lancerDMAge(mod, f, i, extra) {
  const def = defFiche(mod, f.type);
  const ctx = contexteFiche(mod, f, def);
  if (extra != null) {
    const r = etat.dernier.jet;
    const x = def.armes.extras[extra];
    const e = lancerExpression(x.de, ctx);
    r.des = [...r.des, ...e.des];
    r.gardes = r.des.map((_, k) => k);
    r.total += e.total;
    r.formule += ` + ${x.de}`;
    r.extras = true;
    r.libelle += ` + ${x.nom}`;
    await noter({ type: 'jet', physique: false, ...r });
    return rendre();
  }
  const a = f.armes[i];
  const x = lancerExpression(a.dm, ctx);
  const total = Math.max(def.armes?.minimum ?? 1, x.total);
  const r = { formule: x.formule, faces: 0, des: x.des, gardes: x.des.map((_, k) => k), mod: x.cst, total,
    comp: null, seuil: null, reussite: null, libelle: `Dégâts ${a.nom}${a.notes ? ' (' + a.notes + ')' : ''} — ${nomFiche(f, def)}` };
  await noter({ type: 'jet', physique: false, ...r });
  etat.dernier.jet = { ...r, physique: false, origine: 'fiche:' + f.id, arme: i, dm: true };
  await rendre();
  document.getElementById('carte-armes')?.querySelector('.resultat')?.scrollIntoView({ block: 'nearest' });
}

/* ---------- Dégâts par paliers ---------- */
function vueDegatsAge(mod, f, def) {
  const D = cfgPaliers(def);
  const k = palierFiche(f);
  const g = etat.ageDeg?.fiche === f.id ? etat.ageDeg : null;
  const res = D.reserve ? f.jauges[D.reserve] : null;
  const jr = (def.jauges || []).find(j => j.id === D.reserve);
  const ctx = contexteFiche(mod, f, def);
  let corps = '';
  if (g && !g.fini) {
    const prochain = k < D.paliers.length ? D.paliers[k] : null;
    corps = `<div class="resultat gauche">${g.lignes.map(l => `<div>${esc(l)}</div>`).join('')}
      <div class="reponse petit-rep">Reste ${g.reste}</div></div>
      ${res && res.act > 0 ? `<div class="rangee" style="margin-top:8px"><input type="number" inputmode="numeric" id="age-dg-res" value="${Math.min(g.reste, res.act)}">
        <button data-action="age-dg-res">Dépenser ${esc(jr?.abr || D.reserve)} <small class="discret">(${res.act})</small></button></div>` : ''}
      <div class="pile" style="margin-top:8px">
        ${prochain ? `<button data-action="age-dg-palier">Accepter l’état ${esc(prochain.nom.toLowerCase())} (−${esc(prochain.reduction)})</button>` : ''}
        <button data-action="age-dg-hors">${esc(D.horsCombat?.nom || 'Hors de combat')}</button>
        <button class="lien" data-action="age-dg-annuler">Annuler</button></div>
      <details class="de-physique" data-garde="age-dg-phys"><summary>Réduction avec mon dé</summary><input type="number" inputmode="numeric" id="age-dg-d" placeholder="d6"></details>`;
  } else {
    corps = `<div class="rangee"><input type="number" inputmode="numeric" id="age-dg-n" placeholder="dégâts">
        <button data-action="age-dg">${esc(D.bouton || 'Appliquer')}</button></div>
      <label class="case petit"><input type="checkbox" id="age-dg-pen"> ${esc(D.penetrants || 'Pénétrants')} (sans ${esc((def.derivees || []).find(x => x.id === D.resistance)?.nom || 'résistance')} ${ctx[D.resistance] ?? 0})</label>
      ${g?.fini ? `<div class="resultat gauche">${g.lignes.map(l => `<div>${esc(l)}</div>`).join('')}</div>` : ''}`;
  }
  return `<div class="carte" id="carte-degats">
    <h2>${esc(D.titre || 'Subir des dégâts')}</h2>
    ${k ? `<p class="force">${esc(nomPalier(D, k))}${k <= D.paliers.length && D.paliers[k - 1].malus ? ` : ${txtSigne(D.paliers[k - 1].malus)} aux tests` : ''}${k <= D.paliers.length && D.paliers[k - 1].texte ? ' — ' + esc(D.paliers[k - 1].texte) : k > D.paliers.length && D.horsCombat?.texte ? ' — ' + esc(D.horsCombat.texte) : ''}</p>
      <div class="rangee"><button class="lien" data-action="age-palier-moins">Retirer un état (${esc(nomPalier(D, k - 1) || 'aucun')})</button></div>` : ''}
    ${corps}
  </div>`;
}
async function finirDegatsAge(mod, f, texteFin) {
  const def = defFiche(mod, f.type);
  const g = etat.ageDeg;
  if (texteFin) g.lignes.push(texteFin);
  g.fini = true;
  await sauverPartie();
  await noter({ type: 'fiche', texte: `${nomFiche(f, def)} subit ${g.brut} dégât(s)${g.penetrants ? ' pénétrants' : ''} : ${g.lignes.slice(1).join(' ; ')}` });
}
async function actionDegatsAge(a, mod, f) {
  const def = defFiche(mod, f.type);
  const D = cfgPaliers(def);
  const g = etat.ageDeg;
  if (a === 'age-dg') {
    const n = lireEntier($('#age-dg-n')?.value ?? '', 0, 999);
    if (n == null) return toast('Entre un nombre de dégâts');
    const pen = !!$('#age-dg-pen')?.checked;
    const ctx = contexteFiche(mod, f, def);
    const resi = pen ? 0 : Math.max(0, ctx[D.resistance] ?? 0);
    const reste = Math.max(0, n - resi);
    const nomR = (def.derivees || []).find(x => x.id === D.resistance)?.abr || D.resistance;
    etat.ageDeg = { fiche: f.id, brut: n, penetrants: pen, reste, lignes: [`${n} dégât(s)${pen ? ' pénétrants' : ` − ${resi} ${nomR} = ${reste}`}`] };
    if (palierFiche(f) > D.paliers.length) etat.ageDeg.lignes.push('(déjà hors de combat)');
    if (!reste) await finirDegatsAge(mod, f, D.sansEffet || 'Aucun effet');
    return rendre();
  }
  if (!g || g.fiche !== f.id) return;
  if (a === 'age-dg-annuler') { etat.ageDeg = null; return rendre(); }
  if (a === 'age-dg-res') {
    const j = f.jauges[D.reserve];
    const n = lireEntier($('#age-dg-res')?.value ?? '', 0, 999);
    if (n == null) return toast('Entre un nombre de points');
    const m = Math.min(n, j.act, g.reste);
    const av = j.act;
    j.act -= m; g.reste -= m;
    const abr = (def.jauges || []).find(x => x.id === D.reserve)?.abr || D.reserve;
    g.lignes.push(`−${m} ${abr} (${av} → ${j.act}) : reste ${g.reste}`);
    if (!g.reste) await finirDegatsAge(mod, f, D.sansEffet || 'Aucun effet au-delà du cosmétique');
    else await sauverPartie();
    return rendre();
  }
  if (a === 'age-dg-palier') {
    const k = palierFiche(f);
    const p = D.paliers[k];
    if (!p) return;
    const phys = lireEntier($('#age-dg-d')?.value ?? '', 1, 6);
    const x = phys != null ? { total: phys, des: [phys], formule: '1d6' } : lancerExpression(p.reduction, {});
    f.palier = k + 1;
    g.reste = Math.max(0, g.reste - x.total);
    g.lignes.push(`État ${p.nom.toLowerCase()} : −${x.total} (${x.formule}${phys != null ? ', dé physique' : ''}) : reste ${g.reste}`);
    if (!g.reste) await finirDegatsAge(mod, f, `État : ${p.nom.toLowerCase()}`);
    else await sauverPartie();
    return rendre();
  }
  if (a === 'age-dg-hors') {
    f.palier = D.paliers.length + 1;
    await finirDegatsAge(mod, f, `${D.horsCombat?.nom || 'Hors de combat'}${D.horsCombat?.texte ? ' — ' + D.horsCombat.texte : ''}`);
    return rendre();
  }
}

/* ---------- Édition : compétences et armes ---------- */
function vueEditionAge(mod, f, def) {
  const C = competencesModule(mod);
  const comps = f.competences || [];
  return `<h3>Compétences</h3>
    ${comps.map((x, i) => `<div class="rangee edition-jauge"><span>${esc(texteCompetence(def, x))}</span>
      <select id="fe-comp-b-${i}">${[cfgAge(mod).bonusCompetence, cfgAge(mod).bonusCompetence + 1].map(v => `<option value="${v}" ${bonusCompetence(mod, x) === v ? 'selected' : ''}>${txtSigne(v)}</option>`).join('')}</select>
      <label class="case petit" style="flex:0 0 auto"><input type="checkbox" id="fe-comp-s-${i}"> retirer</label></div>`).join('') || '<p class="discret petit">Aucune.</p>'}
    <div class="rangee"><select id="fe-comp-c">${(def.caracs || []).map(k => `<option value="${esc(k.id)}">${esc(k.nom)}</option>`).join('')}</select>
      <input type="text" id="fe-comp-n" list="fe-comp-liste" placeholder="Compétence"></div>
    <datalist id="fe-comp-liste">${[...new Set(Object.values(C).flat())].map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <p class="discret petit">Pour en ajouter une : choisis la caractéristique, écris le nom, puis enregistre.</p>
    <h3>${esc(def.armes?.titre || 'Armes')}</h3>
    ${(f.armes || []).map((a, i) => `<div class="edition-arme">
      <input type="text" id="fe-a-${i}-nom" value="${esc(a.nom)}" placeholder="Nom">
      <div class="rangee"><select id="fe-a-${i}-carac"><option value="">— pas d’attaque —</option>${(def.caracs || []).map(k => `<option value="${esc(k.id)}" ${a.carac === k.id ? 'selected' : ''}>${esc(k.nom)}</option>`).join('')}</select>
        <input type="text" id="fe-a-${i}-comp" list="fe-comp-liste" value="${esc(a.comp || '')}" placeholder="Compétence"></div>
      <div class="rangee"><input type="text" id="fe-a-${i}-dm" value="${esc(a.dm || '')}" placeholder="Dégâts (ex. 2d6+PER)">
        <input type="text" id="fe-a-${i}-att" value="${esc(a.att ?? '')}" placeholder="Attaque fixe (PNJ)"></div>
      <input type="text" id="fe-a-${i}-notes" value="${esc(a.notes || '')}" placeholder="Notes (portée, qualités…)">
      <label class="case petit"><input type="checkbox" id="fe-a-${i}-feu" ${a.feu ? 'checked' : ''}> Arme à feu (enrayage)</label>
      <label class="case petit"><input type="checkbox" id="fe-a-${i}-suppr"> Supprimer cette arme</label>
    </div>`).join('')}
    <button class="lien" data-action="age-arme-plus">+ Ajouter une arme</button>`;
}
function lireEditionAge(mod, f, def) {
  const comps = [];
  (f.competences || []).forEach((x, i) => {
    if (document.getElementById('fe-comp-s-' + i)?.checked) return;
    const b = Number(document.getElementById('fe-comp-b-' + i)?.value);
    comps.push({ ...x, b: b === cfgAge(mod).bonusCompetence ? null : b });
  });
  f.competences = comps;
  const n = document.getElementById('fe-comp-n')?.value.trim();
  if (n) ajouterCompetence(f, { c: document.getElementById('fe-comp-c').value, n });
  const armes = [];
  (f.armes || []).forEach((a, i) => {
    if (document.getElementById(`fe-a-${i}-suppr`)?.checked) return;
    const v = id => document.getElementById(`fe-a-${i}-${id}`);
    if (!v('nom')) { armes.push(a); return; }
    const att = v('att').value.trim().replace('−', '-');
    armes.push({ nom: v('nom').value.trim() || a.nom || 'Arme', carac: v('carac').value, comp: v('comp').value.trim(), dm: v('dm').value.trim() || a.dm,
      att: att === '' || !Number.isFinite(Number(att)) ? null : Number(att), notes: v('notes').value.trim(), feu: v('feu').checked });
  });
  f.armes = armes;
}

/* ---------- Validation du module (appelée par validerModule) ---------- */
function validerAge(d, erreurs, avert) {
  if (d.test?.mode !== 'age') return;
  const C = d.competences || {};
  for (const [type, def] of Object.entries(d.fiches || {})) {
    const ids = new Set((def.caracs || []).map(k => k.id));
    for (const k of Object.keys(C)) if (def.caracs && !ids.has(k)) avert.push(`Compétences : caractéristique « ${k} » absente de la fiche « ${def.nom || type} ».`);
    const R = d.test.reserve;
    if (R && !(def.jauges || []).some(j => j.id === R.jauge) && def.caracs) avert.push(`Fiche « ${def.nom || type} » : jauge de réserve « ${R.jauge} » absente.`);
    for (const p of def.creation || []) {
      if (p.type === 'voies' && p.cas) for (const l of Object.values(p.cas)) for (const id of [].concat(l)) if (!(d.voies || []).some(v => v.id === id)) avert.push(`Création « ${def.nom || type} » / ${p.nom} : voie « ${id} » introuvable.`);
    }
  }
  const R = d.reservePartie;
  if (R) for (const s of R.seuils || []) if (s.table && !(d.tables || []).some(t => t.id === s.table)) avert.push(`${R.nom} : table « ${s.table} » introuvable.`);
}

/* ---------- Actions (appelées par actionJeuPlus) ---------- */
async function actionAge(a, b, mod, f, c) {
  switch (a) {
    case 'age-comp': {
      const p = pasCourant(mod, c);
      const n = p.choisir || 1;
      if (!c.courant || c.courant.type !== 'competences') c.courant = { type: 'competences', ids: [] };
      const ids = c.courant.ids;
      const v = b.dataset.v;
      if (ids.includes(v)) ids.splice(ids.indexOf(v), 1);
      else { ids.push(v); while (ids.length > n) ids.shift(); }
      await sauverPartie(); return rendre();
    }
    case 'age-tirage-phys': {
      const p = pasCourant(mod, c);
      const def = defFiche(mod, c.type);
      const v = (def.caracs || []).map((_, i) => lireEntier($('#cr-age-' + i)?.value ?? '', 3, 18));
      if (v.some(x => x == null)) return toast('Entre un total entre 3 et 18 pour chaque caractéristique');
      c.courant = tirerEtapeAge(mod, c, p, v);
      await sauverPartie(); return rendre();
    }
    case 'age-echanger': {
      const x = $('#cr-ech-a').value, y = $('#cr-ech-b').value;
      if (x === y) return toast('Choisis deux caractéristiques différentes');
      const r = c.courant;
      const def = defFiche(mod, c.type);
      const ix = r.ordre.indexOf(x), iy = r.ordre.indexOf(y);
      const jx = r.jets[ix], jy = r.jets[iy];
      r.jets[ix] = { ...jy, de: jy.de || jy.id }; r.jets[iy] = { ...jx, de: jx.de || jx.id };
      r.echanges.push(`${caracDef(def, x).abr || x} ↔ ${caracDef(def, y).abr || y}`);
      await sauverPartie(); return rendre();
    }
    case 'age-achat': {
      const p = pasCourant(mod, c);
      const def = defFiche(mod, c.type);
      if (!c.courant || c.courant.type !== 'achat') c.courant = { type: 'achat', valeurs: Object.fromEntries((def.caracs || []).map(k => [k.id, p.min ?? 0])) };
      const k = b.dataset.k;
      c.courant.valeurs[k] = Math.max(p.min ?? 0, Math.min(p.max ?? 3, c.courant.valeurs[k] + Number(b.dataset.v)));
      await sauverPartie(); return rendre();
    }
    case 'age-nd': etat.tsDiff = String(etat.tsDiff) === b.dataset.v ? '' : b.dataset.v; return rendre();
    case 'age-test': return testAge(mod, f, { carac: b.dataset.k, comp: b.dataset.c, compteur: b.dataset.cpt });
    case 'age-att': return testAge(mod, f, { arme: Number(b.dataset.i) });
    case 'age-dm': return lancerDMAge(mod, f, Number(b.dataset.i));
    case 'age-dm-extra': {
      const r = etat.dernier.jet;
      return lancerDMAge(mod, ficheParId(r.origine.slice(6)), r.arme, Number(b.dataset.i));
    }
    case 'age-res-ouvrir': etat.ageReserve = etat.dernier.jet?.libelle; return rendre();
    case 'age-res-fermer': etat.ageReserve = null; return rendre();
    case 'age-res-appliquer': return depenserReserveDe(mod);
    case 'age-dg': case 'age-dg-res': case 'age-dg-palier': case 'age-dg-hors': case 'age-dg-annuler': return actionDegatsAge(a, mod, f);
    case 'age-palier-moins': {
      const def = defFiche(mod, f.type);
      const D = cfgPaliers(def);
      const av = nomPalier(D, palierFiche(f));
      f.palier = Math.max(0, palierFiche(f) - 1);
      etat.ageDeg = null;
      await sauverPartie();
      await noter({ type: 'fiche', texte: `${nomFiche(f, def)} : ${av.toLowerCase()} → ${nomPalier(D, f.palier).toLowerCase() || 'aucun état de blessure'}` });
      return rendre();
    }
    case 'age-arme-plus': {
      await enregistrerEdition_fiche(mod, f, true);
      f.armes = [...(f.armes || []), { nom: 'Nouvelle arme', carac: '', comp: '', dm: '1d6', notes: '' }];
      await sauverPartie(); return rendre();
    }
    case 'age-res': return modifierReserve(mod, Number(b.dataset.v), 'manuel').then(rendre);
    case 'age-res-zero': {
      const s = etatReserve();
      const R = cfgReserveAge(mod);
      if (!confirm(`Remettre ${R.nom.toLowerCase()} à 0 ?`)) return;
      const av = s.valeur; s.valeur = 0; s.alerte = null;
      await sauverPartie(); await noter({ type: 'note', texte: `${R.nom} remise à 0 (était ${av})` });
      return rendre();
    }
    case 'age-res-actif': { const s = etatReserve(); s.actif = !s.actif; await sauverPartie(); return rendre(); }
    case 'age-res-table': return lancerTableJeu(mod, b.dataset.t, null, 'reserve');
    case 'age-res-vu': {
      const s = etatReserve();
      const R = cfgReserveAge(mod);
      const seuil = (R.seuils || []).find(x => x.valeur === s.alerte);
      s.alerte = null;
      if (seuil?.remise) { const av = s.valeur; s.valeur = 0; await noter({ type: 'note', texte: `${R.nom} remise à 0 (était ${av})` }); }
      if (etat.dernier.table?.origine === 'reserve') etat.dernier.table = null;
      await sauverPartie(); return rendre();
    }
  }
  return undefined;
}

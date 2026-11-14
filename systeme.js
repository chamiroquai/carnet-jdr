/* Carnet JDR — extensions de fiche (étape 4) : caractéristiques à modificateur, niveau,
   valeurs calculées par formule, tests « d20 + modificateur ≥ difficulté », points de chance,
   voies et rangs, armes, nouvelles étapes de création.
   Moteur générique : aucun contenu de jeu ici. Chargé après jeu.js, avant app.js. */
'use strict';

/* ---------- Formules : « 10+AGI », « min(niveau,10)+FOR », « si(sorts>0, VOL+sorts, 0) » ---------- */
const FONCTIONS_FORMULE = {
  min: Math.min, max: Math.max, floor: Math.floor, plancher: Math.floor, ceil: Math.ceil, abs: Math.abs,
  si: (c, a, b) => (c ? a : b ?? 0),
};
function evaluerFormule(src, ctx) {
  const s = String(src ?? '').trim();
  let i = 0;
  const err = m => { throw new Error(`Formule « ${s} » : ${m}`); };
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const eat = t => { ws(); if (s.startsWith(t, i)) { i += t.length; return true; } return false; };
  function primaire() {
    ws();
    if (eat('(')) { const v = comparaison(); if (!eat(')')) err('parenthèse fermante attendue'); return v; }
    if (eat('-')) return -primaire();
    if (eat('+')) return primaire();
    const n = s.slice(i).match(/^\d+(?:\.\d+)?/);
    if (n) { i += n[0].length; return Number(n[0]); }
    const id = s.slice(i).match(/^[A-Za-z_À-ſ][\wÀ-ſ]*/);
    if (!id) err(`symbole inattendu « ${s[i] ?? 'fin'} »`);
    i += id[0].length;
    if (eat('(')) {
      const f = FONCTIONS_FORMULE[id[0]];
      if (!f) err(`fonction « ${id[0]} » inconnue`);
      const args = [];
      if (!eat(')')) { do args.push(comparaison()); while (eat(',')); if (!eat(')')) err('parenthèse fermante attendue'); }
      return f(...args);
    }
    const v = Number(ctx?.[id[0]]);
    return Number.isFinite(v) ? v : 0;
  }
  function produit() {
    let v = primaire();
    for (;;) {
      if (eat('*')) v *= primaire();
      else if (eat('/')) { const d = primaire(); v = d ? v / d : 0; }
      else return v;
    }
  }
  function somme() {
    let v = produit();
    for (;;) {
      if (eat('+')) v += produit();
      else if (eat('-')) v -= produit();
      else return v;
    }
  }
  function comparaison() {
    const v = somme();
    for (const op of ['>=', '<=', '==', '!=', '>', '<']) {
      if (eat(op)) {
        const w = somme();
        return ({ '>=': v >= w, '<=': v <= w, '==': v === w, '!=': v !== w, '>': v > w, '<': v < w }[op]) ? 1 : 0;
      }
    }
    return v;
  }
  if (!s) return 0;
  const v = comparaison();
  ws();
  if (i < s.length) err(`« ${s.slice(i)} » en trop`);
  return v;
}

/* Expression avec dés : « 1d{drDe}+floor(niveau/2) », « 1d8+FOR ». Les dés sont additionnés. */
function analyserExpression(src, ctx) {
  const s = remplirModele(String(src ?? ''), ctx);
  const des = [];
  const reste = s.replace(/(\d*)d(\d+)/gi, (_, n, f) => { des.push({ n: n ? Number(n) : 1, faces: Number(f) }); return '0'; });
  let cst = 0;
  try { cst = Math.round(evaluerFormule(reste, ctx)); } catch { cst = 0; }
  return { des, cst };
}
function texteExpression(src, ctx) {
  const { des, cst } = analyserExpression(src, ctx);
  const d = des.map(x => `${x.n}d${x.faces}`).join(' + ');
  return d ? `${d}${cst ? ' ' + signe(cst) : ''}` : String(cst);
}
function lancerExpression(src, ctx) {
  const { des, cst } = analyserExpression(src, ctx);
  const valeurs = [];
  for (const x of des) for (let k = 0; k < x.n; k++) valeurs.push(de(x.faces));
  return { des: valeurs, cst, total: valeurs.reduce((a, b) => a + b, 0) + cst, formule: texteExpression(src, ctx) };
}

/* ---------- Voies ---------- */
function voieParId(mod, id) { return (mod?.voies || []).find(v => v.id === id) || null; }
const debutVoie = v => v?.debut || 1;
const finVoie = v => debutVoie(v) + (v?.capacites || []).length - 1;
function capsAcquises(v, rang) { return (v?.capacites || []).slice(0, Math.max(0, rang - debutVoie(v) + 1)); }
function regleVoies(def) {
  return { titre: 'Voies et capacités', cout: [1, 1, 2, 2, 2, 2, 2, 2], niveau: [1, 2, 3, 5, 7, 9, 11, 13], parNiveau: 2, ...(def?.voies || {}) };
}
function nbSorts(mod, f) {
  let n = 0;
  for (const x of f.voies || []) n += capsAcquises(voieParId(mod, x.id), x.rang).filter(c => c.includes('*')).length;
  return n;
}
function coutVoies(mod, f, def) {
  const R = regleVoies(def);
  let s = 0;
  for (const x of f.voies || []) for (let r = debutVoie(voieParId(mod, x.id)); r <= x.rang; r++) s += R.cout[r - 1] ?? 2;
  return s;
}
function pointsDispo(mod, f, def) {
  const R = regleVoies(def);
  return R.parNiveau * ((f.niveau ?? 1) - 1) + (f.pointsGratuits || 0) + (f.bonus?.points || 0) - coutVoies(mod, f, def);
}
function libelleTypeVoie(mod, v, f) {
  const t = mod?.typesVoies?.[v.type];
  if (t != null) return t;
  return v.type === 'profil' && v.groupe && v.groupe !== f?.vars?.profil ? v.groupe : '';
}
/* « de FOR », « d’INT » */
const deCarac = abr => (/^[AEIOUYÉÈÊ]/i.test(abr) ? 'd’' : 'de ') + abr;

/* ---------- Contexte de calcul d'une fiche ---------- */
function contexteFiche(mod, f, def, extra) {
  const ctx = { niveau: f.niveau ?? 1 };
  for (const [k, v] of Object.entries({ ...(f.vars || {}), ...(extra || {}) })) ctx[k] = v;
  for (const [k, v] of Object.entries(f.compteurs || {})) if (!(k in ctx)) ctx[k] = v;
  for (const c of def.caracs || []) ctx[c.id] = f.caracs?.[c.id] ?? 0;
  ctx.sorts = nbSorts(mod, f);
  for (const d of def.derivees || []) {
    let v = 0;
    try { v = Math.round(evaluerFormule(d.formule, ctx)); } catch { v = 0; }
    ctx[d.id] = v + (f.bonus?.[d.id] || 0);
  }
  return ctx;
}
function texteDerivee(d, v) {
  if (d.format === 'de') return `d${v}`;
  if (d.format === 'signe') return v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '+0';
  return String(v);
}
const txtSigne = v => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '+0');

/* Recalcule les maximums des jauges à formule ; l'actuel suit la variation du maximum */
function recalculerFiche(mod, f, def, extra) {
  if (!def) return false;
  const ctx = contexteFiche(mod, f, def, extra);
  let change = false;
  for (const j of def.jauges || []) {
    if (!j.maxFormule) continue;
    let max;
    try { max = Math.round(evaluerFormule(j.maxFormule, ctx)); } catch { continue; }
    max = Math.max(0, max + (f.bonus?.[j.id] || 0));
    const v = f.jauges[j.id] || (f.jauges[j.id] = { max: 0, act: 0 });
    if (v.max !== max) {
      v.act = Math.max(0, Math.min(max, v.act + (max - v.max)));
      v.max = max;
      change = true;
    }
  }
  return change;
}

function completerFiche(f, def) {
  if (def.caracs && !f.caracs) f.caracs = Object.fromEntries(def.caracs.map(c => [c.id, c.defaut ?? 0]));
  if (def.niveau && f.niveau == null) f.niveau = def.niveau.depart ?? 1;
  if (!f.vars) f.vars = {};
  if (!f.bonus) f.bonus = {};
  if (def.armes && !f.armes) f.armes = [];
  if (def.voies && !f.voies) f.voies = [];
  return f;
}

/* ---------- Validation (appelée par validerModule) ---------- */
function validerModulePlus(d, erreurs, avert) {
  const ids = new Set();
  for (const v of d.voies || []) {
    if (!v.id || !v.nom) { erreurs.push(`Voie sans id ou sans nom (« ${v.nom ?? v.id ?? '?'} »).`); continue; }
    if (ids.has(v.id)) erreurs.push(`Voie « ${v.id} » en double.`);
    ids.add(v.id);
    if (!Array.isArray(v.capacites) || !v.capacites.length) avert.push(`Voie « ${v.nom} » : aucune capacité listée.`);
  }
  const essai = def => {
    const ctx = { niveau: 1 };
    for (const c of def.caracs || []) ctx[c.id] = 0;
    return ctx;
  };
  for (const [type, def] of Object.entries(d.fiches || {})) {
    const ctx = essai(def);
    const formules = [...(def.derivees || []).map(x => [x.nom, x.formule]), ...(def.jauges || []).filter(j => j.maxFormule).map(j => [j.nom, j.maxFormule])];
    for (const [nom, fo] of formules) { try { evaluerFormule(fo, ctx); } catch (e) { erreurs.push(`Fiche « ${def.nom || type} » / ${nom} : ${e.message}`); } }
    for (const p of def.creation || []) {
      if (p.type === 'voie' && !String(p.voie).includes('{') && !ids.has(p.voie)) avert.push(`Création « ${def.nom || type} » / ${p.nom} : voie « ${p.voie} » introuvable.`);
      if (p.type === 'voies' && p.mode !== 'monter' && !(d.voies || []).length) avert.push(`Création « ${def.nom || type} » / ${p.nom} : aucune voie dans le module.`);
    }
  }
}

/* ---------- Création : conditions d'étape ---------- */
function etapeActive(p, vars) {
  const ok = (cond, attendu) => Object.entries(cond || {}).every(([k, v]) => [].concat(v).map(String).includes(String(vars?.[k] ?? '')) === attendu);
  return ok(p.si, true) && ok(p.siPas, false);
}
function sauterEtapesInactives(mod, c) {
  const et = defFiche(mod, c.type).creation || [];
  while (c.pas < et.length && !etapeActive(et[c.pas], c.vars)) c.pas++;
}
const ETAPES_SANS_JET = ['saisie', 'objets', 'repartition', 'ajustement', 'voie', 'voies'];

function serieRepartition(p, vars) {
  const s = p.series?.[vars?.[p.serieVar]] || Object.values(p.series || {})[0] || [];
  return [...s].sort((a, b) => b - a);
}
function prerepartition(def, p, vars) {
  const caracs = (def.caracs || []).map(x => x.id);
  const prio = String(vars?.[p.prioriteVar] || '').split(',').map(x => x.trim()).filter(x => caracs.includes(x));
  const ordre = [...new Set([...prio, ...caracs])];
  const s = serieRepartition(p, vars);
  // Les caractéristiques prioritaires reçoivent les meilleures valeurs ; le reste suit l'ordre de la fiche,
  // la plus faible valeur allant à la dernière.
  return Object.fromEntries(ordre.map((id, k) => [id, s[k] ?? 0]));
}
function optionsAjustement(a, caracsFiche) {
  if (a.parmi) return a.parmi;
  if (a.plusFaibles) {
    const vals = Object.values(caracsFiche).sort((x, y) => x - y);
    const seuil = vals[Math.min(vals.length, a.plusFaibles) - 1];
    return Object.keys(caracsFiche).filter(k => caracsFiche[k] <= seuil);
  }
  return Object.keys(caracsFiche);
}
function listeAjustements(p, vars) { return p.cas?.[vars?.[p.parVar]] || p.ajustements || []; }
function objetsEtape(p, vars) { return [...(p.objets || []), ...((p.cas || {})[vars?.[p.parVar]] || [])]; }

function optionsVoiesEtape(mod, c, p) {
  const f = c.fiche;
  const acquises = new Set((f.voies || []).map(x => x.id));
  if (p.mode === 'monter') {
    const types = p.parmi?.types;
    return (f.voies || []).map(x => ({ x, v: voieParId(mod, x.id) }))
      .filter(({ x, v }) => v && (!types || types.includes(v.type)) && x.rang < (p.rang || finVoie(v)) && x.rang < finVoie(v))
      .map(({ x, v }) => ({ v, rang: p.rang ? Math.min(p.rang, finVoie(v)) : x.rang + 1 }));
  }
  const groupe = p.parmi?.groupe ? remplirModele(p.parmi.groupe, c.vars) : null;
  const types = p.parmi?.types;
  return (mod.voies || []).filter(v => !acquises.has(v.id) && (!groupe || v.groupe === groupe) && (!types || types.includes(v.type)))
    .map(v => ({ v, rang: p.rang || debutVoie(v) }));
}

function corpsEtapePlus(mod, c, p, r) {
  const def = defFiche(mod, c.type);
  const f = c.fiche;
  const abr = id => def.caracs?.find(x => x.id === id)?.abr || id;
  if (p.type === 'repartition') {
    const serie = serieRepartition(p, c.vars);
    const val = r?.valeurs || prerepartition(def, p, c.vars);
    const uniques = [...new Set(serie)];
    return `<p class="discret petit">Série : ${serie.map(txtSigne).join(', ')} — chaque valeur une fois.</p>
      <div class="repartition">${(def.caracs || []).map(k => `<label class="rep-ligne"><span><strong>${esc(k.abr || k.id)}</strong> <small class="discret">${esc(k.nom)}</small></span>
        <select id="cr-rep-${esc(k.id)}">${uniques.map(v => `<option value="${v}" ${val[k.id] === v ? 'selected' : ''}>${txtSigne(v)}</option>`).join('')}</select></label>`).join('')}</div>`;
  }
  if (p.type === 'ajustement') {
    const liste = listeAjustements(p, c.vars);
    if (!liste.length) return `<p class="discret petit">Aucun ajustement pour ce choix.</p>`;
    const choix = r?.choix || [];
    return liste.map((a, k) => {
      const opts = optionsAjustement(a, f.caracs || {});
      const sel = choix[k] ?? (opts.length === 1 ? opts[0] : null);
      return `<h3>${a.mod > 0 ? '+' : '−'}${Math.abs(a.mod)} ${a.plusFaibles ? `à l'une des ${a.plusFaibles} plus faibles` : opts.length > 1 ? 'au choix' : ''}</h3>
        <div class="puces">${opts.map(id => `<button class="puce ${sel === id ? 'choisie' : ''}" data-action="cr-ajust" data-k="${k}" data-v="${esc(id)}">${esc(abr(id))} ${txtSigne(f.caracs?.[id] ?? 0)} → ${txtSigne((f.caracs?.[id] ?? 0) + a.mod)}</button>`).join('')}</div>`;
    }).join('');
  }
  if (p.type === 'voie') {
    const v = voieParId(mod, remplirModele(p.voie, c.vars));
    if (!v) return `<p class="force">Voie « ${esc(remplirModele(p.voie, c.vars))} » introuvable (étape précédente passée ?).</p>`;
    const rang = p.rang || debutVoie(v);
    return `<div class="resultat gauche"><div class="reponse petit-rep">${esc(v.nom)}</div>
      <ol class="caps">${capsAcquises(v, rang).map((cap, i) => `<li class="acquise"><span class="n">${debutVoie(v) + i}</span>${esc(cap)}</li>`).join('')}</ol></div>`;
  }
  if (p.type === 'voies') {
    const opts = optionsVoiesEtape(mod, c, p);
    const n = p.choisir || 1;
    const ids = r?.ids || [];
    if (!opts.length) return `<p class="discret petit">Aucune voie disponible pour cette étape.</p>`;
    return `<p class="discret petit">Choisis ${n} voie${n > 1 ? 's' : ''} (${ids.length}/${n}).</p>
      <div class="pile">${opts.map(({ v, rang }) => {
        const cap = v.capacites[rang - debutVoie(v)];
        return `<button class="${ids.includes(v.id) ? 'choisi' : ''}" data-action="cr-voie" data-id="${esc(v.id)}">${esc(v.nom)}<small class="discret"> — ${rang}. ${esc(cap || '')}</small></button>`;
      }).join('')}</div>`;
  }
  if (p.type === 'objets') {
    const liste = objetsEtape(p, c.vars);
    return `<ul class="liste-simple">${liste.map(o => `<li>${esc(o.texte)}</li>`).join('')}</ul>`;
  }
  return '';
}

function ajouterVoie(f, v, rang) {
  const x = (f.voies || (f.voies = [])).find(y => y.id === v.id);
  if (x) x.rang = Math.max(x.rang, rang);
  else f.voies.push({ id: v.id, rang });
}

/* Applique une étape sans jet ; renvoie false (avec un message) si l'étape n'est pas complète */
function validerEtapePlus(mod, c, p) {
  const f = c.fiche;
  const def = defFiche(mod, c.type);
  const abr = id => def.caracs?.find(x => x.id === id)?.abr || id;
  const lignes = [];
  if (p.type === 'repartition') {
    const serie = serieRepartition(p, c.vars);
    const val = {};
    for (const k of def.caracs || []) val[k.id] = Number(document.getElementById('cr-rep-' + k.id)?.value ?? 0);
    const donne = Object.values(val).sort((a, b) => b - a);
    if (donne.join() !== serie.join()) {
      c.courant = { type: 'repartition', valeurs: val };
      toast(`Chaque valeur de la série doit servir une fois (${serie.map(txtSigne).join(', ')})`);
      return false;
    }
    f.caracs = { ...(f.caracs || {}), ...val };
    lignes.push(`${p.nom} : ${(def.caracs || []).map(k => `${abr(k.id)} ${txtSigne(val[k.id])}`).join(', ')}`);
  } else if (p.type === 'ajustement') {
    const liste = listeAjustements(p, c.vars);
    const choix = c.courant?.choix || [];
    const parts = [];
    const caracs = { ...(f.caracs || {}) };
    for (let k = 0; k < liste.length; k++) {
      const opts = optionsAjustement(liste[k], f.caracs || {});
      const id = choix[k] ?? (opts.length === 1 ? opts[0] : null);
      if (!id) { toast('Fais un choix pour chaque ajustement'); return false; }
      caracs[id] = (caracs[id] ?? 0) + liste[k].mod;
      parts.push(`${abr(id)} ${liste[k].mod > 0 ? '+' : '−'}${Math.abs(liste[k].mod)}`);
    }
    f.caracs = caracs;
    if (parts.length) lignes.push(`${p.nom} : ${parts.join(', ')}`);
  } else if (p.type === 'voie') {
    const v = voieParId(mod, remplirModele(p.voie, c.vars));
    if (!v) { toast('Voie introuvable : passe cette étape'); return false; }
    const rang = p.rang || debutVoie(v);
    ajouterVoie(f, v, rang);
    lignes.push(`${p.nom} : ${v.nom} (${capsAcquises(v, rang).map((x, i) => `${debutVoie(v) + i}. ${x}`).join(', ')})`);
  } else if (p.type === 'voies') {
    const n = p.choisir || 1;
    const ids = c.courant?.ids || [];
    if (ids.length !== n) { toast(`Choisis ${n} voie${n > 1 ? 's' : ''}`); return false; }
    const opts = optionsVoiesEtape(mod, c, p);
    for (const id of ids) {
      const o = opts.find(x => x.v.id === id);
      if (!o) continue;
      ajouterVoie(f, o.v, o.rang);
      lignes.push(`${p.nom} : ${o.v.nom}, rang ${o.rang} (${o.v.capacites[o.rang - debutVoie(o.v)]})`);
    }
  }
  c.resume.push(...lignes);
  return true;
}

/* Effets supplémentaires : bonus et caractéristiques (appelé par appliquerEffets) */
function appliquerEffetPlus(f, ef) {
  if (ef.bonus != null) {
    f.bonus = f.bonus || {};
    if (ef.fixer != null) f.bonus[ef.bonus] = ef.fixer;
    if (ef.mod) f.bonus[ef.bonus] = (f.bonus[ef.bonus] || 0) + ef.mod;
  }
  if (ef.carac != null) {
    f.caracs = f.caracs || {};
    if (ef.fixer != null) f.caracs[ef.carac] = ef.fixer;
    if (ef.mod) f.caracs[ef.carac] = (f.caracs[ef.carac] || 0) + ef.mod;
  }
}

function apercuCreationPlus(mod, c) {
  const def = defFiche(mod, c.type);
  const f = c.fiche;
  if (!def.caracs && !def.voies && !def.derivees) return '';
  const tmp = { ...f, jauges: JSON.parse(JSON.stringify(f.jauges || {})), vars: { ...(f.vars || {}), ...c.vars } };
  recalculerFiche(mod, tmp, def);
  const ctx = contexteFiche(mod, tmp, def);
  let html = '';
  if (def.caracs) html += `<p class="petit">${def.caracs.map(k => `${esc(k.abr || k.id)} ${txtSigne(f.caracs?.[k.id] ?? 0)}`).join(' · ')}</p>`;
  const jf = (def.jauges || []).filter(j => j.maxFormule && !(j.masquerSiZero && !tmp.jauges[j.id]?.max));
  if (jf.length) html += `<p class="petit">${jf.map(j => `${esc(j.abr || j.nom)} ${tmp.jauges[j.id]?.max ?? 0}${j.deVar && ctx[j.deVar] ? ' (d' + ctx[j.deVar] + ')' : ''}`).join(' · ')}</p>`;
  if (def.derivees) html += `<p class="petit">${def.derivees.map(d => `${esc(d.abr || d.nom)} ${texteDerivee(d, ctx[d.id])}`).join(' · ')}</p>`;
  if ((f.voies || []).length) html += `<p class="petit"><strong>Voies :</strong> ${f.voies.map(x => { const v = voieParId(mod, x.id); return `${esc(v?.nom || x.id)} (rang ${x.rang})`; }).join(', ')}</p>`;
  if ((f.armes || []).length) html += `<p class="petit"><strong>Armes :</strong> ${f.armes.map(a => esc(a.nom)).join(', ')}</p>`;
  return html;
}

/* ---------- Rendu : en-tête de fiche (niveau, valeurs calculées) ---------- */
function vueEnteteFichePlus(mod, f, def) {
  if (!def.niveau && !def.derivees) return '';
  const ctx = contexteFiche(mod, f, def);
  let html = '';
  if (def.niveau) html += `<div class="rangee niveau"><span><strong>${esc(def.niveau.nom || 'Niveau')} ${f.niveau ?? 1}</strong></span>
    <button class="lien" style="text-align:right" data-action="niv-plus">Passer au niveau ${(f.niveau ?? 1) + 1}</button></div>`;
  if (def.derivees) html += `<div class="derivees">${def.derivees.map(d => {
    const v = ctx[d.id];
    const inner = `<small>${esc(d.nom)}</small><strong>${texteDerivee(d, v)}</strong>`;
    return d.test ? `<button class="derivee" data-action="ts" data-d="${esc(d.id)}">${inner}</button>` : `<div class="derivee">${inner}</div>`;
  }).join('')}</div>`;
  return html;
}

/* ---------- Rendu : tests « d20 + modificateur » ---------- */
function vueTestsBonus(mod, f, def) {
  const t = mod.test;
  const mode = etat.modeSauvegarde || 'normal';
  const ctx = contexteFiche(mod, f, def);
  const attaques = (def.derivees || []).filter(d => d.test);
  const m = etat.tsMod || 0;
  const resJet = etat.dernier.jet?.origine === 'fiche:' + f.id && etat.dernier.jet.arme == null ? rendreResultatJet(etat.dernier.jet) : '';
  return `<div class="carte" id="carte-tests">
    <h2>${esc(t.nom || 'Test')}s</h2>
    <div class="puces">${[['normal', 'Normal'], ['avantage', t.libelleBonus || 'Dé bonus'], ['desavantage', t.libelleMalus || 'Dé malus']].map(([k, l]) =>
      `<button class="puce ${mode === k ? 'choisie' : ''}" data-action="sv-mode" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="rangee reglages-test">
      <div class="stepper"><span class="discret petit">Modificateur</span><div class="rangee serree">
        <button data-action="ts-mod" data-v="-1" aria-label="Moins">−</button><output>${txtSigne(m)}</output><button data-action="ts-mod" data-v="1" aria-label="Plus">+</button></div></div>
      <div class="stepper"><span class="discret petit">${esc(t.libelleSeuil || 'Difficulté')}</span>
        <input type="number" inputmode="numeric" id="ts-diff" placeholder="—" value="${esc(etat.tsDiff ?? '')}"></div>
    </div>
    <div class="grille-4" style="margin-top:10px">${(def.caracs || []).map(k =>
      `<button data-action="ts" data-k="${esc(k.id)}"><strong>${esc(k.abr || k.id)}</strong><small class="discret"> ${txtSigne(ctx[k.id])}</small></button>`).join('')}</div>
    ${attaques.length ? `<div class="grille-3" style="margin-top:8px">${attaques.map(d =>
      `<button data-action="ts" data-d="${esc(d.id)}"><strong>${esc(d.abr || d.nom)}</strong><small class="discret"> ${texteDerivee(d, ctx[d.id])}</small></button>`).join('')}</div>` : ''}
    <details class="de-physique" data-garde="sv-phys"><summary>Avec mes dés : saisis-les puis touche le test</summary>
      <div class="rangee"><input type="number" inputmode="numeric" id="sv-0" placeholder="d${t.de || 20}">${mode !== 'normal' ? `<input type="number" inputmode="numeric" id="sv-1" placeholder="d${t.de || 20}">` : ''}</div>
    </details>
    ${t.aide ? `<p class="discret petit">${esc(t.aide)}</p>` : ''}
    ${resJet}
  </div>`;
}

async function testBonus(mod, f, { carac, derivee, arme }) {
  const def = defFiche(mod, f.type);
  const t = mod.test;
  const faces = t.de || 20;
  const ctx = contexteFiche(mod, f, def);
  const mode = etat.modeSauvegarde || 'normal';
  const n = mode === 'normal' ? 1 : 2;
  const a = $('#sv-0')?.value.trim(), b = $('#sv-1')?.value.trim();
  let valeurs = null;
  if (a) {
    valeurs = [lireEntier(a, 1, faces), n === 2 ? lireEntier(b, 1, faces) : 0].slice(0, n);
    if (valeurs.some(v => v == null)) return toast(`Entre ${n === 2 ? 'deux valeurs' : 'une valeur'} entre 1 et ${faces}`);
  }
  const dTxt = $('#ts-diff')?.value.trim() ?? '';
  etat.tsDiff = dTxt;
  const seuil = dTxt === '' ? null : lireEntier(dTxt, -99, 999);
  const d = derivee ? def.derivees.find(x => x.id === derivee) : null;
  const k = carac ? def.caracs.find(x => x.id === carac) : null;
  const base = carac ? ctx[carac] : ctx[derivee];
  const modif = etat.tsMod || 0;
  const arm = arme != null ? f.armes?.[arme] : null;
  const quoi = arm ? `${arm.nom} (${d?.abr || d?.nom || ''})` : k ? `${t.nom || 'Test'} ${deCarac(k.abr || k.id)}` : (d?.nom || derivee);
  const libelle = `${quoi}${modif ? ' ' + txtSigne(modif) : ''}${mode === 'avantage' ? ` avec ${(t.libelleBonus || 'dé bonus').toLowerCase()}` : mode === 'desavantage' ? ` avec ${(t.libelleMalus || 'dé malus').toLowerCase()}` : ''} — ${nomFiche(f, def)}`;
  const cfg = { faces, n, garde: mode === 'avantage' ? 'h' : mode === 'desavantage' ? 'l' : 'tous', k: 1, mod: base + modif, comp: '>=', seuil: seuil ?? '', libelle };
  const r = calculerJet(cfg, valeurs);
  const nat = r.des[r.gardes[0]];
  const attaque = !!derivee;
  if (nat >= (t.critique || faces)) {
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
  await noter({ type: 'jet', physique: !!valeurs, ...r });
  etat.dernier.jet = { ...r, physique: !!valeurs, origine: 'fiche:' + f.id, arme: arme ?? null };
  await rendre();
  document.getElementById(arm ? 'carte-armes' : 'carte-tests')?.querySelector('.resultat')?.scrollIntoView({ block: 'nearest' });
}

/* Boutons ajoutés sous le résultat d'un jet de fiche : point de chance, dommages de l'arme */
function boutonsJetSupp(r) {
  if (!r?.origine?.startsWith('fiche:')) return '';
  const mod = moduleActif();
  const f = ficheParId(r.origine.slice(6));
  if (!mod || !f) return '';
  const def = defFiche(mod, f.type);
  let html = '';
  if (r.arme != null && f.armes?.[r.arme] && r.reussite !== false && !r.dm) {
    html += `<button data-action="arme-dm" data-i="${r.arme}" data-crit="${r.critique ? 1 : 0}">${r.critique ? 'Dommages ×2 (critique)' : 'Dommages'} : ${esc(texteExpression(f.armes[r.arme].dm, contexteFiche(mod, f, def)))}</button>`;
  }
  const ch = mod.test?.chance;
  const j = ch ? f.jauges?.[ch.jauge] : null;
  if (ch && j && j.act > 0 && !r.chance && !r.dm) {
    const jd = def.jauges.find(x => x.id === ch.jauge);
    html += `<button data-action="jet-chance">Dépenser 1 ${esc(jd?.abr || ch.jauge)} : +${ch.bonus} <small class="discret">(reste ${j.act})</small></button>`;
  }
  return html ? `<div class="pile" style="margin-top:10px">${html}</div>` : '';
}

/* ---------- Rendu : armes ---------- */
function vueArmes(mod, f, def) {
  const ctx = contexteFiche(mod, f, def);
  const resJet = etat.dernier.jet?.origine === 'fiche:' + f.id && etat.dernier.jet.arme != null ? rendreResultatJet(etat.dernier.jet) : '';
  return `<div class="carte" id="carte-armes">
    <h2>${esc(def.armes.titre || 'Armes')}</h2>
    ${(f.armes || []).length ? f.armes.map((a, i) => {
      const d = def.derivees?.find(x => x.id === a.attaque);
      return `<div class="ligne-arme">
        <div class="arme-nom"><strong>${esc(a.nom)}</strong>
          <div class="discret petit">${d ? `${esc(d.abr || d.nom)} ${texteDerivee(d, ctx[d.id])} · ` : ''}DM ${esc(texteExpression(a.dm, ctx))}${a.notes ? ' · ' + esc(a.notes) : ''}</div></div>
        ${d ? `<button data-action="arme-att" data-i="${i}">Attaque</button>` : ''}
        <button data-action="arme-dm" data-i="${i}">DM</button>
      </div>`;
    }).join('') : '<p class="discret petit">Aucune arme. Ajoute-les avec « Modifier ».</p>'}
    ${def.armes.aide ? `<p class="discret petit">${esc(def.armes.aide)}</p>` : ''}
    ${resJet}
  </div>`;
}

async function lancerDM(mod, f, i, double) {
  const def = defFiche(mod, f.type);
  const a = f.armes[i];
  const ctx = contexteFiche(mod, f, def);
  const x = lancerExpression(a.dm, ctx);
  let total = Math.max(def.armes?.minimum ?? 1, x.total);
  if (double) total *= 2;
  const r = {
    formule: x.formule + (double ? ' × 2' : ''), faces: 0, des: x.des, gardes: x.des.map((_, k) => k), mod: x.cst, total,
    comp: null, seuil: null, reussite: null, libelle: `Dommages ${a.nom}${double ? ' ×2 (critique)' : ''} — ${nomFiche(f, def)}`,
  };
  await noter({ type: 'jet', physique: false, ...r });
  etat.dernier.jet = { ...r, physique: false, origine: 'fiche:' + f.id, arme: i, dm: true };
  await rendre();
  document.getElementById('carte-armes')?.querySelector('.resultat')?.scrollIntoView({ block: 'nearest' });
}

/* ---------- Rendu : voies ---------- */
function vueVoies(mod, f, def) {
  const R = regleVoies(def);
  const dispo = pointsDispo(mod, f, def);
  const sorts = nbSorts(mod, f);
  let html = `<div class="carte" id="carte-voies">
    <h2>${esc(R.titre)}</h2>
    <p class="discret petit">${dispo > 0 ? `<strong class="force">${dispo} point${dispo > 1 ? 's' : ''} de capacité à dépenser</strong>` : dispo < 0 ? `<span class="force">${-dispo} point${dispo < -1 ? 's' : ''} dépensé${dispo < -1 ? 's' : ''} en trop</span>` : 'Aucun point de capacité en attente'}${sorts ? ` · ${sorts} sort${sorts > 1 ? 's' : ''}` : ''}</p>`;
  for (const x of f.voies || []) {
    const v = voieParId(mod, x.id);
    if (!v) { html += `<p class="discret petit">Voie « ${esc(x.id)} » absente du module.</p>`; continue; }
    const fin = finVoie(v);
    const suivant = x.rang + 1;
    html += `<details class="voie" data-garde="voie-${esc(v.id)}">
      <summary><strong>${esc(v.nom)}</strong> <span class="discret petit">· rang ${x.rang}${libelleTypeVoie(mod, v, f) ? ' · ' + esc(libelleTypeVoie(mod, v, f)) : ''}</span></summary>
      <ol class="caps">${v.capacites.map((cap, i) => { const r = debutVoie(v) + i; return `<li class="${r <= x.rang ? 'acquise' : ''}"><span class="n">${r}</span>${esc(cap)}</li>`; }).join('')}</ol>
      <div class="rangee">
        <button data-action="voie-moins" data-id="${esc(v.id)}">${x.rang <= debutVoie(v) ? 'Retirer' : 'Rang −'}</button>
        ${suivant <= fin ? `<button class="principal" data-action="voie-plus" data-id="${esc(v.id)}">Rang ${suivant} <small>(${R.cout[suivant - 1] ?? 2} pt, niv. ${R.niveau[suivant - 1] ?? '?'})</small></button>` : ''}
      </div>
      <textarea id="vn-${esc(v.id)}" rows="2" placeholder="Notes (effets, rappels, page du livre…)">${esc(x.note || '')}</textarea>
      <button class="lien" data-action="voie-note" data-id="${esc(v.id)}">Enregistrer la note</button>
    </details>`;
  }
  if (etat.ajoutVoie) html += vueAjoutVoie(mod, f, def);
  else html += `<button data-action="voie-ajout" style="margin-top:10px">Ouvrir une nouvelle voie</button>`;
  return html + '</div>';
}

function vueAjoutVoie(mod, f, def) {
  const acquises = new Set((f.voies || []).map(x => x.id));
  const profil = f.vars?.profil;
  const groupes = [];
  for (const v of mod.voies || []) {
    if (acquises.has(v.id)) continue;
    let g = groupes.find(x => x.nom === v.groupe);
    if (!g) groupes.push(g = { nom: v.groupe || 'Voies', voies: [] });
    g.voies.push(v);
  }
  groupes.sort((a, b) => (b.nom === profil) - (a.nom === profil));
  return `<div class="ajout-voie">
    <div class="rangee"><h3 style="margin:0">Ouvrir une voie</h3><button class="lien" style="flex:0 0 auto" data-action="voie-ajout-fermer">Fermer</button></div>
    ${groupes.map(g => `<details class="de-physique" data-garde="av-${esc(g.nom)}" ${g.nom === profil ? 'open' : ''}><summary>${esc(g.nom)}${g.nom === profil ? ' (ton profil)' : ''}</summary>
      <div class="pile">${g.voies.map(v => `<button data-action="voie-choisir" data-id="${esc(v.id)}">${esc(v.nom)}<small class="discret"> — ${debutVoie(v)}. ${esc(v.capacites[0] || '')}</small></button>`).join('')}</div></details>`).join('')}
  </div>`;
}

async function changerRangVoie(mod, f, id, delta) {
  const def = defFiche(mod, f.type);
  const R = regleVoies(def);
  const v = voieParId(mod, id);
  const x = f.voies.find(y => y.id === id);
  if (!v || !x) return;
  const nom = nomFiche(f, def);
  if (delta < 0) {
    if (x.rang <= debutVoie(v)) {
      if (!confirm(`Retirer la ${v.nom.toLowerCase()} de la fiche ?`)) return;
      f.voies = f.voies.filter(y => y !== x);
      await noter({ type: 'fiche', texte: `${nom} : ${v.nom} retirée` });
    } else {
      x.rang -= 1;
      await noter({ type: 'fiche', texte: `${nom} : ${v.nom} ramenée au rang ${x.rang}` });
    }
  } else {
    const r = x.rang + 1;
    if (r > finVoie(v)) return toast('Rang maximal atteint');
    const pb = [];
    if ((f.niveau ?? 1) < (R.niveau[r - 1] ?? 0)) pb.push(`le rang ${r} demande le niveau ${R.niveau[r - 1]}`);
    const cout = R.cout[r - 1] ?? 2;
    if (pointsDispo(mod, f, def) < cout) pb.push(`il faut ${cout} point${cout > 1 ? 's' : ''} de capacité (disponibles : ${Math.max(0, pointsDispo(mod, f, def))})`);
    if (pb.length && !confirm(`Règle : ${pb.join(' ; ')}.\n\nPasser outre ? (Ce sera noté comme dérogation.)`)) return;
    x.rang = r;
    const cap = v.capacites[r - debutVoie(v)];
    if (pb.length) await noter({ type: 'derogation', texte: `${nom} : ${v.nom} rang ${r} malgré la règle (${pb.join(' ; ')})` });
    await noter({ type: 'fiche', texte: `${nom} : ${v.nom}, rang ${r} — ${cap}` });
  }
  recalculerFiche(mod, f, def);
  await sauverPartie();
  rendre();
}

async function ouvrirVoie(mod, f, id) {
  const def = defFiche(mod, f.type);
  const R = regleVoies(def);
  const v = voieParId(mod, id);
  if (!v) return;
  const rang = debutVoie(v);
  const pb = [];
  const autres = (f.voies || []).filter(x => !['peuple', 'mage'].includes(voieParId(mod, x.id)?.type)).length;
  if (R.max && !['peuple', 'mage'].includes(v.type) && autres >= R.max) pb.push(`${R.max} voies au maximum (plus la voie de peuple)`);
  if ((f.niveau ?? 1) < (R.niveau[rang - 1] ?? 0)) pb.push(`le rang ${rang} demande le niveau ${R.niveau[rang - 1]}`);
  if (v.type === 'prestige' && (f.voies || []).some(x => voieParId(mod, x.id)?.type === 'prestige')) pb.push('une seule voie de prestige par personnage');
  const cout = R.cout[rang - 1] ?? 1;
  if (pointsDispo(mod, f, def) < cout) pb.push(`il faut ${cout} point${cout > 1 ? 's' : ''} de capacité (disponibles : ${Math.max(0, pointsDispo(mod, f, def))})`);
  if (pb.length && !confirm(`Règle : ${pb.join(' ; ')}.\n\nPasser outre ? (Ce sera noté comme dérogation.)`)) return;
  ajouterVoie(f, v, rang);
  const nom = nomFiche(f, def);
  if (pb.length) await noter({ type: 'derogation', texte: `${nom} : ${v.nom} ouverte malgré la règle (${pb.join(' ; ')})` });
  await noter({ type: 'fiche', texte: `${nom} ouvre la ${v.nom.charAt(0).toLowerCase() + v.nom.slice(1)} — ${rang}. ${v.capacites[0]}` });
  etat.ajoutVoie = false;
  recalculerFiche(mod, f, def);
  await sauverPartie();
  await rendre();
  document.getElementById('carte-voies')?.scrollIntoView({ block: 'start' });
}

/* ---------- Niveau ---------- */
async function passerNiveau(mod, f) {
  const def = defFiche(mod, f.type);
  const N = def.niveau;
  const n = (f.niveau ?? 1) + 1;
  if (N.max && n > N.max) return toast('Niveau maximal atteint');
  if (!confirm(`Passer ${nomFiche(f, def)} au niveau ${n} ?`)) return;
  const avant = Object.fromEntries((def.jauges || []).map(j => [j.id, f.jauges[j.id]?.max ?? 0]));
  f.niveau = n;
  recalculerFiche(mod, f, def);
  const parts = [];
  for (const j of def.jauges || []) {
    const m = f.jauges[j.id]?.max ?? 0;
    if (m !== avant[j.id]) parts.push(`${j.abr || j.nom} max ${avant[j.id]} → ${m}`);
  }
  for (const id of N.remplir || []) {
    const j = f.jauges[id];
    if (j && j.act < j.max) { parts.push(`${def.jauges.find(x => x.id === id)?.abr || id} restaurés (${j.act} → ${j.max})`); j.act = j.max; }
  }
  if (def.voies) parts.push(`+${regleVoies(def).parNiveau} points de capacité`);
  await sauverPartie();
  await noter({ type: 'fiche', texte: `${nomFiche(f, def)} passe au niveau ${n}${parts.length ? ' : ' + parts.join(', ') : ''}` });
  toast(`Niveau ${n}`);
  rendre();
}

/* ---------- Édition : champs supplémentaires ---------- */
function vueEditionPlus(mod, f, def) {
  let html = '';
  if (def.niveau) html += `<h3>${esc(def.niveau.nom || 'Niveau')}</h3><input type="number" inputmode="numeric" id="fe-niveau" value="${f.niveau ?? 1}">`;
  if (def.caracs) html += `<h3>Caractéristiques</h3><div class="grille-edition">${def.caracs.map(k => `<label><span>${esc(k.abr || k.id)}</span>
    <input type="text" inputmode="text" id="fe-k-${esc(k.id)}" value="${f.caracs?.[k.id] ?? 0}"></label>`).join('')}</div>`;
  const bonus = [...(def.derivees || []).map(d => ({ id: d.id, nom: d.nom, aide: d.aideBonus })),
    ...(def.jauges || []).filter(j => j.maxFormule).map(j => ({ id: j.id, nom: `${j.nom} (max)`, aide: j.aideBonus }))];
  if (def.voies) bonus.push({ id: 'points', nom: 'Points de capacité', aide: 'Ajustement manuel (point orphelin, règle maison…)' });
  if (bonus.length) html += `<h3>Bonus ajoutés aux valeurs calculées</h3><p class="discret petit">Armure, bouclier, capacités, objets… (nombre positif ou négatif).</p>
    ${bonus.map(x => `<div class="rangee edition-jauge"><span>${esc(x.nom)}${x.aide ? `<small class="discret"> — ${esc(x.aide)}</small>` : ''}</span>
      <input type="text" inputmode="text" id="fe-b-${esc(x.id)}" value="${f.bonus?.[x.id] ?? 0}"></div>`).join('')}`;
  if ((def.parametres || []).length) html += `<details class="de-physique" data-garde="fe-param"><summary>Paramètres de calcul</summary>
    ${def.parametres.map(p => `<div class="rangee edition-jauge"><span>${esc(p.nom)}</span><input type="text" id="fe-p-${esc(p.id)}" value="${esc(f.vars?.[p.id] ?? '')}"></div>`).join('')}</details>`;
  if (def.armes) {
    const att = (def.derivees || []).filter(d => d.test);
    html += `<h3>${esc(def.armes.titre || 'Armes')}</h3>
      ${(f.armes || []).map((a, i) => `<div class="edition-arme">
        <input type="text" id="fe-a-${i}-nom" value="${esc(a.nom)}" placeholder="Nom">
        <div class="rangee"><select id="fe-a-${i}-att"><option value="">— aucun test —</option>${att.map(d => `<option value="${esc(d.id)}" ${a.attaque === d.id ? 'selected' : ''}>${esc(d.nom)}</option>`).join('')}</select>
          <input type="text" id="fe-a-${i}-dm" value="${esc(a.dm)}" placeholder="DM (ex. 1d8+FOR)" style="flex:1 1 40%"></div>
        <input type="text" id="fe-a-${i}-notes" value="${esc(a.notes || '')}" placeholder="Notes (portée, critique…)">
        <label class="case petit"><input type="checkbox" id="fe-a-${i}-suppr"> Supprimer cette arme</label>
      </div>`).join('')}
      <button class="lien" data-action="fe-arme-plus">+ Ajouter une arme</button>`;
  }
  return html;
}

function lireEditionPlus(mod, f, def) {
  const num = (id, defaut) => { const el = document.getElementById(id); if (!el) return defaut; const v = Number(String(el.value).replace('−', '-').replace(',', '.').trim()); return Number.isFinite(v) ? Math.round(v) : defaut; };
  if (def.niveau) f.niveau = Math.max(1, num('fe-niveau', f.niveau ?? 1));
  if (def.caracs) for (const k of def.caracs) f.caracs[k.id] = num('fe-k-' + k.id, f.caracs[k.id] ?? 0);
  for (const d of def.derivees || []) f.bonus[d.id] = num('fe-b-' + d.id, f.bonus[d.id] || 0);
  for (const j of def.jauges || []) if (j.maxFormule) f.bonus[j.id] = num('fe-b-' + j.id, f.bonus[j.id] || 0);
  if (def.voies) f.bonus.points = num('fe-b-points', f.bonus.points || 0);
  for (const p of def.parametres || []) {
    const el = document.getElementById('fe-p-' + p.id);
    if (!el) continue;
    const s = el.value.trim();
    f.vars[p.id] = s !== '' && Number.isFinite(Number(s)) ? Number(s) : s;
  }
  if (def.armes) {
    const armes = [];
    (f.armes || []).forEach((a, i) => {
      if (document.getElementById(`fe-a-${i}-suppr`)?.checked) return;
      const nom = document.getElementById(`fe-a-${i}-nom`)?.value.trim();
      armes.push({ nom: nom || a.nom || 'Arme', attaque: document.getElementById(`fe-a-${i}-att`)?.value ?? a.attaque,
        dm: document.getElementById(`fe-a-${i}-dm`)?.value.trim() || a.dm, notes: document.getElementById(`fe-a-${i}-notes`)?.value.trim() || '' });
    });
    f.armes = armes;
  }
}

/* ---------- Actions propres à cette extension (appelées par actionJeu) ---------- */
async function actionJeuPlus(a, b, mod, f, c) {
  switch (a) {
    /* Création */
    case 'cr-ajust': {
      if (!c.courant || c.courant.type !== 'ajustement') c.courant = { type: 'ajustement', choix: [] };
      c.courant.choix[Number(b.dataset.k)] = b.dataset.v;
      await sauverPartie(); return rendre();
    }
    case 'cr-voie': {
      const p = pasCourant(mod, c);
      const n = p.choisir || 1;
      if (!c.courant || c.courant.type !== 'voies') c.courant = { type: 'voies', ids: [] };
      const ids = c.courant.ids;
      const id = b.dataset.id;
      if (ids.includes(id)) ids.splice(ids.indexOf(id), 1);
      else { ids.push(id); while (ids.length > n) ids.shift(); }
      await sauverPartie(); return rendre();
    }
    /* Fiche */
    case 'ts-mod': etat.tsMod = Math.max(-30, Math.min(30, (etat.tsMod || 0) + Number(b.dataset.v))); etat.tsDiff = $('#ts-diff')?.value ?? etat.tsDiff; return rendre();
    case 'ts': return testBonus(mod, f, { carac: b.dataset.k, derivee: b.dataset.d });
    case 'arme-att': { const i = Number(b.dataset.i); return testBonus(mod, f, { derivee: f.armes[i].attaque, arme: i }); }
    case 'arme-dm': {
      return lancerDM(mod, f, Number(b.dataset.i), b.dataset.crit === '1');
    }
    case 'jet-chance': {
      const r = etat.dernier.jet;
      const fc = ficheParId(r.origine.slice(6));
      const ch = mod.test.chance;
      const j = fc.jauges[ch.jauge];
      if (!j || j.act <= 0) return toast('Plus de points');
      const def = defFiche(mod, fc.type);
      const avant = r.totalForce ?? r.total;
      j.act -= 1;
      r.chance = true;
      r.totalForce = avant + ch.bonus;
      if (r.seuil != null) r.reussite = r.totalForce >= r.seuil;
      if (r.echecCritique && r.reussite) r.mention = ch.rattrapage || 'Échec critique rattrapé : réussite partielle';
      await sauverPartie();
      const abr = def.jauges.find(x => x.id === ch.jauge)?.abr || ch.jauge;
      await noter({ type: 'fiche', texte: `${nomFiche(fc, def)} dépense 1 ${abr} sur « ${r.libelle.split(' — ')[0]} » : ${avant} → ${r.totalForce}${r.seuil != null ? ` (${r.reussite ? 'réussite' : 'échec'})` : ''}${r.echecCritique && r.reussite ? ', partielle' : ''} — ${abr} ${j.act + 1} → ${j.act}` });
      return rendre();
    }
    case 'niv-plus': return passerNiveau(mod, f);
    case 'voie-plus': return changerRangVoie(mod, f, b.dataset.id, 1);
    case 'voie-moins': return changerRangVoie(mod, f, b.dataset.id, -1);
    case 'voie-ajout': etat.ajoutVoie = true; return rendre();
    case 'voie-ajout-fermer': etat.ajoutVoie = false; return rendre();
    case 'voie-choisir': return ouvrirVoie(mod, f, b.dataset.id);
    case 'voie-note': {
      const x = f.voies.find(y => y.id === b.dataset.id);
      x.note = document.getElementById('vn-' + b.dataset.id)?.value.trim() || '';
      await sauverPartie(); toast('Note enregistrée'); return;
    }
    case 'fe-arme-plus': {
      const def = defFiche(mod, f.type);
      await enregistrerEdition_fiche(mod, f, true);   // garde ce qui a déjà été saisi
      f.armes.push({ nom: 'Nouvelle arme', attaque: (def.derivees || []).find(d => d.test)?.id || '', dm: '1d6', notes: '' });
      await sauverPartie(); return rendre();
    }
    default:
      if (a.startsWith('rg-') && typeof actionRegles === 'function') return actionRegles(a, b, mod, f);
  }
}

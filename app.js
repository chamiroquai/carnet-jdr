/* Carnet JDR — moteur (étape 1 : oracle et socle).
   Ce fichier ne contient aucun contenu de jeu : tables, mots et cartes
   sont importés par l'utilisateur et restent stockés sur l'appareil. */
'use strict';

const VERSION_APP = '1.0.0';
const FORMAT_ORACLE = 'carnet-jdr-oracle';
const FORMAT_SAUVEGARDE = 'carnet-jdr-sauvegarde';

/* ---------- Stockage local (IndexedDB) ---------- */
const DB = (() => {
  let promesse;
  function ouvrir() {
    if (promesse) return promesse;
    promesse = new Promise((ok, ko) => {
      const req = indexedDB.open('carnet-jdr', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('contenus')) db.createObjectStore('contenus', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('historique')) db.createObjectStore('historique', { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => ko(req.error);
    });
    return promesse;
  }
  async function tx(store, mode, fn) {
    const db = await ouvrir();
    return new Promise((ok, ko) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let res;
      Promise.resolve(fn(s)).then(r => { res = r; });
      t.oncomplete = () => ok(res);
      t.onerror = () => ko(t.error);
      t.onabort = () => ko(t.error);
    });
  }
  const req2p = r => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  return {
    get: (store, cle) => tx(store, 'readonly', s => req2p(s.get(cle))),
    tous: store => tx(store, 'readonly', s => req2p(s.getAll())),
    cles: store => tx(store, 'readonly', s => req2p(s.getAllKeys())),
    mettre: (store, val, cle) => tx(store, 'readwrite', s => req2p(cle === undefined ? s.put(val) : s.put(val, cle))),
    suppr: (store, cle) => tx(store, 'readwrite', s => req2p(s.delete(cle))),
    vider: store => tx(store, 'readwrite', s => req2p(s.clear())),
  };
})();

const kv = {
  get: async (cle, defaut) => { const v = await DB.get('kv', cle); return v === undefined ? defaut : v; },
  set: (cle, val) => DB.mettre('kv', val, cle),
};

/* ---------- Hasard ---------- */
function de(faces) {
  const max = Math.floor(0x100000000 / faces) * faces;
  const buf = new Uint32Array(1);
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= max);
  return (x % faces) + 1;
}

/* ---------- Utilitaires ---------- */
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const maintenant = () => new Date().toISOString();
function dateFr(iso, avecHeure = true) {
  const d = new Date(iso);
  const opt = avecHeure
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' };
  return d.toLocaleString('fr-FR', opt);
}
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function lireEntier(val, min, max) {
  const n = Number(String(val).trim());
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/* ---------- État en mémoire ---------- */
const etat = {
  vue: 'ouinon',
  contenus: [],          // fichiers importés
  oracle: null,          // fichier actif pour oui/non, mots, tourments
  dernier: {},           // derniers résultats affichés par vue
  ouverts: {},           // volets « dé physique » ouverts
};

async function chargerContenus() {
  etat.contenus = (await DB.tous('contenus')).sort((a, b) => a.importeLe.localeCompare(b.importeLe));
  const actif = await kv.get('oracleActif', null);
  const avecBase = etat.contenus.filter(c => c.donnees.ouiNon || c.donnees.mots || c.donnees.tourments);
  etat.oracle = avecBase.find(c => c.id === actif) || avecBase[0] || null;
}

function tousLesDecks() {
  const decks = [];
  for (const c of etat.contenus) {
    for (const d of (c.donnees.decks || [])) {
      decks.push({ cle: `${c.id}::${d.id}`, nom: d.nom, cartes: d.cartes || [], fichier: c.donnees.nom });
    }
  }
  return decks;
}

/* ---------- Historique ---------- */
async function noter(entree) {
  const e = { t: maintenant(), ...entree };
  e.id = await DB.mettre('historique', e);
  await verifierRappel();
  return e;
}

/* ---------- Validation d'un fichier d'oracle ---------- */
function validerOracle(d) {
  const erreurs = [];
  const avert = [];
  if (!d || typeof d !== 'object') return { erreurs: ['Le fichier ne contient pas un objet JSON.'], avert };
  if (d.format !== FORMAT_ORACLE) erreurs.push(`Format inattendu (« ${d.format ?? 'absent'} »). Attendu : « ${FORMAT_ORACLE} ».`);
  if (!d.id || !d.nom) erreurs.push('Champs « id » et « nom » obligatoires.');
  if (!d.ouiNon && !d.mots && !d.tourments && !d.decks) erreurs.push('Aucune section reconnue (ouiNon, mots, tourments, decks).');

  if (d.ouiNon) {
    const on = d.ouiNon;
    const nbRep = (on.reponses || []).length;
    if (!on.de || !nbRep || !Array.isArray(on.probabilites) || !on.probabilites.length) {
      erreurs.push('Section ouiNon incomplète (de, reponses, probabilites).');
    } else {
      for (const p of on.probabilites) {
        if (!Array.isArray(p.plages) || p.plages.length !== nbRep) {
          erreurs.push(`ouiNon / ${p.nom} : il faut une plage par réponse (${nbRep}).`);
          continue;
        }
        const couvert = new Array(on.de + 1).fill(0);
        p.plages.forEach(pl => { if (pl) for (let i = pl[0]; i <= pl[1]; i++) if (i >= 1 && i <= on.de) couvert[i]++; });
        const trous = [], doubles = [];
        for (let i = 1; i <= on.de; i++) { if (couvert[i] === 0) trous.push(i); if (couvert[i] > 1) doubles.push(i); }
        if (trous.length) avert.push(`ouiNon / ${p.nom} : valeurs sans réponse : ${trous.join(', ')}.`);
        if (doubles.length) avert.push(`ouiNon / ${p.nom} : valeurs en double : ${doubles.join(', ')}.`);
      }
    }
  }
  if (d.mots) {
    const ids = new Set((d.mots.listes || []).map(l => l.id));
    (d.mots.listes || []).forEach(l => {
      if (!Array.isArray(l.mots) || !l.mots.length) erreurs.push(`Liste de mots « ${l.nom} » vide.`);
      else if (l.de && l.mots.length !== l.de) avert.push(`Liste « ${l.nom} » : ${l.mots.length} mots pour un d${l.de}.`);
    });
    (d.mots.tirages || []).forEach(t => (t.listes || []).forEach(id => { if (!ids.has(id)) erreurs.push(`Tirage « ${t.nom} » : liste « ${id} » introuvable.`); }));
  }
  if (d.tourments) {
    const tr = d.tourments;
    if (!tr.de || !Array.isArray(tr.lignes) || !tr.lignes.length) erreurs.push('Section tourments incomplète (de, lignes).');
    else tr.lignes.forEach((l, i) => { if (l.length !== tr.de) erreurs.push(`Tourment ${i + 1} : ${l.length} valeurs pour un d${tr.de}.`); });
  }
  (d.decks || []).forEach(dk => { if (!dk.id || !Array.isArray(dk.cartes) || !dk.cartes.length) erreurs.push(`Deck « ${dk.nom ?? '?'} » vide ou sans id.`); });
  return { erreurs, avert };
}

function resumeContenu(d) {
  const parts = [];
  if (d.ouiNon) parts.push(`oui/non (${d.ouiNon.probabilites.length} probabilités)`);
  if (d.mots) parts.push(`${d.mots.listes.length} listes de mots`);
  if (d.tourments) parts.push(`${d.tourments.lignes.length} Tourments`);
  (d.decks || []).forEach(dk => parts.push(`deck ${dk.nom} (${dk.cartes.length} cartes)`));
  return parts.join(' · ');
}

/* ---------- Import / sauvegarde ---------- */
function lireFichier(input) {
  return new Promise((ok, ko) => {
    input.value = '';
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { ok(JSON.parse(r.result)); } catch (e) { ko(new Error('Ce fichier n’est pas un JSON valide.')); } };
      r.onerror = () => ko(r.error);
      r.readAsText(f, 'utf-8');
    };
    input.click();
  });
}

async function importerOracle() {
  let d;
  try { d = await lireFichier($('#fichier-import')); } catch (e) { alert(e.message); return; }
  if (d && d.format === FORMAT_SAUVEGARDE) { alert('Ce fichier est une sauvegarde. Utilise « Restaurer une sauvegarde ».'); return; }
  const { erreurs, avert } = validerOracle(d);
  if (erreurs.length) { alert('Import refusé :\n\n• ' + erreurs.join('\n• ')); return; }
  if (avert.length && !confirm('Points à vérifier :\n\n• ' + avert.join('\n• ') + '\n\nImporter quand même ?')) return;
  const existe = etat.contenus.find(c => c.id === d.id);
  if (existe && !confirm(`« ${d.nom} » est déjà importé. Le remplacer par ce fichier ?`)) return;
  await DB.mettre('contenus', { id: d.id, importeLe: existe ? existe.importeLe : maintenant(), majLe: maintenant(), donnees: d });
  await chargerContenus();
  // Active les nouveaux decks par défaut si aucun choix n'a encore été fait
  const choix = await kv.get('decksActifs', null);
  if (choix === null) await kv.set('decksActifs', tousLesDecks().map(dk => dk.cle));
  else if (!existe) await kv.set('decksActifs', [...choix, ...(d.decks || []).map(dk => `${d.id}::${dk.id}`)]);
  toast(`« ${d.nom} » importé`);
  rendre();
}

async function exporterSauvegarde() {
  const contenu = {
    format: FORMAT_SAUVEGARDE,
    version: 1,
    app: VERSION_APP,
    creeLe: maintenant(),
    contenus: await DB.tous('contenus'),
    kv: Object.fromEntries(await Promise.all((await DB.cles('kv')).map(async k => [k, await DB.get('kv', k)]))),
    historique: await DB.tous('historique'),
  };
  delete contenu.kv.derniereSauvegarde;
  const jour = new Date().toISOString().slice(0, 10);
  const nom = `carnet-jdr-sauvegarde-${jour}.json`;
  const blob = new Blob([JSON.stringify(contenu, null, 1)], { type: 'application/json' });
  const fichier = new File([blob], nom, { type: 'application/json' });
  let fait = false;
  if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
    try { await navigator.share({ files: [fichier], title: nom }); fait = true; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  if (!fait) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  await kv.set('derniereSauvegarde', maintenant());
  toast('Sauvegarde créée');
  await verifierRappel();
  rendre();
}

async function restaurerSauvegarde() {
  let d;
  try { d = await lireFichier($('#fichier-restauration')); } catch (e) { alert(e.message); return; }
  if (!d || d.format !== FORMAT_SAUVEGARDE) { alert('Ce fichier n’est pas une sauvegarde du Carnet.'); return; }
  const n = (d.historique || []).length;
  if (!confirm(`Restaurer la sauvegarde du ${dateFr(d.creeLe)} ?\n\n${(d.contenus || []).length} fichier(s) de contenu, ${n} entrée(s) d'historique.\n\nLes données actuelles de cet appareil seront remplacées.`)) return;
  await DB.vider('contenus'); await DB.vider('kv'); await DB.vider('historique');
  for (const c of d.contenus || []) await DB.mettre('contenus', c);
  for (const [k, v] of Object.entries(d.kv || {})) await DB.mettre('kv', v, k);
  for (const h of d.historique || []) await DB.mettre('historique', h);
  await kv.set('derniereSauvegarde', d.creeLe);
  await chargerContenus();
  toast('Sauvegarde restaurée');
  await verifierRappel();
  rendre();
}

/* ---------- Rappel de sauvegarde ---------- */
async function verifierRappel() {
  const band = $('#bandeau');
  const jours = await kv.get('rappelJours', 7);
  const derniere = await kv.get('derniereSauvegarde', null);
  const histo = await DB.tous('historique');
  const dernierChangement = histo.length ? histo[histo.length - 1].t : (etat.contenus.length ? etat.contenus[etat.contenus.length - 1].majLe : null);
  let msg = '';
  if (jours > 0 && dernierChangement) {
    if (!derniere) msg = 'Aucune sauvegarde pour l’instant.';
    else if (dernierChangement > derniere && (Date.now() - new Date(derniere)) / 86400000 >= jours) {
      msg = `Dernière sauvegarde le ${dateFr(derniere, false)}.`;
    }
  }
  if (msg) {
    band.innerHTML = `<span>${esc(msg)}</span><button data-action="sauver">Sauvegarder</button>`;
    band.hidden = false;
  } else band.hidden = true;
}

/* ---------- Vues ---------- */
const TITRES = { ouinon: 'Oracle oui/non', mots: 'Mots clés', evenements: 'Événements', historique: 'Historique', reglages: 'Réglages' };

function sansOracle(section) {
  return `<div class="carte vide">
    <p>Aucun fichier d'oracle ne fournit ${section}.</p>
    <button class="principal" data-action="importer">Importer un fichier d'oracle</button>
    <p class="discret petit">Le fichier reste sur cet appareil. Range-le dans iCloud Drive pour l'importer aussi sur l'autre appareil.</p>
  </div>`;
}

function blocDePhysique(id, faces, libelle = 'J’ai lancé mon dé') {
  return `<details class="de-physique" data-garde="${id}">
    <summary>${libelle} (d${faces})</summary>
    <div class="rangee">
      <input type="number" inputmode="numeric" min="1" max="${faces}" id="${id}" placeholder="1–${faces}">
      <button data-action="${id}">Valider</button>
    </div>
  </details>`;
}

/* Oui / Non */
async function vueOuiNon() {
  const o = etat.oracle?.donnees.ouiNon;
  if (!o) return sansOracle('la table oui/non');
  const choisie = await kv.get('proba', o.defaut || o.probabilites[0].id);
  const r = etat.dernier.ouinon;
  return `<div class="carte">
    <h2>Probabilité</h2>
    <div class="puces">${o.probabilites.map(p =>
      `<button class="puce ${p.id === choisie ? 'choisie' : ''}" data-action="proba" data-id="${esc(p.id)}">${esc(p.nom)}</button>`).join('')}</div>
    <h3>Question (facultatif)</h3>
    <input type="text" id="question" placeholder="Ex. : la porte est-elle verrouillée ?" value="${esc(etat.questionEnCours || '')}">
    <div style="margin-top:12px"><button class="principal" data-action="interroger">Interroger l'oracle (d${o.de})</button></div>
    ${blocDePhysique('de-ouinon', o.de)}
    ${r ? rendreResultatOuiNon(r, o) : ''}
  </div>`;
}

function rendreResultatOuiNon(r, o) {
  const rep = o.reponses[r.indice];
  return `<div class="resultat">
    ${r.question ? `<div class="meta">« ${esc(r.question)} »</div>` : ''}
    <div class="reponse ${esc(rep.sens || '')}">${esc(rep.texte)}</div>
    <div class="meta">d${o.de} = ${r.valeur} · ${esc(r.probaNom)} · dé ${r.physique ? 'physique' : 'virtuel'}</div>
    ${r.forcee ? `<div class="force">Réponse forcée (l'oracle avait donné « ${esc(o.reponses[r.indiceOrigine].texte)} »)</div>` : ''}
    ${r.choixForcage ? `<div class="pile" style="margin-top:10px">${o.reponses.map((x, i) =>
      `<button data-action="forcer-rep" data-i="${i}">${esc(x.texte)}</button>`).join('')}</div>`
      : `<button class="lien" data-action="choix-forcage">Forcer une autre réponse</button>`}
  </div>`;
}

async function interroger(valeurPhysique) {
  const o = etat.oracle.donnees.ouiNon;
  const probaId = await kv.get('proba', o.defaut || o.probabilites[0].id);
  const p = o.probabilites.find(x => x.id === probaId) || o.probabilites[0];
  const valeur = valeurPhysique ?? de(o.de);
  const indice = p.plages.findIndex(pl => pl && valeur >= pl[0] && valeur <= pl[1]);
  if (indice < 0) { alert(`Aucune réponse prévue pour ${valeur} en « ${p.nom} ». Vérifie le fichier d'oracle.`); return; }
  const question = ($('#question')?.value || '').trim();
  etat.questionEnCours = '';
  const e = await noter({
    type: 'ouinon', question, proba: p.nom, valeur, physique: valeurPhysique != null,
    reponse: o.reponses[indice].texte,
  });
  etat.dernier.ouinon = { idHisto: e.id, question, valeur, indice, probaNom: p.nom, physique: valeurPhysique != null };
  rendre();
}

async function forcerReponse(i) {
  const r = etat.dernier.ouinon;
  const o = etat.oracle.donnees.ouiNon;
  if (!r.forcee) r.indiceOrigine = r.indice;
  r.indice = i; r.forcee = i !== r.indiceOrigine; r.choixForcage = false;
  await noter({ type: 'derogation', texte: `Réponse forcée : « ${o.reponses[i].texte} » au lieu de « ${o.reponses[r.indiceOrigine].texte} »` });
  rendre();
}

/* Mots */
function vueMots() {
  const m = etat.oracle?.donnees.mots;
  if (!m) return sansOracle('de listes de mots');
  const tirages = m.tirages?.length ? m.tirages : m.listes.map(l => ({ id: l.id, nom: l.nom, listes: [l.id] }));
  return tirages.map(t => {
    const listes = t.listes.map(id => m.listes.find(l => l.id === id));
    const r = etat.dernier['mots-' + t.id];
    return `<div class="carte">
      <h2>${esc(t.nom)}</h2>
      <p class="discret petit">${listes.map(l => esc(l.nom)).join(' + ')}</p>
      <button class="principal" data-action="tirer-mots" data-id="${esc(t.id)}">Tirer ${listes.length > 1 ? listes.length + ' mots' : 'un mot'}</button>
      <details class="de-physique" data-garde="dm-${esc(t.id)}">
        <summary>J'ai lancé mes dés</summary>
        <div class="rangee">${listes.map((l, k) =>
          `<input type="number" inputmode="numeric" min="1" max="${l.mots.length}" id="dm-${esc(t.id)}-${k}" placeholder="d${l.mots.length}">`).join('')}
          <button data-action="mots-physiques" data-id="${esc(t.id)}">Valider</button></div>
      </details>
      ${r ? `<div class="resultat"><div class="mots-tires">${r.map((x, k) =>
        `${k ? '<span class="plus">+</span>' : ''}<div class="mot">${esc(x.mot)}<small>${esc(x.liste)} · ${x.valeur}</small></div>`).join('')}</div></div>` : ''}
    </div>`;
  }).join('') + `<p class="discret petit" style="text-align:center">Interprète librement l'association des mots.</p>`;
}

async function tirerMots(id, valeurs) {
  const m = etat.oracle.donnees.mots;
  const tirages = m.tirages?.length ? m.tirages : m.listes.map(l => ({ id: l.id, nom: l.nom, listes: [l.id] }));
  const t = tirages.find(x => x.id === id);
  const res = t.listes.map((lid, k) => {
    const l = m.listes.find(x => x.id === lid);
    const v = valeurs ? valeurs[k] : de(l.mots.length);
    return { liste: l.nom, valeur: v, mot: l.mots[v - 1] };
  });
  etat.dernier['mots-' + id] = res;
  await noter({ type: 'mots', tirage: t.nom, physique: !!valeurs, mots: res });
  rendre();
}

/* Événements et Tourments */
async function etatTourment() {
  const tr = etat.oracle?.donnees.tourments;
  const def = { ligne: tr?.depart || 1, sens: 1 };
  return await kv.get('tourment', def);
}

function prochaineLigne(ligne, sens, nb) {
  if (nb <= 1) return { ligne: 1, sens: 1 };
  let s = sens;
  if (ligne + s > nb || ligne + s < 1) s = -s;
  return { ligne: ligne + s, sens: s };
}

async function decksActifs() {
  const tous = tousLesDecks();
  const choix = await kv.get('decksActifs', null);
  return choix === null ? tous : tous.filter(d => choix.includes(d.cle));
}

async function vueEvenements() {
  const tr = etat.oracle?.donnees.tourments;
  const decks = tousLesDecks();
  if (!tr && !decks.length) return sansOracle('de table de Tourments ni de deck');
  const actifs = (await decksActifs()).map(d => d.cle);
  const pioche = actifs.length ? (await decksActifs()).reduce((n, d) => n + d.cartes.length, 0) : 0;
  const t = await etatTourment();
  const r = etat.dernier.evenements;
  let html = '';
  if (tr) {
    html += `<div class="carte">
      <h2>Tourment</h2>
      <div class="echelle">${tr.lignes.map((l, i) =>
        `<button class="echelon ${i + 1 === t.ligne ? 'courant' : ''}" data-action="choisir-tourment" data-l="${i + 1}">${i + 1}<small>${i + 1 === t.ligne ? (t.sens > 0 ? 'monte ▲' : 'descend ▼') : '&nbsp;'}</small></button>`).join('')}</div>
      <button class="principal" data-action="deplacement">Déplacement : lancer le d${tr.de}</button>
      ${blocDePhysique('de-tourment', tr.de)}
      ${tr.consigne ? `<p class="discret petit">${esc(tr.consigne)}</p>` : ''}
    </div>`;
  }
  html += `<div class="carte">
    <h2>Decks</h2>
    ${decks.length ? decks.map(d => `<label class="case"><input type="checkbox" data-action="deck" data-cle="${esc(d.cle)}" ${actifs.includes(d.cle) ? 'checked' : ''}> ${esc(d.nom)} <span class="discret petit">(${d.cartes.length} cartes)</span></label>`).join('')
      : '<p class="discret">Aucun deck importé.</p>'}
    <div class="rangee" style="margin-top:8px"><button data-action="tirer-carte" ${pioche ? '' : 'disabled'}>Tirer une carte</button></div>
  </div>`;
  if (r) {
    html += `<div class="carte">
      ${r.ligne ? `<div class="resultat" style="margin-top:0">
        <div class="reponse">${r.nb} carte${r.nb > 1 ? 's' : ''}</div>
        <div class="meta">Tourment ${r.ligne} · d${tr?.de ?? 6} = ${r.valeur} · dé ${r.physique ? 'physique' : 'virtuel'}</div>
        ${r.nb === 0 ? '<div class="meta">Aucun événement pendant ce déplacement.</div>' : ''}
      </div>` : ''}
      ${r.cartes.map((c, k) => `<div class="carte-evt">
        <div class="cat">${esc(c.deck)}${c.categorie ? ' · ' + esc(c.categorie) : ''}</div>
        <div class="titre">${esc(c.titre)}</div>
        ${c.texte ? `<div class="texte">${esc(c.texte)}</div>` : ''}
        <div class="actions"><button class="lien" data-action="repiocher" data-k="${k}">Repiocher</button></div>
      </div>`).join('')}
      ${r.cartes.length ? '<p class="discret petit">Relie les cartes entre elles, et aux personnages et objectifs déjà rencontrés.</p>' : ''}
      <button class="lien" data-action="carte-sup" ${pioche ? '' : 'disabled'}>+ Ajouter une carte</button>
    </div>`;
  }
  return html;
}

async function piocher(n, exclure = []) {
  const decks = await decksActifs();
  const paquet = [];
  decks.forEach(d => d.cartes.forEach((c, i) => paquet.push({ ...c, deck: d.nom, ref: `${d.cle}#${i}` })));
  // Tirage sans remise à l'intérieur d'un même tirage ; doublons du deck conservés.
  const dispo = paquet.filter(c => !exclure.includes(c.ref));
  const res = [];
  for (let k = 0; k < n && dispo.length; k++) res.push(dispo.splice(de(dispo.length) - 1, 1)[0]);
  return res;
}

async function deplacement(valeurPhysique) {
  const tr = etat.oracle.donnees.tourments;
  const t = await etatTourment();
  const valeur = valeurPhysique ?? de(tr.de);
  const nb = tr.lignes[t.ligne - 1][valeur - 1];
  const cartes = await piocher(nb);
  if (cartes.length < nb) toast('Pas assez de cartes dans les decks actifs');
  const suivant = tr.progression === 'fixe' ? t : prochaineLigne(t.ligne, t.sens, tr.lignes.length);
  await kv.set('tourment', suivant);
  etat.dernier.evenements = { ligne: t.ligne, valeur, nb, physique: valeurPhysique != null, cartes };
  await noter({
    type: 'tourment', ligne: t.ligne, valeur, nb, physique: valeurPhysique != null,
    cartes: cartes.map(c => ({ deck: c.deck, titre: c.titre, texte: c.texte })), suivant: suivant.ligne,
  });
  rendre();
}

async function tirerCarte(sup) {
  const r = sup ? etat.dernier.evenements : null;
  const [c] = await piocher(1, r ? r.cartes.map(x => x.ref) : []);
  if (!c) { toast('Aucune carte disponible'); return; }
  if (r) r.cartes.push(c);
  else etat.dernier.evenements = { cartes: [c] };
  await noter({ type: 'carte', cartes: [{ deck: c.deck, titre: c.titre, texte: c.texte }], ajout: !!sup });
  rendre();
}

async function repiocher(k) {
  const r = etat.dernier.evenements;
  const ancienne = r.cartes[k];
  const [c] = await piocher(1, r.cartes.map(x => x.ref));
  if (!c) { toast('Aucune autre carte disponible'); return; }
  r.cartes[k] = c;
  await noter({ type: 'derogation', texte: `Carte repiochée : « ${c.titre} » remplace « ${ancienne.titre} »`, cartes: [{ deck: c.deck, titre: c.titre, texte: c.texte }] });
  rendre();
}

async function choisirTourment(l) {
  const t = await etatTourment();
  const nb = etat.oracle.donnees.tourments.lignes.length;
  let suivant;
  if (l === t.ligne) suivant = { ligne: l, sens: -t.sens };   // toucher le Tourment courant inverse le sens
  else suivant = { ligne: l, sens: l === nb ? -1 : l === 1 ? 1 : t.sens };
  if (suivant.ligne + suivant.sens > nb || suivant.ligne + suivant.sens < 1) suivant.sens = -suivant.sens;
  await kv.set('tourment', suivant);
  await noter({ type: 'derogation', texte: `Tourment réglé manuellement sur ${suivant.ligne} (${suivant.sens > 0 ? 'montée' : 'descente'})` });
  rendre();
}

/* Historique */
function texteEntree(h) {
  switch (h.type) {
    case 'ouinon': return `${h.question ? '« ' + h.question + ' » — ' : ''}${h.reponse} (d20 = ${h.valeur}, ${h.proba}${h.physique ? ', dé physique' : ''})`;
    case 'mots': return `${h.tirage} : ${h.mots.map(m => `${m.mot} (${m.valeur})`).join(' + ')}${h.physique ? ' — dés physiques' : ''}`;
    case 'tourment': return `Déplacement — Tourment ${h.ligne}, d6 = ${h.valeur} → ${h.nb} carte(s)${h.physique ? ', dé physique' : ''}${h.cartes.length ? ' : ' + h.cartes.map(c => c.titre).join(', ') : ''}`;
    case 'carte': return `Carte${h.ajout ? ' ajoutée' : ''} : ${h.cartes.map(c => `${c.titre} (${c.deck})`).join(', ')}`;
    case 'derogation': return `Dérogation — ${h.texte}`;
    default: return h.texte || JSON.stringify(h);
  }
}

async function vueHistorique() {
  const h = (await DB.tous('historique')).reverse();
  if (!h.length) return `<div class="carte vide">Rien pour l'instant. Les questions, mots, cartes et dérogations s'inscrivent ici automatiquement.</div>`;
  return `<div class="carte">
    <div class="rangee"><button data-action="copier-histo">Copier en texte</button><button class="danger" data-action="vider-histo">Effacer</button></div>
    <p class="discret petit">Le journal par partie et les comptes rendus arrivent à l'étape 2. Cet historique y sera repris.</p>
  </div>
  <div class="carte"><ul class="histo">${h.map(e => `<li>
    <div class="quand">${esc(dateFr(e.t))}</div>
    <div class="quoi">${esc(texteEntree(e))}</div>
  </li>`).join('')}</ul></div>`;
}

async function copierHistorique() {
  const h = await DB.tous('historique');
  const txt = h.map(e => `[${dateFr(e.t)}] ${texteEntree(e)}`).join('\n');
  try { await navigator.clipboard.writeText(txt); toast('Historique copié'); }
  catch { alert('Copie impossible sur ce navigateur.'); }
}

/* Réglages */
async function vueReglages() {
  const derniere = await kv.get('derniereSauvegarde', null);
  const jours = await kv.get('rappelJours', 7);
  const avecBase = etat.contenus.filter(c => c.donnees.ouiNon || c.donnees.mots || c.donnees.tourments);
  let persistant = null;
  try { persistant = navigator.storage?.persisted ? await navigator.storage.persisted() : null; } catch { }
  return `<div class="carte">
    <h2>Fichiers de contenu</h2>
    ${etat.contenus.length ? etat.contenus.map(c => `<div class="carte-evt">
      <div class="titre">${esc(c.donnees.nom)} ${etat.oracle?.id === c.id ? '<span class="discret petit">· actif</span>' : ''}</div>
      <div class="texte discret petit">${esc(resumeContenu(c.donnees))}</div>
      <div class="texte discret petit">Importé le ${esc(dateFr(c.majLe))}${c.donnees.version ? ' · v' + esc(c.donnees.version) : ''}</div>
      <div class="actions">
        ${avecBase.length > 1 && etat.oracle?.id !== c.id && avecBase.includes(c) ? `<button class="lien" data-action="activer" data-id="${esc(c.id)}">Utiliser comme oracle</button> · ` : ''}
        <button class="lien danger" data-action="suppr-contenu" data-id="${esc(c.id)}">Retirer</button>
      </div>
    </div>`).join('') : '<p class="discret">Aucun fichier importé.</p>'}
    <div style="margin-top:12px"><button class="principal" data-action="importer">Importer un fichier d'oracle</button></div>
  </div>

  <div class="carte">
    <h2>Sauvegarde</h2>
    <p class="discret">${derniere ? 'Dernière sauvegarde : ' + esc(dateFr(derniere)) : 'Aucune sauvegarde.'}</p>
    <div class="pile">
      <button data-action="sauver">Exporter une sauvegarde</button>
      <button data-action="restaurer">Restaurer une sauvegarde</button>
    </div>
    <h3>Rappel</h3>
    <div class="puces">${[[0, 'Jamais'], [3, '3 jours'], [7, '7 jours'], [14, '14 jours']].map(([v, l]) =>
      `<button class="puce ${v === jours ? 'choisie' : ''}" data-action="rappel" data-v="${v}">${l}</button>`).join('')}</div>
    <p class="discret petit">La sauvegarde contient tes contenus d'oracle : garde-la pour toi (iCloud Drive), ne la partage pas. Pour passer de l'iPhone à l'iPad : exporte sur l'un, restaure sur l'autre.</p>
  </div>

  <div class="carte">
    <h2>À propos</h2>
    <p class="discret petit">Carnet JDR ${VERSION_APP} · données stockées uniquement sur cet appareil${persistant === true ? ' (stockage persistant accordé)' : persistant === false ? ' (stockage non persistant : pense aux sauvegardes)' : ''}.</p>
    <p class="discret petit">Sur iPhone et iPad, l'appli de l'écran d'accueil a son propre stockage, distinct de Safari : importe tes fichiers depuis l'appli installée.</p>
    <button class="lien danger" data-action="tout-effacer">Effacer toutes les données de cet appareil</button>
  </div>`;
}

/* ---------- Rendu et événements ---------- */
async function rendre() {
  const vues = { ouinon: vueOuiNon, mots: vueMots, evenements: vueEvenements, historique: vueHistorique, reglages: vueReglages };
  $('#titre-vue').textContent = TITRES[etat.vue];
  document.querySelectorAll('.onglets button').forEach(b => b.classList.toggle('actif', b.dataset.vue === etat.vue));
  const q = $('#question'); if (q) etat.questionEnCours = q.value;
  // Les volets « dé physique » ouverts le restent après un jet
  document.querySelectorAll('details[data-garde]').forEach(d => { etat.ouverts[d.dataset.garde] = d.open; });
  $('#vue').innerHTML = await vues[etat.vue]();
  document.querySelectorAll('details[data-garde]').forEach(d => { if (etat.ouverts[d.dataset.garde]) d.open = true; });
}

document.querySelector('.onglets').addEventListener('click', e => {
  const b = e.target.closest('button[data-vue]');
  if (!b) return;
  etat.vue = b.dataset.vue;
  rendre();
  window.scrollTo(0, 0);
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.action === 'deck') {
    const tous = tousLesDecks().map(d => d.cle);
    let choix = await kv.get('decksActifs', tous);
    choix = el.checked ? [...new Set([...choix, el.dataset.cle])] : choix.filter(c => c !== el.dataset.cle);
    await kv.set('decksActifs', choix);
    rendre();
  }
});

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-action]');
  if (!b || b.tagName === 'INPUT') return;
  const a = b.dataset.action;
  try {
    switch (a) {
      case 'importer': return importerOracle();
      case 'sauver': return exporterSauvegarde();
      case 'restaurer': return restaurerSauvegarde();
      case 'proba': await kv.set('proba', b.dataset.id); return rendre();
      case 'interroger': return interroger();
      case 'de-ouinon': {
        const v = lireEntier($('#de-ouinon').value, 1, etat.oracle.donnees.ouiNon.de);
        if (v == null) return toast(`Entre un nombre entre 1 et ${etat.oracle.donnees.ouiNon.de}`);
        return interroger(v);
      }
      case 'choix-forcage': etat.dernier.ouinon.choixForcage = true; return rendre();
      case 'forcer-rep': return forcerReponse(Number(b.dataset.i));
      case 'tirer-mots': return tirerMots(b.dataset.id);
      case 'mots-physiques': {
        const m = etat.oracle.donnees.mots;
        const t = (m.tirages?.length ? m.tirages : m.listes.map(l => ({ id: l.id, listes: [l.id] }))).find(x => x.id === b.dataset.id);
        const vals = t.listes.map((lid, k) => lireEntier($(`#dm-${CSS.escape(t.id)}-${k}`).value, 1, m.listes.find(l => l.id === lid).mots.length));
        if (vals.some(v => v == null)) return toast('Entre une valeur valide pour chaque dé');
        return tirerMots(t.id, vals);
      }
      case 'deplacement': return deplacement();
      case 'de-tourment': {
        const f = etat.oracle.donnees.tourments.de;
        const v = lireEntier($('#de-tourment').value, 1, f);
        if (v == null) return toast(`Entre un nombre entre 1 et ${f}`);
        return deplacement(v);
      }
      case 'choisir-tourment': return choisirTourment(Number(b.dataset.l));
      case 'tirer-carte': return tirerCarte(false);
      case 'carte-sup': return tirerCarte(true);
      case 'repiocher': return repiocher(Number(b.dataset.k));
      case 'copier-histo': return copierHistorique();
      case 'vider-histo':
        if (confirm('Effacer tout l’historique de cet appareil ?')) { await DB.vider('historique'); await verifierRappel(); rendre(); }
        return;
      case 'rappel': await kv.set('rappelJours', Number(b.dataset.v)); await verifierRappel(); return rendre();
      case 'activer': await kv.set('oracleActif', b.dataset.id); await chargerContenus(); etat.dernier = {}; return rendre();
      case 'suppr-contenu': {
        const c = etat.contenus.find(x => x.id === b.dataset.id);
        if (!confirm(`Retirer « ${c.donnees.nom} » de cet appareil ? (Ton fichier dans iCloud Drive n'est pas touché.)`)) return;
        await DB.suppr('contenus', c.id);
        await chargerContenus(); etat.dernier = {};
        return rendre();
      }
      case 'tout-effacer':
        if (!confirm('Effacer toutes les données de cet appareil (contenus, réglages, historique) ?')) return;
        await DB.vider('contenus'); await DB.vider('kv'); await DB.vider('historique');
        await chargerContenus(); etat.dernier = {}; await verifierRappel();
        return rendre();
    }
  } catch (err) {
    console.error(err);
    alert('Erreur : ' + (err.message || err));
  }
});

/* ---------- Démarrage ---------- */
(async function demarrer() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { }
  await chargerContenus();
  await verifierRappel();
  await rendre();

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const proposer = w => {
        const band = $('#bandeau');
        band.innerHTML = '<span>Nouvelle version disponible.</span><button data-maj>Mettre à jour</button>';
        band.hidden = false;
        band.querySelector('[data-maj]').onclick = () => w.postMessage('activer');
      };
      if (reg.waiting && navigator.serviceWorker.controller) proposer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) proposer(w); });
      });
      let recharge = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!recharge) { recharge = true; location.reload(); } });
    } catch (e) { console.warn('Service worker non enregistré', e); }
  }
})();

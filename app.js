/* Carnet JDR — moteur (étapes 1 à 3 : oracle, dés, parties, journal, exports ; modules de jeu dans jeu.js).
   Ce fichier ne contient aucun contenu de jeu : tables, mots et cartes
   sont importés par l'utilisateur et restent stockés sur l'appareil. */
'use strict';

const VERSION_APP = '1.5.0';
const FORMAT_ORACLE = 'carnet-jdr-oracle';
const FORMAT_SAUVEGARDE = 'carnet-jdr-sauvegarde';
const FACES = [4, 6, 8, 10, 12, 20, 100];

/* ---------- Stockage local (IndexedDB) ---------- */
const DB = (() => {
  let promesse;
  function ouvrir() {
    if (promesse) return promesse;
    promesse = new Promise((ok, ko) => {
      const req = indexedDB.open('carnet-jdr', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('contenus')) db.createObjectStore('contenus', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('historique')) db.createObjectStore('historique', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('parties')) db.createObjectStore('parties', { keyPath: 'id' });
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
const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function dateFr(iso, avecHeure = true) {
  const d = new Date(iso);
  const opt = avecHeure
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' };
  return d.toLocaleString('fr-FR', opt);
}
const heureFr = iso => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
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
const signe = n => (n > 0 ? '+' : n < 0 ? '−' : '') + (n ? Math.abs(n) : '');

/* ---------- État en mémoire ---------- */
const etat = {
  vue: 'ouinon',
  contenus: [],          // fichiers importés
  oracle: null,          // fichier actif pour oui/non, mots, tourments
  parties: [],
  partie: null,          // partie active (null = hors partie)
  dernier: {},           // derniers résultats affichés par vue
  ouverts: {},           // volets « dé physique » ouverts
  des: null,             // configuration du lanceur de dés
  brouillon: '',
  brouillonNote: false,
  edition: null,         // id de l'entrée de journal en cours de modification
  menu: null,            // id de l'entrée dont le menu est ouvert
  defilerBas: false,
};

async function chargerContenus() {
  etat.contenus = (await DB.tous('contenus')).sort((a, b) => a.importeLe.localeCompare(b.importeLe));
  const actif = await kv.get('oracleActif', null);
  const avecBase = etat.contenus.filter(c => c.donnees.ouiNon || c.donnees.mots || c.donnees.tourments);
  etat.oracle = avecBase.find(c => c.id === actif) || avecBase[0] || null;
}

async function chargerParties() {
  etat.parties = (await DB.tous('parties')).sort((a, b) => b.majLe.localeCompare(a.majLe));
  const id = await kv.get('partieActive', null);
  etat.partie = etat.parties.find(p => p.id === id) || null;
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

/* Réglages qui suivent la partie active (decks, Tourment) ; sinon réglages globaux */
async function reglage(cle, defaut) {
  if (etat.partie && etat.partie[cle] !== undefined) return etat.partie[cle];
  return kv.get(cle, defaut);
}
async function fixerReglage(cle, val) {
  if (etat.partie) { etat.partie[cle] = val; await DB.mettre('parties', etat.partie); }
  else await kv.set(cle, val);
}

/* ---------- Journal ---------- */
async function noter(entree) {
  const e = { t: maintenant(), partie: etat.partie?.id ?? null, seance: etat.partie?.seance ?? null, ...entree };
  e.id = await DB.mettre('historique', e);
  if (etat.partie) { etat.partie.majLe = e.t; await DB.mettre('parties', etat.partie); }
  await signalerChangement();
  return e;
}
async function signalerChangement() {
  await kv.set('dernierChangement', maintenant());
  await verifierRappel();
}

async function entreesDe(partieId) {
  return (await DB.tous('historique'))
    .filter(e => (e.partie ?? null) === partieId)
    .sort((a, b) => (a.seance ?? 0) - (b.seance ?? 0) || a.t.localeCompare(b.t) || a.id - b.id);
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
  if (d.format === FORMAT_MODULE) {
    return `module de jeu : ${Object.values(d.fiches || {}).map(f => f.nom).join(', ')} · ${(d.tables || []).length} tables${(d.voies || []).length ? ` · ${d.voies.length} voies` : ''}`;
  }
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
  if (d && d.format === FORMAT_MODULE) return importerModule(d);
  if (d && d.format === FORMAT_COMPLEMENT) return importerComplement(d);
  const { erreurs, avert } = validerOracle(d);
  if (erreurs.length) { alert('Import refusé :\n\n• ' + erreurs.join('\n• ')); return; }
  if (avert.length && !confirm('Points à vérifier :\n\n• ' + avert.join('\n• ') + '\n\nImporter quand même ?')) return;
  const existe = etat.contenus.find(c => c.id === d.id);
  if (existe && !confirm(`« ${d.nom} » est déjà importé. Le remplacer par ce fichier ?`)) return;
  await DB.mettre('contenus', { id: d.id, importeLe: existe ? existe.importeLe : maintenant(), majLe: maintenant(), donnees: d });
  await chargerContenus();
  // Les nouveaux decks sont activés dans les réglages globaux et dans la partie active.
  const nouveaux = existe ? [] : (d.decks || []).map(dk => `${d.id}::${dk.id}`);
  const choix = await kv.get('decksActifs', null);
  if (choix === null) await kv.set('decksActifs', tousLesDecks().map(dk => dk.cle));
  else if (nouveaux.length) await kv.set('decksActifs', [...choix, ...nouveaux]);
  if (etat.partie && Array.isArray(etat.partie.decksActifs) && nouveaux.length) {
    await fixerReglage('decksActifs', [...etat.partie.decksActifs, ...nouveaux]);
  }
  await signalerChangement();
  toast(`« ${d.nom} » importé`);
  rendre();
}

async function importerModule(d) {
  const { erreurs, avert } = validerModule(d);
  if (erreurs.length) { alert('Import refusé :\n\n• ' + erreurs.join('\n• ')); return; }
  if (avert.length && !confirm('Points à vérifier :\n\n• ' + avert.slice(0, 12).join('\n• ') + (avert.length > 12 ? `\n… et ${avert.length - 12} autre(s)` : '') + '\n\nImporter quand même ?')) return;
  const existe = etat.contenus.find(c => c.id === d.id);
  if (existe && !confirm(`« ${d.nom} » est déjà importé. Le remplacer par ce fichier ?\n\nLes fiches de tes parties sont conservées.`)) return;
  // Les règles rattachées par un complément sont gardées si le nouveau fichier n'en apporte pas
  if (existe?.donnees.regles && !d.regles) { d.regles = existe.donnees.regles; d.complements = existe.donnees.complements; }
  await DB.mettre('contenus', { id: d.id, importeLe: existe ? existe.importeLe : maintenant(), majLe: maintenant(), donnees: d });
  await chargerContenus();
  if (etat.partie && !etat.partie.module && confirm(`Lier « ${d.nom} » à la partie ouverte « ${etat.partie.nom} » ?`)) {
    etat.partie.module = d.id;
    if (!etat.partie.jeu) etat.partie.jeu = d.nom;
    await DB.mettre('parties', etat.partie);
  }
  await signalerChangement();
  toast(`Module « ${d.nom} » importé`);
  rendre();
}

/* Partage d'un fichier : feuille de partage iOS, sinon téléchargement */
async function partagerFichier(nom, contenu, type) {
  const blob = new Blob([contenu], { type });
  const fichier = new File([blob], nom, { type });
  if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
    try { await navigator.share({ files: [fichier], title: nom }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

async function exporterSauvegarde() {
  const contenu = {
    format: FORMAT_SAUVEGARDE,
    version: 2,
    app: VERSION_APP,
    creeLe: maintenant(),
    contenus: await DB.tous('contenus'),
    kv: Object.fromEntries(await Promise.all((await DB.cles('kv')).map(async k => [k, await DB.get('kv', k)]))),
    historique: await DB.tous('historique'),
    parties: await DB.tous('parties'),
  };
  delete contenu.kv.derniereSauvegarde;
  const jour = new Date().toISOString().slice(0, 10);
  const ok = await partagerFichier(`carnet-jdr-sauvegarde-${jour}.json`, JSON.stringify(contenu, null, 1), 'application/json');
  if (!ok) return;
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
  const np = (d.parties || []).length;
  if (!confirm(`Restaurer la sauvegarde du ${dateFr(d.creeLe)} ?\n\n${(d.contenus || []).length} fichier(s) de contenu, ${np} partie(s), ${n} entrée(s) de journal.\n\nLes données actuelles de cet appareil seront remplacées.`)) return;
  for (const s of ['contenus', 'kv', 'historique', 'parties']) await DB.vider(s);
  for (const c of d.contenus || []) await DB.mettre('contenus', c);
  for (const [k, v] of Object.entries(d.kv || {})) await DB.mettre('kv', v, k);
  for (const h of d.historique || []) await DB.mettre('historique', h);
  for (const p of d.parties || []) await DB.mettre('parties', p);
  await kv.set('derniereSauvegarde', d.creeLe);
  await kv.set('dernierChangement', d.creeLe);
  await chargerContenus(); await chargerParties();
  etat.dernier = {}; etat.des = null;
  toast('Sauvegarde restaurée');
  await verifierRappel();
  rendre();
}

/* ---------- Rappel de sauvegarde ---------- */
async function verifierRappel() {
  const band = $('#bandeau');
  // Une mise à jour en attente passe avant le rappel de sauvegarde
  if (etat.majEnAttente) {
    band.innerHTML = '<span>Nouvelle version disponible.</span><button data-maj>Mettre à jour</button>';
    band.querySelector('[data-maj]').onclick = () => etat.majEnAttente.postMessage('activer');
    band.hidden = false;
    return;
  }
  const jours = await kv.get('rappelJours', 7);
  const derniere = await kv.get('derniereSauvegarde', null);
  let dernierChangement = await kv.get('dernierChangement', null);
  if (!dernierChangement) {   // données de l'étape 1
    const histo = await DB.tous('historique');
    dernierChangement = histo.length ? histo[histo.length - 1].t : (etat.contenus.length ? etat.contenus[etat.contenus.length - 1].majLe : null);
  }
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
const TITRES = { ouinon: 'Oracle oui/non', mots: 'Mots clés', evenements: 'Événements', des: 'Dés', jeu: 'Jeu', journal: 'Journal', parties: 'Parties', reglages: 'Réglages' };

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
    type: 'ouinon', question, proba: p.nom, de: o.de, valeur, physique: valeurPhysique != null,
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
  return await reglage('tourment', def);
}

function prochaineLigne(ligne, sens, nb) {
  if (nb <= 1) return { ligne: 1, sens: 1 };
  let s = sens;
  if (ligne + s > nb || ligne + s < 1) s = -s;
  return { ligne: ligne + s, sens: s };
}

async function decksActifs() {
  const tous = tousLesDecks();
  const choix = await reglage('decksActifs', null);
  return choix === null ? tous : tous.filter(d => choix.includes(d.cle));
}

async function vueEvenements() {
  const tr = etat.oracle?.donnees.tourments;
  const decks = tousLesDecks();
  if (!tr && !decks.length) return sansOracle('de table de Tourments ni de deck');
  const actifsDecks = await decksActifs();
  const actifs = actifsDecks.map(d => d.cle);
  const pioche = actifsDecks.reduce((n, d) => n + d.cartes.length, 0);
  const t = await etatTourment();
  const r = etat.dernier.evenements;
  let html = '';
  if (tr) {
    html += `<div class="carte">
      <h2>Tourment</h2>
      <div class="echelle" style="grid-template-columns:repeat(${tr.lignes.length},1fr)">${tr.lignes.map((l, i) =>
        `<button class="echelon ${i + 1 === t.ligne ? 'courant' : ''}" data-action="choisir-tourment" data-l="${i + 1}">${i + 1}<small>${i + 1 === t.ligne ? (t.sens > 0 ? 'monte ▲' : 'descend ▼') : '&nbsp;'}</small></button>`).join('')}</div>
      <button class="principal" data-action="deplacement">Déplacement : lancer le d${tr.de}</button>
      ${blocDePhysique('de-tourment', tr.de)}
      ${tr.consigne ? `<p class="discret petit">${esc(tr.consigne)}</p>` : ''}
    </div>`;
  }
  html += `<div class="carte">
    <h2>Decks${etat.partie ? ' de la partie' : ''}</h2>
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
  await fixerReglage('tourment', suivant);
  etat.dernier.evenements = { ligne: t.ligne, valeur, nb, physique: valeurPhysique != null, cartes };
  await noter({
    type: 'tourment', ligne: t.ligne, de: tr.de, valeur, nb, physique: valeurPhysique != null,
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
  await fixerReglage('tourment', suivant);
  await noter({ type: 'derogation', texte: `Tourment réglé manuellement sur ${suivant.ligne} (${suivant.sens > 0 ? 'montée' : 'descente'})` });
  rendre();
}

/* ---------- Dés ---------- */
const DES_DEFAUT = { faces: 20, n: 1, garde: 'tous', k: 1, mod: 0, comp: '', seuil: '', libelle: '' };

function normaliserDes(c) {
  const x = { ...DES_DEFAUT, ...c };
  x.n = Math.min(20, Math.max(1, x.n | 0));
  x.k = Math.min(x.n, Math.max(1, x.k | 0));
  x.mod = Math.max(-99, Math.min(99, x.mod | 0));
  if (x.n === 1) x.garde = 'tous';
  return x;
}

/* Formule lisible : « 3d6, garder les 2 meilleurs, +1 » */
function formuleFr(c) {
  let s = `${c.n > 1 ? c.n : ''}d${c.faces}`;
  if (c.garde === 'h') s += `, garder ${c.k > 1 ? 'les ' + c.k + ' meilleurs' : 'le meilleur'}`;
  if (c.garde === 'l') s += `, garder ${c.k > 1 ? 'les ' + c.k + ' plus faibles' : 'le plus faible'}`;
  if (c.mod) s += ` ${signe(c.mod)}`;
  return s;
}

/* Calcule un jet. valeurs : résultats des dés physiques (facultatif). */
function calculerJet(cfg, valeurs) {
  const c = normaliserDes(cfg);
  const des = valeurs ? valeurs.slice(0, c.n) : Array.from({ length: c.n }, () => de(c.faces));
  let gardes = des.map((_, i) => i);
  if (c.garde !== 'tous' && c.k < c.n) {
    const ordre = des.map((v, i) => [v, i]).sort((a, b) => (c.garde === 'h' ? b[0] - a[0] : a[0] - b[0]) || a[1] - b[1]);
    gardes = ordre.slice(0, c.k).map(x => x[1]).sort((a, b) => a - b);
  }
  const total = gardes.reduce((s, i) => s + des[i], 0) + c.mod;
  const seuil = c.comp && String(c.seuil).trim() !== '' && Number.isFinite(Number(c.seuil)) ? Number(c.seuil) : null;
  const reussite = seuil == null ? null : c.comp === '<=' ? total <= seuil : total >= seuil;
  return {
    formule: formuleFr(c), faces: c.faces, des, gardes, mod: c.mod, total,
    comp: seuil == null ? null : c.comp, seuil, reussite, libelle: (c.libelle || '').trim(),
  };
}

function detailJet(h) {
  const simple = h.des.length === 1 && !h.mod;
  if (simple) return `${h.formule} = ${h.total}`;
  const des = h.des.map((v, i) => (h.gardes.includes(i) ? String(v) : `(${v})`)).join(', ');
  return `${h.formule} : ${des}${h.mod ? ' ' + signe(h.mod) : ''} = ${h.total}`;
}

async function configDes() {
  if (!etat.des) etat.des = normaliserDes(await kv.get('desConfig', DES_DEFAUT));
  return etat.des;
}
async function majDes(changement) {
  etat.des = normaliserDes({ ...(await configDes()), ...changement });
  await kv.set('desConfig', etat.des);
}

function stepper(nom, valeur, libelle, affichage) {
  return `<div class="stepper"><span class="discret petit">${libelle}</span>
    <div class="rangee serree">
      <button data-action="des-moins" data-champ="${nom}" aria-label="Moins">−</button>
      <output>${affichage ?? valeur}</output>
      <button data-action="des-plus" data-champ="${nom}" aria-label="Plus">+</button>
    </div></div>`;
}

async function vueDes() {
  const c = await configDes();
  const favoris = await kv.get('favorisDes', []);
  const r = etat.dernier.jet;
  return `<div class="carte">
    <h2>Dé</h2>
    <div class="puces">${FACES.map(f => `<button class="puce ${f === c.faces ? 'choisie' : ''}" data-action="des-faces" data-f="${f}">d${f}</button>`).join('')}</div>
    <div class="grille-2">
      ${stepper('n', c.n, 'Nombre de dés')}
      ${stepper('mod', c.mod, 'Modificateur', c.mod ? signe(c.mod) : '0')}
    </div>
    ${c.n > 1 ? `<h3>Dés gardés</h3>
    <div class="puces">
      ${[['tous', 'Tous (somme)'], ['h', 'Les meilleurs'], ['l', 'Les plus faibles']].map(([v, l]) =>
        `<button class="puce ${c.garde === v ? 'choisie' : ''}" data-action="des-garde" data-v="${v}">${l}</button>`).join('')}
    </div>
    ${c.garde !== 'tous' ? stepper('k', c.k, 'Combien en garder') : ''}` : ''}
    <details class="de-physique" data-garde="des-options">
      <summary>Libellé et seuil de réussite</summary>
      <input type="text" id="des-libelle" placeholder="Libellé (ex. : sauvegarde de DEX)" value="${esc(c.libelle)}">
      <div class="rangee" style="margin-top:8px">
        <select id="des-comp" aria-label="Comparaison">
          <option value="" ${!c.comp ? 'selected' : ''}>Pas de seuil</option>
          <option value="<=" ${c.comp === '<=' ? 'selected' : ''}>Réussite si total ≤</option>
          <option value=">=" ${c.comp === '>=' ? 'selected' : ''}>Réussite si total ≥</option>
        </select>
        <input type="number" inputmode="numeric" id="des-seuil" placeholder="seuil" value="${esc(c.seuil)}">
      </div>
    </details>
    <div style="margin-top:12px"><button class="principal" data-action="lancer">Lancer ${esc(formuleFr(c))}</button></div>
    <details class="de-physique" data-garde="des-physiques">
      <summary>J'ai lancé mes dés (${c.n > 1 ? c.n + ' × ' : ''}d${c.faces})</summary>
      <div class="rangee">${Array.from({ length: c.n }, (_, i) =>
        `<input type="number" inputmode="numeric" min="1" max="${c.faces}" id="dp-${i}" placeholder="d${c.faces}">`).join('')}
        <button data-action="des-physiques">Valider</button></div>
    </details>
    ${r ? rendreResultatJet(r) : ''}
  </div>
  <div class="carte">
    <h2>Jets mémorisés</h2>
    ${favoris.length ? `<div class="pile">${favoris.map((f, i) => `<div class="rangee serree favori">
      <button data-action="fav-lancer" data-i="${i}">${esc(f.libelle || formuleFr(f))}<small class="discret"> ${f.libelle ? esc(formuleFr(f)) : ''}${f.comp ? ` · ${f.comp === '<=' ? '≤' : '≥'} ${esc(f.seuil)}` : ''}</small></button>
      <button class="lien" data-action="fav-charger" data-i="${i}">Régler</button>
      <button class="lien danger" data-action="fav-suppr" data-i="${i}" aria-label="Retirer">✕</button>
    </div>`).join('')}</div>` : '<p class="discret petit">Aucun pour l’instant.</p>'}
    <button class="lien" data-action="fav-ajouter">+ Mémoriser le jet réglé ci-dessus</button>
  </div>`;
}

function rendreResultatJet(r) {
  const des = r.des.map((v, i) => `<span class="de-res ${r.gardes.includes(i) ? '' : 'ecarte'}">${v}</span>`).join('');
  return `<div class="resultat">
    ${r.libelle ? `<div class="meta">${esc(r.libelle)}</div>` : ''}
    <div class="reponse ${r.reussite === true ? 'oui' : r.reussite === false ? 'non' : ''}">${r.totalForce ?? r.total}</div>
    ${r.reussite != null ? `<div class="meta"><strong>${r.reussite ? 'Réussite' : 'Échec'}</strong> (seuil ${r.comp === '<=' ? '≤' : '≥'} ${r.seuil})</div>` : ''}
    ${r.mention ? `<div class="meta mention"><strong>${esc(r.mention)}</strong></div>` : ''}
    ${r.des.length > 1 || r.mod ? `<div class="des-detail">${des}${r.mod ? `<span class="discret">${signe(r.mod)}</span>` : ''}</div>` : ''}
    <div class="meta">${esc(r.formule)} · dés ${r.physique ? 'physiques' : 'virtuels'}</div>
    ${r.totalForce != null ? `<div class="force">${r.chance ? 'Point de chance dépensé' : 'Total forcé'} (le jet donnait ${r.total})</div>` : ''}
    ${typeof boutonsJetSupp === 'function' ? boutonsJetSupp(r) : ''}
    ${r.sansForcage ? '' : r.choixForcage ? `<div class="rangee" style="margin-top:10px"><input type="number" inputmode="numeric" id="total-force" placeholder="total"><button data-action="forcer-total">Valider</button></div>`
      : `<button class="lien" data-action="choix-forcage-jet">Forcer un autre total</button>`}
  </div>`;
}

function lireOptionsDes() {
  const lib = $('#des-libelle'), comp = $('#des-comp'), seuil = $('#des-seuil');
  return lib ? { libelle: lib.value, comp: comp.value, seuil: seuil.value } : {};
}

async function lancerJet(cfg, valeurs) {
  const r = calculerJet(cfg, valeurs);
  const physique = !!valeurs;
  await noter({ type: 'jet', physique, ...r });
  etat.dernier.jet = { ...r, physique };
  rendre();
}

async function forcerTotal() {
  const r = etat.dernier.jet;
  const v = Number($('#total-force').value);
  if (!Number.isInteger(v)) return toast('Entre un nombre entier');
  r.totalForce = v === r.total ? null : v; r.choixForcage = false;
  if (r.totalForce != null) {
    if (r.seuil != null) r.reussite = r.comp === '<=' ? v <= r.seuil : v >= r.seuil;
    await noter({ type: 'derogation', texte: `Jet${r.libelle ? ' « ' + r.libelle + ' »' : ''} : total forcé à ${v} au lieu de ${r.total}${r.seuil != null ? ` (${r.reussite ? 'réussite' : 'échec'})` : ''}` });
  }
  rendre();
}

/* ---------- Texte des entrées ---------- */
function texteEntree(h) {
  switch (h.type) {
    case 'ouinon': return `Oracle${h.question ? ' « ' + h.question + ' »' : ''} → ${h.reponse} (d${h.de ?? 20} = ${h.valeur}, ${h.proba}${h.physique ? ', dé physique' : ''})`;
    case 'mots': return `${h.tirage} : ${h.mots.map(m => `${m.mot} (${m.valeur})`).join(' + ')}${h.physique ? ' — dés physiques' : ''}`;
    case 'tourment': return `Déplacement — Tourment ${h.ligne}, d${h.de ?? 6} = ${h.valeur} → ${h.nb} carte(s)${h.physique ? ', dé physique' : ''}${h.cartes.length ? ' : ' + h.cartes.map(c => c.titre).join(', ') : ''}`;
    case 'carte': return `Carte${h.ajout ? ' ajoutée' : ''} : ${h.cartes.map(c => `${c.titre} (${c.deck})`).join(', ')}`;
    case 'jet': return `${h.libelle ? h.libelle + ' — ' : ''}${detailJet(h)}${h.reussite != null ? ` (${h.comp === '<=' ? '≤' : '≥'} ${h.seuil} : ${h.reussite ? 'réussite' : 'échec'})` : ''}${h.mention ? ' — ' + h.mention : ''}${h.physique ? ', dés physiques' : ''}`;
    case 'table': return `${h.libelle ? h.libelle + ' — ' : ''}${(h.resultats || []).map(r => `${r.table} (${r.de} = ${r.valeur}) → ${r.texte}`).join(' ; ')}${h.physique ? ', dés physiques' : ''}`;
    case 'fiche': case 'combat': return h.texte;
    case 'derogation': return `Dérogation — ${h.texte}`;
    case 'texte': return h.texte;
    default: return h.texte || JSON.stringify(h);
  }
}
const ICONES = { ouinon: '?', mots: 'Aa', tourment: '✦', carte: '✦', jet: '⚄', table: '▤', fiche: '◈', derogation: '↺', combat: '⚔' };

/* Texte des cartes (pour les exports) */
function cartesDetail(h) {
  const l = (h.cartes || []).filter(c => c.texte).map(c => `${c.titre} : ${c.texte}`);
  if (h.type === 'table') l.push(...(h.resultats || []).filter(r => r.detail).map(r => `${r.texte} : ${r.detail}`));
  if (Array.isArray(h.details)) l.push(...h.details.map(x => x.trim()));
  return l;
}

/* ---------- Parties ---------- */
async function creerPartie(nom, jeu, decks, module) {
  const tr = etat.oracle?.donnees.tourments;
  const p = {
    id: nouvelId(), nom, jeu: jeu || '', module: module || null, fiches: [],
    creeLe: maintenant(), majLe: maintenant(),
    seance: 1, seances: [{ numero: 1, debut: maintenant() }],
    decksActifs: decks, tourment: { ligne: tr?.depart || 1, sens: 1 },
  };
  await DB.mettre('parties', p);
  await kv.set('partieActive', p.id);
  await chargerParties();
  etat.dernier = {};
  await signalerChangement();
  return p;
}

async function activerPartie(id) {
  const br = $('#brouillon');   // le brouillon reste attaché à la partie qu'on quitte
  if (br) { clearTimeout(minuterieBrouillon); await kv.set('brouillon:' + (etat.partie?.id ?? 'hors'), br.value); br.remove(); }
  await kv.set('partieActive', id);
  await chargerParties();
  etat.dernier = {}; etat.edition = null; etat.menu = null;
  etat.ficheOuverte = null; etat.ficheEdition = false; etat.slotEdit = null; etat.nouvelleFiche = null; etat.tableOuverte = null;
  etat.brouillon = await kv.get('brouillon:' + (id ?? 'hors'), '');
  etat.brouillonNote = false;
}

async function nouvelleSeance() {
  const p = etat.partie;
  const entrees = await entreesDe(p.id);
  if (!entrees.some(e => e.seance === p.seance)) return toast(`La séance ${p.seance} est encore vide`);
  p.seance += 1;
  p.seances.push({ numero: p.seance, debut: maintenant() });
  p.majLe = maintenant();
  await DB.mettre('parties', p);
  await signalerChangement();
  etat.defilerBas = true;
  toast(`Séance ${p.seance} commencée`);
  rendre();
}

async function supprimerPartie(id) {
  const p = etat.parties.find(x => x.id === id);
  const entrees = await entreesDe(id);
  if (!confirm(`Supprimer la partie « ${p.nom} » et son journal (${entrees.length} entrée(s)) ?\n\nPense à exporter le compte rendu avant si tu veux le garder.`)) return;
  for (const e of entrees) await DB.suppr('historique', e.id);
  await DB.suppr('parties', id);
  if (etat.partie?.id === id) await activerPartie(null);
  else await chargerParties();
  await signalerChangement();
  rendre();
}

async function rattacherHorsPartie() {
  const p = etat.partie;
  const loin = await entreesDe(null);
  if (!confirm(`Rattacher ${loin.length} entrée(s) hors partie à « ${p.nom} » (séance ${p.seance}) ?`)) return;
  for (const e of loin) { e.partie = p.id; e.seance = p.seance; await DB.mettre('historique', e); }
  await signalerChangement();
  toast('Entrées rattachées');
  rendre();
}

async function vueParties() {
  const histo = await DB.tous('historique');
  const compte = id => histo.filter(e => (e.partie ?? null) === id).length;
  const decks = tousLesDecks();
  const choixGlobal = await kv.get('decksActifs', null);
  const f = etat.formPartie;
  return `${f ? `<div class="carte">
    <h2>${f.id ? 'Modifier la partie' : 'Nouvelle partie'}</h2>
    <h3>Nom</h3>
    <input type="text" id="p-nom" value="${esc(f.nom)}" placeholder="Ex. : La dette du Nébuleuse">
    <h3>Module de jeu</h3>
    <select id="p-module"><option value="">Aucun (jeu libre)</option>${modulesImportes().map(m => `<option value="${esc(m.id)}" ${f.module === m.id ? 'selected' : ''}>${esc(m.donnees.nom)}</option>`).join('')}</select>
    <p class="discret petit">${modulesImportes().length ? 'Le module donne les fiches, la création de personnage et les tables (onglet Jeu).' : 'Aucun module importé : tu pourras en lier un plus tard depuis l’onglet Jeu.'}</p>
    <h3>Jeu (facultatif)</h3>
    <input type="text" id="p-jeu" value="${esc(f.jeu)}" placeholder="Ex. : le nom du système joué">
    ${!f.id && decks.length ? `<h3>Decks d'événements</h3>
      ${decks.map(d => `<label class="case"><input type="checkbox" class="p-deck" value="${esc(d.cle)}" ${choixGlobal === null || choixGlobal.includes(d.cle) ? 'checked' : ''}> ${esc(d.nom)}</label>`).join('')}
      <p class="discret petit">Modifiable ensuite dans l'onglet Événements.</p>` : ''}
    <div class="rangee" style="margin-top:12px">
      <button data-action="p-annuler">Annuler</button>
      <button class="principal" style="flex:2" data-action="p-valider">${f.id ? 'Enregistrer' : 'Créer et ouvrir'}</button>
    </div>
  </div>` : `<button class="principal" data-action="p-nouvelle" style="margin-bottom:14px">Nouvelle partie</button>`}
  ${etat.parties.map(p => `<div class="carte partie ${etat.partie?.id === p.id ? 'active' : ''}">
    <div class="titre">${esc(p.nom)} ${etat.partie?.id === p.id ? '<span class="etiquette">en cours</span>' : ''}</div>
    <div class="discret petit">${p.jeu ? esc(p.jeu) + ' · ' : ''}${p.seances.length} séance(s) · ${compte(p.id)} entrée(s) · ${esc(dateFr(p.majLe))}</div>
    <div class="rangee" style="margin-top:8px">
      ${etat.partie?.id === p.id ? '<button data-action="p-journal">Journal</button>' : `<button data-action="p-ouvrir" data-id="${esc(p.id)}">Ouvrir</button>`}
      <button class="lien" data-action="p-modifier" data-id="${esc(p.id)}">Modifier</button>
      <button class="lien danger" data-action="p-suppr" data-id="${esc(p.id)}">Supprimer</button>
    </div>
  </div>`).join('')}
  <div class="carte ${!etat.partie ? 'partie active' : ''}">
    <div class="titre">Hors partie ${!etat.partie ? '<span class="etiquette">en cours</span>' : ''}</div>
    <div class="discret petit">Jets et tirages libres, hors de toute partie · ${compte(null)} entrée(s)</div>
    ${etat.partie ? '<div class="rangee" style="margin-top:8px"><button data-action="p-ouvrir" data-id="">Jouer hors partie</button></div>' : ''}
  </div>`;
}

/* ---------- Journal ---------- */
function grouperParSeance(partie, entrees) {
  if (!partie) return [{ numero: null, debut: entrees[0]?.t, entrees }];
  return partie.seances.map(s => ({ ...s, entrees: entrees.filter(e => (e.seance ?? 1) === s.numero) }));
}

function rendreEntree(e) {
  const menu = etat.menu === e.id;
  const actions = menu ? `<div class="menu-entree">
    ${e.type === 'texte' ? `<button class="lien" data-action="j-modifier" data-id="${e.id}">Modifier</button>` : ''}
    <button class="lien danger" data-action="j-suppr" data-id="${e.id}">Supprimer</button>
    <button class="lien" data-action="j-menu" data-id="">Fermer</button>
  </div>` : '';
  if (e.type === 'texte') {
    if (etat.edition === e.id) {
      return `<li class="j-texte"><textarea id="edition" rows="5">${esc(e.texte)}</textarea>
        <label class="case petit"><input type="checkbox" id="edition-note" ${e.note ? 'checked' : ''}> Note hors récit</label>
        <div class="rangee"><button data-action="j-annuler">Annuler</button><button class="principal" style="flex:2" data-action="j-enregistrer" data-id="${e.id}">Enregistrer</button></div></li>`;
    }
    return `<li class="j-texte ${e.note ? 'note' : ''}" data-action="j-menu" data-id="${e.id}">
      ${e.note ? '<div class="quand">Note hors récit</div>' : ''}<div class="prose">${esc(e.texte)}</div>${actions}</li>`;
  }
  const cartes = cartesDetail(e);
  return `<li class="j-meca ${e.type === 'derogation' ? 'derog' : ''}" data-action="j-menu" data-id="${e.id}">
    <span class="ico-meca">${ICONES[e.type] || '•'}</span>
    <div><div class="quoi">${esc(texteEntree(e))}</div>
    ${cartes.length ? `<div class="detail-cartes">${cartes.map(t => `<div>${esc(t)}</div>`).join('')}</div>` : ''}
    <div class="quand">${esc(heureFr(e.t))}</div>${actions}</div>
  </li>`;
}

async function vueJournal() {
  const p = etat.partie;
  const entrees = await entreesDe(p?.id ?? null);
  const horsPartie = p ? (await entreesDe(null)).length : 0;
  const groupes = grouperParSeance(p, entrees);
  let html = `<div class="carte">
    <div class="titre">${p ? esc(p.nom) : 'Hors partie'}</div>
    <div class="discret petit">${p ? `${p.jeu ? esc(p.jeu) + ' · ' : ''}séance ${p.seance}` : 'Aucune partie ouverte : les entrées ne sont rattachées à rien.'}</div>
    <div class="rangee" style="margin-top:10px">
      ${p ? '<button data-action="nouvelle-seance">Nouvelle séance</button>' : '<button data-action="aller-parties">Créer ou ouvrir une partie</button>'}
      <button data-action="aller-export" ${entrees.length ? '' : 'disabled'}>Exporter</button>
    </div>
    ${horsPartie ? `<p class="discret petit" style="margin-top:10px">${horsPartie} entrée(s) hors partie (dont l'historique de l'étape 1). <button class="lien" data-action="rattacher">Les rattacher à cette partie</button></p>` : ''}
  </div>`;
  if (etat.exportOuvert && entrees.length) html += await blocExport(p, entrees);
  html += `<div class="carte journal">`;
  if (!entrees.length && (!p || p.seances.length === 1)) {
    html += `<p class="discret" style="text-align:center">Le journal est vide. Les questions à l'oracle, mots, cartes et jets s'inscrivent ici ; écris ton propre texte ci-dessous.</p>`;
  }
  for (const g of groupes) {
    if (g.numero != null && (p.seances.length > 1 || g.entrees.length)) {
      html += `<h3 class="seance">Séance ${g.numero} <span class="discret petit">· ${esc(dateFr(g.debut, false))}</span></h3>`;
    }
    html += g.entrees.length ? `<ul class="journal-liste">${g.entrees.map(rendreEntree).join('')}</ul>` : '<p class="discret petit">Séance vide pour l’instant.</p>';
  }
  html += `</div>
  <div class="carte ecrire">
    <textarea id="brouillon" rows="4" placeholder="Écris la suite : ce que fait ton personnage, ce que tu décides, ce que tu en penses…">${esc(etat.brouillon)}</textarea>
    <div class="rangee">
      <label class="case petit" style="flex:1"><input type="checkbox" id="brouillon-note" ${etat.brouillonNote ? 'checked' : ''}> Note hors récit</label>
      <button class="principal" style="flex:0 0 46%" data-action="j-ajouter">Ajouter</button>
    </div>
  </div>`;
  return html;
}

async function ajouterTexte() {
  const texte = ($('#brouillon')?.value || '').trim();
  if (!texte) return toast('Rien à ajouter');
  await noter({ type: 'texte', texte, note: !!$('#brouillon-note')?.checked });
  etat.brouillon = ''; etat.brouillonNote = false;
  $('#brouillon').value = ''; $('#brouillon-note').checked = false;   // sinon rendre() relirait l'ancien texte
  clearTimeout(minuterieBrouillon);
  await kv.set('brouillon:' + (etat.partie?.id ?? 'hors'), '');
  etat.defilerBas = true;
  rendre();
}

async function enregistrerEdition(id) {
  const e = await DB.get('historique', id);
  const texte = ($('#edition')?.value || '').trim();
  if (!texte) return toast('Le texte est vide (utilise Supprimer pour retirer l’entrée)');
  e.texte = texte; e.note = !!$('#edition-note')?.checked; e.modifieLe = maintenant();
  await DB.mettre('historique', e);
  etat.edition = null; etat.menu = null;
  await signalerChangement();
  rendre();
}

async function supprimerEntree(id) {
  const e = await DB.get('historique', id);
  const msg = e.type === 'texte' ? 'Supprimer ce texte ?' : 'Supprimer cette entrée du journal ?\n\n(La trace du jet ou du tirage disparaîtra aussi des comptes rendus.)';
  if (!confirm(msg)) return;
  await DB.suppr('historique', id);
  etat.menu = null;
  await signalerChangement();
  rendre();
}

/* ---------- Comptes rendus ---------- */
const EXPORTS = {
  cr: { nom: 'CR simple', aide: 'Tout, dans l’ordre chronologique.' },
  bord: { nom: 'Journal de bord', aide: 'Ton texte par séance, la mécanique en retrait.' },
  recit: { nom: 'Récit', aide: 'Ton texte seul, sans la mécanique ni les notes.' },
};

function enteteExport(p, titre) {
  const l = [`# ${p ? p.nom : 'Hors partie'}${titre ? ' — ' + titre : ''}`];
  if (p?.jeu) l.push('', `*${p.jeu}*`);
  return l;
}

function genererExport(type, p, entrees) {
  const groupes = grouperParSeance(p, entrees).filter(g => g.entrees.length);
  const l = [];
  const paragraphe = t => { l.push('', t); };
  if (type === 'recit') {
    l.push(`# ${p ? p.nom : 'Hors partie'}`);
    groupes.forEach((g, i) => {
      const textes = g.entrees.filter(e => e.type === 'texte' && !e.note);
      if (!textes.length) return;
      if (i && l.length > 1) paragraphe('* * *');
      textes.forEach(e => paragraphe(e.texte));
    });
    return l.join('\n') + '\n';
  }
  l.push(...enteteExport(p, EXPORTS[type].nom));
  for (const g of groupes) {
    if (g.numero != null) { l.push('', `## Séance ${g.numero} — ${dateFr(g.debut, false)}`); }
    if (type === 'cr') {
      let enListe = false;
      for (const e of g.entrees) {
        if (e.type === 'texte') {
          paragraphe(e.note ? `*Note : ${e.texte}*` : e.texte); enListe = false;
        } else {
          if (!enListe) l.push('');
          l.push(`- ${heureFr(e.t)} · ${texteEntree(e)}`);
          cartesDetail(e).forEach(t => l.push(`  - ${t}`));
          enListe = true;
        }
      }
    } else { // journal de bord
      let enCitation = false;
      for (const e of g.entrees) {
        if (e.type === 'texte') {
          paragraphe(e.note ? `*Note : ${e.texte}*` : e.texte); enCitation = false;
        } else {
          if (!enCitation) l.push(''); else l.push('>');
          l.push(`> *${texteEntree(e)}*`);
          enCitation = true;
        }
      }
    }
  }
  return l.join('\n') + '\n';
}

async function blocExport(p, entrees) {
  const type = etat.exportType || 'cr';
  const txt = genererExport(type, p, entrees);
  return `<div class="carte">
    <h2>Compte rendu</h2>
    <div class="puces">${Object.entries(EXPORTS).map(([k, v]) =>
      `<button class="puce ${k === type ? 'choisie' : ''}" data-action="export-type" data-t="${k}">${v.nom}</button>`).join('')}</div>
    <p class="discret petit">${EXPORTS[type].aide}</p>
    <div class="pile">
      <button data-action="export-texte">Partager le texte (Notes…)</button>
      <button data-action="export-fichier">Enregistrer en fichier .md (Fichiers…)</button>
      <button data-action="export-copier">Copier</button>
    </div>
    <details class="de-physique" data-garde="export-apercu"><summary>Aperçu</summary><pre class="apercu">${esc(txt)}</pre></details>
    <button class="lien" data-action="aller-export">Fermer</button>
  </div>`;
}

async function texteExport() {
  const p = etat.partie;
  return genererExport(etat.exportType || 'cr', p, await entreesDe(p?.id ?? null));
}
function nomFichierExport() {
  const base = (etat.partie?.nom || 'hors-partie').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'partie';
  const suffixe = { cr: 'cr', bord: 'journal-de-bord', recit: 'recit' }[etat.exportType || 'cr'];
  return `${base}-${suffixe}-${new Date().toISOString().slice(0, 10)}.md`;
}

async function partagerTexteExport() {
  const txt = await texteExport();
  if (navigator.share) {
    try { await navigator.share({ title: etat.partie?.nom || 'Compte rendu', text: txt }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  await copierTexte(txt);
}
async function copierTexte(txt) {
  try { await navigator.clipboard.writeText(txt); toast('Texte copié'); }
  catch { alert('Copie impossible sur ce navigateur.'); }
}

/* ---------- Réglages ---------- */
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
    <div style="margin-top:12px"><button class="principal" data-action="importer">Importer un fichier (oracle ou module)</button></div>
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
    <p class="discret petit">La sauvegarde contient tes contenus d'oracle et tes parties : garde-la pour toi (iCloud Drive), ne la partage pas. Pour passer de l'iPhone à l'iPad : exporte sur l'un, restaure sur l'autre.</p>
  </div>

  <div class="carte">
    <h2>À propos</h2>
    <p class="discret petit">Carnet JDR ${VERSION_APP} · données stockées uniquement sur cet appareil${persistant === true ? ' (stockage persistant accordé)' : persistant === false ? ' (stockage non persistant : pense aux sauvegardes)' : ''}.</p>
    <p class="discret petit">Sur iPhone et iPad, l'appli de l'écran d'accueil a son propre stockage, distinct de Safari : importe tes fichiers depuis l'appli installée.</p>
    <button data-action="chercher-maj">Rechercher une mise à jour</button>
    <button class="lien danger" data-action="tout-effacer">Effacer toutes les données de cet appareil</button>
  </div>`;
}

/* ---------- Rendu et événements ---------- */
async function rendre() {
  const vues = { ouinon: vueOuiNon, mots: vueMots, evenements: vueEvenements, des: vueDes, jeu: vueJeu, journal: vueJournal, parties: vueParties, reglages: vueReglages };
  $('#titre-vue').textContent = TITRES[etat.vue];
  const bp = $('#btn-partie');
  bp.textContent = etat.partie ? etat.partie.nom : 'Hors partie';
  bp.classList.toggle('sans', !etat.partie);
  document.querySelectorAll('.onglets button').forEach(b => b.classList.toggle('actif', b.dataset.vue === etat.vue));
  const q = $('#question'); if (q) etat.questionEnCours = q.value;
  const br = $('#brouillon'); if (br) { etat.brouillon = br.value; etat.brouillonNote = !!$('#brouillon-note')?.checked; }
  if ($('#des-libelle')) etat.des = normaliserDes({ ...etat.des, ...lireOptionsDes() });
  // Les volets ouverts le restent après un jet
  document.querySelectorAll('details[data-garde]').forEach(d => { etat.ouverts[d.dataset.garde] = d.open; });
  $('#vue').innerHTML = await vues[etat.vue]();
  document.querySelectorAll('details[data-garde]').forEach(d => { if (etat.ouverts[d.dataset.garde]) d.open = true; });
  if (etat.defilerBas) { etat.defilerBas = false; window.scrollTo(0, document.body.scrollHeight); }
}

async function allerA(vue) {
  etat.vue = vue;
  etat.menu = null; etat.edition = null;
  if (vue === 'journal') etat.defilerBas = true;
  await rendre();
  if (vue !== 'journal') window.scrollTo(0, 0);
}

document.querySelector('.onglets').addEventListener('click', e => {
  const b = e.target.closest('button[data-vue]');
  if (b) allerA(b.dataset.vue);
});
$('#btn-partie').addEventListener('click', () => allerA('parties'));

let minuterieBrouillon;
document.addEventListener('input', e => {
  if (e.target.id === 'brouillon') {
    etat.brouillon = e.target.value;
    clearTimeout(minuterieBrouillon);
    minuterieBrouillon = setTimeout(() => kv.set('brouillon:' + (etat.partie?.id ?? 'hors'), etat.brouillon), 600);
  }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.action === 'deck') {
    const tous = tousLesDecks().map(d => d.cle);
    let choix = await reglage('decksActifs', null);
    if (choix === null) choix = tous;
    choix = el.checked ? [...new Set([...choix, el.dataset.cle])] : choix.filter(c => c !== el.dataset.cle);
    await fixerReglage('decksActifs', choix);
    rendre();
  }
  if (['des-libelle', 'des-comp', 'des-seuil'].includes(el.id)) await majDes(lireOptionsDes());
});

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-action]');
  if (!b || b.tagName === 'INPUT') return;
  // Un clic dans un champ ou un lien d'une entrée de journal ne doit pas basculer son menu
  if (b.tagName === 'LI' && e.target.closest('button, textarea, input, label')) return;
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

      /* Dés */
      case 'des-faces': await majDes({ faces: Number(b.dataset.f), ...lireOptionsDes() }); return rendre();
      case 'des-plus': case 'des-moins': {
        const c = await configDes();
        const ch = b.dataset.champ;
        await majDes({ [ch]: c[ch] + (a === 'des-plus' ? 1 : -1), ...lireOptionsDes() });
        return rendre();
      }
      case 'des-garde': await majDes({ garde: b.dataset.v, ...lireOptionsDes() }); return rendre();
      case 'lancer': await majDes(lireOptionsDes()); return lancerJet(etat.des);
      case 'des-physiques': {
        await majDes(lireOptionsDes());
        const c = etat.des;
        const vals = Array.from({ length: c.n }, (_, i) => lireEntier($('#dp-' + i).value, 1, c.faces));
        if (vals.some(v => v == null)) return toast(`Entre une valeur entre 1 et ${c.faces} pour chaque dé`);
        return lancerJet(c, vals);
      }
      case 'choix-forcage-jet': etat.dernier.jet.choixForcage = true; return rendre();
      case 'forcer-total': return forcerTotal();
      case 'fav-ajouter': {
        await majDes(lireOptionsDes());
        const fav = await kv.get('favorisDes', []);
        fav.push({ ...etat.des });
        await kv.set('favorisDes', fav);
        toast('Jet mémorisé'); return rendre();
      }
      case 'fav-lancer': { const fav = await kv.get('favorisDes', []); return lancerJet(fav[Number(b.dataset.i)]); }
      case 'fav-charger': { const fav = await kv.get('favorisDes', []); await majDes(fav[Number(b.dataset.i)]); window.scrollTo(0, 0); return rendre(); }
      case 'fav-suppr': {
        const fav = await kv.get('favorisDes', []);
        fav.splice(Number(b.dataset.i), 1);
        await kv.set('favorisDes', fav); return rendre();
      }

      /* Parties */
      case 'p-nouvelle': etat.formPartie = { nom: '', jeu: '', module: modulesImportes().length === 1 ? modulesImportes()[0].id : '' }; return rendre();
      case 'p-modifier': { const p = etat.parties.find(x => x.id === b.dataset.id); etat.formPartie = { id: p.id, nom: p.nom, jeu: p.jeu, module: p.module || '' }; window.scrollTo(0, 0); return rendre(); }
      case 'p-annuler': etat.formPartie = null; return rendre();
      case 'p-valider': {
        const nom = $('#p-nom').value.trim();
        if (!nom) return toast('Donne un nom à la partie');
        const module = $('#p-module')?.value || null;
        const jeu = $('#p-jeu').value.trim() || (module ? etat.contenus.find(c => c.id === module)?.donnees.nom || '' : '');
        const f = etat.formPartie;
        etat.formPartie = null;
        if (f.id) {
          const p = etat.parties.find(x => x.id === f.id);
          p.nom = nom; p.jeu = jeu; p.module = module; p.majLe = maintenant();
          if (etat.partie?.id === p.id) etat.partie = p;
          await DB.mettre('parties', p); await chargerParties(); await signalerChangement();
          return rendre();
        }
        const cases = [...document.querySelectorAll('.p-deck')];
        const decks = cases.length ? cases.filter(x => x.checked).map(x => x.value) : await kv.get('decksActifs', null);
        await creerPartie(nom, jeu, decks, module);
        etat.brouillon = '';
        toast(`Partie « ${nom} » ouverte`);
        return allerA('journal');
      }
      case 'p-ouvrir': await activerPartie(b.dataset.id || null); return allerA('journal');
      case 'p-journal': return allerA('journal');
      case 'p-suppr': return supprimerPartie(b.dataset.id);
      case 'aller-parties': return allerA('parties');

      /* Journal */
      case 'nouvelle-seance': return nouvelleSeance();
      case 'rattacher': return rattacherHorsPartie();
      case 'j-ajouter': return ajouterTexte();
      case 'j-menu': etat.menu = b.dataset.id ? (etat.menu === Number(b.dataset.id) ? null : Number(b.dataset.id)) : null; return rendre();
      case 'j-modifier': etat.edition = Number(b.dataset.id); etat.menu = null; return rendre();
      case 'j-annuler': etat.edition = null; return rendre();
      case 'j-enregistrer': return enregistrerEdition(Number(b.dataset.id));
      case 'j-suppr': return supprimerEntree(Number(b.dataset.id));
      case 'aller-export': etat.exportOuvert = !etat.exportOuvert; await rendre(); if (etat.exportOuvert) window.scrollTo(0, 0); return;
      case 'export-type': etat.exportType = b.dataset.t; return rendre();
      case 'export-texte': return partagerTexteExport();
      case 'export-fichier': return partagerFichier(nomFichierExport(), await texteExport(), 'text/markdown');
      case 'export-copier': return copierTexte(await texteExport());

      /* Réglages */
      case 'rappel': await kv.set('rappelJours', Number(b.dataset.v)); await verifierRappel(); return rendre();
      case 'activer': await kv.set('oracleActif', b.dataset.id); await chargerContenus(); etat.dernier = {}; return rendre();
      case 'suppr-contenu': {
        const c = etat.contenus.find(x => x.id === b.dataset.id);
        const liees = etat.parties.filter(p => p.module === c.id).length;
        if (!confirm(`Retirer « ${c.donnees.nom} » de cet appareil ? (Ton fichier dans iCloud Drive n'est pas touché.)${liees ? `\n\n${liees} partie(s) l'utilisent : leurs fiches sont conservées, mais restent inaccessibles jusqu'à ce que tu réimportes le module.` : ''}`)) return;
        await DB.suppr('contenus', c.id);
        await chargerContenus(); etat.dernier = {};
        return rendre();
      }
      case 'chercher-maj': {
        const reg = etat.swReg;
        if (!reg) return toast('Mise à jour impossible ici (mode hors service worker)');
        toast('Recherche…');
        try { await reg.update(); } catch { return toast('Pas de connexion : réessaie plus tard'); }
        await new Promise(r => setTimeout(r, 1500));
        const w = reg.waiting || reg.installing;
        if (w && navigator.serviceWorker.controller) {
          if (w.state === 'installed') { etat.majEnAttente = w; await verifierRappel(); return toast('Nouvelle version prête : touche « Mettre à jour » en haut'); }
          w.addEventListener('statechange', () => { if (w.state === 'installed') { etat.majEnAttente = w; verifierRappel(); } });
          return toast('Téléchargement de la nouvelle version…');
        }
        return toast(`Carnet JDR ${VERSION_APP} est à jour`);
      }
      case 'tout-effacer':
        if (!confirm('Effacer toutes les données de cet appareil (contenus, parties, journal, réglages) ?')) return;
        for (const s of ['contenus', 'kv', 'historique', 'parties']) await DB.vider(s);
        await chargerContenus(); await chargerParties();
        etat.dernier = {}; etat.des = null; etat.brouillon = '';
        await verifierRappel();
        return rendre();
      default:
        return actionJeu(a, b);
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
  await chargerParties();
  etat.brouillon = await kv.get('brouillon:' + (etat.partie?.id ?? 'hors'), '');
  await verifierRappel();
  await rendre();

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
      // Sur iPhone, l'appli de l'écran d'accueil reprend sans se recharger : on revérifie à chaque retour.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
      const proposer = w => { etat.majEnAttente = w; verifierRappel(); };
      etat.swReg = reg;
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

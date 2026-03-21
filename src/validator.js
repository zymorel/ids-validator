/**
 * validator.js — Moteur de validation IDS autonome (sans Flask, sans Three.js)
 * Retourne la même structure JSON qu'attendu par l'UI de l'ids-validator.
 */

import * as WebIFC from "web-ifc";

/* ══════════════════════════════════════════════════════════════════════
   PARSING IDS XML
══════════════════════════════════════════════════════════════════════ */

export function parseIDS(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Fichier IDS invalide (XML mal formé)");

  const specs = [];
  for (const specEl of doc.querySelectorAll("specification")) {
    specs.push({
      name:          specEl.getAttribute("name") || qs(specEl, "name") || "Sans nom",
      description:   specEl.getAttribute("description") || qs(specEl, "description") || "",
      ifcVersion:    specEl.getAttribute("ifcVersion") || "",
      applicability: { facets: parseFacets(specEl.querySelector("applicability")) },
      requirements:  { facets: parseFacets(specEl.querySelector("requirements")) },
    });
  }

  const infoEl = doc.querySelector("info");
  return {
    info: {
      title:   qs(infoEl, "title")   || "IDS",
      version: qs(infoEl, "version") || "",
      author:  qs(infoEl, "author")  || "",
    },
    specifications: specs,
  };
}

function qs(el, tag) { return el?.querySelector(tag)?.textContent?.trim() || ""; }

function parseFacets(parentEl) {
  if (!parentEl) return [];
  const facets = [];

  for (const el of parentEl.querySelectorAll(":scope > entity")) {
    facets.push({ type: "entity", name: getFacetValue(el, "name"), predefinedType: getFacetValue(el, "predefinedType") });
  }
  for (const el of parentEl.querySelectorAll(":scope > attribute")) {
    facets.push({ type: "attribute", name: getFacetValue(el, "name"), value: getFacetValue(el, "value"), cardinality: el.getAttribute("cardinality"), minOccurs: el.getAttribute("minOccurs") });
  }
  for (const el of parentEl.querySelectorAll(":scope > property")) {
    facets.push({ type: "property", psetName: getFacetValue(el, "propertySetName"), propName: getFacetValue(el, "baseName") || getFacetValue(el, "name"), value: getFacetValue(el, "value"), dataType: el.getAttribute("dataType") || el.getAttribute("measure"), cardinality: el.getAttribute("cardinality"), minOccurs: el.getAttribute("minOccurs") });
  }
  for (const el of parentEl.querySelectorAll(":scope > classification")) {
    facets.push({ type: "classification", system: getFacetValue(el, "system"), value: getFacetValue(el, "value"), cardinality: el.getAttribute("cardinality"), minOccurs: el.getAttribute("minOccurs") });
  }
  for (const el of parentEl.querySelectorAll(":scope > material")) {
    facets.push({ type: "material", value: getFacetValue(el, "value"), cardinality: el.getAttribute("cardinality"), minOccurs: el.getAttribute("minOccurs") });
  }
  for (const el of parentEl.querySelectorAll(":scope > partOf")) {
    facets.push({ type: "partOf", relation: el.getAttribute("relation"), entity: getFacetValue(el, "name") });
  }
  return facets;
}

function getFacetValue(el, childTag) {
  const child = el?.querySelector(childTag);
  if (!child) return null;
  const sv = child.querySelector("simpleValue");
  if (sv) return { type: "simple", value: sv.textContent.trim() };
  const restriction = child.querySelector("restriction");
  if (restriction) {
    const patterns = [...restriction.querySelectorAll("pattern")].map(p => p.getAttribute("value"));
    const enums    = [...restriction.querySelectorAll("enumeration")].map(e => e.getAttribute("value"));
    const minIncl  = restriction.querySelector("minInclusive")?.getAttribute("value");
    const maxIncl  = restriction.querySelector("maxInclusive")?.getAttribute("value");
    const minExcl  = restriction.querySelector("minExclusive")?.getAttribute("value");
    const maxExcl  = restriction.querySelector("maxExclusive")?.getAttribute("value");
    return { type: "restriction", patterns, enums, minIncl, maxIncl, minExcl, maxExcl };
  }
  const text = child.textContent?.trim();
  return text ? { type: "simple", value: text } : null;
}

/* ══════════════════════════════════════════════════════════════════════
   MATCHING DE VALEUR
══════════════════════════════════════════════════════════════════════ */

function matchValue(facetVal, actualStr) {
  if (!facetVal) return true;
  const actual = String(actualStr ?? "");

  if (facetVal.type === "simple") {
    return actual.toLowerCase() === facetVal.value.toLowerCase();
  }
  if (facetVal.type === "restriction") {
    if (facetVal.patterns?.length) {
      return facetVal.patterns.some(p => { try { return new RegExp("^" + p + "$").test(actual); } catch { return false; } });
    }
    if (facetVal.enums?.length) {
      return facetVal.enums.some(e => actual.toLowerCase() === e.toLowerCase());
    }
    const num = parseFloat(actual);
    if (!isNaN(num)) {
      if (facetVal.minIncl != null && num < parseFloat(facetVal.minIncl)) return false;
      if (facetVal.maxIncl != null && num > parseFloat(facetVal.maxIncl)) return false;
      if (facetVal.minExcl != null && num <= parseFloat(facetVal.minExcl)) return false;
      if (facetVal.maxExcl != null && num >= parseFloat(facetVal.maxExcl)) return false;
    }
    return true;
  }
  return actual.toLowerCase() === String(facetVal).toLowerCase();
}

/* ══════════════════════════════════════════════════════════════════════
   EXTRACTION WEB-IFC (CACHES)
══════════════════════════════════════════════════════════════════════ */

function getVal(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v.value !== undefined) return getVal(v.value);
    if (v.type !== undefined && v.value !== undefined) return getVal(v.value);
  }
  return String(v);
}

function buildStoreyCache(api, modelId) {
  const map = new Map();
  try {
    const rels = api.GetLineIDsWithType(modelId, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < rels.size(); i++) {
      let rel; try { rel = api.GetLine(modelId, rels.get(i)); } catch { continue; }
      if (!rel?.RelatedObjects) continue;
      const strucId = rel.RelatingStructure?.value ?? rel.RelatingStructure;
      if (typeof strucId !== "number") continue;
      let struc; try { struc = api.GetLine(modelId, strucId); } catch { continue; }
      const name = getVal(struc?.Name) || "";
      for (const ref of rel.RelatedObjects) {
        const eid = ref?.value ?? ref;
        if (typeof eid === "number") map.set(eid, name);
      }
    }
  } catch (e) { console.warn("storey cache:", e); }
  return map;
}

function buildClassificationCache(api, modelId) {
  const map = new Map(); // eid → [{systeme, code, description}]
  try {
    const rels = api.GetLineIDsWithType(modelId, WebIFC.IFCRELASSOCIATESCLASSIFICATION);
    for (let i = 0; i < rels.size(); i++) {
      let rel; try { rel = api.GetLine(modelId, rels.get(i)); } catch { continue; }
      if (!rel?.RelatedObjects) continue;
      const refId = rel.RelatingClassification?.value ?? rel.RelatingClassification;
      if (typeof refId !== "number") continue;
      let clRef; try { clRef = api.GetLine(modelId, refId); } catch { continue; }
      const code   = getVal(clRef?.Identification) || getVal(clRef?.ItemReference) || getVal(clRef?.Name) || "";
      const desc   = getVal(clRef?.Name) || "";
      let system = "";
      const srcId = clRef?.ReferencedSource?.value ?? clRef?.ReferencedSource;
      if (typeof srcId === "number") {
        try { const src = api.GetLine(modelId, srcId); system = getVal(src?.Name) || getVal(src?.Source) || ""; } catch {}
      }
      for (const ref of rel.RelatedObjects) {
        const eid = ref?.value ?? ref;
        if (typeof eid !== "number") continue;
        if (!map.has(eid)) map.set(eid, []);
        map.get(eid).push({ systeme: system, code, description: desc });
      }
    }
  } catch (e) { console.warn("classification cache:", e); }
  return map;
}

function buildMaterialCache(api, modelId) {
  const map = new Map(); // eid → string[]
  try {
    const rels = api.GetLineIDsWithType(modelId, WebIFC.IFCRELASSOCIATESMATERIAL);
    for (let i = 0; i < rels.size(); i++) {
      let rel; try { rel = api.GetLine(modelId, rels.get(i)); } catch { continue; }
      if (!rel?.RelatedObjects) continue;
      const matId = rel.RelatingMaterial?.value ?? rel.RelatingMaterial;
      if (typeof matId !== "number") continue;
      let mat; try { mat = api.GetLine(modelId, matId); } catch { continue; }
      const names = extractMatNames(api, modelId, mat);
      for (const ref of rel.RelatedObjects) {
        const eid = ref?.value ?? ref;
        if (typeof eid !== "number") continue;
        if (!map.has(eid)) map.set(eid, []);
        map.get(eid).push(...names);
      }
    }
  } catch (e) { console.warn("material cache:", e); }
  return map;
}

function extractMatNames(api, modelId, mat) {
  if (!mat) return [];
  // IfcMaterial
  if (mat.Name !== undefined && !mat.Materials && !mat.MaterialLayers && !mat.MaterialConstituents && !mat.MaterialProfiles) {
    const n = getVal(mat.Name); return n ? [n] : [];
  }
  // IfcMaterialList
  if (mat.Materials) {
    return mat.Materials.flatMap(r => { const id = r?.value ?? r; try { return extractMatNames(api, modelId, api.GetLine(modelId, id)); } catch { return []; } });
  }
  // IfcMaterialLayerSet / IfcMaterialLayerSetUsage
  if (mat.MaterialLayers) {
    return mat.MaterialLayers.flatMap(r => {
      const id = r?.value ?? r; try { const layer = api.GetLine(modelId, id); const mId = layer?.Material?.value ?? layer?.Material; return typeof mId === "number" ? extractMatNames(api, modelId, api.GetLine(modelId, mId)) : []; } catch { return []; }
    });
  }
  if (mat.ForLayerSet) {
    const id = mat.ForLayerSet?.value ?? mat.ForLayerSet; try { return extractMatNames(api, modelId, api.GetLine(modelId, id)); } catch { return []; }
  }
  // IfcMaterialConstituentSet (IFC4)
  if (mat.MaterialConstituents) {
    return mat.MaterialConstituents.flatMap(r => {
      const id = r?.value ?? r; try { const c = api.GetLine(modelId, id); const mId = c?.Material?.value ?? c?.Material; return typeof mId === "number" ? extractMatNames(api, modelId, api.GetLine(modelId, mId)) : []; } catch { return []; }
    });
  }
  // IfcMaterialProfileSetUsage
  if (mat.ForProfileSet) {
    const id = mat.ForProfileSet?.value ?? mat.ForProfileSet; try { return extractMatNames(api, modelId, api.GetLine(modelId, id)); } catch { return []; }
  }
  const n = getVal(mat.Name); return n ? [n] : [];
}

function buildPropertyCache(api, modelId) {
  const map = new Map(); // eid → Map<psetName, Map<propName, value>>

  function addProps(eid, psetName, props) {
    if (!map.has(eid)) map.set(eid, new Map());
    const pmap = map.get(eid);
    if (!pmap.has(psetName)) pmap.set(psetName, new Map());
    const pm = pmap.get(psetName);
    for (const [k, v] of props) if (!pm.has(k)) pm.set(k, v);
  }

  function extractPsetMap(api, modelId, psetRef) {
    const psetId = psetRef?.value ?? psetRef;
    if (typeof psetId !== "number") return null;
    let pset; try { pset = api.GetLine(modelId, psetId); } catch { return null; }
    if (!pset) return null;
    const psetName = getVal(pset.Name) || "Unknown";
    const props = new Map();
    if (pset.HasProperties) {
      for (const pr of pset.HasProperties) {
        const pid = pr?.value ?? pr;
        try {
          const p = api.GetLine(modelId, pid);
          const k = getVal(p?.Name);
          let v = null;
          if (p?.NominalValue !== undefined) v = getVal(p.NominalValue);
          else if (p?.EnumerationValues) v = p.EnumerationValues.map(e => getVal(e)).join(", ");
          else if (p?.Value !== undefined) v = getVal(p.Value);
          if (k) props.set(k, v);
        } catch {}
      }
    }
    if (pset.Quantities) {
      for (const qr of pset.Quantities) {
        const qid = qr?.value ?? qr; try { const q = api.GetLine(modelId, qid); const k = getVal(q?.Name); const v = q?.LengthValue?.value ?? q?.AreaValue?.value ?? q?.VolumeValue?.value ?? q?.WeightValue?.value ?? q?.CountValue?.value ?? null; if (k && v !== null) props.set(k, v); } catch {}
      }
    }
    return { psetName, props };
  }

  // Instance-level properties via IFCRELDEFINESBYPROPERTIES
  try {
    const rels = api.GetLineIDsWithType(modelId, WebIFC.IFCRELDEFINESBYPROPERTIES);
    for (let i = 0; i < rels.size(); i++) {
      let rel; try { rel = api.GetLine(modelId, rels.get(i)); } catch { continue; }
      if (!rel?.RelatedObjects || !rel.RelatingPropertyDefinition) continue;
      const psetRef = rel.RelatingPropertyDefinition;
      const result = extractPsetMap(api, modelId, psetRef);
      if (!result) continue;
      for (const objRef of rel.RelatedObjects) {
        const eid = objRef?.value ?? objRef;
        if (typeof eid === "number") addProps(eid, result.psetName, result.props);
      }
    }
  } catch {}

  // Type-level properties via IFCRELDEFINESBYTYPE
  try {
    const typeRels = api.GetLineIDsWithType(modelId, WebIFC.IFCRELDEFINESBYTYPE);
    for (let i = 0; i < typeRels.size(); i++) {
      let rel; try { rel = api.GetLine(modelId, typeRels.get(i)); } catch { continue; }
      if (!rel?.RelatedObjects || !rel.RelatingType) continue;
      const typeId = rel.RelatingType?.value ?? rel.RelatingType;
      if (typeof typeId !== "number") continue;
      let type; try { type = api.GetLine(modelId, typeId); } catch { continue; }
      if (!type?.HasPropertySets) continue;
      const results = type.HasPropertySets.map(r => extractPsetMap(api, modelId, r)).filter(Boolean);
      for (const objRef of rel.RelatedObjects) {
        const eid = objRef?.value ?? objRef;
        if (typeof eid !== "number") continue;
        for (const r of results) addProps(eid, r.psetName, r.props);
      }
    }
  } catch {}

  return map;
}

/* ══════════════════════════════════════════════════════════════════════
   VALIDATION FACETTES
══════════════════════════════════════════════════════════════════════ */

function getTypeName(api, modelId, eid) {
  try {
    const line = api.GetLine(modelId, eid);
    return line?.constructor?.name || line?.type?.toString() || "";
  } catch { return ""; }
}

function isAbsent(card, minOcc) {
  if (card === "prohibited") return true;
  if (minOcc === "0") return true;
  return false;
}

function checkFacet(facet, eid, api, modelId, propCache, classifCache, matCache) {
  const typeName = getTypeName(api, modelId, eid);

  if (facet.type === "entity") {
    const nameOk = !facet.name || matchValue(facet.name, typeName);
    let predOk = true;
    if (facet.predefinedType) {
      try { const line = api.GetLine(modelId, eid); predOk = matchValue(facet.predefinedType, getVal(line?.PredefinedType)); } catch { predOk = false; }
    }
    return nameOk && predOk;
  }

  if (facet.type === "attribute") {
    const absent = isAbsent(facet.cardinality, facet.minOccurs);
    try {
      const line = api.GetLine(modelId, eid);
      const attrName = facet.name?.value || facet.name;
      const attrVal = getVal(line?.[attrName]);
      const hasVal = attrVal !== "" && attrVal !== "null" && attrVal !== "undefined";
      if (absent) return !hasVal;
      if (!hasVal) return false;
      return !facet.value || matchValue(facet.value, attrVal);
    } catch { return absent; }
  }

  if (facet.type === "property") {
    const absent = isAbsent(facet.cardinality, facet.minOccurs);
    const psets = propCache.get(eid);
    if (!psets) return absent;
    const psetNameFacet = facet.psetName?.value || facet.psetName;
    const propNameFacet = facet.propName?.value || facet.propName;
    for (const [psetName, props] of psets) {
      if (psetNameFacet && !matchValue(facet.psetName, psetName)) continue;
      for (const [propName, propVal] of props) {
        if (propNameFacet && !matchValue(facet.propName, propName)) continue;
        const hasVal = propVal !== null && propVal !== undefined && String(propVal) !== "";
        if (absent) return !hasVal;
        if (!hasVal) return false;
        return !facet.value || matchValue(facet.value, String(propVal));
      }
    }
    return absent;
  }

  if (facet.type === "classification") {
    const absent = isAbsent(facet.cardinality, facet.minOccurs);
    const classifs = classifCache.get(eid) || [];
    if (!classifs.length) return absent;
    for (const cl of classifs) {
      const sysOk  = !facet.system || matchValue(facet.system, cl.systeme);
      const valOk  = !facet.value  || matchValue(facet.value,  cl.code);
      if (sysOk && valOk) return !absent;
    }
    return absent;
  }

  if (facet.type === "material") {
    const absent = isAbsent(facet.cardinality, facet.minOccurs);
    const mats = matCache.get(eid) || [];
    if (!mats.length) return absent;
    if (!facet.value) return !absent;
    for (const m of mats) {
      if (matchValue(facet.value, m)) return !absent;
    }
    return absent;
  }

  return true;
}

function isApplicable(spec, eid, api, modelId, propCache, classifCache, matCache) {
  for (const facet of spec.applicability.facets) {
    if (!checkFacet(facet, eid, api, modelId, propCache, classifCache, matCache)) return false;
  }
  return true;
}

function passesRequirements(spec, eid, api, modelId, propCache, classifCache, matCache) {
  for (const facet of spec.requirements.facets) {
    if (!checkFacet(facet, eid, api, modelId, propCache, classifCache, matCache)) return false;
  }
  return true;
}

/* ══════════════════════════════════════════════════════════════════════
   EXTRACTION DONNÉES ÉLÉMENT
══════════════════════════════════════════════════════════════════════ */

function extractElement(api, modelId, eid, storeyMap, classifCache, matCache, propCache) {
  let type = "", nom = "", guid = "";
  try {
    const line = api.GetLine(modelId, eid);
    type = line?.constructor?.name || "";
    nom  = getVal(line?.Name) || "";
    guid = getVal(line?.GlobalId) || "";
  } catch {}

  const etageNom = storeyMap.get(eid) || "";
  const classifications = classifCache.get(eid) || [];
  const materiaux = matCache.get(eid) || [];

  // Build psets object {psetName: {propName: value}}
  const psets = {};
  const pmap = propCache.get(eid);
  if (pmap) {
    for (const [psetName, props] of pmap) {
      psets[psetName] = {};
      for (const [k, v] of props) psets[psetName][k] = v;
    }
  }

  return {
    id:              eid,
    guid,
    type,
    nom,
    etage:           etageNom ? { nom: etageNom } : null,
    classifications,
    materiaux,
    psets,
    conforme:        null, // sera rempli par la validation
  };
}

/* ══════════════════════════════════════════════════════════════════════
   POINT D'ENTRÉE PRINCIPAL
══════════════════════════════════════════════════════════════════════ */

export async function runValidation(ifcBuffer, idsText, onProgress) {
  const progress = (pct, msg) => onProgress?.(pct, msg);

  // Init web-ifc
  progress(5, "Initialisation WASM…");
  const api = new WebIFC.IfcAPI();
  api.SetWasmPath("/ids-validator/");
  await api.Init();
  progress(15, "WASM prêt");

  // Load IFC
  progress(20, "Chargement IFC…");
  const modelId = api.OpenModel(new Uint8Array(ifcBuffer), {
    COORDINATE_TO_ORIGIN: false,
    USE_FAST_BOOLS: false,
  });
  progress(30, "Modèle ouvert");

  // Parse IDS
  progress(32, "Lecture IDS…");
  const parsedIDS = parseIDS(idsText);
  progress(35, "IDS parsé");

  // Build caches
  progress(38, "Extraction propriétés…");
  const storeyMap   = buildStoreyCache(api, modelId);
  progress(45, "Étages OK");
  const classifCache = buildClassificationCache(api, modelId);
  progress(52, "Classifications OK");
  const matCache    = buildMaterialCache(api, modelId);
  progress(58, "Matériaux OK");
  const propCache   = buildPropertyCache(api, modelId);
  progress(68, "PropertySets OK");

  // Collect all element IDs
  progress(70, "Inventaire IFC…");
  const allEids = new Set();
  const GEO_TYPES = [
    WebIFC.IFCWALL, WebIFC.IFCWALLSTANDARDCASE, WebIFC.IFCSLAB, WebIFC.IFCROOF,
    WebIFC.IFCCOLUMN, WebIFC.IFCBEAM, WebIFC.IFCDOOR, WebIFC.IFCWINDOW,
    WebIFC.IFCSTAIR, WebIFC.IFCSTAIRFLIGHT, WebIFC.IFCRAILING,
    WebIFC.IFCFURNISHINGELEMENT, WebIFC.IFCFURNITURE, WebIFC.IFCFOOTING,
    WebIFC.IFCCOVERING, WebIFC.IFCPLATE, WebIFC.IFCMEMBER, WebIFC.IFCSPACE,
    WebIFC.IFCBUILDINGSTOREY, WebIFC.IFCBUILDING, WebIFC.IFCSITE,
    WebIFC.IFCFLOWSEGMENT, WebIFC.IFCFLOWTERMINAL,
  ].filter(Boolean);

  for (const typeCode of GEO_TYPES) {
    try {
      const ids = api.GetLineIDsWithType(modelId, typeCode);
      for (let i = 0; i < ids.size(); i++) allEids.add(ids.get(i));
    } catch {}
  }
  progress(75, `${allEids.size} éléments trouvés`);

  // Validate each spec
  progress(78, "Validation IDS…");
  const eidsArr = [...allEids];
  const elConformite = new Map(); // eid → {pass: bool, specs: []}

  const specResults = parsedIDS.specifications.map(spec => {
    const passedEids = [], failedEids = [];
    for (const eid of eidsArr) {
      if (!isApplicable(spec, eid, api, modelId, propCache, classifCache, matCache)) continue;
      const pass = passesRequirements(spec, eid, api, modelId, propCache, classifCache, matCache);
      if (pass) passedEids.push(eid);
      else failedEids.push(eid);

      if (!elConformite.has(eid)) elConformite.set(eid, { pass: true, specs: [] });
      elConformite.get(eid).specs.push(spec.name);
      if (!pass) elConformite.get(eid).pass = false;
    }
    return { spec, passedEids, failedEids };
  });
  progress(88, "Validation terminée");

  // Build element data map
  progress(90, "Extraction données éléments…");
  const elementDataMap = new Map();
  const involvedEids = new Set();
  for (const { passedEids, failedEids } of specResults) {
    for (const eid of [...passedEids, ...failedEids]) involvedEids.add(eid);
  }
  for (const eid of involvedEids) {
    const el = extractElement(api, modelId, eid, storeyMap, classifCache, matCache, propCache);
    const conformite = elConformite.get(eid);
    el.conforme = conformite ? conformite.pass : null;
    elementDataMap.set(eid, el);
  }
  progress(95, "Données extraites");

  // Build final structure (same as Flask)
  const totalElements = allEids.size;
  const specifications = specResults.map(({ spec, passedEids, failedEids }) => {
    const applicable = passedEids.length + failedEids.length;
    const status     = failedEids.length === 0 ? "PASS" : "FAIL";
    return {
      name:             spec.name,
      description:      spec.description || "",
      status,
      applicable,
      passed:           passedEids.length,
      failed:           failedEids.length,
      passed_elements:  passedEids.map(eid => ({ ...elementDataMap.get(eid), conforme: true })),
      failed_elements:  failedEids.map(eid => ({ ...elementDataMap.get(eid), conforme: false })),
    };
  });

  const allPassed = new Set(specResults.flatMap(r => r.passedEids));
  const allFailed = new Set(specResults.flatMap(r => r.failedEids));

  // Comptage additif par spec (standard buildingSMART / ifctester)
  // Chaque spec contribue indépendamment au total : un élément testé dans 2 specs compte 2 fois
  let totalPassed = 0, totalFailed = 0;
  for (const { passedEids, failedEids } of specResults) {
    totalPassed += passedEids.length;
    totalFailed += failedEids.length;
  }

  // stats_par_type
  const statsParType = {};
  for (const { spec, passedEids, failedEids } of specResults) {
    for (const eid of passedEids) {
      const t = elementDataMap.get(eid)?.type || "Inconnu";
      if (!statsParType[t]) statsParType[t] = { passed: 0, failed: 0 };
      statsParType[t].passed++;
    }
    for (const eid of failedEids) {
      const t = elementDataMap.get(eid)?.type || "Inconnu";
      if (!statsParType[t]) statsParType[t] = { passed: 0, failed: 0 };
      statsParType[t].failed++;
    }
  }

  const tous_elements = [...elementDataMap.values()];

  api.CloseModel(modelId);
  progress(100, "Terminé");

  return {
    modele:         { elements: totalPassed + totalFailed },
    bilan:          { total_passed: totalPassed, total_failed: totalFailed },
    specifications,
    tous_elements,
    ids_3d:         { passed: [...allPassed], failed: [...allFailed] },
    stats_par_type: statsParType,
    ids_info:       parsedIDS.info,
  };
}

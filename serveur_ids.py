"""
serveur_ids.py — Serveur Flask IDS Validator
=============================================
- Télécharge web-ifc 0.0.57 au démarrage (une seule fois, depuis npm ou CDN)
- Sert les fichiers WASM/JS depuis localhost (contourne les blocages CDN)
- Garde le fichier IFC en mémoire après /valider
- Headers CORS + COEP/COOP pour SharedArrayBuffer (web-ifc multithreading)

Routes :
  GET  /ping               → test de connexion
  POST /valider            → validation IFC + IDS, retourne JSON
  GET  /ifc                → fichier IFC pour web-ifc
  GET  /web-ifc/<filename> → fichiers web-ifc (JS + WASM)

Lancement :
  python serveur_ids.py
"""

import os
import io
import sys
import urllib.request
import tempfile
from collections import Counter, defaultdict
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import ifcopenshell
import ifcopenshell.util.element
from ifctester import ids

app = Flask(__name__)
CORS(app)

# ─── Dossier cache web-ifc ────────────────────────────────
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
WEBIFC_DIR  = os.path.join(SCRIPT_DIR, "web-ifc-cache")
WEBIFC_VER  = "0.0.57"
WEBIFC_BASE = f"https://cdn.jsdelivr.net/npm/web-ifc@{WEBIFC_VER}/"

WEBIFC_FILES = [
    "web-ifc-api-iife.js",
    "web-ifc.wasm",
    "web-ifc-mt.wasm",
    "web-ifc-mt.worker.js",
]

# ─── Session IFC ──────────────────────────────────────────
_ifc_bytes    = None
_ifc_filename = None


# ═══════════════════════════════════════════════════════════
#  Téléchargement web-ifc au démarrage
# ═══════════════════════════════════════════════════════════

WEBIFC_CDNS = [
    f"https://cdn.jsdelivr.net/npm/web-ifc@{WEBIFC_VER}/",
    f"https://unpkg.com/web-ifc@{WEBIFC_VER}/",
]


def download_webifc():
    os.makedirs(WEBIFC_DIR, exist_ok=True)
    all_present = all(
        os.path.exists(os.path.join(WEBIFC_DIR, f)) for f in WEBIFC_FILES
    )
    if all_present:
        print(f"  ✓ web-ifc {WEBIFC_VER} déjà en cache ({WEBIFC_DIR})")
        return

    print(f"  ⬇ Téléchargement de web-ifc {WEBIFC_VER}…")
    print(f"    (Conseil : lancez setup_webifc.py pour une installation plus robuste)")
    for fname in WEBIFC_FILES:
        dest = os.path.join(WEBIFC_DIR, fname)
        if os.path.exists(dest):
            print(f"    · {fname} — déjà présent")
            continue
        downloaded = False
        for base in WEBIFC_CDNS:
            url = base + fname
            print(f"    · {fname} ({base.split('/')[2]})…", end=" ", flush=True)
            try:
                urllib.request.urlretrieve(url, dest)
                size = os.path.getsize(dest)
                print(f"OK ({size//1024} ko)")
                downloaded = True
                break
            except Exception as e:
                print(f"ERREUR : {e}")
        if not downloaded:
            print(f"      → Téléchargez manuellement {fname}")
            print(f"        et placez-le dans {WEBIFC_DIR}/")
    print("  ✓ web-ifc prêt")


# ═══════════════════════════════════════════════════════════
#  Headers CORS + COEP/COOP (requis pour WASM SharedArrayBuffer)
# ═══════════════════════════════════════════════════════════

@app.after_request
def add_headers(response):
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "*"
    # Ces headers permettent SharedArrayBuffer (web-ifc MT)
    response.headers["Cross-Origin-Opener-Policy"]   = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
    return response


# ═══════════════════════════════════════════════════════════
#  GET /web-ifc/<filename>  — sert les fichiers web-ifc localement
# ═══════════════════════════════════════════════════════════

@app.route("/web-ifc/<path:filename>", methods=["GET"])
def serve_webifc(filename):
    """
    Sert les fichiers web-ifc depuis le cache local.
    Le HTML pointera vers http://localhost:5000/web-ifc/
    """
    filepath = os.path.join(WEBIFC_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({"erreur": f"Fichier non trouvé : {filename}"}), 404

    if filename.endswith(".js"):
        mime = "application/javascript"
    elif filename.endswith(".wasm"):
        mime = "application/wasm"
    else:
        mime = "application/octet-stream"

    return send_file(filepath, mimetype=mime)


# ═══════════════════════════════════════════════════════════
#  Extraction élément IFC
# ═══════════════════════════════════════════════════════════

def extraire_element(element, ifc_model):
    express_id  = element.id()
    guid        = getattr(element, "GlobalId",   None)
    nom         = getattr(element, "Name",        None) or "Sans nom"
    description = getattr(element, "Description", None) or ""
    type_ifc    = element.is_a()

    type_obj = None
    try:
        t = ifcopenshell.util.element.get_type(element)
        if t:
            type_obj = {
                "id":   t.id(),
                "guid": getattr(t, "GlobalId", None),
                "nom":  getattr(t, "Name", None) or "",
                "type": t.is_a()
            }
    except Exception:
        pass

    psets = {}
    try:
        for pset_name, props in ifcopenshell.util.element.get_psets(element).items():
            psets[pset_name] = {}
            for k, v in props.items():
                if v is None:
                    psets[pset_name][k] = None
                elif isinstance(v, bool):
                    psets[pset_name][k] = v
                elif isinstance(v, (int, float)):
                    psets[pset_name][k] = round(v, 6)
                else:
                    psets[pset_name][k] = str(v)
    except Exception:
        pass

    classifications = []
    try:
        for rel in ifc_model.by_type("IfcRelAssociatesClassification"):
            if element in rel.RelatedObjects:
                ref = rel.RelatingClassification
                systeme, code, desc = "", "", ""
                if ref.is_a("IfcClassificationReference"):
                    code = (getattr(ref, "Identification", None)
                            or getattr(ref, "ItemReference", None) or "")
                    desc = getattr(ref, "Name", "") or ""
                    src  = ref.ReferencedSource
                    if src:
                        if src.is_a("IfcClassification"):
                            systeme = getattr(src, "Name", "") or ""
                        elif src.is_a("IfcClassificationReference") and src.ReferencedSource:
                            systeme = getattr(src.ReferencedSource, "Name", "") or ""
                elif ref.is_a("IfcClassification"):
                    systeme = getattr(ref, "Name", "") or ""
                    desc    = getattr(ref, "Description", "") or ""
                classifications.append({"systeme": systeme, "code": code, "description": desc})
    except Exception:
        pass

    materiaux = []
    try:
        for m in ifcopenshell.util.element.get_materials(element):
            materiaux.append(getattr(m, "Name", "") or "")
    except Exception:
        pass

    etage = None
    try:
        c = ifcopenshell.util.element.get_container(element)
        if c:
            etage = {"type": c.is_a(), "nom": getattr(c, "Name", "") or ""}
    except Exception:
        pass

    return {
        "id":              express_id,
        "guid":            guid,
        "nom":             nom,
        "description":     description,
        "type":            type_ifc,
        "type_objet":      type_obj,
        "psets":           psets,
        "classifications": classifications,
        "materiaux":       materiaux,
        "etage":           etage
    }


# ═══════════════════════════════════════════════════════════
#  POST /valider
# ═══════════════════════════════════════════════════════════

@app.route("/valider", methods=["POST"])
def valider():
    global _ifc_bytes, _ifc_filename

    if "ifc" not in request.files or "ids" not in request.files:
        return jsonify({"erreur": "Fichiers 'ifc' et 'ids' requis"}), 400

    fichier_ifc = request.files["ifc"]
    fichier_ids = request.files["ids"]

    _ifc_bytes    = fichier_ifc.read()
    _ifc_filename = fichier_ifc.filename

    with tempfile.TemporaryDirectory() as tmp:
        chemin_ifc = os.path.join(tmp, "modele.ifc")
        chemin_ids = os.path.join(tmp, "exigences.ids")
        with open(chemin_ifc, "wb") as f:
            f.write(_ifc_bytes)
        fichier_ids.save(chemin_ids)

        try:
            ifc_model = ifcopenshell.open(chemin_ifc)
        except Exception as e:
            return jsonify({"erreur": f"Lecture IFC impossible : {e}"}), 400

        try:
            ids_model = ids.open(chemin_ids)
        except Exception as e:
            return jsonify({"erreur": f"Lecture IDS impossible : {e}"}), 400

        try:
            ids_model.validate(ifc_model)
        except Exception as e:
            return jsonify({"erreur": f"Erreur validation : {e}"}), 500

        cache = {}
        def get_data(el):
            eid = el.id()
            if eid not in cache:
                cache[eid] = extraire_element(el, ifc_model)
            return cache[eid]

        specs_out = []
        for spec in ids_model.specifications:
            passed = [get_data(el) for el in (spec.passed_entities or [])]
            failed = [get_data(el) for el in (spec.failed_entities or [])]
            specs_out.append({
                "name":            spec.name,
                "identifier":      getattr(spec, "identifier", ""),
                "description":     getattr(spec, "description", "") or "",
                "status":          "PASS" if spec.status else "FAIL",
                "applicable":      len(passed) + len(failed),
                "passed":          len(passed),
                "failed":          len(failed),
                "passed_ids":      [e["id"] for e in passed],
                "failed_ids":      [e["id"] for e in failed],
                "passed_elements": passed,
                "failed_elements": failed,
            })

        elements   = ifc_model.by_type("IfcElement")
        inventaire = dict(sorted(Counter(e.is_a() for e in elements).items()))

        vus, tous, conf_par_id = set(), [], {}
        for spec in specs_out:
            for el in spec["passed_elements"]:
                conf_par_id[el["id"]] = True
                if el["id"] not in vus: vus.add(el["id"]); tous.append(el)
            for el in spec["failed_elements"]:
                if el["id"] not in conf_par_id: conf_par_id[el["id"]] = False
                if el["id"] not in vus: vus.add(el["id"]); tous.append(el)
        for el in tous:
            el["conforme"] = conf_par_id.get(el["id"])

        stats_par_type = defaultdict(lambda: {"passed": 0, "failed": 0})
        for spec in specs_out:
            for el in spec["passed_elements"]: stats_par_type[el["type"]]["passed"] += 1
            for el in spec["failed_elements"]: stats_par_type[el["type"]]["failed"] += 1

        all_passed = set()
        all_failed = set()
        for spec in specs_out:
            all_passed.update(spec["passed_ids"])
            all_failed.update(spec["failed_ids"])
        all_failed -= all_passed

        return jsonify({
            "modele": {
                "nom":        _ifc_filename,
                "schema":     ifc_model.schema,
                "produits":   len(ifc_model.by_type("IfcProduct")),
                "elements":   len(elements),
                "inventaire": inventaire
            },
            "specifications": specs_out,
            "bilan": {
                "total_specs":  len(specs_out),
                "specs_ok":     sum(1 for s in specs_out if s["status"] == "PASS"),
                "specs_fail":   sum(1 for s in specs_out if s["status"] == "FAIL"),
                "total_passed": sum(s["passed"] for s in specs_out),
                "total_failed": sum(s["failed"] for s in specs_out),
            },
            "stats_par_type": dict(stats_par_type),
            "tous_elements":  tous,
            "ids_3d": {
                "passed": list(all_passed),
                "failed": list(all_failed)
            }
        })


# ═══════════════════════════════════════════════════════════
#  GET /ifc
# ═══════════════════════════════════════════════════════════

@app.route("/ifc", methods=["GET"])
def get_ifc():
    global _ifc_bytes, _ifc_filename
    if _ifc_bytes is None:
        return jsonify({"erreur": "Aucun fichier IFC en mémoire"}), 404
    return send_file(
        io.BytesIO(_ifc_bytes),
        mimetype="application/octet-stream",
        as_attachment=False,
        download_name=_ifc_filename or "modele.ifc"
    )


# ═══════════════════════════════════════════════════════════
#  GET /ping
# ═══════════════════════════════════════════════════════════

@app.route("/ping", methods=["GET"])
def ping():
    webifc_ok = all(
        os.path.exists(os.path.join(WEBIFC_DIR, f)) for f in WEBIFC_FILES
    )
    return jsonify({
        "status":    "ok",
        "ifc_pret":  _ifc_bytes is not None,
        "ifc_nom":   _ifc_filename,
        "webifc_ok": webifc_ok,
        "webifc_url": f"http://localhost:5000/web-ifc/"
    })


# ═══════════════════════════════════════════════════════════
#  Lancement
# ═══════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=" * 60)
    print(f"  Serveur IDS v4 — http://localhost:5000")
    print("=" * 60)
    download_webifc()
    print()
    print("  Routes :")
    print("  POST /valider            → validation IFC + IDS")
    print("  GET  /ifc                → fichier IFC pour web-ifc")
    print("  GET  /web-ifc/<fichier>  → fichiers WASM servis localement")
    print("  GET  /ping               → test de connexion")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5000, debug=False)

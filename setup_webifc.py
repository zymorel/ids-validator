"""
setup_webifc.py
===============
Installe la bonne version de web-ifc selon le schéma IFC détecté.
Vérifie la VERSION réelle en cache (pas juste la présence des fichiers).

Schémas supportés :
  IFC2X3, IFC4, IFC4X3_ADD2… → web-ifc 0.0.57

Lancement :
    python setup_webifc.py
"""

import os, sys, json, shutil, subprocess, urllib.request, urllib.error, re

SCRIPT_DIR     = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR      = os.path.join(SCRIPT_DIR, "web-ifc-cache")
VER_FILE       = os.path.join(CACHE_DIR, ".version")
TARGET_VERSION = "0.0.57"

# Tailles minimales attendues pour la v0.0.57
# Tailles réelles mesurées :
#   v0.0.44 : wasm = 906/923 ko   (pas de support IFC4X3)
#   v0.0.57 : wasm = 1136/1156 ko (support IFC4X3 inclus)
MIN_SIZES = {
    "web-ifc-api-iife.js":  200_000,   # > 200 ko
    "web-ifc.wasm":       1_000_000,   # > 1000 ko  (0.0.44=906ko, 0.0.57=1136ko)
    "web-ifc-mt.wasm":    1_000_000,   # > 1000 ko
    "web-ifc-mt.worker.js":   1_000,
}

FILES = [
    ("web-ifc-api.js",       "web-ifc-api-iife.js"),
    ("web-ifc.wasm",         "web-ifc.wasm"),
    ("web-ifc-mt.wasm",      "web-ifc-mt.wasm"),
    ("web-ifc-mt.worker.js", "web-ifc-mt.worker.js"),
]

CDNS = [
    f"https://unpkg.com/web-ifc@{TARGET_VERSION}/",
    f"https://cdn.jsdelivr.net/npm/web-ifc@{TARGET_VERSION}/",
]


def detect_schemas(folder):
    schemas = set()
    for fname in os.listdir(folder):
        if not fname.lower().endswith(".ifc"):
            continue
        path = os.path.join(folder, fname)
        try:
            with open(path, "rb") as f:
                head = f.read(4096).decode("ascii", errors="ignore")
            for m in re.findall(r"FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'", head, re.IGNORECASE):
                s = m.upper().replace("-", "_")
                schemas.add(s)
                print(f"    {fname} -> {s}")
        except Exception as e:
            print(f"    {fname} -> erreur : {e}")
    return schemas


def check_cache():
    """Vérifie version ET taille de chaque fichier."""
    if os.path.exists(VER_FILE):
        with open(VER_FILE) as f:
            cached_ver = f.read().strip()
        if cached_ver != TARGET_VERSION:
            print(f"  Version en cache : {cached_ver} != cible {TARGET_VERSION} -> mise a jour")
            return False
    else:
        print(f"  Pas de fichier .version -> re-telechargement")
        return False

    all_ok = True
    for _, dst_name in FILES:
        path = os.path.join(CACHE_DIR, dst_name)
        if not os.path.exists(path):
            print(f"  X {dst_name} manquant")
            all_ok = False
            continue
        size = os.path.getsize(path)
        min_s = MIN_SIZES.get(dst_name, 100)
        if size < min_s:
            print(f"  X {dst_name} trop petit ({size//1024} ko < {min_s//1024} ko min) -> version 0.0.44 detectee !")
            all_ok = False
        else:
            print(f"  OK {dst_name} ({size//1024} ko)")
    return all_ok


def save_version():
    with open(VER_FILE, "w") as f:
        f.write(TARGET_VERSION)


def install_via_npm():
    tmp = os.path.join(SCRIPT_DIR, "_tmp_webifc")
    try:
        r = subprocess.run("npm --version", shell=True, capture_output=True, text=True)
        if r.returncode != 0:
            raise Exception()
        print(f"  npm v{r.stdout.strip()} OK")
    except Exception:
        print("  npm non disponible")
        return False

    os.makedirs(tmp, exist_ok=True)
    with open(os.path.join(tmp, "package.json"), "w") as f:
        json.dump({"name": "tmp", "version": "1.0.0", "private": True}, f)

    print(f"  npm install web-ifc@{TARGET_VERSION}...")
    r = subprocess.run(
        f"npm install web-ifc@{TARGET_VERSION} --no-save",
        shell=True, capture_output=True, text=True, cwd=tmp
    )
    if r.returncode != 0:
        print(f"  npm install echoue : {r.stderr[:300]}")
        shutil.rmtree(tmp, ignore_errors=True)
        return False

    pkg_dir = os.path.join(tmp, "node_modules", "web-ifc")
    if not os.path.exists(pkg_dir):
        print(f"  node_modules/web-ifc introuvable")
        shutil.rmtree(tmp, ignore_errors=True)
        return False

    available = sorted(os.listdir(pkg_dir))
    print(f"  Fichiers disponibles : {', '.join(available)}")

    os.makedirs(CACHE_DIR, exist_ok=True)
    ok = True

    for src_name, dst_name in FILES:
        src = os.path.join(pkg_dir, src_name)
        if not os.path.exists(src):
            alts = ["web-ifc-api-iife.js", "index.js"] if src_name == "web-ifc-api.js" else []
            for alt in alts:
                alt_path = os.path.join(pkg_dir, alt)
                if os.path.exists(alt_path):
                    src = alt_path
                    print(f"    -> {src_name} trouve sous '{alt}'")
                    break
            else:
                for root, _, fnames in os.walk(pkg_dir):
                    if src_name in fnames:
                        src = os.path.join(root, src_name)
                        break

        dst = os.path.join(CACHE_DIR, dst_name)
        if os.path.exists(src):
            shutil.copy2(src, dst)
            size = os.path.getsize(dst)
            min_s = MIN_SIZES.get(dst_name, 0)
            status = "OK" if size >= min_s else "SUSPECT (trop petit)"
            print(f"  {status} {dst_name} ({size//1024} ko)")
            if size < min_s:
                ok = False
        else:
            print(f"  X {src_name} non trouve dans le paquet")
            ok = False

    shutil.rmtree(tmp, ignore_errors=True)
    return ok


def install_via_cdn():
    os.makedirs(CACHE_DIR, exist_ok=True)
    all_ok = True

    for src_name, dst_name in FILES:
        dst = os.path.join(CACHE_DIR, dst_name)
        downloaded = False
        candidates = [src_name] + (["web-ifc-api-iife.js"] if src_name == "web-ifc-api.js" else [])

        for src_try in candidates:
            if downloaded:
                break
            for cdn in CDNS:
                url = cdn + src_try
                print(f"  -> {url}...", end=" ", flush=True)
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(req, timeout=90) as r:
                        data = r.read()
                    min_s = MIN_SIZES.get(dst_name, 100)
                    if len(data) < min_s:
                        print(f"trop petit ({len(data)//1024} ko, attendu >{min_s//1024} ko)")
                        continue
                    with open(dst, "wb") as f:
                        f.write(data)
                    print(f"OK ({len(data)//1024} ko)")
                    downloaded = True
                    break
                except urllib.error.HTTPError as e:
                    print(f"HTTP {e.code}")
                except Exception as e:
                    print(f"ERR: {e}")

        if not downloaded:
            print(f"  X {src_name} non telecharge")
            all_ok = False

    return all_ok


def main():
    print("=" * 62)
    print(f"  web-ifc setup  -  cible : v{TARGET_VERSION}")
    print(f"  Support : IFC2X3 / IFC4 / IFC4X3_ADD2")
    print("=" * 62)

    print(f"\n[1] Fichiers IFC detectes dans le dossier...")
    schemas = detect_schemas(SCRIPT_DIR)
    if not schemas:
        print("  (aucun .ifc trouve)")

    print(f"\n[2] Verification du cache (version + tailles)...")
    if check_cache():
        print(f"\n  web-ifc {TARGET_VERSION} est deja installe et valide !")
        print("  -> Lancez : python serveur_ids.py")
        input("\nEntree pour fermer...")
        return

    print(f"\n[3] Installation de web-ifc {TARGET_VERSION}...")

    # Supprimer uniquement les fichiers web-ifc (pas le dossier)
    # On ecrase sur place pour eviter les problemes de permission OneDrive
    if os.path.exists(CACHE_DIR):
        for _, dst_name in FILES:
            old_file = os.path.join(CACHE_DIR, dst_name)
            if os.path.exists(old_file):
                try:
                    os.remove(old_file)
                    print(f"  Supprime : {dst_name}")
                except Exception as e:
                    print(f"  Impossible de supprimer {dst_name} : {e}")
                    print(f"  -> Le fichier sera ecrase directement")
        # Supprimer aussi l'ancien .version
        if os.path.exists(VER_FILE):
            try: os.remove(VER_FILE)
            except: pass

    os.makedirs(CACHE_DIR, exist_ok=True)

    print("\n  [ Methode 1 : npm ]")
    success = install_via_npm()

    if not success:
        print("\n  [ Methode 2 : CDN ]")
        success = install_via_cdn()

    print(f"\n[4] Verification finale...")
    sizes_ok = all(
        os.path.exists(os.path.join(CACHE_DIR, dst)) and
        os.path.getsize(os.path.join(CACHE_DIR, dst)) >= MIN_SIZES.get(dst, 0)
        for _, dst in FILES
    )

    print("\n" + "=" * 62)
    if sizes_ok:
        save_version()
        print(f"  web-ifc {TARGET_VERSION} installe avec succes !")
        print(f"  Tailles validees (IFC4X3 inclus dans le WASM)")
        print(f"  -> Relancez : python serveur_ids.py")
    else:
        print(f"  X Installation incomplete")
        print(f"""
  TELECHARGEMENT MANUEL :
  Ouvrir dans Chrome : https://unpkg.com/browse/web-ifc@{TARGET_VERSION}/

  Telecharger ces 4 fichiers et les placer dans :
  {CACHE_DIR}\\

     web-ifc-api.js      ->  renommer en  web-ifc-api-iife.js  (attendu > 200 ko)
     web-ifc.wasm                                               (attendu > 1000 ko)
     web-ifc-mt.wasm                                            (attendu > 1000 ko)
     web-ifc-mt.worker.js                                       (attendu > 1 ko)

  Les fichiers de 906/923 ko sont la version 0.0.44 — trop ancienne !
  La version 0.0.57 produit des wasm de 1136/1156 ko.
  Supprimer ces anciens fichiers avant de copier les nouveaux.

  Ensuite relancer : python serveur_ids.py
""")
    print("=" * 62)
    input("\nEntree pour fermer...")


if __name__ == "__main__":
    main()

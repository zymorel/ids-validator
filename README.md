# IDS Validator

Outil de contrôle qualité BIM : valide des modèles IFC contre des spécifications IDS (Information Delivery Specification), avec visualisation 3D et tableau de bord.

**100 % hors-ligne — aucun serveur requis.**

![Interface](https://img.shields.io/badge/interface-web%20%2B%20desktop-blue)
![Stack](https://img.shields.io/badge/stack-Vite%20%2B%20web--ifc%20%2B%20Three.js-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Fonctionnalités

- **Validation IFC/IDS complète** — entité, attribut, propriété, classification, matériau
- **Visualisation 3D** — conformes en vert, non conformes en rouge, fond clair ou sombre
- **Tableau de bord** — jauge de conformité, graphiques par type IFC
- **Tableau récapitulatif** — filtres, recherche, tri, export CSV
- **Export JSON / CSV** des résultats
- **Application desktop** — packaging Electron (portable `.exe`, aucune installation)

---

## Stack technique

| Outil | Rôle |
|---|---|
| [Vite](https://vitejs.dev/) | Bundler / serveur de développement |
| [web-ifc 0.0.74](https://github.com/ThatOpen/engine_web-ifc) | Parsing IFC via WASM |
| [Three.js](https://threejs.org/) | Rendu 3D |
| [Chart.js](https://www.chartjs.org/) | Graphiques dashboard |
| [Electron](https://www.electronjs.org/) | Application desktop |

---

## Démarrage rapide

### Prérequis

- [Node.js](https://nodejs.org/) 18+

### Installation

```bash
git clone https://github.com/zymorel/ids-validator.git
cd ids-validator
npm install
```

> `npm install` copie automatiquement les fichiers WASM de web-ifc dans `public/`.

### Lancer en développement

```bash
npm run dev
```

Ouvrir [http://localhost:5173/ids-validator/](http://localhost:5173/ids-validator/)

### Build de production

```bash
npm run build
```

---

## Application desktop (Electron)

### Lancer en mode Electron (dev)

```bash
npm run electron:dev
```

### Créer le `.exe` portable

```bash
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder
```

Le fichier `IDSValidator-portable.exe` est généré dans `dist-electron/`.
Il est autonome — aucune installation requise, fonctionne sans connexion internet.

---

## Utilisation

1. **Onglet Upload & Validation** — glisser-déposer un fichier `.ifc` et un fichier `.ids` / `.xml`
2. Cliquer **▶ Lancer la validation**
3. Consulter les résultats par exigence IDS
4. **Onglet 3D Viewer** — visualiser le modèle colorié (vert = conforme, rouge = non conforme)
5. **Onglet Dashboard** — graphiques et tableau de bord global

---

## Exemples

Le dossier `examples/` contient des fichiers IDS de démonstration.

---

## Structure du projet

```
ids-validator/
├── index.html              # Point d'entrée HTML
├── vite.config.js          # Configuration Vite
├── electron-builder.json   # Configuration packaging .exe
├── package.json
├── electron/
│   └── main.cjs            # Process principal Electron
├── scripts/
│   └── copy-wasm.js        # Copie WASM au postinstall
├── public/                 # Fichiers WASM (auto-générés)
├── src/
│   ├── main.js             # Logique UI + viewer 3D
│   ├── validator.js        # Moteur de validation IDS (pur JS)
│   └── style.css           # Styles
└── examples/               # Fichiers IDS d'exemple
```

---

## Licence

MIT

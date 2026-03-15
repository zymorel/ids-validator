# IDS Validator

Outil de contrôle qualité BIM permettant de valider des modèles IFC contre des spécifications IDS (Information Delivery Specification).

![Interface](https://img.shields.io/badge/interface-web-blue) ![Python](https://img.shields.io/badge/python-3.8+-green) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

## Fonctionnalités

- **Validation IFC/IDS** : Vérifie la conformité des éléments d'un modèle IFC par rapport aux exigences définies dans un fichier IDS
- **Visualisation 3D** : Affiche le modèle en 3D avec les éléments conformes (vert) et non conformes (rouge) via [web-ifc](https://github.com/ThatOpen/engine_web-ifc)
- **Tableau de bord** : Statistiques globales, graphiques de conformité par type d'élément
- **Inspection d'éléments** : Panneau latéral affichant les propriétés, classifications et matériaux de chaque élément
- **Export de résultats** : Vue tabulaire complète de tous les éléments avec leur statut

## Prérequis

- Python 3.8+
- Un navigateur moderne avec support WebGL (Chrome, Firefox, Edge)

## Installation

### 1. Cloner le dépôt

```bash
git clone https://github.com/<votre-utilisateur>/ids-validator.git
cd ids-validator
```

### 2. Créer un environnement virtuel et installer les dépendances

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
source .venv/bin/activate

pip install -r requirements.txt
```

### 3. Télécharger les fichiers web-ifc

```bash
python setup_webifc.py
```

Ce script télécharge automatiquement les fichiers nécessaires (JS + WASM) via npm ou CDN. Une connexion internet est requise lors du premier lancement.

## Utilisation

### Lancer le serveur

```bash
python serveur_ids.py
```

Le serveur démarre sur `http://localhost:5000`.

### Ouvrir l'interface

Ouvrir le fichier `ids_validator.html` dans un navigateur.

> **Note** : Le serveur doit être actif pour que l'interface fonctionne. Un indicateur de connexion est affiché dans l'interface.

### Valider un modèle

1. Glisser-déposer un fichier `.ifc` dans la zone de dépôt IFC
2. Glisser-déposer un fichier `.ids` dans la zone de dépôt IDS
3. Cliquer sur **VALIDER**
4. Explorer les résultats dans les onglets : Spécifications, Visionneuse 3D, Éléments

## Fichiers exemples

Le dépôt inclut des fichiers IDS d'exemple :

| Fichier | Description |
|--------|-------------|
| `examples/uniformat_classification.ids` | 22 spécifications de classification Uniformat pour les principaux types d'éléments (murs, dalles, portes, fenêtres…) |
| `examples/uniformat_murs.ids` | Spécification simplifiée pour les murs uniquement |

## Architecture

```
ids-validator/
├── examples/
│   ├── uniformat_classification.ids  # Exemple IDS complet (22 spécifications)
│   └── uniformat_murs.ids            # Exemple IDS simplifié (murs uniquement)
├── .gitignore
├── LICENSE
├── README.md
├── ids_validator.html      # Interface utilisateur (SPA)
├── requirements.txt
├── serveur_ids.py          # Serveur Flask (API REST)
├── setup_webifc.py         # Script de configuration web-ifc
└── web-ifc-cache/          # Cache local des fichiers web-ifc (généré par setup_webifc.py)
```

### API REST

| Méthode | Route | Description |
|--------|-------|-------------|
| `GET` | `/ping` | Vérification de l'état du serveur |
| `POST` | `/valider` | Validation IFC + IDS (retourne JSON) |
| `GET` | `/ifc` | Récupère le fichier IFC en mémoire |
| `GET` | `/web-ifc/<fichier>` | Fichiers web-ifc servis localement |

### Corps de la requête `/valider`

`multipart/form-data` avec :
- `ifc` : fichier `.ifc`
- `ids` : fichier `.ids`

### Format de réponse `/valider`

```json
{
  "modele": { "nom": "...", "schema": "IFC4X3_ADD2", "elements": 123 },
  "specifications": [
    {
      "name": "Murs - Classification Uniformat",
      "status": "PASS",
      "passed": 10,
      "failed": 2,
      "passed_elements": [...],
      "failed_elements": [...]
    }
  ],
  "bilan": { "total_specs": 5, "specs_ok": 3, "specs_fail": 2 },
  "ids_3d": { "passed": [101, 102], "failed": [103] }
}
```

## Technologies utilisées

- **Backend** : Python, Flask, ifcopenshell, ifctester
- **Frontend** : HTML/CSS/JavaScript vanilla, Chart.js, Three.js, web-ifc

## Contribuer

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une _issue_ pour signaler un bug ou proposer une amélioration, ou à soumettre une _pull request_.

## Licence

Ce projet est distribué sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

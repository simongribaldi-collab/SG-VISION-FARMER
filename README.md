# SG Vision Farmer — Jumeau Numérique 3D, Prévision & Pilotage Agricole Connecté

**SG Vision Farmer** est une application web/logicielle ludique et complète de gestion d'exploitation agricole, adaptable de la **micro-ferme bio-intensive** jusqu'à la **grande exploitation connectée**, couvrant le **maraîchage plein champ**, les **serres automatisées**, l'**élevage** et l'**élevage de ponte**.

## Fonctionnalités clés

- **Jumeau Numérique 3D Temps Réel (WebGL natif, zéro dépendance)** :
  - Construisez, déplacez, pivotez et personnalisez votre ferme en 3D (planches de culture, serres avec ouvrants animés, poulaillers fixes/mobiles, bâtiments d'élevage, paddocks, hangars, cuves/bassins, panneaux solaires, éoliennes, station météo, haies agroforestières, ruchers, compost).
  - Visualisez les **robots autonomes en mouvement** (rover désherbeur, drone NDVI, tracteur RTK, distributeur) et **6 calques d'analyse** (Normal, Humidité sol, Santé NDVI, Risque Maladies, Flux Énergie/Eau, Overlay AR).
  - **Soleil & Saisons dynamiques** : observez les ombres portées heure par heure.
- **Time-Machine & Simulateur « Prévoir l'avenir »** :
  - Cursez de **Aujourd'hui jusqu'à +365 jours** (avec mode **Time-Lapse 3D**) et testez des scénarios *What-If* (canicule, sécheresse, gel tardif, flambée énergie, extension serre).
  - Calculs prédictifs : degrés-jours (GDD), bilan hydrique & ETP, indices maladies (mildiou, oïdium, pou rouge), courbes de récolte & ponte, charge humaine vs robotique, dates de rupture de stock et trésorerie 12 mois.
- **Agronomie, Élevage & Ponte** :
  - Planches de culture, matrice de **rotations intelligentes** par familles botaniques, planning de semis/plantation (Gantt), besoins en semences/terreau, diagnostic & biocontrôle maladies, saisie de production.
  - Lots de poules pondeuses (courbe de ponte, calibres S/M/L/XL, trappes & lumière auto), troupeaux (pâturage tournant dynamique, rations, prophylaxie).
- **Robotique à distance, Outils & Automatisations** :
  - Suivi unifié des outils **autonomes et non-autonomes** (heures, batterie, entretien, coût horaire).
  - Téléopération des robots, règles **Si → Alors** exécutables en direct, station météo connectée (**Open-Meteo** en ligne + simulateur local + webhook `/api/telemetry`).
- **Ressources, Personnel & Finances** :
  - Eau, Électricité (solaire/éolien vs conso), Semences, Alimentation animale, Cheptel, Agrofournitures, bons de commande auto, besoins en personnel saisonnier/permanent, trésorerie & marges par atelier/planche.
- **Lunettes Connectées AR (`/glasses.html`) & Connecteur IA (`/mcp`)** :
  - Interface tête haute haute-contraste avec étiquettes spatiales, commandes vocales (Web Speech API) et synchronisation temps réel avec le cockpit 3D.
  - Assistant IA intégré (hors-ligne + support **Ollama local** / API compatible OpenAI) et serveur **MCP (`/mcp`)** pour piloter la ferme depuis Antigravity, Claude Desktop, Cursor ou Home Assistant.
- **Dimension Ludique** :
  - Score global d'Autonomie & Santé (radar 6 axes), défis quotidiens, trophées agronomiques et mode Bac à Sable 3D.

## Démarrage rapide (Windows)

1. Double-cliquez sur **`DEMARRER-FARMER.bat`** (démarre le serveur local PowerShell sans aucune installation Node/Python et ouvre `http://localhost:8765`).
2. Pour ouvrir l'affichage tête haute **Lunettes Connectées AR** : **`OUVRIR-LUNETTES-AR.bat`** ou `http://localhost:8765/glasses.html`.
3. Pour arrêter proprement : **`ARRETER-FARMER.bat`**.

## Déploiement Cloud statique (Netlify / Vercel)

Le dossier `public/` est 100 % autonome (fonctionne hors-ligne via `localStorage` et `BroadcastChannel` lorsque le serveur local PowerShell n'est pas utilisé). `netlify.toml` et `vercel.json` sont prêts à l'emploi.

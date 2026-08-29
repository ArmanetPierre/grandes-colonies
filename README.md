# Grand Colonies

Version numérique d'une variante de Catan pour **8 à 12 joueurs**, jouable en
réseau local : le serveur tourne sur un PC, chacun rejoint depuis son
navigateur.

---

## Lancer une soirée

```bash
npm install
npm run play
```

Le terminal affiche alors :

```
  Écran hôte   http://192.168.1.34:2567
  Joueurs      http://192.168.1.34:5173
  Code         AMPHORE-46
  Plateau      archipel, 44 terres
  Sièges       8
  Journal      /chemin/vers/grand-colonies/parties
```

**Ouvre l'écran hôte sur le PC** (la première adresse). Il affiche un QR code
et l'adresse à donner aux invités, et se remplit à mesure qu'ils arrivent.

**Les invités scannent le QR code**, tapent leur prénom, et attendent. Ils
peuvent arriver dans n'importe quel ordre.

**Quand tout le monde est là, clique « Démarrer la partie »** sur l'écran
hôte. Tu peux lancer sans attendre les retardataires : leurs sièges seront
joués au minimum, et ils reprendront leur place en arrivant.

`Ctrl+C` arrête tout.

### Pendant la soirée, sur l'écran hôte

**Pause** suspend tout : le chronomètre, les tours joués d'office, et les
commandes des joueurs. Un voile s'affiche sur l'écran de table pour que la
pièce entière comprenne d'un regard pourquoi plus rien ne bouge. Le temps
restant est rendu intact à la reprise — la pause ne vole ni n'offre de temps.

**+30 s** rallonge la phase en cours, quand la table négocie encore.

**Confier à un bot** apparaît sur la fiche d'un joueur parti depuis deux
tours de table. Sans ce geste, la partie l'attend indéfiniment : son tour est
joué au minimum, cycle après cycle, et sa position ne bouge plus. Le jeton de
reconnexion du partant est invalidé — céder sa place, c'est la céder.

### Si le serveur tombe

Chaque partie écrit son journal dans `parties/` : la graine, la
configuration, et la suite ordonnée des commandes, horodatées. Le moteur
étant déterministe, cela suffit à rejouer la partie à l'identique.

```bash
REPRENDRE=parties/partie-1787966450972-0.jsonl npm run play
```

La partie revient **en pause**, exactement où elle s'était arrêtée, noms des
joueurs compris. Chacun rouvre le lien et reprend un siège — les jetons de
reconnexion sont morts avec le processus précédent — puis l'hôte reprend.

Le fichier est du JSON par lignes, ajouté au fil de l'eau : une coupure de
courant n'en abîme que la dernière ligne, et la relecture l'ignore.

### Options

| Commande | Effet |
|---|---|
| `PLAYERS=8 npm run play` | Huit joueurs au lieu de douze |
| `BOARD=disque npm run play` | Plateau en disque : soirée plus courte (≈ 2 h 20 au lieu de 3 h 30 à douze) |
| `BOTS=11 npm run play` | Onze adversaires automatiques, une place pour toi |
| `BOT_NIVEAU=1 npm run play` | Adversaires débutants, de 1 à 4 (3 par défaut) |
| `BOT_CARACTERE=corsaire npm run play` | Tous du même caractère, au lieu du panachage |
| `TERRES=72 npm run play` | Soixante-douze hexagones de terre. Réglable aussi depuis l'écran hôte, de 19 à 130, indépendamment du nombre de joueurs |
| `REPRENDRE=parties/xxx.jsonl npm run play` | Reprend une partie interrompue là où elle s'était arrêtée |
| `PARTIES= npm run play` | N'écrit aucun journal de partie |

---

## Les adversaires automatiques

Ils passent par le même WebSocket que les joueurs et ne voient que ce qu'un
joueur voit : leur vue publique et leur vue privée. **Ils ne peuvent pas
tricher** — la géométrie du plateau et les inventaires de chacun sont
publics, et c'est tout ce dont ils se servent.

Deux réglages, indépendants, se règlent depuis l'écran de l'hôte pendant que
la pièce se remplit.

### Le niveau — ce qu'ils savent faire

| | | |
|---|---|---|
| **1** | Apprenti | Joue des coups légaux sans les peser. Se laisse battre sans rancune. |
| **2** | Colon | Regarde les jetons avant de poser, construit par ordre de valeur, propose des échanges simples. |
| **3** | Aguerri | Exploite ses ports, annonce hors de son tour, joue ses cartes à propos, adresse ses offres à qui peut les honorer. |
| **4** | Stratège | Freine celui qui mène dès qu'il touche au but, dispute les emplacements, garde sa main sous la limite. |

L'échelle est mesurée, et elle n'est pas régulière. Sur quarante-huit parties
à six joueurs, sièges alternés : le **colon bat l'apprenti quarante-trois
fois à zéro**, et les anciens bots quarante-huit fois sur quarante-huit. Mais
l'aguerri ne bat le colon que vingt fois à seize, et le stratège l'aguerri
d'un cheveu. **Ce que le niveau 2 ajoute — peser les emplacements, viser un
coût précis — vaut plus que tout ce qui vient après.**

Une table forte joue un peu plus longtemps : tout le monde avance, le plateau
se remplit, et c'est la place — pas le talent — qui décide alors de la durée.
À niveau élevé, prévois plus de terres ou baisse le seuil de victoire.

### Le caractère — ce qu'ils veulent

Six, distribués à tour de rôle pour qu'aucun ne manque et qu'aucun ne soit là
cinq fois. Le nom du bot le porte : **Ariane (négoce)** marchandera.

| | |
|---|---|
| **Bâtisseur** | Prend le terrain tôt et le garde : colonies, routes, puis villes. |
| **Marchand** | Propose sans arrêt, occupe les ports, et vit du cours plutôt que des dés. |
| **Corsaire** | Chevaliers, voleur sur le meneur, et les emplacements qu'un autre convoitait. |
| **Navigateur** | Quitte l'île centrale tôt, quitte à y laisser un tour d'avance. |
| **Érudit** | Achète des cartes, vise le monument et la métropole, et attend son heure. |
| **Prudent** | Ne garde jamais dix cartes, préfère une ville sûre à une colonie exposée. |

Ce n'est pas un décor : à trois parties de mesure, le marchand dépose 1382
offres d'échange et le corsaire 395 ; le bâtisseur annonce quatre-vingts
constructions hors de son tour, l'érudit aucune.

Leur cervelle vit dans [`packages/sim/src/pilote/`](packages/sim/src/pilote/),
et c'est **exactement la même** en simulation et en soirée : ce qu'on éprouve
en dix mille parties est ce qui s'assoit à la table.

```bash
npx tsx scripts/adversaires.ts     # duels par niveau, tables entières
```

---

## Pendant la partie

Un **cycle** est le tour d'un joueur. Le joueur actif lance les dés et
construit ; le joueur **associé** — trois places plus loin — joue en même
temps que lui. Tout le monde produit à chaque lancer, échange pendant la
fenêtre de commerce, et peut **annoncer une construction hors de son tour**,
qui se résout en fin de cycle.

La banque n'a pas de prix fixe : chaque ressource a un **cours** qui monte
quand la table la brade et descend quand elle se raréfie. La bande de
chiffres au-dessus du commerce le donne, port compris, avec une flèche quand
il est sur le point de bouger.

Un joueur qui rafraîchit sa page **retrouve son siège**. Un joueur absent voit
son tour joué au minimum plutôt que de bloquer la table.

**La documentation :** [docs/index.html](docs/index.html) — quinze pages qui
expliquent le monde, les règles et les mécanismes du jeu. À ouvrir dans un
navigateur, sans rien lancer.

**Les règles seules, pour les joueurs :** [docs/regles.html](docs/regles.html)
— le manuel en une page, à envoyer à tes invités avant la soirée.

Les décisions prises là où le jeu d'origine était ambigu sont consignées dans
[RULES_CONTRACT.md](RULES_CONTRACT.md), qui fait foi sur le code.

---

## Si ça coince

**« La partie est complète » alors que personne n'a rejoint.**
Un onglet Grand Colonies resté ouvert reprend son siège à chaque
redémarrage. Ferme les onglets qui traînent, ou relance le serveur.

**Un invité n'arrive pas à se connecter.**
Vérifie qu'il est sur le même réseau Wi-Fi. L'adresse doit être celle en
`192.168.x.x`, pas `localhost`.

**Le port est déjà pris.**

```bash
lsof -ti:2567 -ti:5173 | xargs kill -9
```

---

## Développement

```bash
npm test          # 512 tests
npm run typecheck # les six paquets
npm run assets    # met les images générées à la portée du client

node docs/tisser.mjs        # réassemble la documentation depuis docs/_pages/

npx tsx scripts/marche.ts       # mesure le marché contre un taux figé
npx tsx scripts/ports.ts        # mesure les ports à contrat contre une côte sans eux
npx tsx scripts/adversaires.ts  # départage les quatre niveaux d'adversaires
```

Le plateau est rendu en Three.js, dans
[`packages/client/src/ui/board3d/`](packages/client/src/ui/board3d/) : les
tuiles sont des prismes hexagonaux dont la surface est sculptée — la montagne
a un pic, la colline une croupe, le champ ondule à peine — la mer est une
nappe animée, et les pièces sont des volumes. Le relief est décrit terrain
par terrain dans
[`board3d/relief.ts`](packages/client/src/ui/board3d/relief.ts), sous une
contrainte qui gouverne tout le fichier : **le bord d'une tuile est plat et
presque au même niveau que ses voisines**, parce que les routes courent sur
les arêtes et les colonies sur les sommets. Tout le volume est au centre. Tout est instancié —
une partie à douze tient en une trentaine d'appels de dessin, ce qui laisse
un téléphone d'entrée de gamme à soixante images par seconde. Un doigt
déplace la carte, deux doigts zooment et la font pivoter, un tap construit.

Ce qui bouge répond à une question que l'écran posait sans y répondre. Une
pièce posée **tombe du ciel** et soulève un peu de poussière : à douze
joueurs, où l'on bâtit hors de son tour, une route apparue sans bruit n'était
pas remarquée. Un hexagone qui produit fait **sauter son jeton**, et les
cartes gagnées **volent jusqu'à leur pile** dans la barre du bas : le montant
vient du serveur, le trajet dit d'où il vient. Les courbes sont réunies dans
[`board3d/chute.ts`](packages/client/src/ui/board3d/chute.ts), et toutes se
taisent sous `prefers-reduced-motion`.

Le **lancer se joue sur le plateau**. Le bouton reste où il était — c'est
lui qui envoie l'ordre au serveur — mais les deux dés tombent du ciel au
centre de la carte, roulent, se heurtent, s'arrêtent, et le nombre sorti
monte au-dessus d'eux en grand, le temps qu'on le lise depuis l'autre bout de
la pièce.

Ils tombent pour de bon : `board3d/physique.ts` est un petit solveur de corps
rigide — pesanteur, contacts par les huit coins, rebond, frottement de
Coulomb — et non une courbe déguisée. **Comment un dé qui tombe librement
arrive-t-il sur le nombre que le serveur a tiré ?** Par les vingt-quatre
symétries du cube. On simule une chute honnête sans savoir ce qu'elle
donnera, on regarde quelle face s'est arrêtée en haut, puis on fait tourner
la *peinture* du dé — pas sa trajectoire — pour que le nombre voulu soit
celui qui regarde le ciel. Mêmes chocs, mêmes rebonds, même arrêt : le dé n'a
pas été dévié d'un millimètre, il a été repeint. Le client ne tire jamais
rien ; le moteur reste seul juge, et l'image ne peut pas mentir sur l'état du
jeu.

Le lancer entier est calculé au lâcher, en une fraction de milliseconde, puis
rejoué image par image — ce qui permet de connaître la face avant de
l'afficher, de savoir où poser le total, et de ne rien dérégler quand une
image se perd. Le calcul n'emploie que les quatre opérations et une racine
carrée, exactes au bit près : à graine égale — cycle, joueur actif, deux
nombres — les douze écrans calculent **le même** lancer, ce qui est la moitié
de l'intérêt de le montrer sur la table. Le reste de l'interface se règle sur
lui : le bandeau ne dit le total qu'une fois les dés posés, les jetons ne
sautent qu'après, et la défausse d'un sept attend son tour.

Les images vivent dans `assets/generated` et le client les sert depuis son
dossier `public`, qui n'est pas versionné : `npm run play` fait la copie, et
`npm run assets` la refait à la demande. Sans elle, le plateau s'affiche sans
ses terrains.

| Paquet | Rôle |
|---|---|
| `packages/engine` | Les règles. Ne dépend ni du réseau, ni du navigateur. |
| `packages/protocol` | Les vues publique et privée, et la sérialisation des événements. |
| `packages/server` | Sièges, chronomètres, reconnexion, transport WebSocket. |
| `packages/client` | L'écran des joueurs (React), et le plateau en 3D. |
| `packages/sim` | Les adversaires automatiques, et la simulation qui les mesure. |
| `apps/host` | L'écran de l'hôte : QR code et démarrage. |

Le **marché dynamique** du §10 est branché : le taux bancaire n'est plus la
constante 4:1 mais un cours par ressource, qui bouge d'une carte toutes les
quatre transactions et que les ports remisent au lieu de le remplacer.

Deux **ports à contrat** du §11 s'y ajoutent, semés une fois par plateau : le
port minier fond 2 minerai en 1 or, le port commercial convertit 2 ressources
de natures différentes en 1 au choix. Leurs prix sont fixes — le marché ne
les touche pas, ce qui les rend précieux exactement quand il s'emballe.

Les décisions sont aux §10 et §11 de
[RULES_CONTRACT.md](RULES_CONTRACT.md), les mesures aux sixième et septième
tours de [SIMULATION_FINDINGS.md](SIMULATION_FINDINGS.md).

Ce qui reste à faire est recensé dans
[SIMULATION_FINDINGS.md](SIMULATION_FINDINGS.md) — notamment les barbares,
l'Influence — dont dépend le port royal du §11 —, les contrats et les
hexagones d'exploration face cachée, qui ne sont pas implémentés.

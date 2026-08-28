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
  Plateau      archipel
```

**Ouvre l'écran hôte sur le PC** (la première adresse). Il affiche un QR code
et l'adresse à donner aux invités, et se remplit à mesure qu'ils arrivent.

**Les invités scannent le QR code**, tapent leur prénom, et attendent. Ils
peuvent arriver dans n'importe quel ordre.

**Quand tout le monde est là, clique « Démarrer la partie »** sur l'écran
hôte. Tu peux lancer sans attendre les retardataires : leurs sièges seront
joués au minimum, et ils reprendront leur place en arrivant.

`Ctrl+C` arrête tout.

### Options

| Commande | Effet |
|---|---|
| `PLAYERS=8 npm run play` | Huit joueurs au lieu de douze |
| `BOARD=disque npm run play` | Plateau en disque : soirée plus courte (≈ 2 h 20 au lieu de 3 h 30 à douze) |
| `BOTS=11 npm run play` | Onze adversaires automatiques, une place pour toi |

Les bots passent par le même WebSocket que les joueurs et ne voient que ce
qu'un joueur voit : ils ne peuvent pas tricher. Ils construisent par ordre de
valeur en points et convertissent leur surplus, mais ne planifient pas et ne
marchandent pas — un humain les bat sans peine, et c'est le but : ils sont là
pour que la partie tourne.

---

## Pendant la partie

Un **cycle** est le tour d'un joueur. Le joueur actif lance les dés et
construit ; le joueur **associé** — trois places plus loin — joue en même
temps que lui. Tout le monde produit à chaque lancer, échange pendant la
fenêtre de commerce, et peut **annoncer une construction hors de son tour**,
qui se résout en fin de cycle.

Un joueur qui rafraîchit sa page **retrouve son siège**. Un joueur absent voit
son tour joué au minimum plutôt que de bloquer la table.

**Les règles complètes, pour les joueurs :** [docs/regles.html](docs/regles.html)
— à ouvrir dans un navigateur, ou à envoyer à tes invités avant la soirée.

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
npm test          # 399 tests
npm run typecheck # les six paquets
npm run assets    # met les images générées à la portée du client
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
| `packages/sim` | Bots et simulation, pour mesurer l'équilibrage. |
| `apps/host` | L'écran de l'hôte : QR code et démarrage. |

Ce qui reste à faire est recensé dans
[SIMULATION_FINDINGS.md](SIMULATION_FINDINGS.md) — notamment les barbares,
l'Influence et les hexagones d'exploration face cachée, qui ne sont pas
implémentés.

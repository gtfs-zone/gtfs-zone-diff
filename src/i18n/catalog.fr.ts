import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { en } from './catalog.en';

/** diff.gtfs.zone's UI strings, in French. */
export const fr: Translation<typeof en> = {
  'app.title': 'diff.gtfs.zone - Comparer deux flux GTFS',
  'app.noWebgl':
    'La carte nécessite WebGL, que ce navigateur a désactivé ou ne prend pas en charge.',

  'shell.loading': 'Chargement',
  'shell.compare': 'Comparer',
  'shell.help': 'Aide',

  'nav.theme': 'Changer de thème',
  'nav.guide': 'Guide',

  'home.lede':
    "Choisissez deux flux GTFS, A et B, pour voir ce qui a changé de l'un à l'autre.",
  'home.sideA': 'Flux A',
  'home.sideB': 'Flux B',
  'home.noSource': 'Aucun flux choisi.',
  'home.choose': 'Choisir',
  'home.change': 'Changer',
  'home.clear': 'Retirer',
  'home.swap': 'Inverser A et B',
  'home.uploaded': 'Fichier importé',
  'home.uploadNotLinked':
    "Un fichier importé ne peut pas figurer dans un lien : qui ouvre le lien de cette page n'obtient que les flux par URL et du catalogue.",
  'home.yourFeedsNote':
    "Vos flux liste les flux enregistrés par diff.gtfs.zone dans ce navigateur. Ceux de l'éditeur ou du visualiseur sont enregistrés à part : exportez-les ou partagez leur lien pour les comparer ici.",

  'source.notInCatalog':
    "Le catalogue de flux n'a pas d'horaires pour cet identifiant.",
  'source.catalogFailed':
    "Le catalogue de flux n'a pas pu être chargé : {reason}",

  'picker.missingNotice':
    'Le flux {side} de ce lien est introuvable : {reason}',

  'focus.back': 'Retour à la comparaison',
  'focus.file': 'Fichier',
  'focus.agency': 'Réseau',
  'focus.route': 'Ligne',
  'focus.trip': 'Course',
  'focus.stop': 'Arrêt',
  'focus.service': 'Service',
  'focus.shape': 'Tracé',

  'compare.waiting': 'Choisissez les deux flux pour les comparer.',
  'compare.loading': 'Chargement du flux {side}',
  'compare.loadingTable': 'Chargement du flux {side} : {table}',
  'compare.bytesOf': '{read} sur {total}',
  'compare.stage.files': 'Comparaison des fichiers',
  'compare.stage.renames': 'Recherche des identifiants renommés',
  'compare.stage.rows': 'Comparaison de {table}',
  'compare.stage.groups': 'Regroupement des changements',
  'compare.failedSide': "Le flux {side} n'a pas pu être chargé : {message}",
  'compare.failed': 'La comparaison a échoué : {message}',
  'compare.retry': 'Réessayer',
  'compare.incomplete':
    'Les groupes ci-dessous ne couvrent pas toutes les différences brutes. Il s’agit d’un bogue de diff.gtfs.zone ; les décomptes bruts par fichier restent justes.',
  'compare.timings': 'Chargé en {load} s, comparé en {compare} s.',

  'results.files': 'Fichiers',
  'results.noChanges': 'Aucune différence : tous les fichiers sont identiques.',
  'results.status.added': 'ajouté',
  'results.status.removed': 'supprimé',
  'results.status.identical': 'identique',
  'results.status.formatting': 'mise en forme seulement',
  'results.status.changed': 'modifié',
  'results.status.unknown': 'aucune ligne ne diffère',
  'results.added': '{count} ajoutées',
  'results.removed': '{count} supprimées',
  'results.changed': '{count} modifiées',
  'results.formatting': '{count} mise en forme seulement',
  'results.renamed': '{count} renommées',
  'results.followsRename': '{count} suivent un renommage',
  'results.unchanged': '{count} inchangées',
  'results.header': 'Colonnes : {changes}',
  'results.headerAdded': 'ajout de {cols}',
  'results.headerRemoved': 'retrait de {cols}',
  'results.headerReordered': 'ordre modifié',
  'results.groups': 'Changements regroupés',
  'results.noGroups': 'Aucun changement regroupé.',
  'results.covers_one': '{count} course',
  'results.covers_other': '{count} courses',
  'results.group.rename': '{entity} renommés',
  'results.group.renameSuggestion':
    'Renommages possibles de {entity} (ambigus)',
  'results.group.serviceDates': 'Services aux dates modifiées',
  'results.group.serviceWindow':
    "Services modifiés seulement hors des dates de l'autre flux",
  'results.group.timeShift': 'Courses décalées dans le temps',
  'results.group.patternChange': 'Courses aux arrêts modifiés',
  'results.group.stopTimesFields':
    'Courses avec d’autres changements dans stop_times',
  'results.group.stopTimesTimes': 'Courses aux horaires modifiés',
  'results.group.tripCount': 'Lignes au nombre de courses différent',
  'results.group.stopMoved': 'Arrêts déplacés',
  'results.group.shapeChanged': 'Tracés modifiés',
  'results.issues': 'Problèmes dans les flux',
  'results.issue.duplicateKeys':
    'Flux {side} : {count} lignes de {file} répètent une clé ({detail}), le fichier a donc été comparé ligne entière.',
  'results.issue.duplicateStopSequence':
    '{count} lignes de stop_times répètent un stop_sequence dans leur course.',
  'results.issue.noZipIndex':
    "Flux {side} : l'index du zip n'a pas pu être lu, les fichiers inchangés ont donc été comparés ligne par ligne.",
  'results.issue.parseErrors':
    'Flux {side} : {count} erreurs de lecture dans {file}, la première : {detail}',

  'help.welcome.label': 'Bienvenue',
  'help.welcome.start': 'Commencer !',
  'help.welcome.title': 'Bienvenue sur diff.gtfs.zone',
  'help.welcome.lede':
    "Comparez deux flux GTFS dans votre navigateur. Rien n'est envoyé à un serveur.",
  'help.welcome.sources': 'Deux flux',
  'help.welcome.sourcesText':
    "Choisissez le flux A et le flux B depuis une URL, un fichier, le catalogue de flux ou vos flux enregistrés. N'importe lequel se compare à n'importe quel autre.",
  'help.welcome.changes': 'Ce qui a changé',
  'help.welcome.changesText':
    'Fichiers, lignes et champs ajoutés, supprimés et modifiés, regroupés par arrêt, ligne, course, calendrier et tracé.',
  'help.welcome.links': 'Liens',
  'help.welcome.linksText':
    "La barre d'adresse contient les deux flux et ce que vous regardez : un lien rouvre la même comparaison.",
  'help.about.blurb':
    'diff.gtfs.zone compare deux flux GTFS : chaque différence entre eux, regroupée comme on lit des données de transport.',
  'help.about.blurb2':
    "Les deux flux sont chargés et comparés dans votre navigateur ; rien n'est envoyé à un serveur.",
  'help.about.subject': 'Retour sur diff.gtfs.zone',
  'help.about.sibling': 'éditeur GTFS',
};

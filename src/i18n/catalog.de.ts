import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { en } from './catalog.en';

/** diff.gtfs.zone's UI strings, in German. */
export const de: Translation<typeof en> = {
  'app.title': 'diff.gtfs.zone - Zwei GTFS-Feeds vergleichen',
  'app.noWebgl':
    'Die Karte braucht WebGL, das in diesem Browser ausgeschaltet ist oder nicht unterstützt wird.',

  'shell.loading': 'Wird geladen',
  'shell.compare': 'Vergleichen',
  'shell.help': 'Hilfe',

  'nav.theme': 'Design wechseln',
  'nav.guide': 'Anleitung',

  'home.lede':
    'Wählen Sie zwei GTFS-Feeds, A und B, um zu sehen, was sich vom einen zum anderen geändert hat.',
  'home.sideA': 'Feed A',
  'home.sideB': 'Feed B',
  'home.noSource': 'Kein Feed gewählt.',
  'home.choose': 'Wählen',
  'home.change': 'Ändern',
  'home.clear': 'Entfernen',
  'home.swap': 'A und B tauschen',
  'home.uploaded': 'Hochgeladene Datei',
  'home.uploadNotLinked':
    'Hochgeladene Dateien können nicht in einen Link: Wer den Link dieser Seite öffnet, bekommt nur die Feeds per URL und aus dem Katalog.',
  'home.yourFeedsNote':
    'Ihre Feeds zeigt die Feeds, die diff.gtfs.zone in diesem Browser gespeichert hat. Feeds aus dem Editor oder dem Viewer werden getrennt gespeichert: Exportieren oder verlinken Sie sie, um sie hier zu vergleichen.',

  'source.notInCatalog': 'Der Feed-Katalog hat keinen Fahrplan zu dieser ID.',
  'source.catalogFailed':
    'Der Feed-Katalog konnte nicht geladen werden: {reason}',

  'picker.missingNotice':
    'Feed {side} aus diesem Link wurde nicht gefunden: {reason}',

  'focus.back': 'Zurück zum Vergleich',
  'focus.file': 'Datei',
  'focus.agency': 'Verkehrsunternehmen',
  'focus.route': 'Linie',
  'focus.trip': 'Fahrt',
  'focus.stop': 'Haltestelle',
  'focus.service': 'Verkehrstage',
  'focus.shape': 'Linienverlauf',

  'help.welcome.label': 'Willkommen',
  'help.welcome.start': 'Los geht’s!',
  'help.welcome.title': 'Willkommen bei diff.gtfs.zone',
  'help.welcome.lede':
    'Vergleichen Sie zwei GTFS-Feeds im Browser. Nichts wird an einen Server gesendet.',
  'help.welcome.sources': 'Zwei Feeds',
  'help.welcome.sourcesText':
    'Wählen Sie Feed A und Feed B aus einer URL, einer Datei, dem Feed-Katalog oder Ihren gespeicherten Feeds. Jeder lässt sich mit jedem vergleichen.',
  'help.welcome.changes': 'Was sich geändert hat',
  'help.welcome.changesText':
    'Hinzugefügte, entfernte und geänderte Dateien, Zeilen und Felder, gruppiert nach Haltestelle, Linie, Fahrt, Kalender und Linienverlauf.',
  'help.welcome.links': 'Links',
  'help.welcome.linksText':
    'Die Adresszeile enthält beide Feeds und die aktuelle Ansicht, ein Link öffnet also denselben Vergleich.',
  'help.about.blurb':
    'diff.gtfs.zone vergleicht zwei GTFS-Feeds: jeder Unterschied zwischen ihnen, gruppiert so, wie man Fahrplandaten liest.',
  'help.about.blurb2':
    'Beide Feeds werden im Browser geladen und verglichen; nichts wird an einen Server gesendet.',
  'help.about.subject': 'Feedback zu diff.gtfs.zone',
  'help.about.sibling': 'GTFS-Editor',
};

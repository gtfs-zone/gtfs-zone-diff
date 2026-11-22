/** diff.gtfs.zone's UI strings, in English: the source of the keys. */
export const en = {
  'app.title': 'diff.gtfs.zone - Compare two GTFS feeds',
  'app.noWebgl':
    'The map needs WebGL, which this browser has turned off or does not support.',

  'shell.loading': 'Loading',
  'shell.compare': 'Compare',
  'shell.help': 'Help',

  'nav.theme': 'Toggle theme',
  'nav.guide': 'Guide',

  'home.lede':
    'Pick two GTFS feeds, A and B, to see what changed from one to the other.',
  'home.sideA': 'Feed A',
  'home.sideB': 'Feed B',
  'home.noSource': 'No feed chosen.',
  'home.choose': 'Choose',
  'home.change': 'Change',
  'home.clear': 'Clear',
  'home.swap': 'Swap A and B',
  'home.uploaded': 'Uploaded file',
  'home.uploadNotLinked':
    'Uploaded files cannot be put in a link: a link to this page carries only the URL and catalog feeds.',
  'home.yourFeedsNote':
    'Your feeds lists feeds stored by diff.gtfs.zone in this browser. Feeds from the editor or the viewer are stored separately: export or link them to compare them here.',

  'source.notInCatalog': 'The feed catalog has no schedule for this id.',
  'source.catalogFailed': 'The feed catalog could not be loaded: {reason}',

  'picker.missingNotice':
    'Feed {side} in this link could not be found: {reason}',

  'focus.back': 'Back to the comparison',
  'focus.file': 'File',
  'focus.agency': 'Agency',
  'focus.route': 'Route',
  'focus.trip': 'Trip',
  'focus.stop': 'Stop',
  'focus.service': 'Service',
  'focus.shape': 'Shape',

  'help.welcome.label': 'Welcome',
  'help.welcome.start': 'Get started!',
  'help.welcome.title': 'Welcome to diff.gtfs.zone',
  'help.welcome.lede':
    'Compare two GTFS feeds in your browser. Nothing is uploaded to a server.',
  'help.welcome.sources': 'Two feeds',
  'help.welcome.sourcesText':
    'Pick feed A and feed B from a URL, an upload, the feed catalog or your stored feeds. Any one can be compared with any other.',
  'help.welcome.changes': 'What changed',
  'help.welcome.changesText':
    'Added, removed and changed files, rows and fields, grouped by stop, route, trip, calendar and shape.',
  'help.welcome.links': 'Links',
  'help.welcome.linksText':
    'The address bar holds both feeds and what you are looking at, so a link opens the same comparison.',
  'help.about.blurb':
    'diff.gtfs.zone compares two GTFS feeds: every difference between them, grouped the way transit data is read.',
  'help.about.blurb2':
    'Both feeds are loaded and compared in your browser; nothing is sent to a server.',
  'help.about.subject': 'diff.gtfs.zone feedback',
  'help.about.sibling': 'GTFS editor',
} as const;

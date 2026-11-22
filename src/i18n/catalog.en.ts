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

  'compare.waiting': 'Choose both feeds to compare them.',
  'compare.loading': 'Loading feed {side}',
  'compare.loadingTable': 'Loading feed {side}: {table}',
  'compare.bytesOf': '{read} of {total}',
  'compare.stage.files': 'Comparing files',
  'compare.stage.renames': 'Matching renamed ids',
  'compare.stage.rows': 'Comparing {table}',
  'compare.stage.groups': 'Grouping the changes',
  'compare.failedSide': 'Feed {side} could not be loaded: {message}',
  'compare.failed': 'The comparison failed: {message}',
  'compare.retry': 'Try again',
  'compare.incomplete':
    'The groups below do not account for every raw difference. This is a bug in diff.gtfs.zone; the raw counts per file are still right.',
  'compare.timings': 'Loaded in {load} s, compared in {compare} s.',

  'results.files': 'Files',
  'results.noChanges': 'No differences: every file is identical.',
  'results.status.added': 'added',
  'results.status.removed': 'removed',
  'results.status.identical': 'identical',
  'results.status.formatting': 'formatting only',
  'results.status.changed': 'changed',
  'results.status.unknown': 'no row differs',
  'results.added': '{count} added',
  'results.removed': '{count} removed',
  'results.changed': '{count} changed',
  'results.formatting': '{count} formatting only',
  'results.renamed': '{count} renamed',
  'results.followsRename': '{count} follow a rename',
  'results.unchanged': '{count} unchanged',
  'results.header': 'Columns: {changes}',
  'results.headerAdded': 'added {cols}',
  'results.headerRemoved': 'removed {cols}',
  'results.headerReordered': 'reordered',
  'results.groups': 'Grouped changes',
  'results.noGroups': 'No grouped changes.',
  'results.covers_one': '{count} trip',
  'results.covers_other': '{count} trips',
  'results.group.rename': 'Renamed {entity}',
  'results.group.renameSuggestion': 'Possible {entity} renames (ambiguous)',
  'results.group.serviceDates': 'Services with changed dates',
  'results.group.serviceWindow':
    "Services changed only outside the other feed's dates",
  'results.group.timeShift': 'Trips shifted in time',
  'results.group.patternChange': 'Trips with changed stops',
  'results.group.stopTimesFields': 'Trips with other stop_times changes',
  'results.group.stopTimesTimes': 'Trips with changed times',
  'results.group.tripCount': 'Routes with a different trip count',
  'results.group.stopMoved': 'Moved stops',
  'results.group.shapeChanged': 'Changed shapes',
  'results.issues': 'Feed issues',
  'results.issue.duplicateKeys':
    'Feed {side}: {count} rows of {file} repeat a key ({detail}), so the file was compared as whole rows.',
  'results.issue.duplicateStopSequence':
    '{count} stop_times rows repeat a stop_sequence within their trip.',
  'results.issue.noZipIndex':
    'Feed {side}: the zip index could not be read, so unchanged files were compared row by row.',
  'results.issue.parseErrors':
    'Feed {side}: {count} parse errors in {file}, first: {detail}',

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

/** The help pages: what exists, its grouping, and its copy. */

import { eyebrow, glyphList, lede } from 'gtfs-zone-web-common/ui/help-modal';
import type { AboutApp } from 'gtfs-zone-web-common/ui/about-links';
import {
  aboutPage,
  ICON_CHECK,
  ICON_LOAD,
  ICON_MAP,
  type HelpPage,
} from 'gtfs-zone-web-common/ui/help-pages';
import { t } from '../i18n/messages';

const welcomePage: HelpPage = {
  id: 'welcome',
  label: t('help.welcome.label'),
  group: 'Getting Started',
  title: t('help.welcome.title'),
  showOnce: true,
  render: () =>
    [
      eyebrow('GTFS.zone'),
      lede(t('help.welcome.lede')),
      glyphList([
        {
          icon: ICON_LOAD,
          term: t('help.welcome.sources'),
          description: t('help.welcome.sourcesText'),
        },
        {
          icon: ICON_CHECK,
          term: t('help.welcome.changes'),
          description: t('help.welcome.changesText'),
        },
        {
          icon: ICON_MAP,
          term: t('help.welcome.links'),
          description: t('help.welcome.linksText'),
        },
      ]),
    ].join(''),
};

const ABOUT_APP: AboutApp = {
  name: 'diff.gtfs.zone',
  blurb: [t('help.about.blurb'), t('help.about.blurb2')],
  contactSubject: t('help.about.subject'),
  repo: 'gtfs-zone-diff',
  sibling: {
    name: 'edit.gtfs.zone',
    href: 'https://edit.gtfs.zone',
    note: t('help.about.sibling'),
  },
};

export const HELP_PAGES: HelpPage[] = [welcomePage, aboutPage(ABOUT_APP)];

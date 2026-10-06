// Where to send a report, by US state (keyed by postal code).
//
// Only contacts traced to an official or extension source are listed; anything else
// falls back to EDDMapS and the federal list of state contacts. Agencies change
// inboxes, so re-check these each season. Last checked October 2026.
//
//   asksForToh: true  - the state asks the public to report tree of heaven itself.
//   asksForToh: false - the contact is for spotted lanternfly; send tree reports there
//                       only when lanternflies were seen too.
export const STATE_CONTACTS = {
  MN: {
    agency: 'Minnesota Department of Agriculture',
    email: 'reportapest@state.mn.us', phone: '1-888-545-6684',
    url: 'https://mda.state.mn.us/plants-insects/tree-heaven-report-manage',
    asksForToh: true,
  },
  WI: {
    agency: 'Wisconsin First Detector Network (UW-Madison Extension, with Wisconsin DNR)',
    email: 'WIFDN@extension.wisc.edu',
    url: 'https://forestrynews.blogs.govdelivery.com/2023/04/13/report-tree-of-heaven-to-help-monitor-for-spotted-lanternfly/',
    asksForToh: true,
  },
  DE: {
    agency: 'Delaware Department of Agriculture',
    email: 'HitchHikerBug@delaware.gov', phone: '(302) 698-4632',
    url: 'https://www.stopslf.org/where-is-slf/spotted-lanternfly-quarantine-and-reporting-information/',
    asksForToh: false,
  },
  MD: {
    agency: 'Maryland Department of Agriculture',
    email: 'DontBug.MD@maryland.gov', phone: '(410) 841-5920',
    url: 'https://www.stopslf.org/where-is-slf/spotted-lanternfly-quarantine-and-reporting-information/',
    asksForToh: false,
  },
  NJ: {
    agency: 'New Jersey Department of Agriculture',
    email: 'SLF-plantindustry@ag.nj.gov', phone: '1-833-223-2840',
    url: 'https://www.stopslf.org/where-is-slf/spotted-lanternfly-quarantine-and-reporting-information/',
    asksForToh: false,
  },
  NY: {
    agency: 'New York State Department of Agriculture and Markets',
    email: 'spottedlanternfly@agriculture.ny.gov',
    url: 'https://agriculture.ny.gov/ReportSLF',
    asksForToh: false,
  },
  WV: {
    agency: 'West Virginia Department of Agriculture',
    email: 'bugbusters@wvda.us', phone: '(304) 558-2212',
    url: 'https://www.stopslf.org/where-is-slf/spotted-lanternfly-quarantine-and-reporting-information/',
    asksForToh: false,
  },
  IN: {
    agency: 'Indiana DNR, Division of Entomology and Plant Pathology',
    email: 'DEPP@dnr.IN.gov', phone: '866-663-9684',
    url: 'https://www.in.gov/dnr/entomology/pests-of-concern/spotted-lanternfly/',
    asksForToh: false,
  },
  MI: {
    agency: 'Michigan Department of Agriculture and Rural Development',
    email: 'MDA-Info@michigan.gov',
    url: 'https://www.michigan.gov/invasives/news/2022/07/26/mdard-asks-michiganders-to-be-on-the-lookout-for-spotted-lanternfly',
    asksForToh: false,
  },
  CO: {
    agency: 'Colorado Department of Agriculture',
    email: 'cda_slf@state.co.us', phone: '303-869-9081',
    url: 'https://ag.colorado.gov/plants/pest-survey/spotted-lanternfly/report-an-slf-sighting',
    asksForToh: false,
  },
  // Form or phone only: no email to draft to, but the link still helps.
  PA: {
    agency: 'Pennsylvania Department of Agriculture', phone: '1-888-422-3359',
    url: 'https://www.stopslf.org/where-is-slf/spotted-lanternfly-quarantine-and-reporting-information/',
    asksForToh: false,
  },
  CT: {
    agency: 'Connecticut Agricultural Experiment Station',
    url: 'https://portal.ct.gov/caes/caps/caps/contact-us',
    asksForToh: false,
  },
  VA: {
    agency: 'Virginia Cooperative Extension',
    url: 'https://ext.vt.edu/agriculture/commercial-horticulture/spotted-lanternfly.html',
    asksForToh: false,
  },
  WA: {
    agency: 'Washington State Department of Agriculture',
    url: 'https://agr.wa.gov/departments/insects-pests-and-weeds/insects/spotted-lanternfly/report-sightings',
    asksForToh: false,
  },
};

export const EDDMAPS_REPORT = 'https://www.eddmaps.org/report/';
export const ALL_STATE_CONTACTS = 'https://www.invasivespeciesinfo.gov/terrestrial/invertebrates/spotted-lanternfly';

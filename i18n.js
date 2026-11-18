// Languages of the site and the text of everything the build writes around
// the articles: navigation, headings of listing pages, labels, structured
// data and social cards.
//
// The first language is the default one: its pages live at the site root
// and it is the hreflang x-default. Every other language lives in a
// subdirectory named by its `dir`, with its articles in articles/<dir>/ and
// its standalone pages in pages/<dir>/. A translation has the same file name
// as its original, which is how the build pairs them (hreflang links and the
// language switch); an article can also exist in one language only.
//
// `ui` entries fill the templates' {{t.<key>}} placeholders and may contain
// HTML entities. Everything else is used by build.js.

const config = require("./config");

const SITE_TITLE = config.site.title;

// English plural of "post"
const enPosts = (count) => `${count} ${count === 1 ? "post" : "posts"}`;

// Czech has three plural forms: 1 příspěvek, 2–4 příspěvky, 5+ příspěvků
const csPosts = (count) => {
  if (count === 1) return `${count} příspěvek`;
  if (count >= 2 && count <= 4) return `${count} příspěvky`;
  return `${count} příspěvků`;
};

const LANGUAGES = [
  {
    code: "en",
    dir: "",
    // The language's own name, shown on the language switch of the others
    name: "English",
    // The language switch's visible label
    short: "EN",
    locale: "en-US",
    ogLocale: "en_US",
    feedLanguage: "en-us",
    author: config.site.author,
    siteDescription: config.site.description,
    // Tag labels as shown in this language, by the label used in the
    // articles' metadata; tag URLs (tags/<slug>.html) are the same in every
    // language
    tags: {},
    ui: {
      "skip-link": "Skip to main content",
      "nav-label": "Main",
      "nav-archive": "Archive",
      "nav-projects": "Projects",
      "nav-about": "About",
      "theme-toggle": "Switch theme",
      "footer-label": "Footer",
      "rss-title": "RSS Feed",
      "hero-title": "Small software, games and the web",
      "hero-text":
        "I build things that fit in kilobytes: games that draw every pixel in code, iPhone apps that work offline without ads, and web apps with as few dependencies as possible. This is where I write down how they are made and what I learn on the way &mdash; including where AI helps and where it doesn&rsquo;t.",
      "hero-about": "About me",
      "hero-projects": "Projects",
      latest: "Latest",
      "archive-title": "Archive",
      "archive-intro":
        "Every post on the blog &mdash; browse by topic or by year.",
      "projects-title": "Projects",
      "projects-intro":
        "Games, apps and websites I have built and released, with links to play them, the source code and the stories behind them.",
      topic: "Topic",
      "all-topics": "All topics",
      share: "Share",
      "share-x": "Share on X",
      "share-linkedin": "Share on LinkedIn",
      "copy-link": "Copy link",
    },
    note: "Note",
    minRead: (minutes) => `${minutes} min read`,
    updated: "Updated",
    viewArchive: "View archive",
    showcase: "Games I made",
    allProjects: "All projects",
    topics: "Topics",
    postCount: enPosts,
    tagTitle: (label) => `Articles about ${label}`,
    tagSummary: (count) => `${enPosts(count)}, newest first.`,
    tagDescription: (count, label, author) =>
      `${enPosts(count)} about ${label} by ${author}`,
    homeTitle: `${SITE_TITLE}: Small Software, Games and the Web`,
    defaultCardTitle: "Small software, games and the web",
    defaultSocialAlt: `${SITE_TITLE}: small software, games and the web`,
    archiveTitle: "Archive",
    archiveDescription: (author) =>
      `Every post on ${SITE_TITLE} by ${author}, by topic and by year: indie games in C and Swift, offline iPhone apps, web development and AI.`,
    projectsTitle: "Projects",
    projectsSocialTitle: "Projects: games, apps and websites",
    projectsDescription: (author) =>
      `Games, iPhone apps and websites by ${author}: free browser games written in C, offline iOS games without ads, and small web tools.`,
    projectsCardTitle: "Games, apps and websites I made",
    projectCategories: { games: "Games", apps: "Apps", web: "Web" },
    openProject: "Open",
    readStory: "Read the story",
    sourceCode: "Source code",
    related: "Related reading",
    previous: "Previous",
    next: "Next",
    moreArticles: "More articles",
    discuss: "Discuss",
    link: "Link",
    // On the 404 page (which is in the default language) of a site that
    // also has this language
    notFound: "Page not found. Looking for the English version of the blog?",
    notFoundLink: "Go to the English blog",
    subscribe: {
      emailTitle: "Get new posts by email",
      emailText:
        "One short email whenever something new is published. No spam,\n            unsubscribe with one click.",
      emailLabel: "Email address",
      emailPlaceholder: "you@example.com",
      emailButton: "Subscribe",
      emailAlt: (rss, x) => `Prefer a feed reader? Follow via ${rss}${x}.`,
      xLink: (link) => ` or follow ${link} on X`,
      rssTitle: "Follow along",
      rssText: (rss, x) =>
        `New posts about small software, games and the web. Subscribe via\n            ${rss}${x}.`,
      rssButton: "Subscribe via RSS",
    },
  },
  {
    code: "cs",
    dir: "cs",
    name: "Česky",
    short: "CS",
    locale: "cs-CZ",
    ogLocale: "cs_CZ",
    feedLanguage: "cs",
    author: "Robert Libšanský",
    siteDescription:
      "Poznámky o tvorbě malého, soběstačného softwaru: hry, které se vejdou do kilobajtů, offline aplikace pro iPhone, pragmatický vývoj webu a upřímně o AI.",
    tags: {
      Games: "Hry",
      "Web Development": "Vývoj webu",
      Career: "Kariéra",
      Society: "Společnost",
    },
    ui: {
      "skip-link": "Přeskočit na obsah",
      "nav-label": "Hlavní",
      "nav-archive": "Archiv",
      "nav-projects": "Projekty",
      "nav-about": "O mně",
      "theme-toggle": "Přepnout motiv",
      "footer-label": "Patička",
      "rss-title": "RSS kanál",
      "hero-title": "Malý software, hry a web",
      "hero-text":
        "Dělám věci, které se vejdou do pár kilobajtů: hry, které každý pixel kreslí kódem, aplikace pro iPhone, které fungují offline a bez reklam, a webové aplikace s co nejmenším počtem závislostí. Tady zapisuji, jak vznikají a co se při tom naučím &ndash; včetně toho, kde AI pomáhá a kde ne.",
      "hero-about": "O mně",
      "hero-projects": "Projekty",
      latest: "Nejnovější",
      "archive-title": "Archiv",
      "archive-intro":
        "Všechny příspěvky na blogu &ndash; podle témat nebo podle roku.",
      "projects-title": "Projekty",
      "projects-intro":
        "Hry, aplikace a weby, které jsem vytvořil a vydal, s odkazy, kde si je vyzkoušet, se zdrojovým kódem a s příběhy o jejich vzniku.",
      topic: "Téma",
      "all-topics": "Všechna témata",
      share: "Sdílet",
      "share-x": "Sdílet na X",
      "share-linkedin": "Sdílet na LinkedInu",
      "copy-link": "Kopírovat odkaz",
    },
    note: "Poznámka",
    minRead: (minutes) => `${minutes} min čtení`,
    updated: "Aktualizováno",
    viewArchive: "Zobrazit archiv",
    showcase: "Moje hry",
    allProjects: "Všechny projekty",
    topics: "Témata",
    postCount: csPosts,
    tagTitle: (label) => `Články na téma ${label}`,
    tagSummary: (count) => `${csPosts(count)}, od nejnovějších.`,
    tagDescription: (count, label) =>
      `${csPosts(count)} Roberta Libšanského na téma ${label}`,
    homeTitle: `${SITE_TITLE}: malý software, hry a web`,
    defaultCardTitle: "Malý software, hry a web",
    defaultSocialAlt: `${SITE_TITLE}: malý software, hry a web`,
    archiveTitle: "Archiv",
    archiveDescription: () =>
      "Všechny příspěvky Roberta Libšanského podle témat a let: nezávislé hry v C a Swiftu, offline aplikace pro iPhone, vývoj webu a AI.",
    projectsTitle: "Projekty",
    projectsSocialTitle: "Projekty: hry, aplikace a weby",
    projectsDescription: () =>
      "Hry, aplikace pro iPhone a weby Roberta Libšanského: hry v C zdarma v prohlížeči, offline hry pro iOS bez reklam a malé webové nástroje.",
    projectsCardTitle: "Hry, aplikace a weby, které jsem vytvořil",
    projectCategories: { games: "Hry", apps: "Aplikace", web: "Web" },
    openProject: "Otevřít",
    readStory: "Přečíst příběh",
    sourceCode: "Zdrojový kód",
    related: "Související články",
    previous: "Předchozí",
    next: "Další",
    moreArticles: "Další články",
    discuss: "Diskuse",
    link: "Odkaz",
    notFound: "Stránka nenalezena. Hledáte českou verzi blogu?",
    notFoundLink: "Přejít na český blog",
    subscribe: {
      emailTitle: "Nové příspěvky e-mailem",
      emailText:
        "Krátký e-mail pokaždé, když vyjde něco nového. Žádný spam,\n            odhlásit se jde jedním kliknutím.",
      emailLabel: "E-mailová adresa",
      emailPlaceholder: "vy@example.com",
      emailButton: "Odebírat",
      emailAlt: (rss, x) =>
        `Raději čtečku zpráv? Sledujte blog přes ${rss}${x}.`,
      xLink: (link) => ` nebo ${link} na X`,
      rssTitle: "Sledujte novinky",
      rssText: (rss, x) =>
        `Nové příspěvky o malém softwaru, hrách a webu. Odebírejte je přes\n            ${rss}${x}.`,
      rssButton: "Odebírat přes RSS",
    },
  },
];

const DEFAULT_LANGUAGE = LANGUAGES[0];

// The language of a code; unknown or missing codes are the default language
function getLanguage(code) {
  return LANGUAGES.find((language) => language.code === code) || DEFAULT_LANGUAGE;
}

module.exports = { LANGUAGES, DEFAULT_LANGUAGE, getLanguage };

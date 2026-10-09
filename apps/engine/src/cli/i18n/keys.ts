/**
 * Definisi tipe dan kunci terjemahan untuk CLI Tahansoe (spec m3-cli §3.6).
 *
 * Menggunakan interface TranslationCatalog yang strictly-typed sehingga
 * pemeriksaan tipe TypeScript (typecheck) menjamin kelengkapan katalog
 * bahasa Indonesia (id.ts) dan bahasa Inggris (en.ts).
 */

export type SupportedLanguage = "id" | "en";

export interface TranslationCatalog {
  tagline: string;
  "banner.title": string;

  // REPL Welcome & Status
  "repl.welcomeTitle": string;
  "repl.market": string;
  "repl.signals": string;
  "repl.freshness": string;
  "repl.gateway": string;
  "repl.model": string;
  "repl.database": string;
  "repl.noAnalysis": string;
  "repl.noSignals": string;
  "repl.activeSignals": string;
  "repl.freshAll": string;
  "repl.staleSummary": string;
  "repl.noData": string;
  "repl.gatewayTelegramActive": string;
  "repl.gatewayTelegramOff": string;
  "repl.dbPglite": string;
  "repl.dbNeon": string;

  "repl.suggested": string;
  "repl.suggestedAnalyze": string;
  "repl.suggestedCarry": string;
  "repl.suggestedHelp": string;
  "repl.hint": string;
  "repl.gatewayWarning": string;
  "repl.thinking": string;
  "repl.screenCleared": string;
  "repl.scheduleHint": string;
  "repl.startHint": string;
  "repl.unknownCommand": string;
  "repl.langSwitched": string;
  "repl.langInvalid": string;
  "repl.langCurrent": string;
  "repl.gatewayMissingSub": string;
  "repl.noResearchYet": string;
  "repl.activeSignalSingle": string;
  "repl.activeSignalPlural": string;
  "repl.stale": string;
  "repl.last": string;

  // Help Sections & Descriptions
  "help.title": string;
  "help.sectionAnalysis": string;
  "help.sectionRisk": string;
  "help.sectionGateway": string;
  "help.sectionConfig": string;
  "help.sectionSystem": string;
  "help.descAnalyze": string;
  "help.descFuse": string;
  "help.descHistory": string;
  "help.descReport": string;
  "help.descSettle": string;
  "help.descScorecard": string;
  "help.descCarry": string;
  "help.descSimulate": string;
  "help.descGateway": string;
  "help.descPair": string;
  "help.descStatus": string;
  "help.descSettings": string;
  "help.descLang": string;
  "help.descSetup": string;
  "help.descDoctor": string;
  "help.descModels": string;
  "help.descClear": string;
  "help.descExit": string;
  "help.descHelp": string;
  "help.descStart": string;
  "help.footerText": string;
  "help.footerTip": string;

  // Setup Wizard
  "setup.langSelect": string;
  "setup.langId": string;
  "setup.langEn": string;
  "setup.langSaved": string;
  "setup.welcome": string;
  "setup.summary": string;
  "setup.completed": string;

  // Doctor
  "doctor.header": string;
  "doctor.allPassed": string;
  "doctor.someFailed": string;

  // Commands
  "cmd.analyze.title": string;
  "cmd.fuse.title": string;
  "cmd.carry.title": string;
  "cmd.history.title": string;
  "cmd.doctor.title": string;
  "cmd.models.title": string;
  "cmd.settings.title": string;

  // Common
  "common.none": string;
  "common.notConfigured": string;
  "common.dryRun": string;
  "common.loading": string;
  "common.cancelled": string;
}

export type TranslationKey = keyof TranslationCatalog;

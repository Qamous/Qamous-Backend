// Preserve provider-managed/job variables while explicitly publishing the two
// reviewed feature flags. --keep-vars alone silently preserves old pause flags.
export function importDeploymentArgs(configPath,vars) {
  if(typeof configPath!=='string'||!configPath||!['true','false'].includes(vars?.PUBLIC_READ_ONLY)||!['true','false'].includes(vars?.PUBLIC_CARD_PAYLOADS))throw Error('Explicit reviewed importer flags are required');
  return ['deploy','--config',configPath,'--keep-vars','--var','PUBLIC_READ_ONLY:'+vars.PUBLIC_READ_ONLY,'--var','PUBLIC_CARD_PAYLOADS:'+vars.PUBLIC_CARD_PAYLOADS];
}
export function verifyImportDeploymentFlags(settings,vars) {
  if(!Array.isArray(settings?.bindings)||['PUBLIC_READ_ONLY','PUBLIC_CARD_PAYLOADS'].some(name=>settings.bindings.find(binding=>binding.name===name)?.text!==vars[name]))throw Error('Reviewed importer flags were not published');
}

export function pausedImportConfiguration(config) {
  if(config?.name!=='qamous-import'||config?.main!=='src/import-host.mjs'||!['true','false'].includes(config.vars?.PUBLIC_READ_ONLY))throw Error('A reviewed importer configuration is required');
  return {...config,vars:{...config.vars,PUBLIC_READ_ONLY:'true'},triggers:{...config.triggers,crons:[]}};
}

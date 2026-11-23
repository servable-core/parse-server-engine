// Collections in the engine database (the same MongoDB Parse Server uses). Plain collections,
// deliberately NOT Parse classes - see ./index.js.
export const COLLECTIONS = Object.freeze({
  schema: 'servable_schema_states',
  seed: 'servable_seed_states',
  config: 'servable_config_states',
  // The last completed Parse schema migration (schemaMigration/): the engine's own, not part of the server's contract.
  parseSchema: 'servable_parse_schema_states',
})

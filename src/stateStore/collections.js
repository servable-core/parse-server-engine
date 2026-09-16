// Collections in the engine database (the same MongoDB Parse Server uses). Plain collections,
// deliberately NOT Parse classes - see ./index.js.
export const COLLECTIONS = Object.freeze({
  schema: 'servable_schema_states',
  seed: 'servable_seed_states',
  config: 'servable_config_states',
})

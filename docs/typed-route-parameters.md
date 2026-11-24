# Typed route parameters

Design note, 2026-11-23 (owner's Q1230 a and Q1375 a). A route reads each query string parameter as the type it declares,
once, before its handler, instead of the engine guessing a type from the value.

## The problem

Express parsed every query string through the engine's parser (`src/createapp/index.js`), which turned number-looking
text into numbers and the exact words `true` and `false` into booleans, whatever the route expected:

- a slug, a search term or an id `123` reached the handler as the number 123, and `'007'` as 7;
- `FALSE`, `no`, `off`, `0` and `1` were not booleans, so `?includeContentLive=no` read as yes;
- about forty backend/main routes repeated `x === true || x === 'true'` by hand, and backend/main added
  `app/lib/booleanParamOf.js` as a stopgap.

Routes already had a place for types, `schema.queryString`, copied from Fastify's shape, but nothing read it.

## The design

### Declaration (`src/register/route/parameters/declaration.js`)

`schema.queryString` maps each parameter to its declaration, in JSON Schema's words, or a shorthand:

```js
schema: {
  queryString: {
    id: 'string',                                   // the type alone
    ids: 'string[]',                                // a list of that type
    includeContentLive: { type: 'boolean', default: false },
    pageSize: { type: 'integer', default: 10, minimum: 1, maximum: 100 },
    sort: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
    slug: { type: 'string', isRequired: true, maxLength: 200 },
    filter: { type: 'object', properties: { status: 'string', isPinned: 'boolean' } },
    payload: 'any',                                 // free-form: as sent, nothing read into it
    legacy: 'guessed',                              // the former guess, kept on purpose
    '*': 'guessed',                                 // every parameter the route does not name
  },
}
```

Types: `boolean`, `integer`, `number`, `string`, `array` (`items`, `minItems`, `maxItems`), `object` (`properties`),
`any`, `guessed`. Words of every type: `default`, `enum`, `isRequired`, `description`; `minimum`/`maximum` for numbers,
`minLength`/`maxLength` for strings. `isRequired` is a flag on the parameter (the engine's naming rule, like
`ensuredIndexes`' `isUnique`), not JSON Schema's list on the object.

The declaration is compiled once, when the route is defined. What cannot be read is logged then
(`[ENGINE] [route parameters] GET v1/x: schema.queryString "pageSize": "defaultValue" is not a word of a number
declaration and is ignored; did you mean "default"?`) and never fails the boot: an unknown type leaves the parameter
undeclared, an unknown word is ignored, a default that breaks its own declaration is dropped.

### Reading (`coercion.js`, `index.js`)

`src/register/route/index.js` builds one reader per route; `process/http.js` and `verbs/function/processFunction.js` call
it first, before the user is resolved, and hand the handler the result as both `params` and `request.query`.

| Type | Accepted text | Refused |
| --- | --- | --- |
| boolean | `true 1 yes on` / `false 0 no off`, any case, spaces around ignored | anything else, several values |
| integer | optional sign and digits, a safe integer | `1.5`, `0x10`, `1e3`, out of range |
| number | decimal (`-1.5`, `.5`, `2e3`), finite | `Infinity`, `NaN`, `1,5` |
| string | the text as sent, never converted | several values (`a=1&a=2`) |
| array | `a=1&a=2`, `a[]=1`, `a[0]=1`, one value making a list of one; each item read as `items` (text when absent) | an item that is not of its type |
| object | `filter.status=live`; declared properties read as declared, the others kept as text | a plain value |
| any | whatever qs made of it, text | nothing |
| guessed | the former guess | nothing |

An empty value (`?limit=` or `?limit`) is no value for every type but `string` and `any`: the default applies. Defaults
are copied per request, so a handler changing a list never changes the next request's.

**Refused, not defaulted.** A value that cannot be read, or a required one missing, answers 400
`{ "error": "Invalid query string: \"isDraft\" must be true or false (also 1/0, yes/no, on/off), got \"maybe\"; …" }`,
every parameter at fault named, and the handler never runs. Falling back to the default was the alternative: a client
that sends `limit=abc` has a bug, and a plausible answer built on the default would hide it. The 400 goes through the
error path `processHttp` already had (`{ error }`, marked so the route cache never keeps it).

Nothing under a declared parameter is guessed: an array without `items` holds text, an object's undeclared properties
are text.

### Undeclared parameters, and the options (`src/options/index.js`)

| Option | Variable | Default | What it does |
| --- | --- | --- | --- |
| `isQueryValueGuessingEnabled` | `SERVABLE_QUERY_VALUE_GUESSING` | on | A parameter no route declares (no entry, no `'*'`) is guessed as before; off, it is the text the client sent. Also what Express's `request.query` holds everywhere on the app. |
| `areDeclaredRouteParametersTyped` | `SERVABLE_TYPED_ROUTE_PARAMETERS` | on | The kill switch: off, every declaration is ignored and every parameter read as undeclared (exactly the former behaviour while guessing is on). |
| `areUndeclaredParameterRoutesRefused` | `SERVABLE_REFUSE_UNDECLARED_PARAMETER_ROUTES` | off | With guessing off, defining a route that seems to read its parameters and declares none throws, so the boot stops. |

Typed parameters are opt-in per route: a route without `schema.queryString` reads its query string exactly as before.
The guess itself is unchanged: `createQueryParser` parses with qs (`allowDots`) and guesses values afterwards; a property
test (`tests/unit/routeParameters.test.js`, 2000 generated query strings) proves it equal to the former decoder. Two
corner cases of the former parser are not kept, both on keys: a key `0` or `false` was dropped, and a key `1.50` became
`1.5`; values are identical.

### Boot report (`bootReport.js`)

Every route defined without `schema.queryString` is recorded with whether its handler seems to read its parameters
(its source mentions `params` or `.query`: it finds a handler that destructures them, it misses one that reads them only
in code elsewhere). One summary line is written once the definitions pause (an unref'd timer: the engine does not know
when the app has defined its last route), and `Servable.App.Route.undeclaredParameterRoutes()` answers the list. An app
that turns guessing off should declare every route (`queryString: {}` when it reads nothing) and check the full list:
backend/main's guard applies that rule to its files (`testing/routeParametersDeclared.guard.spec.js`).

### Not in scope

- **The body.** Route verbs hand POST bodies raw (`bodyParser.raw`) and apps parse them; a JSON body already carries
  types. Declaring and reading `schema.body` would make the engine parse bodies: left out by decision (owner's Q1372 a,
  2026-11-23); a body design gets its own step if it is ever needed.
- **Treating the text `undefined` or `null` as no value.** Sent for a declared boolean or number, it is refused with a
  400 like any value that cannot be read (owner's Q1373 a, 2026-11-23): it is a client bug the guess used to hide, and the client is fixed. A
  declared string keeps it as the text sent. Pinned by `tests/unit/routeParameters.test.js`.
- **Path parameters** (`request.params`): no Servable route uses Express path patterns today.
- `schema.response` is still documentation only.

## Cost

Measured on the owner's Mac (Node 22) with backend/main's explore request (15 values, nested `targets[0].type` and
`filters[1].value`):

| | per request |
| --- | --- |
| former parser (qs with the guessing decoder) | 32.8 µs median |
| new parser, guessing on | 29.7 µs |
| new parser, guessing off | 31.6 µs |
| the guessing step alone, on an already parsed query | 1.0 µs |
| the typed reader of a route that declares explore's parameters | 25.4 µs |
| a whole GET through Express and processHttp | 220-300 µs median, noise ±80 µs between identical runs |
| a POST with a 93 KB JSON body | 500-690 µs median, the same with guessing on or off |

The guess costs about a microsecond a request; parsing the query string is the cost, and it is paid once either way
(Express's `request.query` is a getter in Express 5, parsed only when something reads it; a route reads its own copy).
The body never goes through the query parser. Turning guessing off is a correctness choice, not a performance one.

## Migration (an app)

1. Upgrade the engine. Nothing changes for a route that declares nothing. **A route that already has a
   `schema.queryString` is now honoured**: check those first (backend/main's were boilerplate: `id: { type: 'string' }`
   on routes that read `slug`, `defaultValue` instead of `default`). The boot log lists every word the engine cannot read.
2. Declare each route's parameters. Where a handler hands `params` on whole and its reads cannot all be named, declare
   the ones it can and add `'*': 'guessed'`; that list is the remaining work.
3. Remove the hand parsing the engine now does (`x === true || x === 'true'` becomes `x === true` for a declared boolean;
   a test that only compares to the text `'true'` would break, since the handler now gets `true`).
4. When every route declares, set `isQueryValueGuessingEnabled: false` and guard it in the app's tests.
5. In the next major the default of `isQueryValueGuessingEnabled` becomes off.

backend/main's patch, made this way with a codemod and checked on a copy: `.docs/technical/typed-route-params-backend-main.patch`
(workspace root).

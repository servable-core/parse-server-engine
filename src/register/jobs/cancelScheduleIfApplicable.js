
// @ts-nocheck - dead code (found via checkJs, lucide/PEAKUB DX initiative): its only import
// (register/jobs/index.js) is commented out, and `agenda` here is a bare, undefined reference -
// no import, no parameter - so calling this as written would throw a ReferenceError regardless.
// The real `agenda` instance lives as a local inside `jobs/index.js`'s `item.define` closure
// (`const agenda = new Agenda({...})`); resurrecting this function for real use would need that
// instance threaded in as a parameter, not left as an assumed-global.
export default async ({ name }) => {
  if (!name) {
    return
  }

  // eslint-disable-next-line no-undef -- see the dead-code note above; already known.
  const jobs = await agenda.jobs({ name })
  if (jobs && jobs.length) {
    // eslint-disable-next-line no-undef -- see the dead-code note above; already known.
    await agenda.cancel({ name })
  }
}

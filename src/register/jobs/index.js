
// import cancelScheduleIfApplicable from './cancelScheduleIfApplicable.js'


export default ({ servableConfig }) => {
  const item = {}
  item.define = async (payload) => {
    const {
      id,
      handler,
      // name,
      name: _name,
      cron,
      defaultConcurrency,
      processEvery,
      maxConcurrency,
      defaultLockLimit,
      lockLimit,
      defaultLockLifetime,
      ensureIndex,
      sort,
      priority = 'high',
      concurrency = 10,
      timeZone,
      attributes = {},
      onComplete,
      runOnInit = false
    } = payload


    const name = id

    // await cancelScheduleIfApplicable({ name, })

    const options = { priority, concurrency }

    const Agenda = (await import('@hokify/agenda')).default.Agenda
    const humanInterval = (await import('human-interval')).default
    const agenda = new Agenda({
      db: {
        address: servableConfig.configurations[0].config.parse.databaseURI
      }
    });
    agenda.define(name, handler, options,)

    const when = cron // humanInterval(cron)

    await agenda.start()
    await agenda.every(when, name, { id, ...attributes })
    // switch (whenType) {
    //   case 'once': {
    //     await agenda.schedule(when, name, { id, ...attributes })
    //     break
    //   }
    //   case 'repeat': {
    //     await agenda.every(cron, name, { id, ...attributes })
    //     break
    //   }
    //   default:
    //     break
    // }
  }

  return item
}

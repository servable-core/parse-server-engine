
export default async ({ name }) => {
  if (!name) {
    return
  }

  const jobs = await agenda.jobs({ name })
  if (jobs && jobs.length) {
    await agenda.cancel({ name })
  }
}

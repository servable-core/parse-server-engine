import { launchServable } from "../../src"

test('servable launches', async () => {

  const servableEngineConfig =
  {
    id: 'test-app'
  }

  await launchServable({ servableEngineConfig })
})

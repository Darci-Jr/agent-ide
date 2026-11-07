// Teste pontual: abre o app já com o ambiente "loja" e vai direto ao que mudou.
// Copie este arquivo nesta pasta (as cópias não vão para o Git) e rode:
//   npm run e2e:pontual -- e2e/pontual/<arquivo>.mjs [--visivel]
// A verificação que deve ficar vai também para o smoke.mjs, que roda antes do push.
import { button, check, finish, launch, openLoja, prepare, shot } from '../app.mjs'

const dirs = prepare()
const { app, page } = await launch(dirs)
await openLoja(page)

check('o ambiente abre com uma sessão', (await page.locator('.environment:visible .terminal-panel').count()) === 1)
check('a barra lateral oferece o Git', await button(page, 'Git').isVisible())
await shot(page, 'pontual')

await finish(app, dirs)

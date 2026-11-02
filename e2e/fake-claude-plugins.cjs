// Imita `claude plugin list|enable|disable --json` para o e2e, sem mexer nos plugins de verdade.
// O estado fica no arquivo indicado por AGENT_IDE_TEST_PLUGIN_STATE.
const fs = require('fs')
const statePath = process.env.AGENT_IDE_TEST_PLUGIN_STATE
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const [, , group, action, id] = process.argv
if (group !== 'plugin') process.exit(1)
if (action === 'list') {
  process.stdout.write(JSON.stringify(state.plugins))
  process.exit(0)
}
const plugin = state.plugins.find((p) => p.id === id)
const goal = action === 'enable'
if (!plugin) {
  console.log(JSON.stringify({ command: action, outcome: 'failed', message: `Plugin "${id}" not found` }))
  process.exit(1)
}
if (plugin.enabled === goal) {
  console.log(JSON.stringify({ command: action, outcome: 'failed', alreadyInGoalState: true, message: 'already' }))
  process.exit(1)
}
plugin.enabled = goal
fs.writeFileSync(statePath, JSON.stringify(state))
console.log(JSON.stringify({ command: action, outcome: 'ok', pluginId: id, scope: plugin.scope, message: 'ok' }))

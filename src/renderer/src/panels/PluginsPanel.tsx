import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { PluginInfo, PluginItem } from '../../../shared/types'
import { useEnv } from '../context'
import { IconButton } from '../icons'
import { errorMessage, ide } from '../ide'

function Items(props: { label: string; items: PluginItem[] }): ReactNode {
  if (props.items.length === 0) return null
  return (
    <div className="plugin-items">
      <span>{props.label}</span>
      <ul>
        {props.items.map((item) => (
          <li key={item.name} data-tip={item.description || undefined}>
            {item.name}
          </li>
        ))}
      </ul>
    </div>
  )
}

const summary = (p: PluginInfo): string =>
  [
    p.skills.length && `${p.skills.length} ${p.skills.length === 1 ? 'skill' : 'skills'}`,
    p.commands.length && `${p.commands.length} ${p.commands.length === 1 ? 'comando' : 'comandos'}`,
    p.agents.length && `${p.agents.length} ${p.agents.length === 1 ? 'agente' : 'agentes'}`,
    p.mcpServers.length && `MCP: ${p.mcpServers.join(', ')}`,
    p.hasHooks && 'hooks'
  ]
    .filter(Boolean)
    .join(' · ')

export function PluginsPanel(): ReactNode {
  const { projectCwd: cwd, claudeSessions, pluginsChangedAt, markPluginsChanged } = useEnv()
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [dismissedAt, setDismissedAt] = useState(0)

  const load = useCallback(() => {
    setError(null)
    ide.listPlugins(cwd).then(setPlugins, (err) => setError(errorMessage(err)))
  }, [cwd])
  useEffect(load, [load])

  const toggle = async (plugin: PluginInfo): Promise<void> => {
    setBusy(plugin.id)
    setError(null)
    try {
      await ide.setPluginEnabled(cwd, plugin.id, !plugin.enabled)
      markPluginsChanged()
      setPlugins(await ide.listPlugins(cwd))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  // Sessões que já rodavam quando o plugin mudou: só aplicam depois de reiniciar ou recarregar.
  const stale = pluginsChangedAt > dismissedAt ? claudeSessions.filter((s) => s.startedAt < pluginsChangedAt) : []
  const enabled = plugins?.filter((p) => p.enabled) ?? []
  const disabled = plugins?.filter((p) => !p.enabled) ?? []

  const row = (p: PluginInfo): ReactNode => (
    <li key={p.id} className={`plugin ${p.enabled ? '' : 'off'}`}>
      <div className="plugin-head">
        <input
          type="checkbox"
          role="switch"
          aria-label={`${p.enabled ? 'Desativar' : 'Ativar'} ${p.name}`}
          data-tip={p.enabled ? 'Desativar' : 'Ativar'}
          checked={p.enabled}
          disabled={busy !== null}
          onChange={() => void toggle(p)}
        />
        <button type="button" className="plugin-name" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
          <strong>{p.name}</strong>
          <span>{summary(p)}</span>
        </button>
        <span className="plugin-meta" data-tip={`${p.marketplace}, escopo ${p.scope}`}>
          {/^[0-9a-f]{10,}$/.test(p.version) ? p.version.slice(0, 7) : p.version}
        </span>
      </div>
      {p.errors.length > 0 && <p className="plugin-error">{p.errors.join(' ')}</p>}
      {open === p.id && (
        <div className="plugin-details">
          {p.description && <p>{p.description}</p>}
          <Items label="Skills" items={p.skills} />
          <Items label="Comandos" items={p.commands} />
          <Items label="Agentes" items={p.agents} />
          <Items label="MCP" items={p.mcpServers.map((name) => ({ name, description: '' }))} />
        </div>
      )}
    </li>
  )

  return (
    <div className="plugins-panel">
      <div className="plugins-toolbar">
        <span>{plugins ? `${enabled.length} de ${plugins.length} ativos` : 'Carregando...'}</span>
        <IconButton icon="refresh" label="Atualizar lista" onClick={load} />
      </div>
      {stale.length > 0 && (
        <div className="plugins-notice" role="status">
          <span>
            Plugins alterados. Para aplicar, reinicie ou rode <code>/reload-plugins</code> em: {stale.map((s) => s.title).join(', ')}.
          </span>
          <IconButton icon="close" label="Dispensar aviso" onClick={() => setDismissedAt(Date.now())} />
        </div>
      )}
      {error && (
        <p className="plugin-error" role="alert">
          {error}
        </p>
      )}
      {plugins && (
        <div className="plugins-list">
          {enabled.length > 0 && (
            <>
              <h3>Ativos</h3>
              <ul>{enabled.map(row)}</ul>
            </>
          )}
          {disabled.length > 0 && (
            <>
              <h3>Desativados</h3>
              <ul>{disabled.map(row)}</ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

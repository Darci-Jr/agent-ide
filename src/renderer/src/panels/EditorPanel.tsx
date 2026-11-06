import type { IDockviewPanelProps } from 'dockview-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { FilePanelParams, ProtectionStatus } from '../../../shared/types'
import { useEnv } from '../context'
import { IconButton } from '../icons'
import { errorMessage, ide } from '../ide'
import { languageOf, monaco } from '../monaco'

export function EditorPanel({ params, api }: IDockviewPanelProps<FilePanelParams>): ReactNode {
  const { env, theme, setDirty, toast } = useEnv()
  const { path } = params
  const cwd = params.root ?? env.cwd
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const mtime = useRef<number | null>(null)
  const saveRef = useRef<(force?: boolean) => void>(() => {})
  const [dirty, setLocalDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [protection, setProtection] = useState<ProtectionStatus | null>(null)

  const markDirty = useCallback(
    (value: boolean) => {
      setLocalDirty(value)
      setDirty(api.id, value)
    },
    [api.id, setDirty]
  )

  const load = useCallback(async () => {
    if (!path) return
    try {
      const file = await ide.readFile(cwd, path)
      mtime.current = file.mtimeMs
      editor.current?.getModel()?.setValue(file.content)
      markDirty(false)
      setConflict(false)
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [cwd, markDirty, path])

  const save = useCallback(
    async (force = false) => {
      if (!path || !editor.current) return
      try {
        const result = await ide.writeFile(cwd, path, editor.current.getValue(), force ? null : mtime.current)
        if (result.status === 'conflict') {
          setConflict(true)
          return
        }
        mtime.current = result.mtimeMs
        markDirty(false)
        setConflict(false)
      } catch (err) {
        toast(errorMessage(err))
      }
    },
    [cwd, markDirty, path, toast]
  )
  saveRef.current = save

  useEffect(() => {
    if (!host.current || !path) return
    const model = monaco.editor.createModel('', languageOf(path))
    const instance = monaco.editor.create(host.current, {
      model,
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily: "'Cascadia Mono', Consolas, monospace",
      fontSize: 13,
      scrollBeyondLastLine: false
    })
    editor.current = instance
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
    let loading = true
    const changes = instance.onDidChangeModelContent(() => {
      if (!loading) markDirty(true)
    })
    void load().finally(() => {
      loading = false
    })
    return () => {
      changes.dispose()
      instance.dispose()
      model.dispose()
      editor.current = null
      setDirty(api.id, false)
    }
    // O editor é criado uma vez por caminho.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => {
    monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs')
  }, [theme])

  useEffect(() => {
    if (path) void ide.getProtection(cwd, path).then(setProtection, () => setProtection(null))
  }, [cwd, path])

  const block = async (): Promise<void> => {
    if (!path) return
    try {
      await ide.denyRead(cwd, path)
      setProtection(await ide.getProtection(cwd, path))
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  if (!path) return <div className="panel-empty">Abra um arquivo em Arquivos.</div>

  return (
    <div className="file-panel">
      <div className="file-head">
        <span className="file-path">{path}</span>
        {dirty && <span className="file-dirty">Não salvo</span>}
        <IconButton icon="check" label="Salvar (Ctrl+S)" onClick={() => void save()} />
      </div>
      {conflict && (
        <div className="banner warning" role="alert">
          <span>O arquivo mudou no disco</span>
          <button type="button" className="ghost" onClick={() => void load()}>
            Recarregar
          </button>
          <button type="button" className="primary" onClick={() => void save(true)}>
            Sobrescrever
          </button>
        </div>
      )}
      {protection?.sensitive && protection.canDeny && !protection.denied && (
        <div className="banner warning">
          <span>O Claude pode ler este arquivo</span>
          <button type="button" className="primary" onClick={() => void block()}>
            Bloquear
          </button>
        </div>
      )}
      {protection?.sensitive && protection.denied && <div className="banner ok">Leitura bloqueada para o Claude</div>}
      {error && <div className="banner warning">{error}</div>}
      <div ref={host} className="monaco-host" />
    </div>
  )
}

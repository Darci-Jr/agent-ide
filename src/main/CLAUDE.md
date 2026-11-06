# Processo principal

## Onde ficam os dados

- `userData/config.json`: guarda o caminho da pasta de trabalho e o último lugar onde um projeto foi criado. Ao lado ficam `preferencias.json`, `uso-claude.json`, `comandos.json` (comandos gerais) e os arquivos da linha de status (`statusline.cjs`, `claude-settings/`).
- Pasta de trabalho: `Ambientes/` (um JSON por ambiente salvo), `Temporarios/` (rascunhos), `projetos.json`, `abas.json` (abas abertas) e `comandos.json` (comandos por projeto). Comandos nunca ficam no repositório: um projeto baixado não pode trazer botões que executam algo.

Quem instala ou testa o app usa perfil próprio: nos testes, defina `AGENT_IDE_USER_DATA`. Os diálogos são substituídos por `AGENT_IDE_TEST_WORKSPACE`, `AGENT_IDE_TEST_DIRECTORY`, `AGENT_IDE_TEST_PROJECT_PARENT` e `AGENT_IDE_TEST_EXCHANGE_FILE`. `AGENT_IDE_TEST_PLUGIN_CLI` troca o `claude plugin` por `e2e/fake-claude-plugins.cjs`: o e2e nunca deve mexer nos plugins de verdade.

## Regras de segurança

- **Arquivos:** toda leitura e escrita passa por `resolveAllowed` em `files.ts`, que limita ao projeto e a `~/.claude`, mesmo com symlinks.
- **Segredos:** nada de cópias, histórico ou telemetria com o conteúdo de arquivos. Gravações usam `writeAtomic`, que não deixa temporários.
- **Salvar:** respeite `expectedMtimeMs` para nunca sobrescrever uma mudança do agente sem avisar.
- **Importar ambientes:** o arquivo não é confiável. `exchange.ts` aceita só agentes conhecidos, nunca comandos, recusa caminhos fora do projeto, e nenhuma sessão inicia ao importar.
- **Exportar ambientes:** não pode levar caminhos da máquina, ids de sessão, conversas nem conteúdo de arquivos. Campo novo em `Environment` ou nos painéis: confira `exportEnvironment` e os testes.
- **Regra de `deny`:** bloqueia `Read` e foi negada também para `cat`, mas outras formas de ler o arquivo não foram testadas. Não a apresente como garantia absoluta.
- **Comandos personalizados:** o renderer só manda o id (`runCommandId`); o texto vem do `CommandStore` do projeto do ambiente.
- **Worktrees:** nunca apague automaticamente, e nunca copie `.env` para elas; só avise.

## Armadilhas

- **`@lydell/node-pty` (beta) no Windows:** não encontra `node` sem o caminho completo, e `pid` é sempre 0. O `kill` funciona. O painel de aplicações em execução vai precisar de outra forma de obter o processo.
- **Shim do npm:** `claude` é um `.cmd`, então precisa passar por `cmd.exe /c`.
- **Processo novo:** nasce com 120x30. O renderer precisa enviar o tamanho real depois de iniciar.

## Claude Code (formatos internos, podem mudar)

- **Variáveis herdadas:** `CLAUDE_CODE_CHILD_SESSION` desliga a gravação do transcript. `childEnv.ts` remove só os marcadores de sessão; as demais `CLAUDE_CODE_*` podem ser configuração do usuário. Marcador novo entra lá.
- **Transcript:** `~/.claude/projects/<caminho codificado>/<id>.jsonl`. Nomes de pasta podem coincidir entre projetos (`a-b` e `a b`), então o `cwd` da conversa é quem decide.
- **Retomar:** o transcript só existe depois da primeira mensagem. Sem ele, `--resume` falha; `adapters/claude.ts` recomeça com `--session-id`.
- **Uso e contexto:** vêm de `rate_limits` e `context_window` na entrada da linha de status, passada por `--settings` em `usage.ts`. Os limites só existem para assinantes, e os dois só depois da primeira resposta. No Windows o comando roda no Git Bash; `ELECTRON_RUN_AS_NODE=1` no próprio comando é necessário, ou o Electron abre como app e não lê a entrada.
- **Plugins:** use `claude plugin list|enable|disable --json` em vez de editar `enabledPlugins`. Sem `--scope`, ele grava no escopo que já decide sobre o plugin. `enable` e `disable` saem com código 1 quando já estava no estado pedido (`alreadyInGoalState`).
- **Cache do prompt:** a linha de status não informa. `cache.ts` lê o fim do transcript: a última resposta da conversa principal (sem `isSidechain`) marca o início, e `cache_creation.ephemeral_1h/5m_input_tokens` diz se dura 1 hora ou 5 minutos. Nos testes, `AGENT_IDE_TEST_TRANSCRIPTS` troca `~/.claude/projects`.
- **Transcript não serve para contexto e custo:** ele não informa o limite de contexto, repete o mesmo `message.id` em várias linhas (os tokens contariam quase três vezes) e grava `cost-state` raramente. Prefira a linha de status.

## Adaptadores

Outra CLI ou modelo local: implemente `AgentAdapter` em `adapters/types.ts` e registre em `adapters/index.ts`. `session:create` e o histórico hoje assumem Claude Code em partes: `history:open` fixa `adapterId: 'claude'`.

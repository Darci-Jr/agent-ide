# Processo principal

## Onde ficam os dados

- `userData/config.json`: guarda o caminho da pasta de trabalho e o último lugar onde um projeto foi criado. Ao lado ficam `preferencias.json`, `uso-claude.json`, `comandos.json` (comandos gerais) e os arquivos da linha de status (`statusline.cjs`, `claude-settings/`).
- Pasta de trabalho: `Ambientes/` (um JSON por ambiente), `Templates/` (um JSON por template), `projetos.json`, `abas.json` (abas abertas) e `comandos.json` (comandos por projeto). Comandos nunca ficam no repositório: um projeto baixado não pode trazer botões que executam algo.

Quem instala ou testa o app usa perfil próprio: nos testes, defina `AGENT_IDE_USER_DATA`. Os diálogos são substituídos por `AGENT_IDE_TEST_WORKSPACE`, `AGENT_IDE_TEST_DIRECTORY`, `AGENT_IDE_TEST_PROJECT_PARENT` e `AGENT_IDE_TEST_EXCHANGE_FILE`. `AGENT_IDE_TEST_PLUGIN_CLI` troca o `claude plugin` por `e2e/fake-claude-plugins.cjs`: o e2e nunca deve mexer nos plugins de verdade. `AGENT_IDE_TEST_HIDDEN=1` abre a janela fora da tela, sem foco nem barra de tarefas; ela continua desenhando, então capturas e cliques funcionam.

## Regras de segurança

- **Arquivos:** toda leitura e escrita passa por `resolveAllowed` em `files.ts`, que limita ao projeto e a `~/.claude`, mesmo com symlinks.
- **Segredos:** nada de cópias, histórico ou telemetria com o conteúdo de arquivos. Gravações usam `writeAtomic`, que não deixa temporários.
- **Salvar:** respeite `expectedMtimeMs` para nunca sobrescrever uma mudança do agente sem avisar.
- **Importar templates:** o arquivo não é confiável. `parseTemplateFile` aceita só agentes conhecidos, nunca comandos, e recusa caminhos fora do projeto. Projetos vêm pelo nome; os que faltam, a pessoa aponta a pasta.
- **Templates:** não podem levar caminhos da máquina, ids de sessão, conversas nem conteúdo de arquivos. Campo novo em `Environment`, nas sessões ou nos painéis: confira `templateLayout` (`exchange.ts`), `templateFromEnvironment` e os testes.
- **Temporários:** não existem mais. `EnvironmentStore` apaga os de versões anteriores (`Temporarios/` e `draft: true`) ao carregar.
- **Regra de `deny`:** bloqueia `Read` e foi negada também para `cat`, mas outras formas de ler o arquivo não foram testadas. Não a apresente como garantia absoluta.
- **Comandos personalizados:** o renderer só manda o id (`runCommandId`); o texto vem do `CommandStore` do projeto do ambiente.
- **Worktrees:** nunca apague automaticamente, e nunca copie `.env` para elas; só avise.

## Armadilhas

- **Menu nativo:** o padrão do Electron tem Ctrl+R (recarregar) e Ctrl+W (fechar), que valem mesmo com o foco no terminal. `menu.ts` tira o menu no Windows e no Linux e monta um próprio no Mac, sem esses atalhos.
- **PATH no Mac e no Linux:** app aberto pelo Dock ou pelo menu não recebe o PATH do terminal. `shellEnv.ts` lê o do shell de login ao abrir; os testes não passam por ele.
- **Pacote Intel do Mac:** o CI roda em Apple Silicon, e o npm só instala o `node-pty` do processador da máquina. O workflow instala também o `darwin-x64` antes de empacotar.
- **Linux no CI:** o Ubuntu 24 bloqueia o sandbox do Electron; o CI libera com `sysctl kernel.apparmor_restrict_unprivileged_userns=0` e roda o e2e com `xvfb-run`. Quem usa o AppImage no Ubuntu 24 em diante tem o mesmo bloqueio (o `.deb` não); o WSL não tem, então não reproduz.
- **Caminhos com atalho:** compare pelo caminho real (`realpathSync.native`). No Mac, `/var` é `/private/var`, e o Git devolve o caminho já resolvido.

- **Pasta de dados:** fixada em `%APPDATA%/agent-ide` no início de `index.ts`. Com o `productName` do instalador ("Agent IDE"), o Electron usaria outra pasta e quem já usava perderia a pasta de trabalho, as preferências e os comandos gerais.
- **`NODE_ENV`:** o `electron-vite preview` define `production` e os terminais herdariam; um `npm install` neles pularia as dependências de desenvolvimento. Fora do app empacotado, `index.ts` apaga a variável.
- **Atualizador:** só liga no app empacotado e fora dos testes (`AGENT_IDE_TEST_UPDATES=1` liga de propósito em `e2e/packaged.mjs`). O `node-pty` vai em `asarUnpack` no `electron-builder.yml`, ou o terminal não carrega no app instalado.

- **`@lydell/node-pty` (beta) no Windows:** não encontra `node` sem o caminho completo, e `pid` é sempre 0. O `kill` funciona. O painel de aplicações em execução vai precisar de outra forma de obter o processo.
- **Shim do npm:** `claude` é um `.cmd`, então precisa passar por `cmd.exe /c`.
- **Processo novo:** nasce com 120x30. O renderer precisa enviar o tamanho real depois de iniciar.

## Claude Code (formatos internos, podem mudar)

- **Variáveis herdadas:** `CLAUDE_CODE_CHILD_SESSION` desliga a gravação do transcript. `childEnv.ts` remove só os marcadores de sessão; as demais `CLAUDE_CODE_*` podem ser configuração do usuário. Marcador novo entra lá.
- **Transcript:** `~/.claude/projects/<caminho codificado>/<id>.jsonl`. Nomes de pasta podem coincidir entre projetos (`a-b` e `a b`), então o `cwd` da conversa é quem decide.
- **Retomar:** o transcript só existe depois da primeira mensagem. Sem ele, `--resume` falha; `adapters/claude.ts` recomeça com `--session-id`.
- **Uso e contexto:** vêm de `rate_limits` e `context_window` na entrada da linha de status, passada por `--settings` em `usage.ts`. Os limites só existem para assinantes, e os dois só depois da primeira resposta. No Windows o comando roda no Git Bash; `ELECTRON_RUN_AS_NODE=1` no próprio comando é necessário, ou o Electron abre como app e não lê a entrada.
- **Plugins:** use `claude plugin list|enable|disable --json` em vez de editar `enabledPlugins`. Sem `--scope`, ele grava no escopo que já decide sobre o plugin. `enable` e `disable` saem com código 1 quando já estava no estado pedido (`alreadyInGoalState`).
- **`/clear` e `/resume`:** a conversa troca de id e de transcript, e a sessão da IDE não. A linha de status recebe `session_id` e `transcript_path` já logo após o `/clear` e os grava em `contexto/<sessão>.conversa`, e o processo principal guarda o id em `conversationId`. Para retomar, ler o transcript ou achar a sessão de uma conversa, use `conversationId ?? id`, nunca só o `id`.
- **Cache do prompt:** a linha de status não informa. `cache.ts` lê o fim do transcript: a última resposta da conversa principal (sem `isSidechain`) marca o início, e `cache_creation.ephemeral_1h/5m_input_tokens` diz se dura 1 hora ou 5 minutos. Nos testes, `AGENT_IDE_TEST_TRANSCRIPTS` troca `~/.claude/projects` para o cache, os tokens e o histórico, mas não para o adaptador, porque quem retoma é o Claude Code real.
- **Transcript e linha de status:** o transcript não informa o limite de contexto (use a linha de status), e repete o mesmo `message.id` em várias linhas: `tokens.ts` fica com uma por resposta, ou os tokens contariam quase três vezes. A linha de status só traz os tokens do contexto atual, não o total da sessão. Seu `cost.total_cost_usd` veio 0 numa conta de assinatura.
- **Linha de status nova:** tem um objeto `prompt_cache` (`ttl`, `expires_at`) que poderia substituir a leitura do transcript em `cache.ts`. Não foi testado.

## Adaptadores

Outra CLI ou modelo local: implemente `AgentAdapter` em `adapters/types.ts` e registre em `adapters/index.ts`. `session:create` e o histórico hoje assumem Claude Code em partes: `history:open` fixa `adapterId: 'claude'`.

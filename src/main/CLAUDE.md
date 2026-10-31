# Processo principal

## Onde ficam os dados

- `userData/config.json`: guarda só o caminho da pasta de trabalho.
- Pasta de trabalho: `Projetos/`, `Ambientes/` (um JSON por ambiente salvo), `Temporarios/` (rascunhos) e `projetos.json`.

Quem instala ou testa o app usa perfil próprio: nos testes, defina `AGENT_IDE_USER_DATA`. Os diálogos são substituídos por `AGENT_IDE_TEST_WORKSPACE`, `AGENT_IDE_TEST_DIRECTORY` e `AGENT_IDE_TEST_EXCHANGE_FILE`.

## Regras de segurança

- **Arquivos:** toda leitura e escrita passa por `resolveAllowed` em `files.ts`, que limita ao projeto e a `~/.claude`, mesmo com symlinks.
- **Segredos:** nada de cópias, histórico ou telemetria com o conteúdo de arquivos. Gravações usam `writeAtomic`, que não deixa temporários.
- **Salvar:** respeite `expectedMtimeMs` para nunca sobrescrever uma mudança do agente sem avisar.
- **Importar ambientes:** o arquivo não é confiável. `exchange.ts` aceita só agentes conhecidos, nunca comandos, recusa caminhos fora do projeto, e nenhuma sessão inicia ao importar.
- **Exportar ambientes:** não pode levar caminhos da máquina, ids de sessão, conversas nem conteúdo de arquivos. Campo novo em `Environment` ou nos painéis: confira `exportEnvironment` e os testes.
- **Regra de `deny`:** bloqueia `Read` e foi negada também para `cat`, mas outras formas de ler o arquivo não foram testadas. Não a apresente como garantia absoluta.
- **Worktrees:** nunca apague automaticamente, e nunca copie `.env` para elas; só avise.

## Armadilhas

- **`@lydell/node-pty` (beta) no Windows:** não encontra `node` sem o caminho completo, e `pid` é sempre 0. O `kill` funciona. O painel de aplicações em execução vai precisar de outra forma de obter o processo.
- **Shim do npm:** `claude` é um `.cmd`, então precisa passar por `cmd.exe /c`.
- **Processo novo:** nasce com 120x30. O renderer precisa enviar o tamanho real depois de iniciar.

## Claude Code (formatos internos, podem mudar)

- **Variáveis herdadas:** `CLAUDE_CODE_CHILD_SESSION` desliga a gravação do transcript. `childEnv.ts` remove só os marcadores de sessão; as demais `CLAUDE_CODE_*` podem ser configuração do usuário. Marcador novo entra lá.
- **Transcript:** `~/.claude/projects/<caminho codificado>/<id>.jsonl`. Nomes de pasta podem coincidir entre projetos (`a-b` e `a b`), então o `cwd` da conversa é quem decide.
- **Retomar:** o transcript só existe depois da primeira mensagem. Sem ele, `--resume` falha; `adapters/claude.ts` recomeça com `--session-id`.

Para contexto e custo, medido em transcripts reais:

- Uma resposta ocupa várias linhas com o mesmo `message.id`. Some por id, nunca por linha, ou os tokens contam quase três vezes.
- O registro `cost-state` traz o custo, mas é gravado raramente, então o valor fica defasado. Mostre essa defasagem.
- O transcript não informa o limite de contexto do modelo. Não invente uma porcentagem.

## Adaptadores

Outra CLI ou modelo local: implemente `AgentAdapter` em `adapters/types.ts` e registre em `adapters/index.ts`. `session:create` e o histórico hoje assumem Claude Code em partes: `history:open` fixa `adapterId: 'claude'`.

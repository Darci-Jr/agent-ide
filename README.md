# Agent IDE

IDE centrada em agentes de código. Em vez de um editor com um chat ao lado, cada projeto
tem ambientes de trabalho que você monta conforme a tarefa: várias sessões em grade, ou
uma sessão ao lado de um documento para pensar junto com o agente.

Hoje funciona com o Claude Code e com qualquer CLI rodando em uma sessão de terminal comum.
Testado apenas no Windows.

## O que faz

- **Pasta de trabalho:** escolhida uma vez, no primeiro uso. Guarda só os dados da IDE:
  `Ambientes`, `Temporarios`, a lista de projetos e os comandos. Prefira uma pasta fora de
  repositórios Git; a IDE avisa se não for.
- **Projetos:** crie um novo, escolhendo onde a pasta dele fica, ou adicione uma pasta existente.
  Toda sessão parte de um projeto.
- **Histórico:** as conversas do Claude Code de cada projeto, com a opção de restaurar a última.
- **Sessão rápida:** só escolha o projeto. Ela fica em um ambiente temporário até você fechar a
  aba, e pode ser salva como ambiente a qualquer momento.
- **Ambientes:** abas com layout e sessões próprios, criadas do zero ou a partir de outros
  ambientes salvos. Exporte um ambiente para um arquivo e compartilhe com o time.
- **Sessões em paralelo:** cada uma em um terminal real, com worktree Git opcional. Destaque
  uma e volte para a grade sem reiniciar nada.
- **Layout livre:** arraste, divida e agrupe painéis. O layout volta quando você reabre o app.
- **Arquivos:** árvore do projeto, busca por nome e editor, incluindo arquivos que o Git
  ignora, como `.env`.
- **Markdown:** visualização que acompanha as mudanças do agente no arquivo.
- **Temas:** claro e escuro.

## Segredos

Editar um `.env` aqui evita que o valor passe pela conversa com o agente, mas o agente ainda
poderia abrir o arquivo no disco. Por isso o editor oferece **Bloquear**, que adiciona
`Read(./caminho)` ao `deny` de `.claude/settings.local.json`. A regra vale para o Claude Code;
outros agentes têm controles próprios. Ela não é uma barreira absoluta: um comando que leia o
arquivo por outro caminho pode não ser reconhecido. Para garantia maior, mantenha o agente em
modo que peça confirmação de comandos.

O app não cria cópias, histórico nem telemetria do conteúdo dos arquivos. O arquivo de um
ambiente exportado não leva segredos, conteúdo de arquivos, conversas nem caminhos da máquina.
Ao importar, o arquivo é validado e nenhuma sessão começa sozinha.

## Desenvolvimento

Requer Node.js 24.

```sh
npm install
npm run dev        # abre o app com recarga automática
npm test           # testes de unidade
npm run typecheck
npm run e2e        # percorre o app real, sem consumir tokens
node e2e/claude-real.mjs   # usa um Claude Code real e consome alguns tokens; faça o build antes
```

Para outra CLI ou um modelo local, implemente `AgentAdapter` (`src/main/adapters/types.ts`) e
registre-o em `src/main/adapters/index.ts`.

## Licença

MIT

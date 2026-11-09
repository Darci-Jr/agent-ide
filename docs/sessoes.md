# Sessões

[← Voltar ao início](../README.md)

Cada sessão roda a CLI real do agente em um terminal de verdade. A IDE não reimplementa o
agente: comandos, atalhos, plugins e configurações do Claude Code funcionam como no seu terminal.

## Tipos de sessão

A barra lateral tem uma ação para cada:

- **Nova sessão** do Claude no projeto da sessão em uso.
- **Terminal** na pasta da sessão em uso.
- **Sessão em worktree:** cria uma worktree Git e abre o Claude nela, para trabalhar em paralelo
  sem um agente pisar no outro. Veja [Git e worktrees](git.md).

Cada sessão mostra seu estado em texto: Ativa, Ociosa ou Parada. Fechar uma sessão ou terminal é
direto, sem confirmação.

## Retomada

- A IDE volta como estava: as mesmas abas, o mesmo layout e a mesma aba ativa, inclusive depois de
  uma queda.
- Sessões que rodavam são retomadas sozinhas, mas sem continuar a tarefa.
- Uma sessão que trabalhava quando foi encerrada mostra **Atenção** até você digitar nela ou
  dispensar.

## Histórico

A tela inicial lista as conversas do Claude Code de cada projeto. Abra uma para retomá-la numa
sessão própria.

A sessão segue a conversa: depois de um `/clear` ou `/resume`, ela retoma a conversa nova, mostra o
cache dela e aparece no histórico por ela. A conversa anterior continua no histórico.

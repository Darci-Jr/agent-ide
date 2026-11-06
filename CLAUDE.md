# Agent IDE

IDE desktop centrada em agentes de código (Electron, React e TypeScript). Roda a CLI real do agente em um terminal; não reimplementa o agente. O nome é provisório.

## Como trabalhar neste projeto

- **Mudança estrutural ou funcionalidade nova:** levante as decisões difíceis de reverter, traga uma recomendação e espere aprovação antes de escrever código. Responder perguntas de requisitos não é aprovação para implementar.
- **Interface nova:** ofereça um mockup antes de implementar.
- **Ações por ícone:** pouco texto na interface, sempre com descrição ao passar o mouse.
- **Commit e push:** só quando pedido. Confira o que entrou no commit: a pasta do repositório também pode ser a pasta de trabalho da IDE.
- **Idioma:** interface, comentários, commits e documentação em português do Brasil.

## Comandos

```sh
npm run typecheck
npm test                    # unidade
npm run e2e                 # compila e percorre o app real; abre janelas na tela
npm run dev                 # app com recarga automática
npm run start               # app compilado
npm run dist                # instalador em dist/, sem publicar
node e2e/packaged.mjs       # abre o app empacotado (depois do dist)
```

**Publicar uma versão:** suba `version` no `package.json`, faça o commit e envie a tag igual (`v0.2.0`). O GitHub Actions (`.github/workflows/release.yml`) confere a versão, roda typecheck e testes e publica o instalador na release. Quem tem o app instalado recebe a atualização dali. Só com pedido do usuário.

`node e2e/claude-real.mjs` usa um Claude Code real e **consome tokens**. Rode só de propósito e depois de `npm run build`, quando mexer em sessões, retomada ou histórico.

## Antes de dizer que terminou

1. Rode `npm run typecheck`, `npm test` e `npm run e2e`.
2. Olhe as capturas em `e2e/*.png`, porque os testes não avaliam aparência.
3. Teste a interação como o usuário faz. O botão central de nova sessão ficou quebrado porque o teste criava sessões por outro caminho e o clique real nunca era exercitado.

Toda funcionalidade nova ganha verificação em `e2e/smoke.mjs`.

## Manter estes arquivos atualizados

Atualizar os `CLAUDE.md` faz parte da tarefa: faça no mesmo commit da mudança que os afetou, sem esperar pedido. Antes de concluir, confira:

- **Algo aqui ficou falso?** Corrija ou apague. Isso vale para comandos, caminhos, nomes citados, decisões e próximos passos. Item concluído sai da lista.
- **Decisão nova do usuário?** Registre em "Decisões de produto", inclusive quando ela substituir outra.
- **Descobriu uma armadilha?** Anote se ela custou tempo e não dá para deduzir lendo o código. O que vale para uma área só vai em `src/main/CLAUDE.md` ou `src/renderer/CLAUDE.md`.
- **Instrução contradiz o código?** Confie no código, verifique e corrija o arquivo. Se a dúvida for sobre uma decisão de produto, pergunte ao usuário.
- **Formato interno do Claude Code:** ao mexer nessas partes, confira em um transcript real se o que está anotado continua valendo.

Mantenha os arquivos curtos: nada de histórico de mudanças, que fica no Git, nem descrição do que o código já mostra. Ao adicionar algo, veja se outro item pode sair.

## Mapa

- `src/shared/types.ts`: contrato entre os processos. Comece por aqui.
- `src/main/`: processos, arquivos, projetos, ambientes e histórico. Veja `src/main/CLAUDE.md`.
- `src/preload/index.ts`: expõe a API `window.ide`.
- `src/renderer/src/`: interface. Veja `src/renderer/CLAUDE.md`.

Um novo canal de IPC passa por três arquivos: `shared/types.ts`, `preload/index.ts` e `main/index.ts`.

## Decisões de produto

- Integração por terminal real, não por Agent SDK.
- O projeto é o centro: toda sessão parte de um projeto, e o histórico é por projeto.
- A pasta de trabalho é escolhida uma única vez e guarda só os dados da IDE. Escolher uma pasta dentro de um repositório Git só gera um aviso.
- Projeto novo nunca vai para dentro da pasta de trabalho: a pessoa dá o nome e escolhe onde criar, e o seletor abre no último lugar usado.
- A IDE volta como estava: as mesmas abas, o mesmo layout e a mesma aba ativa, inclusive depois de uma queda. Sem abas abertas, abre na tela inicial, que oferece Retomar o último ambiente.
- Sessões que rodavam são retomadas sozinhas, mas sem continuar a tarefa. Ambiente novo, inclusive de template, já abre com as sessões iniciadas.
- Sessão que trabalhava quando foi encerrada mostra "Atenção" até a pessoa digitar nela ou dispensar.
- O + logo após as abas de ambiente leva direto ao Novo ambiente.
- Abas de ambiente se reordenam arrastando. Fixadas (alfinete) ficam sempre à esquerda; arrastar não cruza entre fixadas e demais. O fixado fica no ambiente e não vai para o template.
- Template é o molde (projetos, quantas sessões e terminais, layout, sem conversas) e não aparece nas abas; ambiente é onde se trabalha. Templates são criados pela tela de Templates, pelo Novo ambiente ou a partir de um ambiente aberto, e só eles são exportados e importados, com os projetos pelo nome.
- Novo ambiente: vários projetos, cada um com quantas sessões do Claude e terminais quiser (até 8 de cada), e pastas novas, cada uma com nome e local próprios, que viram projetos vazios. No topo ficam os templates salvos: um clique abre o ambiente na hora, e o ajuste preenche a tabela com as quantidades dele.
- Não há ambiente temporário: todo ambiente é salvo. A sessão rápida vira um ambiente com o nome do projeto e a data, e qualquer ambiente é renomeado com clique duplo na aba.
- Num ambiente com vários projetos, arquivos, comandos, plugins, Git e sessões novas seguem o projeto da sessão em uso.
- Fechar uma aba não apaga o ambiente; apagar é uma ação separada. O Histórico de ambientes, na tela inicial, lista abertos e fechados com busca por ambiente, projeto ou sessão, e reabrir retoma as sessões que estavam abertas ao fechar.
- Fechar sessão ou terminal é direto, sem confirmação. Fechar um ambiente sempre pede confirmação.
- A barra lateral tem ações separadas: nova sessão, terminal na pasta da sessão atual, sessão do Claude em worktree, Git, Plugins e Comandos. Não há menu de opções. Configurações ficam no pé da barra e só tratam do rodapé. Clicar em Visão geral expande ou recolhe a barra: expandida mostra o nome ao lado de cada ícone e não mostra dica; recolhida mostra a dica.
- O rodapé só mostra estado, nunca tem ações: uso do Claude (5h e semana), contexto e tempo até o cache vencer da sessão do Claude em uso e, à direita, o Git da sessão em uso. Sem textos explicativos. Cada indicador tem sua opção nas configurações, e nenhuma muda algo nas sessões.
- Ações de Git ficam no ícone Git da barra lateral e nunca forçam: trocar de branch é recusado com alterações versionadas, pull é só `--ff-only`, push não força e remover worktree pede confirmação e recusa uma em uso.
- "Ver alterações", no menu Git, abre o painel Alterações: diff unificado da pasta contra o último commit, com stage, sem stage e arquivos novos juntos. É só leitura, sem stage nem descarte. O painel guarda a pasta onde abriu, e há um por pasta.
- O painel de plugins ativa e desativa pelo `claude plugin` oficial. Nunca reinicia sessões: avisa quais precisam reiniciar ou de `/reload-plugins`.
- Comandos personalizados são criados pelo ícone Comandos da barra lateral, não nas configurações. Por projeto ou para todos, viram botões na aba do ambiente ativo, na barra de cima, e nas abas de terminal, nunca nas do Claude. Cada clique abre um terminal novo na pasta da sessão em uso e executa o comando nele. O X vem antes deles, e acima de 4 o resto vai para um menu.
- Temas claro (padrão) e escuro em toda tela nova.
- Instalador NSIS por usuário, sem pedir administrador, ainda sem assinatura de código. O `appId` (`io.github.darci-jr.agent-ide`) nunca muda.
- Atualizações pelas releases do GitHub: o app procura ao abrir e a cada 4 horas e baixa sozinho, mas nunca reinicia sozinho. Um ícone na barra de cima avisa quando a versão está pronta, e ela também entra ao fechar o app. Configurações mostram a versão e procuram atualização.
- Open source, com licença MIT. As atualizações exigem o repositório público.

## Próximos passos, nesta ordem

1. Custo por sessão. A linha de status já recebe `cost`, como recebe o contexto.
2. Aplicações em execução, por sessão.
3. Adaptadores de outras CLIs e de modelos locais.
4. Instaladores e suporte testado a Mac e Linux. Hoje só o Windows tem instalador e testes.

## Ambiente de desenvolvimento

- Windows. Comandos muito longos no Bash falham com `ENAMETOOLONG`: use as ferramentas de arquivo.
- Com a IDE aberta a partir desta pasta (`npm run start`), o Electron de `node_modules` está em uso e `npm install` falha com `EBUSY`. Instale com ela fechada, ou trabalhe numa worktree com `node_modules` próprio.
- Se a sessão foi aberta dentro de um Claude Code, os testes herdam variáveis dele. `src/main/childEnv.ts` as remove das sessões criadas pelo app.

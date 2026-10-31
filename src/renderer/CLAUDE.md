# Interface

## Regra central dos terminais

Cada terminal tem um único elemento DOM, criado uma vez em `terminals.ts`. Painéis apenas o recebem. Nunca recrie o terminal para destacar, arrastar ou trocar de ambiente: isso reiniciaria o estado visível da sessão. O protótipo mediu trocas de até 20 ms com um Claude Code real preservado.

- Ambientes abertos continuam montados, ocultos com `display: none`.
- Terminal oculto mede zero: só ajuste o tamanho se estiver visível (`fitIfVisible`), ou o processo encolhe por engano.
- O WebGL não trouxe ganho com 8 terminais a 500 KB/s; o renderizador DOM basta.

## Layout (dockview)

- Importe de `dockview-react`, não de `dockview`, inclusive o CSS.
- `defaultTabComponent` recebe o componente, não um nome.
- Use `defaultRenderer="always"`, para os painéis não serem desmontados.
- **Empilhamento:** divisórias e marca d'água do dockview ficam acima de elementos comuns e capturam cliques. Modais usam `z-index` 1000 ou mais, e o que ficar sobre o layout precisa de `z-index` próprio.
- O layout é salvo em `onDidLayoutChange`. Panel ids de arquivo são aleatórios, para caminhos não vazarem na exportação.

## Outras armadilhas

- **xterm 6:** o `.xterm-viewport` tem fundo preto e barra nativa por padrão, o que vaza como uma barra preta. Já tratado em `styles.css`.
- **Monaco:** os workers são importados por `monaco-editor/editor/editor.worker.js?worker`, sem `esm/vs`, por causa do `exports` do pacote.
- **`dompurify`:** o override em `package.json` existe para corrigir uma falha crítica herdada do Monaco. Não o remova sem rodar `npm audit`.
- **Ícones:** `IconButton` interrompe a propagação do clique para não iniciar arrastes. Ouvintes globais de `mousedown` precisam usar captura.
- **Dicas:** use `data-tip`, não `title`, cuja demora faz a dica parecer ausente. `Tooltip.tsx` atende o app inteiro.
- **Markdown:** sempre passe por `DOMPurify`. Links não navegam dentro do app.

## Visual

Direção de sala de controle aérea: quadro azul-ardósia, com cada sessão como uma faixa de voo clara. Fonte Bahnschrift, e Cascadia Mono no terminal.

- Cores só por variáveis CSS em `styles.css`, definidas nos dois temas. Terminal e Monaco também trocam de tema.
- Diferença de estado não depende só da cor: inclua o texto (Ativa, Ociosa, Parada).
- Botões reais, com `aria-label` nos que só têm ícone.

Limitação conhecida: "Aguarda você" ficou de fora porque a saída do terminal não permite distinguir esse estado com segurança.

# Ambientes e templates

[← Voltar ao início](../README.md)

## Pasta de trabalho

Escolhida uma vez, no primeiro uso. Guarda só os dados da IDE: `Ambientes`, `Templates`, a lista
de projetos e os comandos. Prefira uma pasta fora de repositórios Git; a IDE avisa se não for.

## Projetos

O projeto é o centro: toda sessão parte de um projeto, e o histórico é por projeto. Crie um novo,
dando o nome e escolhendo onde a pasta dele fica, ou adicione uma pasta existente. Projeto novo
nunca vai para dentro da pasta de trabalho.

## Ambientes

Cada aba de cima é um ambiente, com layout e sessões próprios.

- **Novo ambiente:** pelo **+** logo após as abas. Escolha os projetos e quantas sessões do Claude e
  terminais cada um abre (até 8 de cada). Pastas novas, cada uma com nome e local próprios,
  viram projetos vazios. O ambiente já abre com as sessões iniciadas.
- **Sessão rápida:** só escolha o projeto. Ela abre um ambiente com o nome do projeto e a data.
- **Vários projetos:** num ambiente com mais de um projeto, arquivos, comandos, plugins, Git e
  sessões novas seguem o projeto da sessão em uso.
- **Layout livre:** arraste, divida e agrupe painéis. Destaque uma sessão e volte para a grade sem
  reiniciar nada.
- **Abas:** renomeie com clique duplo, reordene arrastando e fixe com o alfinete; as fixadas ficam
  sempre à esquerda.
- **Fechar não apaga:** fechar uma aba pede confirmação e guarda o ambiente. Apagar é uma ação
  separada.
- **Histórico de ambientes:** na tela inicial, lista abertos e fechados, com busca por ambiente,
  projeto ou sessão. Reabrir retoma as sessões que estavam abertas ao fechar.
- **Retomar:** sem abas abertas, a IDE abre na tela inicial, que oferece retomar o último ambiente.

Todo ambiente é salvo; não há ambiente temporário.

## Templates

Um template é o molde de um ambiente: projetos, quantas sessões e terminais, e layout, sem
conversas. Templates não aparecem nas abas; ambientes, sim.

- **Criar:** pela tela de Templates, pelo Novo ambiente ou a partir de um ambiente aberto.
- **Usar:** no topo do Novo ambiente, um clique abre o ambiente na hora; o ajuste preenche a tabela
  com as quantidades dele para você mudar antes de abrir.
- **Compartilhar:** exporte para um arquivo e importe em outra máquina. Os projetos vão pelo nome.
  O arquivo não leva segredos, conteúdo de arquivos, conversas nem caminhos da máquina. Ao
  importar, ele é validado e nenhuma sessão começa sozinha.

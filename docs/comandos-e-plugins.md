# Comandos e plugins

[← Voltar ao início](../README.md)

## Comandos

Comandos personalizados viram botões para o que você roda o tempo todo: `npm run dev`, testes,
build, deploy.

- **Criar:** pelo ícone Comandos da barra lateral, com nome, ícone e comando. Cada um vale para um
  projeto ou para todos.
- **Onde aparecem:** na aba do ambiente ativo, na barra de cima, e nas abas de terminal. Acima de 4,
  o resto vai para um menu.
- **O que fazem:** cada clique abre um terminal novo na pasta da sessão em uso e executa o comando
  nele.

## Plugins

O ícone Plugins da barra lateral lista os plugins do Claude Code instalados, ativos e desativados,
com o que cada um traz (skills, comandos, agentes, servidores MCP e hooks). Ative e desative com
um clique; a IDE usa o `claude plugin` oficial.

A IDE nunca reinicia sessões por isso: ela avisa quais precisam reiniciar ou de `/reload-plugins`.

# Arquivos e segredos

[← Voltar ao início](../README.md)

## Arquivos

- **Árvore do projeto** com busca por nome, incluindo arquivos que o Git ignora, como `.env`.
- **Editor** de código, que abre como um painel do layout, ao lado das sessões.
- **Markdown:** visualização que acompanha as mudanças que o agente faz no arquivo. Útil para
  escrever um plano ou uma especificação junto com ele.

## Segredos

Editar um `.env` na IDE evita que o valor passe pela conversa com o agente, mas o agente ainda
poderia abrir o arquivo no disco. Por isso o editor oferece **Bloquear**, que adiciona
`Read(./caminho)` ao `deny` de `.claude/settings.local.json`.

A regra vale para o Claude Code; outros agentes têm controles próprios. Ela não é uma barreira
absoluta: um comando que leia o arquivo por outro caminho pode não ser reconhecido. Para garantia
maior, mantenha o agente em modo que peça confirmação de comandos.

## Privacidade

A IDE não cria cópias, histórico nem telemetria do conteúdo dos arquivos. Um template exportado não
leva segredos, conteúdo de arquivos, conversas nem caminhos da máquina.

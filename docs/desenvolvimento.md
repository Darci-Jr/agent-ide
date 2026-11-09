# Desenvolvimento

[← Voltar ao início](../README.md)

Electron, React e TypeScript. Requer Node.js 24.

```sh
npm install
npm run dev        # abre o app com recarga automática
npm run check      # typecheck e testes de unidade
npm run e2e        # compila e percorre o app real, sem consumir tokens
npm run dist       # gera o instalador em dist/, sem publicar
node e2e/claude-real.mjs   # usa um Claude Code real e consome alguns tokens; faça o build antes
```

O GitHub Actions roda typecheck, testes e e2e em Windows, Mac e Linux a cada pull request.

## Estrutura

- `src/shared/types.ts`: contrato entre os processos. Comece por aqui.
- `src/main/`: processos, arquivos, projetos, ambientes e histórico.
- `src/preload/index.ts`: a API que a interface usa.
- `src/renderer/src/`: interface.

## Outras CLIs e modelos locais

Para outra CLI ou um modelo local, implemente `AgentAdapter` (`src/main/adapters/types.ts`) e
registre-o em `src/main/adapters/index.ts`.

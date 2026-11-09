# Instalação e atualizações

[← Voltar ao início](../README.md)

Baixe o arquivo do seu sistema na [página de releases](https://github.com/Darci-Jr/agent-ide/releases/latest).
Os instaladores ainda não têm assinatura de código.

## Windows

Execute o `Agent-IDE-Setup-<versão>.exe`. Ele instala só para o seu usuário, sem pedir
administrador. Se aparecer "O Windows protegeu o computador", clique em **Mais informações** e em
**Executar assim mesmo**.

## Linux

- **Ubuntu e Debian:** prefira o `.deb` (`sudo apt install ./Agent-IDE-*.deb`). Ele não se atualiza
  sozinho: a IDE avisa, e você instala o novo.
- **Outras distribuições:** use o `.AppImage`, que se atualiza sozinho. Dê permissão de execução
  (`chmod +x Agent-IDE-*.AppImage`) e abra. Ele precisa da `libfuse2`, que o Ubuntu 22.04 em diante
  não traz (`sudo apt install libfuse2t64`), e no Ubuntu 24 em diante só abre com `--no-sandbox`,
  porque o sistema bloqueia o sandbox do Electron em AppImages.

## Mac (experimental)

Baixe o `.dmg` de `arm64` para Apple Silicon (M1 em diante) ou de `x64` para Intel. O app ainda não
é assinado pela Apple: na primeira vez, clique nele com o botão direito e escolha **Abrir**.

## Atualizações

A IDE procura versão nova ao abrir e a cada 4 horas, e baixa em segundo plano. Ela nunca reinicia
sozinha: um ícone na barra de cima avisa quando a versão está pronta, e ela também entra quando
você fecha a IDE. Em **Configurações**, você vê a versão instalada e procura atualização na hora.

No Mac, sem a assinatura da Apple, a IDE só avisa e abre a página para baixar.

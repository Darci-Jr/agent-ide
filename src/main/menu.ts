import { Menu } from 'electron'

/**
 * Menu nativo. O padrão do Electron tem atalhos que valem mesmo com o foco no terminal:
 * Ctrl+R recarregava a janela (é a busca no histórico do shell e do Claude Code) e Ctrl+W
 * fechava a IDE com todas as sessões (no bash, apaga uma palavra).
 * Windows e Linux ficam sem menu: copiar e colar nos campos funcionam sem ele.
 * O Mac precisa do menu Editar para Cmd+C, Cmd+V e Cmd+Z, e do menu do app para Cmd+Q.
 */
export function setAppMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      // Sem "Fechar" (Cmd+W): fecharia a IDE inteira, e não só uma aba.
      { label: 'Janela', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'togglefullscreen' }] }
    ])
  )
}

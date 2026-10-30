// 화면(렌더러)에 노출하는 최소 API. Node 권한은 넘기지 않는다 (contextIsolation + sandbox).
const { contextBridge, ipcRenderer } = require('electron')

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args)

contextBridge.exposeInMainWorld('nf', {
  snapshot: call('nf:snapshot'),
  refresh: call('nf:refresh'),
  openNotion: call('nf:notion:open'),
  openSettings: call('nf:settings:open'),
  setToken: call('nf:notion:token'),
  saveSettings: call('nf:settings:save'),
  resizeWidget: call('nf:widget:resize'),
  setWidgetMode: call('nf:widget:mode'),
  checkUpdate: call('nf:update:check'),
  installUpdate: call('nf:update:install'),
  skipUpdate: call('nf:update:skip'),
  onChange: (fn) => {
    const h = () => fn()
    ipcRenderer.on('nf:changed', h)
    return () => ipcRenderer.removeListener('nf:changed', h)
  },
})

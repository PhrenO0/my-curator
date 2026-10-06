// 화면(렌더러)에 노출하는 최소 API. Node 권한은 넘기지 않는다 (contextIsolation + sandbox).
const { contextBridge, ipcRenderer } = require('electron')

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args)

contextBridge.exposeInMainWorld('nf', {
  snapshot: call('nf:snapshot'),
  saveEvent: call('nf:event:save'),
  deleteEvent: call('nf:event:delete'),
  saveActivity: call('nf:activity:save'),
  deleteActivity: call('nf:activity:delete'),
  setActivityStatus: call('nf:activity:status'),
  toggleOccurrence: call('nf:occurrence:toggle'),
  toggleOneThing: call('nf:onething:toggle'),
  setOneThing: call('nf:onething:set'),
  run: call('nf:run'),
  saveSettings: call('nf:settings:save'),
  setKey: call('nf:key:set'),
  open: call('nf:open'),
  openLink: call('nf:link'),
  resizeWidget: call('nf:widget:resize'),
  setWidgetMode: call('nf:widget:mode'),
  // 로그인
  authConfig: call('nf:auth:config'),
  signIn: call('nf:auth:signin'),
  signOut: call('nf:auth:signout'),
  // 언제든 입력
  previewInput: call('nf:input:preview'),
  commitInput: call('nf:input:commit'),
  hideQuick: call('nf:quick:hide'),
  openQuick: call('nf:quick:open'),
  deleteGoogleEvent: call('nf:google:delete'),
  detectEngine: call('nf:engine:detect'),
  onChange: (fn) => {
    const h = () => fn()
    ipcRenderer.on('nf:changed', h)
    return () => ipcRenderer.removeListener('nf:changed', h)
  },
  onNavigate: (fn) => ipcRenderer.on('nf:navigate', (_e, view) => fn(view)),
})

const { app, BrowserWindow, session, shell, Menu, ipcMain, desktopCapturer } = require("electron");
const path = require("path");

const ORBIT_URL = process.env.ORBIT_DESKTOP_URL || "https://miniature-octo-eureka-production.up.railway.app/";
let mainWindow = null;
let screenPickerWindow = null;
let pendingDisplayMediaCallback = null;
let pendingDisplaySources = new Map();

app.setAppUserModelId("com.orbit.chat");

async function openScreenSourcePicker(){
  if(screenPickerWindow && !screenPickerWindow.isDestroyed()){
    screenPickerWindow.focus();
    return;
  }
  if(pendingDisplayMediaCallback){
    try{pendingDisplayMediaCallback(null)}catch{}
    pendingDisplayMediaCallback=null;
  }
  const sources=await desktopCapturer.getSources({
    types:["screen","window"],
    thumbnailSize:{width:360,height:220},
    fetchWindowIcons:true
  });
  pendingDisplaySources=new Map(sources.map(s=>[s.id,s]));

  screenPickerWindow=new BrowserWindow({
    width:980,
    height:700,
    minWidth:760,
    minHeight:520,
    parent:mainWindow||undefined,
    modal:false,
    show:false,
    title:"ORBIT — Choose what to share",
    backgroundColor:"#050811",
    autoHideMenuBar:true,
    resizable:true,
    webPreferences:{
      contextIsolation:false,
      nodeIntegration:true,
      sandbox:false
    }
  });
  screenPickerWindow.on("closed",()=>{
    screenPickerWindow=null;
    pendingDisplaySources=new Map();
    if(pendingDisplayMediaCallback){
      try{pendingDisplayMediaCallback(null)}catch{}
      pendingDisplayMediaCallback=null;
    }
  });
  await screenPickerWindow.loadFile(path.join(__dirname,"screen-picker.html"));
  const payload=sources.map(s=>({
    id:s.id,
    name:s.name,
    type:s.id.startsWith("window:")?"window":"screen",
    thumbnail:s.thumbnail?.toDataURL?.()||"",
    appIcon:s.appIcon?.toDataURL?.()||""
  }));
  screenPickerWindow.webContents.once("did-finish-load",()=>{
    screenPickerWindow.webContents.send("orbit-screen-sources",payload);
    screenPickerWindow.show();
    screenPickerWindow.focus();
  });
}

function createWindow(){
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#070910",
    show: false,
    title: "ORBIT",
    icon: path.join(__dirname, "..", "build", "icon.svg"),
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#090b12",
      symbolColor: "#aeb7ff",
      height: 36
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.once("ready-to-show",()=>{
    mainWindow.setOpacity?.(0);
    mainWindow.show();
    let opacity = 0;
    const timer = setInterval(()=>{
      opacity += 0.14;
      if(opacity >= 1){
        opacity = 1;
        clearInterval(timer);
      }
      mainWindow.setOpacity?.(opacity);
    }, 18);
  });

  mainWindow.webContents.setWindowOpenHandler(({url})=>{
    if(/^https?:/i.test(url) && !url.startsWith(ORBIT_URL)){
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.webContents.on("will-navigate",(event,url)=>{
    if(/^https?:/i.test(url) && !url.startsWith(ORBIT_URL)){
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.on("did-finish-load", async ()=>{ 
    try{
      const css=await mainWindow.webContents.insertCSS(require("fs").readFileSync(path.join(__dirname,"desktop.css"),"utf8"));
      await mainWindow.webContents.executeJavaScript(require("fs").readFileSync(path.join(__dirname,"desktop-ui.js"),"utf8"), true);
      void css;
    }catch(e){
      console.debug("ORBIT desktop customization unavailable",e);
    }
  });

  mainWindow.webContents.on("did-fail-load",(_event,errorCode,errorDescription)=>{
    if(errorCode !== -3){
      mainWindow.webContents.executeJavaScript(
        `document.body.innerHTML = '<div style="min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 30%,#202869 0,#0b0d14 45%,#05060b 100%);color:#fff;font:600 16px Inter,system-ui,sans-serif;padding:32px;text-align:center"><div><div style="letter-spacing:.28em;font-size:12px;opacity:.7">ORBIT DESKTOP</div><div style="font-size:44px;line-height:1;margin:14px 0 12px;font-weight:900">Unable to connect</div><div style="color:#9ba1b3;font-size:14px">Check your internet connection, then reconnect to ORBIT.</div><button onclick="location.reload()" style="margin-top:22px;padding:12px 18px;border:1px solid #5965e8;border-radius:10px;background:#5865f2;color:#fff;font-weight:800;cursor:pointer;box-shadow:0 10px 32px rgba(88,101,242,.28)">Reconnect</button></div></div>'`,
        true
      ).catch(()=>{});
      console.error("ORBIT load failed",errorCode,errorDescription);
    }
  });

  mainWindow.on("closed",()=>{ mainWindow=null; });
  mainWindow.loadURL(ORBIT_URL);
}

ipcMain.on("orbit-screen-picker-select",(event,sourceId)=>{
  const source=pendingDisplaySources.get(String(sourceId||""));
  const cb=pendingDisplayMediaCallback;
  pendingDisplayMediaCallback=null;
  if(!source || !cb){
    try{event.sender.send("orbit-screen-picker-error","Screen source unavailable.")}catch{}
    return;
  }
  try{cb({video:source,audio:false})}catch{}
  pendingDisplaySources=new Map();
  if(screenPickerWindow && !screenPickerWindow.isDestroyed())screenPickerWindow.close();
});
ipcMain.on("orbit-screen-picker-cancel",()=>{
  const cb=pendingDisplayMediaCallback;
  pendingDisplayMediaCallback=null;
  if(cb)try{cb(null)}catch{}
  pendingDisplaySources=new Map();
  if(screenPickerWindow && !screenPickerWindow.isDestroyed())screenPickerWindow.close();
});

ipcMain.on("orbit-window-control",(_event,action)=>{
  if(!mainWindow)return;
  if(action==="minimize")mainWindow.minimize();
  else if(action==="maximize"){
    if(mainWindow.isMaximized())mainWindow.unmaximize();
    else mainWindow.maximize();
  }else if(action==="close")mainWindow.close();
});

app.whenReady().then(()=>{
  session.defaultSession.setPermissionRequestHandler((_webContents,permission,callback)=>{
    const allowed = new Set(["media","notifications","clipboard-read","clipboard-sanitized-write"]);
    callback(allowed.has(permission));
  });

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    pendingDisplayMediaCallback=callback;
    openScreenSourcePicker().catch(()=>{
      const cb=pendingDisplayMediaCallback;
      pendingDisplayMediaCallback=null;
      if(cb)try{cb(null)}catch{}
    });
  }, { useSystemPicker: false });

  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate",()=>{
    if(BrowserWindow.getAllWindows().length===0)createWindow();
  });
});

app.on("window-all-closed",()=>{
  if(process.platform !== "darwin")app.quit();
});

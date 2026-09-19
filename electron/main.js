const { app, BrowserWindow, session, shell, Menu, ipcMain } = require("electron");
const path = require("path");

const ORBIT_URL = process.env.ORBIT_DESKTOP_URL || "https://miniature-octo-eureka-production.up.railway.app/";
let mainWindow = null;

app.setAppUserModelId("com.orbit.chat");

function createWindow(){
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#070910",
    show: false,
    title: "ORBIT",
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

  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate",()=>{
    if(BrowserWindow.getAllWindows().length===0)createWindow();
  });
});

app.on("window-all-closed",()=>{
  if(process.platform !== "darwin")app.quit();
});

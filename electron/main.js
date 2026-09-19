const { app, BrowserWindow, session, shell, Menu, nativeImage } = require("electron");
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
    backgroundColor: "#1e1f22",
    show: false,
    title: "ORBIT",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  mainWindow.once("ready-to-show",()=>mainWindow.show());

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
        `document.body.innerHTML = '<div style="min-height:100vh;display:grid;place-items:center;background:#1e1f22;color:#fff;font:600 16px Inter,system-ui,sans-serif;padding:32px;text-align:center"><div><div style="font-size:34px;margin-bottom:12px">ORBIT</div><div>Unable to connect. Check your internet connection and retry.</div><button onclick="location.reload()" style="margin-top:18px;padding:10px 16px;border:0;border-radius:8px;background:#5865f2;color:#fff;font-weight:700;cursor:pointer">Retry</button></div></div>'`,
        true
      ).catch(()=>{});
      console.error("ORBIT load failed",errorCode,errorDescription);
    }
  });

  mainWindow.on("closed",()=>{ mainWindow=null; });
  mainWindow.loadURL(ORBIT_URL);
}

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

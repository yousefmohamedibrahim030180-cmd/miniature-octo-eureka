const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("orbitDesktop",{
  isDesktop:true,
  platform:process.platform
});

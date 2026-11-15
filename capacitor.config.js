const hostname = (process.env.TRUCKCAR_APP_HOSTNAME || "").trim();

module.exports = {
  appId: "co.com.truckcar.app",
  appName: "TruckCar",
  webDir: ".",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https",
    cleartext: false,
    ...(hostname ? { hostname } : {})
  },
  android: {
    backgroundColor: "#0C0E12",
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false
  }
};

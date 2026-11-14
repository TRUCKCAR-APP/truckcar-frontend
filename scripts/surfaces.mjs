export const SURFACES = {
  core: [
    "js/theme.js",
    "js/config.js",
    "js/api.js",
    "js/mockData.js",
    "js/state.js",
    "js/ui.js",
    "js/ui/toaster.js",
    "js/ui/sheet.js",
    "js/offlineQueue.js",
    "js/tileStore.js",
    "js/dataService.js",
    "js/telemetry.js",
    "js/ui/native.js",
    "js/speechEngine.js",
    "js/mapController.js",
    "js/views/loginView.js",
    "js/views/podModals.js",
    "js/views/publicTracking.js",
    "js/app.js",
  ],
  driver: [
    "js/podEvidence.js",
    "js/geolocation.js",
    "js/navigation.js",
    "js/views/driverApp.js",
    "js/views/driverActions.js",
    "js/surfaces/driver.js",
  ],
  panel: [
    "js/views/coordinatorPanel.js",
    "js/views/generatorPanel.js",
    "js/views/sosMonitor.js",
    "js/surfaces/panel.js",
  ],
};

export const ON_DEMAND = {
  demo: ["js/demo/demoSession.js"],
};

export const PAGES = {
  "index.html": ["core", "driver", "panel"],
};

export function pageScripts(page) {
  return PAGES[page].flatMap((surface) => SURFACES[surface]);
}

export function allScripts() {
  return [...Object.values(SURFACES).flat(), ...Object.values(ON_DEMAND).flat()];
}

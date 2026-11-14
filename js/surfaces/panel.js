(function () {
    const app = window.app;
    const service = window.TruckCarService;
    const keepAliveMaps = ['coordinator-map-container', 'generator-map-container'];

    function mountMap(state) {
        if (document.getElementById('generator-map-container')) app.handleGeneratorMapMount(state);
        else if (document.getElementById('coordinator-map-container')) app.handleCoordinatorMapMount(state);
    }

    app.registerView('generator', {
        render: (state) => window.GeneratorPanel.render(state),
        mountMap,
        screen: (state) => state.coordinatorTab,
        keepAliveMaps
    });

    app.registerView('coordinator', {
        render: (state) => state.coordinatorTab === 'shipments'
            ? window.GeneratorPanel.render(state)
            : window.CoordinatorPanel.render(state),
        mountMap,
        screen: (state) => state.coordinatorTab,
        keepAliveMaps
    });

    app.onRender((state) => {
        app.syncLiveTracking(state);
        window.SosMonitor.sync(state);
    });

    app.onSessionEnd(() => {
        window.SosMonitor.stop();
        window.LiveTracking.stopAll();
        window.generatorCtrl.reset();
    });

    service.registerLoader('generator', () => service.refreshShipments());

    service.registerLoader('coordinator', () => Promise.all([service.loadFleet(), service.loadAlerts(),
        service.loadCoordinatorLoad(), service.loadDeliveredLoads(), service.loadPublishedLoads()]));
})();

(function () {
    const app = window.app;
    const service = window.TruckCarService;

    app.registerView('driver', {
        render: (state) => window.DriverApp.render(state),
        mountMap: (state) => app.handleDriverMapMount(state),
        screen: (state) => state.driverScreen
    });

    app.onMount(() => window.DriverTelemetry.renderBadge());

    app.onRender((state) => {
        window.DriverActions.syncSos(state);
        window.DeviceLocation.sync(state);
        if (state.isAuthenticated) window.DriverTelemetry.renderSimulationToggle();
    });

    app.onSessionEnd(() => {
        window.DriverTelemetry.stop();
        window.RouteGuidance.reset();
        window.DeviceLocation.forget();
    });

    service.registerLoader('driver', async () => {
        await service.loadDriverProfile();
        await Promise.all([service.loadDriverAssignment(), service.loadAlerts()]);
        await service.loadRoutePlan();
    });
})();

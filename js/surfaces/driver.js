(function () {
    const app = window.app;
    const service = window.TruckCarService;

    app.registerView('driver', {
        render: (state) => window.DriverApp.render(state),
        mountMap: (state) => app.handleDriverMapMount(state),
        screen: (state) => state.driverScreen,
        // El mapa de Navegar no se recrea en cada actualización: conserva el zoom, el seguimiento y lo que el conductor
        // movió con el dedo.
        keepAliveMaps: ['live-nav-map-container']
    });

    app.onMount(() => window.DriverTelemetry.renderBadge());

    let swipe = null;
    document.addEventListener('pointerdown', (event) => {
        const sheet = event.target.closest && event.target.closest('[data-trip-sheet]');
        swipe = sheet ? { y: event.clientY } : null;
    }, { passive: true });
    document.addEventListener('pointerup', (event) => {
        if (!swipe) return;
        const dy = event.clientY - swipe.y;
        swipe = null;
        if (Math.abs(dy) < 30) return;
        app.toggleTripSheet(dy < 0);
    }, { passive: true });

    app.onRender((state) => {
        window.DriverActions.syncSos(state);
        window.VoiceAssistant.sync(state);
        window.DeviceLocation.sync(state);
        if (state.isAuthenticated) window.DriverTelemetry.renderSimulationToggle();
    });

    app.onSessionEnd(() => {
        clearInterval(app.driverTimer);
        clearInterval(app.countdownTimer);
        clearInterval(app.inboxTimer);
        window.DriverTelemetry.stop();
        window.RouteGuidance.forget(null);
        window.DeviceLocation.forget();
    });

    service.registerLoader('driver', async () => {
        await service.loadDriverProfile();
        await Promise.all([service.loadDriverAssignment(), service.loadAlerts()]);
        await service.loadRoutePlan();
    });
})();

(function () {
    const app = window.app;
    const service = window.TruckCarService;

    app.registerView('company', {
        render: (state) => window.CompanyPanel.render(state),
        screen: (state) => state.companyTab || 'fleet',
        // Mi flota: el mapa vuelve a su lugar después de cada redibujo y la flota se actualiza mientras se mira.
        mountMap: (state) => {
            const tab = state.companyTab || 'fleet';
            if (tab === 'fleet') {
                window.CompanyFleet.mount(state);
                window.CompanyFleet.startPolling();
            } else {
                window.CompanyFleet.stopPolling();
            }
            if (tab === 'loads') window.CompanyLoads.startPolling();
            else window.CompanyLoads.stopPolling();
        }
    });

    service.registerLoader('company', () => Promise.all([service.loadCompany(), service.loadCompanyFleet(), service.loadCompanySos(),
        service.loadCompanyLoads()]));
})();

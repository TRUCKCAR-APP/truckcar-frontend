(function () {
    const app = window.app;
    const service = window.TruckCarService;

    app.registerView('company', {
        render: (state) => window.CompanyPanel.render(state),
        screen: () => 'drivers'
    });

    service.registerLoader('company', () => service.loadCompany());
})();

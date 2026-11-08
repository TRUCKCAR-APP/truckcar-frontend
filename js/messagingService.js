(function () {
    const TruckCarMessaging = {
        initContext() {
            window.store.setState({ chatMessages: [] });
        },
        unsubscribe() {},
        async sendMessage(text) {
            if (!text || !text.trim()) return null;
            throw new Error('El backend aún no expone un contrato confirmado para mensajería. El mensaje no se envió..');
        },
        QUICK_REPLIES: []
    };
    window.TruckCarMessaging = TruckCarMessaging;
})();

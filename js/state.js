class TruckDarStore {
    constructor() {
        this.state = {
            // Sesión y sincronización con el backend (api-gateway)
            isAuthenticated: false,
            currentUser: null,
            sessionRole: null,
            authError: null,
            authMode: 'login',
            dataStatus: { loading: false, errors: {}, lastSync: null },
            selectedLoadId: null,
            busyAction: null,

            activeRole: 'driver',
            driverScreen: 'assigned_load',
            coordinatorTab: 'fleet',
            isLandscape: false,
            showDeviceFrame: true,
            isNavigating: true,
            navStepIndex: 0,
            simulatedSpeed: 54,
            voiceEnabled: true,
            isOffline: false,
            tripAccepted: true,
            tripCompleted: false,
            alertFilter: 'all',
            activeModal: null,
            // Canal de despacho local: aún no existe un servicio de mensajería en el backend.
            chatMessages: []
        };
        
        this.listeners = [];
    }

    getState() {
        return this.state;
    }

    setState(partialState) {
        this.state = { ...this.state, ...partialState };
        this.notify();
    }

    subscribe(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    notify() {
        this.listeners.forEach(listener => {
            try {
                listener(this.state);
            } catch(e) {
                console.error(e);
            }
        });
    }
}

window.store = new TruckDarStore();

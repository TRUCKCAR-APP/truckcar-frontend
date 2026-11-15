class TruckCarStore {
    constructor() {
        this.state = {
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
            voiceEnabled: true,
            isOffline: false,
            tripAccepted: true,
            tripCompleted: false,
            alertFilter: 'all',
            activeModal: null
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

window.store = new TruckCarStore();

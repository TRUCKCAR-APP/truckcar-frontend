(function () {
    const STORAGE_KEY = 'truckcar.pushToken';

    const TruckCarNotifications = {
        get isNative() {
            return typeof window.Capacitor !== 'undefined' && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable('PushNotifications');
        },

        get isWebPushSupported() {
            return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
        },

        get permissionStatus() {
            if (this.isNative) return 'prompt';
            return 'Notification' in window ? Notification.permission : 'denied';
        },

        async requestPermission() {
            if (this.isNative) {
                try {
                    const Push = window.Capacitor.Plugins.PushNotifications;
                    let perm = await Push.checkPermissions();
                    if (perm.receive === 'prompt') {
                        perm = await Push.requestPermissions();
                    }
                    if (perm.receive === 'granted') {
                        await Push.register();
                        this.setupNativeListeners(Push);
                        return true;
                    }
                } catch (e) {
                    console.warn('[TruckCar] Error en permisos nativos push:', e);
                }
                return false;
            }

            if (this.isWebPushSupported) {
                try {
                    const result = await Notification.requestPermission();
                    if (result === 'granted') {
                        await this.registerWebPush();
                        return true;
                    }
                } catch (e) {
                    console.warn('[TruckCar] Error solicitando permisos web push:', e);
                }
            }
            return false;
        },

        setupNativeListeners(Push) {
            Push.addListener('registration', async (token) => {
                const tokenVal = token.value;
                localStorage.setItem(STORAGE_KEY, tokenVal);
                await this.sendTokenToBackend(tokenVal, 'android');
            });

            Push.addListener('registrationError', (error) => {
                console.error('[TruckCar] Error registrando push en Android:', error);
            });

            Push.addListener('pushNotificationReceived', (notification) => {
                if (window.ui && window.ui.toast) {
                    window.ui.toast(notification.title || 'Notificación', 'info', {
                        description: notification.body
                    });
                }
                if (window.Native && window.Native.haptic) window.Native.haptic('warning');
            });

            Push.addListener('pushNotificationActionPerformed', (notification) => {
                const data = notification.notification.data;
                if (data && data.url) {
                    window.location.href = data.url;
                } else if (data && data.screen) {
                    window.store.setState({ driverScreen: data.screen });
                }
            });
        },

        async registerWebPush() {
            try {
                const registration = await navigator.serviceWorker.ready;
                let subscription = await registration.pushManager.getSubscription();

                if (!subscription) {
                    const vapidKey = window.TruckCarConfig.vapidPublicKey;
                    if (vapidKey) {
                        subscription = await registration.pushManager.subscribe({
                            userVisibleOnly: true,
                            applicationServerKey: vapidKey
                        });
                    }
                }

                if (subscription) {
                    const tokenStr = JSON.stringify(subscription);
                    localStorage.setItem(STORAGE_KEY, tokenStr);
                    await this.sendTokenToBackend(tokenStr, 'web');
                }
            } catch (e) {
                console.info('[TruckCar] Registro WebPush listo en cliente:', e.message);
            }
        },

        async sendTokenToBackend(token, platform) {
            if (!window.TruckCarApi || !window.TruckCarApi.users || !window.TruckCarApi.session.isActive()) return;
            try {
                await window.TruckCarApi.users.savePushToken(token, platform);
            } catch (e) {
            }
        },

        notifyLocal(title, body, options = {}) {
            if (this.permissionStatus === 'granted' && 'Notification' in window) {
                try {
                    navigator.serviceWorker.ready.then(reg => {
                        reg.showNotification(title, {
                            body,
                            icon: 'assets/icon-192.png',
                            badge: 'assets/icon-192.png',
                            vibrate: [200, 100, 200],
                            ...options
                        });
                    });
                    return;
                } catch (e) {}
            }
            if (window.ui && window.ui.toast) {
                window.ui.toast(title, 'info', { description: body });
            }
        }
    };

    window.TruckCarNotifications = TruckCarNotifications;
})();

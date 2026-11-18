class VoiceAssistant {
    constructor() {
        this.audioContext = null;
        this.microphoneStream = null;
        this.isListening = false;
    }

    async init() {
        try {
            this.microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            console.log("Micrófono habilitado. Preparando motor Wake Word offline...");
            this.setupWakeWordEngine();

        } catch (error) {
            console.error("Error al acceder al micrófono. El asistente por voz está deshabilitado.", error);
        }
    }

    setupWakeWordEngine() {
        this.isListening = true;
        console.log("Asistente en modo de bajo consumo, esperando comando de voz...");
    }

    startRecordingCommand() {
        console.log("Comando detectado. Iniciando grabación completa para enviar al Backend...");
    }
}

const truckCarVoiceAssistant = new VoiceAssistant();
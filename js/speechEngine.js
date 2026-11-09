class VoiceGuidanceEngine {
    constructor() {
        this.synth = window.speechSynthesis;
        this.voice = null;
        this.enabled = true;
        this.initVoice();
    }

    initVoice() {
        if (!this.synth) return;
        const setVoice = () => {
            const voices = this.synth.getVoices();
            this.voice = voices.find(v => v.lang.startsWith('es') || v.name.includes('Spanish')) || voices[0];
        };
        setVoice();
        if (this.synth.onvoiceschanged !== undefined) {
            this.synth.onvoiceschanged = setVoice;
        }
    }

    speak(text, priority = false) {
        if (!this.synth || !this.enabled || !window.store.getState().voiceEnabled) {
            return;
        }

        if (priority) {
            this.synth.cancel();
        }

        const utterance = new SpeechSynthesisUtterance(text);
        if (this.voice) {
            utterance.voice = this.voice;
        }
        utterance.rate = 1.05;
        utterance.pitch = 0.95;
        utterance.lang = 'es-CO';

        this.synth.speak(utterance);
    }

    /**
     * Tono de alerta (dos notas cortas) y vibración, para avisos de seguridad como un bloqueo detectado por la IA.
     * Suena aunque la voz esté silenciada: es un aviso de la vía, no una instrucción de navegación.
     */
    alert() {
        try {
            if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
        } catch (e) { /* sin vibración */ }
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            this.audio = this.audio || new Ctx();
            const ctx = this.audio;
            [[880, 0], [660, 0.22]].forEach(([freq, at]) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
                gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.2);
                osc.connect(gain).connect(ctx.destination);
                osc.start(ctx.currentTime + at);
                osc.stop(ctx.currentTime + at + 0.21);
            });
        } catch (e) { /* sin audio */ }
    }

    cancel() {
        if (this.synth) {
            this.synth.cancel();
        }
    }

    test() {
        this.speak('Sistema TruckCar activo. Guía de voz para transporte de carga pesada configurada con éxito.', true);
    }
}

window.voiceEngine = new VoiceGuidanceEngine();

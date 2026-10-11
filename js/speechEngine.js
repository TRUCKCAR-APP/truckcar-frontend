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

    cancel() {
        if (this.synth) {
            this.synth.cancel();
        }
    }

    test() {
        this.speak('Sistema TruckDar activo. Guía de voz para transporte de carga pesada configurada con éxito.', true);
    }
}

window.voiceEngine = new VoiceGuidanceEngine();

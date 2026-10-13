export class GameAudio {
  constructor() { this.enabled = true; this.context = null; }
  async start() {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) throw new Error('WebAudio unavailable');
        this.context = new Audio();
        this.master = this.context.createGain();
        this.master.gain.value = .22;
        this.master.connect(this.context.destination);
        const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        const noise = this.context.createBufferSource();
        noise.buffer = buffer;
        this.noiseBuffer = buffer;
        noise.loop = true;
        const filter = this.context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 550;
        this.wind = this.context.createGain();
        this.wind.gain.value = 0;
        noise.connect(filter).connect(this.wind).connect(this.master);
        noise.start();
      }
      this.master.gain.setValueAtTime(.22, this.context.currentTime);
      await this.context.resume();
    } catch { this.enabled = false; }
  }
  async toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) await this.start();
    else if (this.context) {
      this.master.gain.setValueAtTime(0, this.context.currentTime);
      try { await this.context.suspend(); } catch { /* Keep a blocked audio device muted. */ }
    }
  }
  update(speed) {
    if (this.context && this.enabled) {
      this.wind.gain.setTargetAtTime(Math.max(0, Math.min(1, speed / 32.5)) * .16, this.context.currentTime, .05);
    }
  }
  tone(frequency, duration = .15, kind = 'sine', gain = .25) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const ctx = this.context, osc = ctx.createOscillator(), amp = ctx.createGain(), now = ctx.currentTime;
    osc.type = kind;
    osc.frequency.setValueAtTime(frequency, now);
    amp.gain.setValueAtTime(.001, now);
    amp.gain.linearRampToValueAtTime(gain, now + .012);
    amp.gain.exponentialRampToValueAtTime(.001, now + duration);
    osc.connect(amp).connect(this.master);
    osc.start();
    osc.stop(now + duration);
    osc.onended = () => { osc.disconnect(); amp.disconnect(); };
  }
  sweep(from, to, duration, kind = 'sine', gain = .3) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const ctx = this.context, osc = ctx.createOscillator(), amp = ctx.createGain(), now = ctx.currentTime;
    osc.type = kind;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + duration);
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(.001, now + duration);
    osc.connect(amp).connect(this.master);
    osc.start();
    osc.stop(now + duration);
    osc.onended = () => { osc.disconnect(); amp.disconnect(); };
  }
  burst(duration, frequency, gain = .3, type = 'bandpass') {
    if (!this.enabled || !this.context || this.context.state !== 'running' || !this.noiseBuffer) return;
    const ctx = this.context, src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain(), now = ctx.currentTime;
    src.buffer = this.noiseBuffer;
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, now);
    filter.Q.value = .8;
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(.001, now + duration);
    src.connect(filter).connect(amp).connect(this.master);
    src.start(now, Math.random());
    src.stop(now + duration);
    src.onended = () => { src.disconnect(); filter.disconnect(); amp.disconnect(); };
  }
  event(event) {
    const type = typeof event === 'string' ? event : event.type;
    if (type === 'pickup') {
      const pitch = { banana: 740, boost: 880, shield: 660, double: 990 }[event.kind] || 740;
      this.tone(pitch, event.kind === 'banana' ? .08 : .2, 'triangle', .13);
    }
    if (type === 'kick') {
      this.sweep(150, 38, .45, 'sine', .55);
      this.burst(.5, event.charged ? 900 : 1500, .4);
      this.tone(event.charged ? 220 : 330, .22, 'square', .07);
      this.tone(750, .15, 'triangle', .14);
    }
    if (type === 'dash') { this.burst(.45, 2400, .18, 'highpass'); this.sweep(300, 760, .25, 'triangle', .08); }
    if (type === 'miss') this.tone(160, .12, 'triangle', .15);
    if (type === 'collision') { this.sweep(120, 45, .35, 'sawtooth', .25); this.burst(.3, 700, .25); }
    if (type === 'shield') { this.tone(560, .23, 'sine', .2); this.tone(840, .18, 'sine', .13); }
    if (type === 'stunt') this.tone(880, .12, 'triangle', .15);
    if (type === 'jump') this.tone(430, .09, 'square', .06);
    if (type === 'launch') this.tone(340, .11, 'triangle', .12);
    if (type === 'go') { this.tone(660, .2, 'triangle', .2); this.tone(990, .15, 'triangle', .12); }
    if (type === 'finish') { this.tone(523, .32, 'triangle', .16); this.tone(659, .28, 'triangle', .12); this.tone(784, .4, 'triangle', .1); }
  }
}

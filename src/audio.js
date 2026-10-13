const audioFiles=(...names)=>names.map(name=>`/audio/${name}.m4a`);
export const SAMPLE_MANIFEST={
 kickHeavy:audioFiles('kick_impact_heavy_01','kick_impact_heavy_02','kick_impact_heavy_03'),
 kickLight:audioFiles('kick_impact_light_01','kick_impact_light_02'),
 metal:audioFiles('metal_crunch_01','metal_crunch_02'),land:audioFiles('truck_land_thud_01','truck_land_thud_02'),
 debris:audioFiles('debris_scatter_01'),dash:audioFiles('whoosh_dash_01'),miss:audioFiles('whoosh_kick_01'),
 pickup:audioFiles('banana_pickup_01','banana_pickup_02','banana_pickup_03'),powerup:audioFiles('powerup_01'),
 shield:audioFiles('shield_block_01'),collision:audioFiles('crash_01'),stunt:audioFiles('stunt_01'),
 jump:audioFiles('jump_01'),launch:audioFiles('launch_01'),go:audioFiles('go_01'),finish:audioFiles('finish_01'),
 wind:audioFiles('wind_loop'),chain:audioFiles('bike_chain_loop'),
};
export class GameAudio {
  constructor() {
    this.enabled=true;this.context=null;this.paused=false;this.samples=new Map();
    this.manifest=SAMPLE_MANIFEST;this.loading=new Map();this.voices=new Map();this.loops=new Map();this.voiceType='tone';
  }
  async loadSamples(manifest=this.manifest) {
    if(!this.context)return;
    this.manifest={...this.manifest,...manifest};
    await Promise.all([...new Set(Object.values(manifest).flat())].map(url=>{
      if(!this.loading.has(url))this.loading.set(url,(async()=>{
        try {
          const response=await fetch(url);if(!response.ok)return;
          this.samples.set(url,await this.context.decodeAudioData(await response.arrayBuffer()));
        } catch { /* Missing/offline/unsupported files retain the synthesis fallback. */ }
      })());
      return this.loading.get(url);
    }));
  }
  track(source,nodes,type=this.voiceType) {
    const list=this.voices.get(type)||[];
    while(list.length>=4)list[0].stop();
    const voice={source,stop:()=>{try{source.stop();}catch{/* Already ended. */}cleanup();}};
    const cleanup=()=>{const i=list.indexOf(voice);if(i>=0)list.splice(i,1);for(const node of nodes)node.disconnect();if(!list.length)this.voices.delete(type);};
    source.onended=cleanup;list.push(voice);this.voices.set(type,list);return voice;
  }
  setPaused(paused) {
    if(this.paused===paused)return;this.paused=paused;
    if(paused)this.reset();
    if(this.context){
      this.master.gain.setValueAtTime(paused||!this.enabled?0:.22,this.context.currentTime);
      Promise.resolve(paused?this.context.suspend():this.enabled?this.context.resume():undefined).catch(()=>{});
    }
  }
  reset() {
    for(const list of [...this.voices.values()])for(const voice of [...list])voice.stop();
    this.voices.clear();
    this.loops.clear();
    if(this.context&&this.wind)this.wind.gain.setValueAtTime(0,this.context.currentTime);
  }
  sample(type) {
    const choices=(this.manifest[type]||[]).filter(url=>this.samples.has(url));
    if(!choices.length)return false;
    const source=this.context.createBufferSource(),amp=this.context.createGain();
    source.buffer=this.samples.get(choices[Math.floor(Math.random()*choices.length)]);
    source.playbackRate.value=.95+Math.random()*.1;amp.gain.value=type==='pickup'?.35:.7;
    source.connect(amp).connect(this.master);this.track(source,[source,amp],type);source.start();return true;
  }
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
      this.paused=false;this.master.gain.setValueAtTime(.22, this.context.currentTime);
      await this.context.resume();
      void this.loadSamples();
    } catch { this.enabled = false; }
  }
  async toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) await this.start();
    else if (this.context) {
      this.reset();
      this.master.gain.setValueAtTime(0, this.context.currentTime);
      try { await this.context.suspend(); } catch { /* Keep a blocked audio device muted. */ }
    }
  }
  update(speed) {
    if (this.context && this.enabled && !this.paused) {
      const level=Math.max(0, Math.min(1, speed / 32.5));
      for(const type of ['wind','chain']){
        const buffer=this.samples.get(this.manifest[type]?.[0]);
        if(speed>0&&buffer&&!this.loops.has(type)){
          const source=this.context.createBufferSource(),amp=this.context.createGain();
          source.buffer=buffer;source.loop=true;source.connect(amp).connect(this.master);
          this.loops.set(type,{...this.track(source,[source,amp],type),amp});source.start();
        }
        const loop=this.loops.get(type);
        if(loop){
          if(speed<=0){loop.stop();this.loops.delete(type);}
          else {loop.amp.gain.setTargetAtTime(level*(type==='wind'?.18:.05),this.context.currentTime,.05);loop.source.playbackRate.value=type==='chain'?.85+level*.3:1;}
        }
      }
      if(this.wind)this.wind.gain.setTargetAtTime(this.loops.has('wind')?0:level*.16, this.context.currentTime, .05);
    }
  }
  tone(frequency, duration = .15, kind = 'sine', gain = .25) {
    if (!this.enabled || this.paused || !this.context || this.context.state !== 'running') return;
    const ctx = this.context, osc = ctx.createOscillator(), amp = ctx.createGain(), now = ctx.currentTime;
    osc.type = kind;
    osc.frequency.setValueAtTime(frequency, now);
    amp.gain.setValueAtTime(.001, now);
    amp.gain.linearRampToValueAtTime(gain, now + .012);
    amp.gain.exponentialRampToValueAtTime(.001, now + duration);
    osc.connect(amp).connect(this.master);
    osc.start();
    osc.stop(now + duration);
    this.track(osc,[osc,amp]);
  }
  sweep(from, to, duration, kind = 'sine', gain = .3) {
    if (!this.enabled || this.paused || !this.context || this.context.state !== 'running') return;
    const ctx = this.context, osc = ctx.createOscillator(), amp = ctx.createGain(), now = ctx.currentTime;
    osc.type = kind;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + duration);
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(.001, now + duration);
    osc.connect(amp).connect(this.master);
    osc.start();
    osc.stop(now + duration);
    this.track(osc,[osc,amp]);
  }
  burst(duration, frequency, gain = .3, type = 'bandpass') {
    if (!this.enabled || this.paused || !this.context || this.context.state !== 'running' || !this.noiseBuffer) return;
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
    this.track(src,[src,filter,amp]);
  }
  event(event) {
    const type = typeof event === 'string' ? event : event.type;
    if(!this.enabled||this.paused||!this.context||this.context.state!=='running')return;
    const key=type==='kick'?(event.charged?'kickHeavy':'kickLight'):type==='pickup'?(event.kind==='banana'?'pickup':'powerup'):type;
    this.voiceType=key;
    if(this.sample(key)){
      if(type==='kick'){this.sample('miss');this.sample('metal');if(event.charged)this.sample('debris');}
      return;
    }
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
    if (type === 'metal' || type === 'land' || type === 'debris') this.burst(.3,type==='metal'?1300:600,.25);
  }
}

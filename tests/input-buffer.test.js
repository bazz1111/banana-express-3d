import test from 'node:test';
import assert from 'node:assert/strict';
import {ActionBuffer} from '../src/inputBuffer.js';
import {createGame,advance,FIXED_STEP} from '../src/game.ts';

const racer=()=>{const g=createGame({mode:'endless',seed:137,chunkLength:80,lookAhead:480,procedural:false});g.phase='racing';return g;};
const input=()=>new ActionBuffer();
const tick=(g,b,held=()=>false,dt=FIXED_STEP)=>{const steps=advance(g,b.sample(held),dt);b.consume(steps);return g.events;};

test('a released jump tap survives a render without a simulation step and fires once',()=>{
  const g=racer(),b=input();b.press('Space');
  assert.equal(advance(g,b.sample(()=>false),FIXED_STEP/2),0);b.consume(0);
  assert.ok(tick(g,b,()=>false,FIXED_STEP/2).some(e=>e.type==='jump'));
  assert.ok(g.jumpHeight>0);assert.equal(b.sample(()=>false).jump,false);
  for(let i=0;i<120;i++)assert.equal(tick(g,b).some(e=>e.type==='jump'),false);
});

test('a released E tap starts one dash, while a held key cannot repeat after cooldown',()=>{
  const g=racer(),b=input();b.press('KeyE');
  assert.ok(tick(g,b,code=>code==='KeyE').some(e=>e.type==='dash'));
  assert.ok(g.buffs.boost>0);
  for(let i=0;i<400;i++)assert.equal(tick(g,b,code=>code==='KeyE').some(e=>e.type==='dash'),false);
});

test('a buffered Q tap kicks a car after a real press/release without a rendered down frame',()=>{
  const g=racer(),b=input();g.obstacles.push({id:'car',type:'car',s:6,lane:2,originalLane:2,kicked:false,hit:false,passed:false,jumpCleared:false,flight:0});
  b.press('KeyQ');tick(g,b);assert.ok(g.charge>0);
  assert.ok(tick(g,b).some(e=>e.type==='kick'));assert.equal(g.kickedCount,1);
  assert.equal(tick(g,b).some(e=>e.type==='kick'),false);
});

test('cancelled Q clears charge without spending cooldown, except while another source still holds Q',()=>{
  const g=racer(),b=input();b.press('KeyQ');tick(g,b,code=>code==='KeyQ');
  b.cancel('KeyQ');tick(g,b);assert.equal(g.charge,0);assert.equal(g.cooldowns.kick,0);assert.equal(g.events.some(e=>e.type==='miss'),false);
  b.press('KeyQ');tick(g,b,code=>code==='KeyQ');b.cancel('KeyQ',true);
  tick(g,b,code=>code==='KeyQ');assert.ok(g.charge>FIXED_STEP);
});

test('pause/reset input clearing and touch cancellation cannot replay queued actions',()=>{
  const b=input(),g=racer();for(const code of ['Space','KeyE','KeyQ'])b.press(code);
  b.clear();tick(g,b);assert.equal(g.jumpHeight,0);assert.equal(g.cooldowns.dash,0);assert.equal(g.charge,0);
  b.press('Space');b.cancel('Space');tick(g,b);assert.equal(g.jumpHeight,0);
});

test('a fresh released press after a held action is distinct even when no tick observed the release',()=>{
  for(const code of ['KeyE','Space']){
    const g=racer(),b=input(),held=c=>c===code;b.press(code);tick(g,b,held);
    for(let i=0;i<400;i++)tick(g,b,held);
    assert.equal(code==='KeyE'?g.cooldowns.dash:g.jumpHeight,0);
    b.press(code);const events=tick(g,b);
    assert.ok(events.some(e=>e.type===(code==='KeyE'?'dash':'jump')),code);
  }
});

test('cancelling touch while a keyboard source holds Q cannot erase its normal same-frame release',()=>{
  const g=racer(),b=input();
  for(let i=0;i<50;i++)tick(g,b,c=>c==='KeyQ');
  b.cancel('KeyQ',true);tick(g,b);
  assert.equal(g.cooldowns.kick,18);assert.ok(g.events.some(e=>e.type==='miss'));
});

test('one physical edge is consumed only on the first catch-up tick',()=>{
  const g=racer(),b=input();g.jumpHeight=.01;g.jumpVelocity=-1;g.cooldowns.dash=.04;
  b.press('Space');b.press('KeyE');const events=tick(g,b,()=>false,.1);
  assert.equal(g.jumpHeight,0);assert.equal(g.cooldowns.dash,0);assert.equal(g.buffs.boost,0);
  assert.equal(events.some(e=>e.type==='jump'||e.type==='dash'),false);
});

test('a fresh Q press after the last source cancelled starts a new charge',()=>{
  const g=racer(),b=input();for(let i=0;i<50;i++)tick(g,b,c=>c==='KeyQ');
  b.cancel('KeyQ');b.press('KeyQ');tick(g,b,c=>c==='KeyQ',.1);
  assert.ok(Math.abs(g.charge-.1)<1e-9);assert.equal(g.cooldowns.kick,0);
});

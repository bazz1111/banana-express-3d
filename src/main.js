import './style.css';
import './reference.css';
import { GameView } from './view.js';
import { GameAudio } from './audio.js';
import { createGame, startRun, advance, togglePause, toggleStance, endRun, resultFor, clamp } from './game.ts';

const $ = id => document.getElementById(id);
const show = (id, visible) => $(id).classList.toggle('hidden', !visible);
const audio = new GameAudio();
const keys = new Set();
const pointers = new Map();
const bestKey = 'banana-endless-best';
let view, game, previousPhase = '', contextLost = false, resultSaved = false, toastRemaining = 0, lastFrame = 0;
let best = readBest();
const running = () => game && ['countdown', 'racing'].includes(game.phase);
const canInteract = () => !contextLost && !document.hidden;
const held = code => keys.has(code) || [...pointers.values()].includes(code);
const formatTime = seconds => {
  const min = Math.floor(seconds / 60), sec = Math.floor(seconds % 60);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

function readBest() {
  try {
    const raw = JSON.parse(localStorage.getItem(bestKey) || '{}');
    return {
      total: Number.isFinite(raw?.total) ? Math.max(0, Math.floor(raw.total)) : 0,
      distance: Number.isFinite(raw?.distance) ? Math.max(0, Math.floor(raw.distance)) : 0,
    };
  } catch { return { total: 0, distance: 0 }; }
}
function bestText() {
  return `本机最佳 ${best.total.toLocaleString()} 分 · 最远 ${best.distance.toLocaleString()} m`;
}
function clearInput() {
  keys.clear();
  pointers.clear();
  for (const id of ['touch-left', 'touch-right', 'touch-jump', 'touch-kick', 'kick-skill']) {
    $(id).classList.remove('pressed');
  }
}
function toast(text, duration = 2200) {
  $('toast').textContent = text;
  toastRemaining = duration / 1000;
  show('toast', true);
}
function start() {
  if (!game || game.phase !== 'ready' || !canInteract()) return;
  clearInput();
  lastFrame = performance.now();
  audio.start();
  startRun(game);
  feedback();
  updateUI();
  $('game-canvas').focus({ preventScroll: true });
}
function reset() {
  if (!view || !canInteract()) return;
  clearInput();
  game = createGame(view.course);
  view.reset(game);
  resultSaved = false;
  previousPhase = '';
  toastRemaining = 0;
  show('toast', false);
  $('impact').classList.remove('show');
  start();
}
function pause() {
  if (!game || !canInteract() || !['countdown', 'racing', 'paused'].includes(game.phase)) return;
  clearInput();
  togglePause(game);
  lastFrame = performance.now();
  audio.update(0);
  updateUI();
  if (game.phase !== 'paused') {
    audio.start();
    $('game-canvas').focus({ preventScroll: true });
  }
}
function freeze() {
  clearInput();
  lastFrame = performance.now();
  if (running()) togglePause(game);
  audio.update(0);
  if (game) updateUI();
}
function finish() {
  if (!game || !canInteract() || !['countdown', 'racing', 'paused'].includes(game.phase)) return;
  clearInput();
  endRun(game);
  feedback();
  audio.update(0);
  updateUI();
}
function changeStance() {
  if (!game || !canInteract() || !['ready', 'countdown', 'racing'].includes(game.phase)) return;
  toggleStance(game);
  updateUI();
  $('game-canvas').focus({ preventScroll: true });
}

$('start').addEventListener('click', start);
$('restart').addEventListener('click', reset);
$('stance').addEventListener('click', changeStance);
for (const id of ['pause', 'resume']) $(id).addEventListener('click', pause);
for (const id of ['end-run', 'end-paused']) $(id).addEventListener('click', finish);
$('reload').addEventListener('click', () => location.reload());
$('sound').addEventListener('click', async () => {
  await audio.toggle();
  updateSound();
});
$('quality').addEventListener('click', () => {
  if (!view || contextLost) return;
  view.setQuality(view.quality === 'high' ? 'low' : 'high');
  $('quality').textContent = `画质 · ${view.quality === 'high' ? '高' : '低'}`;
});

for (const [id, code] of [
  ['touch-left', 'KeyA'], ['touch-right', 'KeyD'], ['touch-jump', 'Space'],
  ['touch-kick', 'KeyQ'], ['kick-skill', 'KeyQ'],
]) {
  const button = $(id);
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (!canInteract() || game?.phase !== 'racing') return;
    pointers.set(event.pointerId, code);
    button.classList.add('pressed');
    button.setPointerCapture(event.pointerId);
    audio.start();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, event => {
      pointers.delete(event.pointerId);
      button.classList.remove('pressed');
    });
  }
}
window.addEventListener('keydown', event => {
  if (event.code === 'Escape' && !event.repeat) {
    event.preventDefault();
    pause();
    return;
  }
  if (event.target?.tagName === 'BUTTON' && ['Enter', 'Space'].includes(event.code)) return;
  if (!canInteract() || !game || game.phase === 'paused' || game.phase === 'finished') return;
  if (event.code === 'KeyC') {
    event.preventDefault();
    if (!event.repeat) changeStance();
    return;
  }
  if (game.phase === 'ready' && ['Enter', 'Space'].includes(event.code) && !event.repeat) {
    event.preventDefault();
    start();
    return;
  }
  if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyQ'].includes(event.code)) {
    event.preventDefault();
    if (game.phase === 'racing') keys.add(event.code);
  }
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', freeze);
document.addEventListener('visibilitychange', () => { if (document.hidden) freeze(); });
$('game-canvas').addEventListener('webglcontextlost', event => {
  event.preventDefault();
  freeze();
  contextLost = true;
  $('error-title').textContent = '画面暂时中断';
  $('error-message').textContent = '骑行与所有计时已暂停。画面恢复后，点击继续骑行；也可以重新载入游戏。';
  show('error-panel', true);
  if (game) updateUI();
});
$('game-canvas').addEventListener('webglcontextrestored', () => {
  if (!contextLost) return;
  contextLost = false;
  show('error-panel', false);
  if (game) {
    clearInput();
    game.accumulator = 0;
    lastFrame = performance.now();
    toast('画面已恢复，点击继续骑行。', 3000);
    updateUI();
  }
});

function saveResult() {
  if (resultSaved) return;
  resultSaved = true;
  const result = resultFor(game);
  $('result-title').textContent = result.reason === 'collision' ? '这趟，彪得漂亮。' : '歇会儿，再开彪。';
  $('result-copy').textContent = game.failure || '每一米都算数，下一趟还能更远。';
  $('result-reason').textContent = result.reason === 'collision' ? '撞到障碍' : '主动结束';
  $('result-distance').textContent = `${result.distance.toLocaleString()} m`;
  $('result-bananas').textContent = `${result.bananas.toLocaleString()} 根`;
  $('result-time').textContent = formatTime(result.elapsed);
  $('result-total').textContent = result.total.toLocaleString();
  best = { total: Math.max(best.total, result.total), distance: Math.max(best.distance, result.distance) };
  try {
    localStorage.setItem(bestKey, JSON.stringify(best));
    $('personal-best').textContent = bestText();
  } catch {
    $('personal-best').textContent = '本次成绩已结算，浏览器未允许保存纪录。';
  }
  $('ready-best').textContent = bestText();
}
function updateSound() {
  $('sound').textContent = `音效 · ${audio.enabled ? '开' : '关'}`;
  $('sound').setAttribute('aria-pressed', String(audio.enabled));
}
function updateUI() {
  const phase = game.phase;
  const active = ['countdown', 'racing', 'paused'].includes(phase);
  if (phase !== previousPhase) {
    show('welcome', phase === 'ready');
    show('mission-card', phase === 'ready');
    show('countdown', phase === 'countdown');
    show('hud', active);
    show('skills', active);
    show('buffs', active);
    show('touch-controls', phase === 'racing');
    show('modal', phase === 'paused' || phase === 'finished');
    show('pause-panel', phase === 'paused');
    show('result-panel', phase === 'finished');
    document.body.classList.toggle('race-active', active);
    if (phase === 'finished') { clearInput(); saveResult(); }
    previousPhase = phase;
  }
  $('app').dataset.phase = phase;
  $('stance').disabled = !canInteract() || !['ready', 'countdown', 'racing'].includes(phase);
  $('stance').textContent = `骑姿 · ${game.stance === 'standing' ? '站姿' : '坐姿'}`;
  $('stance').setAttribute('aria-pressed', String(game.stance === 'standing'));
  $('pause').disabled = !active || contextLost;
  $('pause').textContent = phase === 'paused' ? '继续' : '暂停';
  $('pause').setAttribute('aria-label', phase === 'paused' ? '继续骑行' : '暂停骑行');
  $('end-run').disabled = !active || contextLost;
  $('resume').disabled = !canInteract();
  $('end-paused').disabled = !canInteract();
  $('kick-skill').disabled = phase !== 'racing' || contextLost;
  $('countdown').textContent = Math.max(1, Math.ceil(game.countdown));
  $('score').textContent = Math.floor(game.score).toLocaleString();
  $('distance').textContent = Math.floor(game.s).toLocaleString();
  $('banana-count').textContent = game.bananas.toLocaleString();
  $('speed').textContent = Math.round(game.speed * 3.6);
  $('timer').textContent = formatTime(game.elapsed);
  $('combo').textContent = `×${game.combo.toFixed(1)}`;
  $('chain').textContent = `${game.chain} 连击`;
  const kick = game.cooldowns.kick;
  const charge = clamp(game.charge / .8, 0, 1);
  $('kick-seconds').textContent = kick > 0 ? `${Math.ceil(kick)}s` : charge > 0 ? `${Math.round(charge * 100)}%` : '就绪';
  $('kick-skill').classList.toggle('cooldown', kick > 0);
  $('kick-skill').classList.toggle('charged', charge === 1);
  $('kick-status').textContent = kick > 0 ? `${Math.ceil(kick)} 秒后再踢` : charge === 1 ? '蓄力完成，靠近卡车松开！' : charge > 0 ? '按住 Q 蓄力，松开飞踢' : '点踢汽车 · 蓄力 0.8 秒踢卡车';
  $('kick-bar').style.width = `${kick > 0 ? (1 - kick / 18) * 100 : charge * 100}%`;
  for (const kind of ['boost', 'shield', 'double']) {
    const remaining = game.buffs[kind];
    $(`buff-${kind}`).classList.toggle('active', remaining > 0);
    $(`buff-${kind}-time`).textContent = remaining > 0 ? `${remaining.toFixed(1)}s` : '—';
  }
  show('toast', toastRemaining > 0 && phase !== 'finished');
  updateSound();
}
function feedback() {
  const events = game.events.splice(0);
  if (!events.length) return;
  view.events(events, game);
  for (const event of events) {
    audio.event(event);
    if (event.type === 'pickup' && event.kind !== 'banana') {
      toast({ boost: '加速 5 秒，冲起来！', shield: '护盾 8 秒，抵挡一次碰撞', double: '双倍分 10 秒，抓住这一段！' }[event.kind]);
    }
    if (event.type === 'kick') {
      toast(event.charged ? '重踢命中！车辆起飞！' : '飞踢命中！汽车起飞！');
      $('impact').textContent = '走你！';
      $('impact').classList.remove('show');
      void $('impact').offsetWidth;
      $('impact').classList.add('show');
    }
    if (event.type === 'miss') toast(event.charged ? '踢空了，靠近车辆再松开 Q。' : '汽车可以点踢，卡车需蓄力 0.8 秒。');
    if (event.type === 'shield') toast('护盾挡住了！继续向前。', 1800);
    if (event.type === 'stunt') toast(`${event.label} +${event.points} 分`, 1200);
    if (event.type === 'go') toast('自动向前 · 左右避障 · Space 跳跃', 2800);
  }
}

async function boot() {
  $('ready-best').textContent = bestText();
  try {
    view = new GameView($('game-canvas'), (done, total) => {
      $('load-status').textContent = `准备山路 ${Math.round(clamp(done / Math.max(1, total), 0, 1) * 100)}%`;
    });
    await view.load();
    game = createGame(view.course);
    view.reset(game);
    window.__bananaGame = { get game() { return game; }, view };
    $('start').disabled = false;
    $('start').innerHTML = '开始骑行 <span>→</span>';
    $('load-status').textContent = '山路已就绪';
    if (!view.motion) document.body.classList.add('reduced-motion');
    updateUI();
    lastFrame = performance.now();
    const frame = now => {
      const dt = Math.min(.1, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      const activeDt = running() && canInteract() ? dt : 0;
      if (!contextLost) {
        advance(game, {
          steer: (held('KeyD') || held('ArrowRight') ? 1 : 0) - (held('KeyA') || held('ArrowLeft') ? 1 : 0),
          jump: held('Space'), kick: held('KeyQ'),
        }, activeDt);
        feedback();
        view.update(game, activeDt);
      }
      toastRemaining = Math.max(0, toastRemaining - activeDt);
      updateUI();
      audio.update(game.phase === 'racing' && canInteract() ? game.speed : 0);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    $('start').disabled = true;
    $('load-status').textContent = '载入失败，请重试';
    $('error-title').textContent = '山路未能载入';
    $('error-message').textContent = `${error.message || '无法建立 3D 场景。'} 请确认资源完整，并使用支持 WebGL 2 的浏览器。`;
    show('error-panel', true);
  }
}
boot();

import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/');await page.locator('#start:not([disabled])').waitFor({timeout:30000});
  await page.clock.install();await page.click('#start');await page.clock.runFor(3400);
  await page.evaluate(()=>{window.__lostContext=document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');window.__lostContext.loseContext();});
  await page.clock.runFor(100);const before=await page.evaluate(()=>({s:window.__bananaGame.game.s,time:window.__bananaGame.game.elapsed}));
  await page.clock.runFor(3000);const after=await page.evaluate(()=>({s:window.__bananaGame.game.s,time:window.__bananaGame.game.elapsed}));
  assert.deepEqual(after,before,'Context loss must freeze endless motion and time');
  assert.equal(await page.locator('#app').getAttribute('data-phase'),'paused');assert.equal(await page.locator('#error-panel').isVisible(),true);
  await page.evaluate(()=>window.__lostContext.restoreContext());await page.clock.runFor(100);await page.locator('#error-panel').waitFor({state:'hidden',timeout:10000});
  assert.equal(await page.locator('#app').getAttribute('data-phase'),'paused','Restoration must require explicit resume');
  await page.click('#resume');await page.clock.runFor(1000);assert.equal(await page.locator('#app').getAttribute('data-phase'),'racing');
  assert.ok(await page.evaluate(s=>window.__bananaGame.game.s>s,before.s));console.log('ENDLESS_CONTEXT_RECOVERY_PASS');
}finally{await browser.close();}

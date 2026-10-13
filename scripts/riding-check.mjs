import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/');await page.locator('#start:not([disabled])').waitFor({timeout:30000});await page.clock.install();
  const pose=()=>page.evaluate(()=>{
    const {game:g,view:v}=window.__bananaGame;v.update(g,0);v.scene.updateMatrixWorld(true);
    const local=o=>v.player.position.clone().setFromMatrixPosition(o.matrixWorld).applyMatrix4(v.player.matrixWorld.clone().invert()).toArray();
    return {stance:g.stance,blend:v.stanceBlend,feet:v.feet.map(local),hands:v.hands.map(local),pedals:v.pedals.map(local),phase:g.phase,s:g.s,banana:g.bananas,score:g.score};
  });
  const seated=await pose();assert.equal(seated.stance,'seated');
  const checkSeated=p=>{for(let i=0;i<2;i++){
    assert.ok(Math.hypot(...p.feet[i].map((n,c)=>n-p.pedals[i][c]-[0,.138,-.075][c]))<1e-5,'Imported seated feet must follow their real pedals');
    const side=i===0?-1:1;assert.ok(Math.hypot(...p.hands[i].map((n,c)=>n-[side*.36,1.20,.50][c]))<1e-5,'Imported seated hands must touch handlebars');
  }};
  checkSeated(seated);await page.screenshot({path:'artifacts/riding-seated.png'});
  await page.keyboard.press('KeyC');await page.clock.runFor(100);const standing=await pose();assert.equal(standing.stance,'standing');
  for(const [i,target] of [[0,[-.30,1.311,.58]],[1,[.04,1.233,-.21]]])assert.ok(Math.hypot(...standing.feet[i].map((n,c)=>n-target[c]))<1e-5);
  await page.screenshot({path:'artifacts/riding-standing.png'});await page.click('#stance');await page.clock.runFor(100);checkSeated(await pose());
  await page.click('#start');await page.clock.runFor(3250);await page.keyboard.press('KeyC');await page.clock.runFor(100);
  const transition=await pose();assert.ok(transition.blend>0&&transition.blend<1,'Racing transitions must interpolate');
  await page.clock.runFor(900);assert.ok((await pose()).blend>.999);await page.click('#stance');await page.clock.runFor(1100);checkSeated(await pose());
  await page.clock.runFor(300);checkSeated(await pose());
  const beforeCharge=await pose();await page.keyboard.down('KeyQ');await page.clock.runFor(17);const chargeStart=await pose();
  const footMovement=(a,b)=>Math.max(...a.feet.map((foot,i)=>Math.hypot(...foot.map((n,c)=>n-b.feet[i][c]))));
  assert.ok(footMovement(beforeCharge,chargeStart)<.04,'Seated charge must not reset the feet to standing rest');
  await page.clock.runFor(250);const beforeRelease=await pose();await page.keyboard.up('KeyQ');await page.clock.runFor(17);const kickStart=await pose();
  assert.ok(footMovement(beforeRelease,kickStart)<.04,'Release must smoothly enter the kick');
  await page.clock.runFor(1700);checkSeated(await pose());
  await page.keyboard.press('Escape');await page.clock.runFor(100);const before=await pose();await page.keyboard.press('KeyC');await page.clock.runFor(1000);assert.deepEqual(await pose(),before);
  assert.ok(await page.locator('#stance').isDisabled());await page.click('#end-paused');await page.clock.runFor(100);await page.click('#restart');await page.clock.runFor(100);assert.equal((await pose()).stance,'seated');
  assert.equal(errors.length,0,errors.join('\n'));const kickMovement={chargeStart:footMovement(beforeCharge,chargeStart),release:footMovement(beforeRelease,kickStart)};
  fs.writeFileSync('artifacts/riding-report.json',JSON.stringify({seated,standing,transition,kickMovement,errors},null,2));console.log('RIDING_SWITCH_PASS',JSON.stringify({seated,standing,transition,kickMovement,errors}));
}finally{await browser.close();}

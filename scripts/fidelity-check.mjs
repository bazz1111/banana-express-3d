import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  fs.mkdirSync('artifacts',{recursive:true});
  for(const [width,height,label] of [[1440,900,'desktop'],[390,844,'mobile']]){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/');await page.locator('#start:not([disabled])').waitFor({timeout:30000});
    await page.clock.install();
    assert.equal(await page.evaluate(()=>window.__bananaGame.game.stance),'seated','Default pose must be seated');
    const stanceButton=await page.locator('#stance').boundingBox();
    assert.ok(stanceButton&&stanceButton.x>=0&&stanceButton.x+stanceButton.width<=width,'Pose switch must remain visible on narrow screens');
    await page.click('#stance');await page.clock.runFor(100);
    assert.equal(await page.evaluate(()=>window.__bananaGame.game.stance),'standing');
    const result=await page.evaluate(async()=>{
      const {view,game}=window.__bananaGame;
      view.update(game,0);view.scene.updateMatrixWorld(true);
      const feet=view.feet.map(o=>view.player.position.clone().setFromMatrixPosition(o.matrixWorld).applyMatrix4(view.player.matrixWorld.clone().invert()).toArray());
      const forest=view.valleyBatches.ValleyForest;
      let cargoRendered=false;view.cargo.onAfterRender=()=>{cargoRendered=true;};
      game.bananas=30;view.update(game,0);const cargoBounds=view.cargo.boundingSphere.radius;
      game.bananas=0;view.update(game,0);view.cargo.onAfterRender=()=>{};
      return {feet,cargoRendered,cargoBounds,forest:forest.count,scrollWidth:document.documentElement.scrollWidth,width:innerWidth};
    });
    assert.ok(result.forest>500,'Imported forest must sit on actual layer-1 hills');
    assert.ok(result.cargoRendered&&result.cargoBounds>0,'Collected Blender banana bundles must be drawn on the rack');
    for(const [i,target] of [[0,[-.30,1.311,.58]],[1,[.04,1.233,-.21]]])for(let c=0;c<3;c++)assert.ok(Math.abs(result.feet[i][c]-target[c])<.00001,'Actual imported foot must remain on Blender support');
    assert.equal(result.scrollWidth,result.width,'UI must not overflow horizontally');
    await page.click('#stance');await page.clock.runFor(100);
    assert.equal(await page.evaluate(()=>window.__bananaGame.game.stance),'seated');
    await page.screenshot({path:`artifacts/endless-${label}.png`});
    await page.click('#start');await page.clock.runFor(3150);
    const hudStress=await page.evaluate(()=>{
      const values={'banana-count':'150,000',timer:'1388:59',speed:'117',score:'9,999,999',distance:'1,000,000',combo:'×2.0',chain:'9999 连击'},saved={};
      for(const [id,value] of Object.entries(values)){const e=document.getElementById(id);saved[id]=e.textContent;e.textContent=value;}
      const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};};
      const result={banana:rect('.banana-hud'),timer:rect('.timer-hud'),speed:rect('.speed-hud'),auxiliary:rect('.hud-secondary'),label:rect('#timer')};
      for(const [id,value] of Object.entries(saved))document.getElementById(id).textContent=value;
      return result;
    });
    assert.ok(hudStress.banana.right+4<=hudStress.timer.left&&hudStress.timer.right+4<=hudStress.speed.left,'Long numbers must not overlap the three prototype anchors');
    assert.ok(hudStress.auxiliary.right<=width&&hudStress.label.left>=hudStress.timer.left&&hudStress.label.right<=hudStress.timer.right,'Long run values must stay inside the HUD');
    if(label==='mobile'){
      const right=await page.locator('#touch-right').boundingBox();assert.ok(right);
      await page.mouse.move(right.x+right.width/2,right.y+right.height/2);await page.mouse.down();await page.clock.runFor(450);await page.mouse.up();
    }else{await page.keyboard.down('KeyD');await page.clock.runFor(450);await page.keyboard.up('KeyD');}
    const lane=await page.evaluate(()=>window.__bananaGame.game.lane);assert.ok(lane>.5&&lane<2,'Input must move continuously rather than snap to a fixed track');
    await page.keyboard.press('Escape');await page.clock.runFor(100);assert.equal(await page.locator('#app').getAttribute('data-phase'),'paused');
    assert.ok(await page.locator('#stance').isDisabled());
    await page.screenshot({path:`artifacts/endless-${label}-paused.png`});
    await page.click('#end-paused');await page.clock.runFor(100);await page.click('#restart');await page.clock.runFor(100);
    assert.ok(await page.evaluate(()=>window.__bananaGame.view.wheels.every(o=>o.rotation.x===0)), 'Restart during countdown must clear wheel state');
    assert.equal(await page.evaluate(()=>window.__bananaGame.game.stance),'seated');
    console.log('ENDLESS_VISUAL_INPUT_PASS',label,JSON.stringify({...result,hudStress}));await page.close();
  }
}finally{await browser.close();}

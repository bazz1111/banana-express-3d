// Same frozen distance, camera and load on both builds. Injected art fixtures,
// never a scored run. BEFORE_URL must point to an immutable main checkout.
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const [label,url]of [['before',process.env.BEFORE_URL],['after',process.env.GAME_URL||'http://127.0.0.1:4173/']]){
    if(!url)continue;
    const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
    await page.goto(url);await page.locator('#start:not([disabled])').waitFor({timeout:60000});await page.clock.install();await page.clock.pauseAt(new Date());
    await page.click('#start');await page.clock.runFor(3200);
    await page.evaluate(()=>{const {game:g,view:v}=window.__bananaGame;g.course.procedural=false;Object.assign(g,{s:200,phase:'racing',speed:12,lane:0,lateralSpeed:0,stance:'seated',bananas:85,score:0,elapsed:0,jumpHeight:0,jumpVelocity:0,charge:0,kickPose:0,obstacles:[],pickups:[],buffs:{boost:0,shield:0,double:0}});v.reset(g);v.update(g,0);});
    await page.clock.runFor(17);
    await page.evaluate(()=>{const {game:g,view:v}=window.__bananaGame;g.s=200;g.elapsed=0;v.reset(g);v.update(g,0);document.getElementById('toast').classList.add('hidden');document.getElementById('timer').textContent='00:00';document.getElementById('score').textContent='0';document.getElementById('distance').textContent='200';});
    await page.screenshot({path:`verification/next-${label}-scene.png`});await page.close();
  }
  fs.writeFileSync('verification/next-comparison.json',JSON.stringify({fixture:true,naturalPlay:false,distance:200,bananas:85,size:[1440,900],scope:'Same frozen art fixture; body/scene changes, no player-earned score'},null,2)+'\n');
}finally{await browser.close();}

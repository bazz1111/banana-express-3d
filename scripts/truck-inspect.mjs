import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1200,height:800},deviceScaleFactor:1});
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/');
  await page.waitForFunction(()=>window.__bananaGame?.view.lastGame);
  await page.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now())+1);
  await page.addStyleTag({content:'#app > :not(canvas){visibility:hidden!important}'});
  fs.mkdirSync('artifacts',{recursive:true});
  for(const [name,position] of [['rear',[4,3.3,-6]],['front',[-4,2.8,6]],['under',[3,-1.5,-5]]]){
    const report=await page.evaluate(async position=>{
      const {Scene,PerspectiveCamera,HemisphereLight,DirectionalLight,Box3}=await import('/node_modules/.vite/deps/three.js');
      const {view}=window.__bananaGame,scene=new Scene(),truck=view.clone('truck');
      scene.background=view.scene.background;scene.add(truck);
      scene.add(new HemisphereLight(0xbfe7ff,0x997847,1.55));
      const sun=new DirectionalLight(0xffedcd,3);sun.position.set(-45,90,-35);scene.add(sun);
      const camera=new PerspectiveCamera(45,view.canvas.clientWidth/view.canvas.clientHeight,.1,100);
      camera.position.set(...position);camera.lookAt(0,1.3,0);
      view.renderer.shadowMap.enabled=false;view.renderer.clear();view.renderer.render(scene,camera);
      const materials=[];truck.traverse(o=>{if(o.isMesh)materials.push(o.material.name);});
      const bounds=new Box3().setFromObject(truck);
      return {min:bounds.min.toArray(),max:bounds.max.toArray(),materials};
    },position);
    await page.locator('#game-canvas').screenshot({path:`artifacts/truck-${name}.png`});
    if(name==='rear')fs.writeFileSync('artifacts/truck-inspection.json',JSON.stringify(report,null,2));
  }
  console.log('TRUCK_THREEJS_VIEWS_SAVED');
}finally{await browser.close();}

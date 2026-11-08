const fs=require('fs'), path=require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.resolve(__dirname,'..','dist','Race-AiNote.html'),'utf8');
const errors=[];
const dom = new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://local.test/',beforeParse(w){
  w.HTMLCanvasElement.prototype.getContext=function(){return new Proxy({},{get(t,k){if(k==='measureText')return()=>({width:10});return()=>{};},set(){return true;}})};
  w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  w.addEventListener('error',e=>errors.push(e.message));
}});
setTimeout(()=>{
  const w=dom.window, api=w.__raceAiNote;
  console.log(JSON.stringify({errors, hasApi:!!api, nodes:api&&api.state.nodes.length, singleFileScripts:w.document.querySelectorAll('script[src]').length, styles:w.document.querySelectorAll('style').length}));
  process.exit(errors.length?1:0);
},300);

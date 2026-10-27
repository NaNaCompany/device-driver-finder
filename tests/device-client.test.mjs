import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

class Element {
  constructor({value='',dataset={},text=''}={}) { this.value=value; this.dataset=dataset; this.textContent=text; this.hidden=false; this.children=[]; this.handlers={}; this.options=[]; }
  addEventListener(name,callback) { this.handlers[name]=callback; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=[...nodes]; }
  focus() { this.focused=true; }
  fire(name) { return this.handlers[name]?.({preventDefault(){}}); }
}
function fixture(config, selectors={}) {
  const classes=new Set();
  const elements={'#app-config':new Element({text:JSON.stringify(config)}),'#status':new Element(),...selectors};
  for (const [selector,element] of Object.entries(elements)) if (selector.startsWith('#')) element.id=selector.slice(1);
  return {elements,documentElement:{classList:{add(value){classes.add(value);},contains(value){return classes.has(value);}}},
    querySelector(selector){return elements[selector]||null;},querySelectorAll(selector){return selector==='[data-record]'?(elements.cards||[]):selector.endsWith('form button')?(elements.formButtons||[]):[];},
    createElement(tag){const node=new Element(); node.tagName=tag; return node;}};
}
const ui={copied:'Copied',copyFailed:'Copy failed',results:'Results: {n}',unknown:'Unknown',notProvided:'Not provided',loadFailed:'Load failed',loading:'Loading',namespace:'Namespace',vendorId:'Vendor',deviceId:'Device',manufacturer:'Manufacturer',architecture:'Architecture',brand:'Brand',details:'Details',driver:'Driver'};
async function client(name) {
  let source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
  source=source.replace("'./core.mjs'",JSON.stringify(new URL('../src/core.mjs',import.meta.url).href));
  for(const core of ['device-core.mjs','cuda-core.mjs']) source=source.replace(`'./${core}'`,JSON.stringify(new URL('../src/'+core,import.meta.url).href));
  return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
function mockGlobal(name,value) {
  const before=Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  return ()=>before?Object.defineProperty(globalThis,name,before):delete globalThis[name];
}
const allText=node=>[node.textContent,...node.children.map(allText)].join(' ');

test('device client passes real click activation and renders metadata as literal text',async()=>{
  let calls=0,serialRead=false,waitForDevice=false,releaseDevice;
  const selected={vendorId:0x2341,productId:0x43,productName:'<img src=x onerror=alert(1)>',manufacturerName:'Arduino'};
  Object.defineProperty(selected,'serialNumber',{get(){serialRead=true;throw Error('Serial read');}});
  const restores=[mockGlobal('location',{href:'https://example.test/en/',origin:'https://example.test',hash:''}),mockGlobal('isSecureContext',true),
    mockGlobal('navigator',{userActivation:{isActive:false},usb:{requestDevice(){calls++;return waitForDevice?new Promise(resolve=>{releaseDevice=resolve;}):Promise.resolve(selected);}}}),
    mockGlobal('fetch',async()=>({ok:true,json:async()=>({vendors:[{namespace:'usb',vendorId:'2341',brand:'Arduino',supportUrl:'https://support.arduino.cc/'}]})}))];
  try {
    const {initDevice}=await client('device-app.js');
    const messages={'user-gesture-required':'Click directly','ok':'OK','product-name':'Product','manufacturer-name':'Maker','support-link':'Support','vendor-limited':'Limited','device-limited':'Picker only'};
    const usb=new Element();usb.disabled=true;
    const root=fixture({ui,messages,dataURL:'../data.json'},{'#device-form':new Element(),'#device-result':new Element(),'#usb-button':usb,'#clear-device-results':new Element(),'#hardware-id':new Element({value:'private input'})});
    root.elements['#status'].textContent=ui.loading;
    await initDevice(root);
    assert.equal(root.elements['#status'].textContent,'');
    assert.equal(usb.disabled,false);
    root.elements['#usb-button'].fire('click'); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls,0); assert.equal(root.elements['#status'].textContent,'Click directly');
    navigator.userActivation.isActive=true;
    root.elements['#usb-button'].fire('click'); assert.equal(calls,1);
    await new Promise(resolve=>setImmediate(resolve));
    assert(allText(root.elements['#device-result']).includes('<img src=x onerror=alert(1)>'));
    assert(!serialRead); assert(root.elements['#device-result'].children.every(child=>!('innerHTML' in child)));
    waitForDevice=true;usb.fire('click');assert.equal(usb.disabled,true);
    root.elements['#clear-device-results'].fire('click');releaseDevice(selected);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(root.elements['#hardware-id'].value,'');assert.equal(root.elements['#device-result'].children.length,0);
    assert.equal(root.elements['#status'].textContent,'');assert.equal(usb.disabled,false);
  } finally {restores.reverse().forEach(restore=>restore());}
});

test('Device detail page initializes without controls or data fetch',async()=>{
  const restore=mockGlobal('fetch',()=>{throw Error('Detail page fetched data');});
  try {
    const module=await client('device-app.js'),root=fixture({ui,messages:{}});
    await module.initDevice(root);
    assert(root.documentElement.classList.contains('app-ready'));
  } finally {restore();}
});

test('Device rejects cross-origin static data before fetching or enabling controls',async()=>{
  let fetchCount=0;
  const restores=[mockGlobal('location',{href:'https://example.test/en/',origin:'https://example.test',hash:''}),mockGlobal('fetch',()=>{fetchCount++;throw Error('Unexpected fetch');})];
  try {
    const module=await client('device-app.js'),button=new Element();button.disabled=true;
    const root=fixture({ui,messages:{},dataURL:'https://other.test/data.json'},{'#device-form':new Element(),formButtons:[button]});
    await assert.rejects(module.initDevice(root),/DATA_ORIGIN/);
    assert.equal(button.disabled,true);assert(!root.documentElement.classList.contains('app-ready'));
    assert.equal(fetchCount,0);
  } finally {restores.reverse().forEach(restore=>restore());}
});

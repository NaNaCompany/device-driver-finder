import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const dictionary = JSON.parse(await readFile(new URL('../src/messages.json', import.meta.url), 'utf8')).messages;
const vendors = JSON.parse(await readFile(new URL('../src/data.json', import.meta.url), 'utf8')).vendors;
const source = (await readFile(new URL('../src/app.js', import.meta.url), 'utf8'))
  .replace("'./device-core.mjs'", JSON.stringify(new URL('../src/device-core.mjs', import.meta.url).href));
const {initDevice} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

class Element {
  constructor(value = '') { this.value = value; this.textContent = ''; this.children = []; this.handlers = {}; this.id = ''; this.disabled = false; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  append(...values) { this.children.push(...values); }
  replaceChildren(...values) { this.children = values; }
  set innerHTML(_) { throw new Error('Unsafe DOM sink'); }
  fire(name) { return this.handlers[name]?.({preventDefault() {}}); }
}
const ui = {unknown:'UNKNOWN',loading:'LOADING',namespace:'Namespace',manufacturer:'Manufacturer',vendorId:'Vendor ID',deviceId:'Device ID',brand:'Brand',architecture:'Architecture',details:'Details',notProvided:'NOT PROVIDED'};
const text = node => [node.textContent, ...node.children.map(text)].join(' ');
function fixture(lang) {
  const elements = Object.fromEntries(['status','device-form','device-result','usb-button','hid-button','gpu-button','hardware-id','namespace','manual-submit','clear-device-results'].map(id => ['#' + id,Object.assign(new Element(),{id})]));
  elements['#app-config'] = new Element();
  elements['#app-config'].textContent = JSON.stringify({ui,messages:dictionary[lang],dataURL:'../data.json'});
  return {elements,querySelector:selector=>elements[selector] || null,
    querySelectorAll:selector=>selector === '#device-form button' ? [elements['#manual-submit'],elements['#clear-device-results']] : [],
    createElement:tag=>Object.assign(new Element(),{tagName:tag}),documentElement:{classList:{add(){}}}};
}
function mock(name,value) {
  const old = Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  return () => old ? Object.defineProperty(globalThis,name,old) : delete globalThis[name];
}
const flush = () => new Promise(resolve=>setImmediate(resolve));

test('independent review: all six UI languages preserve denied, cancelled and unavailable outcomes without scanning', async () => {
  let pickerCalls=0, datasetFetches=0;
  const failScan=()=>{throw Error('Unauthorized enumeration or device access');};
  const nav={userActivation:{isActive:true},usb:{getDevices:failScan,requestDevice:async()=>{pickerCalls++;throw Object.assign(Error('private error data'),{name:'NotAllowedError'});}},hid:{getDevices:failScan,requestDevice:async()=>{pickerCalls++;throw Object.assign(Error('private error data'),{name:'NotFoundError'});}}};
  const restores=[mock('location',{href:'https://review.invalid/en/',origin:'https://review.invalid'}),mock('isSecureContext',true),mock('navigator',nav),mock('fetch',async(url,options)=>{datasetFetches++;assert.equal(url.origin,'https://review.invalid');assert.equal(url.search,'');assert.equal(options.mode,'same-origin');return {ok:true,json:async()=>({vendors})};})];
  try {
    for(const lang of ['ko','en','es','zh','ja','de']) {
      const root=fixture(lang),before=pickerCalls;
      await initDevice(root);assert.equal(pickerCalls,before,'initialization cannot open a picker');
      root.elements['#usb-button'].fire('click');await flush();assert.equal(root.elements['#status'].textContent,dictionary[lang]['permission-denied']);
      root.elements['#hid-button'].fire('click');await flush();assert.equal(root.elements['#status'].textContent,dictionary[lang].cancelled);
      root.elements['#gpu-button'].fire('click');await flush();assert.equal(root.elements['#status'].textContent,dictionary[lang]['api-unavailable']);
      root.elements['#hardware-id'].value='USB\\VID_2341&PID_0043\\PRIVATE-SERIAL';
      root.elements['#namespace'].value='';root.elements['#device-form'].fire('submit');
      assert.equal(root.elements['#status'].textContent,dictionary[lang].ok);
      assert(!text(root.elements['#device-result']).includes('PRIVATE-SERIAL'));
      assert(!text(root.elements['#device-result']).includes('undefined'));
      const link=root.elements['#device-result'].children.find(child=>child.tagName==='a');
      assert.equal(link.href,'https://support.arduino.cc/');assert.equal(link.referrerPolicy,'no-referrer');
    }
    assert.equal(pickerCalls,12);assert.equal(datasetFetches,6);
  } finally {restores.reverse().forEach(restore=>restore());}
});

test('independent review: HID and GPU malicious strings are literal text and serial/device interfaces are untouched',async()=>{
  const attack='<img src=x onerror=alert(1)>',trap=()=>{throw Error('Sensitive device API read');};
  const device={vendorId:0x2341,productId:0x0043,productName:attack};
  for(const name of ['serialNumber','open','sendReport','receiveFeatureReport','manufacturerName'])Object.defineProperty(device,name,{get:trap});
  const nav={userActivation:{isActive:true},hid:{requestDevice:async()=>[device],getDevices:trap},gpu:{requestAdapter:async()=>({info:{vendor:attack,description:attack}})}};
  const restores=[mock('location',{href:'https://review.invalid/en/',origin:'https://review.invalid'}),mock('isSecureContext',true),mock('navigator',nav),mock('fetch',async()=>({ok:true,json:async()=>({vendors})}))];
  try {
    const root=fixture('en');await initDevice(root);
    root.elements['#hid-button'].fire('click');await flush();assert(text(root.elements['#device-result']).includes(attack));
    root.elements['#gpu-button'].fire('click');await flush();assert(text(root.elements['#device-result']).includes(attack));
    assert.equal(root.elements['#status'].textContent,dictionary.en.ok);
  } finally {restores.reverse().forEach(restore=>restore());}
});

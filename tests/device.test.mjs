import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEVICE_STATUS, parseHardwareId, lookupVendor, requestUsbMetadata, requestHidMetadata, requestGpuInfo} from '../src/device-core.mjs';

const data = JSON.parse(await readFile(new URL('../src/data.json', import.meta.url), 'utf8'));
const dictionary = JSON.parse(await readFile(new URL('../src/messages.json', import.meta.url), 'utf8'));
const env = navigator => ({navigator, secureContext: true, userActivation: true});
const trap = () => { throw new Error('Forbidden API/property touched'); };
function selected(overrides = {}) {
  const device = {vendorId: 0x2341, productId: 0x0043, productName: 'Uno', manufacturerName: 'Arduino', ...overrides};
  for (const key of ['serialNumber', 'open', 'claimInterface', 'transferIn', 'transferOut', 'sendReport', 'receiveFeatureReport', 'toJSON']) {
    Object.defineProperty(device, key, {get: trap});
  }
  return device;
}

test('PCI hardware ID normalizes case, trims whitespace and omits subsystem/instance', () => {
  assert.deepEqual(parseHardwareId('  pci\\ven_8086&dev_1234&subsys_00018086&rev_02\\INSTANCE  '),
    {ok: true, status: 'ok', namespace: 'pci', vendorId: '8086', deviceId: '1234', normalized: 'PCI\\VEN_8086&DEV_1234'});
});
test('USB hardware ID with MI and REV parses with no instance retention', () => {
  const result = parseHardwareId('USB\\VID_2341&PID_0043&REV_0100&MI_00\\PRIVATE-INSTANCE');
  assert.equal(result.normalized, 'USB\\VID_2341&PID_0043');
  assert.equal(result.deviceId, '0043');
  assert.equal(JSON.stringify(result).includes('PRIVATE-INSTANCE'), false);
});
test('namespace must be explicit for a bare pair', () => {
  assert.equal(parseHardwareId('10DE:2704').status, 'ambiguous-namespace');
  assert.equal(parseHardwareId('10de:2704', {namespace:'pci'}).namespace, 'pci');
  assert.equal(parseHardwareId('USB 0x0403:0x6001').namespace, 'usb');
});
test('namespace mismatch never silently reinterprets a vendor ID', () => {
  assert.equal(parseHardwareId('PCI\\VEN_8086&DEV_1234', {namespace:'usb'}).status, 'namespace-mismatch');
  assert.equal(parseHardwareId('USB 0403:6001', {namespace:'pci'}).status, 'namespace-mismatch');
});
test('invalid widths, mixed namespaces, extra tokens, multi-ID input and invalid options fail', () => {
  for (const input of ['', 'PCI\\VID_8086&PID_1234','USB\\VEN_8086&DEV_1234','PCI\\VEN_10000&DEV_1234',
    'USB\\VID_2341&PID_043','PCI\\VEN_8086&DEV_1234&DEV_5678','2341:0043:0000',
    'USB\\VID_2341&PID_GGGG','USB\\VID_2341&PID_0043junk','USB\\VID_2341&PID_0043\nUSB\\VID_045E&PID_1234',
    '<img src=x>', 'x'.repeat(2049), null, 42]) assert.equal(parseHardwareId(input).status,'invalid-input', String(input));
  assert.equal(parseHardwareId('0403:6001',{namespace:'hid'}).status, 'invalid-input');
});
test('four digit range boundaries parse without signed overflow', () => {
  assert.equal(parseHardwareId('PCI FFFF:0000').vendorId, 'FFFF');
  assert.equal(parseHardwareId('PCI FFFF:0000').deviceId, '0000');
});
test('vendor lookup joins only matching namespace and normalized ID', () => {
  assert.equal(lookupVendor('pci','10de',data.vendors).brand,'NVIDIA');
  assert.equal(lookupVendor('usb','10de',data.vendors),null);
  assert.equal(lookupVendor(parseHardwareId('USB 2341:0043'),undefined,data.vendors).brand,'Arduino');
  assert.equal(lookupVendor('usb',0x2341,data.vendors).brand,'Arduino');
  assert.equal(lookupVendor(undefined,'2341',data.vendors),null);
  assert.equal(lookupVendor('pci','FFFF',data.vendors),null);
  assert.equal(lookupVendor('pci',65536,data.vendors),null);
  assert.equal(lookupVendor('pci','8086'),null);
});

for (const [api,method] of [['usb',requestUsbMetadata],['hid',requestHidMetadata],['gpu',requestGpuInfo]]) {
  test(`${api} preflight distinguishes insecure, absence and inactive click with zero API calls`, async () => {
    const navigator = {[api]:{requestDevice:trap,requestAdapter:trap}};
    assert.equal((await method({...env(navigator),secureContext:false})).status,'insecure-context');
    assert.equal((await method(env({}))).status,'api-unavailable');
    assert.equal((await method({...env(navigator),userActivation:false})).status,'user-gesture-required');
    assert.equal((await method({navigator,secureContext:true})).status,'user-gesture-required');
  });
  for (const [name,status] of [['NotAllowedError','permission-denied'],['SecurityError','permission-denied'],
    ['NotFoundError','cancelled'],['AbortError','cancelled'],['TypeError','request-failed']]) {
    test(`${api} maps ${name} without exposing error/device data`, async () => {
      const request = () => Promise.reject(Object.assign(new Error('private details'),{name}));
      const result = await method(env({[api]:{requestDevice:request,requestAdapter:request}}));
      assert.deepEqual(result,{ok:false,status});
    });
  }
}
test('USB picker runs before the first await and receives only empty filters', async () => {
  let calls = 0;
  const pending = requestUsbMetadata(env({usb:{requestDevice(options) {
    calls++; assert.deepEqual(options,{filters:[]}); return Promise.resolve(selected());
  }, getDevices:trap}}));
  assert.equal(calls,1);
  const result = await pending;
  assert.deepEqual(result,{ok:true,status:'ok',devices:[{namespace:'usb',vendorId:'2341',deviceId:'0043',productName:'Uno',manufacturerName:'Arduino',source:'webusb'}]});
  assert.doesNotThrow(()=>JSON.stringify(result));
});
test('USB metadata range checking and absent selected device are distinct', async () => {
  for (const value of [-1,65536,1.2,NaN,Infinity]) {
    assert.equal((await requestUsbMetadata(env({usb:{requestDevice:async()=>selected({vendorId:value})}}))).status,'invalid-metadata');
  }
  assert.equal((await requestUsbMetadata(env({usb:{requestDevice:async()=>null}}))).status,'no-device-selected');
  const result=await requestUsbMetadata(env({usb:{requestDevice:async()=>selected({vendorId:65535,productId:0})}}));
  assert.equal(result.devices[0].vendorId,'FFFF');
  assert.equal(result.devices[0].deviceId,'0000');
});
test('untrusted USB names are bounded plain strings, with no device serialization', async () => {
  const result=await requestUsbMetadata(env({usb:{requestDevice:async()=>selected({productName:'\u0000 <script>bad</script> ',manufacturerName:'a'.repeat(400)})}}));
  assert.equal(result.devices[0].productName,'<script>bad</script>'); // UI must use textContent.
  assert.equal(result.devices[0].manufacturerName.length,200);
  assert.deepEqual(Object.keys(result.devices[0]).sort(),['deviceId','manufacturerName','namespace','productName','source','vendorId']);
});
test('HID picker only returns user-selected metadata without reading manufacturer or serial', async () => {
  let calls=0;
  const device=selected(); Object.defineProperty(device,'manufacturerName',{get:trap});
  const result=await requestHidMetadata(env({hid:{requestDevice(options) {
    calls++; assert.deepEqual(options,{filters:[]}); return Promise.resolve([device,selected({productId:1})]);
  },getDevices:trap}}));
  assert.equal(calls,1); assert.equal(result.devices.length,2);
  assert.equal(result.devices[0].source,'webhid');
  assert.deepEqual(Object.keys(result.devices[0]).sort(),['deviceId','namespace','productName','source','vendorId']);
  assert.doesNotThrow(()=>JSON.stringify(result));
});
test('HID empty selection and invalid metadata do not become a successful scan',async()=>{
  assert.equal((await requestHidMetadata(env({hid:{requestDevice:async()=>[]}}))).status,'no-device-selected');
  assert.equal((await requestHidMetadata(env({hid:{requestDevice:async()=>[selected({productId:-1})]}}))).status,'invalid-metadata');
});
test('GPU uses only adapter.info; never requestAdapterInfo or requestDevice',async()=>{
  let calls=0;
  const adapter={info:{vendor:'intel',architecture:'',device:'',description:'GPU'},requestDevice:trap};
  Object.defineProperty(adapter,'requestAdapterInfo',{get:trap});
  const result=await requestGpuInfo(env({gpu:{requestAdapter(){calls++;return Promise.resolve(adapter);}}}));
  assert.equal(calls,1);
  assert.deepEqual(result,{ok:true,status:'ok',info:{vendor:'intel',architecture:'',device:'',description:'GPU'},warning:'gpu-limited'});
});
test('GPU no adapter, empty info and absent legacy info are distinct truthful fallbacks',async()=>{
  assert.equal((await requestGpuInfo(env({gpu:{requestAdapter:async()=>null}}))).status,'gpu-unavailable');
  for (const adapter of [{info:{}},{info:{vendor:' \n '}},{}]) {
    assert.equal((await requestGpuInfo(env({gpu:{requestAdapter:async()=>adapter}}))).status,'gpu-info-empty');
  }
});
test('dataset has unique namespace/ID keys, official HTTPS sources and all six titles',()=>{
  assert.ok(data.vendors.length>=12);
  assert.equal(new Set(data.vendors.map(v=>`${v.namespace}:${v.vendorId}`)).size,data.vendors.length);
  for(const vendor of data.vendors){
    assert.match(vendor.vendorId,/^[0-9A-F]{4}$/); assert.ok(['usb','pci'].includes(vendor.namespace));
    assert.ok(vendor.sources.length>=2); assert.ok(vendor.supportUrl.startsWith('https://'));
    for(const source of vendor.sources) assert.ok(source.url.startsWith('https://'));
  }
  for(const lang of ['ko','en','es','zh','ja','de']) {assert.ok(data.title[lang]);assert.ok(data.description[lang]);}
});
test('every exported status and function-limit message exists in all six languages',()=>{
  const keys=Object.keys(dictionary.messages.en).sort();
  for(const lang of ['ko','en','es','zh','ja','de']) {
    assert.deepEqual(Object.keys(dictionary.messages[lang]).sort(),keys);
    for(const status of Object.values(DEVICE_STATUS)) assert.ok(dictionary.messages[lang][status]);
    for(const key of ['gpu-limited','device-limited','vendor-limited','privacy','manual-help','unknown-vendor']) assert.ok(dictionary.messages[lang][key]);
  }
});

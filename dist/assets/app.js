import {parseHardwareId, lookupVendor, requestUsbMetadata, requestHidMetadata, requestGpuInfo} from './device-core.mjs';

export async function initDevice(root = document) {
  const config = JSON.parse(root.querySelector('#app-config').textContent);
  const ui = config.ui, messages = config.messages;
  const status = root.querySelector('#status');
  const say = key => { if (status) status.textContent = messages[key] || ui.unknown; };
  const copy = root.querySelector('#copy-code');
  copy?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(copy.dataset.code || ''); if (status) status.textContent = ui.copied; }
    catch { if (status) status.textContent = ui.copyFailed; }
  });
  const form = root.querySelector('#device-form');
  if (!form) { root.documentElement.classList.add('app-ready'); return; }
  const url = new URL(config.dataURL, location.href);
  if (url.origin !== location.origin) throw new Error('DATA_ORIGIN');
  const response = await fetch(url, {credentials: 'same-origin', mode: 'same-origin'});
  if (!response.ok) throw new Error('DATA_LOAD');
  const data = await response.json();
  if (!Array.isArray(data.vendors)) throw new Error('DATA_SCHEMA');
  const output = root.querySelector('#device-result');
  let generation = 0;
  const requestButtons = ['usb-button', 'hid-button', 'gpu-button'].map(id => root.querySelector(`#${id}`)).filter(Boolean);
  const actionButtons = [...root.querySelectorAll('#device-form button'), ...requestButtons];
  const setBusy = busy => { for (const button of actionButtons) if (button.id !== 'clear-device-results') button.disabled = busy; };
  const node = (tag, text) => { const element = root.createElement(tag); element.textContent = String(text ?? ''); return element; };
  const paragraph = text => output.append(node('p', text));
  const field = (label, value) => paragraph(`${label}: ${value || messages['not-provided'] || ui.notProvided}`);
  const support = device => {
    const vendor = lookupVendor(device, undefined, data.vendors);
    if (!vendor) { paragraph(messages['unknown-vendor']); return; }
    field(ui.manufacturer, vendor.brand);
    try {
      const href = new URL(vendor.supportUrl);
      if (href.protocol !== 'https:') return;
      const link = node('a', messages['support-link'] || ui.officialHelp);
      link.href = href.href; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
      output.append(link);
    } catch { /* No links from malformed data. */ }
    paragraph(messages['vendor-limited']);
  };
  const render = result => {
    output.replaceChildren();
    say(result.status);
    if (result.devices) {
      for (const device of result.devices) {
        field(ui.namespace, device.namespace.toUpperCase());
        field(messages['vendor-id'] || ui.vendorId, device.vendorId);
        field(messages['device-id'] || ui.deviceId, device.deviceId);
        field(messages['product-name'], device.productName);
        if (device.source === 'webusb') field(messages['manufacturer-name'], device.manufacturerName);
        support(device);
      }
      paragraph(messages['device-limited']);
    } else if (result.info) {
      field(ui.brand, result.info.vendor);
      field(ui.architecture, result.info.architecture);
      field(ui.deviceId, result.info.device);
      field(ui.details, result.info.description);
      paragraph(messages['gpu-limited']);
    } else if (result.ok && result.namespace) {
      field(ui.namespace, result.namespace.toUpperCase());
      field(ui.vendorId, result.vendorId); field(ui.deviceId, result.deviceId);
      support(result);
    }
  };
  form.addEventListener('submit', event => {
    event.preventDefault();
    generation++;
    setBusy(false);
    const namespace = root.querySelector('#namespace')?.value;
    render(parseHardwareId(root.querySelector('#hardware-id')?.value || '', namespace ? {namespace} : {}));
  });
  for (const [id, request] of [['usb-button', requestUsbMetadata], ['hid-button', requestHidMetadata], ['gpu-button', requestGpuInfo]]) {
    root.querySelector(`#${id}`)?.addEventListener('click', () => {
      const current = ++generation;
      // Invoke the picker before any await and pass the browser's real activation state.
      const pending = request({navigator, secureContext: isSecureContext, userActivation: navigator.userActivation?.isActive});
      setBusy(true);
      if (status) status.textContent = ui.loading;
      pending.then(result => { if (generation === current) render(result); })
        .catch(() => { if (generation === current) say('request-failed'); })
        .finally(() => { if (generation === current) setBusy(false); });
    });
  }
  const clear = root.querySelector('#clear-device-results');
  clear?.addEventListener('click', () => {
    generation++;
    const input = root.querySelector('#hardware-id');
    if (input) input.value = '';
    output.replaceChildren();
    if (status) status.textContent = '';
    setBusy(false);
  });
  setBusy(false);
  if (clear) clear.disabled = false;
  if (status) status.textContent = '';
  root.documentElement.classList.add('app-ready');
}

if (typeof document !== 'undefined') {
  initDevice().catch(() => {
    const status = document.querySelector('#status');
    try { if (status) status.textContent = JSON.parse(document.querySelector('#app-config').textContent).ui.loadFailed; } catch { /* Invalid config. */ }
  });
}

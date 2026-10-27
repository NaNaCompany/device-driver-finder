/** Local, metadata-only helpers. No networking, persistence, device opening, or enumeration. */
export const DEVICE_STATUS = Object.freeze({
  OK: 'ok', INVALID_INPUT: 'invalid-input', AMBIGUOUS_NAMESPACE: 'ambiguous-namespace',
  NAMESPACE_MISMATCH: 'namespace-mismatch', INSECURE_CONTEXT: 'insecure-context',
  API_UNAVAILABLE: 'api-unavailable', USER_GESTURE_REQUIRED: 'user-gesture-required',
  CANCELLED: 'cancelled', PERMISSION_DENIED: 'permission-denied',
  NO_DEVICE_SELECTED: 'no-device-selected', INVALID_METADATA: 'invalid-metadata',
  GPU_UNAVAILABLE: 'gpu-unavailable', GPU_INFO_EMPTY: 'gpu-info-empty', REQUEST_FAILED: 'request-failed'
});
const fail = status => ({ok: false, status});
const validNamespace = value => value === 'pci' || value === 'usb';
const cleanText = value => typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 200) : '';
function hexId(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 65535 ? value.toString(16).toUpperCase().padStart(4, '0') : null;
  return typeof value === 'string' && /^(?:0x)?[0-9a-f]{4}$/i.test(value) ? value.replace(/^0x/i, '').toUpperCase() : null;
}

/** Accept one ID, not an inventory. Omit instance paths so unique instance strings never leave this parser. */
export function parseHardwareId(input, {namespace} = {}) {
  if (namespace !== undefined && !validNamespace(namespace)) return fail(DEVICE_STATUS.INVALID_INPUT);
  if (typeof input !== 'string' || !input.trim() || input.length > 2048 || /[\r\n]/.test(input)) return fail(DEVICE_STATUS.INVALID_INPUT);
  const raw = input.trim();
  let foundNamespace, vendor, device;
  const full = /^(PCI|USB)\\(.*)$/i.exec(raw);
  if (full) {
    foundNamespace = full[1].toLowerCase();
    const fields = full[2].split('\\')[0];
    // Anchored grammar excludes malformed widths, duplicate fields, and USB/PCI token mixing.
    const pattern = foundNamespace === 'pci'
      ? /^VEN_([0-9A-F]{4})&DEV_([0-9A-F]{4})(?:&SUBSYS_[0-9A-F]{8})?(?:&REV_[0-9A-F]{2})?(?:&CC_[0-9A-F]{4,6})?$/i
      : /^VID_([0-9A-F]{4})&PID_([0-9A-F]{4})(?:&REV_[0-9A-F]{4})?(?:&MI_[0-9A-F]{2})?$/i;
    const match = pattern.exec(fields);
    if (!match) return fail(DEVICE_STATUS.INVALID_INPUT);
    [, vendor, device] = match;
  } else {
    const pair = /^(?:(PCI|USB)\s+)?(?:0x)?([0-9A-F]{4})\s*:\s*(?:0x)?([0-9A-F]{4})$/i.exec(raw);
    if (!pair) return fail(DEVICE_STATUS.INVALID_INPUT);
    foundNamespace = pair[1]?.toLowerCase() || namespace;
    if (!foundNamespace) return fail(DEVICE_STATUS.AMBIGUOUS_NAMESPACE);
    [, , vendor, device] = pair;
  }
  if (namespace && foundNamespace !== namespace) return fail(DEVICE_STATUS.NAMESPACE_MISMATCH);
  const vendorId = hexId(vendor), deviceId = hexId(device);
  return {ok: true, status: DEVICE_STATUS.OK, namespace: foundNamespace, vendorId, deviceId,
    normalized: foundNamespace === 'pci' ? `PCI\\VEN_${vendorId}&DEV_${deviceId}` : `USB\\VID_${vendorId}&PID_${deviceId}`};
}

/** Lookup requires an explicit namespace. Dataset is supplied by the caller; IDs do not imply model/driver fit. */
export function lookupVendor(parsedOrNamespace, vendorId, vendors = []) {
  const namespace = typeof parsedOrNamespace === 'object' && parsedOrNamespace !== null ? parsedOrNamespace.namespace : parsedOrNamespace;
  const id = hexId(typeof parsedOrNamespace === 'object' && parsedOrNamespace !== null ? parsedOrNamespace.vendorId : vendorId);
  if (!validNamespace(namespace) || !id || !Array.isArray(vendors)) return null;
  return vendors.find(vendor => vendor.namespace === namespace && vendor.vendorId === id) || null;
}

function environment(options) {
  return {nav: options.navigator ?? globalThis.navigator,
    secure: options.secureContext ?? globalThis.isSecureContext,
    active: options.userActivation ?? (options.navigator ?? globalThis.navigator)?.userActivation?.isActive};
}
function preflight(env, api, gesture = true) {
  if (env.secure !== true) return fail(DEVICE_STATUS.INSECURE_CONTEXT);
  if (typeof env.nav?.[api]?.[api === 'gpu' ? 'requestAdapter' : 'requestDevice'] !== 'function') return fail(DEVICE_STATUS.API_UNAVAILABLE);
  if (gesture && env.active !== true) return fail(DEVICE_STATUS.USER_GESTURE_REQUIRED);
  return null;
}
function errorResult(error) {
  if (error?.name === 'NotFoundError' || error?.name === 'AbortError') return fail(DEVICE_STATUS.CANCELLED);
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return fail(DEVICE_STATUS.PERMISSION_DENIED);
  return fail(DEVICE_STATUS.REQUEST_FAILED);
}
function metadata(device, source) {
  if (!device || typeof device !== 'object') return null;
  // Do not spread, enumerate, stringify, inspect serialNumber, or retain the device object.
  const vendorId = hexId(device.vendorId), deviceId = hexId(device.productId);
  if (!vendorId || !deviceId) return null;
  const result = {namespace: 'usb', vendorId, deviceId, productName: cleanText(device.productName), source};
  if (source === 'webusb') result.manufacturerName = cleanText(device.manufacturerName);
  return result;
}

/** Call synchronously from a click handler. The native picker is invoked before the first await. */
export async function requestUsbMetadata(options = {}) {
  const env = environment(options), problem = preflight(env, 'usb');
  if (problem) return problem;
  try {
    const device = await env.nav.usb.requestDevice({filters: []});
    if (!device) return fail(DEVICE_STATUS.NO_DEVICE_SELECTED);
    const selected = metadata(device, 'webusb');
    return selected ? {ok: true, status: DEVICE_STATUS.OK, devices: [selected]} : fail(DEVICE_STATUS.INVALID_METADATA);
  } catch (error) { return errorResult(error); }
}

/** Only devices returned by this user-approved picker; no getDevices() or HID reports. */
export async function requestHidMetadata(options = {}) {
  const env = environment(options), problem = preflight(env, 'hid');
  if (problem) return problem;
  try {
    const devices = await env.nav.hid.requestDevice({filters: []});
    if (!Array.isArray(devices) || devices.length === 0) return fail(DEVICE_STATUS.NO_DEVICE_SELECTED);
    const selected = devices.map(device => metadata(device, 'webhid'));
    return selected.every(Boolean) ? {ok: true, status: DEVICE_STATUS.OK, devices: selected} : fail(DEVICE_STATUS.INVALID_METADATA);
  } catch (error) { return errorResult(error); }
}

/** Optional browser-exposed adapter information; no PCI identity or driver-version inference. */
export async function requestGpuInfo(options = {}) {
  const env = environment(options), problem = preflight(env, 'gpu');
  if (problem) return problem;
  try {
    const adapter = await env.nav.gpu.requestAdapter();
    if (!adapter) return fail(DEVICE_STATUS.GPU_UNAVAILABLE);
    const source = adapter.info;
    const info = {vendor: cleanText(source?.vendor), architecture: cleanText(source?.architecture),
      device: cleanText(source?.device), description: cleanText(source?.description)};
    if (!Object.values(info).some(Boolean)) return {...fail(DEVICE_STATUS.GPU_INFO_EMPTY), info};
    return {ok: true, status: DEVICE_STATUS.OK, info, warning: 'gpu-limited'};
  } catch (error) { return errorResult(error); }
}

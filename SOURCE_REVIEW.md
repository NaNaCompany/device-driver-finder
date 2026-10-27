# Device ID and official support module — source and implementation review

Checked: 2026-10-27. App slug: `device-driver-finder`.

## Deliverables and integration contract

- `device-core.mjs`: dependency-free browser/Node ES module. No network or storage calls.
- `device-data.json`: `schemaVersion: 1`, six-language title/description, `entries: []`, and 16 vendor records (8 PCI, 8 USB).
- `device-messages.json`: `schemaVersion: 1`, `languages`, `messages[lang][stable-key]`; languages are `ko`, `en`, `es`, `zh`, `ja`, `de`.
- `device.test.mjs`: 34 tests against the actual module using Node's built-in test runner.

Exports:

```js
parseHardwareId(input, { namespace } = {})
lookupVendor(parsedOrNamespace, vendorId, vendors = [])
requestUsbMetadata({ navigator, secureContext, userActivation } = {})
requestHidMetadata({ navigator, secureContext, userActivation } = {})
requestGpuInfo({ navigator, secureContext, userActivation } = {})
DEVICE_STATUS
```

`parseHardwareId` returns `{ok, status, namespace, vendorId, deviceId, normalized}` on success and `{ok:false,status}` on failure. IDs are uppercase four-digit hexadecimal strings. Accepts one Windows PCI/USB hardware ID, explicitly prefixed `PCI 8086:1234` / `USB 2341:0043`, or a bare pair with the `namespace` option. A bare pair without a namespace returns `ambiguous-namespace`; conflicting prefixes return `namespace-mismatch`. Instance suffixes are discarded, not returned. No model lookup is inferred from a product ID.

`lookupVendor(parsed, undefined, dataset.vendors)` or `lookupVendor('pci', '8086', dataset.vendors)` returns a record or `null`. The supplied dataset and explicit namespace are required. No downloaded vendor database or external lookup is involved.

Metadata functions return `{ok,status,devices:[...]}` or `{ok,status,info,warning:'gpu-limited'}` on success. USB/HID plain output contains only `namespace`, `vendorId`, `deviceId`, `productName`, `source`; USB may also include `manufacturerName`. Text fields are control-character stripped and capped at 200 characters. Product names remain untrusted text and must be assigned using `textContent`. An HID identifier uses the USB VID/PID namespace and does not prove a physical USB connection.

Call metadata functions directly from the button click handler; pass `secureContext: window.isSecureContext` and `userActivation: navigator.userActivation?.isActive`. USB/HID native `requestDevice({filters:[]})` occurs before the first `await`. The browser controls eligible devices, permissions, protected classes and selection. Do not call these functions automatically, place IDs in a URL, pass output to analytics, log device objects, persist results, or transmit results. Clear only the in-memory/visible result; this module does not revoke a permission grant retained by the browser. Browser site settings control such grants.

## Current first-party API references

1. [Chrome WebUSB capability documentation](https://developer.chrome.com/docs/capabilities/usb) documents secure contexts, user gestures, the native picker and selected-device metadata. Only metadata access is implemented; its device-open/transfer examples are not used.
2. [WebUSB specification](https://wicg.github.io/webusb/) is retained as a specification link. The web reader returned no extractable body on this check; implementation details were cross-checked against Chrome's own documentation.
3. [Chrome WebHID capability documentation](https://developer.chrome.com/docs/capabilities/hid) documents native selection and VID/PID. The module never calls `getDevices`, opens an HID device, reads reports, or sends reports.
4. [WebHID specification](https://wicg.github.io/webhid/) is retained as a specification link. The web reader returned no extractable body on this check.
5. [Current WebGPU specification](https://gpuweb.github.io/gpuweb/#gpuadapterinfo) defines `GPUAdapter.info`; every identification field may be empty. The module reads only `vendor`, `architecture`, `device`, `description`. It does not call `requestDevice`, inspect limits, enumerate adapters, or infer a driver version.
6. [Chrome 130 WebGPU update](https://developer.chrome.com/blog/new-in-webgpu-130) documents deprecation of the old asynchronous adapter-info method. There is no legacy fallback in this implementation.

The app requests a GPU adapter only after its own explicit button click, even though a native GPU permission picker is not promised by the WebGPU API. Returned information can describe the browser-selected hardware or software adapter; it is not a complete GPU inventory or an exact PCI identity.

## Vendor identifier evidence

These are small independently assembled identifier-to-support mappings. No external database source, table, code, manual, image, installer, binary or license-restricted wording is redistributed. Numeric identifiers and brand names are referenced as facts. All application prose and translations are newly authored. Mapping an ID is a support navigation aid, not evidence of authenticity or driver suitability. A manufacturer may have several vendor IDs; this directory is deliberately incomplete.

| Namespace | VID | Brand | First-party identifier evidence | Support scope |
|---|---|---|---|---|
| PCI | 8086 | Intel | [Intel identification guide](https://www.intel.com/content/www/us/en/support/articles/000056278/ethernet-products/legacy-ethernet-products.html) explicitly identifies Intel's PCI VID | Intel support, with OEM/model checks |
| PCI | 10DE | NVIDIA | [Dell's official unknown-device guide](https://www.dell.com/support/kbdoc/en-us/000151898/how-to-identify-an-unknown-device-in-device-manager) identifies this common vendor ID | NVIDIA official driver selector |
| PCI | 1002 | AMD | [Dell's official unknown-device guide](https://www.dell.com/support/kbdoc/en-us/000151898/how-to-identify-an-unknown-device-in-device-manager) identifies this common vendor ID | AMD support and model selector |
| PCI | 10EC | Realtek | [Microsoft NIC documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/supported-ethernet-nics-for-network-kernel-debugging-in-windows-10) names vendor and VID | Realtek downloads; OEM-specific packages may be needed |
| PCI | 14E4 | Broadcom | [Microsoft NIC documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/supported-ethernet-nics-for-network-kernel-debugging-in-windows-10) names vendor and VID | Broadcom support |
| PCI | 1969 | Atheros / Qualcomm | [Microsoft NIC documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/supported-ethernet-nics-for-network-kernel-debugging-in-windows-10) names Atheros and VID | Qualcomm support; legacy OEM devices may require PC-maker support |
| PCI | 15B3 | Mellanox / NVIDIA | [Microsoft NIC documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/supported-ethernet-nics-for-network-kernel-debugging-in-windows-10) names Mellanox and VID | NVIDIA's official driver page links networking drivers |
| PCI | 1137 | Cisco | [Microsoft NIC documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/supported-ethernet-nics-for-network-kernel-debugging-in-windows-10) names Cisco and VID | Cisco support and downloads |
| USB | 045E | Microsoft | [Google's official Stadia controller support table](https://support.google.com/stadia/answer/13067284?hl=en) includes Xbox VID/PID pairs | Microsoft support; controller/PC accessories navigation |
| USB | 054C | Sony | [Google's official controller support table](https://support.google.com/stadia/answer/13067284?hl=en) includes Sony controller VID/PID pairs | PlayStation support; this destination covers PlayStation devices |
| USB | 057E | Nintendo | [Google's official controller support table](https://support.google.com/stadia/answer/13067284?hl=en) includes Switch Pro VID/PID | Nintendo regional support |
| USB | 28DE | Valve | [Google's official controller support table](https://support.google.com/stadia/answer/13067284?hl=en) includes Steam controller/receiver VID/PID pairs | Steam Hardware support |
| USB | 18D1 | Google | [Google's official controller support table](https://support.google.com/stadia/answer/13067284?hl=en) includes Stadia VID/PID | Stadia controller support; no promise of current firmware service or broader Google-device coverage |
| USB | 0403 | FTDI | [FTDI identification knowledge base](https://ftdichip.com/Support/Knowledgebase/macosxhowdoiknowwhatmydeviceid.htm) explicitly equates FTDI and 0403 | FTDI drivers; product/OS checks still required |
| USB | 2341 | Arduino | [Arduino platform specification](https://docs.arduino.cc/arduino-cli/platform-specification/) identifies Uno VID/PID examples | Arduino Help Center |
| USB | 10C4 | Silicon Labs | [Silicon Labs AN220](https://www.silabs.com/documents/public/application-notes/an220-usb-driver-customization.pdf) shows the manufacturer's CP210x driver VID example | Silicon Labs CP210x VCP support; other products may need another package |

Microsoft's NIC reference was used only as identifier evidence. Its debugger/version support matrix is not reused as general OS or driver compatibility evidence. Google's controller table was used only for the listed identifier facts; its old Stadia migration deadlines are not presented as a current service offer. Silicon Labs AN220 was used as a fact citation, without redistributing the document or extracts. None of these links submits the entered VID/PID.

Support destination readback: Intel, NVIDIA, AMD, Broadcom, Qualcomm, Cisco, Microsoft, PlayStation, Nintendo, Steam, Arduino and Silicon Labs pages returned first-party page content or navigation. Realtek was inaccessible to the web reader; FTDI's driver page returned HTTP 403. These two destinations remain official-domain links, but current page-body availability was not confirmed. The NVIDIA network firmware endpoint also failed in the reader; the dataset therefore uses NVIDIA's successfully read driver page, which visibly links networking downloads. Steam returned both a temporary-request error notice and normal support navigation, so uninterrupted service is not claimed.

## Status semantics and fallbacks

- `insecure-context`, `api-unavailable`, `user-gesture-required`: no native API call.
- `cancelled`: `AbortError` or `NotFoundError`. A browser may use the latter when no device is selected; the UI does not assert that it can distinguish a user cancellation from every selection failure.
- `permission-denied`: `NotAllowedError` or `SecurityError`; the cause may be user permission or browser policy, not necessarily a clicked Deny button.
- `no-device-selected`: empty HID selection or no selected USB object.
- `invalid-metadata`: missing/invalid 16-bit identifiers in the selected object.
- `gpu-unavailable`: adapter request returns null; this does not prove there is no GPU.
- `gpu-info-empty`: an adapter exists but all four exposed identity fields are empty/unavailable.
- `request-failed`: other failures; raw exception messages are not returned to the UI.

All statuses, fallbacks, limitations, privacy text, manual instructions and interactive labels have six-language strings. Manual input remains usable without any device API. Parser values never cross PCI/USB namespaces implicitly.

## Verification boundary

Executed successfully, exit code 0:

```powershell
& '.tools/rtk/rtk.exe' test node --test 'output/search-portals-2026-10-27/device.test.mjs'
```

34 tests cover actual exports, parser normalization, namespace conflicts, exact ID widths, invalid input and 16-bit boundaries, namespace-qualified lookup, browser preflight without API calls, immediate picker invocation, permission/cancellation/error mapping, empty selection, whitelisted output, bounded untrusted text, serial/toJSON/open/transfer getter traps, no HID manufacturer probing, GPU empty-info versus missing-adapter cases, no deprecated GPU info method, source/data schema, and message completeness.

Mocks validate module behavior and API call discipline. No physical USB/HID picker, real browser permission UI, GPU hardware, OS-installed driver, installer or driver compatibility was tested. Parent integration, rendered UI, analytics behavior, publication and live readback require separate checks.

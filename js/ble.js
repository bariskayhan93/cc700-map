// CC700 file transfer over BLE (decoded from an OnelapFit HCI capture, 2026-11-11).
// cmd:  b0f2 0124 01 00000000 0100 <ts> 000000000000          begin   (end: ... 02 ... 0102 ...)
//       b0f2 0125 <type> 00000000 0000 <size u32> <npk u16> <crc16-xmodem u16> 00000000 <name>
// data: b0f2 0126 <seq u16 from 1> <len u16> <bytes>; device acks every 10 packets: b0f4 0126 <seq> <len> 0000
import { crc16xmodem } from './pb.js';
export const SERVICE = '8ce5cc01-0a4d-11e9-ab14-d663bd873d93';
const CHARS = ['8ce5cc04-0a4d-11e9-ab14-d663bd873d93', '8ce5cc05-0a4d-11e9-ab14-d663bd873d93', '8ce5cc06-0a4d-11e9-ab14-d663bd873d93'];
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const le = (v, n) => Array.from({ length: n }, (_, i) => (v >>> (8 * i)) & 255);
const sleep = ms => new Promise(r => setTimeout(r, ms));
export class CC700 {
  constructor(log) { this.log = log || console.log; this.q = []; }
  async connect() {
    this.dev = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'CC700' }], optionalServices: [SERVICE] });
    this.dev.addEventListener('gattserverdisconnected', () => this.log('disconnected'));
    const srv = await (await this.dev.gatt.connect()).getPrimaryService(SERVICE);
    this.ch = {};
    for (const u of CHARS) {
      try {
        const c = await srv.getCharacteristic(u); this.ch[u] = c;
        const pr = c.properties; this.log('char ' + u.slice(4, 8) + ' props: ' + ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter(k => pr[k]).join(','));
        if (c.properties.notify || c.properties.indicate) { await c.startNotifications(); c.addEventListener('characteristicvaluechanged', e => this.onNote(u, new Uint8Array(e.target.value.buffer))); }
      } catch (e) { this.log('char ' + u.slice(4, 8) + ': ' + e.message); }
    }
    // find the command channel: the one that answers the hello
    for (const u of Object.keys(this.ch)) {
      if (!this.ch[u].properties.write && !this.ch[u].properties.writeWithoutResponse) continue;
      try {
        const r = await this.cmdOn(u, [0x80, 0xf1, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0], x => x[0] === 0xb0 && x[1] === 0xf5, 1500);
        if (r) { this.cmd = u; break; }
      } catch (e) { this.log('hello on ' + u.slice(4, 8) + ': ' + e.message); }
    }
    if (!this.cmd) throw new Error('CC700 did not answer');
    this.data = Object.keys(this.ch).find(u => u !== this.cmd && (this.ch[u].properties.writeWithoutResponse || this.ch[u].properties.write));
    this.log('connected: ' + this.dev.name + ' cmd=' + this.cmd.slice(4, 8) + ' data=' + (this.data || '?').slice(4, 8));
  }
  onNote(u, v) { this.log('<- ' + u.slice(4, 8) + ' ' + hex(v).slice(0, 80)); this.q.push([u, v]); }
  async wait(pred, ms) {
    const t = Date.now();
    while (Date.now() - t < ms) { const i = this.q.findIndex(([u, v]) => pred(v, u)); if (i >= 0) return this.q.splice(i, 1)[0][1]; await sleep(20); }
    return null;
  }
  async write(u, b) {
    this.log('-> ' + u.slice(4, 8) + ' ' + hex(b).slice(0, 80)); const c = this.ch[u], v = new Uint8Array(b);
    if (c.properties.writeWithoutResponse) { try { return await c.writeValueWithoutResponse(v); } catch (e) { if (!c.properties.write) throw e; this.log('retry with response: ' + e.message); } }
    return c.writeValueWithResponse(v);
  }
  async cmdOn(u, b, pred, ms = 3000) { this.q = []; await this.write(u, b); return this.wait(pred, ms); }
  async routeName() {                          // name of the route file on the device, e.g. route_123456.bin
    const r = await this.cmdOn(this.cmd, [0xb0, 0xf1, 0x01, 0x42, 0x06], v => v[2] === 0x01 && v[3] === 0x42);
    if (!r) return null;   // b0f5 0142 <type> <status 4 bytes> <name>\0
    const s = new TextDecoder().decode(r.slice(9)).replace(/\0.*$/s, '');
    if (!/^route_[\w-]+\.bin$/.test(s)) { this.log('unexpected route name: ' + JSON.stringify(s)); return null; }
    return s || null;
  }
  async sendFile(name, file, ts, onProgress) {
    const n = Math.ceil(file.length / 200), crc = crc16xmodem(file);
    const ok = v => v[0] === 0xb0 && v[1] === 0xf5;
    if (!await this.cmdOn(this.cmd, [0xb0, 0xf2, 0x01, 0x24, 0x01, 0, 0, 0, 0, 0x01, 0x00, ...le(ts, 4), 0, 0, 0, 0, 0, 0], ok)) throw new Error('no answer to begin');
    const info = [0xb0, 0xf2, 0x01, 0x25, 0x06, 0, 0, 0, 0, 0, 0, ...le(file.length, 4), ...le(n, 2), ...le(crc, 2), 0, 0, 0, 0, ...new TextEncoder().encode(name)];
    const r = await this.cmdOn(this.cmd, info, ok); if (!r) throw new Error('no answer to file info');
    for (let s = 1; s <= n; s++) {
      const part = file.subarray((s - 1) * 200, s * 200);
      await this.write(this.data, [0xb0, 0xf2, 0x01, 0x26, ...le(s, 2), ...le(part.length, 2), ...part]);
      if (s % 10 === 0 || s === n) {
        const a = await this.wait(v => v[0] === 0xb0 && v[1] === 0xf4 && (v[4] | v[5] << 8) === s, 5000);
        if (!a) throw new Error('no ack for packet ' + s);
        onProgress && onProgress(s, n);
      }
    }
    if (!await this.cmdOn(this.cmd, [0xb0, 0xf2, 0x01, 0x24, 0x02, 0, 0, 0, 0, 0x01, 0x02, ...le(ts, 4), 0, 0, 0, 0, 0, 0], ok)) throw new Error('no answer to end');
    this.log('file sent: ' + name + ' ' + file.length + ' bytes, crc ' + crc.toString(16));
  }
  disconnect() { this.dev && this.dev.gatt.disconnect(); }
}

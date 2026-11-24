/**
 * 应用状态：设备指纹库 + 检材案件，localStorage 持久化 + 订阅通知。
 */
import type { CaseRecord, DeviceRecord } from './types.ts';
import { uid } from './types.ts';

const DEVICE_KEY = 'adf.devices.v1';
const CASE_KEY = 'adf.cases.v1';

type Listener = () => void;

class Store {
  devices: DeviceRecord[] = [];
  cases: CaseRecord[] = [];
  private listeners = new Set<Listener>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const d = localStorage.getItem(DEVICE_KEY);
      if (d) this.devices = JSON.parse(d) as DeviceRecord[];
      const c = localStorage.getItem(CASE_KEY);
      if (c) this.cases = JSON.parse(c) as CaseRecord[];
    } catch (err) {
      console.error('本地数据读取失败', err);
      this.devices = [];
      this.cases = [];
    }
  }

  private persist(): void {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(this.devices));
    localStorage.setItem(CASE_KEY, JSON.stringify(this.cases));
    this.listeners.forEach((fn) => fn());
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  addDevice(rec: Omit<DeviceRecord, 'id' | 'createdAt'> & { id?: string }): DeviceRecord {
    const id = rec.id ?? uid('dev');
    const existing = this.devices.find((d) => d.id === id);
    if (existing) {
      // 同 id（如重复生成的合成设备）直接覆盖更新，不产生重复记录
      const updated: DeviceRecord = { ...existing, ...rec, id, createdAt: existing.createdAt };
      this.devices = this.devices.map((d) => (d.id === id ? updated : d));
      this.persist();
      return updated;
    }
    const full: DeviceRecord = { ...rec, id, createdAt: Date.now() };
    this.devices = [full, ...this.devices];
    this.persist();
    return full;
  }

  removeDevice(id: string): void {
    this.devices = this.devices.filter((d) => d.id !== id);
    this.persist();
  }

  clearDevices(): void {
    this.devices = [];
    this.persist();
  }

  addCase(rec: Omit<CaseRecord, 'id' | 'createdAt'>): CaseRecord {
    const full: CaseRecord = { ...rec, id: uid('case'), createdAt: Date.now() };
    this.cases = [full, ...this.cases];
    this.persist();
    return full;
  }

  removeCase(id: string): void {
    this.cases = this.cases.filter((c) => c.id !== id);
    this.persist();
  }

  exportJson(): string {
    return JSON.stringify({ version: 1, devices: this.devices, cases: this.cases }, null, 2);
  }

  importJson(text: string): { devices: number; cases: number } {
    const data = JSON.parse(text) as { devices?: DeviceRecord[]; cases?: CaseRecord[] };
    if (Array.isArray(data.devices)) {
      const exist = new Set(this.devices.map((d) => d.id));
      for (const d of data.devices) {
        if (!exist.has(d.id)) this.devices.push(d);
      }
    }
    if (Array.isArray(data.cases)) {
      const exist = new Set(this.cases.map((c) => c.id));
      for (const c of data.cases) {
        if (!exist.has(c.id)) this.cases.push(c);
      }
    }
    this.persist();
    return { devices: data.devices?.length ?? 0, cases: data.cases?.length ?? 0 };
  }
}

export const store = new Store();

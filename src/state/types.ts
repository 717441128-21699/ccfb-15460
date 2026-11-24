import type { DeviceRecord as DspDeviceRecord, MatchResult } from '../dsp/matching.ts';

/** 设备记录：DSP 层基础结构 + 持久化/合成元信息 */
export interface DeviceRecord extends DspDeviceRecord {
  note?: string;
  /** 合成设备的元信息（真实设备无此字段） */
  synthetic?: {
    templateIndex: number;
    unitSeed: number;
    templateName: string;
  };
}

export interface CaseRecord {
  id: string;
  caseName: string;
  evidenceFileName: string;
  evidenceDurationSec: number;
  evidenceSampleRate: number;
  createdAt: number;
  results: MatchResult[];
  conclusion: { level: string; advice: string };
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

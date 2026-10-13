// 하루 두 번 알림을 Durable Object 알람으로 돌린다.
// 무료 계정 cron 칸(5개)을 다른 프로젝트가 다 써서 cron 대신 쓴다. 알람은 울릴 때마다 다음 칸을 다시 예약한다.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.ts';
import { runEvening, runMorning, sendTest } from './notify.ts';
import { nextSlot } from './time.ts';
import type { SlotKind } from './time.ts';

export class Scheduler extends DurableObject<Env> {
  /** 알람이 없으면 다음 칸으로 예약하고, 예약 상태를 돌려준다 */
  async ensure(): Promise<{ next: string; kind: SlotKind }> {
    let at = await this.ctx.storage.getAlarm();
    let kind = (await this.ctx.storage.get<SlotKind>('kind')) ?? 'morning';
    if (at === null) {
      const s = nextSlot(new Date());
      await this.ctx.storage.put('kind', s.kind);
      await this.ctx.storage.setAlarm(s.at);
      at = s.at.getTime();
      kind = s.kind;
    }
    return { next: new Date(at).toISOString(), kind };
  }

  /** 점검용: n초 뒤 시험 통 한 번(알람이 실제로 울리는지 확인) → 그 뒤 원래 칸으로 돌아간다 */
  async testIn(sec: number): Promise<{ next: string }> {
    const at = new Date(Date.now() + sec * 1000);
    await this.ctx.storage.put('kind', 'test');
    await this.ctx.storage.setAlarm(at);
    return { next: at.toISOString() };
  }

  async alarm(): Promise<void> {
    const now = new Date();
    const kind = (await this.ctx.storage.get<SlotKind | 'test'>('kind')) ?? 'morning';
    try {
      const result =
        kind === 'test' ? await sendTest(this.env, now) : kind === 'morning' ? await runMorning(this.env, now) : await runEvening(this.env, now);
      console.log('alarm', kind, JSON.stringify(result));
    } catch (e) {
      // 다시 던지면 알람이 재시도되며 다음 칸 예약이 꼬인다 → 기록만 하고 넘어감(같은 날 같은 통은 DB 가 막음)
      console.error('alarm failed', kind, String(e));
    }
    const s = nextSlot(new Date(now.getTime() + 60_000));
    await this.ctx.storage.put('kind', s.kind);
    await this.ctx.storage.setAlarm(s.at);
  }
}

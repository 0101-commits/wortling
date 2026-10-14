// 하루 두 번 알림을 Durable Object 알람으로 돌린다.
// 무료 계정 cron 칸(5개)을 다른 프로젝트가 다 써서 cron 대신 쓴다. 알람은 울릴 때마다 다음 칸을 다시 예약한다.
// 「1시간 뒤」(A2)는 같은 알람 하나로: 예약 시각 = min(다음 칸, 미룬 시각). 알람은 하나뿐이라 둘을 함께 들고 있는다.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.ts';
import { runEvening, runMorning, sendTest } from './notify.ts';
import { nextAlarm, nextSlot } from './time.ts';
import type { SlotKind } from './time.ts';

export class Scheduler extends DurableObject<Env> {
  /** 알람이 없으면 다음 칸으로 예약하고, 예약 상태를 돌려준다 */
  async ensure(): Promise<{ next: string; kind: SlotKind }> {
    let at = await this.ctx.storage.getAlarm();
    let kind = (await this.ctx.storage.get<SlotKind>('kind')) ?? 'morning';
    if (at === null) {
      const s = nextSlot(new Date());
      await this.ctx.storage.put('kind', s.kind);
      at = nextAlarm(s.at.getTime(), await this.ctx.storage.get<number>('later_at'));
      await this.ctx.storage.setAlarm(at);
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

  /** 저녁 알림 「1시간 뒤」: 미룬 시각을 적고, 지금 알람보다 이르면 당긴다 */
  async later(at: number): Promise<{ next: string }> {
    await this.ctx.storage.put('later_at', at);
    const cur = await this.ctx.storage.getAlarm();
    const next = cur === null ? at : Math.min(cur, at);
    await this.ctx.storage.setAlarm(next);
    return { next: new Date(next).toISOString() };
  }

  async alarm(): Promise<void> {
    const now = new Date();
    const laterAt = await this.ctx.storage.get<number>('later_at');
    const kind = (await this.ctx.storage.get<SlotKind | 'test'>('kind')) ?? 'morning';
    const isLater = laterAt !== undefined && now.getTime() >= laterAt - 1000;
    // 알람이 늦게 울려 30분 넘게 지난 미룬 통은 보내지 않는다(다음 날 엉뚱한 시각에 가는 것 방지)
    const stale = isLater && now.getTime() - laterAt! > 30 * 60_000;
    try {
      const result = stale
        ? { skipped: 'later_stale' }
        : isLater
        ? await runEvening(this.env, now, 'evening_later')
        : kind === 'test'
          ? await sendTest(this.env, now)
          : kind === 'morning'
            ? await runMorning(this.env, now)
            : await runEvening(this.env, now);
      console.log('alarm', isLater ? 'evening_later' : kind, JSON.stringify(result));
    } catch (e) {
      // 다시 던지면 알람이 재시도되며 다음 칸 예약이 꼬인다 → 기록만 하고 넘어감(같은 날 같은 통은 DB 가 막음)
      console.error('alarm failed', kind, String(e));
    }
    if (isLater) await this.ctx.storage.delete('later_at');
    // 어느 쪽이 울렸든 다가오는 칸을 다시 잡는다(방금 울린 칸은 1분 뒤 기준이라 건너뜀)
    const s = nextSlot(new Date(now.getTime() + 60_000));
    await this.ctx.storage.put('kind', s.kind);
    await this.ctx.storage.setAlarm(nextAlarm(s.at.getTime(), isLater ? undefined : laterAt));
  }
}

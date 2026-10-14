// 하루 두 번 알림을 Durable Object 알람으로 돌린다.
// 무료 계정 cron 칸(5개)을 다른 프로젝트가 다 써서 cron 대신 쓴다. 알람은 울릴 때마다 다음 칸을 다시 예약한다.
// 「1시간 뒤」(A2)는 같은 알람 하나로 함께 든다: 저장 = 칸 종류(kind) · 칸 시각(slot_at) · 미룬 시각(later_at),
// 예약 = min(칸 시각, 미룬 시각). 울리면 시각이 된 쪽만 실행한다 — 남은 미룬 값이 정규 칸을 가로막지 않게.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.ts';
import { runEvening, runMorning, sendTest } from './notify.ts';
import { alarmDue, nextAlarm, nextSlot } from './time.ts';
import type { SlotKind } from './time.ts';

/** 미룬 통이 이만큼 넘게 지났으면 끝난 것으로 본다(새로 미루기 허용) */
const LATER_STALE_MS = 30 * 60_000;

export class Scheduler extends DurableObject<Env> {
  private async arm(slotAt: number): Promise<number> {
    // 미룬 시각은 마지막에 다시 읽는다: 실행 중(await 사이)에 「1시간 뒤」가 들어와도 잃지 않게
    const at = nextAlarm(slotAt, await this.ctx.storage.get<number>('later_at'));
    await this.ctx.storage.setAlarm(at);
    return at;
  }

  /** 알람이 없으면 다음 칸으로 예약하고, 예약 상태를 돌려준다 */
  async ensure(): Promise<{ next: string; kind: SlotKind }> {
    let at = await this.ctx.storage.getAlarm();
    let kind = (await this.ctx.storage.get<SlotKind>('kind')) ?? 'morning';
    if (at === null) {
      const s = nextSlot(new Date());
      await this.ctx.storage.put({ kind: s.kind, slot_at: s.at.getTime() });
      at = await this.arm(s.at.getTime());
      kind = s.kind;
    }
    return { next: new Date(at).toISOString(), kind };
  }

  /** 점검용: n초 뒤 시험 통 한 번(알람이 실제로 울리는지 확인) → 그 뒤 원래 칸으로 돌아간다 */
  async testIn(sec: number): Promise<{ next: string }> {
    const at = Date.now() + sec * 1000;
    await this.ctx.storage.put({ kind: 'test', slot_at: at });
    return { next: new Date(await this.arm(at)).toISOString() };
  }

  /** 저녁 알림 「1시간 뒤」: 아직 안 울린 미룬 통이 있으면 거절(여러 기기에서 눌러도 한 번) */
  async later(at: number): Promise<{ ok: boolean; next?: string; error?: string }> {
    const cur = await this.ctx.storage.get<number>('later_at');
    if (cur !== undefined && cur > Date.now() - LATER_STALE_MS) return { ok: false, error: 'already' };
    await this.ctx.storage.put('later_at', at);
    const alarm = await this.ctx.storage.getAlarm();
    await this.ctx.storage.setAlarm(alarm === null ? at : Math.min(alarm, at));
    return { ok: true, next: new Date(at).toISOString() };
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const kind = (await this.ctx.storage.get<SlotKind | 'test'>('kind')) ?? 'morning';
    const slotAt = await this.ctx.storage.get<number>('slot_at');
    const laterAt = await this.ctx.storage.get<number>('later_at');
    const due = alarmDue(now, slotAt, laterAt);

    if (due.later) {
      try {
        const r = due.laterStale ? { skipped: 'later_stale' } : await runEvening(this.env, new Date(now), 'evening_later');
        console.log('alarm evening_later', JSON.stringify(r));
      } catch (e) {
        console.error('alarm failed evening_later', String(e));
      }
      // 실행 중에 새로 미룬 값이 들어왔으면 지우지 않는다
      if ((await this.ctx.storage.get<number>('later_at')) === laterAt) await this.ctx.storage.delete('later_at');
    }

    let nextSlotAt = slotAt;
    if (due.slot) {
      try {
        const r =
          kind === 'test'
            ? await sendTest(this.env, new Date(now))
            : kind === 'morning'
              ? await runMorning(this.env, new Date(now))
              : await runEvening(this.env, new Date(now));
        console.log('alarm', kind, JSON.stringify(r));
      } catch (e) {
        // 다시 던지면 알람이 재시도되며 다음 칸 예약이 꼬인다 → 기록만 하고 넘어감(같은 날 같은 통은 DB 가 막음)
        console.error('alarm failed', kind, String(e));
      }
      // 방금 울린 칸은 1분 뒤 기준이라 건너뛴다
      const s = nextSlot(new Date(now + 60_000));
      await this.ctx.storage.put({ kind: s.kind, slot_at: s.at.getTime() });
      nextSlotAt = s.at.getTime();
    }
    await this.arm(nextSlotAt ?? nextSlot(new Date(now + 60_000)).at.getTime());
  }
}

// 처음 한 번: O1 레벨·하루 수 → O2 디스코드 확인 → 시작
import { useState } from 'react'
import { Button, SegmentedControl, SegmentedControlItem } from '@montage-ui/core'
import type { Level, Settings } from '../../shared/api.ts'
import { Emoji, LEVELS, LEVEL_HINT, Stepper, Top } from '../ui.tsx'
import { DiscordConnect } from './Setup.tsx'

export default function Onboarding({ settings, onDone }: { settings: Settings; onDone: (p: Partial<Settings>) => void }) {
  const [step, setStep] = useState<1 | 2>(1)
  const [level, setLevel] = useState<Level>(settings.level)
  const [perDay, setPerDay] = useState(Math.min(8, Math.max(3, settings.new_per_day)))

  return (
    <>
      <Top title={step === 1 ? '시작하기' : '알림 연결'} />
      <main className="page bare onboard">
        <div className="step" aria-label={`2단계 중 ${step}단계`}>
          <i className="on" />
          <i className={step === 2 ? 'on' : ''} />
        </div>
        <Emoji name="hello" size={96} className="hero" />
        {step === 1 ? (
          <>
            <h1>어디서 시작할까요?</h1>
            <p className="lead">레벨에 맞는 단어부터 매일 조금씩 드려요. 나중에 설정에서 바꿀 수 있어요.</p>
            <SegmentedControl size="large" value={level} onValueChange={(v) => setLevel(v as Level)}>
              {LEVELS.map((lv) => (
                <SegmentedControlItem key={lv} value={lv}>{lv}</SegmentedControlItem>
              ))}
            </SegmentedControl>
            <p className="small">{LEVEL_HINT}</p>
            <div className="box">
              <div className="kv">
                <span>하루 새 단어</span>
                <Stepper label="하루 새 단어" value={perDay} min={3} max={8} onChange={setPerDay} />
              </div>
              <div className="kv"><span>범위</span><b>{LEVELS.slice(0, LEVELS.indexOf(level) + 1).join(' → ')}</b></div>
            </div>
            <p className="lead">아는 단어는 카드에서 「쉬움」으로 밀면 금방 뒤로 빠져요. 따로 시험은 없어요.</p>
            <Button fullWidth size="large" onClick={() => setStep(2)}>
              다음
            </Button>
          </>
        ) : (
          <>
            <h1>디스코드로 받을게요</h1>
            <p className="lead">아침 7:30 에 오늘 카드, 저녁 9시엔 남은 카드가 있을 때만 한 통 보내요. 나중에 설정에서 넣어도 돼요.</p>
            <div className="box wh pad">
              <DiscordConnect />
            </div>
            <div className="row2">
              <Button variant="outlined" color="assistive" size="large" onClick={() => setStep(1)}>
                이전
              </Button>
              <Button fullWidth size="large" onClick={() => onDone({ level, new_per_day: perDay, onboarded: true })}>
                시작
              </Button>
            </div>
          </>
        )}
      </main>
    </>
  )
}

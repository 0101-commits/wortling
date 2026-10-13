// 연결 설정: 폰에서 열기(QR) · 디스코드 웹후크. 사용자가 할 일은 찍기·붙여넣기·누르기뿐.
import { useMemo, useState } from 'react'
import { create } from 'qrcode'
import { Button, ContentBadge, Skeleton, TextField } from '@montage-ui/core'
import { IconLink, IconSend } from '@montage-ui/icon'
import { ApiError, MOCK, api, errorText, getToken, type WebhookSaveResponse } from '../api.ts'
import { useAsync } from '../hooks.ts'
import { navigate } from '../router.ts'
import { Top, useToaster } from '../ui.tsx'

export default function Setup() {
  return (
    <>
      <Top title="연결 설정" back="/settings" />
      <main className="page">
        <PhoneCard />
        <section className="box wh pad">
          <h2>디스코드 알림</h2>
          <DiscordConnect />
        </section>
        <Button fullWidth size="large" onClick={() => navigate('/today')}>
          다 됐어요 → 오늘 카드
        </Button>
      </main>
    </>
  )
}

/** 폰에서 열기: 접속 키가 든 주소를 QR 로. 찍으면 키가 저장되고 주소에서는 지워진다(api.ts takeTokenFromUrl). */
function PhoneCard() {
  const toast = useToaster()
  const [manual, setManual] = useState(false)
  const token = getToken() || (MOCK ? 'mock-key' : '')
  const link = `${location.origin}/#/today?k=${encodeURIComponent(token)}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast('링크를 복사했어요', 'positive')
    } catch {
      setManual(true) // http 주소 등에서는 클립보드가 막힌다 → 직접 복사
      toast('자동 복사가 막혀 있어요. 아래 칸을 길게 눌러 복사해 주세요.', 'cautionary')
    }
  }

  return (
    <section className="box wh pad phone">
      <h2>폰에서 열기</h2>
      <QR text={link} />
      <p className="small center">폰 카메라로 찍으면 바로 열려요. 홈 화면에 추가하면 앱처럼 써요.</p>
      <Button variant="outlined" color="assistive" fullWidth leadingContent={<IconLink />} onClick={copy}>
        링크 복사
      </Button>
      {manual && <TextField readOnly value={link} aria-label="폰에서 열 링크" onFocus={(e) => e.currentTarget.select()} />}
    </section>
  )
}

/** QR 을 SVG 경로 하나로(바깥 여백 4칸). 글자를 HTML 로 넣지 않으므로 안전하다. */
function QR({ text }: { text: string }) {
  const { size, d } = useMemo(() => {
    const { modules } = create(text, { errorCorrectionLevel: 'M' })
    let path = ''
    for (let r = 0; r < modules.size; r++)
      for (let c = 0; c < modules.size; c++) if (modules.get(r, c)) path += `M${c} ${r}h1v1h-1z`
    return { size: modules.size, d: path }
  }, [text])
  return (
    <svg className="qr" viewBox={`-4 -4 ${size + 8} ${size + 8}`} role="img" aria-label="폰에서 열 QR 코드" shapeRendering="crispEdges">
      <rect x={-4} y={-4} width={size + 8} height={size + 8} fill="#fff" />
      <path d={d} fill="#171719" />
    </svg>
  )
}

/** 디스코드 연결 상태 + 웹후크 넣기. 설정 화면과 온보딩 O2 가 같이 쓴다. */
export function DiscordConnect() {
  const status = useAsync(() => api.webhook(), [])
  const [open, setOpen] = useState(false)
  const s = status.data

  if (status.error) return <p className="small bad">{status.error}</p>
  if (!s) return <Skeleton variant="rectangle" width="100%" height={120} radius={12} />

  const chip = s.set ? (
    <ContentBadge size="small" variant="solid" color="accent" accentColor="semantic.foreground.positive.primary">연결됨</ContentBadge>
  ) : (
    <ContentBadge size="small" variant="outlined" color="neutral">아직</ContentBadge>
  )

  if (s.source === 'secret')
    return (
      <div className="hook">
        <div className="row-g">{chip}<span className="small">서버 비밀값으로 연결됨</span></div>
      </div>
    )

  return (
    <div className="hook">
      <div className="row-g">
        {chip}
        <span className="small">{s.set ? '아침 07:30 · 저녁 21:00 에 이 채널로 보내요.' : '알림 받을 채널의 웹후크 주소가 필요해요.'}</span>
      </div>
      {s.set && !open ? (
        <Button variant="outlined" color="assistive" size="small" onClick={() => setOpen(true)}>
          다시 넣기
        </Button>
      ) : (
        <>
          <ol className="steps">
            <li><b>①</b>디스코드에서 알림 받을 채널 옆 톱니 → 연동 → 웹후크 → 새 웹후크</li>
            <li><b>②</b>「웹후크 URL 복사」</li>
            <li><b>③</b>아래에 붙여넣고 저장</li>
          </ol>
          <WebhookForm
            onSaved={() => {
              setOpen(false)
              status.reload()
            }}
          />
        </>
      )}
    </div>
  )
}

/** 실패 사유를 짧게 */
function failText(r: WebhookSaveResponse): string {
  const e = r.error ?? ''
  if (r.status === 'secret_in_use') return '서버 비밀값이 이미 쓰이고 있어요.'
  if (/^(401|403|404)\b/.test(e)) return '디스코드가 이 웹후크를 몰라요. 새로 복사해 주세요.'
  if (/^429\b/.test(e)) return '디스코드가 잠시 막았어요. 조금 뒤에 다시 해 주세요.'
  return `시험 통이 안 갔어요 · ${(e || r.status).slice(0, 60)}`
}

function WebhookForm({ onSaved }: { onSaved: () => void }) {
  const toast = useToaster()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const r = await api.saveWebhook(url.trim())
      if (r.ok) {
        toast('디스코드에 시험 통이 갔어요', 'positive')
        setUrl('')
        onSaved()
      } else toast(failText(r), 'negative')
    } catch (e) {
      toast(
        e instanceof ApiError && e.code === 'bad_webhook_url'
          ? '웹후크 주소 모양이 아니에요. 「웹후크 URL 복사」로 받은 주소를 붙여 넣어 주세요.'
          : errorText(e),
        'negative',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="keyform"
      onSubmit={(e) => {
        e.preventDefault()
        if (url.trim() && !busy) save()
      }}
    >
      <TextField
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder="https://discord.com/api/webhooks/…"
        aria-label="디스코드 웹후크 주소"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <Button type="submit" fullWidth loading={busy} disabled={!url.trim()} leadingContent={<IconSend />}>
        저장하고 시험 통 보내기
      </Button>
    </form>
  )
}

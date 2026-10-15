// 서버 오류 코드({error}) → 화면 문구. 모르는 코드는 상태 번호만(영어 코드를 그대로 보이지 않게)
const TEXT: Record<string, string> = {
  changed_since: '그 뒤에 카드가 또 바뀌어서 되돌릴 수 없어요.',
  not_revertible: '되돌릴 수 없는 항목이에요.',
  not_found: '찾을 수 없어요.',
  bad_text: '글자로 된 단어 하나(60자 이내)만 넣어 주세요.',
  bad_url: '링크는 https:// 로 시작하는 주소만 넣을 수 있어요.',
  'bad kind': '이상한 곳을 하나 골라 주세요.',
  bad_webhook_url: '디스코드 웹후크 주소가 아니에요.',
}

export function serverErrorText(status: number, code?: string): string {
  // 모르는 코드는 상태 번호와 같이 — 폰에서 원인을 짚을 수 있게
  return (code && TEXT[code]) || (code ? `서버 오류 ${status} · ${code}` : `서버 오류 ${status}`)
}

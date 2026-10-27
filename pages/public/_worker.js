// worty.pages.dev 로 온 요청을 앱 Worker(wortling)에 그대로 넘긴다. 주소(호스트)는 그대로라 앱 · 알림 링크 · 푸시가 이 주소를 쓴다.
export default {
  fetch(request, env) {
    return env.APP.fetch(request)
  },
}

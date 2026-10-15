// HTTP 오류 하나: 처리기·DB 함수가 던지면 index.ts 가 {error} 와 상태 코드로 돌려준다.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const bad = (msg: string) => new HttpError(400, msg);

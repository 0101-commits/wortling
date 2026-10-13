// 작은 공용 훅
import { useEffect, useState } from 'react'
import { errorText } from './api.ts'

export interface Async<T> {
  data?: T
  error?: string
  loading: boolean
  reload: () => void
}

/** 비동기 불러오기 + 다시 시도. deps 가 바뀌면 다시 부른다. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [st, setSt] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setSt((s) => ({ ...s, loading: true, error: undefined }))
    fn().then(
      (data) => live && setSt({ data, loading: false }),
      (e) => live && setSt({ loading: false, error: errorText(e) }),
    )
    return () => {
      live = false
    }
    // eslint 없음: deps 는 호출자가 책임진다
  }, [...deps, tick])
  return { ...st, reload: () => setTick((t) => t + 1) }
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

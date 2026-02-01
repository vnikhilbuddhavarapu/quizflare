import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type WsStatus = 'disconnected' | 'connecting' | 'connected'

function App() {
  const [pin, setPin] = useState<string>('')
  const [createStatus, setCreateStatus] = useState<'idle' | 'creating' | 'done' | 'error'>('idle')
  const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected')
  const [wsRoleHint, setWsRoleHint] = useState<string | null>(null)
  const [logLines, setLogLines] = useState<string[]>([])

  const wsRef = useRef<WebSocket | null>(null)

  const wsUrl = useMemo(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = window.location.host
    const effectivePin = pin.trim()
    return effectivePin ? `${proto}://${host}/ws/room/${effectivePin}` : ''
  }, [pin])

  function pushLog(line: string) {
    setLogLines((prev) => [new Date().toLocaleTimeString() + '  ' + line, ...prev].slice(0, 200))
  }

  async function createRoom() {
    setCreateStatus('creating')
    setWsRoleHint(null)
    try {
      const resp = await fetch('/api/rooms/create', { method: 'POST' })
      if (!resp.ok) {
        pushLog(`Create room failed: HTTP ${resp.status}`)
        setCreateStatus('error')
        return
      }
      const data = (await resp.json()) as { pin: string }
      setPin(data.pin)
      setCreateStatus('done')
      pushLog(`Created room pin=${data.pin}. (Host cookie should be set.)`)
    } catch (err) {
      pushLog(`Create room failed: ${String(err)}`)
      setCreateStatus('error')
    }
  }

  function connectWs() {
    const effectivePin = pin.trim()
    if (!/^[0-9]{6}$/.test(effectivePin)) {
      pushLog('Invalid PIN: must be 6 digits')
      return
    }

    wsRef.current?.close(1000, 'reconnect')
    setWsStatus('connecting')
    pushLog(`Connecting WS: ${wsUrl}`)

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setWsStatus('connected')
      pushLog('WS open')
      ws.send('hello from ui')
    }
    ws.onmessage = (e) => {
      const text = typeof e.data === 'string' ? e.data : '[binary]'
      pushLog(`WS message: ${text}`)

      try {
        const msg = JSON.parse(text) as { type?: string; roleHint?: string | null }
        if (msg.type === 'connected') setWsRoleHint(msg.roleHint ?? null)
      } catch {
        // ignore non-JSON
      }
    }
    ws.onerror = () => {
      pushLog('WS error')
    }
    ws.onclose = (e) => {
      setWsStatus('disconnected')
      pushLog(`WS closed: ${e.code}${e.reason ? ` (${e.reason})` : ''}`)
    }
  }

  function disconnectWs() {
    wsRef.current?.close(1000, 'disconnect')
    wsRef.current = null
  }

  useEffect(() => {
    return () => {
      wsRef.current?.close(1000, 'unmount')
    }
  }, [])

  return (
    <div className='page'>
      <header className='header'>
        <div>
          <div className='title'>Quizflare</div>
          <div className='subtitle'>Milestone 0: API + Durable Objects + WebSockets</div>
        </div>
        <div className='badge'>local</div>
      </header>

      <section className='panel'>
        <div className='row'>
          <button className='btn' onClick={createRoom} disabled={createStatus === 'creating'}>
            {createStatus === 'creating' ? 'Creating…' : 'Create room'}
          </button>

          <div className='field'>
            <div className='label'>Room PIN</div>
            <input
              className='input mono'
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder='000000'
              inputMode='numeric'
              maxLength={6}
            />
          </div>

          <button className='btn secondary' onClick={connectWs} disabled={wsStatus !== 'disconnected' || !pin.trim()}>
            Connect WS
          </button>
          <button className='btn ghost' onClick={disconnectWs} disabled={wsStatus === 'disconnected'}>
            Disconnect
          </button>
        </div>

        <div className='meta'>
          <div>
            <span className='metaKey'>WS:</span> <span className='mono'>{wsStatus}</span>
          </div>
          <div>
            <span className='metaKey'>Role hint:</span> <span className='mono'>{wsRoleHint ?? 'null'}</span>
          </div>
          <div>
            <span className='metaKey'>WS URL:</span> <span className='mono'>{wsUrl || '-'}</span>
          </div>
        </div>
      </section>

      <section className='panel'>
        <div className='panelTitle'>Logs</div>
        <div className='logs'>
          {logLines.length === 0 ? <div className='muted'>No logs yet.</div> : logLines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </section>
    </div>
  )
}

export default App

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase"
import PokeSystem, { FOOTER_H } from "../../../components/PokeSystem"
import { useSubmitNudge } from "../../../lib/useSubmitNudge"

const BG = "#307977"
const ACCENT = "#F5E8D8"
const MUTED = "rgba(255,255,255,0.65)"
const WARM_LIGHT = "#3A9180"
const MID = "#245E5C"
const DRAW_SECONDS = 90

function playChirp() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(523, ctx.currentTime)
    osc.frequency.setValueAtTime(659, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.25)
  } catch {}
}

const PALETTE = [
  "#000000","#2D2D2D","#666666","#AAAAAA","#DDDDDD","#FFFFFF",
  "#6B0000","#5C3000","#1A4D00","#003D3D","#002B6B","#3D006B",
  "#E53935","#FB8C00","#FDD835","#7CB342","#00897B","#039BE5","#1E88E5","#8E24AA",
  "#FDDBB4","#D4956A","#8D5524","#A1887F",
  "#FFB3C6","#FFD4A8","#FFF5BA","#C8F5D3","#BAE1FF","#E8BAFF",
]

const BOT_FAKE_ANSWERS = [
  "A confused wizard","Two suns","Melting clock","Backwards dog","Upside-down house",
  "Flying potato","Sad rectangle","Robot dentist","Invisible cat","Angry cloud",
  "Dancing mailbox","Haunted spoon","Reverse mermaid","Exploding hat","Tiny elephant",
]

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]
}
function floodFillImageData(imageData, startX, startY, fillHex) {
  const d = imageData.data, w = imageData.width, h = imageData.height
  if (startX < 0 || startY < 0 || startX >= w || startY >= h) return
  const [fr,fg,fb] = hexToRgb(fillHex)
  const si = (startY*w+startX)*4
  const tr=d[si],tg=d[si+1],tb=d[si+2]
  if (tr===fr && tg===fg && tb===fb) return
  const stack=[startY*w+startX], visited=new Uint8Array(w*h), tol=80
  while (stack.length) {
    const p=stack.pop()
    if (p<0||p>=w*h||visited[p]) continue
    const i=p*4
    if (Math.abs(d[i]-tr)>tol||Math.abs(d[i+1]-tg)>tol||Math.abs(d[i+2]-tb)>tol) continue
    visited[p]=1; d[i]=fr; d[i+1]=fg; d[i+2]=fb; d[i+3]=255
    const x=p%w, y=Math.floor(p/w)
    if (x>0) stack.push(p-1); if (x<w-1) stack.push(p+1)
    if (y>0) stack.push(p-w); if (y<h-1) stack.push(p+w)
  }
  // Dilation pass: cover anti-aliased hairline pixels adjacent to filled area
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      if (!visited[y*w+x]) continue
      for (let dy=-1; dy<=1; dy++) { for (let dx=-1; dx<=1; dx++) {
        if (!dx&&!dy) continue
        const nx=x+dx, ny=y+dy
        if (nx<0||ny<0||nx>=w||ny>=h) continue
        const ni=ny*w+nx; if (visited[ni]) continue
        const ii=ni*4
        if (Math.abs(d[ii]-tr)<=150&&Math.abs(d[ii+1]-tg)<=150&&Math.abs(d[ii+2]-tb)<=150) {
          d[ii]=fr; d[ii+1]=fg; d[ii+2]=fb; d[ii+3]=255; visited[ni]=1
        }
      }}
    }
  }
}

// ─── DrawingCanvas ────────────────────────────────────────────────────────────

function DrawingCanvas({ onExport, onFirstMark }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const fabricRef = useRef(null)
  const fabricLibRef = useRef(null)
  const historyRef = useRef([])
  const redoStackRef = useRef([])
  const onExportRef = useRef(onExport)
  onExportRef.current = onExport
  const onFirstMarkRef = useRef(onFirstMark)
  onFirstMarkRef.current = onFirstMark
  const firstMarkFiredRef = useRef(false)
  const touchCleanupRef = useRef(null)
  const zoomRef = useRef(1)
  const pinchRef = useRef(null)
  const panStartRef = useRef(null)
  const bucketPendingRef = useRef(null)

  const [color, setColorState] = useState("#000000")
  const [brushSize, setBrushSize] = useState(8)
  const [toolMode, setToolModeState] = useState("pen")
  const [zoomState, setZoomState] = useState(1)
  const colorRef = useRef("#000000")
  colorRef.current = color
  const toolModeRef = useRef("pen")
  toolModeRef.current = toolMode
  const brushSizeRef = useRef(8)
  brushSizeRef.current = brushSize

  function fireFirstMark() {
    if (!firstMarkFiredRef.current) { firstMarkFiredRef.current = true; onFirstMarkRef.current?.() }
  }

  const doBucketFill = useCallback(async (x, y) => {
    const cv = fabricRef.current, fabricLib = fabricLibRef.current
    if (!cv || !fabricLib) return
    // Reset viewport to 1:1 so toDataURL pixels match canvas coordinates
    const savedVT = [...cv.viewportTransform]
    cv.setViewportTransform([1, 0, 0, 1, 0, 0])
    const dataUrl = cv.toDataURL({ format: "png" })
    cv.setViewportTransform(savedVT)
    await new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        const off = document.createElement("canvas")
        off.width = cv.width; off.height = cv.height
        const ctx = off.getContext("2d")
        ctx.drawImage(img, 0, 0)
        const imgData = ctx.getImageData(0, 0, off.width, off.height)
        floodFillImageData(imgData, x, y, colorRef.current)
        ctx.putImageData(imgData, 0, 0)
        fabricLib.Image.fromURL(off.toDataURL(), (fabricImg) => {
          cv.clear(); cv.backgroundColor = "#ffffff"
          fabricImg.set({ selectable: false, evented: false, left: 0, top: 0, scaleX: 1, scaleY: 1 })
          cv.add(fabricImg); cv.renderAll()
          historyRef.current.push(JSON.stringify(cv.toJSON()))
          redoStackRef.current = []
          fireFirstMark(); resolve()
        })
      }
      img.src = dataUrl
    })
  }, [])
  const doBucketFillRef = useRef(doBucketFill)
  doBucketFillRef.current = doBucketFill

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { fabric } = await import("fabric")
      if (cancelled || !canvasRef.current || !containerRef.current) return
      fabricLibRef.current = fabric
      const w = containerRef.current.clientWidth
      const h = containerRef.current.clientHeight || w
      const canvas = new fabric.Canvas(canvasRef.current, { isDrawingMode: true, width: w, height: h, backgroundColor: "#ffffff" })
      canvas.freeDrawingBrush.color = "#000000"
      canvas.freeDrawingBrush.width = 8
      canvas.on("path:created", () => {
        historyRef.current.push(JSON.stringify(canvas.toJSON()))
        redoStackRef.current = []; fireFirstMark()
      })
      canvas.on("mouse:down", (opt) => {
        if (toolModeRef.current !== "bucket") return
        const p = canvas.getPointer(opt.e)
        // Debounce: cancel if a second finger arrives within 150ms (it's a pinch, not a fill tap)
        bucketPendingRef.current = setTimeout(() => {
          bucketPendingRef.current = null
          doBucketFillRef.current(Math.round(p.x), Math.round(p.y))
        }, 150)
      })
      fabricRef.current = canvas
      onExportRef.current(() => canvas.toDataURL({ format: "jpeg", quality: 0.72 }))

      // ── Pinch-to-zoom ─────────────────────────────────────────────────────
      function clampVP() {
        const vt = canvas.viewportTransform, z = canvas.getZoom()
        const W = canvas.width, H = canvas.height
        vt[4] = Math.min(0, Math.max(W * (1 - z), vt[4]))
        vt[5] = Math.min(0, Math.max(H * (1 - z), vt[5]))
        canvas.setViewportTransform(vt)
      }
      function onTouchStart(e) {
        if (e.touches.length >= 2) {
          e.preventDefault(); e.stopImmediatePropagation()
          // Cancel any pending bucket fill triggered by the first finger
          if (bucketPendingRef.current) { clearTimeout(bucketPendingRef.current); bucketPendingRef.current = null }
          // Clear in-progress stroke BEFORE disabling drawing mode.
          // If we disable first, Fabric finalizes the partial first-finger stroke.
          try {
            canvas.freeDrawingBrush._points = []
            canvas.clearContext(canvas.contextTop)
          } catch (_) {}
          canvas.isDrawingMode = false
          const t1 = e.touches[0], t2 = e.touches[1]
          pinchRef.current = {
            dist: Math.hypot(t1.clientX-t2.clientX, t1.clientY-t2.clientY),
            startZoom: zoomRef.current,
            midX: (t1.clientX+t2.clientX)/2,
            midY: (t1.clientY+t2.clientY)/2,
          }
        }
      }
      function onTouchMove(e) {
        if (e.touches.length >= 2 && pinchRef.current) {
          e.preventDefault(); e.stopImmediatePropagation()
          const t1 = e.touches[0], t2 = e.touches[1]
          const newDist = Math.hypot(t1.clientX-t2.clientX, t1.clientY-t2.clientY)
          const newZoom = Math.min(8, Math.max(1, pinchRef.current.startZoom * (newDist / pinchRef.current.dist)))
          const newMidX = (t1.clientX+t2.clientX)/2
          const newMidY = (t1.clientY+t2.clientY)/2
          zoomRef.current = newZoom
          const rect = canvas.upperCanvasEl.getBoundingClientRect()
          canvas.zoomToPoint({ x: newMidX - rect.left, y: newMidY - rect.top }, newZoom)
          canvas.relativePan({ x: newMidX - pinchRef.current.midX, y: newMidY - pinchRef.current.midY })
          pinchRef.current.midX = newMidX; pinchRef.current.midY = newMidY
          clampVP(); setZoomState(newZoom)
        }
      }
      function onTouchEnd(e) {
        if (e.touches.length < 2) pinchRef.current = null
        if (e.touches.length === 0) {
          // Defer re-enabling drawing mode so Fabric's own touchend handling
          // completes first — avoids a state conflict that prevents drawing
          requestAnimationFrame(() => {
            if (toolModeRef.current !== "bucket") canvas.isDrawingMode = true
          })
        }
      }
      canvas.upperCanvasEl.addEventListener("touchstart", onTouchStart, { passive: false })
      canvas.upperCanvasEl.addEventListener("touchmove", onTouchMove, { passive: false })
      canvas.upperCanvasEl.addEventListener("touchend", onTouchEnd)
      touchCleanupRef.current = () => {
        canvas.upperCanvasEl.removeEventListener("touchstart", onTouchStart)
        canvas.upperCanvasEl.removeEventListener("touchmove", onTouchMove)
        canvas.upperCanvasEl.removeEventListener("touchend", onTouchEnd)
      }
    })()
    return () => { cancelled = true; touchCleanupRef.current?.(); fabricRef.current?.dispose(); fabricRef.current = null }
  }, [])

  function applyBrush(c, sz, eraser) {
    const cv = fabricRef.current; if (!cv) return
    cv.freeDrawingBrush.color = eraser ? "#ffffff" : c
    cv.freeDrawingBrush.width = sz
  }
  function handleColorClick(c) {
    setColorState(c)
    if (toolMode === "bucket") return
    const next = toolMode === "eraser" ? "pen" : toolMode
    if (next !== toolMode) setToolModeState(next)
    const cv = fabricRef.current; if (cv) cv.isDrawingMode = true
    applyBrush(c, brushSizeRef.current, false)
  }
  function handleSetTool(mode) {
    const next = mode === toolMode ? "pen" : mode
    setToolModeState(next)
    const cv = fabricRef.current; if (!cv) return
    cv.isDrawingMode = next !== "bucket"
    if (next !== "bucket") applyBrush(colorRef.current, brushSizeRef.current, next === "eraser")
  }
  function handleSizeChange(sz) {
    setBrushSize(sz); applyBrush(colorRef.current, sz, toolMode === "eraser")
  }
  function handleUndo() {
    const hist = historyRef.current; if (!hist.length) return
    const last = hist.pop(); redoStackRef.current.push(last)
    const cv = fabricRef.current; if (!cv) return
    if (hist.length === 0) { cv.clear(); cv.backgroundColor = "#ffffff"; cv.renderAll() }
    else cv.loadFromJSON(JSON.parse(hist[hist.length-1]), () => cv.renderAll())
  }
  function handleRedo() {
    const redo = redoStackRef.current; if (!redo.length) return
    const state = redo.pop(); historyRef.current.push(state)
    const cv = fabricRef.current; if (!cv) return
    cv.loadFromJSON(JSON.parse(state), () => cv.renderAll())
  }
  function handleClear() {
    const cv = fabricRef.current; if (!cv) return
    if (cv.getObjects().length > 0) { historyRef.current.push(JSON.stringify(cv.toJSON())); redoStackRef.current = [] }
    cv.clear(); cv.backgroundColor = "#ffffff"; cv.renderAll()
  }
  function handleResetZoom() {
    const cv = fabricRef.current; if (!cv) return
    cv.setViewportTransform([1, 0, 0, 1, 0, 0]); cv.setZoom(1)
    zoomRef.current = 1; setZoomState(1)
    if (toolModeRef.current !== "bucket") cv.isDrawingMode = true
  }

  const BRUSH_SIZES = [2, 4, 8, 14, 22, 34, 52]
  const iconStroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Canvas — fills available height, with floating zoom-out button */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: "relative", cursor: toolMode === "bucket" ? "crosshair" : "default" }}>
        <canvas ref={canvasRef} style={{ display: "block", touchAction: "none" }} />
        {zoomState > 1.05 && (
          <button onClick={handleResetZoom} style={{
            position: "absolute", bottom: 10, right: 10,
            width: 44, height: 44, background: "rgba(0,0,0,0.55)",
            color: "white", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" {...iconStroke}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </button>
        )}
      </div>

      {/* Tool + utility row */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 16px 8px", flexWrap: "nowrap" }}>
        {[
          { mode: "pen", label: "Draw", icon: <svg width="18" height="18" viewBox="0 0 24 24" {...iconStroke}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> },
          { mode: "eraser", label: "Erase", icon: <svg width="18" height="18" viewBox="0 0 24 24" {...iconStroke}><path d="M20 20H7L3 16l13-13 7 7-3 3"/><path d="M6 17l4-4"/></svg> },
          { mode: "bucket", label: "Fill", icon: <svg width="18" height="18" viewBox="0 0 24 24" {...iconStroke}><path d="M19 11L11 3 2.5 11.5a5.5 5.5 0 0 0 7.78 7.78L19 11z"/><path d="M5 3l5 5"/><path d="M22 22c0-1.2-.2-2-.8-3-1.4 0-2.2 1.8-2.2 3"/></svg> },
        ].map(({ mode, label, icon }) => (
          <button key={mode} onClick={() => handleSetTool(mode)}
            style={{ background: toolMode === mode ? ACCENT : WARM_LIGHT, color: toolMode === mode ? "#000" : "white", padding: "8px 10px", display: "flex", alignItems: "center", gap: 5, flexShrink: 0, height: 40 }}>
            {icon}
            <span style={{ fontSize: 13, fontWeight: 800 }}>{label}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={handleUndo} style={{ background: WARM_LIGHT, color: "white", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" {...iconStroke}><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
        </button>
        <button onClick={handleRedo} style={{ background: WARM_LIGHT, color: "white", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" {...iconStroke}><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
        </button>
        <button onClick={handleClear} style={{ background: WARM_LIGHT, color: "rgba(255,255,255,0.6)", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" {...iconStroke}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>

      {/* Brush sizes */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 16px 8px" }}>
        {BRUSH_SIZES.map((sz, i) => {
          const d = 5 + i * 4.5, active = brushSize === sz && toolMode !== "bucket"
          return (
            <button key={sz} onClick={() => handleSizeChange(sz)} disabled={toolMode === "bucket"}
              style={{ width: 38, height: 38, flexShrink: 0, background: active ? WARM_LIGHT : "transparent", display: "flex", alignItems: "center", justifyContent: "center", border: active ? `2px solid ${ACCENT}` : "2px solid transparent" }}>
              <div style={{ width: d, height: d, borderRadius: "50%", background: "white" }} />
            </button>
          )
        })}
      </div>

      {/* Color palette */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "0 16px 10px" }}>
        {PALETTE.map(c => (
          <button key={c} onClick={() => handleColorClick(c)}
            style={{ width: 28, height: 28, background: c, flexShrink: 0,
              border: color === c && toolMode !== "eraser" ? "3px solid white" : c === "#FFFFFF" || c === "#DDDDDD" ? "1px solid rgba(255,255,255,0.25)" : "2px solid transparent" }} />
        ))}
      </div>
    </div>
  )
}

// ─── Main play page ───────────────────────────────────────────────────────────


const POKE_COLORS = { dark: "#1C5250", mid: "#245E5C", wl: "#3A9180", yellow: "#F5E8D8", notifBg: "#0F302F" }
const BOTTOM_PAD = `calc(${FOOTER_H + 8}px + env(safe-area-inset-bottom))`
export default function Play({ params }) {
  const router = useRouter()
  const code = useMemo(() => params.code.toUpperCase(), [params.code])

  const [game, setGame] = useState(null)
  const [players, setPlayers] = useState([])
  const [answers, setAnswers] = useState([])
  const [votes, setVotes] = useState([])
  const [myPlayerId, setMyPlayerId] = useState(null)

  const [submittingDrawing, setSubmittingDrawing] = useState(false)
  const [drawingDirty, setDrawingDirty] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(DRAW_SECONDS)
  const [timerExpired, setTimerExpired] = useState(false)

  const [answerText, setAnswerText] = useState("")
  const [submittingAnswer, setSubmittingAnswer] = useState(false)

  const [selectedAnswerId, setSelectedAnswerId] = useState(null)
  const [submittingVote, setSubmittingVote] = useState(false)

  const [markingReady, setMarkingReady] = useState(false)

  const getExportRef = useRef(null)
  const prevPhaseRef = useRef(null)
  const prevDrawingIndexRef = useRef(-1)
  const soundTriggerRef = useRef(null)

  const me = players.find(p => p.id === myPlayerId)

  // ── PokeSystem (always mounted for notifications) ──────────────────────────
  const pokeSystemNode = me ? (
    <PokeSystem
      colors={POKE_COLORS}
      roomCode={code}
      currentPlayer={me.name}
      allPlayers={players.map(p => p.name)}
      playerDetails={players.map(p => ({ name: p.name, firstName: p.first_name, lastName: p.last_name }))}
      gamePhase={game?.phase}
      onResetToLobby={async () => { await supabase.rpc("drawful_reset_game", { p_code: code }) }}
    />
  ) : null


  async function loadState() {
    const { data: gameData } = await supabase
      .from("drawful_games").select("phase,drawing_started_at,current_drawing_index,is_dummy,ready_player_ids").eq("code", code).single()
    if (!gameData) { router.replace(`/${code}`); return }
    if (gameData.phase === "lobby") { router.replace(`/${code}`); return }
    prevPhaseRef.current = gameData.phase

    const { data: playerData } = await supabase
      .from("drawful_players").select("id,name,seat,is_bot,score,prompt,drawing_url")
      .eq("game_code", code).order("seat", { ascending: true })

    const { data: answerData } = await supabase
      .from("drawful_answers").select("id,drawing_player_id,author_id,text,is_real,display_order")
      .eq("game_code", code).order("display_order", { ascending: true })

    const { data: voteData } = await supabase
      .from("drawful_votes").select("id,drawing_player_id,voter_id,answer_id")
      .eq("game_code", code)

    setGame(gameData)
    setPlayers(playerData ?? [])
    setAnswers(answerData ?? [])
    setVotes(voteData ?? [])
  }

  useEffect(() => {
    const existing = localStorage.getItem(`drawful:${code}:playerId`)
    if (existing) setMyPlayerId(existing)
  }, [code])

  useEffect(() => {
    loadState()
    let poll = setInterval(loadState, 5000)
    function handleVisibility() { clearInterval(poll); if (!document.hidden) { loadState(); poll = setInterval(loadState, 5000) } }
    document.addEventListener("visibilitychange", handleVisibility)
    const channel = supabase.channel(`drawful-play-${code}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "drawful_games", filter: `code=eq.${code}` }, loadState)
      .on("postgres_changes", { event: "*", schema: "public", table: "drawful_answers", filter: `game_code=eq.${code}` }, loadState)
      .on("postgres_changes", { event: "*", schema: "public", table: "drawful_votes", filter: `game_code=eq.${code}` }, loadState)
      .subscribe()
    return () => { clearInterval(poll); document.removeEventListener("visibilitychange", handleVisibility); supabase.removeChannel(channel) }
  }, [code])

  // Reset per-round state when drawing index changes
  useEffect(() => {
    if (!game) return
    if (prevDrawingIndexRef.current !== game.current_drawing_index) {
      prevDrawingIndexRef.current = game.current_drawing_index
      setAnswerText("")
      setSelectedAnswerId(null)
      setSubmittingAnswer(false)
      setSubmittingVote(false)
    }
  }, [game?.current_drawing_index])

  // Drawing timer
  useEffect(() => {
    if (game?.phase !== "drawing" || !game.drawing_started_at) return
    const tick = () => {
      const elapsed = (Date.now() - new Date(game.drawing_started_at).getTime()) / 1000
      const remaining = Math.max(0, DRAW_SECONDS - elapsed)
      setSecondsLeft(Math.ceil(remaining))
      if (remaining <= 0) setTimerExpired(true)
    }
    tick()
    const interval = setInterval(tick, 500)
    return () => clearInterval(interval)
  }, [game?.phase, game?.drawing_started_at])

  // Auto-submit when timer expires
  useEffect(() => {
    if (!timerExpired || submittingDrawing || !me || game?.phase !== "drawing") return
    if (me.drawing_url) return // already submitted
    submitDrawing(true)
  }, [timerExpired, me?.drawing_url])

  // ── Derived state ─────────────────────────────────────────────────────────

  const n = players.length
  const drawingPlayers = useMemo(() => players.filter(p => p.drawing_url), [players])
  const currentDrawingIndex = game?.current_drawing_index ?? 0
  const currentArtist = useMemo(() => players.find(p => p.seat === currentDrawingIndex) ?? null, [players, currentDrawingIndex])
  const currentDrawingNumber = useMemo(() => {
    const idx = drawingPlayers.findIndex(p => p.seat === currentDrawingIndex)
    return idx >= 0 ? idx + 1 : null
  }, [drawingPlayers, currentDrawingIndex])
  const amArtist = !!(me && currentArtist && me.id === currentArtist.id)

  const currentAnswers = useMemo(() =>
    answers.filter(a => a.drawing_player_id === currentArtist?.id)
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)),
    [answers, currentArtist]
  )

  const myAnswer = useMemo(() =>
    answers.find(a => a.drawing_player_id === currentArtist?.id && a.author_id === myPlayerId),
    [answers, currentArtist, myPlayerId]
  )
  const nudgeAnswer = useSubmitNudge(answerText, !!myAnswer)

  const myVote = useMemo(() =>
    votes.find(v => v.drawing_player_id === currentArtist?.id && v.voter_id === myPlayerId),
    [votes, currentArtist, myPlayerId]
  )

  const currentVotes = useMemo(() =>
    votes.filter(v => v.drawing_player_id === currentArtist?.id),
    [votes, currentArtist]
  )

  const fakeAnswerCount = useMemo(() =>
    answers.filter(a => a.drawing_player_id === currentArtist?.id && !a.is_real).length,
    [answers, currentArtist]
  )


  // Sound alerts on phase transitions requiring this player's action
  useEffect(() => {
    if (!game || !me) return
    const curr = { phase: game.phase, drawingIndex: game.current_drawing_index }
    const prev = soundTriggerRef.current
    soundTriggerRef.current = curr
    if (!prev) return // skip first load
    const changed = prev.phase !== curr.phase || prev.drawingIndex !== curr.drawingIndex
    if (!changed) return
    if (curr.phase === "drawing") playChirp()
    else if (curr.phase === "guessing" && !amArtist) playChirp()
    else if (curr.phase === "voting" && !amArtist) playChirp()
  }, [game?.phase, game?.current_drawing_index, myPlayerId, amArtist])

  // ── Bot automation (dummy game) ───────────────────────────────────────────

  const botAutoRef = useRef(false)

  useEffect(() => {
    if (!game?.is_dummy || !game) return
    if (botAutoRef.current) return

    const bots = players.filter(p => p.is_bot)
    if (!bots.length) return

    // Drawing phase: bots auto-submit blank drawings
    if (game.phase === "drawing") {
      bots.forEach(bot => {
        if (bot.drawing_url) return
        botAutoRef.current = true
        const c = document.createElement("canvas"); c.width = 400; c.height = 400
        const ctx = c.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0,400,400)
        const blankUrl = c.toDataURL("image/jpeg", 0.6)
        // Upload blank and submit
        fetch(blankUrl).then(r => r.blob()).then(blob => {
          const filename = `drawful/${code}/${Date.now()}-bot-${bot.id}.jpg`
          supabase.storage.from("drawings").upload(filename, blob, { contentType: "image/jpeg" })
            .then(({ data: uploadData, error }) => {
              if (error) return
              const { data: urlData } = supabase.storage.from("drawings").getPublicUrl(uploadData.path)
              supabase.rpc("drawful_submit_drawing", { p_code: code, p_player_id: bot.id, p_drawing_url: urlData.publicUrl })
                .then(() => { botAutoRef.current = false })
            })
        })
      })
    }

    // Guessing phase: bots submit random fake answers
    if (game.phase === "guessing" && currentArtist) {
      bots.filter(b => b.id !== currentArtist.id).forEach(bot => {
        const alreadyAnswered = answers.some(a => a.drawing_player_id === currentArtist.id && a.author_id === bot.id)
        if (alreadyAnswered) return
        botAutoRef.current = true
        const fakeText = BOT_FAKE_ANSWERS[Math.floor(Math.random() * BOT_FAKE_ANSWERS.length)]
        setTimeout(() => {
          supabase.rpc("drawful_submit_answer", {
            p_code: code, p_drawing_player_id: currentArtist.id, p_author_id: bot.id, p_text: fakeText,
          }).then(() => { botAutoRef.current = false })
        }, 600 + Math.random() * 1200)
      })
    }

    // Voting phase: bots vote randomly
    if (game.phase === "voting" && currentArtist && currentAnswers.length > 0) {
      bots.filter(b => b.id !== currentArtist.id).forEach(bot => {
        const alreadyVoted = votes.some(v => v.drawing_player_id === currentArtist.id && v.voter_id === bot.id)
        if (alreadyVoted) return
        botAutoRef.current = true
        const randomAnswer = currentAnswers[Math.floor(Math.random() * currentAnswers.length)]
        setTimeout(() => {
          supabase.rpc("drawful_submit_vote", {
            p_code: code, p_drawing_player_id: currentArtist.id, p_voter_id: bot.id, p_answer_id: randomAnswer.id,
          }).then(() => { botAutoRef.current = false })
        }, 800 + Math.random() * 1500)
      })
    }

    // Results phase: bots mark ready
    if (game.phase === "results") {
      const readyIds = game.ready_player_ids ?? []
      bots.forEach(bot => {
        if (readyIds.includes(bot.id)) return
        botAutoRef.current = true
        setTimeout(() => {
          supabase.rpc("drawful_mark_ready", { p_code: code, p_player_id: bot.id })
            .then(() => { botAutoRef.current = false })
        }, 500 + Math.random() * 1000)
      })
    }
  }, [game?.phase, game?.is_dummy, currentArtist?.id, players.length, answers.length, votes.length, game?.ready_player_ids?.length])

  // ── Actions ───────────────────────────────────────────────────────────────

  async function submitDrawing(autoSubmit = false) {
    if (submittingDrawing || me?.drawing_url) return
    const getExport = getExportRef.current
    if (!getExport && !autoSubmit) { alert("Canvas not ready"); return }

    setSubmittingDrawing(true)
    try {
      const dataUrl = getExport ? getExport() : (() => {
        const c = document.createElement("canvas"); c.width = 400; c.height = 400
        const ctx = c.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0,400,400)
        return c.toDataURL("image/jpeg", 0.6)
      })()
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      const filename = `drawful/${code}/${Date.now()}-${crypto.randomUUID()}.jpg`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("drawings").upload(filename, blob, { contentType: "image/jpeg" })
      if (uploadError) throw uploadError
      const { data: urlData } = supabase.storage.from("drawings").getPublicUrl(uploadData.path)
      const { error } = await supabase.rpc("drawful_submit_drawing", {
        p_code: code, p_player_id: me.id, p_drawing_url: urlData.publicUrl,
      })
      if (error) throw error
      await loadState()
    } catch (e) {
      alert("Error submitting: " + e.message)
      setSubmittingDrawing(false)
    }
  }

  async function submitAnswer() {
    if (!answerText.trim() || submittingAnswer || myAnswer || amArtist) return
    setSubmittingAnswer(true)
    const trimmed = answerText.trim()
    const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
    const { error } = await supabase.rpc("drawful_submit_answer", {
      p_code: code,
      p_drawing_player_id: currentArtist.id,
      p_author_id: me.id,
      p_text: capitalized,
    })
    if (error) { alert("Error: " + error.message); setSubmittingAnswer(false); return }
    await loadState()
  }

  async function submitVote() {
    if (!selectedAnswerId || submittingVote || myVote || amArtist) return
    setSubmittingVote(true)
    const { error } = await supabase.rpc("drawful_submit_vote", {
      p_code: code,
      p_drawing_player_id: currentArtist.id,
      p_voter_id: me.id,
      p_answer_id: selectedAnswerId,
    })
    if (error) { alert("Error: " + error.message); setSubmittingVote(false); return }
    await loadState()
  }

  async function markReady() {
    if (markingReady) return
    setMarkingReady(true)
    await supabase.rpc("drawful_mark_ready", { p_code: code, p_player_id: myPlayerId })
    await loadState()
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (!game || !me) {
    return (
      <>
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 18, fontWeight: 700 }}>Loading…</p>
      </div>
        {pokeSystemNode}
      </>
    )
  }

  // ── Finished ──────────────────────────────────────────────────────────────

  if (game.phase === "finished") {
    const sorted = [...players].sort((a, b) => b.score - a.score)
    const topScore = sorted[0]?.score ?? 0
    const winners = sorted.filter(p => p.score === topScore)

    return (
      <>
      <div style={{ minHeight: "100dvh", background: BG, color: "white" }}>
        <div style={{ padding: "48px 24px 32px", textAlign: "center" }}>
          <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-1px", marginBottom: 8 }}>Game over!</h1>
          <p style={{ fontSize: 18, fontWeight: 700, color: ACCENT, marginBottom: 32 }}>
            {winners.length === 1 ? `${winners[0].name} wins!` : "It's a tie!"}
          </p>
        </div>
        <div style={{ padding: "0 24px 48px", display: "flex", flexDirection: "column", gap: 3 }}>
          {sorted.map((p, i) => (
            <div key={p.id} style={{ display: "flex" }}>
              <div style={{
                padding: "16px 0", minWidth: 64, flexShrink: 0,
                background: i === 0 ? ACCENT : "#1C5250",
                color: i === 0 ? "#000" : "white",
                fontSize: 26, fontWeight: 900,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {p.score}
              </div>
              <div style={{
                padding: "16px 18px", flex: 1,
                background: "#245E5C",
                display: "flex", flexDirection: "column", justifyContent: "center",
              }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  {p.name}{p.id === myPlayerId && <span style={{ fontSize: 12, opacity: 0.65, marginLeft: 6 }}>you</span>}
                </div>
                <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 700 }}>#{i + 1}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "0 24px 48px" }}>
          <button
            onClick={() => router.replace(`/${code}`)}
            style={{ background: WARM_LIGHT, color: "white", fontSize: 16, fontWeight: 700, padding: "16px 28px", width: "100%" }}
          >Back to lobby</button>
        </div>
      </div>
        {pokeSystemNode}
      </>
    )
  }

  // ── Drawing phase ─────────────────────────────────────────────────────────

  if (game.phase === "drawing") {
    const alreadySubmitted = !!me.drawing_url
    const pct = Math.min(100, (secondsLeft / DRAW_SECONDS) * 100)
    const urgent = secondsLeft <= 15

    if (alreadySubmitted || timerExpired) {
      const submittedCount = players.filter(p => p.drawing_url).length
      return (
        <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px", textAlign: "center" }}>
          <p style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
            {timerExpired ? "Time's up! Submitting…" : "Waiting for everyone to finish drawing…"}
          </p>
          <p style={{ fontSize: 13, opacity: 0.65, fontWeight: 700 }}>{submittedCount} of {n} done</p>
        </div>
      )
    }

    return (
      <>
      <div style={{ height: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Compact header */}
        <div style={{ flexShrink: 0, padding: "12px 24px 10px" }}>
          <div style={{ height: 4, background: WARM_LIGHT, marginBottom: 10 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: urgent ? "#F97316" : ACCENT, transition: "width 0.5s linear" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1.2 }}>{me.prompt}</div>
              <div style={{ fontSize: 13, opacity: 0.65, fontWeight: 600, marginTop: 3 }}>No letters or numbers</div>
            </div>
            <div style={{ fontSize: urgent ? 20 : 16, fontWeight: 900, color: urgent ? "#F97316" : "white", flexShrink: 0 }}>{secondsLeft}s</div>
          </div>
        </div>

        {/* Canvas — fills remaining space */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <DrawingCanvas
            onExport={fn => { getExportRef.current = fn }}
            onFirstMark={() => setDrawingDirty(true)}
          />
        </div>

        {/* Submit */}
        <div style={{ flexShrink: 0, padding: "12px 24px", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <button
            onClick={() => submitDrawing(false)}
            disabled={submittingDrawing}
            style={{ background: ACCENT, color: "#000", fontSize: 20, fontWeight: 900, padding: "18px", width: "100%", display: "block" }}
          >
            {submittingDrawing ? "Submitting…" : "Done Drawing"}
          </button>
        </div>
      </div>
        {pokeSystemNode}
      </>
    )
  }

  // ── Guessing phase ────────────────────────────────────────────────────────

  if (game.phase === "guessing") {
    const nonArtistCount = n - 1
    const expectedAnswers = nonArtistCount
    const isWaiting = amArtist ? false : !!myAnswer

    return (
      <>
      <div style={{ minHeight: "100dvh", background: BG, color: "white" }}>
        <div style={{ padding: "28px 24px 20px", background: "#1C5250" }}>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.75, marginBottom: 4 }}>
            DRAWING {currentDrawingNumber} OF {drawingPlayers.length}
          </div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>{currentArtist?.name}'s drawing</div>
        </div>

        {currentArtist?.drawing_url && (
          <img
            src={currentArtist.drawing_url}
            alt="Drawing to guess"
            style={{ width: "100%", display: "block", maxHeight: "40vh", objectFit: "contain" }}
          />
        )}

        <div style={{ padding: "20px 24px 40px" }}>
          {amArtist ? (
            // Artist view
            <div>
              <p style={{ fontSize: 16, opacity: 0.65, fontWeight: 600, marginBottom: 16 }}>
                Watch the fake answers come in.
              </p>
              <div style={{ fontSize: 32, fontWeight: 900, color: ACCENT, marginBottom: 4 }}>
                {fakeAnswerCount}
              </div>
              <div style={{ fontSize: 14, opacity: 0.7, fontWeight: 600 }}>
                {fakeAnswerCount === 1 ? "answer" : "answers"} submitted so far
              </div>
              {/* Placeholder dots for suspense */}
              <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                {Array.from({ length: expectedAnswers }).map((_, i) => (
                  <div key={i} style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: i < fakeAnswerCount ? WARM_LIGHT : MID,
                    border: "2px solid rgba(255,255,255,0.15)",
                    transition: "background 0.3s",
                  }} />
                ))}
              </div>
            </div>
          ) : isWaiting ? (
            // Already answered
            <div>
              <p style={{ fontSize: 15, opacity: 0.7, fontWeight: 600, marginBottom: 8 }}>You answered:</p>
              <p style={{ fontSize: 20, fontWeight: 800, marginBottom: 20 }}>"{myAnswer?.text}"</p>
              <p style={{ fontSize: 14, opacity: 0.65, fontWeight: 600 }}>Waiting for everyone to answer…</p>
            </div>
          ) : (
            // Submit fake answer
            <div>
              <p style={{ fontSize: 16, opacity: 0.75, fontWeight: 600, marginBottom: 14 }}>
                Write a fake answer — something that sounds like the real prompt.
              </p>
              <textarea
                value={answerText}
                onChange={e => setAnswerText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitAnswer() } }}
                placeholder="Your fake answer…"
                maxLength={120}
                rows={2}
                style={{
                  width: "100%", background: WARM_LIGHT, color: "white",
                  fontSize: 18, fontWeight: 600, padding: "14px 16px", borderRadius: 8,
                  resize: "none", display: "block", marginBottom: 10, borderRadius: 0,
                }}
              />
              <button
                onClick={submitAnswer}
                disabled={!answerText.trim() || submittingAnswer}
                style={{ background: ACCENT, color: "#000", fontSize: 20, fontWeight: 900, padding: "18px", width: "100%", display: "block", animation: nudgeAnswer ? "nudgePulse 1.5s ease-in-out infinite" : "none" }}
              >
                {submittingAnswer ? "Submitting…" : "Submit"}
              </button>
            </div>
          )}
        </div>
      </div>
        {pokeSystemNode}
      </>
    )
  }

  // ── Voting phase ──────────────────────────────────────────────────────────

  if (game.phase === "voting") {
    const hasVoted = !!myVote

    return (
      <>
      <div style={{ minHeight: "100dvh", background: BG, color: "white", paddingBottom: 40 }}>
        <div style={{ padding: "28px 24px 20px", background: "#1C5250" }}>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.75, marginBottom: 4 }}>
            DRAWING {currentDrawingNumber} OF {drawingPlayers.length}
          </div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>{currentArtist?.name}'s drawing</div>
        </div>

        {currentArtist?.drawing_url && (
          <img
            src={currentArtist.drawing_url}
            alt="Drawing"
            style={{ width: "100%", display: "block", maxHeight: "35vh", objectFit: "contain" }}
          />
        )}

        <div style={{ padding: "20px 24px" }}>
          {amArtist ? (
            <p style={{ fontSize: 16, opacity: 0.75, fontWeight: 600, textAlign: "center", paddingTop: 8 }}>
              Watch everyone vote.
            </p>
          ) : hasVoted ? (
            <div>
              <p style={{ fontSize: 15, opacity: 0.7, fontWeight: 600, marginBottom: 20 }}>Waiting for everyone to vote…</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {currentAnswers.map(a => (
                  <div key={a.id} style={{
                    padding: "16px 18px", fontSize: 17, fontWeight: 700,
                    background: a.id === myVote?.answer_id ? WARM_LIGHT : MID,
                    border: a.id === myVote?.answer_id ? `2px solid ${ACCENT}` : "2px solid transparent",
                    opacity: a.id === myVote?.answer_id ? 1 : 0.5,
                  }}>
                    {a.text}
                    {a.id === myVote?.answer_id && <span style={{ fontSize: 12, color: ACCENT, marginLeft: 8 }}>← your vote</span>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 16, opacity: 0.75, fontWeight: 600, marginBottom: 14 }}>
                Pick what you think is the real answer.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                {currentAnswers.map(a => {
                  const isSelected = selectedAnswerId === a.id
                  const isOwn = a.author_id === myPlayerId
                  return (
                    <button
                      key={a.id}
                      onClick={() => !isOwn && setSelectedAnswerId(a.id)}
                      disabled={isOwn}
                      style={{
                        padding: "16px 18px", textAlign: "left",
                        fontSize: 17, fontWeight: 700, color: "white",
                        background: isSelected ? WARM_LIGHT : MID,
                        border: isSelected ? `2px solid ${ACCENT}` : "2px solid rgba(255,255,255,0.12)",
                        opacity: isOwn ? 0.35 : 1,
                      }}
                    >
                      {a.text}
                    </button>
                  )
                })}
              </div>
              <button
                onClick={submitVote}
                disabled={!selectedAnswerId || submittingVote}
                style={{ background: ACCENT, color: "#000", fontSize: 20, fontWeight: 900, padding: "18px", width: "100%", display: "block" }}
              >
                {submittingVote ? "Voting…" : "Vote"}
              </button>
            </div>
          )}
        </div>
      </div>
        {pokeSystemNode}
      </>
    )
  }

  // ── Results phase ─────────────────────────────────────────────────────────

  if (game.phase === "results") {
    const realAnswer = currentAnswers.find(a => a.is_real)
    const fakeAnswers = currentAnswers.filter(a => !a.is_real)
    const isLast = currentDrawingIndex >= n - 1
    const isMeReady = (game.ready_player_ids ?? []).includes(myPlayerId)
    const readyCount = (game.ready_player_ids ?? []).length

    return (
      <>
      <div style={{ minHeight: "100dvh", background: BG, color: "white", paddingBottom: 120 }}>
        <div style={{ padding: "28px 24px 20px", background: "#1C5250" }}>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.75, marginBottom: 4 }}>
            DRAWING {currentDrawingNumber} OF {drawingPlayers.length}
          </div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>{currentArtist?.name}'s drawing</div>
        </div>

        {currentArtist?.drawing_url && (
          <img
            src={currentArtist.drawing_url}
            alt="Drawing"
            style={{ width: "100%", display: "block", maxHeight: "30vh", objectFit: "contain" }}
          />
        )}

        <div style={{ padding: "20px 24px" }}>
          {/* Real answer */}
          {realAnswer && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: "rgba(255,255,255,0.85)", marginBottom: 10 }}>
                The Real Answer
              </div>
              <div style={{ background: "rgba(240,144,106,0.15)", border: `2px solid ${ACCENT}`, padding: "14px 18px" }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: ACCENT }}>{realAnswer.text}</div>
                {(() => {
                  const correctVoters = currentVotes
                    .filter(v => v.answer_id === realAnswer.id)
                    .map(v => players.find(p => p.id === v.voter_id)?.name)
                    .filter(Boolean)
                  return correctVoters.length > 0
                    ? (
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 800 }}>{correctVoters.join(", ")}</span>
                        <span style={{ fontSize: 13, opacity: 0.75, fontWeight: 600 }}>guessed right</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: ACCENT }}>+1 each</span>
                      </div>
                    )
                    : <div style={{ fontSize: 13, opacity: 0.65, fontWeight: 600, marginTop: 6 }}>Nobody got it!</div>
                })()}
              </div>
            </div>
          )}

          {/* Fake answers */}
          {fakeAnswers.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: "rgba(255,255,255,0.85)", marginBottom: 10 }}>
                The Fakes
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {fakeAnswers.map(a => {
                  const author = players.find(p => p.id === a.author_id)
                  const fooled = currentVotes
                    .filter(v => v.answer_id === a.id)
                    .map(v => players.find(p => p.id === v.voter_id)?.name)
                    .filter(Boolean)
                  return (
                    <div key={a.id} style={{ background: "#205858", padding: "12px 16px" }}>
                      <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{a.text}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 13, opacity: 0.7, fontWeight: 600 }}>by</span>
                        <span style={{ fontSize: 14, fontWeight: 800 }}>{author?.name ?? "?"}</span>
                        {fooled.length > 0 ? (
                          <>
                            <span style={{ fontSize: 13, opacity: 0.7, fontWeight: 600 }}>· fooled</span>
                            <span style={{ fontSize: 14, fontWeight: 800 }}>{fooled.join(", ")}</span>
                            <span style={{ fontSize: 13, fontWeight: 800, color: ACCENT }}>+{fooled.length}</span>
                          </>
                        ) : (
                          <span style={{ fontSize: 13, opacity: 0.65, fontWeight: 600 }}>· nobody fooled</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Running scores */}
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "rgba(255,255,255,0.85)", marginBottom: 10 }}>
              Scores
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {[...players].sort((a, b) => b.score - a.score).map((p, i) => (
                <div key={p.id} style={{ display: "flex" }}>
                  <div style={{
                    padding: "13px 0", minWidth: 56, flexShrink: 0,
                    background: i === 0 ? ACCENT : "#1C5250",
                    color: i === 0 ? "#000" : "white",
                    fontSize: 22, fontWeight: 900,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {p.score}
                  </div>
                  <div style={{
                    padding: "13px 16px", flex: 1,
                    background: "#245E5C",
                    display: "flex", flexDirection: "column", justifyContent: "center",
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>
                      {p.name}{p.id === myPlayerId && <span style={{ fontSize: 12, opacity: 0.65, marginLeft: 6 }}>you</span>}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 700 }}>#{i + 1}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Fixed bottom: all players ready to advance */}
        <div style={{ position: "fixed", bottom: FOOTER_H, left: 0, right: 0, padding: "16px 24px", paddingBottom: "calc(16px + env(safe-area-inset-bottom))", background: BG, borderTop: "1px solid rgba(255,255,255,0.15)" }}>
          {(isMeReady || markingReady) ? (
            <p style={{ fontSize: 14, fontWeight: 700, opacity: 0.75, textAlign: "center" }}>
              {readyCount} / {players.length} ready — waiting for others…
            </p>
          ) : (
            <button
              onClick={markReady}
              style={{ background: ACCENT, color: "#000", fontSize: 20, fontWeight: 900, padding: "20px", width: "100%", display: "block" }}
            >
              {isLast ? "See Final Scores →" : "Next Drawing →"}
            </button>
          )}
        </div>
      </div>
        {pokeSystemNode}
      </>
    )
  }

  return null
}

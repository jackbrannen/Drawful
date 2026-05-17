"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase"

const BG = "#64B5A9"
const ACCENT = "#F5E8D8"
const MUTED = "rgba(255,255,255,0.65)"
const DRAW_SECONDS = 90

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
  const stack=[startY*w+startX], visited=new Uint8Array(w*h), tol=40
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

  const [color, setColorState] = useState("#000000")
  const [brushSize, setBrushSize] = useState(8)
  const [toolMode, setToolModeState] = useState("pen")
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
    const dataUrl = cv.toDataURL({ format: "png" })
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
    let canvas, cancelled = false
    ;(async () => {
      const { fabric } = await import("fabric")
      if (cancelled || !canvasRef.current || !containerRef.current) return
      fabricLibRef.current = fabric
      const w = containerRef.current.clientWidth
      canvas = new fabric.Canvas(canvasRef.current, { isDrawingMode: true, width: w, height: w, backgroundColor: "#ffffff" })
      canvas.freeDrawingBrush.color = "#000000"
      canvas.freeDrawingBrush.width = 8
      canvas.on("path:created", () => {
        historyRef.current.push(JSON.stringify(canvas.toJSON()))
        redoStackRef.current = []; fireFirstMark()
      })
      canvas.on("mouse:down", (opt) => {
        if (toolModeRef.current !== "bucket") return
        const p = canvas.getPointer(opt.e)
        doBucketFillRef.current(Math.round(p.x), Math.round(p.y))
      })
      fabricRef.current = canvas
      onExportRef.current(() => canvas.toDataURL({ format: "jpeg", quality: 0.72 }))
    })()
    return () => { cancelled = true; fabricRef.current?.dispose(); fabricRef.current = null }
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
    setToolModeState(mode)
    const cv = fabricRef.current; if (!cv) return
    cv.isDrawingMode = mode !== "bucket"
    if (mode !== "bucket") applyBrush(colorRef.current, brushSizeRef.current, mode === "eraser")
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

  const BRUSH_SIZES = [2, 4, 8, 14, 22, 34, 52]

  return (
    <div ref={containerRef}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 0 8px" }}>
        {[
          { mode: "pen", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> },
          { mode: "eraser", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg> },
          { mode: "bucket", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 11-8-8-8.5 8.5a5.5 5.5 0 0 0 7.78 7.78Z"/><path d="m5 3 5 5"/><path d="M22 22c0-1.2-.2-2-.8-3-1.4 0-2.2 1.8-2.2 3"/></svg> },
        ].map(({ mode, icon }) => (
          <button key={mode} onClick={() => handleSetTool(mode === "eraser" && toolMode === "eraser" ? "pen" : mode === "bucket" && toolMode === "bucket" ? "pen" : mode)}
            style={{ background: toolMode === mode ? ACCENT : "rgba(255,255,255,0.15)", color: toolMode === mode ? "#000" : "white", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {icon}
          </button>
        ))}
        <button onClick={handleUndo} style={{ background: "rgba(255,255,255,0.15)", color: "white", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
        </button>
        <button onClick={handleRedo} style={{ background: "rgba(255,255,255,0.15)", color: "white", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
        </button>
        <button onClick={handleClear} style={{ background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.6)", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, paddingBottom: 10 }}>
        {BRUSH_SIZES.map((sz, i) => {
          const d = 5 + i * 4.5, active = brushSize === sz && toolMode !== "bucket"
          return (
            <button key={sz} onClick={() => handleSizeChange(sz)} disabled={toolMode === "bucket"}
              style={{ width: 38, height: 38, flexShrink: 0, background: active ? "rgba(255,255,255,0.18)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", border: active ? `2px solid ${ACCENT}` : "2px solid transparent" }}>
              <div style={{ width: d, height: d, borderRadius: "50%", background: "white" }} />
            </button>
          )
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
        {PALETTE.map(c => (
          <button key={c} onClick={() => handleColorClick(c)}
            style={{ width: 28, height: 28, background: c, flexShrink: 0,
              border: color === c && toolMode !== "eraser" ? "3px solid white" : c === "#FFFFFF" || c === "#DDDDDD" ? "1px solid rgba(255,255,255,0.25)" : "2px solid transparent" }} />
        ))}
      </div>

      <div style={{ overflow: "hidden", cursor: toolMode === "bucket" ? "crosshair" : "default" }}>
        <canvas ref={canvasRef} style={{ display: "block", touchAction: "none" }} />
      </div>
    </div>
  )
}

// ─── Main play page ───────────────────────────────────────────────────────────

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

  const [advancing, setAdvancing] = useState(false)

  const getExportRef = useRef(null)
  const prevPhaseRef = useRef(null)
  const prevDrawingIndexRef = useRef(-1)

  const me = players.find(p => p.id === myPlayerId)

  async function loadState() {
    const { data: gameData } = await supabase
      .from("drawful_games").select("*").eq("code", code).single()
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
    const poll = setInterval(loadState, 1500)
    const channel = supabase.channel(`drawful-play-${code}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "drawful_games", filter: `code=eq.${code}` }, loadState)
      .on("postgres_changes", { event: "*", schema: "public", table: "drawful_answers", filter: `game_code=eq.${code}` }, loadState)
      .on("postgres_changes", { event: "*", schema: "public", table: "drawful_votes", filter: `game_code=eq.${code}` }, loadState)
      .subscribe()
    return () => { clearInterval(poll); supabase.removeChannel(channel) }
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
  const currentDrawingIndex = game?.current_drawing_index ?? 0
  const currentArtist = useMemo(() => players.find(p => p.seat === currentDrawingIndex) ?? null, [players, currentDrawingIndex])
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
  }, [game?.phase, game?.is_dummy, currentArtist?.id, players.length, answers.length, votes.length])

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

  async function nextDrawing() {
    if (advancing) return
    setAdvancing(true)
    await supabase.rpc("drawful_next_drawing", { p_code: code })
    await loadState()
    setAdvancing(false)
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (!game || !me) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 18, fontWeight: 700 }}>Loading…</p>
      </div>
    )
  }

  // ── Finished ──────────────────────────────────────────────────────────────

  if (game.phase === "finished") {
    const sorted = [...players].sort((a, b) => b.score - a.score)
    const topScore = sorted[0]?.score ?? 0
    const winners = sorted.filter(p => p.score === topScore)

    return (
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
                background: i === 0 ? ACCENT : "#4A8A8F",
                color: i === 0 ? "#000" : "white",
                fontSize: 26, fontWeight: 900,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {p.score}
              </div>
              <div style={{
                padding: "16px 18px", flex: 1,
                background: "#568E91",
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
            style={{ background: "rgba(255,255,255,0.12)", color: "white", fontSize: 16, fontWeight: 700, padding: "16px 28px", width: "100%" }}
          >Back to lobby</button>
        </div>
      </div>
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
      <div style={{ minHeight: "100dvh", background: BG, color: "white" }}>
        {/* Timer bar */}
        <div style={{ height: 6, background: "rgba(255,255,255,0.15)" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: urgent ? "#F97316" : ACCENT, transition: "width 0.5s linear" }} />
        </div>

        <div style={{ padding: "16px 24px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.65 }}>
            DRAWING PHASE
          </div>
          <div style={{ fontSize: urgent ? 22 : 18, fontWeight: 900, color: urgent ? "#F97316" : "white" }}>
            {secondsLeft}s
          </div>
        </div>

        <div style={{ padding: "0 24px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.65, marginBottom: 6 }}>
            YOUR PROMPT
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.2, marginBottom: 4 }}>
            {me.prompt}
          </div>
          <div style={{ fontSize: 13, opacity: 0.65, fontWeight: 600 }}>Draw this. No letters or numbers!</div>
        </div>

        <div style={{ padding: "0 24px" }}>
          <DrawingCanvas
            onExport={fn => { getExportRef.current = fn }}
            onFirstMark={() => setDrawingDirty(true)}
          />
          <button
            onClick={() => submitDrawing(false)}
            disabled={submittingDrawing}
            style={{ background: ACCENT, color: "#000", fontSize: 20, fontWeight: 900, padding: "18px", width: "100%", display: "block", marginTop: 16 }}
          >
            {submittingDrawing ? "Submitting…" : "Done Drawing"}
          </button>
        </div>
      </div>
    )
  }

  // ── Guessing phase ────────────────────────────────────────────────────────

  if (game.phase === "guessing") {
    const nonArtistCount = n - 1
    const expectedAnswers = nonArtistCount
    const isWaiting = amArtist ? false : !!myAnswer

    return (
      <div style={{ minHeight: "100dvh", background: BG, color: "white" }}>
        <div style={{ padding: "28px 24px 20px", background: "#4A8A8F" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.65, marginBottom: 4 }}>
            DRAWING {currentDrawingIndex + 1} OF {n}
          </div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>{currentArtist?.name}'s drawing</div>
        </div>

        {currentArtist?.drawing_url && (
          <img
            src={currentArtist.drawing_url}
            alt="Drawing to guess"
            style={{ width: "100%", display: "block", maxHeight: "40vh", objectFit: "contain", background: "#fff" }}
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
                    background: i < fakeAnswerCount ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.07)",
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
                  width: "100%", background: "rgba(255,255,255,0.15)", color: "white",
                  fontSize: 18, fontWeight: 600, padding: "14px 16px", borderRadius: 8,
                  resize: "none", display: "block", marginBottom: 10, borderRadius: 0,
                }}
              />
              <button
                onClick={submitAnswer}
                disabled={!answerText.trim() || submittingAnswer}
                style={{ background: ACCENT, color: "#000", fontSize: 20, fontWeight: 900, padding: "18px", width: "100%", display: "block" }}
              >
                {submittingAnswer ? "Submitting…" : "Submit"}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Voting phase ──────────────────────────────────────────────────────────

  if (game.phase === "voting") {
    const hasVoted = !!myVote

    return (
      <div style={{ minHeight: "100dvh", background: BG, color: "white", paddingBottom: 40 }}>
        <div style={{ padding: "28px 24px 20px", background: "#4A8A8F" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.65, marginBottom: 4 }}>
            DRAWING {currentDrawingIndex + 1} OF {n}
          </div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>{currentArtist?.name}'s drawing</div>
        </div>

        {currentArtist?.drawing_url && (
          <img
            src={currentArtist.drawing_url}
            alt="Drawing"
            style={{ width: "100%", display: "block", maxHeight: "35vh", objectFit: "contain", background: "#fff" }}
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
                    background: a.id === myVote?.answer_id ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)",
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
                  // Prevent voting for your own fake answer
                  const isOwn = a.author_id === myPlayerId
                  return (
                    <button
                      key={a.id}
                      onClick={() => !isOwn && setSelectedAnswerId(a.id)}
                      disabled={isOwn}
                      style={{
                        padding: "16px 18px", textAlign: "left",
                        fontSize: 17, fontWeight: 700, color: "white",
                        background: isSelected ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)",
                        border: isSelected ? `2px solid ${ACCENT}` : "2px solid rgba(255,255,255,0.12)",
                        opacity: isOwn ? 0.3 : 1,
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
    )
  }

  // ── Results phase ─────────────────────────────────────────────────────────

  if (game.phase === "results") {
    const realAnswer = currentAnswers.find(a => a.is_real)
    const fakeAnswers = currentAnswers.filter(a => !a.is_real)
    const isHost = me.seat === 0
    const isLast = currentDrawingIndex >= n - 1

    return (
      <div style={{ minHeight: "100dvh", background: BG, color: "white", paddingBottom: 120 }}>
        <div style={{ padding: "28px 24px 20px", background: "#4A8A8F" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.65, marginBottom: 4 }}>
            DRAWING {currentDrawingIndex + 1} OF {n}
          </div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>{currentArtist?.name}'s drawing</div>
        </div>

        {currentArtist?.drawing_url && (
          <img
            src={currentArtist.drawing_url}
            alt="Drawing"
            style={{ width: "100%", display: "block", maxHeight: "30vh", objectFit: "contain", background: "#fff" }}
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
                    <div key={a.id} style={{ background: "#4E8589", padding: "12px 16px" }}>
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
                    background: i === 0 ? ACCENT : "#4A8A8F",
                    color: i === 0 ? "#000" : "white",
                    fontSize: 22, fontWeight: 900,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {p.score}
                  </div>
                  <div style={{
                    padding: "13px 16px", flex: 1,
                    background: "#568E91",
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

        {/* Fixed bottom: host advances */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "16px 24px", paddingBottom: "calc(16px + env(safe-area-inset-bottom))", background: BG, borderTop: "1px solid rgba(255,255,255,0.15)" }}>
          {isHost ? (
            <button
              onClick={nextDrawing}
              disabled={advancing}
              style={{ background: ACCENT, color: "#000", fontSize: 20, fontWeight: 900, padding: "20px", width: "100%", display: "block" }}
            >
              {advancing ? "…" : isLast ? "See Final Scores →" : "Next Drawing →"}
            </button>
          ) : (
            <p style={{ fontSize: 14, opacity: 0.65, fontWeight: 600, textAlign: "center" }}>
              Waiting for {players.find(p => p.seat === 0)?.name} to continue…
            </p>
          )}
        </div>
      </div>
    )
  }

  return null
}

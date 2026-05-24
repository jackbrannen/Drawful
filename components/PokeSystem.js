"use client"

import { useEffect, useRef, useState } from "react"
import { supabase } from "../lib/supabase"

export const FOOTER_H = 56


function playPing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = "sine"
    osc.frequency.setValueAtTime(900, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.35)
    gain.gain.setValueAtTime(0.35, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.5)
  } catch {}
}

// colors: { dark, mid, wl, yellow, notifBg }
// onResetToLobby: async () => void  — omit to hide the Lobby tile
// rules: [[title, body], ...]       — omit to hide the Rules tile
// word: string | null               — shown as "My Word" tile when non-null
// children: JSX for the right side of the footer bar
export default function PokeSystem({
  colors = {},
  onResetToLobby,
  rules,
  roomCode,
  currentPlayer,
  allPlayers = [],
  playerDetails = [],
  word = null,
  roleContent = null,
  gamePhase,
  timerRunning = false,
  peekBarHeight = "0px",
  children,
}) {
  const {
    dark    = "#1A1A2E",
    mid     = "#252540",
    wl      = "#3A3A60",
    yellow  = "#FBDF54",
    notifBg = "#0F0F20",
  } = colors

  const [notifications, setNotifications] = useState([])
  const [panel, setPanel]               = useState(null)
  const [msgCustom, setMsgCustom]       = useState("")
  const [msgSending, setMsgSending]     = useState(false)
  const [pokeTarget, setPokeTarget]     = useState(null)
  const [pokeSending, setPokeSending]   = useState(false)
  const [lobbyResetting, setLobbyResetting] = useState(false)
  const [cooldownSec, setCooldownSec]   = useState(0)

  const prevPhaseRef     = useRef(gamePhase)
  const knownIdsRef      = useRef(new Set())
  const hasLoadedRef     = useRef(false)
  const currentPlayerRef = useRef(currentPlayer)
  const touchStartsRef   = useRef({})
  const cooldownEndRef   = useRef(0)
  const cooldownTickRef  = useRef(null)
  useEffect(() => { currentPlayerRef.current = currentPlayer }, [currentPlayer])

  function addNotification(poke) {
    const id = poke.id
    setNotifications(prev => {
      if (prev.some(n => n.id === id)) return prev
      return [{ id, poke, exiting: false }, ...prev]
    })
    if (poke.to_player && poke.to_player === currentPlayerRef.current) {
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([80, 40, 160])
      playPing()
    }
    setTimeout(() => setNotifications(prev => prev.map(n => n.id === id ? { ...n, exiting: true } : n)), 3500)
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 4000)
  }

  async function loadPokes() {
    const { data } = await supabase
      .from("pokes")
      .select("*")
      .eq("room_code", roomCode)
      .order("created_at", { ascending: true })

    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true
      if (data?.length) data.forEach(p => knownIdsRef.current.add(p.id))
      return
    }
    if (!data?.length) return
    const newOnes = data.filter(p => !knownIdsRef.current.has(p.id))
    if (!newOnes.length) return
    newOnes.forEach(p => knownIdsRef.current.add(p.id))
    newOnes.forEach(poke => addNotification(poke))
  }

  useEffect(() => {
    loadPokes()
    let poll = setInterval(loadPokes, 5000)
    function handleVisibility() { clearInterval(poll); if (!document.hidden) { loadPokes(); poll = setInterval(loadPokes, 5000) } }
    document.addEventListener("visibilitychange", handleVisibility)
    const ch = supabase.channel(`pokes-${roomCode}-${Math.random()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pokes", filter: `room_code=eq.${roomCode}` }, ({ new: poke }) => {
        if (knownIdsRef.current.has(poke.id)) return
        knownIdsRef.current.add(poke.id)
        addNotification(poke)
      })
      .subscribe()
    return () => { clearInterval(poll); document.removeEventListener("visibilitychange", handleVisibility); supabase.removeChannel(ch) }
  }, [roomCode])

  useEffect(() => {
    if (prevPhaseRef.current !== gamePhase) {
      setPanel(null)
      prevPhaseRef.current = gamePhase
    }
  }, [gamePhase])

  useEffect(() => {
    if (timerRunning) setPanel(null)
  }, [timerRunning])

  function openMessage() { setMsgCustom(""); setPanel("message") }
  function openPoke()    { setPokeTarget(null); setPanel("poke") }

  async function sendMessage() {
    if (msgSending) return
    const msg = msgCustom.trim()
    if (!msg) return
    setMsgSending(true)
    await supabase.from("pokes").insert({ room_code: roomCode, from_player: currentPlayer, to_player: null, message: msg })
    setPanel(null)
    setMsgSending(false)
  }

  function startCooldown() {
    clearInterval(cooldownTickRef.current)
    cooldownEndRef.current = Date.now() + 10000
    setCooldownSec(10)
    cooldownTickRef.current = setInterval(() => {
      const s = Math.ceil((cooldownEndRef.current - Date.now()) / 1000)
      if (s <= 0) { clearInterval(cooldownTickRef.current); setCooldownSec(0) }
      else setCooldownSec(s)
    }, 500)
  }

  async function sendPoke(target) {
    if (pokeSending || cooldownSec > 0) return
    setPokeSending(true)
    await supabase.from("pokes").insert({ room_code: roomCode, from_player: currentPlayer, to_player: target, message: "👉" })
    setPanel(null)
    setPokeSending(false)
    startCooldown()
  }

  async function handleResetToLobby() {
    if (lobbyResetting || !onResetToLobby) return
    setLobbyResetting(true)
    try { await onResetToLobby() } catch {}
    setPanel(null)
    setLobbyResetting(false)
  }

  const pokePlayers = allPlayers.filter(n => n !== currentPlayer)
  const msgActive   = !!msgCustom.trim()

  const footerBottom = peekBarHeight
  const drawerBottom = `calc(${peekBarHeight} + ${FOOTER_H}px)`

  const TILES = [
    word !== null ? { icon: "📖", label: "My Word", action: () => setPanel("myWord") } : null,
    roleContent !== null ? { icon: "🃏", label: "My Role", action: () => setPanel("myRole") } : null,
    { icon: "👥", label: "Players",  action: () => setPanel("players") },
    rules ? { icon: "📋", label: "Rules", action: () => setPanel("rules") } : null,
    { icon: "😊", label: "Message", action: openMessage },
    { icon: "👉", label: "Poke",    action: openPoke },
    onResetToLobby ? { icon: "🏠", label: "Lobby", action: () => setPanel("lobbyWarn1") } : null,
  ].filter(Boolean)

  return (
    <>
      <style>{`
        @keyframes notifEnter { from { transform: translateX(60px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes notifExit  { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-16px); opacity: 0; } }
        @keyframes notifPoke  {
          0%   { transform: translateX(60px); opacity: 0; background: ${notifBg}; }
          25%  { transform: translateX(0);    opacity: 1; background: ${yellow}; }
          50%  { background: ${notifBg}; }
          70%  { background: ${yellow}; }
          100% { background: ${notifBg}; opacity: 1; }
        }
        @keyframes drawerUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>

      {/* ── Notification strips — top right ── */}
      <div style={{
        position: "fixed", top: 12, right: 12, left: 12, zIndex: 200,
        display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end",
      }}>
        {notifications.map(({ id, poke, exiting }) => {
          const isForMe = poke.to_player && poke.to_player === currentPlayer
          function dismiss() {
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, exiting: true } : n))
            setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 450)
          }
          return (
            <div key={id}
              onTouchStart={e => {
                if (exiting) return
                touchStartsRef.current[id] = { x: e.touches[0].clientX, y: e.touches[0].clientY }
              }}
              onTouchMove={e => {
                const start = touchStartsRef.current[id]
                if (!start) return
                const dx = e.touches[0].clientX - start.x
                const dy = e.touches[0].clientY - start.y
                e.currentTarget.style.transform = `translate(${dx}px, ${dy}px)`
                e.currentTarget.style.opacity = `${Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 120)}`
                e.currentTarget.style.transition = "none"
              }}
              onTouchEnd={e => {
                const start = touchStartsRef.current[id]
                if (!start) return
                const dx = e.changedTouches[0].clientX - start.x
                const dy = e.changedTouches[0].clientY - start.y
                const dist = Math.sqrt(dx * dx + dy * dy)
                delete touchStartsRef.current[id]
                if (dist >= 40) {
                  e.preventDefault()
                  const scale = 280 / dist
                  e.currentTarget.style.transition = "transform 0.28s ease-out, opacity 0.28s ease-out"
                  e.currentTarget.style.transform = `translate(${dx + dx * scale}px, ${dy + dy * scale}px)`
                  e.currentTarget.style.opacity = "0"
                  setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 300)
                } else {
                  e.currentTarget.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out"
                  e.currentTarget.style.transform = ""
                  e.currentTarget.style.opacity = ""
                }
              }}
              onClick={dismiss}
              style={{
                background: notifBg, padding: "8px 12px", maxWidth: 260,
                boxShadow: "0 2px 16px rgba(0,0,0,0.6)", cursor: "pointer",
                display: "flex", alignItems: "flex-start", gap: 8,
                animation: exiting
                  ? "notifExit 0.45s ease-in forwards"
                  : isForMe ? "notifPoke 0.45s ease-out forwards" : "notifEnter 0.3s ease-out forwards",
              }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "white", lineHeight: 1.3 }}>
                  {poke.to_player
                    ? (isForMe ? `👉 ${poke.from_player} poked you` : `👉 ${poke.to_player}`)
                    : poke.message}
                </div>
                {!isForMe && (
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 2 }}>{poke.from_player}</div>
                )}
              </div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1, flexShrink: 0, marginTop: 1 }}>✕</div>
            </div>
          )
        })}
      </div>

      {/* ── Sticky footer ── */}
      <div style={{
        position: "fixed", bottom: footerBottom, left: 0, right: 0,
        height: FOOTER_H, background: dark,
        display: "flex", alignItems: "stretch",
        borderTop: "1px solid rgba(255,255,255,0.09)",
        zIndex: 80,
      }}>
        <button
          onClick={() => !timerRunning && setPanel(p => p === "drawer" ? null : "drawer")}
          disabled={timerRunning}
          style={{
            width: 56, flexShrink: 0,
            background: panel === "drawer" ? wl : "transparent",
            color: "white", fontSize: 18,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRight: "1px solid rgba(255,255,255,0.09)",
            transition: "background 0.15s",
            opacity: timerRunning ? 0.25 : 1,
          }}
        >
          {panel === "drawer" ? "✕" : "☰"}
        </button>
        <div style={{ flex: 1, display: "flex", alignItems: "stretch" }}>{children}</div>
      </div>

      {panel === "drawer" && (
        <div onClick={() => setPanel(null)} style={{ position: "fixed", inset: 0, zIndex: 71 }} />
      )}

      {/* ── Drawer panel ── */}
      {panel === "drawer" && (
        <div style={{
          position: "fixed", bottom: drawerBottom, left: 0, right: 0,
          background: mid, borderTop: "1px solid rgba(255,255,255,0.1)",
          zIndex: 78, animation: "drawerUp 0.22s ease",
        }}>
          <div onClick={() => setPanel(null)} style={{ padding: "10px 0 4px", display: "flex", justifyContent: "center", cursor: "pointer" }}>
            <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.22)", borderRadius: 2 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", paddingBottom: 12 }}>
            {TILES.map(({ icon, label, action }) => (
              <button key={label} onClick={action} style={{
                background: "transparent",
                color: label === "Lobby" ? "rgba(255,120,100,0.9)" : "white",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                padding: "14px 8px", gap: 6,
              }}>
                <span style={{ fontSize: 26 }}>{icon}</span>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", opacity: 0.7 }}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── My Word modal ── */}
      {panel === "myWord" && word && (
        <div onClick={() => setPanel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 20px" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: mid, width: "100%", maxWidth: 400, padding: "32px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.65, color: "white" }}>Your word</div>
            <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: "-1px", color: "white", textAlign: "center" }}>{word}</div>
            <button onClick={() => setPanel(null)} style={{ background: dark, color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: 800, padding: "14px", width: "100%" }}>Done</button>
          </div>
        </div>
      )}

      {/* ── My Role modal ── */}
      {panel === "myRole" && roleContent && (
        <div onClick={() => setPanel(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,25,35,0.97)", zIndex: 95, overflowY: "auto", padding: 24 }}>
          <div onClick={e => e.stopPropagation()}>
            {roleContent}
            <button onClick={() => setPanel(null)} style={{ background: mid, color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: 800, padding: "14px", width: "100%", display: "block", marginTop: 16 }}>Done</button>
          </div>
        </div>
      )}

      {/* ── Players modal ── */}
      {panel === "players" && (
        <div onClick={() => setPanel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 20px" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: mid, width: "100%", maxWidth: 400, padding: "24px", display: "flex", flexDirection: "column", gap: 16, maxHeight: "80dvh", overflowY: "auto" }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: "white" }}>Players</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {playerDetails.map((p, i) => (
                <div key={p.name} style={{ display: "flex" }}>
                  <div style={{ padding: "12px 0", minWidth: 40, flexShrink: 0, background: dark, fontSize: 16, fontWeight: 900, color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {i + 1}
                  </div>
                  <div style={{ padding: "12px 16px", flex: 1, background: dark, filter: "brightness(1.4)", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "white" }}>{p.name}</div>
                      {(p.firstName || p.lastName) && (
                        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)" }}>{[p.firstName, p.lastName].filter(Boolean).join(" ")}</div>
                      )}
                    </div>
                    {p.teamColor && (
                      <div style={{ background: p.teamColor, color: p.teamTextColor ?? "#fff", fontSize: 12, fontWeight: 800, padding: "3px 8px", flexShrink: 0 }}>
                        {p.teamLabel ?? p.team}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setPanel(null)} style={{ background: dark, color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: 800, padding: "14px" }}>Done</button>
          </div>
        </div>
      )}

      {/* ── Message modal ── */}
      {panel === "message" && (
        <div onClick={() => setPanel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 20px" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: mid, width: "100%", maxWidth: 400, padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: "white" }}>Message the room</div>
            <input type="text" placeholder="Type a message…" value={msgCustom}
              onChange={e => setMsgCustom(e.target.value)}
              maxLength={32}
              style={{ background: dark, color: "white", fontSize: 15, fontWeight: 600, padding: "12px 14px", width: "100%", display: "block", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPanel(null)} style={{ flex: 1, background: dark, color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: 800, padding: "14px" }}>Cancel</button>
              <button onClick={sendMessage} disabled={!msgActive || msgSending}
                style={{ flex: 2, background: yellow, color: "#000", fontSize: 15, fontWeight: 900, padding: "14px" }}>
                {msgSending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Poke modal ── */}
      {panel === "poke" && (
        <div onClick={() => setPanel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 20px" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: mid, width: "100%", maxWidth: 400, padding: "24px", display: "flex", flexDirection: "column", gap: 16, maxHeight: "80dvh", overflowY: "auto" }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: "white" }}>Poke a player</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {pokePlayers.map(name => (
                <button key={name} onClick={() => setPokeTarget(pokeTarget === name ? null : name)}
                  style={{ background: pokeTarget === name ? yellow : dark, color: pokeTarget === name ? "#000" : "white", fontSize: 16, fontWeight: 700, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>{name}</span>
                  <span style={{ fontSize: 20 }}>👉</span>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPanel(null)} style={{ flex: 1, background: dark, color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: 800, padding: "14px" }}>Cancel</button>
              <button onClick={() => pokeTarget && sendPoke(pokeTarget)} disabled={!pokeTarget || pokeSending || cooldownSec > 0}
                style={{ flex: 2, background: cooldownSec > 0 ? "rgba(255,255,255,0.1)" : yellow, color: cooldownSec > 0 ? "rgba(255,255,255,0.4)" : "#000", fontSize: 15, fontWeight: 900, padding: "14px" }}>
                {pokeSending ? "Poking…" : cooldownSec > 0 ? `Wait ${cooldownSec}s` : pokeTarget ? `Poke ${pokeTarget}` : "Pick someone"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rules modal ── */}
      {panel === "rules" && rules && (
        <div onClick={() => setPanel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 20px" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: mid, width: "100%", maxWidth: 400, padding: "24px", display: "flex", flexDirection: "column", gap: 16, maxHeight: "80dvh", overflowY: "auto" }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: "white" }}>How to Play</div>
            {rules.map(([title, body]) => (
              <div key={title}>
                <div style={{ fontSize: 13, fontWeight: 800, color: yellow, marginBottom: 4 }}>{title}</div>
                <div style={{ fontSize: 15, fontWeight: 500, color: "rgba(255,255,255,0.85)", lineHeight: 1.5 }}>{body}</div>
              </div>
            ))}
            <button onClick={() => setPanel(null)} style={{ background: dark, color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: 800, padding: "14px" }}>Got it</button>
          </div>
        </div>
      )}

      {/* ── Lobby warning 1 ── */}
      {panel === "lobbyWarn1" && (
        <div onClick={() => setPanel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 20px" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: mid, width: "100%", maxWidth: 400, padding: "28px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: "white" }}>Back to Lobby</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.8)", lineHeight: 1.5 }}>This resets the game for everyone.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPanel(null)} style={{ flex: 1, background: dark, color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: 800, padding: "14px" }}>Cancel</button>
              <button onClick={() => setPanel("lobbyWarn2")} style={{ flex: 2, background: wl, color: "white", fontSize: 15, fontWeight: 900, padding: "14px" }}>Continue</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lobby warning 2 — red ── */}
      {panel === "lobbyWarn2" && (
        <div onClick={() => setPanel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 20px" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#2A0C0C", width: "100%", maxWidth: 400, padding: "28px 24px", display: "flex", flexDirection: "column", gap: 16, border: "1.5px solid #8B2222" }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: "white" }}>Are you sure?</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.85)", lineHeight: 1.5 }}>Are you sure you want to totally reset the game for everyone?</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPanel(null)} style={{ flex: 1, background: dark, color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: 800, padding: "14px" }}>Cancel</button>
              <button onClick={handleResetToLobby} disabled={lobbyResetting}
                style={{ flex: 2, background: "#B03030", color: "white", fontSize: 15, fontWeight: 900, padding: "14px" }}>
                {lobbyResetting ? "Resetting…" : "Yes, reset"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

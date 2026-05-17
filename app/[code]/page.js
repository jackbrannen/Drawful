"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../lib/supabase"

const BG = "#307977"
const ACCENT = "#F5E8D8"
const MIN_PLAYERS = 4

const WORDS_A = [
  "MAPLE","RIVER","OCEAN","VELVET","COPPER","SILVER","EMBER","FOREST","CLOUD",
  "IVORY","SAPPHIRE","SPRING","SUMMER","WINTER","AUTUMN","MORNING","MIDNIGHT","ORCHID","LANTERN",
  "PINE","CEDAR","MEADOW","CANYON","HARBOR","ISLAND","VALLEY","MOUNTAIN","GARDEN","BREEZE",
  "COMET","ROCKET","MIRROR","CARPET","POCKET","BRIDGE","CANDLE","PILOT","CIRCUS","PARADE",
  "BLOSSOM","CORAL","PEBBLE","MARBLE","FROST","FLAME","SPARK","SHADOW","WONDER","GLIMMER",
  "HONEY","BUTTER","COOKIE","WAFFLE","MUFFIN","BAGEL","COCOA","LATTE","LEMON","MANGO",
  "PLUM","PEACH","BERRY","OLIVE","BASIL","PEPPER","GINGER","SUGAR","SALMON","TURKEY",
  "PANDA","TIGER","OTTER","EAGLE","FALCON","ROBIN","WHALE","DOLPHIN","KOALA","ZEBRA",
]

function splitCode(code) {
  for (const w of WORDS_A) {
    if (code.startsWith(w)) return [w, code.slice(w.length)]
  }
  return [code, ""]
}

function loadProfile() {
  try {
    const local = JSON.parse(localStorage.getItem("jackgames:profile") || "null")
    if (local?.firstName && local?.lastName) return local
    const match = document.cookie.match(/(?:^|;\s*)jackgames_profile=([^;]*)/)
    if (match) return JSON.parse(decodeURIComponent(match[1]))
  } catch {}
  return null
}

function saveProfile(profile) {
  const json = JSON.stringify(profile)
  localStorage.setItem("jackgames:profile", json)
  document.cookie = `jackgames_profile=${encodeURIComponent(json)}; domain=.jackbrannen.com; max-age=31536000; path=/; SameSite=Lax`
}

const inputStyle = {
  background: "rgba(255,255,255,0.15)", color: "white", fontSize: 20,
  padding: "16px 18px", width: "100%", display: "block", boxSizing: "border-box",
}

export default function Lobby({ params }) {
  const router = useRouter()
  const code = useMemo(() => params.code.toUpperCase(), [params.code])

  const [game, setGame] = useState(null)
  const [players, setPlayers] = useState([])
  const [myPlayerId, setMyPlayerId] = useState(null)
  const [savedProfile, setSavedProfile] = useState(null)
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [username, setUsername] = useState("")
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState("")
  const [notFound, setNotFound] = useState(false)
  const [starting, setStarting] = useState(false)

  const me = players.find(p => p.id === myPlayerId)
  const humanPlayers = players.filter(p => !p.is_bot)

  async function loadState() {
    const { data: gameData } = await supabase
      .from("drawful_games").select("code,phase,is_dummy,host_id").eq("code", code).single()
    if (!gameData) { setNotFound(true); return }
    const { data: playerData } = await supabase
      .from("drawful_players").select("id,name,is_bot,created_at")
      .eq("game_code", code).order("created_at", { ascending: true })
    setGame(gameData)
    setPlayers(playerData ?? [])
  }

  useEffect(() => {
    const existing = localStorage.getItem(`drawful:${code}:playerId`)
    if (existing) setMyPlayerId(existing)
  }, [code])

  useEffect(() => {
    const saved = loadProfile()
    if (saved) { saveProfile(saved); setSavedProfile(saved); setUsername(saved.username || "") }
  }, [])

  useEffect(() => {
    loadState()
    const poll = setInterval(loadState, 5000)
    const channel = supabase.channel(`drawful-lobby-${code}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "drawful_players", filter: `game_code=eq.${code}` }, loadState)
      .on("postgres_changes", { event: "*", schema: "public", table: "drawful_games", filter: `code=eq.${code}` }, loadState)
      .subscribe()
    return () => { clearInterval(poll); supabase.removeChannel(channel) }
  }, [code])

  useEffect(() => {
    if (game?.phase === "drawing" && me) router.replace(`/${code}/play`)
  }, [game?.phase, me])

  useEffect(() => {
    if (game?.phase === "finished" && me) {
      supabase.rpc("drawful_reset_game", { p_code: code })
    }
  }, [game?.phase, me])

  async function join() {
    const trimmedUsername = username.trim()
    const trimmedFirst = (savedProfile?.firstName || firstName).trim()
    const trimmedLast = (savedProfile?.lastName || lastName).trim()
    if (!trimmedUsername || !trimmedFirst || !trimmedLast || joining) return
    setJoining(true)
    setJoinError("")

    const { data: existing } = await supabase
      .from("drawful_players").select("id").eq("game_code", code).ilike("name", trimmedUsername).limit(1)
    if (existing?.length > 0) {
      setJoinError("That username is already taken in this game. Please choose another.")
      setJoining(false)
      return
    }

    const newProfile = { firstName: trimmedFirst, lastName: trimmedLast, username: trimmedUsername }
    saveProfile(newProfile)
    setSavedProfile(newProfile)

    const { data, error } = await supabase
      .from("drawful_players")
      .insert({ game_code: code, name: trimmedUsername, first_name: trimmedFirst, last_name: trimmedLast, is_bot: false })
      .select("id").single()
    if (error) { alert("Failed to join: " + error.message); setJoining(false); return }

    localStorage.setItem(`drawful:${code}:playerId`, data.id)
    setMyPlayerId(data.id)
  }

  async function startGame() {
    if (starting) return
    setStarting(true)
    const { error } = await supabase.rpc("drawful_start_game", { p_code: code })
    if (error) { alert("Failed to start: " + error.message); setStarting(false) }
  }

  if (notFound) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <p style={{ color: "white", fontSize: 20, fontWeight: 700, textAlign: "center" }}>Game not found. Check the code and try again.</p>
      </div>
    )
  }
  if (!game) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 18, fontWeight: 700 }}>Loading…</p>
      </div>
    )
  }
  if (game.phase !== "lobby" && !me) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.7, marginBottom: 16 }}>Drawful</div>
        <h2 style={{ fontSize: 28, fontWeight: 900, marginBottom: 12, color: "white" }}>
          {game.phase === "finished" ? "Game over." : "A game is in progress."}
        </h2>
        <p style={{ fontSize: 16, opacity: 0.55, fontWeight: 500, marginBottom: 32, color: "white" }}>
          {game.phase === "finished" ? "The lobby will open shortly." : "This page will update when the game ends."}
        </p>
        <button onClick={loadState} style={{ background: "rgba(255,255,255,0.15)", color: "white", fontSize: 16, fontWeight: 700, padding: "14px 24px" }}>Refresh</button>
      </div>
    )
  }

  const canStart = humanPlayers.length >= MIN_PLAYERS

  return (
    <div style={{ minHeight: "100dvh", background: BG, color: "white" }}>
      {/* Header */}
      <div style={{ padding: "28px 24px 24px", background: "#1C5250", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.65, marginBottom: 4 }}>Drawful</div>
          <div style={{ fontSize: "clamp(18px, 6vw, 38px)", fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, whiteSpace: "nowrap" }}>
            {(() => {
              const [w1, w2] = splitCode(code)
              return <><span style={{ color: ACCENT }}>{w1}</span><span style={{ color: "rgba(255,255,255,0.75)" }}>{w2}</span></>
            })()}
          </div>
        </div>
        <button
          onClick={async () => {
            const url = window.location.href
            if (navigator.share) await navigator.share({ title: `Join Drawful — ${code}`, url })
            else { await navigator.clipboard.writeText(url); alert("Link copied!") }
          }}
          style={{ background: "rgba(255,255,255,0.12)", color: "white", fontSize: 13, fontWeight: 800, padding: "10px 16px", flexShrink: 0, marginTop: 4 }}
        >
          Invite
        </button>
      </div>

      {/* Start CTA */}
      {canStart && me && (
        <div style={{ padding: "20px 24px", background: ACCENT }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#000", opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>
            All players in?
          </div>
          <button
            onClick={startGame}
            disabled={starting}
            style={{ background: "#000", color: ACCENT, fontSize: 24, fontWeight: 900, padding: "20px", width: "100%", display: "block" }}
          >
            {starting ? "Starting…" : "Start Game"}
          </button>
          <p style={{ fontSize: 13, color: "#000", opacity: 0.7, marginTop: 10, fontWeight: 600 }}>
            {humanPlayers.length} players = {humanPlayers.length} drawings.
          </p>
        </div>
      )}

      {/* Join form */}
      {!me && (
        <div style={{ padding: "28px 24px 0" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>
            Join Game
          </div>
          {!savedProfile && (
            <>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" maxLength={40} style={{ ...inputStyle, marginBottom: 8 }} />
              <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" maxLength={40} style={{ ...inputStyle, marginBottom: 8 }} />
            </>
          )}
          <input
            value={username} onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === "Enter" && join()}
            placeholder="Display Name" maxLength={40} style={inputStyle}
          />
          <button
            onClick={join}
            disabled={!username.trim() || (!savedProfile && (!firstName.trim() || !lastName.trim())) || joining}
            style={{ background: ACCENT, color: "#000", fontSize: 20, fontWeight: 900, padding: "18px", width: "100%", marginTop: 8, display: "block" }}
          >
            {joining ? "Joining…" : "Join"}
          </button>
          {joinError && <div style={{ fontSize: 14, fontWeight: 700, color: "#F97316", marginTop: 10 }}>{joinError}</div>}
        </div>
      )}

      {/* Players */}
      <div style={{ padding: "28px 24px 40px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>
          Players
        </div>
        <div style={{ background: "#245E5C", padding: "4px 14px 10px", borderTop: "3px solid rgba(255,255,255,0.30)" }}>
          {humanPlayers.length === 0 && <div style={{ fontSize: 14, opacity: 0.65, fontStyle: "italic", paddingTop: 10 }}>No players yet</div>}
          {humanPlayers.map(p => (
            <div key={p.id} style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
              <span style={{ fontSize: 17, fontWeight: 700 }}>
                {p.name}
                {p.id === myPlayerId && <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.65, marginLeft: 6 }}>you</span>}
              </span>
            </div>
          ))}
        </div>
        {humanPlayers.length < MIN_PLAYERS && (
          <p style={{ fontSize: 13, opacity: 0.65, fontWeight: 600, marginTop: 10 }}>Minimum {MIN_PLAYERS} players needed.</p>
        )}
      </div>
    </div>
  )
}

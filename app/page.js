"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../lib/supabase"

const BG = "#B56576"
const ACCENT = "#F0906A"

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
const WORDS_B = [
  "CASTLE","CANDLE","BRIDGE","ROCKET","MIRROR","LANTERN","POCKET","CARPET","PILOT","HARBOR",
  "ISLAND","VALLEY","FOREST","GARDEN","MEADOW","CANYON","RIVER","OCEAN","MOUNTAIN","BREEZE",
  "CLOUD","EMBER","SPARK","GLIMMER","SHADOW","FROST","FLAME","SAPPHIRE","IVORY","MARBLE",
  "COPPER","SILVER","CORAL","ORCHID","BLOSSOM","HONEY","COCOA","LATTE","LEMON","MANGO",
  "PEACH","PLUM","BERRY","OLIVE","BASIL","PEPPER","PANDA","OTTER","EAGLE","FALCON",
  "ROBIN","WHALE","DOLPHIN","KOALA","ZEBRA","NINJA","KNIGHT","WIZARD","RANGER","SCOUT",
]
const BOT_NAMES = ["Raccoon", "Flamingo", "Capybara", "Narwhal"]

function randomCode() {
  const a = WORDS_A[Math.floor(Math.random() * WORDS_A.length)]
  const b = WORDS_B[Math.floor(Math.random() * WORDS_B.length)]
  return `${a}${b}`
}

async function ensurePromptBank() {
  const { count } = await supabase
    .from("drawful_prompts")
    .select("id", { count: "exact", head: true })
    .is("used_at", null)
  if ((count ?? 0) < 10) {
    await fetch("/api/generate-prompts", { method: "POST" })
  }
}

async function createGame(isDummy = false) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const code = randomCode()
    const { count } = await supabase
      .from("drawful_games")
      .select("code", { count: "exact", head: true })
      .eq("code", code)
      .neq("phase", "finished")
    if ((count ?? 0) > 0) continue
    const { data, error } = await supabase
      .from("drawful_games")
      .insert({ code, is_dummy: isDummy })
      .select("code")
      .single()
    if (error) throw error
    return String(data.code).toUpperCase()
  }
  throw new Error("unable_to_allocate_game_code")
}

export default function Home() {
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)
  const [joinCode, setJoinCode] = useState("")
  const [error, setError] = useState("")

  async function onCreateClick() {
    if (isCreating) return
    setError("")
    setIsCreating(true)
    try {
      await ensurePromptBank()
      const code = await createGame(false)
      router.push(`/${code}`)
    } catch (e) {
      setError(e?.message ?? "unknown error")
      setIsCreating(false)
    }
  }

  async function onDummyClick() {
    if (isCreating) return
    setError("")
    setIsCreating(true)
    try {
      await ensurePromptBank()
      const code = await createGame(true)

      // Add bots
      const { data: botData, error: botError } = await supabase
        .from("drawful_players")
        .insert(BOT_NAMES.map(name => ({ game_code: code, name, first_name: name, last_name: "", is_bot: true })))
        .select("id,name")
      if (botError) throw botError

      // Add real player
      const { data: realData, error: realError } = await supabase
        .from("drawful_players")
        .insert({ game_code: code, name: "You", first_name: "You", last_name: "", is_bot: false })
        .select("id")
        .single()
      if (realError) throw realError

      localStorage.setItem(`drawful:${code}:playerId`, realData.id)

      await supabase.rpc("drawful_start_game", { p_code: code })
      router.push(`/${code}/play`)
    } catch (e) {
      setError(e?.message ?? "unknown error")
      setIsCreating(false)
    }
  }

  function onJoin() {
    const trimmed = joinCode.trim()
    if (trimmed) router.push(`/${trimmed}`)
  }

  return (
    <div style={{
      minHeight: "100dvh", background: BG,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "40px 24px",
    }}>
      <h1 style={{
        fontSize: "clamp(52px, 16vw, 96px)", fontWeight: 900, color: "white",
        letterSpacing: "-3px", lineHeight: 0.9, textAlign: "center", marginBottom: 12,
      }}>
        Drawful
      </h1>
      <p style={{
        color: "rgba(255,255,255,0.45)", fontSize: 14, fontWeight: 700,
        textAlign: "center", marginBottom: 56, letterSpacing: "0.1em", textTransform: "uppercase",
      }}>
        Draw weird. Guess weirder.
      </p>

      <div style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          onClick={onCreateClick}
          disabled={isCreating}
          style={{ background: ACCENT, color: "#000", fontSize: 22, fontWeight: 900, padding: "22px 40px", width: "100%", display: "block" }}
        >
          {isCreating ? "Creating…" : "Create Game"}
        </button>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="Room code"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === "Enter") onJoin() }}
            style={{
              flex: 1, minWidth: 0, background: "rgba(255,255,255,0.15)", color: "white",
              fontSize: 18, fontWeight: 800, padding: "18px 16px", textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          />
          <button
            onClick={onJoin}
            style={{ background: "rgba(255,255,255,0.15)", color: "white", fontSize: 18, fontWeight: 900, padding: "18px 20px", flexShrink: 0 }}
          >
            Join
          </button>
        </div>
      </div>

      {!!error && (
        <p style={{ color: ACCENT, marginTop: 20, fontSize: 14, fontWeight: 600, textAlign: "center" }}>
          Error: {error}
        </p>
      )}

      <button
        onClick={onDummyClick}
        disabled={isCreating}
        style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.35)",
          fontSize: 11, fontWeight: 700, padding: "8px 16px",
          letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap",
        }}
      >
        {isCreating ? "Setting up…" : "Dummy Game"}
      </button>
    </div>
  )
}

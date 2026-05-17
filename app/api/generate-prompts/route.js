import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@supabase/supabase-js"

export async function POST() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const client = new Anthropic()
  try {
    // Fetch the last 50 used prompts to exclude
    const { data: recentUsed } = await supabase
      .from("drawful_prompts")
      .select("text")
      .not("used_at", "is", null)
      .order("used_at", { ascending: false })
      .limit(50)

    const excludeList = (recentUsed ?? []).map(r => r.text)
    const excludeSection = excludeList.length > 0
      ? `\n\nDo not reuse any character, animal, setting, or concept from these recently used prompts. Avoid anything too similar:\n${excludeList.join("\n")}`
      : ""

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: `Generate 50 Drawful-style drawing prompts for a party game. Each should be a specific, concrete scene that would be funny to draw and guess.

Rules:
- Each prompt has exactly one absurd element — one normal thing in a weird situation, or one weird thing in a normal situation. Don't stack two or more absurdities.
- No letters, numbers, or text-based humor — prompts must be drawable.
- Vary prompt length — some should be 2–3 words, some 4–6, some longer. Don't let any one length dominate.
- Vary structure: at least 10 should be compound nouns or hybrid objects ("half X, half Y"), at least 10 should be location/situation-based ("inside a X, a Y is happening"), and the rest can be "a [character] doing [wrong thing]" style.
- Do not number the prompts.

Format: one prompt per line, no numbering, no quotes, no punctuation at the end.${excludeSection}`,
      }],
    })

    const text = message.content[0].text
    const prompts = text
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .slice(0, 50)

    if (prompts.length === 0) {
      return Response.json({ error: "No prompts generated" }, { status: 500 })
    }

    const { error } = await supabase
      .from("drawful_prompts")
      .insert(prompts.map(text => ({ text, used_at: null })))

    if (error) throw error

    return Response.json({ count: prompts.length })
  } catch (e) {
    console.error("generate-prompts error:", e)
    return Response.json({ error: e.message }, { status: 500 })
  }
}

"use client"
import { useEffect, useState } from "react"

export function useSubmitNudge(value, submitted) {
  const [shouldNudge, setShouldNudge] = useState(false)
  useEffect(() => {
    if (!value || submitted) { setShouldNudge(false); return }
    const t = setTimeout(() => setShouldNudge(true), 10000)
    return () => clearTimeout(t)
  }, [value, submitted])
  return shouldNudge
}

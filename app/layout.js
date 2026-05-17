import "./globals.css"

export const dynamic = "force-dynamic"
export const metadata = { title: "Drawful" }

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ background: "#64B5A9" }}>{children}</body>
    </html>
  )
}

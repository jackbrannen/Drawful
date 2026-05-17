import "./globals.css"

export const dynamic = "force-dynamic"
export const metadata = { title: "Drawful" }

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ background: "#B56576" }}>{children}</body>
    </html>
  )
}

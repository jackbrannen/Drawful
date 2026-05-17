import "./globals.css"

export const dynamic = "force-dynamic"
export const metadata = { title: "Drawful" }

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ background: "#307977" }}>{children}</body>
    </html>
  )
}

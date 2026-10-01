import { Geist_Mono, Outfit, Plus_Jakarta_Sans } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { UserProvider } from "@/components/providers/user-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
})

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "font-sans antialiased",
        plusJakarta.variable,
        outfit.variable,
        fontMono.variable
      )}
    >
      <body>
        <ThemeProvider defaultTheme="dark">
          <UserProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </UserProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}

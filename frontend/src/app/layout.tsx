import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/app/providers";
import { NavBar } from "@/components/nav-bar";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"]
});

export const metadata: Metadata = {
  title: "Archon",
  description: "Verifiable work. On-chain.",
  metadataBase: new URL("https://archon.vercel.app"),
  icons: {
    icon: "/logo-icon.svg",
    shortcut: "/logo-icon.svg",
    apple: "/logo-icon.svg"
  },
  openGraph: {
    title: "Archon",
    description: "Verifiable work. On-chain.",
    images: ["/logo.svg"]
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen`}>
        <Providers>
          <NavBar />
          <main className="mx-auto max-w-6xl px-4 py-8 md:py-10">{children}</main>
          <footer className="border-t border-white/10 bg-[#0a0a0b] px-4 py-6">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-xs text-[#9CA3AF]">
              <span>Archon</span>
              <span>Ryzome Registration: Pending - ARC marketplace integration ready</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}


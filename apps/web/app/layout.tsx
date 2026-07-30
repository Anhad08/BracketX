import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  display: "swap",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "BracketX",
    template: "%s · BracketX",
  },
  description:
    "AI-first, browser-first live production for broadcast graphics — " +
    "esports, sports, podcasts, and live events.",
};

export const viewport: Viewport = {
  // Dark-only product; tells the browser to render form controls and
  // scrollbars accordingly before any CSS loads.
  colorScheme: "dark",
  themeColor: "#0b0d12",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh bg-canvas font-sans text-fg antialiased">
        {children}
      </body>
    </html>
  );
}

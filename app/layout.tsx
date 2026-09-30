import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spot On!",
  description: "A playful multiplayer favourite-guessing game for 3–6 friends.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scheme-light">
      <body className="antialiased">{children}</body>
    </html>
  );
}

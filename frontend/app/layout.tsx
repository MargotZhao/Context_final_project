import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Agent",
  description: "AI agent with web search and calculator — powered by claude-opus-4-7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-gray-950 text-gray-100">{children}</body>
    </html>
  );
}

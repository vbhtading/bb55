import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Weekly BB Scanner",
  description: "Weekly Bollinger (55, 3, 4) breakout scan, ATR / EMA 100 exits, mock portfolio",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import OverlayScrollbar from "@/components/OverlayScrollbar";
import MusicPlayer from "@/components/MusicPlayer";
import ApiConfigPanel from "@/components/ApiConfigPanel";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "魔法少女的魔女裁决",
  description: "属于艾玛众人之前在此岛上的女孩们的故事",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <OverlayScrollbar />
        <MusicPlayer />
        <ApiConfigPanel />
      </body>
    </html>
  );
}


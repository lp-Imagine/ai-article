import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { PointerCaptureGuard } from "@/components/pointer-capture-guard";
import { ToastProvider } from "@/components/toast";

export const metadata: Metadata = {
  title: "Draftly · 内容工作台",
  description: "AI 驱动的公众号内容创作工作台",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        <PointerCaptureGuard />
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}

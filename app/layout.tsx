import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./theme-dark.generated.css";
import { ThemeProvider } from "@/lib/theme";

export const metadata: Metadata = {
  title: "AVISA — Ministerio de Producción",
  description:
    "Prototipo de consola operativa AVISA con seguimiento territorial, mapas demostrativos, directorio de actores, alertas y compromisos.",
  generator: "v0.app",
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: "#f5f7f8",
};

// Se ejecuta antes del primer pintado para evitar el destello blanco cuando
// la preferencia guardada es el tema oscuro.
const themeBootstrap = `(function () {
  try {
    var stored = localStorage.getItem('avisa-theme');
    var preference = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    var resolved = preference === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : preference;
    var root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    root.style.colorScheme = resolved;
  } catch (error) {
    document.documentElement.dataset.theme = 'light';
  }
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="antialiased">
        <ThemeProvider>{children}</ThemeProvider>
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  );
}

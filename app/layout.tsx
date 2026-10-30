import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { esES } from "@clerk/localizations";
import { shadcn } from "@clerk/ui/themes";
import { Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { ProfileSync } from "@/components/profile-sync";
import "./globals.css";
import "./gruvbox.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GraphU | Conecta tus gustos. Descubre otra canción.",
  description: "Explora recomendaciones y conexiones entre artistas y canciones con datos de MusicBrainz. Guarda favoritos y reúne tus descubrimientos en playlists.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ClerkProvider
          localization={esES}
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInFallbackRedirectUrl="/sign-in"
          signUpFallbackRedirectUrl="/sign-in"
          appearance={{
            theme: shadcn,
            variables: {
              colorPrimary: "#fabd2f",
              colorPrimaryForeground: "#282828",
              colorBackground: "#282828",
              colorForeground: "#ebdbb2",
              colorMuted: "#665c54",
              colorMutedForeground: "#ebdbb2",
              colorInput: "#282828",
              colorInputForeground: "#ebdbb2",
              colorBorder: "#665c54",
              colorRing: "#fabd2f",
              borderRadius: "0px",
              fontFamily: "var(--font-geist-mono), monospace",
            },
            elements: {
              rootBox: "auth-clerk-root",
              cardBox: "auth-clerk-box",
              card: "auth-clerk-card",
              headerTitle: "auth-clerk-title",
              socialButtonsBlockButton: "auth-social-button",
              formButtonPrimary: "auth-submit-button",
              formFieldInput: "auth-input",
              footer: "auth-clerk-footer",
            },
          }}
        >
          <Suspense fallback={null}>
            <ProfileSync />
          </Suspense>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}

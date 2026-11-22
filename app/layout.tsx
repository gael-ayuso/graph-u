import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { esES } from "@clerk/localizations";
import { shadcn } from "@clerk/ui/themes";
import { Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { ProfileSync } from "@/components/profile-sync";
import { AsciiTrail } from "@/components/shared/ascii-trail";
import { SmoothScroll } from "@/components/shared/smooth-scroll";
import { TextScramble } from "@/components/shared/text-scramble";
import { QueryProvider } from "@/components/providers/query-provider";
import { RecommendationLibraryProvider } from "@/components/recommendation-library";
import { RecommendationExplorationProvider } from "@/components/recommendation-exploration-provider";
import "./globals.css";
import "./gruvbox.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const graphuLocalization = {
  ...esES,
  signIn: {
    ...esES.signIn,
    start: {
      ...esES.signIn?.start,
      actionLink: "Regístrate",
    },
  },
};

export const metadata: Metadata = {
  title: "GraphU | Conecta tus gustos. Descubre otra canción.",
  description: "Explora recomendaciones y conexiones entre artistas y canciones con datos de MusicBrainz. Guarda favoritos y reúne tus descubrimientos en playlists.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      data-scroll-behavior="smooth"
      className={`${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AsciiTrail />
        <SmoothScroll />
        <TextScramble />
        <ClerkProvider
          localization={graphuLocalization}
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInFallbackRedirectUrl="/explorar"
          signUpFallbackRedirectUrl="/explorar"
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
              socialButtonsBlockButton: "auth-social-button",
              formButtonPrimary: "auth-submit-button",
              formFieldInput: "auth-input",
            },
          }}
        >
          <QueryProvider>
            <Suspense fallback={null}>
              <ProfileSync />
            </Suspense>
            <RecommendationLibraryProvider>
              <RecommendationExplorationProvider>
                {children}
              </RecommendationExplorationProvider>
            </RecommendationLibraryProvider>
          </QueryProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { esES } from "@clerk/localizations";
import { shadcn } from "@clerk/ui/themes";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Accede a GraphU",
  description: "Inicia sesión en tu cuenta de GraphU.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}
    >
      <body className="min-h-full flex flex-col">
        <ClerkProvider
          localization={esES}
          signInUrl="/"
          signUpUrl="/sign-up"
          signInFallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
          appearance={{
            theme: shadcn,
            variables: {
              colorPrimary: "#2d6a4f",
              colorPrimaryForeground: "#ffffff",
              colorBackground: "#ffffff",
              colorForeground: "#081c15",
              colorMuted: "#d8f3dc",
              colorMutedForeground: "#2d6a4f",
              colorInput: "#ffffff",
              colorInputForeground: "#081c15",
              colorBorder: "#95d5b2",
              colorRing: "#40916c",
              borderRadius: "3px",
              fontFamily: "Arial, sans-serif",
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
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}

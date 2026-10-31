---
name: GraphU
description: A warm terminal interface for music discovery.
colors:
  olive: "#606c38"
  forest: "#283618"
  cream: "#fefae0"
  clay: "#dda15e"
  copper: "#bc6c25"
  destructive: "#f3a391"
typography:
  display:
    fontFamily: "Geist Mono, monospace"
    fontSize: "clamp(96px, 8.75vw, 132px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-.025em"
  headline:
    fontFamily: "Geist Mono, monospace"
    fontSize: "clamp(27px, 3vw, 45px)"
    fontWeight: 700
    lineHeight: 1.32
    letterSpacing: "-.035em"
  body:
    fontFamily: "Geist Mono, monospace"
    fontSize: "clamp(16px, 1.5vw, 23px)"
    lineHeight: 1.5
  label:
    fontFamily: "Geist Mono, monospace"
    fontSize: "15px"
    lineHeight: 1.4
rounded:
  square: "0px"
spacing:
  compact: "12px"
  control: "18px"
  section: "24px"
  wide: "32px"
components:
  button-primary:
    backgroundColor: "{colors.clay}"
    textColor: "{colors.forest}"
    rounded: "{rounded.square}"
    padding: "13px 18px"
  button-primary-hover:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.forest}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.cream}"
    rounded: "{rounded.square}"
    padding: "13px 18px"
  button-outline-hover:
    backgroundColor: "{colors.clay}"
    textColor: "{colors.forest}"
  navigation:
    textColor: "{colors.cream}"
  music-preview:
    textColor: "{colors.cream}"
    rounded: "{rounded.square}"
  song-node:
    textColor: "{colors.cream}"
    padding: "10px 6px"
---

# Design System: GraphU

## Overview

**Creative North Star: "Warm terminal"**

GraphU uses the approved Ratatui-inspired direction: a forest canvas, warm cream text, restrained earth accents, a block wordmark and readable monospace content. Rectangular frames, thin rules and geometric SVG connections give musical relationships a clear visual structure.

**Key Characteristics:**

- Pixel wordmark with a clay cursor.
- Legible monospace content.
- Square frames and flat, warm surfaces.
- Original album covers and geometric line art.

## Colors

The frontmatter records the five approved brand colors and the implemented destructive-state color.

- **Olive Leaf:** borders, dividers and secondary surfaces.
- **Black Forest:** page, cards and input backgrounds; text on clay actions.
- **Cornsilk:** primary text and the primary action's hover fill.
- **Sunlit Clay:** primary actions, highlighted words, cursor and focus outlines.
- **Copperwood:** outlined action and sign-in borders.
- **Destructive:** the separate semantic error color.

Subtle preview surfaces use olive mixed into forest at 32% and 20%. Illustration lines mix cream at 50% with olive.

## Typography

Geist Mono carries the GraphU brand, headings, body copy, controls and Clerk forms, with monospace fallbacks. Desktop hero typography is specified above; other text sizes respond to viewport width.

The hero description stays within 48ch on desktop. Section headings use a responsive 26–52px scale; feature titles use 20–24px. Auth titles use 23px. Use the same plain monospace family throughout.

## Layout

The landing container is centered and capped at 1512px, with 52px horizontal padding. Padding becomes 32px at 1150px and 20px at 540px.

The desktop hero is a two-column grid (1fr / 1.04fr). At 850px it becomes one column. The feature row has three columns and thin dividers; at 540px it stacks with horizontal rules. Navigation progressively removes internal links at 850px and 540px while keeping account access.

Authentication uses a centered column capped at 400px, a 24px vertical gap and 40px 20px page padding. Forms have 28px internal padding, changing to 24px 20px at 540px.

## Elevation & Depth

Depth comes from borders and muted surface mixes. Clerk cards and controls explicitly remove box shadows. Keep frames flat rather than introducing floating cards.

## Shapes

Controls and cards have square corners. Thin olive rules define sections and frames; prominent actions have 2px borders. SVG art uses simple connecting lines, circles, stars, lists and a speech bubble. Album covers retain square proportions and a thin olive outline.

## Components

- **Actions:** clay filled primary and copper outlined secondary links. Hover fills change to cream or clay respectively. Desktop actions are at least 60px high; mobile actions are at least 49px.
- **Navigation:** monospace text links, a framed account link and a compact monospace brand. Text links turn clay on hover.
- **Music preview:** a bordered figure with a caption bar, two album covers, artist names, outlined song labels and geometric connections. Its “Vista ilustrativa” label is essential; this component presents a static example.
- **Feature artwork:** decorative inline SVGs accompany feature copy and are hidden from assistive technology.
- **Authentication:** Clerk retains its form behavior and Spanish localization inside the shared square shell. Inputs, social buttons and submit actions have a minimum height of 44px.
- **Focus and motion:** links and buttons have a 2px clay focus outline with 6px offset. Color transitions last 140ms with ease-out. Reduced-motion preferences disable smooth scrolling and reduce transition duration.

Cover provenance is recorded in [public/music/SOURCES.md](public/music/SOURCES.md). The preview uses Radiohead's In Rainbows and Daft Punk's Discovery artwork, with Reckoner and Digital Love labels.

## Do's and Don'ts

- Do use Geist Mono for the GraphU brand and reading.
- Do retain square frames, thin rules and the approved earth palette.
- Do keep illustrative music connections explicitly labeled.
- Don't add playback controls or imply the static preview computes recommendations.
- Don't replace the original covers with generated approximations.
- Don't add rounded floating cards or decorative gradients.

